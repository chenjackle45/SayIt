/**
 * 自訂鍵錄製失敗的一鍵回報（gh-30）：把版本、平台、觸發鍵設定與 Rust 端的錄製診斷日誌
 * 組成回報者看得到的純文字，並產生 GitHub「新 issue」預填連結。
 *
 * 純函式、不依賴 Tauri；取快照與開連結由呼叫端（SettingsView）做。
 */

export type HotkeyRecordingFailureKind =
  | "timeout"
  | "start-failed"
  | "rejected";

export interface HotkeyDiagnosticsInput {
  appVersion: string;
  userAgent: string;
  uiLocale: string;
  triggerMode: string;
  triggerKeyLabel: string;
  failureKind: HotkeyRecordingFailureKind;
  /** rejected 時的固定原因（例如 esc_reserved） */
  failureReason?: string;
  /** Rust `get_hotkey_recording_diagnostics` 的快照（舊 → 新） */
  logLines: string[];
}

export const ISSUE_URL_BUDGET_CHARS = 8000;
const ISSUES_NEW_URL = "https://github.com/chenjackle45/SayIt/issues/new";

/** 從 userAgent 取平台摘要，不放整串 UA */
export function summarizePlatform(userAgent: string): string {
  if (userAgent.includes("Windows")) return "Windows";
  if (userAgent.includes("Mac")) return "macOS";
  if (userAgent.includes("Linux")) return "Linux";
  return "unknown";
}

function headerLines(input: HotkeyDiagnosticsInput): string[] {
  const failure =
    input.failureKind === "rejected" && input.failureReason
      ? `${input.failureKind} (${input.failureReason})`
      : input.failureKind;
  return [
    `SayIt v${input.appVersion} · ${summarizePlatform(input.userAgent)} · UI ${input.uiLocale}`,
    `Trigger: mode=${input.triggerMode} · key=${input.triggerKeyLabel}`,
    `Failure: ${failure}`,
    "",
    "（請補一句：按了哪顆鍵？按錄製後有沒有先切到別的視窗？）",
    "",
    "--- hotkey recording log（只含快捷鍵相關：鍵碼、修飾鍵、階段；不含轉錄內容）---",
  ];
}

/** 完整診斷文字（複製用，含全部日誌行） */
export function buildHotkeyDiagnosticsText(input: HotkeyDiagnosticsInput): string {
  return [...headerLines(input), ...input.logLines].join("\n");
}

export function issueTitleFor(input: HotkeyDiagnosticsInput): string {
  return `自訂觸發鍵錄製沒反應（${summarizePlatform(input.userAgent)}）`;
}

function encodeIssueUrl(title: string, body: string): string {
  return `${ISSUES_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * GitHub 預填連結：完整編碼後的 URL 必須在預算內；超過就從最舊的日誌行開始丟、重新編碼，
 * 直到符合或日誌全部丟光（標頭永遠保留）。
 */
export function buildGitHubIssueUrl(
  input: HotkeyDiagnosticsInput,
  budgetChars: number = ISSUE_URL_BUDGET_CHARS,
): { url: string; droppedLines: number } {
  const title = issueTitleFor(input);
  const header = headerLines(input);
  let lines = [...input.logLines];
  let dropped = 0;
  for (;;) {
    const body = [...header, ...lines].join("\n");
    const url = encodeIssueUrl(title, body);
    if (url.length <= budgetChars || lines.length === 0) {
      return { url, droppedLines: dropped };
    }
    lines = lines.slice(1);
    dropped += 1;
  }
}
