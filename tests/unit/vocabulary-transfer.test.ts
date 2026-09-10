import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_IMPORT_ENTRIES,
  MAX_WEIGHT,
  buildExportFile,
  parseImportContent,
  serializeExport,
} from "../../src/lib/vocabularyTransfer";
import type { VocabularyExportEntry } from "../../src/types/vocabulary";

const sampleEntries: VocabularyExportEntry[] = [
  { term: "Groq", weight: 30, source: "manual" },
  { term: "Tauri", weight: 12, source: "ai" },
];

describe("buildExportFile / serializeExport", () => {
  it("應產生帶 format/version/exportedAt 的物件", () => {
    const file = buildExportFile(sampleEntries, "2026-06-09T00:00:00.000Z");
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.version).toBe(EXPORT_VERSION);
    expect(file.exportedAt).toBe("2026-06-09T00:00:00.000Z");
    expect(file.terms).toHaveLength(2);
  });

  it("匯出時正規化非法 weight/source", () => {
    const file = buildExportFile(
      [{ term: "X", weight: -5, source: "bogus" as never }],
      "2026-06-09T00:00:00.000Z",
    );
    expect(file.terms[0].weight).toBe(1);
    expect(file.terms[0].source).toBe("manual");
  });

  it("匯出時 weight 超過上限夾到 MAX_WEIGHT", () => {
    const file = buildExportFile(
      [{ term: "X", weight: 9e15, source: "manual" }],
      "2026-06-09T00:00:00.000Z",
    );
    expect(file.terms[0].weight).toBe(MAX_WEIGHT);
  });

  it("serializeExport 產生可被 parseImportContent 解析的 JSON", () => {
    const json = serializeExport(sampleEntries, "2026-06-09T00:00:00.000Z");
    const parsed = parseImportContent("backup.json", json);
    expect(parsed).toEqual(sampleEntries);
  });
});

describe("parseImportContent — SayIt JSON", () => {
  it("依副檔名 .json 解析並保留 weight/source", () => {
    const json = JSON.stringify({
      format: "sayit-dictionary",
      version: 1,
      terms: [
        { term: "Vue.js", weight: 8, source: "ai" },
        { term: "Pinia", weight: 3, source: "manual" },
      ],
    });
    const result = parseImportContent("dict.json", json);
    expect(result).toEqual([
      { term: "Vue.js", weight: 8, source: "ai" },
      { term: "Pinia", weight: 3, source: "manual" },
    ]);
  });

  it("無副檔名但內容像 JSON 也能解析", () => {
    const json = '{ "terms": [{ "term": "Rust" }] }';
    const result = parseImportContent("noext", json);
    expect(result).toEqual([{ term: "Rust", weight: 1, source: "manual" }]);
  });

  it("忽略空白詞條", () => {
    const json = JSON.stringify({ terms: [{ term: "  " }, { term: "OK" }] });
    const result = parseImportContent("a.json", json);
    expect(result).toEqual([{ term: "OK", weight: 1, source: "manual" }]);
  });

  it("weight 超過上限夾到 MAX_WEIGHT（壞檔不能霸佔排序）", () => {
    const json = JSON.stringify({
      terms: [
        { term: "Huge", weight: 9e15 },
        { term: "Edge", weight: MAX_WEIGHT },
        { term: "Str", weight: "99999" },
      ],
    });
    const result = parseImportContent("a.json", json);
    expect(result.map((e) => e.weight)).toEqual([
      MAX_WEIGHT,
      MAX_WEIGHT,
      MAX_WEIGHT,
    ]);
  });

  it("非 JSON 內容的 .json 檔拋出 INVALID_JSON", () => {
    expect(() => parseImportContent("broken.json", "not json {")).toThrow(
      "INVALID_JSON",
    );
  });

  it("缺少 terms 陣列拋出 INVALID_FORMAT", () => {
    expect(() => parseImportContent("a.json", '{"foo":1}')).toThrow(
      "INVALID_FORMAT",
    );
  });
});

describe("parseImportContent — 純文字 / CSV（Typeless 遷移）", () => {
  it("一行一個詞，全部以 manual/weight=1 匯入", () => {
    const txt = "蘋果\n香蕉\n芭樂";
    const result = parseImportContent("typeless.txt", txt);
    expect(result).toEqual([
      { term: "蘋果", weight: 1, source: "manual" },
      { term: "香蕉", weight: 1, source: "manual" },
      { term: "芭樂", weight: 1, source: "manual" },
    ]);
  });

  it("CSV 取第一欄（忽略對應字的第二欄）", () => {
    const csv = "sequel,SQL\nreact,React";
    const result = parseImportContent("d.csv", csv);
    expect(result.map((e) => e.term)).toEqual(["sequel", "react"]);
  });

  it("跳過空行與多餘空白", () => {
    const txt = "  Tauri  \n\n\n  Vue  \n";
    const result = parseImportContent("d.txt", txt);
    expect(result.map((e) => e.term)).toEqual(["Tauri", "Vue"]);
  });

  it("以小寫去重，保留先出現者", () => {
    const txt = "Tauri\ntauri\nVue";
    const result = parseImportContent("d.txt", txt);
    expect(result.map((e) => e.term)).toEqual(["Tauri", "Vue"]);
  });

  it("超長詞條原樣保留、不截斷（截斷後去重會吃掉一筆）", () => {
    const a = "a".repeat(100) + "x";
    const b = "a".repeat(100) + "y";
    const result = parseImportContent("d.txt", `${a}\n${b}`);
    expect(result.map((e) => e.term)).toEqual([a, b]);
  });

  it(".txt 含逗號的整行保留為一個詞", () => {
    const result = parseImportContent("d.txt", "Inc, ACME\nhello, world");
    expect(result.map((e) => e.term)).toEqual(["Inc, ACME", "hello, world"]);
  });

  it(".csv 第一欄去掉包住的引號；不支援引號內逗號（文案已揭露、含逗號請用 .txt）", () => {
    const result = parseImportContent("d.csv", '"Tauri",x');
    expect(result.map((e) => e.term)).toEqual(["Tauri"]);
  });
});

describe("parseImportContent — 詞條數上限", () => {
  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => `term${i}`).join("\n");

  it("剛好等於上限可以匯入", () => {
    const result = parseImportContent("d.txt", lines(MAX_IMPORT_ENTRIES));
    expect(result).toHaveLength(MAX_IMPORT_ENTRIES);
  });

  it("超過上限拋出 TOO_MANY_ENTRIES", () => {
    expect(() =>
      parseImportContent("d.txt", lines(MAX_IMPORT_ENTRIES + 1)),
    ).toThrow("TOO_MANY_ENTRIES");
  });

  it("以去重後的數量計算（重複行不算）", () => {
    const txt = lines(MAX_IMPORT_ENTRIES) + "\n" + lines(10);
    const result = parseImportContent("d.txt", txt);
    expect(result).toHaveLength(MAX_IMPORT_ENTRIES);
  });

  it("JSON 格式同樣受上限限制", () => {
    const json = JSON.stringify({
      terms: Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, i) => ({
        term: `t${i}`,
      })),
    });
    expect(() => parseImportContent("a.json", json)).toThrow(
      "TOO_MANY_ENTRIES",
    );
  });
});
