// ── LLM 模型（文字整理用）────────────────────────────────

export type LlmModelId =
  | "llama-3.3-70b-versatile"
  | "meta-llama/llama-4-scout-17b-16e-instruct"
  | "qwen/qwen3-32b"
  | "moonshotai/kimi-k2-instruct";

// ── 字典分析模型 ─────────────────────────────────────────

export type VocabularyAnalysisModelId =
  | "llama-3.3-70b-versatile"
  | "moonshotai/kimi-k2-instruct";

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
}

export interface VocabularyAnalysisModelConfig extends BaseModelConfig {
  id: VocabularyAnalysisModelId;
}

// ── Whisper 模型（語音轉錄用）─────────────────────────────

export type WhisperModelId = "whisper-large-v3" | "whisper-large-v3-turbo";

export interface WhisperModelConfig {
  id: WhisperModelId;
  displayName: string;
  costPerHour: number;
  freeQuotaRpd: number;
  freeQuotaAudioSecondsPerDay: number;
  isDefault: boolean;
}

// ── Transcription Provider ─────────────────────────────────
export type TranscriptionProvider = "cloud" | "local";
export const DEFAULT_TRANSCRIPTION_PROVIDER: TranscriptionProvider = "cloud";

// ── 預設值 ────────────────────────────────────────────────

export const DEFAULT_LLM_MODEL_ID: LlmModelId = "qwen/qwen3-32b";
export const DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID: VocabularyAnalysisModelId =
  "llama-3.3-70b-versatile";
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "whisper-large-v3";

// ── 已下架模型 ID 映射（舊 → 新，用於自動遷移）──────────

export const DECOMMISSIONED_MODEL_MAP: Record<string, LlmModelId> = {
  "qwen-qwq-32b": "qwen/qwen3-32b",
  "gpt-oss-120b": "qwen/qwen3-32b",
  "openai/gpt-oss-120b": "qwen/qwen3-32b",
  "openai/gpt-oss-20b": "qwen/qwen3-32b",
  "llama-3.1-8b-instant": "qwen/qwen3-32b",
  "llama-4-scout-17b-16e-instruct": "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-4-maverick-17b-128e-instruct": "qwen/qwen3-32b",
  "meta-llama/llama-4-maverick-17b-128e-instruct": "qwen/qwen3-32b",
};

// ── 模型清單（Groq 2026-03 價格）─────────────────────────

export const LLM_MODEL_LIST: LlmModelConfig[] = [
  {
    id: "qwen/qwen3-32b",
    displayName: "Qwen3 32B",
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 400,
    inputCostPerMillion: 0.29,
    outputCostPerMillion: 0.59,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 500_000,
    isDefault: true,
  },
  {
    id: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B Versatile",
    badgeKey: "settings.modelBadge.stableCostly",
    speedTps: 280,
    inputCostPerMillion: 0.59,
    outputCostPerMillion: 0.79,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 100_000,
    isDefault: false,
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    displayName: "Llama 4 Scout 17B",
    badgeKey: "settings.modelBadge.fastCheap",
    speedTps: 750,
    inputCostPerMillion: 0.11,
    outputCostPerMillion: 0.34,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 500_000,
    isDefault: false,
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    displayName: "Kimi K2 Instruct",
    badgeKey: "settings.modelBadge.smartestSlow",
    speedTps: 200,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 0.4,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 100_000,
    isDefault: false,
  },
];

// ── 字典分析模型清單（指令遵從 + JSON 穩定性優先）──────

export const VOCABULARY_ANALYSIS_MODEL_LIST: VocabularyAnalysisModelConfig[] = [
  {
    id: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B Versatile",
    badgeKey: "settings.modelBadge.balanced",
    speedTps: 280,
    inputCostPerMillion: 0.59,
    outputCostPerMillion: 0.79,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 100_000,
    isDefault: true,
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    displayName: "Kimi K2 Instruct",
    badgeKey: "settings.modelBadge.smartestSlow",
    speedTps: 200,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 0.4,
    freeQuotaRpd: 1_000,
    freeQuotaTpd: 100_000,
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

export function findVocabularyAnalysisModelConfig(
  id: string,
): VocabularyAnalysisModelConfig | undefined {
  return VOCABULARY_ANALYSIS_MODEL_LIST.find((m) => m.id === id);
}

export function findWhisperModelConfig(
  id: string,
): WhisperModelConfig | undefined {
  return WHISPER_MODEL_LIST.find((m) => m.id === id);
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
 * 安全取得字典分析模型 ID：若 savedId 不在 registry 則 fallback 到預設。
 */
export function getEffectiveVocabularyAnalysisModelId(
  savedId: string | null,
): VocabularyAnalysisModelId {
  if (savedId && findVocabularyAnalysisModelConfig(savedId))
    return savedId as VocabularyAnalysisModelId;
  return DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID;
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
