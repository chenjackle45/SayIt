import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDatabase } from "../lib/database";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { emitEvent, VOCABULARY_CHANGED } from "../composables/useTauriEvents";
import type {
  ImportedTerm,
  ImportResult,
  VocabularyEntry,
  VocabularyExportEntry,
  VocabularySource,
} from "../types/vocabulary";
import type { VocabularyChangedPayload } from "../types/events";
import i18n from "../i18n";

interface RawVocabularyRow {
  id: string;
  term: string;
  weight: number;
  source: string;
  created_at: string;
}

function mapRowToEntry(row: RawVocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    weight: row.weight,
    source: row.source as VocabularySource,
    createdAt: row.created_at,
  };
}

export const useVocabularyStore = defineStore("vocabulary", () => {
  const termList = ref<VocabularyEntry[]>([]);
  const isLoading = ref(false);

  const termCount = computed(() => termList.value.length);

  function isDuplicateTerm(term: string): boolean {
    const normalizedInput = term.trim().toLowerCase();
    return termList.value.some(
      (entry) => entry.term.trim().toLowerCase() === normalizedInput,
    );
  }

  async function fetchTermList() {
    isLoading.value = true;
    try {
      const db = getDatabase();
      const rows = await db.select<RawVocabularyRow[]>(
        "SELECT id, term, weight, source, created_at FROM vocabulary ORDER BY weight DESC, created_at DESC",
      );
      termList.value = rows.map(mapRowToEntry);
    } catch (error) {
      console.error(
        `[vocabulary-store] fetchTermList failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "fetch" });
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function addTerm(term: string) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    if (isDuplicateTerm(trimmedTerm)) {
      throw new Error(i18n.global.t("dictionary.duplicateEntry"));
    }

    const id = crypto.randomUUID();
    try {
      const db = getDatabase();
      await db.execute(
        "INSERT INTO vocabulary (id, term, source) VALUES ($1, $2, 'manual')",
        [id, trimmedTerm],
      );
      await fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      const message = extractErrorMessage(error);
      if (message.includes("UNIQUE")) {
        throw new Error(i18n.global.t("dictionary.duplicateEntry"), {
          cause: error,
        });
      }
      console.error(`[vocabulary-store] addTerm failed: ${message}`);
      captureError(error, { source: "vocabulary", step: "add" });
      throw error;
    }
  }

  async function removeTerm(id: string) {
    const entry = termList.value.find((e) => e.id === id);
    if (!entry) return;

    try {
      const db = getDatabase();
      await db.execute("DELETE FROM vocabulary WHERE id = $1", [id]);
      await fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "removed",
        term: entry.term,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      console.error(
        `[vocabulary-store] removeTerm failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "remove" });
      throw error;
    }
  }

  const manualTermList = computed(() =>
    termList.value.filter((entry) => entry.source === "manual"),
  );

  const aiSuggestedTermList = computed(() =>
    termList.value.filter((entry) => entry.source === "ai"),
  );

  async function addAiSuggestedTerm(term: string) {
    const trimmedTerm = term.trim();
    if (!trimmedTerm) return;

    const id = crypto.randomUUID();
    try {
      const db = getDatabase();
      await db.execute(
        "INSERT INTO vocabulary (id, term, source) VALUES ($1, $2, 'ai')",
        [id, trimmedTerm],
      );
      await fetchTermList();
      void emitEvent(VOCABULARY_CHANGED, {
        action: "added",
        term: trimmedTerm,
      } satisfies VocabularyChangedPayload);
    } catch (error) {
      const message = extractErrorMessage(error);
      if (message.includes("UNIQUE")) {
        // 已存在，靜默處理（呼叫端會做 weight +1）
        return;
      }
      console.error(`[vocabulary-store] addAiSuggestedTerm failed: ${message}`);
      captureError(error, { source: "vocabulary", step: "add-ai" });
      throw error;
    }
  }

  async function batchIncrementWeights(termIdList: string[]) {
    if (termIdList.length === 0) return;
    try {
      const db = getDatabase();
      for (const id of termIdList) {
        await db.execute(
          "UPDATE vocabulary SET weight = weight + 1 WHERE id = $1",
          [id],
        );
      }
      await fetchTermList();
    } catch (error) {
      console.error(
        `[vocabulary-store] batchIncrementWeights failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "increment-weights" });
      throw error;
    }
  }

  /** 取得所有詞條，供匯出使用（不含 id / createdAt） */
  async function exportEntries(): Promise<VocabularyExportEntry[]> {
    const db = getDatabase();
    const rows = await db.select<RawVocabularyRow[]>(
      "SELECT term, weight, source FROM vocabulary ORDER BY weight DESC, created_at DESC",
    );
    return rows.map((row) => ({
      term: row.term,
      weight: row.weight,
      source: row.source as VocabularySource,
    }));
  }

  /**
   * 批次匯入詞條，以單一交易寫入。合併策略（term 以小寫比對）：
   * - 不存在 → 新增（added）
   * - 已存在且匯入 weight 較大 → 更新為較大值（merged）
   * - 已存在且 weight 未較大 → 略過（skipped）
   */
  async function importEntries(
    entries: ImportedTerm[],
  ): Promise<ImportResult> {
    const result: ImportResult = { added: 0, merged: 0, skipped: 0 };
    if (entries.length === 0) return result;

    const db = getDatabase();

    // 建立現有詞條索引（小寫 term → { id, weight }）
    const existingRows = await db.select<
      { id: string; term: string; weight: number }[]
    >("SELECT id, term, weight FROM vocabulary");
    const existingByTerm = new Map<string, { id: string; weight: number }>();
    for (const row of existingRows) {
      existingByTerm.set(row.term.trim().toLowerCase(), {
        id: row.id,
        weight: row.weight,
      });
    }

    // 不使用顯式交易：tauri-plugin-sql 連線池無連線親和性，跨 execute()
    // 呼叫的 BEGIN/COMMIT 會落在不同連線而失敗
    // （cannot commit - no transaction is active）。改為逐筆 autocommit；
    // 已先 fetchTermList 去重 + term UNIQUE + 新 UUID，部分失敗可重新匯入恢復。
    try {
      for (const entry of entries) {
        const key = entry.term.toLowerCase();
        const existing = existingByTerm.get(key);
        if (!existing) {
          const id = crypto.randomUUID();
          await db.execute(
            "INSERT INTO vocabulary (id, term, weight, source) VALUES ($1, $2, $3, $4)",
            [id, entry.term, entry.weight, entry.source],
          );
          // 同次匯入若有重複（理論上已去重）也視為已存在
          existingByTerm.set(key, { id, weight: entry.weight });
          result.added += 1;
        } else if (entry.weight > existing.weight) {
          await db.execute("UPDATE vocabulary SET weight = $1 WHERE id = $2", [
            entry.weight,
            existing.id,
          ]);
          existing.weight = entry.weight;
          result.merged += 1;
        } else {
          result.skipped += 1;
        }
      }
    } catch (error) {
      console.error(
        `[vocabulary-store] importEntries failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "import" });
      throw error;
    }

    await fetchTermList();
    void emitEvent(VOCABULARY_CHANGED, {
      action: "added",
      term: "",
    } satisfies VocabularyChangedPayload);
    return result;
  }

  async function getTopTermListByWeight(limit: number): Promise<string[]> {
    try {
      const db = getDatabase();
      const rows = await db.select<{ term: string }[]>(
        "SELECT term FROM vocabulary ORDER BY weight DESC, created_at DESC LIMIT $1",
        [limit],
      );
      return rows.map((row) => row.term);
    } catch (error) {
      console.error(
        `[vocabulary-store] getTopTermListByWeight failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "top-by-weight" });
      return [];
    }
  }

  return {
    termList,
    isLoading,
    termCount,
    manualTermList,
    aiSuggestedTermList,
    isDuplicateTerm,
    fetchTermList,
    addTerm,
    addAiSuggestedTerm,
    batchIncrementWeights,
    getTopTermListByWeight,
    removeTerm,
    exportEntries,
    importEntries,
  };
});
