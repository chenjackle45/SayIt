// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error 評估腳本是純 JS 模組，沒有型別宣告
import { formatNewWhisperPrompt } from "../../scripts/vocab-benchmark/arms-new.mjs";

describe("評估腳本與 Rust 的 Whisper 裁切語意", () => {
  it("前 50 個超長詞放不下，仍試第 51 個短詞", () => {
    expect(formatNewWhisperPrompt([...Array<string>(50).fill("a".repeat(896)), "Tauri"]))
      .toBe("Important Vocabulary: Tauri");
  });

  it("最多收 50 個，保持優先度並反轉", () => {
    expect(formatNewWhisperPrompt(Array.from({ length: 60 }, (_, i) => `t${i}`)))
      .toBe(`Important Vocabulary: ${Array.from({ length: 50 }, (_, i) => `t${49 - i}`).join(", ")}`);
  });
});
