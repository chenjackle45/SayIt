import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderIdForModel,
  getProviderTimeout,
  type LlmChatRequest,
} from "./llmProvider";
import { getMinimalPromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import i18n from "../i18n";

const MAX_VOCABULARY_TERMS = 50;

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
    maxTokens: options?.maxTokens ?? 16384,
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
    return { text: rawText, usage };
  }

  const enhancedContent = stripReasoningTags(result.text);
  return { text: enhancedContent || rawText, usage };
}
