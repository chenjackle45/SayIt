<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useSettingsStore,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
} from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
} from "../composables/useTauriEvents";
import {
  type PresetTriggerKey,
  type ComboTriggerKey,
  isCustomTriggerKey,
  isComboTriggerKey,
} from "../types/settings";
import type {
  RecordingCapturedPayload,
  RecordingRejectedPayload,
} from "../types/events";
import type { TriggerMode } from "../types";
import {
  getDomCodeByKeycode,
  getKeyDisplayNameByKeycode,
} from "../lib/keycodeMap";
import {
  WHISPER_MODEL_LIST,
  findLlmModelConfig,
  findWhisperModelConfig,
  getModelListByProvider,
  type LlmModelId,
  type LlmProviderId,
  type WhisperModelId,
} from "../lib/modelRegistry";
import { LLM_PROVIDER_LIST, findProviderConfig } from "../lib/llmProvider";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "../i18n/languageConfig";

import { PROMPT_MODE_VALUES, type PromptMode } from "../types/settings";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AtSign,
  CircleAlert,
  Facebook,
  Github,
  Globe,
  Instagram,
  Mic,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import type { AudioInputDeviceInfo } from "../types/audio";
import { useAudioPreview } from "../composables/useAudioPreview";

const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const { t } = useI18n();

// ── 快捷鍵設定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const triggerKeyOptions = computed<{ value: PresetTriggerKey; label: string }[]>(() =>
  isMac
    ? [
        { value: "fn", label: t("settings.hotkey.keys.fn") },
        { value: "option", label: t("settings.hotkey.keys.leftOption") },
        { value: "rightOption", label: t("settings.hotkey.keys.rightOption") },
        { value: "control", label: t("settings.hotkey.keys.leftControl") },
        { value: "rightControl", label: t("settings.hotkey.keys.rightControl") },
        { value: "command", label: t("settings.hotkey.keys.command") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
    : [
        { value: "rightAlt", label: t("settings.hotkey.keys.rightAlt") },
        { value: "leftAlt", label: t("settings.hotkey.keys.leftAlt") },
        { value: "control", label: t("settings.hotkey.keys.control") },
        { value: "shift", label: t("settings.hotkey.keys.shift") },
      ]
);

const hotkeyFeedback = useFeedbackMessage();

// ── 兩層模式切換 ──────────────────────────────────────────
const isCustomMode = ref(false);
const isRecording = ref(false);
const recordingWarning = ref("");
const recordingHint = ref("");
let recordingTimeoutId: ReturnType<typeof setTimeout> | undefined;

const RECORDING_TIMEOUT_MS = 10_000;

const currentCustomKeyDisplay = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (key && isComboTriggerKey(key)) {
    return settingsStore.getTriggerKeyDisplayName(key);
  }
  if (!settingsStore.customTriggerKeyDomCode) return "";
  return settingsStore.getKeyDisplayName(settingsStore.customTriggerKeyDomCode);
});

const hasCustomKey = computed(() => settingsStore.customTriggerKey !== null);

const currentPresetKey = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (!key || isCustomTriggerKey(key) || isComboTriggerKey(key)) return isMac ? "fn" : "rightAlt";
  return key;
});

let recordingUnlisteners: UnlistenFn[] = [];

async function handleRecordingCaptured(payload: RecordingCapturedPayload) {
  const { keycode, modifiers } = payload;
  recordingWarning.value = "";
  recordingHint.value = "";

  const currentMode = settingsStore.triggerMode;
  stopKeyRecording();

  const domCode = getDomCodeByKeycode(keycode);

  if (modifiers.length > 0) {
    // Combo key: modifier(s) + primary key
    if (domCode) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    const comboKey: ComboTriggerKey = {
      combo: { modifiers, keycode },
    };
    try {
      await settingsStore.saveComboTriggerKey(comboKey, domCode ?? "", currentMode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: settingsStore.getTriggerKeyDisplayName(comboKey) }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  } else {
    // Single key
    const isPresetEquivalent = domCode ? settingsStore.isPresetEquivalentKey(domCode) : false;

    if (domCode && !isPresetEquivalent) {
      const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
      if (dangerWarning) {
        recordingWarning.value = dangerWarning;
      }
    }

    if (isPresetEquivalent) {
      recordingHint.value = settingsStore.getHotkeyPresetHint();
    }

    try {
      await settingsStore.saveCustomTriggerKey(keycode, domCode ?? "", currentMode);
      const displayName = domCode
        ? settingsStore.getKeyDisplayName(domCode)
        : getKeyDisplayNameByKeycode(keycode);
      hotkeyFeedback.show(
        "success",
        t("settings.hotkey.keySet", { key: displayName }),
      );
    } catch (err) {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    }
  }
}

function handleRecordingRejected(payload: RecordingRejectedPayload) {
  stopKeyRecording();
  if (payload.reason === "esc_reserved") {
    hotkeyFeedback.show("error", settingsStore.getEscapeReservedMessage());
  }
}

async function startRecording() {
  isRecording.value = true;
  recordingWarning.value = "";
  recordingHint.value = "";

  // Tell Rust to enter recording mode
  try {
    await invoke("start_hotkey_recording");
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
    isRecording.value = false;
    return;
  }

  // Listen for Rust recording events
  const [unlistenCaptured, unlistenRejected] = await Promise.all([
    listenToEvent<RecordingCapturedPayload>(
      HOTKEY_RECORDING_CAPTURED,
      (event) => void handleRecordingCaptured(event.payload),
    ),
    listenToEvent<RecordingRejectedPayload>(
      HOTKEY_RECORDING_REJECTED,
      (event) => handleRecordingRejected(event.payload),
    ),
  ]);
  recordingUnlisteners = [unlistenCaptured, unlistenRejected];

  // 10s timeout
  recordingTimeoutId = setTimeout(() => {
    if (isRecording.value) {
      hotkeyFeedback.show("error", settingsStore.getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }
  }, RECORDING_TIMEOUT_MS);
}

function stopKeyRecording() {
  if (!isRecording.value) return;
  isRecording.value = false;
  clearTimeout(recordingTimeoutId);
  // Cancel Rust recording mode
  void invoke("cancel_hotkey_recording").catch(() => {});
  // Clean up event listeners
  for (const unlisten of recordingUnlisteners) {
    unlisten();
  }
  recordingUnlisteners = [];
}

function switchToCustom() {
  isCustomMode.value = true;
  if (hasCustomKey.value) {
    // Restore saved custom key as active
    settingsStore
      .switchToCustomMode(settingsStore.triggerMode)
      .catch((err: unknown) => {
        hotkeyFeedback.show("error", extractErrorMessage(err));
      });
  }
}

function switchToPreset() {
  isCustomMode.value = false;
  stopKeyRecording();
  recordingWarning.value = "";
  recordingHint.value = "";
  settingsStore
    .switchToPresetMode(currentPresetKey.value, settingsStore.triggerMode)
    .catch((err: unknown) => {
      hotkeyFeedback.show("error", extractErrorMessage(err));
    });
}

async function handleTriggerKeyChange(newKey: PresetTriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    hotkeyFeedback.show("success", t("settings.hotkey.updated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyFeedback.show("success", t("settings.hotkey.modeUpdated"));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

// ── API Key ─────────────────────────────────────────────────
const apiKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const apiKeyFeedback = useFeedbackMessage();

const isConfirmingDeleteApiKey = ref(false);
let deleteConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const promptInput = ref("");
const isSubmittingPrompt = ref(false);
const promptFeedback = useFeedbackMessage();
const selectedPromptMode = ref<PromptMode>("minimal");
const isPresetDirty = ref(false);

const isConfirmingResetPrompt = ref(false);

// Preset 模式下切語言時即時更新 textarea
watch(
  [() => settingsStore.selectedLocale, () => settingsStore.selectedTranscriptionLocale],
  () => {
    if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
      promptInput.value = settingsStore.getAiPrompt();
    }
  },
);
let resetPromptConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet"),
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400",
);
const shouldShowOnboardingHint = computed(() => !settingsStore.hasApiKey);

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveApiKey(apiKeyInput.value);
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

function requestDeleteApiKey() {
  if (!isConfirmingDeleteApiKey.value) {
    isConfirmingDeleteApiKey.value = true;
    deleteConfirmTimeoutId = setTimeout(() => {
      isConfirmingDeleteApiKey.value = false;
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimeoutId);
  isConfirmingDeleteApiKey.value = false;
  handleDeleteApiKey();
}

async function handleDeleteApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    apiKeyInput.value = "";
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

async function handleSavePrompt() {
  const wasModeSwitch = selectedPromptMode.value !== "custom" && isPresetDirty.value;
  const previousMode = selectedPromptMode.value;
  try {
    isSubmittingPrompt.value = true;
    // preset 模式下編輯 → 切到 custom
    if (wasModeSwitch) {
      await settingsStore.savePromptMode("custom");
      selectedPromptMode.value = "custom";
      isPresetDirty.value = false;
    }
    await settingsStore.saveAiPrompt(promptInput.value);
    promptFeedback.show("success", t("settings.prompt.saved"));
  } catch (err) {
    if (wasModeSwitch) {
      await settingsStore.savePromptMode(previousMode).catch(() => {});
      selectedPromptMode.value = previousMode;
    }
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

async function handlePromptModeChange(mode: unknown) {
  if (typeof mode !== "string" || !(PROMPT_MODE_VALUES as readonly string[]).includes(mode)) return;
  const newMode = mode as PromptMode;
  const previousMode = selectedPromptMode.value;
  selectedPromptMode.value = newMode;
  try {
    await settingsStore.savePromptMode(newMode);
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
  } catch (err) {
    selectedPromptMode.value = previousMode;
    promptFeedback.show("error", extractErrorMessage(err));
  }
}

function handlePromptInput() {
  if (selectedPromptMode.value !== "custom" && !isPresetDirty.value) {
    isPresetDirty.value = true;
  }
}

function requestResetPrompt() {
  if (!isConfirmingResetPrompt.value) {
    isConfirmingResetPrompt.value = true;
    resetPromptConfirmTimeoutId = setTimeout(() => {
      isConfirmingResetPrompt.value = false;
    }, 3000);
    return;
  }
  clearTimeout(resetPromptConfirmTimeoutId);
  isConfirmingResetPrompt.value = false;
  handleResetPrompt();
}

async function handleResetPrompt() {
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.resetAiPrompt();
    selectedPromptMode.value = "minimal";
    promptInput.value = settingsStore.getAiPrompt();
    isPresetDirty.value = false;
    promptFeedback.show("success", t("settings.prompt.resetDone"));
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

// ── AI 整理門檻 ──────────────────────────────────────────────
const thresholdEnabled = ref(DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED);
const thresholdCharCount = ref(DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT);
const enhancementThresholdFeedback = useFeedbackMessage();

async function handleToggleEnhancementThreshold() {
  thresholdEnabled.value = !thresholdEnabled.value;
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    enhancementThresholdFeedback.show(
      "success",
      thresholdEnabled.value ? t("settings.threshold.enabledFeedback") : t("settings.threshold.disabledFeedback"),
    );
  } catch (err) {
    thresholdEnabled.value = !thresholdEnabled.value;
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveThresholdCharCount() {
  try {
    await settingsStore.saveEnhancementThreshold(
      thresholdEnabled.value,
      thresholdCharCount.value,
    );
    thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
    enhancementThresholdFeedback.show("success", t("settings.threshold.charCountSaved"));
  } catch (err) {
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 模型選擇 ──────────────────────────────────────────────
const modelFeedback = useFeedbackMessage();

const whisperModelDescription = computed(() => {
  const config = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
  if (!config) return "";
  return t("settings.model.costPerHour", { cost: config.costPerHour });
});

const llmModelDescription = computed(() => {
  const config = findLlmModelConfig(settingsStore.selectedLlmModelId);
  if (!config) return "";
  const tpsInfo = config.speedTps > 0 ? `${config.speedTps} TPS · ` : "";
  return `${tpsInfo}$${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
});

const providerModelList = computed(() =>
  getModelListByProvider(settingsStore.selectedLlmProviderId),
);

async function handleWhisperModelChange(newId: WhisperModelId) {
  try {
    await settingsStore.saveWhisperModel(newId);
    modelFeedback.show("success", t("settings.model.whisperUpdated"));
  } catch (err) {
    modelFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLlmModelChange(newId: LlmModelId) {
  try {
    await settingsStore.saveLlmModel(newId);
    modelFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    modelFeedback.show("error", extractErrorMessage(err));
  }
}

// ── LLM Provider ────────────────────────────────────────────
const providerFeedback = useFeedbackMessage();
const openaiApiKeyInput = ref("");
const anthropicApiKeyInput = ref("");
const geminiApiKeyInput = ref("");
const isOpenaiApiKeyVisible = ref(false);
const isAnthropicApiKeyVisible = ref(false);
const isGeminiApiKeyVisible = ref(false);

async function handleProviderChange(providerId: LlmProviderId) {
  try {
    await settingsStore.saveLlmProvider(providerId);
    providerFeedback.show("success", t("settings.model.llmUpdated"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveOpenaiApiKey() {
  try {
    await settingsStore.saveOpenaiApiKey(openaiApiKeyInput.value);
    openaiApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteOpenaiApiKey() {
  try {
    await settingsStore.deleteOpenaiApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveAnthropicApiKey() {
  try {
    await settingsStore.saveAnthropicApiKey(anthropicApiKeyInput.value);
    anthropicApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAnthropicApiKey() {
  try {
    await settingsStore.deleteAnthropicApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveGeminiApiKey() {
  try {
    await settingsStore.saveGeminiApiKey(geminiApiKeyInput.value);
    geminiApiKeyInput.value = "";
    providerFeedback.show("success", t("settings.apiKey.saved"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteGeminiApiKey() {
  try {
    await settingsStore.deleteGeminiApiKey();
    providerFeedback.show("success", t("settings.apiKey.deleted"));
  } catch (err) {
    providerFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音自動靜音 ──────────────────────────────────────────────
const muteOnRecordingFeedback = useFeedbackMessage();

async function handleToggleMuteOnRecording(newValue: boolean) {
  try {
    await settingsStore.saveMuteOnRecording(newValue);
    muteOnRecordingFeedback.show(
      "success",
      newValue ? t("settings.app.muteEnabled") : t("settings.app.muteDisabled"),
    );
  } catch (err) {
    muteOnRecordingFeedback.show("error", extractErrorMessage(err));
  }
}

const soundFeedbackFeedback = useFeedbackMessage();

async function handleToggleSoundFeedback(newValue: boolean) {
  try {
    await settingsStore.saveSoundEffectsEnabled(newValue);
    soundFeedbackFeedback.show(
      "success",
      newValue
        ? t("settings.app.soundFeedbackEnabled")
        : t("settings.app.soundFeedbackDisabled"),
    );
  } catch (err) {
    soundFeedbackFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 介面語言 ──────────────────────────────────────────────
const localeFeedback = useFeedbackMessage();

async function handleLocaleChange(newLocale: SupportedLocale) {
  try {
    await settingsStore.saveLocale(newLocale);
    localeFeedback.show("success", t("settings.app.languageUpdated"));
  } catch (err) {
    localeFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 轉錄語言 ──────────────────────────────────────────────
const transcriptionLocaleFeedback = useFeedbackMessage();

async function handleTranscriptionLocaleChange(newLocale: TranscriptionLocale) {
  try {
    await settingsStore.saveTranscriptionLocale(newLocale);
    transcriptionLocaleFeedback.show("success", t("settings.app.transcriptionLanguageUpdated"));
  } catch (err) {
    transcriptionLocaleFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 智慧字典學習 ────────────────────────────────────────────
const smartDictionaryFeedback = useFeedbackMessage();

async function handleToggleSmartDictionary(newValue: boolean) {
  try {
    await settingsStore.saveSmartDictionaryEnabled(newValue);
    smartDictionaryFeedback.show("success", t("common.save"));
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 錄音儲存管理 ──────────────────────────────────────────
const recordingCleanupFeedback = useFeedbackMessage();
const recordingAutoCleanupEnabled = ref(false);
const recordingAutoCleanupDays = ref(7);
const isDeletingRecordings = ref(false);

async function handleToggleRecordingAutoCleanup() {
  recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingCleanupFeedback.show(
      "success",
      recordingAutoCleanupEnabled.value
        ? t("settings.recording.autoCleanupEnabled")
        : t("settings.recording.autoCleanupDisabled"),
    );
  } catch (err) {
    recordingAutoCleanupEnabled.value = !recordingAutoCleanupEnabled.value;
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleSaveCleanupDays() {
  try {
    await settingsStore.saveRecordingAutoCleanup(
      recordingAutoCleanupEnabled.value,
      recordingAutoCleanupDays.value,
    );
    recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
    recordingCleanupFeedback.show("success", t("settings.recording.daysSaved"));
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleDeleteAllRecordings() {
  try {
    isDeletingRecordings.value = true;
    const deletedCount = await historyStore.deleteAllRecordingFiles();

    recordingCleanupFeedback.show(
      "success",
      t("settings.recording.deleteSuccess", { count: deletedCount }),
    );
  } catch (err) {
    recordingCleanupFeedback.show("error", extractErrorMessage(err));
  } finally {
    isDeletingRecordings.value = false;
  }
}

// ── 應用程式 ────────────────────────────────────────────────
const autoStartFeedback = useFeedbackMessage();
const isTogglingAutoStart = ref(false);

async function handleToggleAutoStart() {
  try {
    isTogglingAutoStart.value = true;
    await settingsStore.toggleAutoStart();
    autoStartFeedback.show(
      "success",
      settingsStore.isAutoStartEnabled ? t("settings.app.autoStartEnabled") : t("settings.app.autoStartDisabled"),
    );
  } catch (err) {
    autoStartFeedback.show("error", extractErrorMessage(err));
  } finally {
    isTogglingAutoStart.value = false;
  }
}

// ── 輸入裝置 ──────────────────────────────────────────────
const audioInputDeviceList = ref<AudioInputDeviceInfo[]>([]);
const defaultInputDeviceName = ref<string | null>(null);
const isRefreshingDeviceList = ref(false);
const audioInputFeedback = useFeedbackMessage();
const { previewLevel, isPreviewActive, startPreview, stopPreview } =
  useAudioPreview();

async function loadAudioInputDeviceList() {
  try {
    audioInputDeviceList.value =
      await invoke<AudioInputDeviceInfo[]>("list_audio_input_devices");
    defaultInputDeviceName.value =
      await invoke<string | null>("get_default_input_device_name");
  } catch (err) {
    console.error(
      "[SettingsView] Failed to list audio input devices:",
      extractErrorMessage(err),
    );
  }
}

async function handleRefreshAudioInputDeviceList() {
  isRefreshingDeviceList.value = true;
  try {
    await loadAudioInputDeviceList();
    audioInputFeedback.show(
      "success",
      t("settings.audioInput.refreshed", {
        count: audioInputDeviceList.value.length,
      }),
    );
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  } finally {
    isRefreshingDeviceList.value = false;
  }
}

async function handleAudioInputDeviceChange(deviceName: string) {
  try {
    await settingsStore.saveAudioInputDevice(deviceName);
    audioInputFeedback.show("success", t("settings.audioInput.updated"));
    void startPreview(deviceName);
  } catch (err) {
    audioInputFeedback.show("error", extractErrorMessage(err));
  }
}

onMounted(async () => {
  // F5 fix: 先載入裝置列表，完成後再啟動預覽（避免 cpal 並行 host 查詢）
  void loadAudioInputDeviceList().then(() => {
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  });
  selectedPromptMode.value = settingsStore.promptMode;
  promptInput.value = settingsStore.getAiPrompt();
  isPresetDirty.value = false;

  if (settingsStore.hasApiKey) {
    apiKeyInput.value = settingsStore.getApiKey();
  }
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  recordingAutoCleanupEnabled.value =
    settingsStore.isRecordingAutoCleanupEnabled;
  recordingAutoCleanupDays.value = settingsStore.recordingAutoCleanupDays;
  await settingsStore.loadAutoStartStatus();

  // Detect if current key is custom or combo
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  if (currentKey && (isCustomTriggerKey(currentKey) || isComboTriggerKey(currentKey))) {
    isCustomMode.value = true;
  }
});

onBeforeUnmount(() => {
  void stopPreview();
  stopKeyRecording();
  hotkeyFeedback.clearTimer();
  apiKeyFeedback.clearTimer();
  promptFeedback.clearTimer();
  enhancementThresholdFeedback.clearTimer();
  modelFeedback.clearTimer();
  muteOnRecordingFeedback.clearTimer();
  soundFeedbackFeedback.clearTimer();
  localeFeedback.clearTimer();
  transcriptionLocaleFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  smartDictionaryFeedback.clearTimer();
  recordingCleanupFeedback.clearTimer();
  providerFeedback.clearTimer();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(resetPromptConfirmTimeoutId);
});
</script>

<template>
  <div class="p-6 space-y-6 text-foreground">
    <!-- 關於 SayIt -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.about.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-1">
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.about.description") }}
          </p>
          <p class="text-sm text-muted-foreground">
            {{ $t("settings.about.author") }}<a href="https://jackle.pro" target="_blank" rel="noopener noreferrer" class="font-medium text-foreground hover:text-primary transition-colors">Jackle Chen</a>
          </p>
        </div>

        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <a href="https://jackle.pro" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Globe class="size-4" />
            <span>{{ $t("settings.about.website") }}</span>
          </a>
          <a href="https://www.facebook.com/jackle45" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Facebook class="size-4" />
            <span>Facebook</span>
          </a>
          <a href="https://www.instagram.com/jackle9527" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Instagram class="size-4" />
            <span>Instagram</span>
          </a>
          <a href="https://www.threads.com/@jackle9527" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <AtSign class="size-4" />
            <span>Threads</span>
          </a>
        </div>

        <Separator />

        <div class="flex flex-wrap gap-x-4 gap-y-2">
          <a href="https://github.com/chenjackle45/SayIt" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Github class="size-4" />
            <span>{{ $t("settings.about.sourceCode") }}</span>
          </a>
          <a href="https://github.com/chenjackle45/SayIt/issues" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <CircleAlert class="size-4" />
            <span>{{ $t("settings.about.reportIssue") }}</span>
          </a>
        </div>
      </CardContent>
    </Card>

    <!-- 快捷鍵設定 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.hotkey.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 簡易 / 自訂 模式切換 -->
        <div class="flex items-center justify-between">
          <Label>{{ $t("settings.hotkey.triggerKeyMode") }}</Label>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                !isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToPreset"
            >
              {{ $t("settings.hotkey.preset") }}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                isCustomMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="switchToCustom"
            >
              {{ $t("settings.hotkey.custom") }}
            </button>
          </div>
        </div>

        <!-- 簡易模式：Select 下拉 -->
        <div v-if="!isCustomMode" class="flex items-center justify-between">
          <Label for="trigger-key">{{ $t("settings.hotkey.triggerKey") }}</Label>
          <Select
            :model-value="currentPresetKey"
            @update:model-value="handleTriggerKeyChange($event as PresetTriggerKey)"
          >
            <SelectTrigger id="trigger-key" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in triggerKeyOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 自訂模式：錄製按鍵 -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <Label>{{ $t("settings.hotkey.customTriggerKey") }}</Label>
            <div class="flex items-center gap-3">
              <span v-if="hasCustomKey" class="text-sm font-medium text-foreground">
                {{ currentCustomKeyDisplay }}
              </span>
              <span v-else class="text-sm text-muted-foreground">{{ $t("settings.hotkey.notSet") }}</span>
              <Button
                :variant="isRecording ? 'destructive' : 'outline'"
                size="sm"
                :class="{ 'animate-pulse': isRecording }"
                @click="isRecording ? stopKeyRecording() : startRecording()"
              >
                {{ isRecording ? $t('settings.hotkey.pressKey') : $t('settings.hotkey.record') }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.hotkey.systemKeyHint") }}
          </p>

          <!-- 警告訊息（黃色） -->
          <p v-if="recordingWarning" class="text-sm text-destructive">
            {{ recordingWarning }}
          </p>

          <!-- 提示訊息（藍色） -->
          <p v-if="recordingHint" class="text-sm text-muted-foreground">
            {{ recordingHint }}
          </p>
        </div>

        <!-- 觸發模式 -->
        <div class="flex items-center justify-between">
          <Label for="trigger-mode">{{ $t("settings.hotkey.triggerMode") }}</Label>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'hold'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('hold')"
            >
              Hold
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium transition-colors"
              :class="
                settingsStore.triggerMode === 'toggle'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              "
              @click="handleTriggerModeChange('toggle')"
            >
              Toggle
            </button>
          </div>
        </div>

        <p class="text-sm text-muted-foreground leading-relaxed">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.holdDescription")
              : $t("settings.hotkey.toggleDescription")
          }}
        </p>

        <p class="text-xs text-muted-foreground">
          {{
            settingsStore.triggerMode === "hold"
              ? $t("settings.hotkey.doubleTapHint")
              : $t("settings.hotkey.longPressHint")
          }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="hotkeyFeedback.message.value !== ''"
            class="text-sm"
            :class="
              hotkeyFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ hotkeyFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- Groq API Key -->
    <Card>
      <CardHeader class="flex-row items-center justify-between border-b border-border">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base">Groq API Key</CardTitle>
          <Badge
            :class="apiKeyStatusClass"
            class="border-0"
          >
            {{ apiKeyStatusLabel }}
          </Badge>
        </div>
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {{ $t("settings.apiKey.goToConsole") }} &rarr;
        </a>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.apiKey.instruction") }}
        </p>

        <p
          v-if="shouldShowOnboardingHint"
          class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200"
        >
          {{ $t("settings.apiKey.onboarding") }}
        </p>

        <div class="flex gap-2">
          <div class="flex flex-1 gap-2">
            <Input
              v-model="apiKeyInput"
              :type="isApiKeyVisible ? 'text' : 'password'"
              placeholder="gsk_..."
              autocomplete="off"
              class="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="toggleApiKeyVisibility"
            >
              {{ isApiKeyVisible ? $t("settings.apiKey.hide") : $t("settings.apiKey.show") }}
            </Button>
          </div>
          <Button
            :disabled="isSubmittingApiKey"
            @click="handleSaveApiKey"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <div class="flex items-center justify-between">
          <transition name="feedback-fade">
            <p
              v-if="apiKeyFeedback.message.value !== ''"
              class="text-sm"
              :class="
                apiKeyFeedback.type.value === 'success' ? 'text-green-400' : 'text-red-400'
              "
            >
              {{ apiKeyFeedback.message.value }}
            </p>
          </transition>

          <Button
            v-if="settingsStore.hasApiKey"
            variant="outline"
            :class="
              isConfirmingDeleteApiKey
                ? 'bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90'
                : 'text-destructive border-destructive hover:bg-destructive/10'
            "
            :disabled="isSubmittingApiKey"
            @click="requestDeleteApiKey"
          >
            {{ isConfirmingDeleteApiKey ? $t('settings.apiKey.confirmDelete') : $t('settings.apiKey.delete') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 模型選擇 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.model.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.model.description") }}
        </p>

        <!-- Whisper 模型 -->
        <div class="space-y-2">
          <Label for="whisper-model">{{ $t("settings.model.whisperLabel") }}</Label>
          <Select
            :model-value="settingsStore.selectedWhisperModelId"
            @update:model-value="handleWhisperModelChange($event as WhisperModelId)"
          >
            <SelectTrigger id="whisper-model" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="model in WHISPER_MODEL_LIST"
                :key="model.id"
                :value="model.id"
              >
                {{ model.displayName }}
                <template v-if="model.isDefault" #extra>
                  <Badge variant="secondary" class="ml-2 text-xs">{{ $t("settings.model.default") }}</Badge>
                </template>
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ whisperModelDescription }}</p>
        </div>

        <Separator />

        <!-- LLM Provider 選擇 -->
        <div class="space-y-3">
          <Label>{{ $t("settings.provider.title") }}</Label>
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.description") }}</p>
          <RadioGroup
            :model-value="settingsStore.selectedLlmProviderId"
            class="grid grid-cols-2 gap-2"
            @update:model-value="(v: unknown) => handleProviderChange(v as LlmProviderId)"
          >
            <Label
              v-for="provider in LLM_PROVIDER_LIST"
              :key="provider.id"
              :for="`provider-${provider.id}`"
              class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="settingsStore.selectedLlmProviderId === provider.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem :id="`provider-${provider.id}`" :value="provider.id" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <span class="text-sm font-medium">{{ $t(`settings.provider.${provider.id}`) }}</span>
            </Label>
          </RadioGroup>
        </div>

        <!-- Provider-specific API Key -->
        <div v-if="settingsStore.selectedLlmProviderId === 'groq'" class="rounded-md bg-muted/50 p-3">
          <p class="text-xs text-muted-foreground">{{ $t("settings.provider.groqNote") }}</p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'openai'" class="space-y-2">
          <Label for="openai-api-key">{{ $t("settings.providerApiKey.openaiTitle") }}</Label>
          <div v-if="settingsStore.openaiApiKey" class="flex items-center gap-2">
            <Input
              id="openai-api-key"
              :model-value="isOpenaiApiKeyVisible ? settingsStore.openaiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isOpenaiApiKeyVisible = !isOpenaiApiKeyVisible">
              {{ isOpenaiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteOpenaiApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="openai-api-key"
              v-model="openaiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('openai')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!openaiApiKeyInput.trim()" @click="handleSaveOpenaiApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.openaiInstruction") }}
            ·
            <a :href="findProviderConfig('openai')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToOpenai") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'anthropic'" class="space-y-2">
          <Label for="anthropic-api-key">{{ $t("settings.providerApiKey.anthropicTitle") }}</Label>
          <div v-if="settingsStore.anthropicApiKey" class="flex items-center gap-2">
            <Input
              id="anthropic-api-key"
              :model-value="isAnthropicApiKeyVisible ? settingsStore.anthropicApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isAnthropicApiKeyVisible = !isAnthropicApiKeyVisible">
              {{ isAnthropicApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteAnthropicApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="anthropic-api-key"
              v-model="anthropicApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('anthropic')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!anthropicApiKeyInput.trim()" @click="handleSaveAnthropicApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.anthropicInstruction") }}
            ·
            <a :href="findProviderConfig('anthropic')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToAnthropic") }}</a>
          </p>
        </div>

        <div v-else-if="settingsStore.selectedLlmProviderId === 'gemini'" class="space-y-2">
          <Label for="gemini-api-key">{{ $t("settings.providerApiKey.geminiTitle") }}</Label>
          <div v-if="settingsStore.geminiApiKey" class="flex items-center gap-2">
            <Input
              id="gemini-api-key"
              :model-value="isGeminiApiKeyVisible ? settingsStore.geminiApiKey : '••••••••••'"
              readonly
              class="flex-1 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" @click="isGeminiApiKeyVisible = !isGeminiApiKeyVisible">
              {{ isGeminiApiKeyVisible ? $t('settings.apiKey.hide') : $t('settings.apiKey.show') }}
            </Button>
            <Button variant="ghost" size="sm" class="text-destructive" @click="handleDeleteGeminiApiKey">
              {{ $t('settings.apiKey.delete') }}
            </Button>
          </div>
          <div v-else class="flex gap-2">
            <Input
              id="gemini-api-key"
              v-model="geminiApiKeyInput"
              type="password"
              :placeholder="findProviderConfig('gemini')?.apiKeyPrefix + '...'"
              class="flex-1 font-mono text-xs"
            />
            <Button size="sm" :disabled="!geminiApiKeyInput.trim()" @click="handleSaveGeminiApiKey">
              {{ $t('common.save') }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.providerApiKey.geminiInstruction") }}
            ·
            <a :href="findProviderConfig('gemini')?.consoleUrl" target="_blank" rel="noopener noreferrer" class="underline">{{ $t("settings.providerApiKey.goToGemini") }}</a>
          </p>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="providerFeedback.message.value !== ''"
            class="text-sm"
            :class="providerFeedback.type.value === 'success' ? 'text-green-400' : 'text-red-400'"
          >
            {{ providerFeedback.message.value }}
          </p>
        </transition>

        <template v-if="settingsStore.selectedLlmProviderId === 'groq' || settingsStore.hasLlmApiKey">
          <Separator />

          <!-- LLM 模型 -->
          <div class="space-y-2">
            <Label for="llm-model">{{ $t("settings.model.llmLabel") }}</Label>
            <Select
              :model-value="settingsStore.selectedLlmModelId"
              @update:model-value="handleLlmModelChange($event as LlmModelId)"
            >
              <SelectTrigger id="llm-model" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="model in providerModelList"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.displayName }}
                  <template #extra>
                    <Badge variant="secondary" class="ml-2 text-xs">{{ $t(model.badgeKey) }}</Badge>
                  </template>
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">{{ llmModelDescription }}</p>
          </div>
        </template>

        <transition name="feedback-fade">
          <p
            v-if="modelFeedback.message.value !== ''"
            class="text-sm"
            :class="
              modelFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ modelFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- AI 整理 Prompt -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.prompt.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ $t("settings.prompt.description") }}
        </p>

        <!-- 模式選擇器 -->
        <div class="space-y-2">
          <Label>{{ $t("settings.prompt.modeTitle") }}</Label>
          <RadioGroup
            :model-value="selectedPromptMode"
            class="grid grid-cols-3 gap-2"
            @update:model-value="handlePromptModeChange"
          >
            <Label
              for="mode-minimal"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'minimal' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-minimal" value="minimal" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeMinimal") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeMinimalDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-active"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'active' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-active" value="active" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeActive") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeActiveDescription") }}</p>
              </div>
            </Label>
            <Label
              for="mode-custom"
              class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors"
              :class="selectedPromptMode === 'custom' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'"
            >
              <RadioGroupItem id="mode-custom" value="custom" class="!size-0 !border-0 !shadow-none overflow-hidden" />
              <div>
                <span class="text-sm font-medium">{{ $t("settings.prompt.modeCustom") }}</span>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ $t("settings.prompt.modeCustomDescription") }}</p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        <Textarea
          v-model="promptInput"
          class="font-mono min-h-[120px]"
          @input="handlePromptInput"
        />

        <div class="flex justify-end gap-2">
          <Button
            :disabled="isSubmittingPrompt || (selectedPromptMode !== 'custom' && !isPresetDirty)"
            @click="handleSavePrompt"
          >
            {{ $t("common.save") }}
          </Button>
          <Button
            variant="outline"
            :class="
              isConfirmingResetPrompt
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : ''
            "
            :disabled="isSubmittingPrompt"
            @click="requestResetPrompt"
          >
            {{ isConfirmingResetPrompt ? $t('settings.prompt.confirmReset') : $t('settings.prompt.reset') }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="promptFeedback.message.value !== ''"
            class="text-sm"
            :class="
              promptFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ promptFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 短文字門檻 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.threshold.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.threshold.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="threshold-toggle">{{ thresholdEnabled ? $t('settings.threshold.enabled') : $t('settings.threshold.disabled') }}</Label>
          <Switch
            id="threshold-toggle"
            :model-value="thresholdEnabled"
            @update:model-value="handleToggleEnhancementThreshold"
          />
        </div>

        <div v-if="thresholdEnabled" class="flex items-center gap-3">
          <Label for="threshold-char-count">{{ $t("settings.threshold.charCount") }}</Label>
          <Input
            id="threshold-char-count"
            v-model.number="thresholdCharCount"
            type="number"
            min="1"
            class="w-24"
          />
          <Button
            size="sm"
            @click="handleSaveThresholdCharCount"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="enhancementThresholdFeedback.message.value !== ''"
            class="text-sm"
            :class="
              enhancementThresholdFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ enhancementThresholdFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 智慧字典學習（macOS only — Windows 尚未支援 text field 讀取） -->
    <Card v-if="isMac">
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.smartDictionary.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.smartDictionary.description") }}
        </p>

        <div class="flex items-center justify-between">
          <Label for="smart-dictionary-toggle">{{ $t("settings.smartDictionary.title") }}</Label>
          <Switch
            id="smart-dictionary-toggle"
            :model-value="settingsStore.isSmartDictionaryEnabled"
            @update:model-value="handleToggleSmartDictionary"
          />
        </div>

        <p class="text-xs text-muted-foreground">
          {{ $t("settings.smartDictionary.privacyNote") }}
        </p>

        <transition name="feedback-fade">
          <p
            v-if="smartDictionaryFeedback.message.value !== ''"
            class="text-sm"
            :class="
              smartDictionaryFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ smartDictionaryFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 輸入裝置 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.audioInput.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.audioInput.description") }}
        </p>
        <div class="space-y-2">
          <Label for="audio-input-device">{{ $t("settings.audioInput.deviceLabel") }}</Label>
          <div class="flex items-center gap-2">
            <Select
              :model-value="settingsStore.selectedAudioInputDeviceName || '_default'"
              @update:model-value="handleAudioInputDeviceChange($event === '_default' ? '' : ($event as string))"
            >
              <SelectTrigger id="audio-input-device" class="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {{
                    defaultInputDeviceName
                      ? $t("settings.audioInput.systemDefaultWithDevice", {
                        device: defaultInputDeviceName,
                      })
                      : $t("settings.audioInput.systemDefault")
                  }}
                </SelectItem>
                <SelectItem
                  v-for="device in audioInputDeviceList"
                  :key="device.name"
                  :value="device.name"
                >
                  {{ device.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              :disabled="isRefreshingDeviceList"
              @click="handleRefreshAudioInputDeviceList"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshingDeviceList }" />
            </Button>
          </div>
        </div>
        <div
          v-if="isPreviewActive"
          role="meter"
          :aria-valuenow="Math.round(previewLevel * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="$t('settings.audioInput.volumePreview')"
          class="flex items-center gap-2 h-5"
        >
          <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-75"
              :style="{ width: `${Math.round(previewLevel * 100)}%` }"
            />
          </div>
        </div>
        <transition name="feedback-fade">
          <p
            v-if="audioInputFeedback.message.value !== ''"
            class="text-sm"
            :class="audioInputFeedback.type.value === 'success' ? 'text-green-400' : 'text-destructive'"
          >
            {{ audioInputFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 錄音儲存管理 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.recording.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ $t("settings.recording.description") }}
        </p>

        <div class="flex items-center justify-between">
          <div>
            <Label for="recording-auto-cleanup">{{ $t("settings.recording.autoCleanup") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.recording.autoCleanupDescription") }}</p>
          </div>
          <Switch
            id="recording-auto-cleanup"
            :model-value="recordingAutoCleanupEnabled"
            @update:model-value="handleToggleRecordingAutoCleanup"
          />
        </div>

        <div v-if="recordingAutoCleanupEnabled" class="flex items-center gap-3">
          <Label for="cleanup-days">{{ $t("settings.recording.retentionDays") }}</Label>
          <Input
            id="cleanup-days"
            v-model.number="recordingAutoCleanupDays"
            type="number"
            min="1"
            class="w-24"
          />
          <span class="text-sm text-muted-foreground">{{ $t("settings.recording.daysUnit") }}</span>
          <Button
            size="sm"
            @click="handleSaveCleanupDays"
          >
            {{ $t("common.save") }}
          </Button>
        </div>

        <div class="border-t border-border" />

        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button
              variant="destructive"
              :disabled="isDeletingRecordings"
            >
              <Trash2 class="h-4 w-4 mr-2" />
              {{ $t("settings.recording.deleteAll") }}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ $t("settings.recording.deleteConfirmTitle") }}</AlertDialogTitle>
              <AlertDialogDescription>
                {{ $t("settings.recording.deleteConfirmDescription") }}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{{ $t("common.cancel") }}</AlertDialogCancel>
              <AlertDialogAction @click="handleDeleteAllRecordings">
                {{ $t("common.delete") }}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <transition name="feedback-fade">
          <p
            v-if="recordingCleanupFeedback.message.value !== ''"
            class="text-sm"
            :class="
              recordingCleanupFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ recordingCleanupFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>

    <!-- 應用程式 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.app.title") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 介面語言 -->
        <div class="flex items-center justify-between">
          <Label for="locale-select">{{ $t("settings.app.language") }}</Label>
          <Select
            :model-value="settingsStore.selectedLocale"
            @update:model-value="handleLocaleChange($event as SupportedLocale)"
          >
            <SelectTrigger id="locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="localeFeedback.message.value !== ''"
            class="text-sm"
            :class="
              localeFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ localeFeedback.message.value }}
          </p>
        </transition>

        <!-- 轉錄語言 -->
        <div class="flex items-center justify-between">
          <div>
            <Label for="transcription-locale-select">{{ $t("settings.app.transcriptionLanguage") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.transcriptionLanguageDescription") }}</p>
          </div>
          <Select
            :model-value="settingsStore.selectedTranscriptionLocale"
            @update:model-value="handleTranscriptionLocaleChange($event as TranscriptionLocale)"
          >
            <SelectTrigger id="transcription-locale-select" class="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="opt in TRANSCRIPTION_LANGUAGE_OPTIONS"
                :key="opt.locale"
                :value="opt.locale"
              >
                {{ opt.locale === 'auto' ? $t('settings.app.autoDetect') : opt.displayName }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="transcriptionLocaleFeedback.message.value !== ''"
            class="text-sm"
            :class="
              transcriptionLocaleFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ transcriptionLocaleFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="mute-on-recording">{{ $t("settings.app.muteOnRecording") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.muteDescription") }}</p>
          </div>
          <Switch
            id="mute-on-recording"
            :model-value="settingsStore.isMuteOnRecordingEnabled"
            @update:model-value="handleToggleMuteOnRecording"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="muteOnRecordingFeedback.message.value !== ''"
            class="text-sm"
            :class="
              muteOnRecordingFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ muteOnRecordingFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="sound-feedback">{{ $t("settings.app.soundFeedback") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.soundFeedbackDescription") }}</p>
          </div>
          <Switch
            id="sound-feedback"
            :model-value="settingsStore.isSoundEffectsEnabled"
            @update:model-value="handleToggleSoundFeedback"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="soundFeedbackFeedback.message.value !== ''"
            class="text-sm"
            :class="
              soundFeedbackFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ soundFeedbackFeedback.message.value }}
          </p>
        </transition>

        <div class="border-t border-border" />

        <div class="flex items-center justify-between">
          <div>
            <Label for="auto-start">{{ $t("settings.app.autoStart") }}</Label>
            <p class="text-sm text-muted-foreground">{{ $t("settings.app.autoStartDescription") }}</p>
          </div>
          <Switch
            id="auto-start"
            :model-value="settingsStore.isAutoStartEnabled"
            :disabled="isTogglingAutoStart"
            @update:model-value="handleToggleAutoStart"
          />
        </div>

        <transition name="feedback-fade">
          <p
            v-if="autoStartFeedback.message.value !== ''"
            class="text-sm"
            :class="
              autoStartFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ autoStartFeedback.message.value }}
          </p>
        </transition>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
