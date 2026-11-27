import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROMPTS,
  MINIMAL_PROMPTS,
  getMinimalPromptForLocale,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "../../src/i18n/prompts";

// gh-74：廣東話內建 prompt（不 mock，驗真實文案）
describe("prompts — 廣東話（yue）", () => {
  const cantoneseSentence =
    "輸入是廣東話口語，保留粵語用字與句式（我哋、嘅、唔、係、喺、咗、嘢、點解等），不要改寫成書面語或普通話說法";

  // v0.17：指示尾端加了範例；粵語版另配粵語範例，所以比對時先切掉範例段
  const bodyOf = (prompt: string) => prompt.split("\n\n範例：")[0];

  it("[P0] 精簡版：繁中版只換末尾語言句與範例，其餘逐字相同", () => {
    const zhTW = getMinimalPromptForLocale("zh-TW");
    const yue = getMinimalPromptForLocale("yue");
    const expected = bodyOf(zhTW).replace(/繁體中文 zh-TW。$/, `繁體中文。${cantoneseSentence}。`);
    expect(expected).not.toBe(bodyOf(zhTW));
    expect(bodyOf(yue)).toBe(expected);
    expect(yue).toContain("我哋聽日四點開會");
  });

  // 積極版維持 v0.16（使用者 2026-11-28 拍板只換精簡）
  it("[P0] 積極版：繁中版只換第 4 行語言句，其餘逐字相同", () => {
    const zhTW = getPromptForModeAndLocale("active", "zh-TW");
    const expected = zhTW.replace(
      "直接輸出處理後的文字，使用繁體中文\n",
      `直接輸出處理後的文字，使用繁體中文。${cantoneseSentence}\n`,
    );
    expect(expected).not.toBe(zhTW);
    expect(getPromptForModeAndLocale("active", "yue")).toBe(expected);
  });

  it("[P1] isKnownDefaultPrompt 認得 yue 的精簡與積極兩款", () => {
    expect(isKnownDefaultPrompt(MINIMAL_PROMPTS.yue)).toBe(true);
    expect(isKnownDefaultPrompt(ACTIVE_PROMPTS.yue)).toBe(true);
  });
});
