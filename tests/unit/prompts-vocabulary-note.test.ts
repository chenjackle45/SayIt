import { describe, expect, it } from "vitest";
import { getVocabularyNoteForLocale } from "../../src/i18n/prompts";

// #84：字典清單前的說明句；v0.17 改版措辭的實測見 docs/plan-vocab-prompt-optimization.md 評估。
describe("prompts — 字典說明句（#84）", () => {
  // v0.17：改兩段（聽錯配對＋可能的專有名詞），不再壓過「不確定就不改」；新措辭由 v0.17 評估重測
  it("zh-TW 說明聽錯配對、且不再優先於「不確定就不改」", () => {
    const note = getVocabularyNoteForLocale("zh-TW");
    expect(note).toContain("「A → B」是已知的聽錯配對");
    expect(note).toContain("依上下文確實指這個詞時才改");
    expect(note).not.toContain("優先於");
  });

  it("粵語沿用 zh-TW 句", () => {
    expect(getVocabularyNoteForLocale("yue")).toBe(
      getVocabularyNoteForLocale("zh-TW"),
    );
  });

  it("其他語系各有自己語言的句子（不是退回 zh-TW）", () => {
    const zhTw = getVocabularyNoteForLocale("zh-TW");
    expect(getVocabularyNoteForLocale("zh-CN")).toContain("用户词典");
    expect(getVocabularyNoteForLocale("en")).toContain("user's dictionary");
    expect(getVocabularyNoteForLocale("ja")).toContain("ユーザー辞書");
    expect(getVocabularyNoteForLocale("ko")).toContain("사용자 사전");
    for (const locale of ["zh-CN", "en", "ja", "ko"] as const) {
      expect(getVocabularyNoteForLocale(locale)).not.toBe(zhTw);
    }
  });
});
