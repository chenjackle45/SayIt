import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { ref } from "vue";
import { API_KEY_MISSING_ERROR, extractErrorMessage } from "../lib/errorUtils";
import {
  initializeMicrophone,
  startRecording,
  stopRecording,
} from "../lib/recorder";
import { transcribeAudio } from "../lib/transcriber";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  VOICE_FLOW_STATE_CHANGED,
} from "../composables/useTauriEvents";
import type { HotkeyErrorPayload, HotkeyEventPayload } from "../types/events";
import type { HudStatus } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 2000;
const EMPTY_TRANSCRIPTION_ERROR_MESSAGE = "未偵測到語音";
const RECORDING_MESSAGE = "錄音中...";
const TRANSCRIBING_MESSAGE = "轉錄中...";
const PASTE_SUCCESS_MESSAGE = "已貼上 ✓";

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  const isRecording = ref<boolean>(false);
  let recordingStartTime = 0;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  function getAppWindow() {
    if (!cachedAppWindow) cachedAppWindow = getCurrentWindow();
    return cachedAppWindow;
  }

  function writeInfoLog(logMessage: string) {
    void invoke("debug_log", { level: "info", message: logMessage });
  }

  function writeErrorLog(logMessage: string) {
    void invoke("debug_log", { level: "error", message: logMessage });
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function emitVoiceFlowStateChanged(
    nextStatus: HudStatus,
    nextMessage = "",
  ): void {
    const payload: VoiceFlowStateChangedPayload = {
      status: nextStatus,
      message: nextMessage,
    };
    void emit(VOICE_FLOW_STATE_CHANGED, payload);
  }

  async function showHud() {
    const window = getAppWindow();
    await window.show();
    await window.setIgnoreCursorEvents(true);
  }

  async function hideHud() {
    await getAppWindow().hide();
  }

  function transitionTo(nextStatus: HudStatus, nextMessage = "") {
    clearAutoHideTimer();
    status.value = nextStatus;
    message.value = nextMessage;
    emitVoiceFlowStateChanged(nextStatus, nextMessage);

    if (nextStatus === "idle") {
      hideHud().catch((err) =>
        writeErrorLog(
          `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
        ),
      );
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) =>
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        ),
      );
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) =>
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        ),
      );
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud().catch((err) =>
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        ),
      );
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, ERROR_DISPLAY_DURATION_MS);
    }
  }

  function failRecordingFlow(errorMessage: string, logMessage: string) {
    isRecording.value = false;
    transitionTo("error", errorMessage);
    writeErrorLog(logMessage);
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    recordingStartTime = performance.now();

    try {
      await initializeMicrophone();
      startRecording();
      transitionTo("recording", RECORDING_MESSAGE);
      writeInfoLog("useVoiceFlowStore: recording started");
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${errorMessage}`,
      );
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;

    try {
      transitionTo("transcribing", TRANSCRIBING_MESSAGE);
      const audioBlob = await stopRecording();
      const recordingDurationMs = performance.now() - recordingStartTime;
      const settingsStore = useSettingsStore();
      const apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        failRecordingFlow(
          API_KEY_MISSING_ERROR,
          "useVoiceFlowStore: missing API key while transcribing",
        );
        return;
      }

      const result = await transcribeAudio(audioBlob, apiKey);

      if (!result.rawText) {
        failRecordingFlow(
          EMPTY_TRANSCRIPTION_ERROR_MESSAGE,
          "useVoiceFlowStore: transcription returned empty text",
        );
        return;
      }

      transitionTo("idle");
      await invoke("paste_text", { text: result.rawText });
      isRecording.value = false;
      transitionTo("success", PASTE_SUCCESS_MESSAGE);

      writeInfoLog(
        `useVoiceFlowStore: pasted text, recordingDurationMs=${Math.round(
          recordingDurationMs,
        )}, transcriptionDurationMs=${Math.round(result.transcriptionDurationMs)}`,
      );
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: stop recording failed: ${errorMessage}`,
      );
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

    try {
      await initializeMicrophone();
      writeInfoLog("useVoiceFlowStore: microphone initialized");
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      writeErrorLog(
        `useVoiceFlowStore: microphone initialization failed: ${errorMessage}`,
      );
    }

    const listeners = await Promise.all([
      listen(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listen(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }

        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const errorMessage = event.payload.message;
        transitionTo("error", errorMessage);
        writeErrorLog(`useVoiceFlowStore: hotkey error: ${errorMessage}`);
      }),
    ]);
    unlistenFunctions.push(...listeners);
  }

  function cleanup() {
    clearAutoHideTimer();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    initialize,
    cleanup,
    transitionTo,
  };
});
