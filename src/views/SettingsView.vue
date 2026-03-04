<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
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
  WHISPER_MODEL_LIST,
  findLlmModelConfig,
  findWhisperModelConfig,
  type LlmModelId,
  type WhisperModelId,
} from "../lib/modelRegistry";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const settingsStore = useSettingsStore();

// ── 快捷鍵設定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const MAC_TRIGGER_KEY_OPTIONS: { value: PresetTriggerKey; label: string }[] = [
  { value: "fn", label: "Fn" },
  { value: "option", label: "左 Option (⌥)" },
  { value: "rightOption", label: "右 Option (⌥)" },
  { value: "control", label: "左 Control (⌃)" },
  { value: "rightControl", label: "右 Control (⌃)" },
  { value: "command", label: "Command (⌘)" },
  { value: "shift", label: "Shift (⇧)" },
];

const WINDOWS_TRIGGER_KEY_OPTIONS: { value: PresetTriggerKey; label: string }[] = [
  { value: "rightAlt", label: "右 Alt" },
  { value: "leftAlt", label: "左 Alt" },
  { value: "control", label: "Control" },
  { value: "shift", label: "Shift" },
];

const triggerKeyOptions = isMac
  ? MAC_TRIGGER_KEY_OPTIONS
  : WINDOWS_TRIGGER_KEY_OPTIONS;

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
    hotkeyFeedback.show("success", `觸發鍵已設為 ${settingsStore.getKeyDisplayName(domCode)}`);
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
    hotkeyFeedback.show("success", "觸發鍵已更新");
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyFeedback.show("success", "觸發模式已更新");
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
  settingsStore.hasApiKey ? "已設定" : "未設定",
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
    apiKeyFeedback.show("success", "API Key 已儲存");
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
    apiKeyFeedback.show("success", "API Key 已刪除");
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
    promptFeedback.show("success", "Prompt 已儲存");
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
    promptFeedback.show("success", "已重置為預設");
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
      thresholdEnabled.value ? "已啟用短文字門檻" : "已停用短文字門檻",
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
    enhancementThresholdFeedback.show("success", "門檻字數已儲存");
  } catch (err) {
    enhancementThresholdFeedback.show("error", extractErrorMessage(err));
  }
}

// ── 模型選擇 ──────────────────────────────────────────────
const modelFeedback = useFeedbackMessage();

const whisperModelDescription = computed(() => {
  const config = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
  if (!config) return "";
  return `每小時 $${config.costPerHour}`;
});

const llmModelDescription = computed(() => {
  const config = findLlmModelConfig(settingsStore.selectedLlmModelId);
  if (!config) return "";
  return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
});

async function handleWhisperModelChange(newId: WhisperModelId) {
  try {
    await settingsStore.saveWhisperModel(newId);
    modelFeedback.show("success", "語音轉錄模型已更新");
  } catch (err) {
    modelFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleLlmModelChange(newId: LlmModelId) {
  try {
    await settingsStore.saveLlmModel(newId);
    modelFeedback.show("success", "文字整理模型已更新");
  } catch (err) {
    modelFeedback.show("error", extractErrorMessage(err));
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
      settingsStore.isAutoStartEnabled ? "已啟用開機自啟動" : "已關閉開機自啟動",
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
  modelFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(resetPromptConfirmTimeoutId);
});
</script>

<template>
  <div class="p-6 space-y-6 text-foreground">
    <!-- 快捷鍵設定 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">快捷鍵設定</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4 pt-5">
        <!-- 簡易 / 自訂 模式切換 -->
        <div class="flex items-center justify-between">
          <Label>觸發鍵模式</Label>
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
              簡易
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
              自訂
            </button>
          </div>
        </div>

        <!-- 簡易模式：Select 下拉 -->
        <div v-if="!isCustomMode" class="flex items-center justify-between">
          <Label for="trigger-key">觸發鍵</Label>
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
            <Label>自訂觸發鍵</Label>
            <div class="flex items-center gap-3">
              <span v-if="hasCustomKey" class="text-sm font-medium text-foreground">
                {{ currentCustomKeyDisplay }}
              </span>
              <span v-else class="text-sm text-muted-foreground">未設定</span>
              <Button
                :variant="isRecording ? 'destructive' : 'outline'"
                size="sm"
                :class="{ 'animate-pulse': isRecording }"
                @click="isRecording ? stopKeyRecording() : startRecording()"
              >
                {{ isRecording ? '請按下按鍵...' : '錄製' }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            Fn、媒體鍵等系統鍵請使用簡易模式
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
          <Label for="trigger-mode">觸發模式</Label>
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
              ? "按住錄音，放開停止"
              : "按一下開始，再按停止"
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
          前往 Groq Console &rarr;
        </a>
      </CardHeader>
      <CardContent class="space-y-4 pt-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          請在
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            class="text-primary hover:underline"
          >
            Groq Console
          </a>
          產生 API Key 後貼上。
        </p>

        <p
          v-if="shouldShowOnboardingHint"
          class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200"
        >
          歡迎使用 SayIt！請先設定 Groq API Key 以啟用語音輸入功能。
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
              {{ isApiKeyVisible ? "隱藏" : "顯示" }}
            </Button>
          </div>
          <Button
            :disabled="isSubmittingApiKey"
            @click="handleSaveApiKey"
          >
            儲存
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
            {{ isConfirmingDeleteApiKey ? '確認刪除？' : '刪除 API Key' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 模型選擇 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">模型選擇</CardTitle>
      </CardHeader>
      <CardContent class="space-y-5 pt-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          選擇語音轉錄和文字整理使用的 AI 模型。速度較快的模型回應更即時，較大的模型品質更好。
        </p>

        <!-- Whisper 模型 -->
        <div class="space-y-2">
          <Label for="whisper-model">語音轉錄模型（Whisper）</Label>
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
                <div class="flex items-center gap-2">
                  <span>{{ model.displayName }}</span>
                  <Badge v-if="model.isDefault" variant="secondary" class="text-xs">預設</Badge>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ whisperModelDescription }}</p>
        </div>

        <!-- LLM 模型 -->
        <div class="space-y-2">
          <Label for="llm-model">文字整理模型（LLM）</Label>
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
                <div class="flex items-center gap-2">
                  <span>{{ model.displayName }}</span>
                  <Badge v-if="model.isDefault" variant="secondary" class="text-xs">預設</Badge>
                </div>
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
        <CardTitle class="text-base">AI 整理 Prompt</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4 pt-5">
        <p class="text-sm text-muted-foreground">
          自訂 AI 整理文字時使用的系統提示詞。修改後點擊儲存。
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
            儲存
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
            {{ isConfirmingResetPrompt ? '確認重置？' : '重置為預設' }}
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
        <CardTitle class="text-base">短文字門檻</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4 pt-5">
        <p class="text-sm text-muted-foreground leading-relaxed">
          啟用後，低於指定字數的轉錄文字將跳過 AI 整理，直接貼上原文。停用則每次都做 AI 整理。
        </p>

        <div class="flex items-center justify-between">
          <Label for="threshold-toggle">{{ thresholdEnabled ? '已啟用' : '已停用' }}</Label>
          <Switch
            id="threshold-toggle"
            :model-value="thresholdEnabled"
            @update:model-value="handleToggleEnhancementThreshold"
          />
        </div>

        <div v-if="thresholdEnabled" class="flex items-center gap-3">
          <Label for="threshold-char-count">門檻字數</Label>
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
            儲存
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

    <!-- 應用程式 -->
    <Card>
      <CardHeader class="border-b border-border">
        <CardTitle class="text-base">應用程式</CardTitle>
      </CardHeader>
      <CardContent class="pt-5">
        <div class="flex items-center justify-between">
          <div>
            <Label for="auto-start">開機自動啟動</Label>
            <p class="text-sm text-muted-foreground">登入系統後自動啟動 SayIt</p>
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
            class="mt-3 text-sm"
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
