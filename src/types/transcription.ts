import type { TriggerMode } from "./index";

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
}

export interface DashboardStats {
  totalTranscriptions: number;
  totalCharacters: number;
  totalRecordingDurationMs: number;
  estimatedTimeSavedMs: number;
  totalCostCeiling: number;
}

export type ApiType = "whisper" | "chat";

export interface ChatUsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTimeMs: number;
  completionTimeMs: number;
  totalTimeMs: number;
}

export interface EnhanceResult {
  text: string;
  usage: ChatUsageData | null;
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
