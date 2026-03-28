import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { enhanceText, buildSystemPrompt } from "../lib/enhancer";
import { getEditModePromptForLocale } from "../i18n/prompts";
import type { SupportedLocale } from "../i18n/languageConfig";
import { analyzeCorrections } from "../lib/vocabularyAnalyzer";
import i18n from "../i18n";
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
import type { StopRecordingResult, TranscriptionResult } from "../types/audio";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_MODE_TOGGLE,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
  CORRECTION_MONITOR_RESULT,
  VOCABULARY_LEARNED,
  ESCAPE_PRESSED,
  emitEvent,
  listenToEvent,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
  type CorrectionMonitorResultPayload,
  type VocabularyLearnedPayload,
} from "../types/events";
import {
  detectHallucination,
  detectEnhancementAnomaly,
} from "../lib/hallucinationDetector";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const MAX_ENHANCEMENT_RETRY_COUNT = 3;
const ERROR_WITH_RETRY_DISPLAY_DURATION_MS = 6000;
const START_SOUND_DURATION_MS = 400;
const CANCELLED_DISPLAY_DURATION_MS = 1000;
const EDIT_MODE_MAX_TOKENS = 4096;

/**
 * 判斷轉錄結果是否為空（無內容可貼上）。
 *
 * 設計決策：只攔截「完全沒有文字」的情況。
 * Whisper 幻聽（如「谢谢大家」、重複片語）不攔截，直接貼上讓使用者自行判斷。
 * 理由：攔截 + 顯示「未偵測到語音」會讓使用者以為麥克風或系統有問題；
 * 直接貼上則讓使用者看到是模型的輸出品質問題，可自行 Cmd+Z 重來。
 */
function isEmptyTranscription(rawText: string): boolean {
  return !rawText || !rawText.trim();
}
function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

const MONITOR_POLL_INTERVAL_MS = 250;

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  const isRecording = ref<boolean>(false);
  const recordingElapsedSeconds = ref<number>(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
  const COLLAPSE_HIDE_DELAY_MS = 400;
  const lastWasModified = ref<boolean | null>(null);
  let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
  let delayedMuteTimer: ReturnType<typeof setTimeout> | null = null;
  let learnedHideTimer: ReturnType<typeof setTimeout> | null = null;
  const LEARNED_NOTIFICATION_TOTAL_DURATION_MS = 2800; // 2000 display + 400 collapse + 400 buffer
  const lastFailedTranscriptionId = ref<string | null>(null);
  const lastFailedAudioFilePath = ref<string | null>(null);
  const lastFailedRecordingDurationMs = ref<number>(0);
  const lastFailedPeakEnergyLevel = ref<number>(0);
  const lastFailedRmsEnergyLevel = ref<number>(0);
  const isAborted = ref<boolean>(false);
  let abortController: AbortController | null = null;
  const editSourceText = ref<string | null>(null);
  const isEditMode = computed<boolean>(() => editSourceText.value !== null);
  const isRetryAttempt = ref<boolean>(false);
  const canRetry = computed<boolean>(
    () =>
      status.value === "error" &&
      lastFailedAudioFilePath.value !== null &&
      !isRetryAttempt.value,
  );

  // Double-tap mode toggle state
  let recordingStartTimestamp = 0;
  let doubleTapResolve: ((isDoubleTap: boolean) => void) | null = null;
  let doubleTapDelayTimer: ReturnType<typeof setTimeout> | null = null;
  const modeSwitchLabel = ref<string>("");
  let modeSwitchLabelTimer: ReturnType<typeof setTimeout> | null = null;
  const MODE_SWITCH_LABEL_DURATION_MS = 3000;

  let lastMonitorKey = "";
  let isRepositioning = false;

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
    void emitEvent(VOICE_FLOW_STATE_CHANGED, payload);
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
          new LogicalPosition(position.x, position.y),
        );
      }
    } catch {
      // 螢幕監控重定位失敗為低優先級，不 log 避免洗版
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
    clearLearnedHideTimer();
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

  function clearDelayedMuteTimer() {
    if (delayedMuteTimer) {
      clearTimeout(delayedMuteTimer);
      delayedMuteTimer = null;
    }
  }

  function clearLearnedHideTimer() {
    if (learnedHideTimer) {
      clearTimeout(learnedHideTimer);
      learnedHideTimer = null;
    }
  }

  async function muteSystemAudioIfEnabled() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isMuteOnRecordingEnabled) return;
    try {
      await invoke("mute_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "mute-audio" });
    }
  }

  async function restoreSystemAudio() {
    try {
      await invoke("restore_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "restore-audio" });
    }
  }

  function startQualityMonitorAfterPaste() {
    void invoke("start_quality_monitor").catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });
  }

  async function saveTranscriptionRecord(
    record: TranscriptionRecord,
  ): Promise<void> {
    const historyStore = useHistoryStore();
    try {
      await historyStore.addTranscription(record);
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "save-transcription" });
    }
  }

  function buildTranscriptionRecord(params: {
    id: string;
    rawText: string;
    processedText: string | null;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
    audioFilePath: string | null;
    status: "success" | "failed";
    isEditMode?: boolean;
    editSourceText?: string | null;
  }): TranscriptionRecord {
    const settingsStore = useSettingsStore();
    return {
      id: params.id,
      timestamp: Date.now(),
      rawText: params.rawText,
      processedText: params.processedText,
      recordingDurationMs: Math.round(params.recordingDurationMs),
      transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
      enhancementDurationMs:
        params.enhancementDurationMs !== null
          ? Math.round(params.enhancementDurationMs)
          : null,
      charCount: params.rawText.length,
      triggerMode: settingsStore.triggerMode,
      wasEnhanced: params.wasEnhanced,
      wasModified: null,
      createdAt: "",
      audioFilePath: params.audioFilePath,
      status: params.status,
      isEditMode: params.isEditMode ?? false,
      editSourceText: params.editSourceText ?? null,
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
        hideHud().catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, { source: "voice-flow", step: "hideHud" });
        });
      }, COLLAPSE_HIDE_DELAY_MS);
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "cancelled") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, CANCELLED_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud()
        .then(async () => {
          await getAppWindow().setIgnoreCursorEvents(false);
        })
        .catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, {
            source: "voice-flow",
            step: "showHud-enableCursor",
          });
        });
      const errorDuration = canRetry.value
        ? ERROR_WITH_RETRY_DISPLAY_DURATION_MS
        : ERROR_DISPLAY_DURATION_MS;
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, errorDuration);
    }
  }

  function failRecordingFlow(
    errorMessage: string,
    logMessage: string,
    error?: unknown,
  ) {
    clearDelayedMuteTimer();
    restoreSystemAudio();
    isRecording.value = false;
    transitionTo("error", errorMessage);
    playSoundIfEnabled("play_error_sound");
    writeErrorLog(logMessage);
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
    }
  }

  function playSoundIfEnabled(command: string) {
    if (useSettingsStore().isSoundEffectsEnabled) {
      void invoke(command).catch(() => {});
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function updateVocabularyWeightsAfterPaste(finalText: string) {
    void (async () => {
      try {
        const vocabularyStore = useVocabularyStore();
        const matchedIdList: string[] = [];

        for (const entry of vocabularyStore.termList) {
          const isEnglish = /^[a-zA-Z]/.test(entry.term);
          if (isEnglish) {
            const regex = new RegExp(
              "\\b" + escapeRegex(entry.term) + "\\b",
              "i",
            );
            if (regex.test(finalText)) {
              matchedIdList.push(entry.id);
            }
          } else {
            if (finalText.includes(entry.term)) {
              matchedIdList.push(entry.id);
            }
          }
        }

        if (matchedIdList.length > 0) {
          await vocabularyStore.batchIncrementWeights(matchedIdList);
          writeInfoLog(
            `useVoiceFlowStore: vocabulary weights updated for ${matchedIdList.length} terms`,
          );
        }
      } catch (err) {
        writeErrorLog(
          `useVoiceFlowStore: vocabulary weight update failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "vocabulary-weight-update",
        });
      }
    })();
  }

  const SNAPSHOT_POLL_INTERVAL_MS = 500;
  let correctionSnapshotTimer: ReturnType<typeof setInterval> | null = null;
  let correctionMonitorUnlisten: UnlistenFn | null = null;

  function stopCorrectionSnapshotPolling() {
    if (correctionSnapshotTimer) {
      clearInterval(correctionSnapshotTimer);
      correctionSnapshotTimer = null;
    }
  }

  function cleanupCorrectionMonitorListener() {
    if (correctionMonitorUnlisten) {
      correctionMonitorUnlisten();
      correctionMonitorUnlisten = null;
    }
  }

  function startCorrectionDetectionFlow(
    pastedText: string,
    transcriptionId: string,
    apiKey: string,
  ) {
    void (async () => {
      try {
        const settingsStore = useSettingsStore();
        if (!settingsStore.isSmartDictionaryEnabled) return;

        // 清除前一次的 listener，避免重複累積
        cleanupCorrectionMonitorListener();

        // 啟動修正監控
        await invoke("start_correction_monitor");

        // Phase 2 snapshot polling
        let latestSnapshot: string | null = null;
        stopCorrectionSnapshotPolling();

        correctionSnapshotTimer = setInterval(() => {
          void (async () => {
            try {
              const text = await invoke<string | null>(
                "read_focused_text_field",
              );
              if (text) {
                latestSnapshot = text;
              }
            } catch {
              // AX 讀取失敗靜默處理
            }
          })();
        }, SNAPSHOT_POLL_INTERVAL_MS);

        // 一次性監聽 correction-monitor:result
        correctionMonitorUnlisten =
          await listenToEvent<CorrectionMonitorResultPayload>(
            CORRECTION_MONITOR_RESULT,
            (event) => {
              cleanupCorrectionMonitorListener();
              stopCorrectionSnapshotPolling();

              void (async () => {
                try {
                  const result = event.payload;

                  if (!result.anyKeyPressed) {
                    writeInfoLog(
                      "[correction] no key pressed — skipping analysis",
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] keys detected (enter=${result.enterPressed}) — reading field text`,
                  );

                  let fieldText: string | null = null;

                  if (result.enterPressed) {
                    // Enter 觸發：先嘗試即時讀取（IME 確認後文字可能已更新）
                    // 讀不到（如 LINE 按 Enter 送出後已清空）才 fallback 到 snapshot
                    try {
                      const freshText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                      if (freshText && freshText.trim()) {
                        fieldText = freshText;
                      } else {
                        fieldText = latestSnapshot;
                      }
                    } catch {
                      fieldText = latestSnapshot;
                    }
                  } else {
                    // Idle timeout 或硬上限：做最後一次讀取
                    try {
                      fieldText = await invoke<string | null>(
                        "read_focused_text_field",
                      );
                    } catch {
                      // fallback to snapshot
                      fieldText = latestSnapshot;
                    }
                  }

                  if (!fieldText || !fieldText.trim()) {
                    writeInfoLog(
                      "[correction] field text is null or empty — skipping analysis",
                    );
                    return;
                  }
                  if (fieldText.includes(pastedText)) {
                    writeInfoLog(
                      "[correction] text unchanged — skipping analysis",
                    );
                    return;
                  }

                  // 相似度檢查：如果 corrected 跟 original 完全無關（AX 讀到錯的東西），跳過
                  const overlapCharCount = [...pastedText].filter((ch) =>
                    fieldText.includes(ch),
                  ).length;
                  const overlapRatio = overlapCharCount / pastedText.length;
                  if (overlapRatio < 0.3) {
                    writeInfoLog(
                      `[correction] field text unrelated to original (overlap=${Math.round(overlapRatio * 100)}%) — skipping analysis`,
                    );
                    return;
                  }

                  writeInfoLog(
                    `[correction] text modified (overlap=${Math.round(overlapRatio * 100)}%) — sending to AI analysis\n  original:  ${pastedText.slice(0, 80)}\n  corrected: ${fieldText.slice(0, 80)}`,
                  );

                  const analysisResult = await analyzeCorrections(
                    pastedText,
                    fieldText,
                    apiKey,
                    {
                      modelId: settingsStore.selectedLlmModelId,
                    },
                  );

                  writeInfoLog(
                    `[correction] AI raw: ${analysisResult.rawResponse}`,
                  );
                  writeInfoLog(
                    `[correction] AI result: ${JSON.stringify(analysisResult.suggestedTermList)} (tokens: ${analysisResult.usage?.totalTokens ?? "??"})`,
                  );

                  if (analysisResult.suggestedTermList.length === 0) return;

                  const vocabularyStore = useVocabularyStore();
                  const newTermList: string[] = [];

                  for (const term of analysisResult.suggestedTermList) {
                    if (vocabularyStore.isDuplicateTerm(term)) {
                      // 已存在的詞 weight +1
                      const existingEntry = vocabularyStore.termList.find(
                        (e) =>
                          e.term.trim().toLowerCase() ===
                          term.trim().toLowerCase(),
                      );
                      if (existingEntry) {
                        void vocabularyStore
                          .batchIncrementWeights([existingEntry.id])
                          .catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: batchIncrementWeights failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                      }
                    } else {
                      await vocabularyStore.addAiSuggestedTerm(term);
                      newTermList.push(term);
                    }
                  }

                  // 記錄 API 用量
                  if (analysisResult.usage) {
                    const historyStore = useHistoryStore();
                    void historyStore
                      .addApiUsage({
                        id: crypto.randomUUID(),
                        transcriptionId,
                        apiType: "vocabulary_analysis",
                        model: settingsStore.selectedLlmModelId,
                        promptTokens: analysisResult.usage.promptTokens,
                        completionTokens: analysisResult.usage.completionTokens,
                        totalTokens: analysisResult.usage.totalTokens,
                        promptTimeMs: analysisResult.usage.promptTimeMs ?? null,
                        completionTimeMs: analysisResult.usage.completionTimeMs ?? null,
                        totalTimeMs: analysisResult.usage.totalTimeMs ?? null,
                        audioDurationMs: null,
                        estimatedCostCeiling: calculateChatCostCeiling(
                          analysisResult.usage.totalTokens,
                          settingsStore.selectedLlmModelId,
                        ),
                      })
                      .catch((err) =>
                        writeErrorLog(
                          `useVoiceFlowStore: addApiUsage(vocabulary_analysis) failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                  }

                  // 通知 HUD 新學習的詞（只包含新增的，不包含已存在的）
                  if (newTermList.length > 0) {
                    writeInfoLog(
                      `useVoiceFlowStore: emitting VOCABULARY_LEARNED: ${newTermList.join(", ")}`,
                    );
                    try {
                      await emitEvent(VOCABULARY_LEARNED, {
                        termList: newTermList,
                      } satisfies VocabularyLearnedPayload);
                      writeInfoLog(
                        "useVoiceFlowStore: VOCABULARY_LEARNED emitted successfully",
                      );

                      // HUD 視窗在 idle 後已被 hideHud() 隱藏，需重新顯示才看得到通知
                      clearLearnedHideTimer();
                      const appWindow = getAppWindow();
                      await appWindow.show();
                      await appWindow.setIgnoreCursorEvents(true);
                      learnedHideTimer = setTimeout(() => {
                        learnedHideTimer = null;
                        if (status.value === "idle") {
                          hideHud().catch((err) =>
                            writeErrorLog(
                              `useVoiceFlowStore: learned hideHud failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                        }
                      }, LEARNED_NOTIFICATION_TOTAL_DURATION_MS);
                    } catch (emitErr) {
                      writeErrorLog(
                        `useVoiceFlowStore: VOCABULARY_LEARNED emit failed: ${extractErrorMessage(emitErr)}`,
                      );
                    }
                  }
                } catch (err) {
                  writeErrorLog(
                    `useVoiceFlowStore: correction analysis failed: ${extractErrorMessage(err)}`,
                  );
                  captureError(err, {
                    source: "voice-flow",
                    step: "correction-analysis",
                  });
                }
              })();
            },
          );
      } catch (err) {
        stopCorrectionSnapshotPolling();
        cleanupCorrectionMonitorListener();
        writeErrorLog(
          `useVoiceFlowStore: correction detection failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, {
          source: "voice-flow",
          step: "correction-detection",
        });
      }
    })();
  }

  async function completePasteFlow(params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
    skipRecordSaving?: boolean;
  }) {
    try {
      await invoke("paste_text", { text: params.text });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      // api_usage FK 依賴 transcriptions — 必須等 transcription 寫入後才存 usage
      // retry 路徑使用 updateTranscriptionOnRetrySuccess，不走 INSERT
      if (!params.skipRecordSaving) {
        void saveTranscriptionRecord(params.record).then(() => {
          saveApiUsageRecordList(params.record, params.chatUsage);
        });
      }

      // 權重更新（fire-and-forget）
      const finalText = params.record.processedText ?? params.record.rawText;
      updateVocabularyWeightsAfterPaste(finalText);

      // 修正偵測（fire-and-forget，需 LLM API key）
      const settingsStore = useSettingsStore();
      const llmApiKey = settingsStore.getLlmApiKey();
      if (llmApiKey) {
        startCorrectionDetectionFlow(params.text, params.record.id, llmApiKey);
      }
    } catch (pasteError) {
      isRecording.value = false;
      failRecordingFlow(
        t("voiceFlow.pasteFailed"),
        `useVoiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
        pasteError,
      );
    }
  }

  function saveApiUsageRecordList(
    record: TranscriptionRecord,
    chatUsage: ChatUsageData | null,
  ) {
    const historyStore = useHistoryStore();
    const settingsStore = useSettingsStore();
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
      model: settingsStore.selectedWhisperModelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        roundedAudioMs,
        settingsStore.selectedWhisperModelId,
      ),
    });

    if (chatUsage) {
      fireAndForget({
        id: crypto.randomUUID(),
        transcriptionId: record.id,
        apiType: "chat",
        model: settingsStore.selectedLlmModelId,
        promptTokens: chatUsage.promptTokens,
        completionTokens: chatUsage.completionTokens,
        totalTokens: chatUsage.totalTokens,
        promptTimeMs: chatUsage.promptTimeMs ?? null,
        completionTimeMs: chatUsage.completionTimeMs ?? null,
        totalTimeMs: chatUsage.totalTimeMs ?? null,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(
          chatUsage.totalTokens,
          settingsStore.selectedLlmModelId,
        ),
      });
    }
  }

  function clearDoubleTapTimer() {
    if (doubleTapDelayTimer) {
      clearTimeout(doubleTapDelayTimer);
      doubleTapDelayTimer = null;
    }
  }

  function clearModeSwitchLabelTimer() {
    if (modeSwitchLabelTimer) {
      clearTimeout(modeSwitchLabelTimer);
      modeSwitchLabelTimer = null;
    }
  }

  /**
   * Wait for double-tap resolution: returns true if mode-toggle event arrives
   * within 400ms, false if timer expires (not a double-tap).
   */
  function waitForDoubleTapResolution(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      doubleTapResolve = resolve;
      clearDoubleTapTimer();
      doubleTapDelayTimer = setTimeout(() => {
        doubleTapDelayTimer = null;
        doubleTapResolve = null;
        resolve(false);
      }, 400);
    });
  }

  function handleDoubleTapModeToggle() {
    if (doubleTapResolve) {
      // Hold mode double-tap: resolve the waiting promise
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(true);
    } else {
      // Toggle mode long-press: directly apply mode switch
      applyDoubleTapModeSwitch();
    }
  }

  function applyDoubleTapModeSwitch() {
    isRecording.value = false;

    // Toggle prompt mode: minimal ↔ active
    const settingsStore = useSettingsStore();
    const currentMode = settingsStore.promptMode;
    const nextMode = currentMode === "minimal" ? "active" : "minimal";
    settingsStore.promptMode = nextMode;
    void settingsStore.savePromptMode(nextMode).catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: savePromptMode failed: ${extractErrorMessage(err)}`,
      );
    });

    // Flash mode label on HUD — follow the same pattern as transitionTo("success"):
    // show for N seconds, then transitionTo("idle") which triggers collapse animation.
    const modeLabel =
      nextMode === "minimal"
        ? t("settings.prompt.modeMinimal")
        : t("settings.prompt.modeActive");
    modeSwitchLabel.value = modeLabel;
    clearModeSwitchLabelTimer();

    // Show HUD with mode-switch visual
    showHud().catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
      );
    });

    // After display duration, clear label and transition to idle (triggers collapse + hide)
    modeSwitchLabelTimer = setTimeout(() => {
      modeSwitchLabel.value = "";
      modeSwitchLabelTimer = null;
      transitionTo("idle");
    }, MODE_SWITCH_LABEL_DURATION_MS);

    writeInfoLog(
      `useVoiceFlowStore: double-tap mode toggle → ${nextMode}`,
    );
  }

  function handleEscapeAbort() {
    const currentStatus = status.value;
    if (
      currentStatus === "idle" ||
      currentStatus === "success" ||
      currentStatus === "error" ||
      currentStatus === "cancelled"
    )
      return;

    writeInfoLog(`useVoiceFlowStore: ESC abort from ${currentStatus}`);
    isAborted.value = true;
    abortController?.abort();
    editSourceText.value = null;

    // 無條件重置 isRecording，避免永久鎖死
    isRecording.value = false;

    if (currentStatus === "recording") {
      void invoke("stop_recording").catch(() => {});
      stopElapsedTimer();
    }

    // Resolve pending double-tap Promise (prevents handleStopRecording from hanging)
    if (doubleTapResolve) {
      clearDoubleTapTimer();
      const resolve = doubleTapResolve;
      doubleTapResolve = null;
      resolve(false);
    }
    clearModeSwitchLabelTimer();
    modeSwitchLabel.value = "";

    // 完整清理所有進行中的資源
    clearDelayedMuteTimer();
    stopMonitorPolling();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();
    void restoreSystemAudio();

    // 重置 toggle 模式狀態
    void invoke("reset_hotkey_state").catch(() => {});

    transitionTo("cancelled", t("voiceFlow.cancelled"));
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    recordingStartTimestamp = performance.now();
    isAborted.value = false;
    abortController = new AbortController();
    lastWasModified.value = null;

    // 重置重送狀態（新錄音開始時清除上次失敗的重送資訊）
    lastFailedTranscriptionId.value = null;
    lastFailedAudioFilePath.value = null;
    lastFailedRecordingDurationMs.value = 0;
    lastFailedPeakEnergyLevel.value = 0;
    lastFailedRmsEnergyLevel.value = 0;
    isRetryAttempt.value = false;

    // 捕獲當前前景視窗（Windows: HUD show 前記住目標，貼上前恢復焦點）
    void invoke("capture_target_window").catch(() => {});

    // 偵測選取文字（非阻塞）：模擬 Cmd+C 讀剪貼簿，~100ms，遠在錄音結束前完成
    editSourceText.value = null;
    invoke<string | null>("read_selected_text")
      .then((selectedText) => {
        if (selectedText && selectedText.trim().length > 0) {
          editSourceText.value = selectedText;
          writeInfoLog(
            `useVoiceFlowStore: edit mode activated, selectedText length=${selectedText.length}`,
          );
        }
      })
      .catch(() => {});

    try {
      playSoundIfEnabled("play_start_sound");
      delayedMuteTimer = setTimeout(() => {
        delayedMuteTimer = null;
        void muteSystemAudioIfEnabled();
      }, START_SOUND_DURATION_MS);
      await invoke("start_recording", {
        deviceName: useSettingsStore().selectedAudioInputDeviceName,
      });
      if (isAborted.value) return;
      startElapsedTimer();
      transitionTo("recording", t("voiceFlow.recording"));
      writeInfoLog("useVoiceFlowStore: recording started");
    } catch (error) {
      const errorMessage = getMicrophoneErrorMessage(error);
      const technicalErrorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${technicalErrorMessage}`,
        error,
      );
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;
    if (isAborted.value) return;

    // Pre-estimate duration for double-tap detection (before any async work).
    // Use precise timestamp — recordingElapsedSeconds has 1s resolution, too coarse for 300ms threshold.
    // Rust double-tap max hold is 300ms; 350ms here adds 50ms buffer for IPC latency.
    const estimatedDurationMs = performance.now() - recordingStartTimestamp;
    if (estimatedDurationMs < 350) {
      const isDoubleTap = await waitForDoubleTapResolution();
      if (isAborted.value) return;
      if (isDoubleTap) {
        // Double-tap confirmed: silently cancel, apply mode switch
        stopElapsedTimer();
        clearDelayedMuteTimer();
        void restoreSystemAudio();
        void invoke("stop_recording").catch(() => {});
        applyDoubleTapModeSwitch();
        return;
      }
      // Not a double-tap — fall through to normal stop flow
    }

    clearDelayedMuteTimer();
    await restoreSystemAudio();
    playSoundIfEnabled("play_stop_sound");
    stopElapsedTimer();

    // 生成 transcriptionId 貫穿整個流程
    const transcriptionId = crypto.randomUUID();
    // 提升到 try 外層，讓 catch 也能存取（AC2: API 錯誤時仍寫入 failed 記錄）
    let audioFilePath: string | null = null;
    let recordingDurationMs = 0;
    let peakEnergyLevel = 0;
    let rmsEnergyLevel = 0;

    try {
      const stopResult = await invoke<StopRecordingResult>("stop_recording");
      if (isAborted.value) return;
      recordingDurationMs = stopResult.recordingDurationMs;
      peakEnergyLevel = stopResult.peakEnergyLevel;
      rmsEnergyLevel = stopResult.rmsEnergyLevel;

      // 錄音檔儲存（不阻斷主流程）
      try {
        audioFilePath = await invoke<string>("save_recording_file", {
          id: transcriptionId,
        });
        writeInfoLog(`useVoiceFlowStore: recording saved: ${audioFilePath}`);
      } catch (saveErr) {
        writeErrorLog(
          `useVoiceFlowStore: save_recording_file failed (non-blocking): ${extractErrorMessage(saveErr)}`,
        );
        captureError(saveErr, {
          source: "voice-flow",
          step: "save-recording-file",
        });
      }

      const MINIMUM_RECORDING_DURATION_MS = 300;
      if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
        // 錄音太短 → 寫入 failed 記錄，保留錄音檔
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        failRecordingFlow(
          t("voiceFlow.recordingTooShort"),
          `useVoiceFlowStore: recording too short (${Math.round(recordingDurationMs)}ms)`,
        );
        return;
      }

      transitionTo("transcribing", t("voiceFlow.transcribing"));
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        failRecordingFlow(
          t("errors.apiKeyMissing"),
          "useVoiceFlowStore: missing API key while transcribing",
        );
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      const result = await invoke<TranscriptionResult>("transcribe_audio", {
        apiKey,
        vocabularyTermList: hasVocabulary ? whisperTermList : null,
        modelId: settingsStore.selectedWhisperModelId,
        language: settingsStore.getWhisperLanguageCode(),
      });
      if (isAborted.value) return;

      writeInfoLog(`轉錄原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 空轉錄 → 寫入 failed 記錄，保留錄音檔
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText || "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態（空轉錄：主要重送目標）
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: empty transcription (noSpeechProb=${result.noSpeechProbability.toFixed(3)})`,
        );
        return;
      }

      // ── 幻覺偵測（純物理信號：語速異常 + 無人聲）──
      writeInfoLog(
        `useVoiceFlowStore: hallucination detection input: peakEnergy=${peakEnergyLevel.toFixed(4)}, rmsEnergy=${rmsEnergyLevel.toFixed(4)}, nsp=${result.noSpeechProbability.toFixed(3)}, rawText="${result.rawText}", durationMs=${Math.round(recordingDurationMs)}`,
      );

      const hallucinationDetectionResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel,
        rmsEnergyLevel,
        noSpeechProbability: result.noSpeechProbability,
      });

      writeInfoLog(
        `useVoiceFlowStore: hallucination detection result: isHallucination=${hallucinationDetectionResult.isHallucination}, reason=${hallucinationDetectionResult.reason}`,
      );

      if (hallucinationDetectionResult.isHallucination) {
        // 寫入 failed 記錄
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態
        if (audioFilePath) {
          lastFailedTranscriptionId.value = transcriptionId;
          lastFailedAudioFilePath.value = audioFilePath;
          lastFailedRecordingDurationMs.value = recordingDurationMs;
          lastFailedPeakEnergyLevel.value = peakEnergyLevel;
          lastFailedRmsEnergyLevel.value = rmsEnergyLevel;
        }

        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: hallucination intercepted (reason=${hallucinationDetectionResult.reason})`,
        );
        return;
      }

      // 編輯模式：語音是指令，選取文字是待處理內容
      if (isEditMode.value && editSourceText.value) {
        await handleEditModeFlow({
          voiceInstruction: result.rawText,
          selectedText: editSourceText.value,
          transcriptionId,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          audioFilePath,
        });
        return;
      }

      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          await settingsStore.refreshLlmApiKey();
          const llmApiKey = settingsStore.getLlmApiKey();
          if (!llmApiKey) {
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          const enhanceOptions = {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
            signal: abortController?.signal,
          };

          let enhanceResult = await enhanceText(
            result.rawText,
            llmApiKey,
            enhanceOptions,
          );
          if (isAborted.value) return;

          // 增強後長度爆炸偵測（含重試機制）
          let retryCount = 0;
          while (
            retryCount < MAX_ENHANCEMENT_RETRY_COUNT &&
            detectEnhancementAnomaly({
              rawText: result.rawText,
              enhancedText: enhanceResult.text,
            }).isAnomaly
          ) {
            retryCount++;
            writeInfoLog(
              `useVoiceFlowStore: enhancement anomaly detected (attempt ${retryCount}/${MAX_ENHANCEMENT_RETRY_COUNT}), retrying`,
            );
            enhanceResult = await enhanceText(
              result.rawText,
              llmApiKey,
              enhanceOptions,
            );
            if (isAborted.value) return;
          }

          // 重試後仍異常 → fallback 到 rawText
          const finalAnomaly = detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          });
          if (finalAnomaly.isAnomaly) {
            writeErrorLog(
              `useVoiceFlowStore: enhancement failed after ${MAX_ENHANCEMENT_RETRY_COUNT} retries (reason=${finalAnomaly.reason}), falling back to raw text`,
            );
            enhanceResult = { ...enhanceResult, text: result.rawText };
          }

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: !finalAnomaly.isAnomaly,
            audioFilePath,
            status: "success",
          });

          writeInfoLog(`AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
          });

          writeInfoLog(
            `useVoiceFlowStore: pasted enhanced text, recordingDurationMs=${Math.round(
              recordingDurationMs,
            )}, transcriptionDurationMs=${Math.round(
              result.transcriptionDurationMs,
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}${retryCount > 0 ? `, enhancementRetryCount=${retryCount}` : ""}`,
          );
        } catch (enhanceError) {
          if (isAborted.value) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
          writeErrorLog(
            `useVoiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
          });
        }
      } else {
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
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
      if (isAborted.value) return;
      // AC2: API 錯誤時仍寫入 failed 記錄（如果有 audioFilePath）
      if (audioFilePath) {
        const failedRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: "",
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: 0,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath,
          status: "failed",
        });
        void saveTranscriptionRecord(failedRecord);

        // 設定重送狀態（API 錯誤：暫時性問題，重送有意義）
        lastFailedTranscriptionId.value = transcriptionId;
        lastFailedAudioFilePath.value = audioFilePath;
        lastFailedRecordingDurationMs.value = recordingDurationMs;
        lastFailedPeakEnergyLevel.value = peakEnergyLevel;
      }

      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
        error,
      );
    }
  }

  async function handleEditModeFlow(params: {
    voiceInstruction: string;
    selectedText: string;
    transcriptionId: string;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    audioFilePath: string | null;
  }) {
    transitionTo("editing", t("voiceFlow.editing"));
    const editStartTime = performance.now();

    try {
      const settingsStore = useSettingsStore();
      await settingsStore.refreshLlmApiKey();
      const llmApiKey = settingsStore.getLlmApiKey();
      if (!llmApiKey) {
        throw new Error(t("errors.apiKeyMissing"));
      }

      const locale = i18n.global.locale.value as SupportedLocale;
      const basePrompt = getEditModePromptForLocale(locale);
      const systemPrompt = buildSystemPrompt(
        `${basePrompt}\n\n<instruction>\n${params.voiceInstruction}\n</instruction>`,
      );

      const editResult = await enhanceText(params.selectedText, llmApiKey, {
        systemPrompt,
        modelId: settingsStore.selectedLlmModelId,
        signal: abortController?.signal,
        maxTokens: EDIT_MODE_MAX_TOKENS,
      });
      if (isAborted.value) return;

      const editDurationMs = performance.now() - editStartTime;

      const record = buildTranscriptionRecord({
        id: params.transcriptionId,
        rawText: params.voiceInstruction,
        processedText: editResult.text,
        recordingDurationMs: params.recordingDurationMs,
        transcriptionDurationMs: params.transcriptionDurationMs,
        enhancementDurationMs: editDurationMs,
        wasEnhanced: true,
        audioFilePath: params.audioFilePath,
        status: "success",
        isEditMode: true,
        editSourceText: params.selectedText,
      });

      writeInfoLog(`Edit mode result: "${editResult.text}"`);

      await completePasteFlow({
        text: editResult.text,
        successMessage: t("voiceFlow.editSuccess"),
        record,
        chatUsage: editResult.usage,
      });

      writeInfoLog(
        `useVoiceFlowStore: edit mode completed, instruction="${params.voiceInstruction}", editDurationMs=${Math.round(editDurationMs)}`,
      );
    } catch (editError) {
      if (isAborted.value) return;
      writeErrorLog(
        `useVoiceFlowStore: edit mode failed: ${extractErrorMessage(editError)}`,
      );
      captureError(editError, { source: "voice-flow", step: "edit-mode" });

      // 編輯失敗不貼上任何東西（避免語音指令覆蓋選取文字）
      failRecordingFlow(
        t("voiceFlow.editFailed"),
        `useVoiceFlowStore: edit mode LLM call failed`,
        editError,
      );
    } finally {
      editSourceText.value = null;
    }
  }

  async function handleRetryTranscription() {
    if (!lastFailedAudioFilePath.value || !lastFailedTranscriptionId.value) {
      return;
    }

    isAborted.value = false;
    abortController = new AbortController();
    isRetryAttempt.value = true;
    clearAutoHideTimer();
    transitionTo("transcribing", t("voiceFlow.transcribing"));

    const filePath = lastFailedAudioFilePath.value;
    const transcriptionId = lastFailedTranscriptionId.value;
    const recordingDurationMs = lastFailedRecordingDurationMs.value;

    try {
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        transitionTo("error", t("errors.apiKeyMissing"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
      const hasVocabulary = whisperTermList.length > 0;

      const result = await invoke<TranscriptionResult>(
        "retranscribe_from_file",
        {
          filePath,
          apiKey,
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
          modelId: settingsStore.selectedWhisperModelId,
          language: settingsStore.getWhisperLanguageCode(),
        },
      );
      if (isAborted.value) return;

      writeInfoLog(`重送轉錄原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        // 重送也失敗 → 不再提供重送
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // ── 重送也需幻覺偵測（使用原始錄音的 energy levels）──
      const retryHallucinationResult = detectHallucination({
        rawText: result.rawText,
        recordingDurationMs,
        peakEnergyLevel: lastFailedPeakEnergyLevel.value,
        rmsEnergyLevel: lastFailedRmsEnergyLevel.value,
        noSpeechProbability: result.noSpeechProbability,
      });

      if (retryHallucinationResult.isHallucination) {
        writeInfoLog(
          `useVoiceFlowStore: retry hallucination detected (reason=${retryHallucinationResult.reason})`,
        );
        transitionTo("error", t("voiceFlow.retryFailed"));
        playSoundIfEnabled("play_error_sound");
        lastFailedAudioFilePath.value = null;
        isRetryAttempt.value = false;
        return;
      }

      // 重送成功 → 進入 AI 整理 → 貼上流程
      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          await settingsStore.refreshLlmApiKey();
          const llmApiKey = settingsStore.getLlmApiKey();
          if (!llmApiKey) {
            throw new Error(t("errors.apiKeyMissing"));
          }

          const enhancementTermList =
            await vocabularyStore.getTopTermListByWeight(50);
          const enhanceResult = await enhanceText(result.rawText, llmApiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
            signal: abortController?.signal,
          });
          if (isAborted.value) return;

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: true,
            audioFilePath: filePath,
            status: "success",
          });

          writeInfoLog(`重送 AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
            skipRecordSaving: true,
          });

          // 更新 DB status（UPDATE 而非 INSERT）→ 完成後記錄 API 用量（FK 依賴）
          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: enhanceResult.text,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(enhancementDurationMs),
              wasEnhanced: true,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(record, enhanceResult.usage);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        } catch (enhanceError) {
          if (isAborted.value) return;
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          writeErrorLog(
            `useVoiceFlowStore: retry AI enhancement failed: ${getEnhancementErrorMessage(enhanceError)}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "retry-enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
            audioFilePath: filePath,
            status: "success",
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
            skipRecordSaving: true,
          });

          const historyStore = useHistoryStore();
          void historyStore
            .updateTranscriptionOnRetrySuccess({
              id: transcriptionId,
              rawText: result.rawText,
              processedText: null,
              transcriptionDurationMs: Math.round(
                result.transcriptionDurationMs,
              ),
              enhancementDurationMs: Math.round(fallbackEnhancementDurationMs),
              wasEnhanced: false,
              charCount: result.rawText.length,
            })
            .then(() => {
              saveApiUsageRecordList(fallbackRecord, null);
            })
            .catch((err) =>
              writeErrorLog(
                `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
              ),
            );
        }
      } else {
        // 不需要 AI 整理
        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
          audioFilePath: filePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
          skipRecordSaving: true,
        });

        const historyStore = useHistoryStore();
        void historyStore
          .updateTranscriptionOnRetrySuccess({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
            enhancementDurationMs: null,
            wasEnhanced: false,
            charCount: result.rawText.length,
          })
          .then(() => {
            saveApiUsageRecordList(record, null);
          })
          .catch((err) =>
            writeErrorLog(
              `useVoiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            ),
          );
      }

      // 重送成功 → 重置所有重送狀態
      lastFailedTranscriptionId.value = null;
      lastFailedAudioFilePath.value = null;
      lastFailedRecordingDurationMs.value = 0;
      isRetryAttempt.value = false;
    } catch (error) {
      if (isAborted.value) return;
      // 重送也失敗（API 錯誤等）→ 不再提供重送
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("play_error_sound");
      lastFailedAudioFilePath.value = null;
      isRetryAttempt.value = false;
      writeErrorLog(
        `useVoiceFlowStore: retry transcription failed: ${extractErrorMessage(error)}`,
      );
      captureError(error, {
        source: "voice-flow",
        step: "retry-transcription",
      });
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

    const listeners = await Promise.all([
      listenToEvent(ESCAPE_PRESSED, () => {
        handleEscapeAbort();
      }),
      listenToEvent(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listenToEvent(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listenToEvent<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }

        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listenToEvent<QualityMonitorResultPayload>(
        QUALITY_MONITOR_RESULT,
        (event) => {
          lastWasModified.value = event.payload.wasModified;
          writeInfoLog(
            `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
          );
        },
      ),
      listenToEvent(HOTKEY_MODE_TOGGLE, () => {
        handleDoubleTapModeToggle();
      }),
      listenToEvent<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
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
        playSoundIfEnabled("play_error_sound");
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
    clearDelayedMuteTimer();
    clearLearnedHideTimer();
    clearDoubleTapTimer();
    clearModeSwitchLabelTimer();
    stopMonitorPolling();
    stopElapsedTimer();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    recordingElapsedSeconds,
    lastWasModified,
    canRetry,
    modeSwitchLabel,
    isEditMode,
    initialize,
    cleanup,
    handleRetryTranscription,
    transitionTo,
  };
});
