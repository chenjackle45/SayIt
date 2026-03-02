import type { HudStatus, TriggerMode } from "./index";
import type { TranscriptionRecord } from "./transcription";

export interface VoiceFlowStateChangedPayload {
  status: HudStatus;
  message: string;
}

export type TranscriptionCompletedPayload = Pick<
  TranscriptionRecord,
  | "id"
  | "rawText"
  | "processedText"
  | "recordingDurationMs"
  | "transcriptionDurationMs"
  | "enhancementDurationMs"
  | "charCount"
  | "wasEnhanced"
>;

export interface SettingsUpdatedPayload {
  key: string;
  value: unknown;
}

export interface VocabularyChangedPayload {
  action: "added" | "removed";
  term: string;
}

export interface HotkeyEventPayload {
  mode: TriggerMode;
  action: "start" | "stop";
}

export const HOTKEY_ERROR_CODES = {
  ACCESSIBILITY_PERMISSION: "accessibility_permission",
  HOOK_INSTALL_FAILED: "hook_install_failed",
} as const;

export type HotkeyErrorCode =
  (typeof HOTKEY_ERROR_CODES)[keyof typeof HOTKEY_ERROR_CODES];

export interface HotkeyErrorPayload {
  error: HotkeyErrorCode;
  message: string;
}
