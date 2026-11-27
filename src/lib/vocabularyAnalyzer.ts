import type { SupportedLocale } from "../i18n/languageConfig";
import { fetch } from "@tauri-apps/plugin-http";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderIdForModel,
  getProviderTimeout,
  type LlmChatRequest,
  type LlmUsageData,
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

const SYSTEM_PROMPTS: Record<SupportedLocale, string> = {
  "zh-TW": SYSTEM_PROMPT,
  "zh-CN": `你是语音转录词典助手。比较 <original> 和 <corrected>，只返回用户改正后的专有名词或领域术语（人名、地名、品牌、产品、技术术语）。摘录可能包含多余或截断内容，只关注原文对应的位置。排除新增内容、常用词、标点、空格、语序和语气变化。含汉字的词至少两个汉字，其他词至少两个字符。只返回 JSON 字符串数组，没有符合项返回 []，不作解释。`,
  en: `You are a speech transcription dictionary assistant. Compare <original> and <corrected>. Return only corrected proper nouns or specialist terms (names, places, brands, products, technical terms). The excerpt may contain extra or truncated text; use only positions corresponding to the original. Exclude added content, common words, punctuation, spacing, word order and tone changes. Terms containing Han characters need at least two Han characters; other terms need at least two characters. Return only a JSON string array, or [] when none qualify.`,
  ja: `音声文字起こしの辞書アシスタントです。<original> と <corrected> を比較し、ユーザーが訂正した固有名詞・専門用語（人名、地名、ブランド、製品、技術用語）の訂正後の表記だけを返してください。抜粋には余分な内容や途切れた箇所があります。原文に対応する位置だけを対象とし、追加内容、一般語、句読点、空白、語順、語気の変化は除外してください。漢字を含む語は漢字2文字以上、その他は2文字以上。JSON文字列配列のみ、該当なしは []。説明は不要です。`,
  ko: `음성 전사 사전 도우미입니다. <original>과 <corrected>를 비교하여 사용자가 수정한 고유 명사나 전문 용어(인명, 지명, 브랜드, 제품, 기술 용어)의 수정 후 표기만 반환하세요. 발췌문에는 추가되거나 잘린 내용이 있을 수 있으므로 원문에 대응하는 위치만 검토하세요. 추가 내용, 일상 단어, 문장 부호, 공백, 어순 및 어조 변화는 제외하세요. 한자가 포함된 단어는 한자 두 자 이상, 그 외에는 두 글자 이상이어야 합니다. JSON 문자열 배열만 반환하고 해당 항목이 없으면 []를 반환하세요. 설명은 하지 마세요.`,
};

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
  options?: { modelId?: string; locale?: SupportedLocale },
): Promise<VocabularyAnalysisResult> {
  const modelId = options?.modelId ?? DEFAULT_LLM_MODEL_ID;
  const providerId = getProviderIdForModel(modelId);

  const request: LlmChatRequest = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[options?.locale ?? "zh-TW"] },
      {
        role: "user",
        content: `<original>${pastedText}</original>\n<corrected>${fieldText}</corrected>`,
      },
    ],
    temperature: 0,
    maxTokens: 256,
  };

  const { url, init } = buildFetchParams(providerId, request, apiKey);

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
