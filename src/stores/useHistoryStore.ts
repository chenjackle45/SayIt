import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  TranscriptionRecord,
  DashboardStats,
  ApiUsageRecord,
  DailyUsageTrend,
} from "../types/transcription";
import type { TriggerMode } from "../types";
import type { TranscriptionCompletedPayload } from "../types/events";
import { getDatabase } from "../lib/database";
import {
  emitToWindow,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";

const PAGE_SIZE = 20;

interface RawTranscriptionRow {
  id: string;
  timestamp: number;
  raw_text: string;
  processed_text: string | null;
  recording_duration_ms: number;
  transcription_duration_ms: number;
  enhancement_duration_ms: number | null;
  char_count: number;
  trigger_mode: string;
  was_enhanced: number;
  was_modified: number | null;
  created_at: string;
}

function mapRowToRecord(row: RawTranscriptionRow): TranscriptionRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    rawText: row.raw_text,
    processedText: row.processed_text,
    recordingDurationMs: row.recording_duration_ms,
    transcriptionDurationMs: row.transcription_duration_ms,
    enhancementDurationMs: row.enhancement_duration_ms,
    charCount: row.char_count,
    triggerMode: row.trigger_mode as TriggerMode,
    wasEnhanced: row.was_enhanced === 1,
    wasModified: row.was_modified === null ? null : row.was_modified === 1,
    createdAt: row.created_at,
  };
}

const INSERT_SQL = `
  INSERT INTO transcriptions (
    id, timestamp, raw_text, processed_text,
    recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
    char_count, trigger_mode, was_enhanced, was_modified
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

const SELECT_ALL_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, was_enhanced, was_modified, created_at
  FROM transcriptions
  ORDER BY timestamp DESC
`;

const SELECT_PAGED_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, was_enhanced, was_modified, created_at
  FROM transcriptions
  ORDER BY timestamp DESC
  LIMIT $1 OFFSET $2
`;

const SEARCH_PAGED_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, was_enhanced, was_modified, created_at
  FROM transcriptions
  WHERE raw_text LIKE $1 ESCAPE '\\' OR processed_text LIKE $1 ESCAPE '\\'
  ORDER BY timestamp DESC
  LIMIT $2 OFFSET $3
`;

const DASHBOARD_STATS_SQL = `
  SELECT
    COUNT(*) as total_count,
    COALESCE(SUM(char_count), 0) as total_characters,
    COALESCE(SUM(recording_duration_ms), 0) as total_recording_duration_ms
  FROM transcriptions
`;

const INSERT_API_USAGE_SQL = `
  INSERT INTO api_usage (
    id, transcription_id, api_type, model,
    prompt_tokens, completion_tokens, total_tokens,
    prompt_time_ms, completion_time_ms, total_time_ms,
    audio_duration_ms, estimated_cost_ceiling
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`;

const TOTAL_COST_CEILING_SQL = `
  SELECT COALESCE(SUM(estimated_cost_ceiling), 0) as total_cost_ceiling FROM api_usage
`;

const DAILY_USAGE_TREND_SQL = `
  SELECT
    DATE(datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
    COUNT(*) as count,
    COALESCE(SUM(char_count), 0) as total_chars
  FROM transcriptions
  WHERE timestamp >= $1
  GROUP BY date
  ORDER BY date DESC
  LIMIT $2
`;

const SELECT_RECENT_SQL = `
  SELECT id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, was_enhanced, was_modified, created_at
  FROM transcriptions
  ORDER BY timestamp DESC
  LIMIT $1
`;

const ASSUMED_TYPING_SPEED_CHARS_PER_MIN = 40;

interface DashboardStatsRow {
  total_count: number;
  total_characters: number;
  total_recording_duration_ms: number;
}

interface TotalCostCeilingRow {
  total_cost_ceiling: number;
}

interface DailyUsageTrendRow {
  date: string;
  count: number;
  total_chars: number;
}

export const useHistoryStore = defineStore("history", () => {
  const transcriptionList = ref<TranscriptionRecord[]>([]);
  const isLoading = ref(false);
  const searchQuery = ref("");
  const hasMore = ref(true);
  const currentOffset = ref(0);

  async function fetchTranscriptionList() {
    isLoading.value = true;
    try {
      const db = getDatabase();
      const rows = await db.select<RawTranscriptionRow[]>(SELECT_ALL_SQL);
      transcriptionList.value = rows.map(mapRowToRecord);
    } finally {
      isLoading.value = false;
    }
  }

  async function searchTranscriptionList(
    query: string,
    limit = PAGE_SIZE,
    offset = 0,
  ): Promise<TranscriptionRecord[]> {
    const db = getDatabase();
    let rows: RawTranscriptionRow[];

    if (query.trim()) {
      const escaped = query.trim().replace(/[%_\\]/g, "\\$&");
      const pattern = `%${escaped}%`;
      rows = await db.select<RawTranscriptionRow[]>(SEARCH_PAGED_SQL, [
        pattern,
        limit,
        offset,
      ]);
    } else {
      rows = await db.select<RawTranscriptionRow[]>(SELECT_PAGED_SQL, [
        limit,
        offset,
      ]);
    }

    return rows.map(mapRowToRecord);
  }

  async function resetAndFetch() {
    isLoading.value = true;
    try {
      currentOffset.value = 0;
      hasMore.value = true;
      const results = await searchTranscriptionList(
        searchQuery.value,
        PAGE_SIZE,
        0,
      );
      transcriptionList.value = results;
      currentOffset.value = results.length;
      hasMore.value = results.length >= PAGE_SIZE;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value) return;
    isLoading.value = true;
    try {
      const results = await searchTranscriptionList(
        searchQuery.value,
        PAGE_SIZE,
        currentOffset.value,
      );
      transcriptionList.value.push(...results);
      currentOffset.value += results.length;
      hasMore.value = results.length >= PAGE_SIZE;
    } finally {
      isLoading.value = false;
    }
  }

  async function addTranscription(record: TranscriptionRecord) {
    const db = getDatabase();
    await db.execute(INSERT_SQL, [
      record.id,
      record.timestamp,
      record.rawText,
      record.processedText,
      record.recordingDurationMs,
      record.transcriptionDurationMs,
      record.enhancementDurationMs,
      record.charCount,
      record.triggerMode,
      record.wasEnhanced ? 1 : 0,
      record.wasModified === null ? null : record.wasModified ? 1 : 0,
    ]);

    try {
      const payload: TranscriptionCompletedPayload = {
        id: record.id,
        rawText: record.rawText,
        processedText: record.processedText,
        recordingDurationMs: record.recordingDurationMs,
        transcriptionDurationMs: record.transcriptionDurationMs,
        enhancementDurationMs: record.enhancementDurationMs,
        charCount: record.charCount,
        wasEnhanced: record.wasEnhanced,
      };
      await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
    } catch (emitErr) {
      console.error(
        "[useHistoryStore] emitToWindow failed (INSERT succeeded):",
        emitErr,
      );
    }
  }

  const dashboardStats = ref<DashboardStats>({
    totalTranscriptions: 0,
    totalCharacters: 0,
    totalRecordingDurationMs: 0,
    estimatedTimeSavedMs: 0,
    totalCostCeiling: 0,
  });
  const recentTranscriptionList = ref<TranscriptionRecord[]>([]);
  const dailyUsageTrendList = ref<DailyUsageTrend[]>([]);

  async function fetchDashboardStats(): Promise<DashboardStats> {
    const db = getDatabase();
    const [statsRows, costCeiling] = await Promise.all([
      db.select<DashboardStatsRow[]>(DASHBOARD_STATS_SQL),
      fetchTotalCostCeiling(),
    ]);
    const row = statsRows[0] ?? {
      total_count: 0,
      total_characters: 0,
      total_recording_duration_ms: 0,
    };

    return {
      totalTranscriptions: row.total_count,
      totalCharacters: row.total_characters,
      totalRecordingDurationMs: row.total_recording_duration_ms,
      estimatedTimeSavedMs: Math.round(
        (row.total_characters / ASSUMED_TYPING_SPEED_CHARS_PER_MIN) * 60000,
      ),
      totalCostCeiling: costCeiling,
    };
  }

  async function addApiUsage(record: ApiUsageRecord): Promise<void> {
    const db = getDatabase();
    await db.execute(INSERT_API_USAGE_SQL, [
      record.id,
      record.transcriptionId,
      record.apiType,
      record.model,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.promptTimeMs,
      record.completionTimeMs,
      record.totalTimeMs,
      record.audioDurationMs,
      record.estimatedCostCeiling,
    ]);
  }

  async function fetchTotalCostCeiling(): Promise<number> {
    const db = getDatabase();
    const rows = await db.select<TotalCostCeilingRow[]>(TOTAL_COST_CEILING_SQL);
    return rows[0]?.total_cost_ceiling ?? 0;
  }

  async function fetchDailyUsageTrend(days = 30): Promise<DailyUsageTrend[]> {
    const db = getDatabase();
    const cutoffTimestamp = Date.now() - days * 86_400_000;
    const rows = await db.select<DailyUsageTrendRow[]>(DAILY_USAGE_TREND_SQL, [
      cutoffTimestamp,
      days,
    ]);
    return rows.map((row) => ({
      date: row.date,
      count: row.count,
      totalChars: row.total_chars,
    }));
  }

  async function fetchRecentTranscriptionList(
    limit = 10,
  ): Promise<TranscriptionRecord[]> {
    const db = getDatabase();
    const rows = await db.select<RawTranscriptionRow[]>(SELECT_RECENT_SQL, [
      limit,
    ]);
    return rows.map(mapRowToRecord);
  }

  async function refreshDashboard() {
    const results = await Promise.allSettled([
      fetchDashboardStats(),
      fetchRecentTranscriptionList(10),
      fetchDailyUsageTrend(),
    ]);
    if (results[0].status === "fulfilled") {
      dashboardStats.value = results[0].value;
    }
    if (results[1].status === "fulfilled") {
      recentTranscriptionList.value = results[1].value;
    }
    if (results[2].status === "fulfilled") {
      dailyUsageTrendList.value = results[2].value;
    }
  }

  return {
    transcriptionList,
    isLoading,
    searchQuery,
    hasMore,
    currentOffset,
    dashboardStats,
    recentTranscriptionList,
    dailyUsageTrendList,
    fetchTranscriptionList,
    searchTranscriptionList,
    resetAndFetch,
    loadMore,
    addTranscription,
    addApiUsage,
    fetchDashboardStats,
    fetchRecentTranscriptionList,
    refreshDashboard,
  };
});
