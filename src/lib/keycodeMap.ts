import {
  getHotkeyConflictWarning,
  getHotkeyCapslockWarning,
} from "./errorUtils";

/**
 * DOM event.code → 平台原生 keycode 映射模組
 *
 * macOS keycode: CGEvent keycode (u16)
 * Windows VK code: Virtual-Key code (u16)
 *
 * 注意：兩者數值體系完全不同（如 F5: macOS=96, Windows=0x74）。
 * keycode 為平台相依值，不可跨平台使用。
 */

// ─── macOS CGEvent keycodes ────────────────────────────────────

const DOM_CODE_TO_MAC_KEYCODE: Record<string, number> = {
  // Letters A-Z
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  KeyO: 31,
  KeyU: 32,
  KeyI: 34,
  KeyP: 35,
  KeyL: 37,
  KeyJ: 38,
  KeyK: 40,
  KeyN: 45,
  KeyM: 46,

  // Digits 0-9
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit5: 23,
  Digit6: 22,
  Digit7: 26,
  Digit8: 28,
  Digit9: 25,
  Digit0: 29,

  // Symbols
  Minus: 27,
  Equal: 24,
  BracketLeft: 33,
  BracketRight: 30,
  Backslash: 42,
  Semicolon: 41,
  Quote: 39,
  Backquote: 50,
  Comma: 43,
  Period: 47,
  Slash: 44,

  // Function keys F1-F12
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,

  // F13-F20
  F13: 105,
  F14: 107,
  F15: 113,
  F16: 106,
  F17: 64,
  F18: 79,
  F19: 80,
  F20: 90,

  // Navigation & editing
  Escape: 53,
  Tab: 48,
  CapsLock: 57,
  Space: 49,
  Enter: 36,
  Backspace: 51,
  Delete: 117,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,
  Insert: 114,

  // Modifiers
  ShiftLeft: 56,
  ShiftRight: 60,
  ControlLeft: 59,
  ControlRight: 62,
  AltLeft: 58,
  AltRight: 61,
  MetaLeft: 55,
  MetaRight: 54,

  // Numpad
  Numpad0: 82,
  Numpad1: 83,
  Numpad2: 84,
  Numpad3: 85,
  Numpad4: 86,
  Numpad5: 87,
  Numpad6: 88,
  Numpad7: 89,
  Numpad8: 91,
  Numpad9: 92,
  NumpadDecimal: 65,
  NumpadMultiply: 67,
  NumpadAdd: 69,
  NumpadSubtract: 78,
  NumpadDivide: 75,
  NumpadEnter: 76,
  NumpadEqual: 81,
  NumLock: 71,

  // Misc
  PrintScreen: 105, // F13 on Mac
  ScrollLock: 107, // F14 on Mac
  Pause: 113, // F15 on Mac
};

// ─── Windows Virtual-Key codes ─────────────────────────────────

const DOM_CODE_TO_WINDOWS_VK_CODE: Record<string, number> = {
  // Letters A-Z (VK_A=0x41 ... VK_Z=0x5A)
  KeyA: 0x41,
  KeyB: 0x42,
  KeyC: 0x43,
  KeyD: 0x44,
  KeyE: 0x45,
  KeyF: 0x46,
  KeyG: 0x47,
  KeyH: 0x48,
  KeyI: 0x49,
  KeyJ: 0x4a,
  KeyK: 0x4b,
  KeyL: 0x4c,
  KeyM: 0x4d,
  KeyN: 0x4e,
  KeyO: 0x4f,
  KeyP: 0x50,
  KeyQ: 0x51,
  KeyR: 0x52,
  KeyS: 0x53,
  KeyT: 0x54,
  KeyU: 0x55,
  KeyV: 0x56,
  KeyW: 0x57,
  KeyX: 0x58,
  KeyY: 0x59,
  KeyZ: 0x5a,

  // Digits 0-9 (VK_0=0x30 ... VK_9=0x39)
  Digit0: 0x30,
  Digit1: 0x31,
  Digit2: 0x32,
  Digit3: 0x33,
  Digit4: 0x34,
  Digit5: 0x35,
  Digit6: 0x36,
  Digit7: 0x37,
  Digit8: 0x38,
  Digit9: 0x39,

  // Symbols
  Minus: 0xbd, // VK_OEM_MINUS
  Equal: 0xbb, // VK_OEM_PLUS
  BracketLeft: 0xdb, // VK_OEM_4
  BracketRight: 0xdd, // VK_OEM_6
  Backslash: 0xdc, // VK_OEM_5
  Semicolon: 0xba, // VK_OEM_1
  Quote: 0xde, // VK_OEM_7
  Backquote: 0xc0, // VK_OEM_3
  Comma: 0xbc, // VK_OEM_COMMA
  Period: 0xbe, // VK_OEM_PERIOD
  Slash: 0xbf, // VK_OEM_2

  // Function keys F1-F12
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,

  // F13-F24
  F13: 0x7c,
  F14: 0x7d,
  F15: 0x7e,
  F16: 0x7f,
  F17: 0x80,
  F18: 0x81,
  F19: 0x82,
  F20: 0x83,

  // Navigation & editing
  Escape: 0x1b,
  Tab: 0x09,
  CapsLock: 0x14,
  Space: 0x20,
  Enter: 0x0d,
  Backspace: 0x08,
  Delete: 0x2e,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  ArrowUp: 0x26,
  ArrowDown: 0x28,
  ArrowLeft: 0x25,
  ArrowRight: 0x27,
  Insert: 0x2d,

  // Modifiers
  ShiftLeft: 0xa0, // VK_LSHIFT
  ShiftRight: 0xa1, // VK_RSHIFT
  ControlLeft: 0xa2, // VK_LCONTROL
  ControlRight: 0xa3, // VK_RCONTROL
  AltLeft: 0xa4, // VK_LMENU
  AltRight: 0xa5, // VK_RMENU
  MetaLeft: 0x5b, // VK_LWIN
  MetaRight: 0x5c, // VK_RWIN

  // Numpad
  Numpad0: 0x60,
  Numpad1: 0x61,
  Numpad2: 0x62,
  Numpad3: 0x63,
  Numpad4: 0x64,
  Numpad5: 0x65,
  Numpad6: 0x66,
  Numpad7: 0x67,
  Numpad8: 0x68,
  Numpad9: 0x69,
  NumpadDecimal: 0x6e,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDivide: 0x6f,
  // NumpadEnter omitted: VK 0x0D same as Enter, indistinguishable in hook
  NumpadEqual: 0x92, // VK_OEM_NEC_EQUAL
  NumLock: 0x90,

  // Misc
  PrintScreen: 0x2c, // VK_SNAPSHOT
  ScrollLock: 0x91,
  Pause: 0x13,
};

// ─── Display names ─────────────────────────────────────────────

const KEY_DISPLAY_NAMES: Record<string, string> = {
  // Letters
  KeyA: "A",
  KeyB: "B",
  KeyC: "C",
  KeyD: "D",
  KeyE: "E",
  KeyF: "F",
  KeyG: "G",
  KeyH: "H",
  KeyI: "I",
  KeyJ: "J",
  KeyK: "K",
  KeyL: "L",
  KeyM: "M",
  KeyN: "N",
  KeyO: "O",
  KeyP: "P",
  KeyQ: "Q",
  KeyR: "R",
  KeyS: "S",
  KeyT: "T",
  KeyU: "U",
  KeyV: "V",
  KeyW: "W",
  KeyX: "X",
  KeyY: "Y",
  KeyZ: "Z",

  // Digits
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",

  // Symbols
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",

  // Function keys
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  F13: "F13",
  F14: "F14",
  F15: "F15",
  F16: "F16",
  F17: "F17",
  F18: "F18",
  F19: "F19",
  F20: "F20",

  // Navigation & editing
  Escape: "Esc",
  Tab: "Tab",
  CapsLock: "CapsLock",
  Space: "Space",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Insert: "Insert",

  // Modifiers
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Control",
  ControlRight: "Right Control",
  AltLeft: "Left Alt/Option",
  AltRight: "Right Alt/Option",
  MetaLeft: "Left ⌘/Win",
  MetaRight: "Right ⌘/Win",

  // Numpad
  Numpad0: "Numpad 0",
  Numpad1: "Numpad 1",
  Numpad2: "Numpad 2",
  Numpad3: "Numpad 3",
  Numpad4: "Numpad 4",
  Numpad5: "Numpad 5",
  Numpad6: "Numpad 6",
  Numpad7: "Numpad 7",
  Numpad8: "Numpad 8",
  Numpad9: "Numpad 9",
  NumpadDecimal: "Numpad .",
  NumpadMultiply: "Numpad *",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
  NumpadDivide: "Numpad /",
  NumpadEnter: "Numpad Enter",
  NumpadEqual: "Numpad =",
  NumLock: "Num Lock",

  // Misc
  PrintScreen: "Print Screen",
  ScrollLock: "Scroll Lock",
  Pause: "Pause",
};

// ─── Dangerous keys ────────────────────────────────────────────

const DANGEROUS_KEYS: Set<string> = new Set([
  "Escape",
  "Enter",
  "Space",
  "Tab",
  "Backspace",
  "Delete",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "F1",
  "F11",
  "PrintScreen",
  "NumLock",
  "ScrollLock",
  "Insert",
  "Pause",
]);

// ─── Preset equivalent DOM codes ───────────────────────────────

const PRESET_DOM_CODES: Set<string> = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

// ─── Public API ────────────────────────────────────────────────

function isMacPlatform(userAgent?: string): boolean {
  const ua = userAgent ?? navigator.userAgent;
  return ua.includes("Mac");
}

export function getPlatformKeycode(
  domCode: string,
  userAgent?: string,
): number | null {
  const map = isMacPlatform(userAgent)
    ? DOM_CODE_TO_MAC_KEYCODE
    : DOM_CODE_TO_WINDOWS_VK_CODE;
  return map[domCode] ?? null;
}

export function getKeyDisplayName(domCode: string): string {
  return KEY_DISPLAY_NAMES[domCode] ?? domCode;
}

export function isDangerousKey(domCode: string): boolean {
  return DANGEROUS_KEYS.has(domCode);
}

export function isPresetEquivalentKey(domCode: string): boolean {
  return PRESET_DOM_CODES.has(domCode);
}

// macOS keycode 衝突：這些鍵與 F13-F15 共用 keycode，按其中一個會觸發另一個
const MAC_KEYCODE_COLLISION_KEYS: Set<string> = new Set([
  "PrintScreen", // keycode 105 = F13
  "ScrollLock", // keycode 107 = F14
  "Pause", // keycode 113 = F15
]);

export function getDangerousKeyWarning(domCode: string): string | null {
  if (!isDangerousKey(domCode)) return null;

  if (domCode === "CapsLock") {
    return getHotkeyCapslockWarning();
  }

  if (MAC_KEYCODE_COLLISION_KEYS.has(domCode) && isMacPlatform()) {
    const collisionMap: Record<string, string> = {
      PrintScreen: "F13",
      ScrollLock: "F14",
      Pause: "F15",
    };
    return `此按鍵在 macOS 上與 ${collisionMap[domCode]} 共用相同代碼，兩者會同時觸發`;
  }

  const displayName = getKeyDisplayName(domCode);
  return getHotkeyConflictWarning(displayName);
}
