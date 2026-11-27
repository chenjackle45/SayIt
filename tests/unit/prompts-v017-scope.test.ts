import { describe, expect, it } from "vitest";
import { ACTIVE_PROMPTS, MINIMAL_PROMPTS, getVocabularyNoteForLocale } from "../../src/i18n/prompts";
import { buildEnhanceMessages } from "../../src/lib/enhanceMessages";
import * as v016 from "../../scripts/vocab-benchmark/baseline/prompts-v016";

// v0.17 只換精簡模式（使用者 2026-11-28 拍板：積極模式盲測新版獨有重大錯 3 > 舊版 1）
describe("v0.17 指示改版範圍", () => {
  it("積極模式六種語言與 v0.16 逐字相同", () => {
    expect(ACTIVE_PROMPTS).toEqual(v016.ACTIVE_PROMPTS);
  });

  it("精簡模式已改版（不等於 v0.16）", () => {
    expect(MINIMAL_PROMPTS["zh-TW"]).not.toBe(v016.MINIMAL_PROMPTS["zh-TW"]);
  });

  it("非改版內建指示（積極、自訂）：舊字典說明句、逐字稿不包標籤", () => {
    const [system, user] = buildEnhanceMessages("原文", {
      systemPrompt: "自訂",
      vocabularyTermList: ["Tauri"],
      promptLocale: "zh-TW",
    });
    expect(system.content).toContain(v016.getVocabularyNoteForLocale("zh-TW"));
    expect(user.content).toBe("原文");
  });

  it("改版內建指示（精簡）：新字典說明句、逐字稿包標籤", () => {
    const [system, user] = buildEnhanceMessages("原文", {
      systemPrompt: MINIMAL_PROMPTS["zh-TW"],
      vocabularyTermList: ["Tauri"],
      promptLocale: "zh-TW",
      isRevisedBuiltinPrompt: true,
    });
    expect(system.content).toContain(getVocabularyNoteForLocale("zh-TW", true));
    expect(system.content).not.toContain(v016.getVocabularyNoteForLocale("zh-TW"));
    expect(user.content).toBe("<transcript>\n原文\n</transcript>");
  });
});
