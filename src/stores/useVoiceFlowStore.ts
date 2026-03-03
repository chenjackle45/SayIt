import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  API_KEY_MISSING_ERROR,
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { enhanceText, GROQ_LLM_MODEL } from "../lib/enhancer";
import { useVocabularyStore } from "./useVocabularyStore";
import { useHistoryStore } from "./useHistoryStore";
import type {
  TranscriptionRecord,
  ChatUsageData,
  ApiUsageRecord,
} from "../types/transcription";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../lib/apiPricing";
import { GROQ_MODEL as WHISPER_MODEL } from "../lib/transcriber";
import {
  initializeMicrophone,
  startRecording,
  stopRecording,
  createAudioAnalyser,
  destroyAudioAnalyser,
} from "../lib/recorder";
import type { AudioAnalyserHandle } from "../types/audio";
import { transcribeAudio } from "../lib/transcriber";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
} from "../types/events";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const EMPTY_TRANSCRIPTION_ERROR_MESSAGE = "未偵測到語音";
const NO_SPEECH_PROBABILITY_THRESHOLD = 0.9;

const WHISPER_HALLUCINATION_PHRASES = new Set([
  "谢谢大家",
  "謝謝大家",
  "感谢收看",
  "感謝收看",
  "Thanks for watching",
  "Thank you for watching",
  "Subtitles by",
]);

const WHISPER_HALLUCINATION_SUBSTRINGS = [
  "字幕由",
  "请不吝点赞",
  "請不吝點贊",
  "请订阅",
  "請訂閱",
  "点赞、订阅",
  "點贊、訂閱",
  "支持《明鏡》",
  "支持《點點》",
  "支持《点点》",
];

function isSilenceOrHallucination(
  rawText: string,
  noSpeechProbability: number,
): boolean {
  if (!rawText) return true;
  if (noSpeechProbability >= NO_SPEECH_PROBABILITY_THRESHOLD) return true;
  if (WHISPER_HALLUCINATION_PHRASES.has(rawText)) return true;
  return WHISPER_HALLUCINATION_SUBSTRINGS.some((sub) => rawText.includes(sub));
}
const RECORDING_MESSAGE = "錄音中...";
const TRANSCRIBING_MESSAGE = "轉錄中...";
const PASTE_SUCCESS_MESSAGE = "已貼上 ✓";
const ENHANCEMENT_CHAR_THRESHOLD = 10;
const ENHANCING_MESSAGE = "整理中...";
const PASTE_SUCCESS_UNENHANCED_MESSAGE = "已貼上（未整理）";

const MONITOR_POLL_INTERVAL_MS = 250;

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  const isRecording = ref<boolean>(false);
  const analyserHandle = ref<AudioAnalyserHandle | null>(null);
  const recordingElapsedSeconds = ref<number>(0);
  let recordingStartTime = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
  const COLLAPSE_HIDE_DELAY_MS = 400;
  const lastWasModified = ref<boolean | null>(null);
  let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMonitorKey = "";
  let isRepositioning = false;

  async function readClipboardText(): Promise<string | undefined> {
    try {
      const text = await navigator.clipboard.readText();
      return text?.trim() || undefined;
    } catch (err) {
      console.warn(
        "[useVoiceFlowStore] readClipboardText failed (HUD Window may not support Clipboard API):",
        err,
      );
      return undefined;
    }
  }

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

  function clearCollapseHideTimer() {
    if (collapseHideTimer) {
      clearTimeout(collapseHideTimer);
      collapseHideTimer = null;
    }
  }

  function startElapsedTimer() {
    recordingElapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => {
      recordingElapsedSeconds.value += 1;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    recordingElapsedSeconds.value = 0;
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

  async function repositionHudToCurrentMonitor() {
    if (isRepositioning) return;
    isRepositioning = true;
    try {
      const position = await invoke<HudTargetPosition>(
        "get_hud_target_position",
      );
      if (position.monitorKey !== lastMonitorKey) {
        lastMonitorKey = position.monitorKey;
        await getAppWindow().setPosition(
          new PhysicalPosition(position.x, position.y),
        );
      }
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: repositionHudToCurrentMonitor failed: ${extractErrorMessage(err)}`,
      );
    } finally {
      isRepositioning = false;
    }
  }

  function startMonitorPolling() {
    stopMonitorPolling();
    monitorPollTimer = setInterval(() => {
      void repositionHudToCurrentMonitor();
    }, MONITOR_POLL_INTERVAL_MS);
  }

  function stopMonitorPolling() {
    if (monitorPollTimer) {
      clearInterval(monitorPollTimer);
      monitorPollTimer = null;
    }
    lastMonitorKey = "";
    isRepositioning = false;
  }

  async function showHud() {
    const window = getAppWindow();
    lastMonitorKey = "";
    await repositionHudToCurrentMonitor();
    await window.show();
    await window.setIgnoreCursorEvents(true);
    startMonitorPolling();
  }

  async function hideHud() {
    await getAppWindow().hide();
  }

  function startQualityMonitorAfterPaste() {
    void invoke("start_quality_monitor").catch((err) =>
      writeErrorLog(
        `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      ),
    );
  }

  function saveTranscriptionRecord(record: TranscriptionRecord) {
    const historyStore = useHistoryStore();
    void historyStore
      .addTranscription(record)
      .catch((err) =>
        writeErrorLog(
          `useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`,
        ),
      );
  }

  function buildTranscriptionRecord(params: {
    rawText: string;
    processedText: string | null;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
  }): TranscriptionRecord {
    const settingsStore = useSettingsStore();
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      rawText: params.rawText,
      processedText: params.processedText,
      recordingDurationMs: Math.round(params.recordingDurationMs),
      transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
      enhancementDurationMs:
        params.enhancementDurationMs !== null
          ? Math.round(params.enhancementDurationMs)
          : null,
      charCount: (params.processedText ?? params.rawText).length,
      triggerMode: settingsStore.triggerMode,
      wasEnhanced: params.wasEnhanced,
      wasModified: null,
      createdAt: "",
    };
  }

  function transitionTo(nextStatus: HudStatus, nextMessage = "") {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    status.value = nextStatus;
    message.value = nextMessage;
    emitVoiceFlowStateChanged(nextStatus, nextMessage);

    if (nextStatus === "idle") {
      stopMonitorPolling();
      collapseHideTimer = setTimeout(() => {
        hideHud().catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
          ),
        );
      }, COLLAPSE_HIDE_DELAY_MS);
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
      showHud()
        .then(async () => {
          await getAppWindow().setIgnoreCursorEvents(false);
        })
        .catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
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

  async function completePasteFlow(params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
  }) {
    try {
      await invoke("paste_text", { text: params.text });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      saveTranscriptionRecord(params.record);
      saveApiUsageRecordList(params.record, params.chatUsage);
    } catch (pasteError) {
      isRecording.value = false;
      failRecordingFlow(
        "貼上失敗",
        `useVoiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
      );
    }
  }

  function saveApiUsageRecordList(
    record: TranscriptionRecord,
    chatUsage: ChatUsageData | null,
  ) {
    const historyStore = useHistoryStore();
    const roundedAudioMs = record.recordingDurationMs;

    function fireAndForget(usageRecord: ApiUsageRecord) {
      historyStore
        .addApiUsage(usageRecord)
        .catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: addApiUsage(${usageRecord.apiType}) failed: ${extractErrorMessage(err)}`,
          ),
        );
    }

    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "whisper",
      model: WHISPER_MODEL,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(roundedAudioMs),
    });

    if (chatUsage) {
      fireAndForget({
        id: crypto.randomUUID(),
        transcriptionId: record.id,
        apiType: "chat",
        model: GROQ_LLM_MODEL,
        promptTokens: chatUsage.promptTokens,
        completionTokens: chatUsage.completionTokens,
        totalTokens: chatUsage.totalTokens,
        promptTimeMs: chatUsage.promptTimeMs,
        completionTimeMs: chatUsage.completionTimeMs,
        totalTimeMs: chatUsage.totalTimeMs,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(chatUsage.totalTokens),
      });
    }
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    lastWasModified.value = null;
    recordingStartTime = performance.now();

    try {
      await initializeMicrophone();
      startRecording();
      try {
        analyserHandle.value = createAudioAnalyser();
      } catch (analyserError) {
        writeErrorLog(
          `useVoiceFlowStore: audio analyser creation failed (non-blocking): ${extractErrorMessage(analyserError)}`,
        );
      }
      startElapsedTimer();
      transitionTo("recording", RECORDING_MESSAGE);
      writeInfoLog("useVoiceFlowStore: recording started");
    } catch (error) {
      const errorMessage = getMicrophoneErrorMessage(error);
      const technicalErrorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${technicalErrorMessage}`,
      );
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;

    stopElapsedTimer();
    destroyAudioAnalyser();
    analyserHandle.value = null;

    try {
      transitionTo("transcribing", TRANSCRIBING_MESSAGE);
      const audioBlob = await stopRecording();
      const recordingDurationMs = performance.now() - recordingStartTime;
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        failRecordingFlow(
          API_KEY_MISSING_ERROR,
          "useVoiceFlowStore: missing API key while transcribing",
        );
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const vocabularyTermList = vocabularyStore.termList.map(
        (entry) => entry.term,
      );
      const hasVocabulary = vocabularyTermList.length > 0;

      const result = await transcribeAudio(
        audioBlob,
        apiKey,
        hasVocabulary ? vocabularyTermList : undefined,
      );

      if (
        isSilenceOrHallucination(result.rawText, result.noSpeechProbability)
      ) {
        failRecordingFlow(
          EMPTY_TRANSCRIPTION_ERROR_MESSAGE,
          `useVoiceFlowStore: silence detected (noSpeechProb=${result.noSpeechProbability.toFixed(3)}, text="${result.rawText}")`,
        );
        return;
      }

      if (result.rawText.length >= ENHANCEMENT_CHAR_THRESHOLD) {
        transitionTo("enhancing", ENHANCING_MESSAGE);
        const enhancementStartTime = performance.now();

        const clipboardContent = await readClipboardText();

        try {
          const enhanceResult = await enhanceText(result.rawText, apiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            clipboardContent,
            vocabularyTermList:
              vocabularyTermList.length > 0 ? vocabularyTermList : undefined,
          });
          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: true,
          });

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: PASTE_SUCCESS_MESSAGE,
            record,
            chatUsage: enhanceResult.usage,
          });

          writeInfoLog(
            `useVoiceFlowStore: pasted enhanced text, recordingDurationMs=${Math.round(
              recordingDurationMs,
            )}, transcriptionDurationMs=${Math.round(
              result.transcriptionDurationMs,
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}`,
          );
        } catch (enhanceError) {
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
          writeErrorLog(
            `useVoiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`,
          );

          const fallbackRecord = buildTranscriptionRecord({
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: PASTE_SUCCESS_UNENHANCED_MESSAGE,
            record: fallbackRecord,
            chatUsage: null,
          });
        }
      } else {
        const record = buildTranscriptionRecord({
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: PASTE_SUCCESS_MESSAGE,
          record,
          chatUsage: null,
        });

        writeInfoLog(
          `useVoiceFlowStore: pasted text (skipped enhancement, length=${result.rawText.length}), recordingDurationMs=${Math.round(
            recordingDurationMs,
          )}, transcriptionDurationMs=${Math.round(result.transcriptionDurationMs)}`,
        );
      }
    } catch (error) {
      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
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
      listen<QualityMonitorResultPayload>(QUALITY_MONITOR_RESULT, (event) => {
        lastWasModified.value = event.payload.wasModified;
        writeInfoLog(
          `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
        );
      }),
      listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const hudMessage = getHotkeyErrorMessage(event.payload.error);
        if (
          event.payload.error === HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION
        ) {
          void (async () => {
            try {
              const mainWindow = await Window.getByLabel("main-window");
              if (!mainWindow) return;
              await mainWindow.show();
              await mainWindow.setFocus();
            } catch (err) {
              writeErrorLog(
                `useVoiceFlowStore: show/focus main-window failed: ${extractErrorMessage(err)}`,
              );
            }
          })();
        }
        transitionTo("error", hudMessage);
        writeErrorLog(
          `useVoiceFlowStore: hotkey error: ${event.payload.message}`,
        );
      }),
    ]);
    unlistenFunctions.push(...listeners);
  }

  function cleanup() {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    stopMonitorPolling();
    stopElapsedTimer();
    destroyAudioAnalyser();
    analyserHandle.value = null;

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    analyserHandle,
    recordingElapsedSeconds,
    lastWasModified,
    initialize,
    cleanup,
    transitionTo,
  };
});
