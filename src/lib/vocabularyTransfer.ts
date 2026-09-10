import type {
  VocabularyExportEntry,
  VocabularyExportFile,
  VocabularySource,
} from "../types/vocabulary";

export const EXPORT_FORMAT = "sayit-dictionary" as const;
export const EXPORT_VERSION = 1 as const;

/** 匯入檔案大小上限（位元組），避免一次塞入過大檔案 */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
/** 單次匯入詞條數上限，超過請使用者拆檔（避免數萬筆寫入長時間鎖住 DB） */
export const MAX_IMPORT_ENTRIES = 5000;
/** 權重上限，避免壞檔塞入超大 weight 永久霸佔 top-N 排序 */
export const MAX_WEIGHT = 1000;

const VALID_SOURCES: VocabularySource[] = ["manual", "ai"];

function normalizeWeight(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.floor(n), 1), MAX_WEIGHT);
}

function normalizeSource(value: unknown): VocabularySource {
  return VALID_SOURCES.includes(value as VocabularySource)
    ? (value as VocabularySource)
    : "manual";
}

function normalizeTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  // 去除前後空白與換行；折疊內部多餘空白。不截斷：手動新增沒有長度上限，
  // 匯入若靜默截斷會讓兩筆長詞在去重時被吃掉一筆
  return value.trim().replace(/\s+/g, " ");
}

/**
 * 將詞條陣列去重（以小寫比對，保留先出現者）。
 * DB 的 UNIQUE(term) 是大小寫敏感的；這裡與 store 端一致以小寫視為同一詞，
 * 避免同一批寫入 Tauri／tauri 兩列。
 */
function dedupe(entries: VocabularyExportEntry[]): VocabularyExportEntry[] {
  const seen = new Set<string>();
  const result: VocabularyExportEntry[] = [];
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

/** 序列化為帶縮排的 JSON 字串 */
export function serializeExport(
  entries: VocabularyExportEntry[],
  exportedAt: string,
): string {
  return JSON.stringify(buildExportFile(entries, exportedAt), null, 2);
}

/** 解析 SayIt JSON 匯出檔，回傳正規化詞條（容錯：忽略無效詞條） */
function parseSayItJson(content: string): VocabularyExportEntry[] {
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

  const result: VocabularyExportEntry[] = [];
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
 * 解析純文字 / CSV：一行一個詞。
 * - .txt：整行就是詞（含逗號也保留，例如「Inc, ACME」）
 * - .csv：取第一欄（支援「念法,正確寫法」這類兩欄資料：SayIt 只存詞條本身），去掉包住的引號
 * 用於從 Typeless 等沒有匯出功能的工具遷移 —— 使用者自行整理成文字檔即可。
 * 所有詞條以 source='manual'、weight=1 匯入。
 */
function parsePlainText(content: string, isCsv: boolean): VocabularyExportEntry[] {
  const result: VocabularyExportEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const raw = isCsv ? line.split(",")[0].trim().replace(/^"(.*)"$/, "$1") : line;
    const term = normalizeTerm(raw);
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
 * - .csv → 取第一欄；其他（.txt / 純文字）→ 整行一個詞
 * 回傳去重後的詞條陣列；去重後超過 MAX_IMPORT_ENTRIES 拋出 TOO_MANY_ENTRIES。
 */
export function parseImportContent(
  filename: string,
  content: string,
): VocabularyExportEntry[] {
  const isJson = /\.json$/i.test(filename) || looksLikeJson(content);
  const isCsv = /\.csv$/i.test(filename);
  const entries = dedupe(
    isJson ? parseSayItJson(content) : parsePlainText(content, isCsv),
  );
  if (entries.length > MAX_IMPORT_ENTRIES) {
    throw new Error("TOO_MANY_ENTRIES");
  }
  return entries;
}
