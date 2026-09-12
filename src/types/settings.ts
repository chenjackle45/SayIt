import type { TriggerMode } from "./index";

export type PresetTriggerKey =
  | "fn"
  | "option"
  | "rightOption"
  | "command"
  | "rightAlt"
  | "leftAlt"
  | "control"
  | "rightControl"
  | "shift";

export interface CustomTriggerKey {
  custom: { keycode: number };
}

export type ModifierFlag = "command" | "control" | "option" | "shift" | "fn";

export interface ComboTriggerKey {
  combo: { modifiers: ModifierFlag[]; keycode: number };
}

/** gh-30：純修飾鍵組合（≥2 顆實體修飾鍵，平台鍵碼、左右分開）。只保證新版讀舊設定；舊版不認得這個形狀 */
export interface ChordTriggerKey {
  chord: { keycodes: number[] };
}

export type TriggerKey =
  | PresetTriggerKey
  | CustomTriggerKey
  | ComboTriggerKey
  | ChordTriggerKey;

export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
  return typeof key === "string";
}

export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
  return typeof key === "object" && key !== null && "custom" in key;
}

export function isComboTriggerKey(key: TriggerKey): key is ComboTriggerKey {
  return typeof key === "object" && key !== null && "combo" in key;
}

export function isChordTriggerKey(key: TriggerKey): key is ChordTriggerKey {
  return typeof key === "object" && key !== null && "chord" in key;
}

/** 錄製產生的三種非預設鍵（存進 customTriggerKey 槽） */
export function isRecordedTriggerKey(
  key: TriggerKey,
): key is CustomTriggerKey | ComboTriggerKey | ChordTriggerKey {
  return isCustomTriggerKey(key) || isComboTriggerKey(key) || isChordTriggerKey(key);
}

export interface HotkeyConfig {
  triggerKey: TriggerKey;
  triggerMode: TriggerMode;
}

export const PROMPT_MODE_VALUES = ["minimal", "active", "custom"] as const;
export type PromptMode = (typeof PROMPT_MODE_VALUES)[number];
export type PresetPromptMode = Exclude<PromptMode, "custom">;

export const THEME_MODE_VALUES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODE_VALUES)[number];
