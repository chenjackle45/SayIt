import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderIdForModel,
  getProviderTimeout,
  getDefaultMaxTokens,
  type LlmChatRequest,
} from "./llmProvider";
import { getMinimalPromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import i18n from "../i18n";
import {
  detectEnhancementAnomaly,
  detectSemanticDrift,
} from "./hallucinationDetector";

const MAX_VOCABULARY_TERMS = 50;
const DEFAULT_ENHANCEMENT_RETRY_COUNT = 3;

export class EnhancerApiError extends Error {
  constructor(
    public statusCode: number,
    statusText: string,
    public body: string,
  ) {
    super(`Enhancement API error: ${statusCode} ${statusText}`);
    this.name = "EnhancerApiError";
  }
}

export function getDefaultSystemPrompt(): string {
  return getMinimalPromptForLocale(i18n.global.locale.value as SupportedLocale);
}

export interface EnhanceOptions {
  systemPrompt?: string;
  vocabularyTermList?: string[];
  modelId?: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const raceList: Promise<T>[] = [promise];

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error("Enhancement timeout");
      (err as Error & { code: string }).code = "ENHANCEMENT_TIMEOUT";
      reject(err);
    }, ms);
  });
  raceList.push(timeoutPromise as Promise<T>);

  let abortHandler: (() => void) | undefined;
  if (signal) {
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      abortHandler = () =>
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    raceList.push(abortPromise as Promise<T>);
  }

  try {
    return await Promise.race(raceList);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortHandler && signal)
      signal.removeEventListener("abort", abortHandler);
  }
}

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
): string {
  let prompt = basePrompt;

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

/**
 * 移除 reasoning model（如 Qwen3）回應中的 <think>...</think> 區塊，
 * 只保留最終輸出內容。
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<EnhanceResult> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API Key not configured");
  }

  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const providerId = getProviderIdForModel(modelId);

  const basePrompt = options?.systemPrompt || getDefaultSystemPrompt();
  const fullPrompt = buildSystemPrompt(basePrompt, options?.vocabularyTermList);

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: fullPrompt },
      { role: "user", content: rawText },
    ],
    temperature: 0.1,
    maxTokens: options?.maxTokens ?? getDefaultMaxTokens(providerId),
  };

  const { url, init } = buildFetchParams(providerId, request, apiKey);

  const response = await withTimeout(
    fetch(url, {
      ...init,
      signal: options?.signal,
    }),
    getProviderTimeout(providerId),
    options?.signal,
  );

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new EnhancerApiError(response.status, response.statusText, errorBody);
  }

  const json = await response.json();
  const result = parseProviderResponse(providerId, json);

  const usage: ChatUsageData | null = result.usage
    ? {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        promptTimeMs: result.usage.promptTimeMs,
        completionTimeMs: result.usage.completionTimeMs,
        totalTimeMs: result.usage.totalTimeMs,
      }
    : null;

  if (!result.text) {
    return { text: rawText, usage, isRawFallback: true };
  }

  const enhancedContent = stripReasoningTags(result.text);
  if (!enhancedContent) {
    return { text: rawText, usage, isRawFallback: true };
  }
  return { text: enhancedContent, usage };
}

export interface EnhanceWithGuardResult {
  text: string;
  usage: ChatUsageData | null;
  /** true 表示重試後仍偵測到長度爆炸異常，text 已 fallback 回 rawText。 */
  wasAnomalous: boolean;
  /** true 表示整理結果與原文 bigram 重疊過低（疑似答非所問）；呼叫端應拒絕並保留既有結果、勿寫入 DB。 */
  wasDrift: boolean;
  /** true 表示 LLM 回了空內容、text 只是退回的原文；呼叫端應保留既有結果、勿寫入 DB。 */
  wasEmptyResponse: boolean;
  /** enhanced→raw 的 bigram containment 比例（0~1），供守衛決策與遙測透明化使用。 */
  driftOverlapRatio: number;
}

/**
 * enhanceText 外加兩道獨立守衛：
 * 1.「增強後長度爆炸」：偵測到異常時最多重試 maxRetries 次，仍異常則 fallback 回 rawText、標記 wasAnomalous=true。
 * 2.「語意飄移」（#43）：最終結果與原文 bigram 重疊過低時標記 wasDrift=true，呼叫端據此「拒絕並保留既有結果」。
 * 目前由歷史紀錄重新整理使用；邏輯與 useVoiceFlowStore 即時流程的 inline 迴圈一致，未來可收斂共用。
 */
export async function enhanceWithAnomalyGuard(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
  maxRetries = DEFAULT_ENHANCEMENT_RETRY_COUNT,
): Promise<EnhanceWithGuardResult> {
  let enhanceResult = await enhanceText(rawText, apiKey, options);

  let retryCount = 0;
  while (
    retryCount < maxRetries &&
    detectEnhancementAnomaly({ rawText, enhancedText: enhanceResult.text })
      .isAnomaly
  ) {
    retryCount++;
    enhanceResult = await enhanceText(rawText, apiKey, options);
  }

  // 空回應退回原文：enhanceText 已 fallback 成 rawText，對長度爆炸／飄移都「看起來正常」，
  // 這裡要先攔下，否則呼叫端會把原文當整理結果覆寫既有內容
  if (enhanceResult.isRawFallback) {
    return {
      text: rawText,
      usage: enhanceResult.usage,
      wasAnomalous: false,
      wasDrift: false,
      wasEmptyResponse: true,
      driftOverlapRatio: 1,
    };
  }

  const finalAnomaly = detectEnhancementAnomaly({
    rawText,
    enhancedText: enhanceResult.text,
  });

  if (finalAnomaly.isAnomaly) {
    return {
      text: rawText,
      usage: enhanceResult.usage,
      wasAnomalous: true,
      wasDrift: false,
      wasEmptyResponse: false,
      driftOverlapRatio: 1,
    };
  }

  // #43 語意飄移守衛：整理結果與原文 bigram 重疊過低 → 疑似答非所問，
  // 標記 wasDrift 交由呼叫端「拒絕並保留既有結果」（不覆寫 DB）。
  const drift = detectSemanticDrift(rawText, enhanceResult.text);
  if (drift.isDrift) {
    return {
      text: enhanceResult.text,
      usage: enhanceResult.usage,
      wasAnomalous: false,
      wasDrift: true,
      wasEmptyResponse: false,
      driftOverlapRatio: drift.overlapRatio,
    };
  }

  return {
    text: enhanceResult.text,
    usage: enhanceResult.usage,
    wasAnomalous: false,
    wasDrift: false,
    wasEmptyResponse: false,
    driftOverlapRatio: drift.overlapRatio,
  };
}
