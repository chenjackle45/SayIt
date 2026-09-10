import type { TriggerMode } from "./index";

export type TranscriptionStatus = "success" | "failed";

export interface TranscriptionRecord {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  charCount: number;
  triggerMode: TriggerMode;
  wasEnhanced: boolean;
  wasModified: boolean | null;
  createdAt: string;
  audioFilePath: string | null;
  status: TranscriptionStatus;
  isEditMode: boolean;
  editSourceText: string | null;
}

export interface DailyQuotaUsage {
  whisperRequestCount: number;
  whisperBilledAudioMs: number;
  llmRequestCount: number;
  llmTotalTokens: number;
  vocabularyAnalysisRequestCount: number;
  vocabularyAnalysisTotalTokens: number;
}

export interface DashboardStats {
  totalTranscriptions: number;
  totalCharacters: number;
  totalRecordingDurationMs: number;
  estimatedTimeSavedMs: number;
  dailyQuotaUsage: DailyQuotaUsage;
}

export type ApiType = "whisper" | "chat" | "vocabulary_analysis";

export interface ChatUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs?: number;
  completionTimeMs?: number;
  totalTimeMs?: number;
}

export interface EnhanceResult {
  text: string;
  usage: ChatUsageData | null;
  /** true 表示 LLM 回了空內容、text 是退回的原文（不是真正的整理結果）。 */
  isRawFallback?: boolean;
}

export interface ApiUsageRecord {
  id: string;
  transcriptionId: string;
  apiType: ApiType;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptTimeMs: number | null;
  completionTimeMs: number | null;
  totalTimeMs: number | null;
  audioDurationMs: number | null;
  estimatedCostCeiling: number;
}

export interface DailyUsageTrend {
  date: string;
  count: number;
  totalChars: number;
}
