import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { enhanceText } from "../lib/enhancer";
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
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
  CORRECTION_MONITOR_RESULT,
  VOCABULARY_LEARNED,
  emitEvent,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
  type CorrectionMonitorResultPayload,
  type VocabularyLearnedPayload,
} from "../types/events";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const START_SOUND_DURATION_MS = 400;

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
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, ERROR_DISPLAY_DURATION_MS);
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
    writeErrorLog(logMessage);
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
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
          await listen<CorrectionMonitorResultPayload>(
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
                      modelId: settingsStore.selectedVocabularyAnalysisModelId,
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
                        model: settingsStore.selectedVocabularyAnalysisModelId,
                        promptTokens: analysisResult.usage.promptTokens,
                        completionTokens: analysisResult.usage.completionTokens,
                        totalTokens: analysisResult.usage.totalTokens,
                        promptTimeMs: analysisResult.usage.promptTimeMs,
                        completionTimeMs: analysisResult.usage.completionTimeMs,
                        totalTimeMs: analysisResult.usage.totalTimeMs,
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
  }) {
    try {
      await invoke("paste_text", { text: params.text });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      // api_usage FK 依賴 transcriptions — 必須等 transcription 寫入後才存 usage
      void saveTranscriptionRecord(params.record).then(() => {
        saveApiUsageRecordList(params.record, params.chatUsage);
      });

      // 權重更新（fire-and-forget）
      const finalText = params.record.processedText ?? params.record.rawText;
      updateVocabularyWeightsAfterPaste(finalText);

      // 修正偵測（fire-and-forget，需 API key）
      const settingsStore = useSettingsStore();
      const apiKey = settingsStore.getApiKey();
      if (apiKey) {
        startCorrectionDetectionFlow(params.text, params.record.id, apiKey);
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

    const isLocalProvider = settingsStore.transcriptionProvider === "local";

    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "whisper",
      model: isLocalProvider ? "local" : settingsStore.selectedWhisperModelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: isLocalProvider
        ? 0
        : calculateWhisperCostCeiling(
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
        promptTimeMs: chatUsage.promptTimeMs,
        completionTimeMs: chatUsage.completionTimeMs,
        totalTimeMs: chatUsage.totalTimeMs,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(
          chatUsage.totalTokens,
          settingsStore.selectedLlmModelId,
        ),
      });
    }
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    lastWasModified.value = null;

    try {
      void invoke("play_start_sound").catch(() => {});
      delayedMuteTimer = setTimeout(() => {
        delayedMuteTimer = null;
        void muteSystemAudioIfEnabled();
      }, START_SOUND_DURATION_MS);
      await invoke("start_recording");
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

    clearDelayedMuteTimer();
    await restoreSystemAudio();
    void invoke("play_stop_sound").catch(() => {});
    stopElapsedTimer();

    try {
      const stopResult = await invoke<StopRecordingResult>("stop_recording");
      const recordingDurationMs = stopResult.recordingDurationMs;

      const MINIMUM_RECORDING_DURATION_MS = 300;
      if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
        failRecordingFlow(
          t("voiceFlow.recordingTooShort"),
          `useVoiceFlowStore: recording too short (${Math.round(recordingDurationMs)}ms)`,
        );
        return;
      }

      transitionTo("transcribing", t("voiceFlow.transcribing"));
      const settingsStore = useSettingsStore();

      let result: TranscriptionResult;

      if (settingsStore.transcriptionProvider === "local") {
        // Local whisper transcription
        if (!settingsStore.isLocalModelLoaded) {
          failRecordingFlow(
            t("errors.localModelNotLoaded"),
            "useVoiceFlowStore: local model not loaded",
          );
          return;
        }

        const vocabularyStore = useVocabularyStore();
        const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
        const hasVocabulary = whisperTermList.length > 0;

        result = await invoke<TranscriptionResult>("transcribe_audio_local", {
          language: settingsStore.getWhisperLanguageCode(),
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
        });
      } else {
        // Cloud (Groq) transcription
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

        result = await invoke<TranscriptionResult>("transcribe_audio", {
          apiKey,
          vocabularyTermList: hasVocabulary ? whisperTermList : null,
          modelId: settingsStore.selectedWhisperModelId,
          language: settingsStore.getWhisperLanguageCode(),
        });
      }

      writeInfoLog(`轉錄原文: "${result.rawText}"`);

      if (isEmptyTranscription(result.rawText)) {
        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: empty transcription (noSpeechProb=${result.noSpeechProbability.toFixed(3)})`,
        );
        return;
      }

      const shouldEnhance =
        settingsStore.isCloudEnhancementEnabled &&
        (!settingsStore.isEnhancementThresholdEnabled ||
          result.rawText.length >= settingsStore.enhancementThresholdCharCount);

      if (shouldEnhance) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          const vocabularyStoreForEnhancement = useVocabularyStore();
          const enhancementTermList =
            await vocabularyStoreForEnhancement.getTopTermListByWeight(50);
          const enhancementApiKey = settingsStore.getApiKey();
          const enhanceResult = await enhanceText(result.rawText, enhancementApiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              enhancementTermList.length > 0 ? enhancementTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
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
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}`,
          );
        } catch (enhanceError) {
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
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
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
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
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
      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
        error,
      );
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

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
    clearDelayedMuteTimer();
    clearLearnedHideTimer();
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
    initialize,
    cleanup,
    transitionTo,
  };
});
