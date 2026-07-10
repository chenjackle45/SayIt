import { fetch } from "@tauri-apps/plugin-http";
import { DEFAULT_LLM_MODEL_ID, type LlmProviderId } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderIdForModel,
  getProviderTimeout,
  type LlmChatRequest,
  type LlmUsageData,
  type AzureRequestOptions,
} from "./llmProvider";

const SYSTEM_PROMPT = `你是語音轉錄字典助手。
比較 <original> 和 <corrected>，找出語音辨識寫錯、使用者改正的詞彙。
注意：<corrected> 可能包含多餘文字（如重複行或額外內容），請只關注與 <original> 對應的部分。

【回傳條件 — 替換後的詞必須是】
✅ 專有名詞（人名、地名、品牌、公司名、產品名）
✅ 技術術語（框架、程式語言、工具、協定、API）
✅ 特定領域用語（行業術語、學術用語）

【排除】
❌ 一般常用詞彙（今天、因為、the、good）
❌ 標點、空格、語序、語氣詞的差異
❌ 使用者新增的補充內容（原文沒有對應位置）
❌ 單一中文字（至少 2 字）

【範例】
original: "我的名字是陳太誠" → corrected: "我的名字是陳泰呈" → ["陳泰呈"]
original: "用view js寫的" → corrected: "用Vue.js寫的" → ["Vue.js"]
original: "今天天氣很好" → corrected: "今天天氣不錯" → []

回傳格式：JSON array，沒有符合的就回 []。只要 JSON，不要解釋。`;

export interface ApiUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface VocabularyAnalysisResult {
  suggestedTermList: string[];
  usage: ApiUsageInfo | null;
  rawResponse: string;
}

const MIN_CHINESE_CHAR_COUNT = 2;
const MIN_ENGLISH_CHAR_COUNT = 2;

function isTermTooShort(term: string): boolean {
  const trimmed = term.trim();
  // 判斷是否為中文為主的詞
  const chineseCharCount = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (chineseCharCount > 0) {
    return chineseCharCount < MIN_CHINESE_CHAR_COUNT;
  }
  // 英文/其他
  return trimmed.length < MIN_ENGLISH_CHAR_COUNT;
}

function isValidSuggestedTerm(item: unknown): item is string {
  return (
    typeof item === "string" && item.trim().length > 0 && !isTermTooShort(item)
  );
}

function parseSuggestedTermList(content: string): string[] {
  try {
    const parsed = JSON.parse(content.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidSuggestedTerm);
    }
  } catch {
    // AI 回傳非 JSON，嘗試從回傳中提取 JSON array
    const match = content.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter(isValidSuggestedTerm);
        }
      } catch {
        // 真的解析失敗，回傳空陣列
      }
    }
  }
  return [];
}

function convertUsage(usage: LlmUsageData | null): ApiUsageInfo | null {
  if (!usage) return null;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptTimeMs: usage.promptTimeMs,
    completionTimeMs: usage.completionTimeMs,
    totalTimeMs: usage.totalTimeMs,
  };
}

export async function analyzeCorrections(
  pastedText: string,
  fieldText: string,
  apiKey: string,
  options?: {
    modelId?: string;
    provider?: LlmProviderId;
    azure?: AzureRequestOptions;
  },
): Promise<VocabularyAnalysisResult> {
  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const providerId = options?.provider ?? getProviderIdForModel(modelId);

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `<original>${pastedText}</original>\n<corrected>${fieldText}</corrected>`,
      },
    ],
    temperature: 0,
    maxTokens: 256,
  };

  const { url, init } = buildFetchParams(
    providerId,
    request,
    apiKey,
    options?.azure,
  );

  const timeoutMs = getProviderTimeout(providerId);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Vocabulary analysis API error: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  const json = await response.json();
  const result = parseProviderResponse(providerId, json);
  const usage = convertUsage(result.usage);

  if (!result.text) {
    return { suggestedTermList: [], usage, rawResponse: "" };
  }

  const suggestedTermList = parseSuggestedTermList(result.text);
  return { suggestedTermList, usage, rawResponse: result.text };
}
