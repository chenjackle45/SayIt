import { describe, expect, it } from "vitest";
import { getVocabularyNoteForLocale } from "../../src/i18n/prompts";

// #84：字典清單前的說明句。zh-TW 版是真模型實測過的措辭（docs/plan-vocabulary-prompt-instruction.md），改動要重測。
describe("prompts — 字典說明句（#84）", () => {
  it("zh-TW 與實測措辭逐字相同", () => {
    expect(getVocabularyNoteForLocale("zh-TW")).toBe(
      "以下是使用者字典裡的專有名詞與正確寫法。逐字稿中與這些詞發音或拼法相近的詞，一律改成字典裡的寫法；這條優先於『不確定就不改』。例外：該詞在句中明顯是一般單字，或屬於另一個完整姓名（名加姓）時，保留原文。",
    );
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
