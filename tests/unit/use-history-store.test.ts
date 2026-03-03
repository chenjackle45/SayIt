import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { TranscriptionRecord } from "../../src/types/transcription";

const mockDbExecute = vi.fn().mockResolvedValue(undefined);
const mockDbSelect = vi.fn().mockResolvedValue([]);
const mockEmitTo = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: mockEmitTo,
}));

function createTestRecord(
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord {
  return {
    id: "test-uuid-001",
    timestamp: 1700000000000,
    rawText: "測試原始文字",
    processedText: null,
    recordingDurationMs: 2500,
    transcriptionDurationMs: 320,
    enhancementDurationMs: null,
    charCount: 6,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    ...overrides,
  };
}

function createRawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "uuid-1",
    timestamp: 1700000000000,
    raw_text: "原始文字",
    processed_text: null,
    recording_duration_ms: 2500,
    transcription_duration_ms: 320,
    enhancement_duration_ms: null,
    char_count: 4,
    trigger_mode: "hold",
    was_enhanced: 0,
    was_modified: null,
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("useHistoryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockDbExecute.mockClear().mockResolvedValue(undefined);
    mockDbSelect.mockClear().mockResolvedValue([]);
    mockEmitTo.mockClear().mockResolvedValue(undefined);
  });

  // ==========================================================================
  // addTranscription
  // ==========================================================================

  describe("addTranscription", () => {
    it("[P0] 應執行 SQL INSERT 並將 boolean 轉為 INTEGER", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({
        wasEnhanced: true,
        wasModified: null,
      });

      await store.addTranscription(record);

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO transcriptions");
      expect(params).toEqual([
        record.id,
        record.timestamp,
        record.rawText,
        record.processedText,
        record.recordingDurationMs,
        record.transcriptionDurationMs,
        record.enhancementDurationMs,
        record.charCount,
        record.triggerMode,
        1, // wasEnhanced: true → 1
        null, // wasModified: null → null
      ]);
    });

    it("[P0] wasEnhanced=false 應轉為 0", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasEnhanced: false });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[9]).toBe(0);
    });

    it("[P0] wasModified=true 應轉為 1", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasModified: true });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[10]).toBe(1);
    });

    it("[P0] wasModified=false 應轉為 0", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({ wasModified: false });
      await store.addTranscription(record);

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[10]).toBe(0);
    });

    it("[P0] INSERT 成功後應發送 transcription:completed 事件至 main-window", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord({
        processedText: "整理後文字",
        wasEnhanced: true,
        enhancementDurationMs: 150,
      });
      await store.addTranscription(record);

      expect(mockEmitTo).toHaveBeenCalledTimes(1);
      expect(mockEmitTo).toHaveBeenCalledWith(
        "main-window",
        "transcription:completed",
        {
          id: record.id,
          rawText: record.rawText,
          processedText: "整理後文字",
          recordingDurationMs: record.recordingDurationMs,
          transcriptionDurationMs: record.transcriptionDurationMs,
          enhancementDurationMs: 150,
          charCount: record.charCount,
          wasEnhanced: true,
        },
      );
    });

    it("[P0] SQL INSERT 失敗應拋出錯誤", async () => {
      mockDbExecute.mockRejectedValueOnce(new Error("SQLITE_CONSTRAINT"));

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const record = createTestRecord();
      await expect(store.addTranscription(record)).rejects.toThrow(
        "SQLITE_CONSTRAINT",
      );
    });
  });

  // ==========================================================================
  // fetchTranscriptionList
  // ==========================================================================

  describe("fetchTranscriptionList", () => {
    it("[P0] 應從 SQLite 載入記錄並映射 snake_case → camelCase", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          id: "uuid-1",
          timestamp: 1700000000000,
          raw_text: "原始文字",
          processed_text: "整理後文字",
          recording_duration_ms: 2500,
          transcription_duration_ms: 320,
          enhancement_duration_ms: 150,
          char_count: 5,
          trigger_mode: "hold",
          was_enhanced: 1,
          was_modified: 0,
          created_at: "2026-01-01 00:00:00",
        },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      expect(store.transcriptionList).toHaveLength(1);
      const record = store.transcriptionList[0];
      expect(record.id).toBe("uuid-1");
      expect(record.rawText).toBe("原始文字");
      expect(record.processedText).toBe("整理後文字");
      expect(record.recordingDurationMs).toBe(2500);
      expect(record.transcriptionDurationMs).toBe(320);
      expect(record.enhancementDurationMs).toBe(150);
      expect(record.charCount).toBe(5);
      expect(record.triggerMode).toBe("hold");
      expect(record.wasEnhanced).toBe(true);
      expect(record.wasModified).toBe(false);
      expect(record.createdAt).toBe("2026-01-01 00:00:00");
    });

    it("[P0] was_enhanced=0 應映射為 false", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          id: "uuid-2",
          timestamp: 1700000000000,
          raw_text: "文字",
          processed_text: null,
          recording_duration_ms: 1000,
          transcription_duration_ms: 200,
          enhancement_duration_ms: null,
          char_count: 2,
          trigger_mode: "toggle",
          was_enhanced: 0,
          was_modified: null,
          created_at: "2026-01-02 00:00:00",
        },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      const record = store.transcriptionList[0];
      expect(record.wasEnhanced).toBe(false);
      expect(record.wasModified).toBeNull();
      expect(record.processedText).toBeNull();
      expect(record.enhancementDurationMs).toBeNull();
      expect(record.triggerMode).toBe("toggle");
    });

    it("[P0] SELECT SQL 應包含 ORDER BY timestamp DESC", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchTranscriptionList();

      const sql = mockDbSelect.mock.calls[0][0] as string;
      expect(sql).toContain("ORDER BY timestamp DESC");
    });

    it("[P0] 載入中應設定 isLoading 為 true，完成後為 false", async () => {
      let resolveSelect!: (value: unknown[]) => void;
      mockDbSelect.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSelect = resolve;
        }),
      );

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const fetchPromise = store.fetchTranscriptionList();
      expect(store.isLoading).toBe(true);

      resolveSelect([]);
      await fetchPromise;
      expect(store.isLoading).toBe(false);
    });

    it("[P0] SELECT 失敗後 isLoading 應回復為 false", async () => {
      mockDbSelect.mockRejectedValueOnce(new Error("DB error"));

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await expect(store.fetchTranscriptionList()).rejects.toThrow("DB error");
      expect(store.isLoading).toBe(false);
    });
  });

  // ==========================================================================
  // fetchDashboardStats
  // ==========================================================================

  describe("fetchDashboardStats", () => {
    it("[P0] 無記錄時應回傳零值統計", async () => {
      // DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 0,
          total_characters: 0,
          total_recording_duration_ms: 0,
        },
      ]);
      // TOTAL_COST_CEILING_SQL
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0 }]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const stats = await store.fetchDashboardStats();

      expect(stats.totalTranscriptions).toBe(0);
      expect(stats.totalCharacters).toBe(0);
      expect(stats.totalRecordingDurationMs).toBe(0);
      expect(stats.estimatedTimeSavedMs).toBe(0);
      expect(stats.totalCostCeiling).toBe(0);
    });

    it("[P0] 應使用 SQL 聚合查詢", async () => {
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 0,
          total_characters: 0,
          total_recording_duration_ms: 0,
        },
      ]);
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0 }]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchDashboardStats();

      const sql = mockDbSelect.mock.calls[0][0] as string;
      expect(sql).toContain("COUNT(*)");
      expect(sql).toContain("SUM(char_count)");
      expect(sql).toContain("SUM(recording_duration_ms)");
    });

    it("[P0] 應正確計算節省時間和整合費用上限", async () => {
      // 節省時間 = 600 / 40 * 60000 = 900000ms
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 10,
          total_characters: 600,
          total_recording_duration_ms: 120000,
        },
      ]);
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0.0042 }]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const stats = await store.fetchDashboardStats();

      expect(stats.totalTranscriptions).toBe(10);
      expect(stats.totalCharacters).toBe(600);
      expect(stats.totalRecordingDurationMs).toBe(120000);
      expect(stats.estimatedTimeSavedMs).toBe(900000);
      expect(stats.totalCostCeiling).toBe(0.0042);
    });
  });

  // ==========================================================================
  // fetchRecentTranscriptionList
  // ==========================================================================

  describe("fetchRecentTranscriptionList", () => {
    it("[P0] 應使用 LIMIT 查詢最近記錄", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchRecentTranscriptionList(10);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("ORDER BY timestamp DESC");
      expect(sql).toContain("LIMIT");
      expect(params).toEqual([10]);
    });

    it("[P0] 應回傳 camelCase 映射後的記錄", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "recent-1", raw_text: "最近的文字" }),
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const results = await store.fetchRecentTranscriptionList(10);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("recent-1");
      expect(results[0].rawText).toBe("最近的文字");
    });

    it("[P0] 預設 limit 應為 10", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.fetchRecentTranscriptionList();

      const params = mockDbSelect.mock.calls[0][1];
      expect(params).toEqual([10]);
    });
  });

  // ==========================================================================
  // refreshDashboard
  // ==========================================================================

  describe("refreshDashboard", () => {
    it("[P0] 應同時載入統計、最近列表和趨勢並更新 refs", async () => {
      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        {
          total_count: 5,
          total_characters: 200,
          total_recording_duration_ms: 60000,
        },
      ]);
      // fetchDashboardStats → TOTAL_COST_CEILING_SQL
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0.001 }]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "recent-1" }),
        createRawRow({ id: "recent-2" }),
      ]);
      // fetchDailyUsageTrend
      mockDbSelect.mockResolvedValueOnce([
        { date: "2026-03-01", count: 3, total_chars: 100 },
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.refreshDashboard();

      expect(store.dashboardStats.totalTranscriptions).toBe(5);
      expect(store.dashboardStats.totalCharacters).toBe(200);
      expect(store.dashboardStats.totalCostCeiling).toBe(0.001);
      expect(store.recentTranscriptionList).toHaveLength(2);
      expect(store.recentTranscriptionList[0].id).toBe("recent-1");
      expect(store.dailyUsageTrendList).toHaveLength(1);
      expect(store.dailyUsageTrendList[0].date).toBe("2026-03-01");
      expect(store.dailyUsageTrendList[0].count).toBe(3);
      expect(store.dailyUsageTrendList[0].totalChars).toBe(100);
    });

    it("[P0] dashboardStats 初始值應全為零", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      expect(store.dashboardStats.totalTranscriptions).toBe(0);
      expect(store.dashboardStats.totalCharacters).toBe(0);
      expect(store.dashboardStats.totalRecordingDurationMs).toBe(0);
      expect(store.dashboardStats.estimatedTimeSavedMs).toBe(0);
      expect(store.dashboardStats.totalCostCeiling).toBe(0);
      expect(store.recentTranscriptionList).toHaveLength(0);
      expect(store.dailyUsageTrendList).toHaveLength(0);
    });
  });

  // ==========================================================================
  // searchTranscriptionList
  // ==========================================================================

  describe("searchTranscriptionList", () => {
    it("[P0] 有搜尋關鍵字時應使用 LIKE 查詢", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("測試", 20, 0);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("LIKE");
      expect(params[0]).toBe("%測試%");
    });

    it("[P0] 空白搜尋應使用分頁查詢（無 LIKE）", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("  ", 20, 0);

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).not.toContain("LIKE");
      expect(params).toEqual([20, 0]);
    });

    it("[P0] 應正確傳遞 limit 和 offset 參數", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.searchTranscriptionList("關鍵字", 10, 30);

      const params = mockDbSelect.mock.calls[0][1];
      expect(params[0]).toBe("%關鍵字%");
      expect(params[1]).toBe(10);
      expect(params[2]).toBe(30);
    });

    it("[P0] 應回傳 camelCase 映射後的記錄", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawRow({ id: "found-1", raw_text: "搜尋到的文字" }),
      ]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const results = await store.searchTranscriptionList("搜尋", 20, 0);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("found-1");
      expect(results[0].rawText).toBe("搜尋到的文字");
    });
  });

  // ==========================================================================
  // resetAndFetch
  // ==========================================================================

  describe("resetAndFetch", () => {
    it("[P0] 應重設 offset 並載入第一頁", async () => {
      const page = Array.from({ length: 5 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(page);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.currentOffset = 100;
      await store.resetAndFetch();

      expect(store.transcriptionList).toHaveLength(5);
      expect(store.currentOffset).toBe(5);
    });

    it("[P0] 結果少於 PAGE_SIZE 時 hasMore 應為 false", async () => {
      mockDbSelect.mockResolvedValueOnce([createRawRow()]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      expect(store.hasMore).toBe(false);
    });

    it("[P0] 結果等於 PAGE_SIZE 時 hasMore 應為 true", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(fullPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      expect(store.hasMore).toBe(true);
      expect(store.currentOffset).toBe(20);
    });

    it("[P0] 應使用 searchQuery 進行搜尋", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.searchQuery = "測試搜尋";
      await store.resetAndFetch();

      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("LIKE");
      expect(params[0]).toBe("%測試搜尋%");
    });

    it("[P0] 載入中應設定 isLoading，完成後恢復", async () => {
      let resolveSelect!: (value: unknown[]) => void;
      mockDbSelect.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSelect = resolve;
        }),
      );

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      const promise = store.resetAndFetch();
      expect(store.isLoading).toBe(true);

      resolveSelect([]);
      await promise;
      expect(store.isLoading).toBe(false);
    });
  });

  // ==========================================================================
  // loadMore
  // ==========================================================================

  describe("loadMore", () => {
    it("[P0] 應追加結果至現有清單並更新 offset", async () => {
      // 先載入初始頁
      const initialPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `init-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(initialPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();
      expect(store.transcriptionList).toHaveLength(20);

      // 載入更多
      const nextPage = Array.from({ length: 5 }, (_, i) =>
        createRawRow({ id: `more-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(nextPage);

      await store.loadMore();

      expect(store.transcriptionList).toHaveLength(25);
      expect(store.currentOffset).toBe(25);
      expect(store.hasMore).toBe(false);
    });

    it("[P0] hasMore=false 時不應發起查詢", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.hasMore = false;
      mockDbSelect.mockClear();

      await store.loadMore();

      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("[P0] isLoading=true 時不應發起查詢", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      store.hasMore = true;
      store.isLoading = true;
      mockDbSelect.mockClear();

      await store.loadMore();

      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it("[P0] 應傳遞正確的 offset 參數", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) =>
        createRawRow({ id: `row-${i}` }),
      );
      mockDbSelect.mockResolvedValueOnce(fullPage);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.resetAndFetch();

      mockDbSelect.mockResolvedValueOnce([]);
      await store.loadMore();

      const params = mockDbSelect.mock.calls[1][1];
      // 第二次呼叫的 offset 應該是 20（第一頁的結果數）
      expect(params).toEqual([20, 20]);
    });
  });

  // ==========================================================================
  // addApiUsage
  // ==========================================================================

  describe("addApiUsage", () => {
    it("[P0] 應執行 INSERT SQL 並傳入正確參數", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.addApiUsage({
        id: "usage-001",
        transcriptionId: "tx-001",
        apiType: "whisper",
        model: "whisper-large-v3",
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        promptTimeMs: null,
        completionTimeMs: null,
        totalTimeMs: null,
        audioDurationMs: 5000,
        estimatedCostCeiling: 0.000154,
      });

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO api_usage");
      expect(params).toEqual([
        "usage-001",
        "tx-001",
        "whisper",
        "whisper-large-v3",
        null,
        null,
        null,
        null,
        null,
        null,
        5000,
        0.000154,
      ]);
    });

    it("[P0] chat 類型應正確傳入 token 欄位", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.addApiUsage({
        id: "usage-002",
        transcriptionId: "tx-001",
        apiType: "chat",
        model: "llama-3.3-70b-versatile",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptTimeMs: 200,
        completionTimeMs: 300,
        totalTimeMs: 500,
        audioDurationMs: null,
        estimatedCostCeiling: 0.000118,
      });

      const params = mockDbExecute.mock.calls[0][1];
      expect(params[4]).toBe(100); // promptTokens
      expect(params[5]).toBe(50); // completionTokens
      expect(params[6]).toBe(150); // totalTokens
      expect(params[10]).toBeNull(); // audioDurationMs
    });
  });

  // ==========================================================================
  // fetchDailyUsageTrend
  // ==========================================================================

  describe("fetchDailyUsageTrend", () => {
    it("[P0] 應回傳 camelCase 映射後的趨勢陣列", async () => {
      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();
      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        { total_count: 0, total_characters: 0, total_recording_duration_ms: 0 },
      ]);
      // fetchDashboardStats → TOTAL_COST_CEILING_SQL
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0 }]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchDailyUsageTrend
      mockDbSelect.mockResolvedValueOnce([
        { date: "2026-03-01", count: 5, total_chars: 250 },
        { date: "2026-02-28", count: 3, total_chars: 120 },
      ]);

      await store.refreshDashboard();

      expect(store.dailyUsageTrendList).toHaveLength(2);
      expect(store.dailyUsageTrendList[0]).toEqual({
        date: "2026-03-01",
        count: 5,
        totalChars: 250,
      });
      expect(store.dailyUsageTrendList[1]).toEqual({
        date: "2026-02-28",
        count: 3,
        totalChars: 120,
      });
    });

    it("[P0] DAILY_USAGE_TREND_SQL 應包含 GROUP BY 和 LIMIT", async () => {
      // fetchDashboardStats → DASHBOARD_STATS_SQL
      mockDbSelect.mockResolvedValueOnce([
        { total_count: 0, total_characters: 0, total_recording_duration_ms: 0 },
      ]);
      // fetchDashboardStats → TOTAL_COST_CEILING_SQL
      mockDbSelect.mockResolvedValueOnce([{ total_cost_ceiling: 0 }]);
      // fetchRecentTranscriptionList
      mockDbSelect.mockResolvedValueOnce([]);
      // fetchDailyUsageTrend
      mockDbSelect.mockResolvedValueOnce([]);

      const { useHistoryStore } = await import(
        "../../src/stores/useHistoryStore"
      );
      const store = useHistoryStore();

      await store.refreshDashboard();

      // fetchDailyUsageTrend 是第 4 次 select 呼叫
      const trendCall = mockDbSelect.mock.calls[3];
      const sql = trendCall[0] as string;
      expect(sql).toContain("WHERE timestamp >=");
      expect(sql).toContain("GROUP BY date");
      expect(sql).toContain("LIMIT");
      const params = trendCall[1] as number[];
      expect(params[0]).toBeLessThanOrEqual(Date.now());
      expect(params[0]).toBeGreaterThan(Date.now() - 31 * 86_400_000);
      expect(params[1]).toBe(30);
    });
  });
});
