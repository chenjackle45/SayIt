/**
 * gh-78：Windows 上 SayIt 視窗有焦點時，全域鍵盤 hook 收不到任何事件（#78 日誌只有
 * started → timeout）。錄製自訂鍵期間改由 WebView 自己的 keydown／keyup 當第二來源，
 * 規則鏡像 Rust `RecordingState`（held＋snapshot、先放的不算、錄製前按住的不算）。
 * 只在 Windows 啟用（macOS 的 tap 不受焦點影響，且 DOM 看不到 Fn 鍵）。
 */
import { getPlatformKeycode, isPresetEquivalentKey } from "../lib/keycodeMap";
import type { RecordingCapturedPayload, RecordingRejectedPayload } from "../types/events";
import type { ModifierFlag } from "../types/settings";

/** 本來源只在 Windows 啟用：鍵碼固定查 Windows VK 表，不看 navigator.userAgent。 */
const WINDOWS_USER_AGENT = "Windows";

const MODIFIER_FAMILY: Record<string, ModifierFlag> = {
  ShiftLeft: "shift",
  ShiftRight: "shift",
  ControlLeft: "control",
  ControlRight: "control",
  AltLeft: "option",
  AltRight: "option",
  MetaLeft: "command", // Win 鍵歸 command，與 Rust `modifier_family_windows` 一致
  MetaRight: "command",
};

export type DomRecordingResult =
  | { kind: "captured"; payload: RecordingCapturedPayload }
  | { kind: "rejected"; payload: RecordingRejectedPayload }
  /** 字母／數字位置但 `key` 不可定 VK（IME "Process"、AltGr、Dead、Shift+數字）：本輪交回 hook */
  | { kind: "unresolvable" }
  | null;

/**
 * DOM 事件 → Windows VK。字母／數字的 VK 跟鍵盤配置走（VK_A..Z＝'A'..'Z'、VK_0..9＝'0'..'9'），
 * 所以用 `key` 推，不用實體位置 `code`（AZERTY 的 KeyQ 是字母 A）。其他鍵沿用 code 表。
 */
export function windowsVkFromKeyEvent(code: string, key: string): number | null | "unresolvable" {
  if (/^Key[A-Z]$/.test(code)) {
    return /^[a-zA-Z]$/.test(key) ? key.toUpperCase().charCodeAt(0) : "unresolvable";
  }
  if (/^Digit[0-9]$/.test(code)) {
    return /^[0-9]$/.test(key) ? key.charCodeAt(0) : "unresolvable";
  }
  return getPlatformKeycode(code, WINDOWS_USER_AGENT);
}

function flagsFromCodes(codes: readonly string[]): ModifierFlag[] {
  const flags: ModifierFlag[] = [];
  for (const code of codes) {
    const flag = MODIFIER_FAMILY[code];
    if (flag && !flags.includes(flag)) flags.push(flag);
  }
  return flags;
}

/** 純函式狀態機，鏡像 Rust `RecordingState`。 */
export function createDomRecordingState() {
  let held: string[] = [];
  let snapshot: string[] = [];

  function reset() {
    held = [];
    snapshot = [];
  }

  function onKeyDown(code: string, key: string): DomRecordingResult {
    if (code === "Escape") {
      reset();
      return { kind: "rejected", payload: { reason: "esc_reserved" } };
    }
    if (isPresetEquivalentKey(code)) {
      if (held.includes(code)) return null; // autorepeat 的重複 down
      held.push(code);
      snapshot = [...held];
      return null;
    }
    const keycode = windowsVkFromKeyEvent(code, key);
    if (keycode === "unresolvable") {
      reset();
      return { kind: "unresolvable" };
    }
    if (keycode === null) return null; // 表中沒有的鍵（F23、NumpadEnter…）：忽略、繼續錄
    const modifiers = flagsFromCodes(held);
    reset();
    return { kind: "captured", payload: { keycode, modifiers, chordKeycodes: [] } };
  }

  function onKeyUp(code: string): DomRecordingResult {
    if (!held.includes(code)) return null; // 錄製前就按住、或失焦期間漏掉 down 的鍵
    held = held.filter((c) => c !== code);
    if (held.length > 0) return null;
    const keycodes = snapshot
      .map((c) => getPlatformKeycode(c, WINDOWS_USER_AGENT))
      .filter((kc): kc is number => kc !== null);
    reset();
    const keycode = keycodes[keycodes.length - 1]; // snapshot 只來自修飾鍵 down，八顆在 Windows 表都有鍵碼
    return {
      kind: "captured",
      payload: { keycode, modifiers: [], chordKeycodes: keycodes.length >= 2 ? keycodes : [] },
    };
  }

  return { onKeyDown, onKeyUp, reset };
}

export interface DomHotkeyRecorderCallbacks {
  onCaptured: (payload: RecordingCapturedPayload) => void;
  onRejected: (payload: RecordingRejectedPayload) => void;
}

/**
 * 掛載層：在 window 的 capture 階段聽 keydown／keyup／blur。
 * 錄製期間按鍵不打進頁面、bubble 階段的鍵盤 listener（側欄 Ctrl+B）也不收到。
 * window blur 或遇到不可定鍵碼即停用本輪（不自動恢復）：只看過半段手勢的來源不能決定結果。
 */
export function createDomHotkeyRecorder() {
  const state = createDomRecordingState();
  let callbacks: DomHotkeyRecorderCallbacks | null = null;
  let active = false;

  function stop() {
    if (!active) return;
    active = false;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    state.reset();
    callbacks = null;
  }

  function deliver(result: DomRecordingResult) {
    if (!result) return;
    const target = callbacks;
    stop();
    if (result.kind === "unresolvable" || !target) return;
    if (result.kind === "captured") target.onCaptured(result.payload);
    else target.onRejected(result.payload);
  }

  function onKeyDown(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    deliver(state.onKeyDown(event.code, event.key));
  }

  function onKeyUp(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    deliver(state.onKeyUp(event.code));
  }

  function onBlur() {
    stop();
  }

  /** 回傳是否真的掛上：視窗沒焦點時不掛（hook 會負責）。 */
  function start(next: DomHotkeyRecorderCallbacks): boolean {
    stop();
    if (!document.hasFocus()) return false;
    callbacks = next;
    active = true;
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return true;
  }

  return {
    start,
    stop,
    get isActive() {
      return active;
    },
  };
}
