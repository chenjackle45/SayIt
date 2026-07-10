import type {
  ImportedTerm,
  VocabularyExportEntry,
  VocabularyExportFile,
  VocabularySource,
} from "../types/vocabulary";

export const EXPORT_FORMAT = "sayit-dictionary" as const;
export const EXPORT_VERSION = 1 as const;

/** 單一詞條長度上限，避免匯入超大字串塞爆 DB */
export const MAX_TERM_LENGTH = 100;

const VALID_SOURCES: VocabularySource[] = ["manual", "ai"];

function normalizeWeight(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  const int = Math.floor(n);
  return int < 1 ? 1 : int;
}

function normalizeSource(value: unknown): VocabularySource {
  return VALID_SOURCES.includes(value as VocabularySource)
    ? (value as VocabularySource)
    : "manual";
}

function normalizeTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  // 去除前後空白與換行；折疊內部多餘空白
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TERM_LENGTH);
}

/**
 * 將詞條陣列去重（以小寫比對，保留先出現者）。
 * 與 DB 的 UNIQUE(term) 大小寫不敏感比對行為一致（store 端亦以 lower-case 比對）。
 */
function dedupe(entries: ImportedTerm[]): ImportedTerm[] {
  const seen = new Set<string>();
  const result: ImportedTerm[] = [];
  for (const entry of entries) {
    const key = entry.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/** 建立可序列化的匯出物件 */
export function buildExportFile(
  entries: VocabularyExportEntry[],
  exportedAt: string,
): VocabularyExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    terms: entries.map((e) => ({
      term: e.term,
      weight: normalizeWeight(e.weight),
      source: normalizeSource(e.source),
    })),
  };
}

/** 解析 SayIt JSON 匯出檔，回傳正規化詞條（容錯：忽略無效詞條） */
function parseSayItJson(content: string): ImportedTerm[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("INVALID_JSON");
  }

  const terms = (parsed as Partial<VocabularyExportFile> | null)?.terms;
  if (!Array.isArray(terms)) {
    throw new Error("INVALID_FORMAT");
  }

  const result: ImportedTerm[] = [];
  for (const raw of terms) {
    const term = normalizeTerm((raw as VocabularyExportEntry)?.term);
    if (!term) continue;
    result.push({
      term,
      weight: normalizeWeight((raw as VocabularyExportEntry)?.weight),
      source: normalizeSource((raw as VocabularyExportEntry)?.source),
    });
  }
  return result;
}

/**
 * 解析純文字 / CSV：一行一個詞，遇逗號時取第一欄。
 * 用於從 Typeless 等沒有匯出功能的工具遷移 —— 使用者自行整理成文字檔即可。
 * 所有詞條以 source='manual'、weight=1 匯入。
 */
function parsePlainText(content: string): ImportedTerm[] {
  const result: ImportedTerm[] = [];
  for (const line of content.split(/\r?\n/)) {
    // 取第一欄（支援 "念法,正確寫法" 這類兩欄資料：SayIt 只存詞條本身）
    const firstField = line.split(",")[0];
    const term = normalizeTerm(firstField);
    if (!term) continue;
    result.push({ term, weight: 1, source: "manual" });
  }
  return result;
}

/** 內容看起來像 JSON 物件 */
function looksLikeJson(content: string): boolean {
  return content.trimStart().startsWith("{");
}

/**
 * 依檔名與內容判斷格式並解析。
 * - .json 或內容像 JSON → 當作 SayIt 匯出檔
 * - 其他（.txt / .csv / 純文字）→ 寬鬆純文字匯入
 * 回傳去重後的詞條陣列。
 */
export function parseImportContent(
  filename: string,
  content: string,
): ImportedTerm[] {
  // 去除 UTF-8 BOM（Windows / Notepad 儲存的檔案常見），否則 JSON.parse 會失敗
  const normalized = content.replace(/^\uFEFF/, "");
  const isJson = /\.json$/i.test(filename) || looksLikeJson(normalized);
  const entries = isJson
    ? parseSayItJson(normalized)
    : parsePlainText(normalized);
  return dedupe(entries);
}