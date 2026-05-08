import type { LlmProviderId } from "./modelRegistry";
import { findLlmModelConfig } from "./modelRegistry";

// ── Provider 設定 ─────────────────────────────────────────

export interface LlmProviderConfig {
  id: LlmProviderId;
  displayName: string;
  baseUrl: string;
  consoleUrl: string;
  apiKeyPrefix: string;
}

export const LLM_PROVIDER_LIST: LlmProviderConfig[] = [
  {
    id: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    consoleUrl: "https://console.groq.com/keys",
    apiKeyPrefix: "gsk_",
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    consoleUrl: "https://aistudio.google.com/apikey",
    apiKeyPrefix: "AI",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    consoleUrl: "https://platform.openai.com/api-keys",
    apiKeyPrefix: "sk-",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPrefix: "sk-ant-",
  },
];

export function findProviderConfig(
  providerId: LlmProviderId,
): LlmProviderConfig | undefined {
  return LLM_PROVIDER_LIST.find((p) => p.id === providerId);
}

// ── Provider Timeout ──────────────────────────────────────

const PROVIDER_TIMEOUT_MS: Record<LlmProviderId, number> = {
  groq: 5_000,
  openai: 30_000,
  anthropic: 30_000,
  gemini: 30_000,
};

export function getProviderTimeout(providerId: LlmProviderId): number {
  return PROVIDER_TIMEOUT_MS[providerId];
}

// Anthropic Claude (Haiku 4.5 / 3.5 Haiku) standard 模式 max_tokens 上限 8192；
// Groq 模型多數上限也接近 8192。OpenAI / Gemini 支援更高，且 Gemini 2.5 的
// thinking tokens 計入 maxOutputTokens 配額，需要更高 buffer 避免長轉錄被截斷。
const PROVIDER_DEFAULT_MAX_TOKENS: Record<LlmProviderId, number> = {
  groq: 8192,
  openai: 16384,
  anthropic: 8192,
  gemini: 16384,
};

export function getDefaultMaxTokens(providerId: LlmProviderId): number {
  return PROVIDER_DEFAULT_MAX_TOKENS[providerId];
}

// ── 統一型別 ──────────────────────────────────────────────

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatRequest {
  model: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface LlmChatResult {
  text: string;
  usage: LlmUsageData | null;
}

// ── Provider-aware fetch 組裝 ─────────────────────────────

export function getProviderIdForModel(modelId: string): LlmProviderId {
  return findLlmModelConfig(modelId)?.providerId ?? "groq";
}

export function buildFetchParams(
  providerId: LlmProviderId,
  request: LlmChatRequest,
  apiKey: string,
): { url: string; init: RequestInit } {
  const providerConfig = findProviderConfig(providerId);
  const url = providerConfig?.baseUrl ?? LLM_PROVIDER_LIST[0].baseUrl;

  if (providerId === "anthropic") {
    return buildAnthropicFetchParams(url, request, apiKey);
  }

  if (providerId === "gemini") {
    return buildGeminiFetchParams(url, request, apiKey);
  }

  return buildOpenAiCompatibleFetchParams(providerId, url, request, apiKey);
}

function buildOpenAiCompatibleFetchParams(
  providerId: LlmProviderId,
  url: string,
  request: LlmChatRequest,
  apiKey: string,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) {
    // OpenAI GPT-5.x 系列要求 max_completion_tokens；Groq 仍用 max_tokens
    if (providerId === "openai") {
      body.max_completion_tokens = request.maxTokens;
    } else {
      body.max_tokens = request.maxTokens;
    }
  }

  return {
    url,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

function buildAnthropicFetchParams(
  url: string,
  request: LlmChatRequest,
  apiKey: string,
): { url: string; init: RequestInit } {
  // 提取 system message 到頂層（多個時串接）
  const systemPartList: string[] = [];
  const filteredMessageList: { role: string; content: string }[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemPartList.push(msg.content);
    } else {
      filteredMessageList.push({ role: msg.role, content: msg.content });
    }
  }
  const systemPrompt =
    systemPartList.length > 0 ? systemPartList.join("\n\n") : undefined;

  const body: Record<string, unknown> = {
    model: request.model,
    messages: filteredMessageList,
    max_tokens: request.maxTokens ?? getDefaultMaxTokens("anthropic"),
  };
  if (systemPrompt) body.system = systemPrompt;
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  return {
    url,
    init: {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

function buildGeminiFetchParams(
  baseUrl: string,
  request: LlmChatRequest,
  apiKey: string,
): { url: string; init: RequestInit } {
  const url = `${baseUrl}/models/${request.model}:generateContent`;

  // system message → system_instruction
  const systemPartList: string[] = [];
  const contentList: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemPartList.push(msg.content);
    } else {
      contentList.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const body: Record<string, unknown> = { contents: contentList };
  if (systemPartList.length > 0) {
    body.system_instruction = {
      parts: [{ text: systemPartList.join("\n\n") }],
    };
  }

  const generationConfig: Record<string, unknown> = {};
  if (request.temperature !== undefined)
    generationConfig.temperature = request.temperature;
  if (request.maxTokens !== undefined)
    generationConfig.maxOutputTokens = request.maxTokens;
  if (Object.keys(generationConfig).length > 0)
    body.generationConfig = generationConfig;

  return {
    url,
    init: {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

// ── Provider-aware response 解析 ──────────────────────────

interface OpenAiCompatibleResponse {
  choices?: { message: { content: string } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_time?: number;
    completion_time?: number;
    total_time?: number;
  };
}

interface AnthropicResponse {
  content?: { type: string; text: string }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export function parseProviderResponse(
  providerId: LlmProviderId,
  json: unknown,
): LlmChatResult {
  const data = json as Record<string, unknown>;
  // Anthropic 和 OpenAI 都可能在 200 body 中回傳 error
  if (data?.error || data?.type === "error") {
    const errMsg =
      typeof data.error === "object" && data.error !== null
        ? (data.error as Record<string, unknown>).message ?? "Unknown error"
        : data.error ?? "Unknown error";
    throw new Error(`LLM API error: ${errMsg}`);
  }

  if (providerId === "anthropic") {
    return parseAnthropicResponse(data as unknown as AnthropicResponse);
  }
  if (providerId === "gemini") {
    return parseGeminiResponse(data as unknown as GeminiResponse);
  }
  return parseOpenAiCompatibleResponse(
    providerId,
    data as unknown as OpenAiCompatibleResponse,
  );
}

function parseOpenAiCompatibleResponse(
  providerId: LlmProviderId,
  data: OpenAiCompatibleResponse,
): LlmChatResult {
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  let usage: LlmUsageData | null = null;

  if (data.usage) {
    usage = {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    };
    // Groq 才有時間欄位
    if (providerId === "groq" && data.usage.prompt_time !== undefined) {
      usage.promptTimeMs = Math.round(data.usage.prompt_time * 1000);
      usage.completionTimeMs = Math.round(
        (data.usage.completion_time ?? 0) * 1000,
      );
      usage.totalTimeMs = Math.round((data.usage.total_time ?? 0) * 1000);
    }
  }

  return { text, usage };
}

function parseAnthropicResponse(data: AnthropicResponse): LlmChatResult {
  const textBlock = data.content?.find((c) => c.type === "text");
  const text = textBlock?.text?.trim() ?? "";
  let usage: LlmUsageData | null = null;

  if (data.usage) {
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    usage = {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  return { text, usage };
}

function parseGeminiResponse(data: GeminiResponse): LlmChatResult {
  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    throw new Error(`Gemini blocked response (reason: ${finishReason})`);
  }

  const text = candidate?.content?.parts?.[0]?.text?.trim() ?? "";
  let usage: LlmUsageData | null = null;

  if (data.usageMetadata) {
    const promptTokens = data.usageMetadata.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata.candidatesTokenCount ?? 0;
    usage = {
      promptTokens,
      completionTokens,
      totalTokens: data.usageMetadata.totalTokenCount ?? promptTokens + completionTokens,
    };
  }

  return { text, usage };
}
