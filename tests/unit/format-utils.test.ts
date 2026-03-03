import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatDuration,
  formatDurationMs,
} from "../../src/lib/formatUtils";
import type { TranscriptionRecord } from "../../src/types/transcription";

describe("formatUtils.ts", () => {
  describe("formatTimestamp", () => {
    it("應格式化有效的 timestamp", () => {
      const result = formatTimestamp(1700000000000);
      expect(result).toBeTruthy();
      expect(result).not.toBe("-");
    });

    it("NaN 應回傳 '-'", () => {
      expect(formatTimestamp(NaN)).toBe("-");
    });

    it("Infinity 應回傳 '-'", () => {
      expect(formatTimestamp(Infinity)).toBe("-");
    });

    it("-Infinity 應回傳 '-'", () => {
      expect(formatTimestamp(-Infinity)).toBe("-");
    });

    it("0 應回傳 '-'", () => {
      expect(formatTimestamp(0)).toBe("-");
    });

    it("負數應回傳 '-'", () => {
      expect(formatTimestamp(-1)).toBe("-");
    });
  });

  describe("truncateText", () => {
    it("短文字不應截斷", () => {
      expect(truncateText("短文字")).toBe("短文字");
    });

    it("超過 maxLength 應截斷並加省略號", () => {
      const longText = "a".repeat(60);
      const result = truncateText(longText, 50);
      expect(result).toBe("a".repeat(50) + "...");
    });

    it("空字串應回傳空字串", () => {
      expect(truncateText("")).toBe("");
    });

    it("自訂 maxLength 應正確運作", () => {
      expect(truncateText("12345678", 5)).toBe("12345...");
    });

    it("恰好等於 maxLength 不應截斷", () => {
      expect(truncateText("12345", 5)).toBe("12345");
    });
  });

  describe("getDisplayText", () => {
    it("有 processedText 時應回傳 processedText", () => {
      const record = {
        rawText: "原始",
        processedText: "處理後",
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("處理後");
    });

    it("processedText 為 null 時應回傳 rawText", () => {
      const record = {
        rawText: "原始",
        processedText: null,
      } as TranscriptionRecord;
      expect(getDisplayText(record)).toBe("原始");
    });
  });

  describe("formatDurationFromMs", () => {
    it("0 毫秒應回傳 '0 分鐘'", () => {
      expect(formatDurationFromMs(0)).toBe("0 分鐘");
    });

    it("30 秒應回傳 '0 分鐘'", () => {
      expect(formatDurationFromMs(30000)).toBe("1 分鐘");
    });

    it("5 分鐘應回傳 '5 分鐘'", () => {
      expect(formatDurationFromMs(300000)).toBe("5 分鐘");
    });

    it("90 分鐘應回傳 '1 小時 30 分鐘'", () => {
      expect(formatDurationFromMs(5400000)).toBe("1 小時 30 分鐘");
    });

    it("120 分鐘應回傳 '2 小時'", () => {
      expect(formatDurationFromMs(7200000)).toBe("2 小時");
    });
  });

  describe("formatDuration", () => {
    it("500ms 應回傳 '1 秒'", () => {
      expect(formatDuration(500)).toBe("1 秒");
    });

    it("5000ms 應回傳 '5 秒'", () => {
      expect(formatDuration(5000)).toBe("5 秒");
    });

    it("90000ms 應回傳 '1:30'", () => {
      expect(formatDuration(90000)).toBe("1:30");
    });

    it("65000ms 應回傳 '1:05'", () => {
      expect(formatDuration(65000)).toBe("1:05");
    });
  });

  describe("formatDurationMs", () => {
    it("500ms 應回傳 '500 ms'", () => {
      expect(formatDurationMs(500)).toBe("500 ms");
    });

    it("1500ms 應回傳 '1.5 秒'", () => {
      expect(formatDurationMs(1500)).toBe("1.5 秒");
    });

    it("0ms 應回傳 '0 ms'", () => {
      expect(formatDurationMs(0)).toBe("0 ms");
    });

    it("999ms 應回傳 '999 ms'", () => {
      expect(formatDurationMs(999)).toBe("999 ms");
    });
  });
});
