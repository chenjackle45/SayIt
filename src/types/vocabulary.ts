export type VocabularySource = "manual" | "ai";

export interface VocabularyEntry {
  id: string;
  term: string;
  weight: number;
  source: VocabularySource;
  isReviewed: boolean;
  createdAt: string;
  correctionCount: number;
  lastCorrectedAt: string | null;
}

/** 匯出檔案中的單一詞條（不含 id / createdAt，匯入時重新產生） */
export interface VocabularyExportEntry {
  term: string;
  weight: number;
  source: VocabularySource;
}

/** SayIt 字典單檔匯出格式 */
export interface VocabularyExportFile {
  format: "sayit-dictionary";
  version: number;
  exportedAt: string;
  terms: VocabularyExportEntry[];
}

/** 匯入結果統計 */
export interface ImportResult {
  added: number;
  merged: number;
  skipped: number;
}

/** 同一詞條的已知聽錯寫法；改詞時沿用 vocabularyId。 */
export interface VocabularyReplacementEntry {
  id: string;
  vocabularyId: string;
  misheard: string;
  hitCount: number;
  status: "suggested" | "applied" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

/** 刪除當下的完整詞條與配對，供原樣復原。 */
export interface VocabularySnapshot {
  entry: VocabularyEntry;
  replacements: VocabularyReplacementEntry[];
}
