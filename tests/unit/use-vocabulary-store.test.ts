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

    it("不存在的詞 → 以單一 multi-row upsert 新增（不使用交易）", async () => {
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

      // 兩筆合併成一個語句，沒有 BEGIN/COMMIT
      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("INSERT INTO vocabulary (id, term, weight, source)");
      expect(sql).toContain("ON CONFLICT(term) DO UPDATE");
      expect(sql).toContain("($1, $2, $3, $4), ($5, $6, $7, $8)");
      expect(params).toEqual([
        expect.any(String),
        "A",
        5,
        "manual",
        expect.any(String),
        "B",
        1,
        "ai",
      ]);
    });

    it("已存在：weight 較大時 upsert 更新（merged），否則略過不寫入（skipped）", async () => {
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
      expect(mockDbExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDbExecute.mock.calls[0] as [
        string,
        unknown[],
      ];
      // 只有 A 進入 upsert；B 完全不寫入
      expect(sql).toContain("($1, $2, $3, $4)");
      expect(sql).not.toContain("$5");
      expect(params).toEqual([expect.any(String), "A", 5, "manual"]);
    });

    it("term 比對大小寫不敏感，合併時沿用 DB 既有的 term 字串", async () => {
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
      // UNIQUE(term) 大小寫敏感 → 用 "Tauri" 才會命中 ON CONFLICT
      const params = mockDbExecute.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe("Tauri");
    });

    it("全部略過時不執行任何寫入", async () => {
      mockDbSelect.mockResolvedValueOnce([{ id: "x", term: "A", weight: 5 }]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const result = await store.importEntries([
        { term: "A", weight: 5, source: "manual" },
      ]);

      expect(result).toEqual({ added: 0, merged: 0, skipped: 1 });
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it("超過 500 筆時分批，每批一個語句", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      const entries = Array.from({ length: 1201 }, (_, i) => ({
        term: `t${i}`,
        weight: 1,
        source: "manual" as const,
      }));
      const result = await store.importEntries(entries);

      expect(result.added).toBe(1201);
      expect(mockDbExecute).toHaveBeenCalledTimes(3); // 500 + 500 + 201
      const lastParams = mockDbExecute.mock.calls[2][1] as unknown[];
      expect(lastParams).toHaveLength(201 * 4);
    });

    it("DB 失敗時拋錯，且不發送 ROLLBACK", async () => {
      mockDbSelect.mockResolvedValueOnce([]);
      mockDbExecute.mockRejectedValueOnce(new Error("disk full"));

      const { useVocabularyStore } = await import(
        "../../src/stores/useVocabularyStore"
      );
      const store = useVocabularyStore();

      await expect(
        store.importEntries([{ term: "A", weight: 1, source: "manual" }]),
      ).rejects.toThrow("disk full");

      const sqlCalls = mockDbExecute.mock.calls.map((c) => c[0] as string);
      expect(sqlCalls).toHaveLength(1);
      expect(sqlCalls).not.toContain("ROLLBACK");
    });
  });
});
