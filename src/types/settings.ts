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

export type TriggerKey = PresetTriggerKey | CustomTriggerKey | ComboTriggerKey;

export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
  return typeof key === "string";
}

export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
  return typeof key === "object" && key !== null && "custom" in key;
}

export function isComboTriggerKey(key: TriggerKey): key is ComboTriggerKey {
  return typeof key === "object" && key !== null && "combo" in key;
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
