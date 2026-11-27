import { describe, expect, it } from "vitest";
import type { VocabularyEntry, VocabularyReplacementEntry } from "../../src/types/vocabulary";
import { selectAiVocabulary, selectWhisperVocabulary } from "../../src/lib/vocabularySelection";
import { findTermOccurrences } from "../../src/lib/vocabularyMatching";

const now = Date.parse("2026-11-27T00:00:00Z");
function entry(term: string, overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return { id: term, term, weight: 1, source: "ai", isReviewed: true, correctionCount: 1, lastCorrectedAt: null, createdAt: "2026-01-01 00:00:00", ...overrides };
}
function pair(vocabularyId: string, misheard: string, status: VocabularyReplacementEntry["status"] = "suggested"): VocabularyReplacementEntry {
  return { id: vocabularyId + misheard, vocabularyId, misheard, status, hitCount: 1, createdAt: "", updatedAt: "" };
}

describe("Whisper 選詞", () => {
  it("手動新到舊→改正次數→最近改正；weight 不參與", () => {
    expect(selectWhisperVocabulary([
      entry("AI舊", { correctionCount: 3, lastCorrectedAt: "2026-11-01 00:00:00" }),
      entry("手動舊", { source: "manual", weight: 999 }),
      entry("AI新", { correctionCount: 3, lastCorrectedAt: "2026-11-26T00:00:00Z" }),
      entry("手動新", { source: "manual", createdAt: "2026-11-01 00:00:00" }),
      entry("未改正", { correctionCount: 0, weight: 9999 }),
      entry("最多", { correctionCount: 4 }),
    ], [], true, now)).toEqual(["手動新", "手動舊", "最多", "AI新", "AI舊"]);
  });
  it("滿8筆且30天未改正才排除，手動／智慧學詞關閉不排除；改正後恢復", () => {
    const vocabulary = [entry("React"), entry("Tauri", { source: "manual" })];
    const texts = Array(8).fill("React Tauri");
    expect(selectWhisperVocabulary(vocabulary, texts, true, now)).toEqual(["Tauri"]);
    expect(selectWhisperVocabulary(vocabulary, texts, false, now)).toContain("React");
    expect(selectWhisperVocabulary(vocabulary, texts.slice(1), true, now)).toContain("React");
    expect(selectWhisperVocabulary([entry("React", { lastCorrectedAt: "2026-10-28 00:00:00" })], texts, true, now)).toEqual([]);
    expect(selectWhisperVocabulary([entry("React", { lastCorrectedAt: "2026-10-28 00:00:01" })], texts, true, now)).toEqual(["React"]);
  });
  it("只計最近300筆、每筆最多一次、遵守英文詞界", () => {
    expect(selectWhisperVocabulary([entry("React")], [...Array(300).fill("Preact Reacts"), ...Array(8).fill("React")], true, now)).toEqual(["React"]);
    expect(selectWhisperVocabulary([entry("React")], ["React ".repeat(8)], true, now)).toEqual(["React"]);
  });
  it("同改正次數的日期排序對輸入順序不敏感，null排最後", () => {
    const rows = [entry("舊", { lastCorrectedAt: "2026-09-01 00:00:00" }), entry("新", { lastCorrectedAt: "2026-11-01 00:00:00" }), entry("無日期")];
    for (const list of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
      expect(selectWhisperVocabulary(list, [], true, now)).toEqual(["新", "舊", "無日期"]);
    }
  });
  it("超過50詞仍交完整排序給A0位元組裁切", () => {
    expect(selectWhisperVocabulary(Array.from({ length: 60 }, (_, i) => entry(`詞${i}`, { source: "manual" })), [], true, now)).toHaveLength(60);
  });
});

describe("AI 選詞", () => {
  it("只送收件匣確認過（applied）的配對；未確認（suggested）與已駁回（dismissed）都不送", () => {
    const vocabulary = [entry("Tauri"), entry("Supabase"), entry("Golang")];
    const replacements = [pair("Tauri", "陶里"), pair("Supabase", "super base", "dismissed"), pair("Golang", "go lang", "applied")];
    expect(selectAiVocabulary(vocabulary, replacements, "陶里、super base、go lang")).toEqual([
      { term: "Golang", replacements: ["go lang"] },
    ]);
    expect(selectAiVocabulary([entry("Supabase")], [pair("Supabase", "base")], "database")).toEqual([]);
  });
  it("兩字詞冷啟動、同位置門檻含中日韓，非同位或跨文字系統不猜近音", () => {
    expect(selectAiVocabulary([entry("阿欽"), entry("台積電"), entry("ヘリノックス"), entry("쿠버네티스"), entry("Tauri")], [], "阿親 台灣電 ヘリノクス 쿠버네티즈 陶里").map((row) => row.term)).toEqual(expect.arrayContaining(["阿欽", "台積電", "ヘリノックス", "쿠버네티스"]));
    expect(selectAiVocabulary([entry("台積電"), entry("Tauri")], [], "電積台 陶里")).toEqual([]);
  });
  it("拉丁詞不分大小寫，編輯距離上限floor(長度/3)，短詞需全等", () => {
    expect(selectAiVocabulary([entry("Kubernetes"), entry("Go"), entry("Supabase")], [], "KUBERNETS go supa").map((row) => row.term)).toEqual(["Go", "Kubernetes"]);
    expect(selectAiVocabulary([entry("Go")], [], "got")).toEqual([]);
    expect(selectAiVocabulary([entry("Go")], [], "Use Go.")).toEqual([{ term: "Go", replacements: [] }]);
  });
  it("拉丁詞的組合標記不可被切成詞界，NFC／NFD都不選前綴", () => {
    expect(selectAiVocabulary([entry("Go")], [], "Gödel")).toEqual([]);
    expect(selectAiVocabulary([entry("Go")], [], "Go\u0308del")).toEqual([]);
    expect(selectAiVocabulary([entry("Dr.Go")], [], "Dr.Go\u0308del")).toEqual([]);
  });
  it("符號結尾的拉丁詞不可命中較長單字，獨立符號詞與中文包覆仍可入選", () => {
    expect(selectAiVocabulary([entry("C++"), entry("C#")], [], "C++Builder C#Builder")).toEqual([]);
    expect(selectAiVocabulary([entry("C++"), entry("C#"), entry("Go")], [], "C++ C# 使用Go開發").map((row) => row.term)).toEqual(["C++", "C#", "Go"]);
  });
  it("排序為配對→同位置比例→手動→改正次數，上限20", () => {
    const vocabulary = [entry("阿芹", { correctionCount: 2 }), entry("台積電"), entry("阿沁", { source: "manual" }), entry("阿欽", { correctionCount: 50 }), entry("Tauri")];
    expect(selectAiVocabulary(vocabulary, [pair("Tauri", "陶里", "applied")], "阿親 台灣電 陶里").map((row) => row.term)).toEqual(["Tauri", "台積電", "阿沁", "阿欽", "阿芹"]);
    expect(selectAiVocabulary(Array.from({ length: 25 }, (_, i) => entry(`Term${i}`)), [], Array.from({ length: 25 }, (_, i) => `Term${i}`).join(" "))).toHaveLength(20);
  });
  it("同詞多個近似片段取最高比例，不能被後面的較差命中覆蓋", () => {
    expect(selectAiVocabulary([entry("台積電"), entry("台灣電")], [], "台積電和台灣電").map((row) => row.term)).toEqual(["台積電", "台灣電"]);
    expect(selectAiVocabulary([entry("abcdeg"), entry("abcdef")], [], "abxdef abxdey").map((row) => row.term)).toEqual(["abcdef", "abcdeg"]);
  });
  it("拉丁候選依同位置比例排序，編輯距離過關但比例0仍入選", () => {
    expect(selectAiVocabulary([entry("abcdef"), entry("xbcdef")], [], "xabcde").map((row) => row.term)).toEqual(["xbcdef", "abcdef"]);
  });
  it("無候選回空陣列", () => {
    expect(selectAiVocabulary([entry("Kubernetes"), entry("阿欽")], [], "今天天氣很好")).toEqual([]);
  });
});

describe("詞界與字元索引", () => {
  it("NFC／NFD的拉丁重音詞都不可命中Go前綴", () => {
    expect(findTermOccurrences("Gödel", "Go")).toEqual([]);
    expect(findTermOccurrences("Go\u0308del", "Go")).toEqual([]);
  });
  it("符號結尾仍檢查後方拉丁詞界，中文包覆不影響命中", () => {
    expect(findTermOccurrences("C++Builder", "C++")).toEqual([]);
    expect(findTermOccurrences("C#Builder", "C#")).toEqual([]);
    expect(findTermOccurrences("C++ C#", "C++")).toEqual([0]);
    expect(findTermOccurrences("C++ C#", "C#")).toEqual([4]);
    expect(findTermOccurrences("使用Go開發", "Go")).toEqual([2]);
  });
  it("拉丁重音、符號詞、混合文字、emoji前綴與重複出現", () => {
    expect(findTermOccurrences("😀中文React，react Reacts Preact", "React")).toEqual([3, 9]);
    expect(findTermOccurrences("Fjällräven Fjällrävens", "Fjällräven")).toEqual([0]);
    expect(findTermOccurrences("C++ C# C++", "C++")).toEqual([0, 7]);
  });
});
