// ── LLM Provider ──────────────────────────────────────────

export type LlmProviderId = "groq" | "openai" | "anthropic" | "gemini";

export const DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq";

// ── LLM 模型（文字整理用）────────────────────────────────

export type LlmModelId =
  | "llama-3.3-70b-versatile"
  | "meta-llama/llama-4-scout-17b-16e-instruct"
  | "qwen/qwen3-32b"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "claude-haiku-4-5-20251001"
  | "claude-3-5-haiku-20241022"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite";

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

export const DEFAULT_LLM_MODEL_ID: LlmModelId = "llama-3.3-70b-versatile";
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "whisper-large-v3";

// ── 已下架模型 ID 映射（舊 → 新，用於自動遷移）──────────

export const DECOMMISSIONED_MODEL_MAP: Record<string, LlmModelId> = {
  "moonshotai/kimi-k2-instruct": "llama-3.3-70b-versatile",
  "qwen-qwq-32b": "llama-3.3-70b-versatile",
  "gpt-oss-120b": "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b": "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b": "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant": "qwen/qwen3-32b",
  "llama-4-scout-17b-16e-instruct":
    "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-4-maverick-17b-128e-instruct": "qwen/qwen3-32b",
  "meta-llama/llama-4-maverick-17b-128e-instruct": "qwen/qwen3-32b",
};

// ── 模型清單 ──────────────────────────────────────────────

export const LLM_MODEL_LIST: LlmModelConfig[] = [
  // ── Groq（免費）──
  {
    id: "llama-3.3-70b-versatile",
    providerId: "groq",
    displayName: "Llama 3.3 70B Versatile",
    badgeKey: "settings.modelBadge.stableCostly",
    speedTps: 280,
    inputCostPerMillion: 0.59,
    outputCostPerMillion: 0.79,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 100_000,
    isDefault: true,
  },
  {
    id: "qwen/qwen3-32b",
    providerId: "groq",
    displayName: "Qwen3 32B",
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 400,
    inputCostPerMillion: 0.29,
    outputCostPerMillion: 0.59,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 500_000,
    isDefault: false,
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    providerId: "groq",
    displayName: "Llama 4 Scout 17B",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 750,
    inputCostPerMillion: 0.11,
    outputCostPerMillion: 0.34,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 500_000,
    isDefault: false,
  },
  // ── Google Gemini（免費額度）──
  {
    id: "gemini-2.5-flash",
    providerId: "gemini",
    displayName: "Gemini 2.5 Flash",
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 0,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    freeQuotaRpd: 250,
    freeQuotaTpd: 0,
    isDefault: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    providerId: "gemini",
    displayName: "Gemini 2.5 Flash-Lite",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 0,
    inputCostPerMillion: 0.075,
    outputCostPerMillion: 0.3,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 0,
    isDefault: false,
  },
  // ── OpenAI（付費）──
  {
    id: "gpt-5.4-mini",
    providerId: "openai",
    displayName: "GPT-5.4 Mini",
    badgeKey: "settings.modelBadge.premium",
    speedTps: 0,
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 4.5,
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
  {
    id: "claude-3-5-haiku-20241022",
    providerId: "anthropic",
    displayName: "Claude 3.5 Haiku",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 0,
    inputCostPerMillion: 0.8,
    outputCostPerMillion: 4.0,
    freeQuotaRpd: 0,
    freeQuotaTpd: 0,
    isDefault: false,
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

/**
 * 安全取得 LLM 模型 ID：若 savedId 不在 registry 則嘗試自動遷移，
 * 遷移失敗則 fallback 到預設。處理舊版升級（null）和模型下架的情境。
 */
export function getEffectiveLlmModelId(savedId: string | null): LlmModelId {
  if (savedId && findLlmModelConfig(savedId)) return savedId as LlmModelId;

  if (savedId && savedId in DECOMMISSIONED_MODEL_MAP) {
    return DECOMMISSIONED_MODEL_MAP[savedId];
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
