import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mockDbExecute = vi.fn().mockResolvedValue(undefined);
const mockDbSelect = vi.fn().mockResolvedValue([]);
const mockEmit = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

function createRawVocabularyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "vocab-1",
    term: "Vue.js",
    weight: 1,
    source: "manual",
    created_at: "2026-03-09 00:00:00",
    ...overrides,
  };
}

describe("useVocabularyStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockDbExecute.mockClear().mockResolvedValue(undefined);
    mockDbSelect.mockClear().mockResolvedValue([]);
    mockEmit.mockClear().mockResolvedValue(undefined);
  });

  // ==========================================================================
  // addAiSuggestedTerm
  // ==========================================================================

  describe("addAiSuggestedTerm", () => {
    it("應以 source='ai' 插入詞彙", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("Tauri");

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO vocabulary");
      expect(sql).toContain("'ai'");
      expect(params[1]).toBe("Tauri");
    });

    it("空字串不觸發 INSERT", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addAiSuggestedTerm("  ");

      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it("UNIQUE 衝突時靜默處理不拋錯", async () => {
      mockDbExecute.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed"),
      );

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await expect(store.addAiSuggestedTerm("Vue.js")).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // batchIncrementWeights
  // ==========================================================================

  describe("batchIncrementWeights", () => {
    it("應對每個 ID 執行 UPDATE weight + 1", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.batchIncrementWeights(["id-1", "id-2", "id-3"]);

      // 3 updates + 1 fetchTermList SELECT
      const updateCalls = mockDbExecute.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("UPDATE"),
      );
      expect(updateCalls).toHaveLength(3);
      expect(updateCalls[0][1]).toEqual(["id-1"]);
      expect(updateCalls[1][1]).toEqual(["id-2"]);
      expect(updateCalls[2][1]).toEqual(["id-3"]);
    });

    it("空陣列不執行任何操作", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.batchIncrementWeights([]);

      expect(mockDbExecute).not.toHaveBeenCalled();
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getTopTermListByWeight
  // ==========================================================================

  describe("getTopTermListByWeight", () => {
    it("應回傳按 weight DESC 排序的前 N 個詞", async () => {
      mockDbSelect.mockResolvedValueOnce([
        { term: "Tauri" },
        { term: "Vue.js" },
        { term: "Groq" },
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.getTopTermListByWeight(3);

      expect(result).toEqual(["Tauri", "Vue.js", "Groq"]);
      const [sql, params] = mockDbSelect.mock.calls[0];
      expect(sql).toContain("ORDER BY weight DESC");
      expect(sql).toContain("LIMIT $1");
      expect(params).toEqual([3]);
    });

    it("DB 失敗時回傳空陣列", async () => {
      mockDbSelect.mockRejectedValueOnce(new Error("DB error"));

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.getTopTermListByWeight(10);
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // manualTermList / aiSuggestedTermList computed
  // ==========================================================================

  describe("computed 過濾", () => {
    it("manualTermList 只包含 source=manual 的項目", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
        createRawVocabularyRow({ id: "2", term: "Tauri", source: "ai" }),
        createRawVocabularyRow({ id: "3", term: "Groq", source: "manual" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.manualTermList).toHaveLength(2);
      expect(store.manualTermList.map((e) => e.term)).toEqual([
        "Vue.js",
        "Groq",
      ]);
    });

    it("aiSuggestedTermList 只包含 source=ai 的項目", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ id: "1", term: "Vue.js", source: "manual" }),
        createRawVocabularyRow({ id: "2", term: "Tauri", source: "ai" }),
        createRawVocabularyRow({ id: "3", term: "泰呈", source: "ai" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();
      await store.fetchTermList();

      expect(store.aiSuggestedTermList).toHaveLength(2);
      expect(store.aiSuggestedTermList.map((e) => e.term)).toEqual([
        "Tauri",
        "泰呈",
      ]);
    });
  });

  // ==========================================================================
  // addTerm (manual) — 驗證 source='manual'
  // ==========================================================================

  describe("addTerm", () => {
    it("應以 source='manual' 插入", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await store.addTerm("React");

      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql] = mockDbExecute.mock.calls[0];
      expect(sql).toContain("'manual'");
    });
  });

  // ==========================================================================
  // exportEntries
  // ==========================================================================

  describe("exportEntries", () => {
    it("應回傳不含 id/createdAt 的詞條", async () => {
      mockDbSelect.mockResolvedValueOnce([
        createRawVocabularyRow({ term: "Groq", weight: 30, source: "manual" }),
        createRawVocabularyRow({ term: "Tauri", weight: 12, source: "ai" }),
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.exportEntries();
      expect(result).toEqual([
        { term: "Groq", weight: 30, source: "manual" },
        { term: "Tauri", weight: 12, source: "ai" },
      ]);
    });
  });

  // ==========================================================================
  // importEntries
  // ==========================================================================

  describe("importEntries", () => {
    it("空陣列不執行任何 DB 操作", async () => {
      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.importEntries([]);
      expect(result).toEqual({ added: 0, merged: 0, skipped: 0 });
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it("不存在的詞 → 以 weight/source 新增", async () => {
      // 第一個 select = 現有詞條（空），後續 fetchTermList 用預設 []
      mockDbSelect.mockResolvedValueOnce([]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.importEntries([
        { term: "A", weight: 5, source: "manual" },
        { term: "B", weight: 1, source: "ai" },
      ]);

      expect(result).toEqual({ added: 2, merged: 0, skipped: 0 });

      // 連線池無連線親和性：不可再以獨立 execute 發出 BEGIN/COMMIT
      const sqlCalls = mockDbExecute.mock.calls.map((c) => c[0] as string);
      expect(sqlCalls).not.toContain("BEGIN TRANSACTION");
      expect(sqlCalls).not.toContain("COMMIT");
      const insertCalls = mockDbExecute.mock.calls.filter((c) =>
        (c[0] as string).includes("INSERT INTO vocabulary"),
      );
      expect(insertCalls).toHaveLength(2);
      // INSERT 帶入 weight 與 source
      expect(insertCalls[0][1]).toEqual([
        expect.any(String),
        "A",
        5,
        "manual",
      ]);
    });

    it("已存在：weight 較大時更新（merged），否則略過（skipped）", async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: "x", term: "A", weight: 2 },
        { id: "y", term: "B", weight: 10 },
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.importEntries([
        { term: "A", weight: 5, source: "manual" }, // 5 > 2 → merged
        { term: "B", weight: 3, source: "manual" }, // 3 < 10 → skipped
      ]);

      expect(result).toEqual({ added: 0, merged: 1, skipped: 1 });
      const updateCalls = mockDbExecute.mock.calls.filter((c) =>
        (c[0] as string).includes("UPDATE vocabulary SET weight"),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual([5, "x"]);
    });

    it("term 比對大小寫不敏感", async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: "x", term: "Tauri", weight: 1 },
      ]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.importEntries([
        { term: "tauri", weight: 9, source: "manual" },
      ]);

      expect(result).toEqual({ added: 0, merged: 1, skipped: 0 });
    });

    it("DB 失敗時拋錯（不再依賴 ROLLBACK）", async () => {
      mockDbSelect.mockResolvedValueOnce([]);
      // 第一個 execute 即 INSERT（不再有 BEGIN），令其失敗
      mockDbExecute.mockRejectedValueOnce(new Error("disk full")); // INSERT

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await expect(
        store.importEntries([{ term: "A", weight: 1, source: "manual" }]),
      ).rejects.toThrow();

      const sqlCalls = mockDbExecute.mock.calls.map((c) => c[0] as string);
      expect(sqlCalls).not.toContain("ROLLBACK");
    });
  });
});
