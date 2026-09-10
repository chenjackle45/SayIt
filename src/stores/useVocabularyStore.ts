import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDatabase } from "../lib/database";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { emitEvent, VOCABULARY_CHANGED } from "../composables/useTauriEvents";
import type {
  ImportResult,
  VocabularyEntry,
  VocabularyExportEntry,
  VocabularySource,
} from "../types/vocabulary";
import {
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_FILE_BYTES,
  parseImportContent,
  serializeExport,
} from "../lib/vocabularyTransfer";
import type { VocabularyChangedPayload } from "../types/events";
import i18n from "../i18n";

/** 匯入時每批 upsert 的詞條數（500 × 4 個參數，遠低於 SQLite 變數上限） */
const IMPORT_BATCH_SIZE = 500;

/** 供 view 顯示上限用（view 不直接碰 lib） */
export const DICTIONARY_IMPORT_MAX_FILE_BYTES = MAX_IMPORT_FILE_BYTES;
export const DICTIONARY_IMPORT_MAX_ENTRIES = MAX_IMPORT_ENTRIES;

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
   * 批次匯入詞條。合併策略（term 以小寫比對）：
   * - 不存在 → 新增（added）
   * - 已存在且匯入 weight 較大 → 更新為較大值（merged）
   * - 已存在且 weight 未較大 → 略過（skipped）
   *
   * 不使用跨呼叫交易：tauri-plugin-sql 的連線池無連線親和性，BEGIN/COMMIT
   * 可能落在不同連線（見 #65）。改以分批 multi-row upsert 寫入，每批單一語句
   * 原子；upsert 取 MAX(weight) 使整個流程冪等，中途失敗重跑即可補齊。
   */
  async function importEntries(
    entries: VocabularyExportEntry[],
  ): Promise<ImportResult> {
    const result: ImportResult = { added: 0, merged: 0, skipped: 0 };
    if (entries.length === 0) return result;

    const db = getDatabase();

    // 建立現有詞條索引（小寫 term → { term 原字串, weight }）
    const existingRows = await db.select<{ term: string; weight: number }[]>(
      "SELECT term, weight FROM vocabulary",
    );
    const existingByTerm = new Map<string, { term: string; weight: number }>();
    for (const row of existingRows) {
      existingByTerm.set(row.term.trim().toLowerCase(), {
        term: row.term,
        weight: row.weight,
      });
    }

    // 先在記憶體分類：只把需要寫入的（新增 / 合併）收進 upsert 清單。
    // 合併時沿用 DB 既有的 term 字串（UNIQUE(term) 大小寫敏感），讓 ON CONFLICT 命中。
    const rowsToUpsert: VocabularyExportEntry[] = [];
    for (const entry of entries) {
      const key = entry.term.toLowerCase();
      const existing = existingByTerm.get(key);
      if (!existing) {
        rowsToUpsert.push(entry);
        // 同次匯入若有重複（理論上已去重）也視為已存在
        existingByTerm.set(key, { term: entry.term, weight: entry.weight });
        result.added += 1;
      } else if (entry.weight > existing.weight) {
        rowsToUpsert.push({ ...entry, term: existing.term });
        existing.weight = entry.weight;
        result.merged += 1;
      } else {
        result.skipped += 1;
      }
    }

    try {
      for (let i = 0; i < rowsToUpsert.length; i += IMPORT_BATCH_SIZE) {
        const batch = rowsToUpsert.slice(i, i + IMPORT_BATCH_SIZE);
        const placeholders: string[] = [];
        const params: (string | number)[] = [];
        batch.forEach((entry, index) => {
          const base = index * 4;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`,
          );
          params.push(
            crypto.randomUUID(),
            entry.term,
            entry.weight,
            entry.source,
          );
        });
        await db.execute(
          `INSERT INTO vocabulary (id, term, weight, source) VALUES ${placeholders.join(", ")} ` +
            "ON CONFLICT(term) DO UPDATE SET weight = MAX(vocabulary.weight, excluded.weight)",
          params,
        );
      }
    } catch (error) {
      console.error(
        `[vocabulary-store] importEntries failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, { source: "vocabulary", step: "import" });
      // 前面幾批已落地：刷新清單、通知其他視窗，再把「寫入」錯誤丟回去（重跑即可補齊，冪等）。
      // 刷新本身若也失敗，不能遮蔽原始錯誤、也不能擋住通知
      try {
        await fetchTermList();
      } catch {
        /* fetchTermList 已自行記錄與上報 */
      }
      emitVocabularyChanged();
      throw error;
    }

    await fetchTermList();
    emitVocabularyChanged();
    return result;
  }

  function emitVocabularyChanged(): void {
    void emitEvent(VOCABULARY_CHANGED, {
      action: "added",
      term: "",
    } satisfies VocabularyChangedPayload);
  }

  /** 匯出成單一 JSON 檔的內容；字典為空回 null（view 只負責觸發下載） */
  async function buildExportDownload(): Promise<{
    filename: string;
    content: string;
    count: number;
  } | null> {
    const entries = await exportEntries();
    if (entries.length === 0) return null;
    const iso = new Date().toISOString();
    const stamp = iso.slice(0, 10).replace(/-/g, "");
    return {
      filename: `sayit-dictionary-${stamp}.json`,
      content: serializeExport(entries, iso),
      count: entries.length,
    };
  }

  /** 解析匯入檔內容並寫入；解析錯誤原樣拋出（INVALID_JSON / INVALID_FORMAT / TOO_MANY_ENTRIES） */
  async function importFromFileContent(
    filename: string,
    content: string,
  ): Promise<ImportResult | null> {
    const entries = parseImportContent(filename, content);
    if (entries.length === 0) return null;
    return importEntries(entries);
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
    buildExportDownload,
    importFromFileContent,
  };
});
