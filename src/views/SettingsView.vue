<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  useSettingsStore,
  DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
} from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import {
  type PresetTriggerKey,
  isCustomTriggerKey,
} from "../types/settings";
import type { TriggerMode } from "../types";
import {
  LLM_MODEL_LIST,
  VOCABULARY_ANALYSIS_MODEL_LIST,
  WHISPER_MODEL_LIST,
  findLlmModelConfig,
  findVocabularyAnalysisModelConfig,
  findWhisperModelConfig,
  type LlmModelId,
  type VocabularyAnalysisModelId,
  type WhisperModelId,
  type TranscriptionProvider,
} from "../lib/modelRegistry";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "../i18n/languageConfig";

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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AtSign,
  CircleAlert,
  Facebook,
  Github,
  Globe,
  Instagram,
  Loader2,
} from "lucide-vue-next";

const settingsStore = useSettingsStore();
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
  if (!settingsStore.customTriggerKeyDomCode) return "";
  return settingsStore.getKeyDisplayName(settingsStore.customTriggerKeyDomCode);
});

const hasCustomKey = computed(() => settingsStore.customTriggerKey !== null);

const currentPresetKey = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  if (!key || isCustomTriggerKey(key)) return isMac ? "fn" : "rightAlt";
  return key;
});

async function handleKeydownForRecording(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();

  // Escape cancels recording
  if (event.code === "Escape") {
    stopKeyRecording();
    return;
  }

  const domCode = event.code;
  const keycode = settingsStore.getPlatformKeycode(domCode);

  if (keycode === null) {
    hotkeyFeedback.show("error", settingsStore.getHotkeyUnsupportedKeyMessage());
    stopKeyRecording();
    return;
  }

  recordingWarning.value = "";
  recordingHint.value = "";

  const isPresetEquivalent = settingsStore.isPresetEquivalentKey(domCode);

  // Check dangerous key (R17: skip danger warning if preset-equivalent)
  if (!isPresetEquivalent) {
    const dangerWarning = settingsStore.getDangerousKeyWarning(domCode);
    if (dangerWarning) {
      recordingWarning.value = dangerWarning;
    }
  }

  // Check preset equivalent
  if (isPresetEquivalent) {
    recordingHint.value = settingsStore.getHotkeyPresetHint();
  }

  // Save the custom key (R15: await instead of fire-and-forget)
  const currentMode = settingsStore.triggerMode;
  stopKeyRecording();
  try {
    await settingsStore.saveCustomTriggerKey(keycode, domCode, currentMode);
    hotkeyFeedback.show("success", t("settings.hotkey.keySet", { key: settingsStore.getKeyDisplayName(domCode) }));
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

function startRecording() {
  isRecording.value = true;
  recordingWarning.value = "";
  recordingHint.value = "";

  // Dynamic keydown listener (Review F11)
  document.addEventListener("keydown", handleKeydownForRecording, {
    capture: true,
    once: true,
  });

  // 10s timeout (Review F3)
  recordingTimeoutId = setTimeout(() => {
    if (isRecording.value) {
      hotkeyFeedback.show("error", settingsStore.getHotkeyRecordingTimeoutMessage());
      stopKeyRecording();
    }
  }, RECORDING_TIMEOUT_MS);
}

function stopKeyRecording() {
  isRecording.value = false;
  clearTimeout(recordingTimeoutId);
  document.removeEventListener("keydown", handleKeydownForRecording, {
    capture: true,
  });
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

const isConfirmingResetPrompt = ref(false);
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
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.saveAiPrompt(promptInput.value);
    promptFeedback.show("success", t("settings.prompt.saved"));
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
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
    promptInput.value = settingsStore.getAiPrompt();
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

// ── 轉錄引擎 ──────────────────────────────────────────────
const localModelPathInput = ref(settingsStore.localModelPath || "");
const transcriptionProviderFeedback = useFeedbackMessage();

async function handleProviderChange(value: string) {
  try {
    await settingsStore.saveTranscriptionProvider(value as TranscriptionProvider);
    transcriptionProviderFeedback.show("success", t("settings.transcription.providerUpdated"));
  } catch (err) {
    transcriptionProviderFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLoadModel() {
  try {
    await settingsStore.loadLocalModel(localModelPathInput.value);
    transcriptionProviderFeedback.show("success", t("settings.transcription.modelLoadSuccess"));
  } catch (err) {
    transcriptionProviderFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleUnloadModel() {
  try {
    await settingsStore.unloadLocalModel();
    transcriptionProviderFeedback.show("success", t("settings.transcription.modelUnloaded"));
  } catch (err) {
    transcriptionProviderFeedback.show("error", extractErrorMessage(err));
  }
}

watch(() => settingsStore.localModelPath, (newPath) => {
  if (newPath && !localModelPathInput.value) {
    localModelPathInput.value = newPath;
  }
});

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
  return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
});

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

const vocabularyAnalysisModelDescription = computed(() => {
  const config = findVocabularyAnalysisModelConfig(
    settingsStore.selectedVocabularyAnalysisModelId,
  );
  if (!config) return "";
  return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
});

async function handleToggleSmartDictionary(newValue: boolean) {
  try {
    await settingsStore.saveSmartDictionaryEnabled(newValue);
    smartDictionaryFeedback.show("success", t("common.save"));
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleVocabularyAnalysisModelChange(
  newId: VocabularyAnalysisModelId,
) {
  try {
    await settingsStore.saveVocabularyAnalysisModel(newId);
    smartDictionaryFeedback.show(
      "success",
      t("settings.smartDictionary.analysisModelUpdated"),
    );
  } catch (err) {
    smartDictionaryFeedback.show("error", extractErrorMessage(err));
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

onMounted(async () => {
  promptInput.value = settingsStore.getAiPrompt();
  if (settingsStore.hasApiKey) {
    apiKeyInput.value = settingsStore.getApiKey();
  }
  thresholdEnabled.value = settingsStore.isEnhancementThresholdEnabled;
  thresholdCharCount.value = settingsStore.enhancementThresholdCharCount;
  await settingsStore.loadAutoStartStatus();

  // Detect if current key is custom
  const currentKey = settingsStore.hotkeyConfig?.triggerKey;
  if (currentKey && isCustomTriggerKey(currentKey)) {
    isCustomMode.value = true;
  }
});

onBeforeUnmount(() => {
  stopKeyRecording();
  hotkeyFeedback.clearTimer();
  apiKeyFeedback.clearTimer();
  promptFeedback.clearTimer();
  enhancementThresholdFeedback.clearTimer();
  transcriptionProviderFeedback.clearTimer();
  modelFeedback.clearTimer();
  muteOnRecordingFeedback.clearTimer();
  localeFeedback.clearTimer();
  transcriptionLocaleFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  smartDictionaryFeedback.clearTimer();
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

    <!-- 轉錄引擎 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">{{ $t("settings.transcription.providerLabel") }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="transcription-provider">{{ $t("settings.transcription.providerLabel") }}</Label>
          <Select
            :model-value="settingsStore.transcriptionProvider"
            @update:model-value="handleProviderChange($event as string)"
          >
            <SelectTrigger id="transcription-provider" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloud">{{ $t("settings.transcription.cloud") }}</SelectItem>
              <SelectItem value="local">{{ $t("settings.transcription.local") }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">
            {{ settingsStore.transcriptionProvider === "local"
              ? $t("settings.transcription.localDescription")
              : $t("settings.transcription.cloudDescription") }}
          </p>
        </div>

        <!-- Local model config -->
        <div v-if="settingsStore.transcriptionProvider === 'local'" class="space-y-3">
          <div class="space-y-2">
            <Label for="local-model-path">{{ $t("settings.transcription.modelPathLabel") }}</Label>
            <div class="flex gap-2">
              <Input
                id="local-model-path"
                v-model="localModelPathInput"
                :placeholder="$t('settings.transcription.modelPathPlaceholder')"
                class="flex-1"
              />
            </div>
            <p class="text-xs text-muted-foreground">
              {{ $t("settings.transcription.modelPathHint") }}
            </p>
          </div>

          <div class="flex items-center gap-3">
            <Button
              v-if="!settingsStore.isLocalModelLoaded"
              :disabled="!localModelPathInput || settingsStore.isLocalModelLoading"
              @click="handleLoadModel"
            >
              <Loader2 v-if="settingsStore.isLocalModelLoading" class="mr-2 h-4 w-4 animate-spin" />
              {{ settingsStore.isLocalModelLoading
                ? $t("settings.transcription.loading")
                : $t("settings.transcription.loadModel") }}
            </Button>
            <Button
              v-else
              variant="outline"
              @click="handleUnloadModel"
            >
              {{ $t("settings.transcription.unloadModel") }}
            </Button>

            <Badge v-if="settingsStore.isLocalModelLoaded" variant="secondary">
              {{ $t("settings.transcription.modelLoaded") }}
            </Badge>
          </div>
        </div>

        <transition name="feedback-fade">
          <p
            v-if="transcriptionProviderFeedback.message.value !== ''"
            class="text-sm"
            :class="
              transcriptionProviderFeedback.type.value === 'success'
                ? 'text-green-400'
                : 'text-red-400'
            "
          >
            {{ transcriptionProviderFeedback.message.value }}
          </p>
        </transition>
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
                v-for="model in LLM_MODEL_LIST"
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

        <Textarea
          v-model="promptInput"
          class="font-mono min-h-[120px]"
        />

        <div class="flex justify-end gap-2">
          <Button
            :disabled="isSubmittingPrompt"
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

        <!-- 字典分析模型 -->
        <div v-if="settingsStore.isSmartDictionaryEnabled" class="space-y-2">
          <Label for="vocabulary-analysis-model">{{ $t("settings.smartDictionary.analysisModelLabel") }}</Label>
          <Select
            :model-value="settingsStore.selectedVocabularyAnalysisModelId"
            @update:model-value="handleVocabularyAnalysisModelChange($event as VocabularyAnalysisModelId)"
          >
            <SelectTrigger id="vocabulary-analysis-model" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="model in VOCABULARY_ANALYSIS_MODEL_LIST"
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
          <p class="text-xs text-muted-foreground">
            {{ $t("settings.smartDictionary.analysisModelDescription") }}
          </p>
          <p class="text-xs text-muted-foreground">{{ vocabularyAnalysisModelDescription }}</p>
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
