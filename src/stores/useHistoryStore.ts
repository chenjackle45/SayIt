import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  TranscriptionRecord,
  DashboardStats,
  DailyQuotaUsage,
  ApiUsageRecord,
  DailyUsageTrend,
  ChatUsageData,
} from "../types/transcription";
import type { TriggerMode } from "../types";
import type { TranscriptionResult } from "../types/audio";
import type { TranscriptionCompletedPayload } from "../types/events";
import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "../lib/database";
import { buildDailyUsageSeries } from "../lib/usageTrend";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import {
  calculateChatCostCeiling,
  calculateWhisperCostCeiling,
} from "../lib/apiPricing";
import {
  enhanceWithAnomalyGuard,
  type EnhanceWithGuardResult,
} from "../lib/enhancer";
import { applyTranscriptTextTransforms } from "../lib/transcriptTextTransforms";
import { detectHallucination } from "../lib/hallucinationDetector";
import { useSettingsStore } from "./useSettingsStore";
import { useVocabularyStore } from "./useVocabularyStore";
import {
  emitToWindow,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";

/** 歷史紀錄重試（重新辨識／重新整理）的結果；errorKey 為 i18n key，供 UI 顯示。 */
type HistoryRetryAction = "transcribe" | "enhance";

export interface HistoryRetryResult {
  ok: boolean;
  record?: TranscriptionRecord;
  errorKey?: string;
}

const PAGE_SIZE = 20;
const USAGE_TREND_DAYS = 14;

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
  audio_file_path: string | null;
  status: string;
  is_edit_mode: number;
  edit_source_text: string | null;
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
    audioFilePath: row.audio_file_path,
    status: row.status as TranscriptionRecord["status"],
    isEditMode: row.is_edit_mode === 1,
    editSourceText: row.edit_source_text,
  };
}

const TRANSCRIPTION_SELECT_COLUMNS = `id, timestamp, raw_text, processed_text,
         recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
         char_count, trigger_mode, was_enhanced, was_modified, created_at,
         audio_file_path, status, is_edit_mode, edit_source_text`;

const INSERT_SQL = `
  INSERT INTO transcriptions (
    id, timestamp, raw_text, processed_text,
    recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
    char_count, trigger_mode, was_enhanced, was_modified,
    audio_file_path, status, is_edit_mode, edit_source_text
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

const SELECT_ALL_SQL = `
  SELECT ${TRANSCRIPTION_SELECT_COLUMNS}
  FROM transcriptions
  ORDER BY timestamp DESC
`;

const SELECT_PAGED_SQL = `
  SELECT ${TRANSCRIPTION_SELECT_COLUMNS}
  FROM transcriptions
  ORDER BY timestamp DESC
  LIMIT $1 OFFSET $2
`;

const SEARCH_PAGED_SQL = `
  SELECT ${TRANSCRIPTION_SELECT_COLUMNS}
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
  WHERE status != 'failed'
`;

const INSERT_API_USAGE_SQL = `
  INSERT INTO api_usage (
    id, transcription_id, api_type, model,
    prompt_tokens, completion_tokens, total_tokens,
    prompt_time_ms, completion_time_ms, total_time_ms,
    audio_duration_ms, estimated_cost_ceiling
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
`;

const DAILY_QUOTA_USAGE_SQL = `
  SELECT
    api_type,
    COUNT(*) as request_count,
    COALESCE(SUM(total_tokens), 0) as total_tokens,
    COALESCE(SUM(MAX(COALESCE(audio_duration_ms, 0), 10000)), 0) as billed_audio_ms
  FROM api_usage
  WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
  GROUP BY api_type
`;

const DAILY_USAGE_TREND_SQL = `
  SELECT
    DATE(datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
    COUNT(*) as count,
    COALESCE(SUM(char_count), 0) as total_chars
  FROM transcriptions
  WHERE timestamp >= $1 AND status != 'failed'
  GROUP BY date
  ORDER BY date DESC
  LIMIT $2
`;

const UPDATE_ON_RETRY_SUCCESS_SQL = `
  UPDATE transcriptions
  SET status = 'success',
      raw_text = $1,
      processed_text = $2,
      transcription_duration_ms = $3,
      enhancement_duration_ms = $4,
      was_enhanced = $5,
      char_count = $6
  WHERE id = $7
`;

const UPDATE_ON_RETRANSCRIBE_SQL = `
  UPDATE transcriptions
  SET status = 'success',
      raw_text = $1,
      processed_text = NULL,
      transcription_duration_ms = $2,
      enhancement_duration_ms = NULL,
      was_enhanced = 0,
      was_modified = NULL,
      char_count = $3
  WHERE id = $4 AND raw_text = $5
`;

const UPDATE_ON_REENHANCE_SQL = `
  UPDATE transcriptions
  SET processed_text = $1,
      was_enhanced = 1,
      enhancement_duration_ms = $2
  WHERE id = $3 AND raw_text = $4
`;

const DELETE_API_USAGE_BY_TRANSCRIPTION_SQL = `
  DELETE FROM api_usage WHERE transcription_id = $1
`;

const DELETE_TRANSCRIPTION_SQL = `
  DELETE FROM transcriptions WHERE id = $1
`;

const SELECT_RECENT_SQL = `
  SELECT ${TRANSCRIPTION_SELECT_COLUMNS}
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

interface DailyQuotaUsageRow {
  api_type: string;
  request_count: number;
  total_tokens: number;
  billed_audio_ms: number;
}

interface DailyUsageTrendRow {
  date: string;
  count: number;
  total_chars: number;
}

export const useHistoryStore = defineStore("history", () => {
  const transcriptionList = ref<TranscriptionRecord[]>([]);
  const isLoading = ref(false);
  // 歷史重試鎖：整個 Dashboard 同時只允許一筆重試在途。放在 store 而非頁面，
  // 離開歷史頁再回來（元件重建）不會失去鎖，避免同筆重複送出、舊結果覆蓋新結果。
  const retryingId = ref<string | null>(null);
  const retryingAction = ref<HistoryRetryAction | null>(null);

  function acquireRetryLock(id: string, action: HistoryRetryAction): boolean {
    if (retryingId.value) return false;
    retryingId.value = id;
    retryingAction.value = action;
    return true;
  }

  function releaseRetryLock(): void {
    retryingId.value = null;
    retryingAction.value = null;
  }
  const searchQuery = ref("");
  const hasMore = ref(true);
  const currentOffset = ref(0);

  async function fetchTranscriptionList() {
    isLoading.value = true;
    try {
      const db = getDatabase();
      const rows = await db.select<RawTranscriptionRow[]>(SELECT_ALL_SQL);
      transcriptionList.value = rows.map(mapRowToRecord);
    } catch (err) {
      console.error(
        `[useHistoryStore] fetchTranscriptionList failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "history", step: "fetch" });
      throw err;
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
    try {
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
        record.audioFilePath,
        record.status,
        record.isEditMode ? 1 : 0,
        record.editSourceText,
      ]);
    } catch (err) {
      console.error(
        `[useHistoryStore] addTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "history", step: "add" });
      throw err;
    }

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
      captureError(emitErr, { source: "history", step: "add-emit" });
    }
  }

  const dashboardStats = ref<DashboardStats>({
    totalTranscriptions: 0,
    totalCharacters: 0,
    totalRecordingDurationMs: 0,
    estimatedTimeSavedMs: 0,
    dailyQuotaUsage: {
      whisperRequestCount: 0,
      whisperBilledAudioMs: 0,
      llmRequestCount: 0,
      llmTotalTokens: 0,
      vocabularyAnalysisRequestCount: 0,
      vocabularyAnalysisTotalTokens: 0,
    },
  });
  const recentTranscriptionList = ref<TranscriptionRecord[]>([]);
  const dailyUsageTrendList = ref<DailyUsageTrend[]>([]);

  async function fetchDashboardStats(): Promise<DashboardStats> {
    const db = getDatabase();
    const [statsRows, dailyQuotaUsage] = await Promise.all([
      db.select<DashboardStatsRow[]>(DASHBOARD_STATS_SQL),
      fetchDailyQuotaUsage(),
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
      estimatedTimeSavedMs: Math.max(
        0,
        Math.round(
          (row.total_characters / ASSUMED_TYPING_SPEED_CHARS_PER_MIN) * 60000,
        ) - row.total_recording_duration_ms,
      ),
      dailyQuotaUsage,
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

  async function fetchDailyQuotaUsage(): Promise<DailyQuotaUsage> {
    const db = getDatabase();
    const rows = await db.select<DailyQuotaUsageRow[]>(DAILY_QUOTA_USAGE_SQL);

    const result: DailyQuotaUsage = {
      whisperRequestCount: 0,
      whisperBilledAudioMs: 0,
      llmRequestCount: 0,
      llmTotalTokens: 0,
      vocabularyAnalysisRequestCount: 0,
      vocabularyAnalysisTotalTokens: 0,
    };

    for (const row of rows) {
      if (row.api_type === "whisper") {
        result.whisperRequestCount = row.request_count;
        result.whisperBilledAudioMs = row.billed_audio_ms;
      } else if (row.api_type === "chat") {
        result.llmRequestCount = row.request_count;
        result.llmTotalTokens = row.total_tokens;
      } else if (row.api_type === "vocabulary_analysis") {
        result.vocabularyAnalysisRequestCount = row.request_count;
        result.vocabularyAnalysisTotalTokens = row.total_tokens;
      }
    }

    return result;
  }

  async function fetchDailyUsageTrend(
    days = USAGE_TREND_DAYS,
  ): Promise<DailyUsageTrend[]> {
    const db = getDatabase();
    // SQL 查詢窗口必須與 buildDailyUsageSeries 的補零窗口對齊（同一個本地日曆區間），
    // 否則落在「滾動 24h cutoff 但日曆區間外」的記錄會被 SQL 撈到卻被補零丟棄。
    const endDate = new Date();
    const startDate = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate() - days + 1,
    );
    const rows = await db.select<DailyUsageTrendRow[]>(DAILY_USAGE_TREND_SQL, [
      startDate.getTime(),
      days,
    ]);
    const mapped = rows.map((row) => ({
      date: row.date,
      count: row.count,
      totalChars: row.total_chars,
    }));
    return buildDailyUsageSeries(mapped, days, endDate);
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
    } else {
      captureError(results[0].reason, {
        source: "history",
        step: "fetch-stats",
      });
    }
    if (results[1].status === "fulfilled") {
      recentTranscriptionList.value = results[1].value;
    } else {
      captureError(results[1].reason, {
        source: "history",
        step: "fetch-recent",
      });
    }
    if (results[2].status === "fulfilled") {
      dailyUsageTrendList.value = results[2].value;
    } else {
      captureError(results[2].reason, {
        source: "history",
        step: "fetch-trend",
      });
    }
  }

  async function clearAllAudioFilePath(): Promise<void> {
    const db = getDatabase();
    await db.execute(
      "UPDATE transcriptions SET audio_file_path = NULL WHERE audio_file_path IS NOT NULL",
    );
  }

  async function clearAudioFilePathByIdList(idList: string[]): Promise<void> {
    if (idList.length === 0) return;
    const db = getDatabase();
    const placeholders = idList.map((_, i) => `$${i + 1}`).join(", ");
    await db.execute(
      `UPDATE transcriptions SET audio_file_path = NULL WHERE id IN (${placeholders})`,
      idList,
    );
  }

  async function updateTranscriptionOnRetrySuccess(params: {
    id: string;
    rawText: string;
    processedText: string | null;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
    charCount: number;
  }): Promise<void> {
    const db = getDatabase();
    try {
      await db.execute(UPDATE_ON_RETRY_SUCCESS_SQL, [
        params.rawText,
        params.processedText,
        params.transcriptionDurationMs,
        params.enhancementDurationMs,
        params.wasEnhanced ? 1 : 0,
        params.charCount,
        params.id,
      ]);
    } catch (err) {
      console.error(
        `[useHistoryStore] updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "history", step: "update-retry-success" });
      throw err;
    }

    try {
      const payload: TranscriptionCompletedPayload = {
        id: params.id,
        rawText: params.rawText,
        processedText: params.processedText,
        recordingDurationMs: 0,
        transcriptionDurationMs: params.transcriptionDurationMs,
        enhancementDurationMs: params.enhancementDurationMs,
        charCount: params.charCount,
        wasEnhanced: params.wasEnhanced,
      };
      await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
    } catch (emitErr) {
      console.error(
        "[useHistoryStore] emitToWindow failed (UPDATE succeeded):",
        emitErr,
      );
      captureError(emitErr, { source: "history", step: "update-retry-emit" });
    }
  }

  async function deleteTranscription(id: string): Promise<void> {
    const db = getDatabase();
    try {
      await db.execute(DELETE_API_USAGE_BY_TRANSCRIPTION_SQL, [id]);
      await db.execute(DELETE_TRANSCRIPTION_SQL, [id]);
      transcriptionList.value = transcriptionList.value.filter(
        (r) => r.id !== id,
      );
    } catch (err) {
      console.error(
        `[useHistoryStore] deleteTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "history", step: "delete" });
      throw err;
    }
  }

  async function deleteAllRecordingFiles(): Promise<number> {
    const deletedCount = await invoke<number>("delete_all_recordings");
    await clearAllAudioFilePath();
    return deletedCount;
  }

  function applyLocalRecordUpdate(
    id: string,
    patch: Partial<TranscriptionRecord>,
  ): TranscriptionRecord | undefined {
    const target = transcriptionList.value.find((r) => r.id === id);
    if (!target) return undefined;
    const updated: TranscriptionRecord = { ...target, ...patch };
    transcriptionList.value = transcriptionList.value.map((r) =>
      r.id === id ? updated : r,
    );
    return updated;
  }

  function recordWhisperUsage(
    transcriptionId: string,
    audioDurationMs: number,
    model: string,
  ): void {
    void addApiUsage({
      id: crypto.randomUUID(),
      transcriptionId,
      apiType: "whisper",
      model,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(audioDurationMs, model),
    }).catch((err) =>
      captureError(err, { source: "history", step: "retranscribe-usage" }),
    );
  }

  function recordChatUsage(
    transcriptionId: string,
    usage: ChatUsageData | null,
    model: string,
  ): void {
    if (!usage) return;
    void addApiUsage({
      id: crypto.randomUUID(),
      transcriptionId,
      apiType: "chat",
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      promptTimeMs: usage.promptTimeMs ?? null,
      completionTimeMs: usage.completionTimeMs ?? null,
      totalTimeMs: usage.totalTimeMs ?? null,
      audioDurationMs: null,
      estimatedCostCeiling: calculateChatCostCeiling(usage.totalTokens, model),
    }).catch((err) =>
      captureError(err, { source: "history", step: "reenhance-usage" }),
    );
  }

  /**
   * 歷史紀錄「重新辨識」：以保存的錄音檔重送轉錄。成功即把該筆 failed → success
   * 並清空整理結果（等待使用者另行「重新整理」）。只更新該筆，不貼上、不碰 HUD 狀態機。
   */
  async function retranscribeRecord(
    record: TranscriptionRecord,
  ): Promise<HistoryRetryResult> {
    if (!record.audioFilePath) {
      return { ok: false, errorKey: "history.noRecordingFile" };
    }
    // 編輯模式記錄：rawText 是語音指令、processedText 是編輯結果；重新辨識會把
    // 編輯結果清空、只剩指令文字。與「重新整理」同樣在任何 API/DB 動作前擋下。
    if (record.isEditMode) {
      return { ok: false, errorKey: "history.retranscribeFailed" };
    }
    if (!acquireRetryLock(record.id, "transcribe")) {
      return { ok: false, errorKey: "history.retranscribeFailed" };
    }
    try {
      return await retranscribeRecordUnlocked(record);
    } catch (err) {
      captureError(err, { source: "history", step: "retranscribe" });
      return { ok: false, errorKey: "history.retranscribeFailed" };
    } finally {
      releaseRetryLock();
    }
  }

  async function retranscribeRecordUnlocked(
    record: TranscriptionRecord,
  ): Promise<HistoryRetryResult> {
    const settingsStore = useSettingsStore();
    const vocabularyStore = useVocabularyStore();

    if (!settingsStore.getApiKey()) {
      await settingsStore.refreshApiKey();
    }
    const apiKey = settingsStore.getApiKey();
    if (!apiKey) {
      return { ok: false, errorKey: "errors.apiKeyMissing" };
    }

    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    const model = settingsStore.selectedWhisperModelId;

    let result: TranscriptionResult;
    try {
      result = await invoke<TranscriptionResult>("retranscribe_from_file", {
        filePath: record.audioFilePath,
        apiKey,
        vocabularyTermList:
          whisperTermList.length > 0 ? whisperTermList : null,
        modelId: model,
        language: settingsStore.getWhisperLanguageCode(),
      });
    } catch (err) {
      captureError(err, { source: "history", step: "retranscribe-invoke" });
      return { ok: false, errorKey: "history.retranscribeFailed" };
    }

    // #39：轉譯語言為繁中時，把 Whisper 的簡體輸出轉成繁體（與即時流程一致，落地前一次到位）。
    // 與主路徑同樣在 raw_text 寫入 DB 前套用，涵蓋空轉錄/幻覺偵測、charCount 與本地更新。
    const transcriptionLocale = settingsStore.selectedTranscriptionLocale;
    const effectiveLocale =
      transcriptionLocale === "auto"
        ? settingsStore.selectedLocale
        : transcriptionLocale;
    result.rawText = applyTranscriptTextTransforms(
      result.rawText,
      effectiveLocale,
    );

    // HTTP 成功即計費（不論轉錄內容）→ 記錄 whisper 用量
    recordWhisperUsage(record.id, record.recordingDurationMs, model);

    // 空轉錄或幻覺 → 保留 failed、不覆寫原文
    const isEmpty = !result.rawText || !result.rawText.trim();
    // 時長未知/非正時跳過語速異常層（無法判斷語速），仍保留能量/NSP 偵測
    const recordingDurationForDetection =
      record.recordingDurationMs > 0
        ? record.recordingDurationMs
        : Number.MAX_SAFE_INTEGER;
    const hallucination = detectHallucination({
      rawText: result.rawText,
      recordingDurationMs: recordingDurationForDetection,
      peakEnergyLevel: result.peakEnergyLevel,
      rmsEnergyLevel: result.rmsEnergyLevel,
      noSpeechProbability: result.noSpeechProbability,
    });
    if (isEmpty || hallucination.isHallucination) {
      return { ok: false, errorKey: "history.retranscribeFailed" };
    }

    const charCount = result.rawText.length;
    const transcriptionDurationMs = Math.round(result.transcriptionDurationMs);

    const db = getDatabase();
    const res = await db.execute(UPDATE_ON_RETRANSCRIBE_SQL, [
      result.rawText,
      transcriptionDurationMs,
      charCount,
      record.id,
      record.rawText,
    ]);
    if (!res?.rowsAffected) {
      // 樂觀鎖：紀錄已被刪除或 raw_text 已被並行修改 → 放棄，不覆寫
      return { ok: false, errorKey: "history.retranscribeFailed" };
    }

    const updated = applyLocalRecordUpdate(record.id, {
      status: "success",
      rawText: result.rawText,
      processedText: null,
      wasEnhanced: false,
      wasModified: null,
      transcriptionDurationMs,
      enhancementDurationMs: null,
      charCount,
    });
    return { ok: true, record: updated };
  }

  /**
   * 歷史紀錄「重新整理」：用既有原文重跑 AI 校對，套用與即時流程相同的長度爆炸防護。
   * 成功則寫入 processed_text 並標記 was_enhanced。只更新該筆，不貼上、不碰 HUD 狀態機。
   */
  async function reEnhanceRecord(
    record: TranscriptionRecord,
  ): Promise<HistoryRetryResult> {
    if (!record.rawText.trim()) {
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }

    // 編輯模式記錄：rawText 是語音指令、processedText 是編輯結果；
    // 「重新整理」會把編輯結果覆寫成清理過的指令文字。UI 已停用該按鈕，
    // 此處為防繞過 UI 直呼 store 的守衛——在任何 API/DB 動作前就擋下。
    if (record.isEditMode) {
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }
    if (!acquireRetryLock(record.id, "enhance")) {
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }
    try {
      return await reEnhanceRecordUnlocked(record);
    } catch (err) {
      captureError(err, { source: "history", step: "reenhance" });
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    } finally {
      releaseRetryLock();
    }
  }

  async function reEnhanceRecordUnlocked(
    record: TranscriptionRecord,
  ): Promise<HistoryRetryResult> {
    const settingsStore = useSettingsStore();
    const vocabularyStore = useVocabularyStore();

    await settingsStore.refreshLlmApiKey();
    const llmApiKey = settingsStore.getLlmApiKey();
    if (!llmApiKey) {
      return { ok: false, errorKey: "errors.apiKeyMissing" };
    }

    const termList = await vocabularyStore.getTopTermListByWeight(50);
    const startTime = performance.now();

    let enhanceResult: EnhanceWithGuardResult;
    try {
      enhanceResult = await enhanceWithAnomalyGuard(
        record.rawText,
        llmApiKey,
        {
          systemPrompt: settingsStore.getAiPrompt(),
          vocabularyTermList: termList.length > 0 ? termList : undefined,
          modelId: settingsStore.selectedLlmModelId,
        },
      );
    } catch (err) {
      captureError(err, { source: "history", step: "reenhance" });
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }

    const enhancementDurationMs = Math.round(performance.now() - startTime);

    // API 已呼叫（即使 anomaly fallback）→ 記錄 chat 用量
    recordChatUsage(
      record.id,
      enhanceResult.usage,
      settingsStore.selectedLlmModelId,
    );

    // 空回應（LLM 回空、enhanceText 退回原文）→ 不是整理結果，保留既有 processed_text
    if (enhanceResult.wasAnomalous || enhanceResult.wasEmptyResponse) {
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }

    // #43 語意飄移守衛：整理結果與原文 bigram 重疊過低（疑似答非所問）→
    // 拒絕並保留既有結果、不覆寫 DB，並以 reEnhanceDrift 訊息提示使用者。
    if (enhanceResult.wasDrift) {
      return { ok: false, errorKey: "history.reEnhanceDrift" };
    }

    const db = getDatabase();
    const res = await db.execute(UPDATE_ON_REENHANCE_SQL, [
      enhanceResult.text,
      enhancementDurationMs,
      record.id,
      record.rawText,
    ]);
    if (!res?.rowsAffected) {
      // 樂觀鎖：紀錄已被刪除或 raw_text 已被並行修改（整理結果基於舊原文）→ 放棄
      return { ok: false, errorKey: "history.reEnhanceFailed" };
    }

    const updated = applyLocalRecordUpdate(record.id, {
      processedText: enhanceResult.text,
      wasEnhanced: true,
      enhancementDurationMs,
    });
    return { ok: true, record: updated };
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
    usageTrendDays: USAGE_TREND_DAYS,
    fetchTranscriptionList,
    searchTranscriptionList,
    resetAndFetch,
    loadMore,
    addTranscription,
    updateTranscriptionOnRetrySuccess,
    addApiUsage,
    fetchDashboardStats,
    fetchRecentTranscriptionList,
    refreshDashboard,
    clearAllAudioFilePath,
    clearAudioFilePathByIdList,
    deleteTranscription,
    deleteAllRecordingFiles,
    retryingId,
    retryingAction,
    retranscribeRecord,
    reEnhanceRecord,
  };
});
