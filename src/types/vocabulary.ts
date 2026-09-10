export type VocabularySource = "manual" | "ai";

export interface VocabularyEntry {
  id: string;
  term: string;
  weight: number;
  source: VocabularySource;
  createdAt: string;
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
