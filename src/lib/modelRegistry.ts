// ── LLM Provider ──────────────────────────────────────────

export type LlmProviderId = "groq" | "openai" | "anthropic" | "gemini";

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq";

// ── LLM 模型（文字整理用）────────────────────────────────

export type LlmModelId =
  | "qwen/qwen3.6-27b"
  | "openai/gpt-oss-120b"
  | "openai/gpt-oss-20b"
  | "gpt-5.6-luna"
  | "gpt-5.4-nano"
  | "claude-haiku-4-5-20251001"
  | "gemini-3.5-flash"
  | "gemini-3.1-flash-lite";

// ── Whisper 模型（語音轉錄用）─────────────────────────────

export type WhisperModelId = "whisper-large-v3" | "whisper-large-v3-turbo";

interface BaseModelConfig {
  displayName: string;
  badgeKey: string;
  speedTps: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  freeQuotaRpd: number;
  freeQuotaTpd: number;
  isDefault: boolean;
}

export interface LlmModelConfig extends BaseModelConfig {
  id: LlmModelId;
  providerId: LlmProviderId;
}

export interface WhisperModelConfig {
  id: WhisperModelId;
  displayName: string;
  costPerHour: number;
  freeQuotaRpd: number;
  freeQuotaAudioSecondsPerDay: number;
  isDefault: boolean;
}

// ── 預設值 ────────────────────────────────────────────────

export const DEFAULT_LLM_MODEL_ID: LlmModelId = "qwen/qwen3.6-27b";
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "whisper-large-v3";

// ── 已下架模型 ID 映射（舊 → 新，用於自動遷移）──────────
// 每個 value 必須是「當前 registry 內存活的 id」或「map 內另一個 key」
// （getEffectiveLlmModelId 會迴圈解析、並保證回傳值存在於 registry）。
// 映射原則：同 provider 內遷移，避免觸發 useSettingsStore 的 provider 交叉驗證。

export const DECOMMISSIONED_MODEL_MAP: Record<string, string> = {
  // Groq — 2026-07-17 / 2026-08-16 下架潮
  "llama-3.3-70b-versatile": "qwen/qwen3.6-27b",
  "qwen/qwen3-32b": "qwen/qwen3.6-27b",
  "qwen-qwq-32b": "qwen/qwen3.6-27b",
  "moonshotai/kimi-k2-instruct": "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct": "openai/gpt-oss-20b",
  "llama-4-scout-17b-16e-instruct": "openai/gpt-oss-20b",
  "llama-4-maverick-17b-128e-instruct": "qwen/qwen3.6-27b",
  "meta-llama/llama-4-maverick-17b-128e-instruct": "qwen/qwen3.6-27b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  // Gemini — 2.5 世代汰換
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  // OpenAI
  "gpt-5.4-mini": "gpt-5.6-luna",
  // Anthropic — 3.5 Haiku 已於 2026-02-19 退役
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
};

// ── 模型清單 ──────────────────────────────────────────────

export const LLM_MODEL_LIST: LlmModelConfig[] = [
  // ── Groq（免費）──
  {
    // Preview 模型：Groq 可無預警下架，顯示名稱標明讓使用者知情
    id: "qwen/qwen3.6-27b",
    providerId: "groq",
    displayName: "Qwen3.6 27B (Preview)",
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 500,
    inputCostPerMillion: 0.6,
    outputCostPerMillion: 3.0,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: true,
  },
  {
    id: "openai/gpt-oss-120b",
    providerId: "groq",
    displayName: "GPT OSS 120B",
    badgeKey: "settings.modelBadge.stableCostly",
    speedTps: 500,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: false,
  },
  {
    id: "openai/gpt-oss-20b",
    providerId: "groq",
    displayName: "GPT OSS 20B",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 1_000,
    inputCostPerMillion: 0.075,
    outputCostPerMillion: 0.3,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 200_000,
    isDefault: false,
  },
  // ── Google Gemini（免費額度依帳號而異，不在此顯示）──
  {
    id: "gemini-3.5-flash",
    providerId: "gemini",
    displayName: "Gemini 3.5 Flash",
    badgeKey: "settings.modelBadge.premium",
    speedTps: 0,
    inputCostPerMillion: 1.5,
    outputCostPerMillion: 9.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    providerId: "gemini",
    displayName: "Gemini 3.1 Flash-Lite",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 0,
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 1.5,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  // ── OpenAI（付費）──
  {
    id: "gpt-5.6-luna",
    providerId: "openai",
    displayName: "GPT-5.6 Luna",
    badgeKey: "settings.modelBadge.premium",
    speedTps: 0,
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 6.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
  {
    id: "gpt-5.4-nano",
    providerId: "openai",
    displayName: "GPT-5.4 Nano",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 0,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 1.25,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  // ── Anthropic（付費）──
  {
    id: "claude-haiku-4-5-20251001",
    providerId: "anthropic",
    displayName: "Claude Haiku 4.5",
    badgeKey: "settings.modelBadge.premium",
    speedTps: 0,
    inputCostPerMillion: 1.0,
    outputCostPerMillion: 5.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: true,
  },
];

export const WHISPER_MODEL_LIST: WhisperModelConfig[] = [
  {
    id: "whisper-large-v3",
    displayName: "Whisper Large V3",
    costPerHour: 0.111,
    freeQuotaRpd: 2_000,
    freeQuotaAudioSecondsPerDay: 28_800,
    isDefault: true,
  },
  {
    id: "whisper-large-v3-turbo",
    displayName: "Whisper Large V3 Turbo",
    costPerHour: 0.04,
    freeQuotaRpd: 2_000,
    freeQuotaAudioSecondsPerDay: 28_800,
    isDefault: false,
  },
];

// ── Lookup helpers ────────────────────────────────────────

export function findLlmModelConfig(id: string): LlmModelConfig | undefined {
  return LLM_MODEL_LIST.find((m) => m.id === id);
}

export function findWhisperModelConfig(
  id: string,
): WhisperModelConfig | undefined {
  return WHISPER_MODEL_LIST.find((m) => m.id === id);
}

export function getModelListByProvider(
  providerId: LlmProviderId,
): LlmModelConfig[] {
  return LLM_MODEL_LIST.filter((m) => m.providerId === providerId);
}

export function getDefaultModelIdForProvider(
  providerId: LlmProviderId,
): LlmModelId {
  const providerModelList = getModelListByProvider(providerId);
  const defaultModel = providerModelList.find((m) => m.isDefault);
  return defaultModel?.id ?? providerModelList[0]?.id ?? DEFAULT_LLM_MODEL_ID;
}

// 遷移鏈解析上限：防止 map 內互指造成無窮迴圈
const MAX_MIGRATION_HOPS = 5;

/**
 * 安全取得 LLM 模型 ID：若 savedId 不在 registry 則沿遷移表迴圈解析，
 * 解析失敗則 fallback 到預設。處理舊版升級（null）和模型下架的情境。
 *
 * 迴圈解析（而非單跳查找）是刻意的：歷次下架累積的舊 entry 可能指向
 * 「後來也被下架」的模型，單跳會回傳 registry 查不到的死值，且下游
 * provider 交叉驗證對 undefined config 短路、救不回來。此函式保證
 * 回傳值必存在於當前 registry。
 */
export function getEffectiveLlmModelId(savedId: string | null): LlmModelId {
  let candidate = savedId;
  for (let hop = 0; candidate && hop < MAX_MIGRATION_HOPS; hop += 1) {
    if (findLlmModelConfig(candidate)) return candidate as LlmModelId;
    const next: string | undefined = DECOMMISSIONED_MODEL_MAP[candidate];
    if (!next) break;
    candidate = next;
  }
  return DEFAULT_LLM_MODEL_ID;
}

/**
 * 安全取得 Whisper 模型 ID：若 savedId 不在 registry 則 fallback 到預設。
 */
export function getEffectiveWhisperModelId(
  savedId: string | null,
): WhisperModelId {
  if (savedId && findWhisperModelConfig(savedId))
    return savedId as WhisperModelId;
  return DEFAULT_WHISPER_MODEL_ID;
}
