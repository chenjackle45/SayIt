import type { TriggerMode } from "./index";
import type { LlmModelId, WhisperModelId, TranscriptionProvider } from "../lib/modelRegistry";

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

export type TriggerKey = PresetTriggerKey | CustomTriggerKey;

export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
  return typeof key === "string";
}

export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
  return typeof key === "object" && key !== null && "custom" in key;
}

export interface HotkeyConfig {
  triggerKey: TriggerKey;
  triggerMode: TriggerMode;
}

export interface SettingsDto {
  hotkeyConfig: HotkeyConfig | null;
  hasApiKey: boolean;
  aiPrompt: string;
  isEnhancementThresholdEnabled: boolean;
  enhancementThresholdCharCount: number;
  llmModelId: LlmModelId;
  whisperModelId: WhisperModelId;
  transcriptionProvider: TranscriptionProvider;
}
