import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockInfo = vi.fn().mockResolvedValue(undefined);
const mockDebug = vi.fn().mockResolvedValue(undefined);
const mockWarn = vi.fn().mockResolvedValue(undefined);
const mockError = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-log", () => ({
  info: (m: string) => mockInfo(m),
  debug: (m: string) => mockDebug(m),
  warn: (m: string) => mockWarn(m),
  error: (m: string) => mockError(m),
}));

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockInfo.mockClear().mockResolvedValue(undefined);
    mockDebug.mockClear().mockResolvedValue(undefined);
    mockWarn.mockClear().mockResolvedValue(undefined);
    mockError.mockClear().mockResolvedValue(undefined);
  });

  it("[P0] setFileLoggingEnabled 應 invoke set_file_logging_enabled", async () => {
    const { setFileLoggingEnabled } = await import("../../src/lib/logger");
    await setFileLoggingEnabled(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_file_logging_enabled", {
      enabled: true,
    });
  });

  it("[P0] openLogFolder 應 invoke open_log_folder", async () => {
    const { openLogFolder } = await import("../../src/lib/logger");
    await openLogFolder();
    expect(mockInvoke).toHaveBeenCalledWith("open_log_folder");
  });

  it("[P0] logInfoLine / logErrorLine 應轉送到 plugin-log", async () => {
    const { logInfoLine, logErrorLine } = await import("../../src/lib/logger");
    logInfoLine("hello");
    logErrorLine("boom");
    expect(mockInfo).toHaveBeenCalledWith("hello");
    expect(mockError).toHaveBeenCalledWith("boom");
  });

  it("[P0] installConsoleForwarding 應轉送 console.* 並保留原始輸出", async () => {
    const saved = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    try {
      const realError = vi.fn();
      console.error = realError;
      const { installConsoleForwarding } = await import("../../src/lib/logger");
      installConsoleForwarding();

      console.error("boom", 42);
      // forwardConsole 以空格串接 stringify 後的參數
      expect(mockError).toHaveBeenCalledWith("boom 42");
      // 原始 console.error 仍被呼叫
      expect(realError).toHaveBeenCalled();

      console.warn("watch out");
      expect(mockWarn).toHaveBeenCalledWith("watch out");
    } finally {
      Object.assign(console, saved);
    }
  });

  it("[P1] installConsoleForwarding 應為冪等（只安裝一次）", async () => {
    const saved = {
      log: console.log,
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    try {
      console.error = vi.fn();
      const { installConsoleForwarding } = await import("../../src/lib/logger");
      installConsoleForwarding();
      installConsoleForwarding();

      console.error("once");
      expect(mockError).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(console, saved);
    }
  });

  it("[P1] 轉送的 Error 物件應序列化為 name: message", async () => {
    const saved = { error: console.error };
    try {
      console.error = vi.fn();
      const { installConsoleForwarding } = await import("../../src/lib/logger");
      installConsoleForwarding();

      console.error(new Error("kaboom"));
      expect(mockError).toHaveBeenCalledWith("Error: kaboom");
    } finally {
      Object.assign(console, saved);
    }
  });
});
