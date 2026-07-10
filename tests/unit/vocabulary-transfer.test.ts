import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_TERM_LENGTH,
  buildExportFile,
  parseImportContent,
} from "../../src/lib/vocabularyTransfer";
import type { VocabularyExportEntry } from "../../src/types/vocabulary";

const sampleEntries: VocabularyExportEntry[] = [
  { term: "Groq", weight: 30, source: "manual" },
  { term: "Tauri", weight: 12, source: "ai" },
];

describe("buildExportFile", () => {
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

  it("去除 UTF-8 BOM 後仍能解析 JSON（Windows/Notepad 檔案）", () => {
    const json = "\uFEFF" + JSON.stringify({ terms: [{ term: "Rust" }] });
    const result = parseImportContent("bom.json", json);
    expect(result).toEqual([{ term: "Rust", weight: 1, source: "manual" }]);
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

  it("超長詞條截斷至上限", () => {
    const long = "a".repeat(MAX_TERM_LENGTH + 50);
    const result = parseImportContent("d.txt", long);
    expect(result[0].term).toHaveLength(MAX_TERM_LENGTH);
  });
});
