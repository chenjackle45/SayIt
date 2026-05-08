import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getDatabase } from "../lib/database";
import { extractErrorMessage } from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { emitEvent, VOCABULARY_CHANGED } from "../composables/useTauriEvents";
import type { VocabularyEntry, VocabularySource } from "../types/vocabulary";
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
  };
});
