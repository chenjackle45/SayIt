import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { analyzeCorrections } from "../../src/lib/vocabularyAnalyzer";
import type { SupportedLocale } from "../../src/i18n/languageConfig";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(fetch).mockReset().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '["Tauri", " ", 2, "單", "Go"]' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) } as Response);
});
describe("B3 介面語言學詞指示", () => {
  it.each<[SupportedLocale, string]>([["zh-TW", "語音轉錄字典助手"], ["zh-CN", "语音转录词典助手"], ["en", "dictionary assistant"], ["ja", "辞書アシスタント"], ["ko", "사전 도우미"]])("%s 同送P/C，只回改後專有名詞", async (locale, phrase) => {
    const result = await analyzeCorrections("用陶里", "用 Tauri", "key", { locale });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toContain(phrase);
    expect(body.messages[1].content).toBe("<original>用陶里</original>\n<corrected>用 Tauri</corrected>");
    expect(result.suggestedTermList).toEqual(["Tauri", "Go"]);
    expect(result.usage?.totalTokens).toBe(15);
  });
});
