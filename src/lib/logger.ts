import { invoke } from "@tauri-apps/api/core";
import {
  debug as logDebug,
  info as logInfo,
  warn as logWarn,
  error as logError,
} from "@tauri-apps/plugin-log";

/**
 * 前端 Log 轉送：把 `console.*` 與 VoiceFlow 的 writeInfoLog/writeErrorLog
 * 轉送到官方 `tauri-plugin-log`。是否真正寫入檔案由 Rust 端的 `FILE_LOG_ENABLED`
 * 旗標（`set_file_logging_enabled` command）決定，因此前端一律轉送、不在本地閘控，
 * 以避免跨視窗旗標同步問題；停用時 Rust 的 `.filter` 會直接丟棄，不會寫檔。
 */

let consoleForwardingInstalled = false;

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

type PluginLogFn = (message: string) => Promise<void>;

function forwardConsole(
  fnName: "log" | "debug" | "info" | "warn" | "error",
  logFn: PluginLogFn,
): void {
  const original = console[fnName].bind(console);
  console[fnName] = (...args: unknown[]) => {
    original(...args);
    void logFn(args.map(stringifyArg).join(" ")).catch(() => {
      /* 轉送失敗不可影響應用本身 */
    });
  };
}

/**
 * 安裝 `console.*` → plugin-log 轉送。每個 WebView 只需安裝一次；
 * 應在進入點最早期呼叫，才能涵蓋之後所有 console 輸出。
 */
export function installConsoleForwarding(): void {
  if (consoleForwardingInstalled) return;
  consoleForwardingInstalled = true;
  forwardConsole("log", logInfo);
  forwardConsole("debug", logDebug);
  forwardConsole("info", logInfo);
  forwardConsole("warn", logWarn);
  forwardConsole("error", logError);
}

/** 寫一筆 info 級 log（供 useVoiceFlowStore 的 writeInfoLog 使用）。 */
export function logInfoLine(message: string): void {
  void logInfo(message).catch(() => {});
}

/** 寫一筆 error 級 log（供 useVoiceFlowStore 的 writeErrorLog 使用）。 */
export function logErrorLine(message: string): void {
  void logError(message).catch(() => {});
}

/** 通知 Rust 切換檔案 Log 開關（即時生效，免重啟）。 */
export async function setFileLoggingEnabled(enabled: boolean): Promise<void> {
  await invoke("set_file_logging_enabled", { enabled });
}

/** 以系統檔案管理員開啟 Log 資料夾。 */
export async function openLogFolder(): Promise<void> {
  await invoke("open_log_folder");
}
