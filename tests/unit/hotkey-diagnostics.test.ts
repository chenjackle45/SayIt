import { describe, expect, it } from "vitest";
import {
  buildGitHubIssueUrl,
  buildHotkeyDiagnosticsText,
  issueTitleFor,
  summarizePlatform,
  type HotkeyDiagnosticsInput,
} from "../../src/composables/useHotkeyDiagnostics";

const base: HotkeyDiagnosticsInput = {
  appVersion: "0.13.1",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/130",
  uiLocale: "zh-TW",
  triggerMode: "toggle",
  triggerKeyLabel: "右 Alt",
  failureKind: "timeout",
  logLines: [
    "+100ms INFO [hotkey-listener] Recording mode started",
    "+105ms INFO [SettingsView] hotkey recording: listeners ready",
    "+10105ms INFO [SettingsView] hotkey recording: timeout fired",
  ],
};

describe("useHotkeyDiagnostics（gh-30 一鍵回報）", () => {
  it("[P0] 診斷文字含版本、平台、觸發鍵設定、失敗種類與全部日誌行", () => {
    const text = buildHotkeyDiagnosticsText(base);
    expect(text).toContain("SayIt v0.13.1 · Windows · UI zh-TW");
    expect(text).toContain("mode=toggle · key=右 Alt");
    expect(text).toContain("Failure: timeout");
    for (const line of base.logLines) expect(text).toContain(line);
    expect(text).not.toContain("Edge/130"); // 不放整串 UA
  });

  it("[P0] rejected 帶固定原因；標題依平台", () => {
    const text = buildHotkeyDiagnosticsText({
      ...base,
      failureKind: "rejected",
      failureReason: "esc_reserved",
    });
    expect(text).toContain("Failure: rejected (esc_reserved)");
    expect(issueTitleFor(base)).toBe("自訂觸發鍵錄製沒反應（Windows）");
    expect(summarizePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("macOS");
  });

  it("[P0] URL 在預算內時不丟行，且是完整編碼後的長度", () => {
    const { url, droppedLines } = buildGitHubIssueUrl(base);
    expect(droppedLines).toBe(0);
    expect(url.startsWith("https://github.com/chenjackle45/SayIt/issues/new?title=")).toBe(true);
    expect(url).toContain(encodeURIComponent("Failure: timeout"));
    expect(url.length).toBeLessThanOrEqual(8000);
  });

  it("[P0] 超過預算：從最舊日誌行開始丟、標頭永遠保留、結果仍在預算內", () => {
    const many = Array.from({ length: 300 }, (_, i) => `+${i}ms INFO [hotkey-listener] 中文行 ${i} & / # %`);
    const { url, droppedLines } = buildGitHubIssueUrl({ ...base, logLines: many }, 3000);
    expect(url.length).toBeLessThanOrEqual(3000);
    expect(droppedLines).toBeGreaterThan(0);
    expect(url).toContain(encodeURIComponent("Failure: timeout"));
    // 保留的是最新的行
    expect(url).toContain(encodeURIComponent("中文行 299"));
    expect(url).not.toContain(encodeURIComponent("中文行 0 "));
  });

  it("[P1] 單行超長也不會破壞參數：丟光日誌後只剩標頭", () => {
    const huge = ["x".repeat(20000)];
    const { url, droppedLines } = buildGitHubIssueUrl({ ...base, logLines: huge }, 3000);
    expect(droppedLines).toBe(1);
    expect(url).toContain("&body=");
    expect(url.length).toBeLessThanOrEqual(3000);
  });
});
