import { describe, expect, it } from "vitest";
import {
  getAutoLanguagePrompt,
  getPromptForModeAndLocale,
} from "../../src/i18n/prompts";

// #83：辨識語言設為「自動」時整理不該翻譯。本檔守住「辨識語言明確設定的人什麼都沒變」。
describe("prompts — 輸出語言插槽（#83）", () => {
  const modes = ["minimal", "active"] as const;

  describe("[AC3] 明確語言：指示寫出該語言的語言句", () => {
    const explicit = {
      minimal: { "zh-TW": "繁體中文 zh-TW。", en: "Use English.", ja: "日本語を使用。", "zh-CN": "简体中文 zh-CN。", ko: "한국어 사용." },
      active: { "zh-TW": "，使用繁體中文", en: ", in English", ja: "日本語で", "zh-CN": "，使用简体中文", ko: "한국어로 " },
    } as const;
    for (const mode of modes) {
      for (const [locale, rule] of Object.entries(explicit[mode])) {
        it(`${mode} × ${locale}`, () => {
          expect(getPromptForModeAndLocale(mode, locale as keyof (typeof explicit)[typeof mode])).toContain(rule);
        });
      }
    }
  });

  const count = (text: string, word: string) => text.split(word).length - 1;

  describe("[AC1] 自動＋英文介面：不再要求輸出英文", () => {
    for (const mode of modes) {
      it(mode, () => {
        const prompt = getAutoLanguagePrompt(mode, "en");
        expect(prompt).not.toContain("Use English");
        expect(prompt).not.toContain("in English");
        expect(prompt).toMatch(/same language as the input|Keep the input language/);
      });
    }
  });

  describe("[AC2] 自動＋中文介面：中文才統一繁簡，且只出現在條件句裡", () => {
    const cases = [
      { locale: "zh-TW", script: "繁體中文", condition: "若是中文，使用繁體中文" },
      { locale: "zh-CN", script: "简体中文", condition: "若是中文，使用简体中文" },
    ] as const;
    for (const mode of modes) {
      for (const { locale, script, condition } of cases) {
        it(`${mode} × ${locale}`, () => {
          const prompt = getAutoLanguagePrompt(mode, locale);
          expect(count(prompt, script)).toBe(1);
          expect(prompt).toContain(condition);
        });
      }
    }
  });

  describe("[AC5] 非中文介面沒有殘留的強制語言；積極版保留「直接輸出」", () => {
    const languageNames = { en: "English", ja: "日本語", ko: "한국어" } as const;
    for (const mode of modes) {
      for (const [locale, name] of Object.entries(languageNames)) {
        it(`${mode} × ${locale} 不含「${name}」`, () => {
          expect(getAutoLanguagePrompt(mode, locale as keyof typeof languageNames)).not.toContain(name);
        });
      }
    }

    const directOutput = {
      "zh-TW": "直接輸出處理後的文字",
      "zh-CN": "直接输出处理后的文字",
      en: "Output the processed text directly",
      ja: "直接出力してください",
      ko: "직접 출력하세요",
    } as const;
    for (const [locale, phrase] of Object.entries(directOutput)) {
      it(`active × ${locale} 保留直接輸出`, () => {
        expect(getAutoLanguagePrompt("active", locale as keyof typeof directOutput)).toContain(phrase);
      });
    }
  });
});
