import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConvert = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/simplifiedToTraditional", () => ({
  convertSimplifiedToTraditional: mockConvert,
}));

import { applyTranscriptTextTransforms } from "../../src/lib/transcriptTextTransforms";

describe("applyTranscriptTextTransforms", () => {
  beforeEach(() => {
    mockConvert.mockReset().mockImplementation((t: string) => `[繁]${t}`);
  });

  it("[P1] zh-TW → 委派 convertSimplifiedToTraditional", () => {
    const result = applyTranscriptTextTransforms("简体", "zh-TW");
    expect(mockConvert).toHaveBeenCalledWith("简体");
    expect(result).toBe("[繁]简体");
  });

  it("[P1] 非 zh-TW（en）→ 原樣返回、不呼叫轉換", () => {
    const result = applyTranscriptTextTransforms("hello", "en");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("hello");
  });

  it("[P1] 非 zh-TW（zh-CN）→ 原樣返回、不轉換", () => {
    const result = applyTranscriptTextTransforms("简体内容", "zh-CN");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("简体内容");
  });

  it("[P2] 空字串 → 直接返回、不呼叫轉換", () => {
    const result = applyTranscriptTextTransforms("", "zh-TW");
    expect(mockConvert).not.toHaveBeenCalled();
    expect(result).toBe("");
  });
});
