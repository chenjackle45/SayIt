import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  type ComboTriggerKey,
  type PromptMode,
  PROMPT_MODE_VALUES,
  isCustomTriggerKey,
  isComboTriggerKey,
  isPresetTriggerKey,
} from "../types/settings";
import {
  getKeyDisplayName,
  getComboTriggerKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
} from "../lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { getDefaultSystemPrompt } from "../lib/enhancer";
import {
  getMinimalPromptForLocale,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "../i18n/prompts";
import i18n from "../i18n";
import {
  type SupportedLocale,
  type TranscriptionLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
} from "../i18n/languageConfig";
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_LLM_PROVIDER_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  getDefaultModelIdForProvider,
  findLlmModelConfig,
  type LlmModelId,
  type LlmProviderId,
  type WhisperModelId,
} from "../lib/modelRegistry";

declare const __APP_VERSION__: string;

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = navigator.userAgent.includes("Mac"); // macOS only — Windows 尚未支援 text field 讀取
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
const DEFAULT_PROMPT_MODE: PromptMode = "minimal";
const DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED = false;
const DEFAULT_RECORDING_AUTO_CLEANUP_DAYS = 7;

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (⌥)",
  rightOption: "Right Option (⌥)",
  command: "Command (⌘)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (⌃)",
  rightControl: "Right Control",
  shift: "Shift (⇧)",
};

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  const apiKey = ref<string>("");
  const hasApiKey = computed(() => apiKey.value !== "");
  const aiPrompt = ref<string>(getDefaultSystemPrompt());
  const promptMode = ref<PromptMode>(DEFAULT_PROMPT_MODE);
  const showPromptUpgradeNotice = ref(false);
  const isAutoStartEnabled = ref(false);
  const isEnhancementThresholdEnabled = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  );
  const enhancementThresholdCharCount = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  );
  const selectedLlmProviderId = ref<LlmProviderId>(DEFAULT_LLM_PROVIDER_ID);
  const selectedLlmModelId = ref<LlmModelId>(DEFAULT_LLM_MODEL_ID);
  const selectedWhisperModelId = ref<WhisperModelId>(DEFAULT_WHISPER_MODEL_ID);
  const openaiApiKey = ref<string>("");
  const anthropicApiKey = ref<string>("");
  const geminiApiKey = ref<string>("");
  const hasLlmApiKey = computed(() => {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value !== "";
      case "openai":
        return openaiApiKey.value !== "";
      case "anthropic":
        return anthropicApiKey.value !== "";
      case "gemini":
        return geminiApiKey.value !== "";
    }
  });
  const customTriggerKey = ref<CustomTriggerKey | ComboTriggerKey | null>(null);
  const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);
  const isSmartDictionaryEnabled = ref<boolean>(
    DEFAULT_SMART_DICTIONARY_ENABLED,
  );
  const customTriggerKeyDomCode = ref<string>("");
  const selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE);
  const selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE);
  const isSoundEffectsEnabled = ref<boolean>(DEFAULT_SOUND_EFFECTS_ENABLED);
  const isRecordingAutoCleanupEnabled = ref<boolean>(
    DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
  );
  const recordingAutoCleanupDays = ref<number>(
    DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
  );
  const selectedAudioInputDeviceName = ref<string>("");
  let isLoaded = false;

  /** Resolve which SupportedLocale to use for prompt default (shared logic). */
  function getEffectivePromptLocale(): SupportedLocale {
    return selectedTranscriptionLocale.value === "auto"
      ? selectedLocale.value
      : selectedTranscriptionLocale.value;
  }

  function getApiKey(): string {
    return apiKey.value;
  }

  function getLlmApiKey(): string {
    switch (selectedLlmProviderId.value) {
      case "groq":
        return apiKey.value;
      case "openai":
        return openaiApiKey.value;
      case "anthropic":
        return anthropicApiKey.value;
      case "gemini":
        return geminiApiKey.value;
    }
  }

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] Failed to sync hotkey config:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "sync-hotkey" });
    }
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedApiKey = await store.get<string>("groqApiKey");

      // Backward-compatible key parsing: string → PresetTriggerKey, object → CustomTriggerKey
      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      apiKey.value = savedApiKey?.trim() ?? "";

      // Load independently persisted custom/combo key
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      if (
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey))
      ) {
        customTriggerKey.value = savedCustomKey;
        customTriggerKeyDomCode.value = savedCustomDomCode ?? "";
      }

      // Load locale (first launch: detect system language, upgrade: fallback to zh-TW)
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      if (savedLocale) {
        selectedLocale.value = savedLocale;
      } else {
        const detected = detectSystemLocale();
        selectedLocale.value = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      // Load transcription locale (migration: default to UI locale if missing)
      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      if (savedTranscriptionLocale) {
        selectedTranscriptionLocale.value = savedTranscriptionLocale;
      } else {
        selectedTranscriptionLocale.value = selectedLocale.value;
        await store.set("selectedTranscriptionLocale", selectedLocale.value);
        await store.save();
      }

      // Load aiPrompt once (used by both migration and normal flow)
      const savedPrompt = await store.get<string>("aiPrompt");
      const trimmedSavedPrompt = savedPrompt?.trim() ?? "";

      // Prompt mode migration
      const savedPromptMode = await store.get<string>("promptMode");
      if (
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
      ) {
        promptMode.value = savedPromptMode as PromptMode;
      } else if (!savedPromptMode) {
        // 舊版升級遷移
        if (!trimmedSavedPrompt || isKnownDefaultPrompt(trimmedSavedPrompt)) {
          promptMode.value = "minimal";
        } else {
          promptMode.value = "custom";
        }
        await store.set("promptMode", promptMode.value);
        await store.save();
      }

      aiPrompt.value =
        trimmedSavedPrompt ||
        getMinimalPromptForLocale(getEffectivePromptLocale());

      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;

      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;

      // LLM Provider
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      selectedLlmProviderId.value = savedLlmProviderId ?? DEFAULT_LLM_PROVIDER_ID;

      // OpenAI / Anthropic API keys
      const savedOpenaiApiKey = await store.get<string>("openaiApiKey");
      openaiApiKey.value = savedOpenaiApiKey?.trim() ?? "";
      const savedAnthropicApiKey = await store.get<string>("anthropicApiKey");
      anthropicApiKey.value = savedAnthropicApiKey?.trim() ?? "";
      const savedGeminiApiKey = await store.get<string>("geminiApiKey");
      geminiApiKey.value = savedGeminiApiKey?.trim() ?? "";

      // LLM Model ID（含 Kimi K2 遷移）
      const savedLlmModelId = await store.get<string>("llmModelId");
      const llmMigratedFromKimiK2 = await store.get<boolean>(
        "llmMigratedFromKimiK2",
      );
      if (
        !llmMigratedFromKimiK2 &&
        savedLlmModelId === "moonshotai/kimi-k2-instruct"
      ) {
        selectedLlmModelId.value = DEFAULT_LLM_MODEL_ID;
        selectedLlmProviderId.value = "groq";
        await store.set("llmModelId", DEFAULT_LLM_MODEL_ID);
        await store.set("llmProviderId", "groq");
        await store.set("llmMigratedFromKimiK2", true);
        await store.save();
      } else {
        const effectiveLlmModelId = getEffectiveLlmModelId(
          savedLlmModelId ?? null,
        );
        selectedLlmModelId.value = effectiveLlmModelId;
      }

      // model-provider 交叉驗證：防止 key 洩漏到錯誤 provider
      const modelConfig = findLlmModelConfig(selectedLlmModelId.value);
      if (modelConfig && modelConfig.providerId !== selectedLlmProviderId.value) {
        selectedLlmModelId.value = getDefaultModelIdForProvider(
          selectedLlmProviderId.value,
        );
        await store.set("llmModelId", selectedLlmModelId.value);
        await store.save();
      }

      const savedWhisperModelId = await store.get<string>("whisperModelId");
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );

      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;

      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;

      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecordingAutoCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecordingAutoCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;

      const savedRecordingAutoCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecordingAutoCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedAudioInputDeviceName = await store.get<string>(
        "audioInputDeviceName",
      );
      selectedAudioInputDeviceName.value = savedAudioInputDeviceName ?? "";

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
      isEnhancementThresholdEnabled.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      isMuteOnRecordingEnabled.value = DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value = DEFAULT_SOUND_EFFECTS_ENABLED;
    }
  }

  async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync to Rust immediately
      await syncHotkeyConfigToRust(key, mode);

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  }

  async function saveCustomTriggerKey(
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      // Persist custom key independently (survives mode switching)
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = customKey;
      customTriggerKeyDomCode.value = domCode;

      // Reuse shared logic for active key + Rust sync + event broadcast
      await saveHotkeyConfig(customKey, mode);

      console.log(
        `[useSettingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveComboTriggerKey(
    comboKey: ComboTriggerKey,
    domCode: string,
    mode: TriggerMode,
  ) {
    try {
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", comboKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = comboKey;
      customTriggerKeyDomCode.value = domCode;

      await saveHotkeyConfig(comboKey, mode);

      console.log(
        `[useSettingsStore] Combo trigger key saved: modifiers=${JSON.stringify(comboKey.combo.modifiers)}, keycode=${comboKey.combo.keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveComboTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode) {
    // Only update active key; keep customTriggerKey intact
    await saveHotkeyConfig(presetKey, mode);
  }

  async function switchToCustomMode(mode: TriggerMode) {
    if (!customTriggerKey.value) return;
    // Restore custom key as active key
    await saveHotkeyConfig(customTriggerKey.value, mode);
  }

  function getTriggerKeyDisplayName(key: TriggerKey): string {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    if (isComboTriggerKey(key)) {
      return getComboTriggerKeyDisplayName(key);
    }
    if (isCustomTriggerKey(key)) {
      // For custom keys, use saved DOM code to look up display name
      if (customTriggerKeyDomCode.value) {
        return getKeyDisplayName(customTriggerKeyDomCode.value);
      }
      return i18n.global.t("settings.hotkey.customKeyDisplay", {
        keycode: key.custom.keycode,
      });
    }
    return String(key);
  }

  async function saveApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      apiKey.value = trimmedKey;

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-api-key" });
      throw err;
    }
  }

  async function refreshApiKey() {
    try {
      const store = await load(STORE_NAME);
      const savedApiKey = await store.get<string>("groqApiKey");
      apiKey.value = savedApiKey?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function deleteApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("groqApiKey");
      await store.save();
      apiKey.value = "";

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function getAiPrompt(): string {
    if (promptMode.value === "custom") return aiPrompt.value;
    return getPromptForModeAndLocale(
      promptMode.value,
      getEffectivePromptLocale(),
    );
  }

  async function savePromptMode(mode: PromptMode) {
    const previousMode = promptMode.value;
    promptMode.value = mode;
    try {
      const store = await load(STORE_NAME);
      await store.set("promptMode", mode);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: mode,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Prompt mode saved: ${mode}`);
    } catch (err) {
      promptMode.value = previousMode;
      console.error(
        "[useSettingsStore] savePromptMode failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-prompt-mode" });
      throw err;
    }
  }

  /** 只由 Dashboard (main-window.ts) 呼叫，比對版本號決定是否顯示升級提示 */
  async function consumeUpgradeNotice() {
    try {
      const store = await load(STORE_NAME);
      const lastSeenVersion = await store.get<string>("lastSeenVersion");

      if (lastSeenVersion === null || lastSeenVersion === undefined) {
        // 區分首次安裝 vs 舊版升級：有 API key = 老使用者
        const existingApiKey = await store.get<string>("groqApiKey");
        if (existingApiKey) {
          showPromptUpgradeNotice.value = true;
        }
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
        return;
      }

      if (lastSeenVersion !== __APP_VERSION__) {
        showPromptUpgradeNotice.value = true;
        await store.set("lastSeenVersion", __APP_VERSION__);
        await store.save();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] consumeUpgradeNotice failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveAiPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      throw new Error(i18n.global.t("errors.promptEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      aiPrompt.value = trimmedPrompt;

      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: trimmedPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function resetAiPrompt() {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getMinimalPromptForLocale(
        getEffectivePromptLocale(),
      );
      promptMode.value = "minimal";
      aiPrompt.value = defaultPrompt;
      await store.set("promptMode", "minimal");
      await store.set("aiPrompt", defaultPrompt);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: "minimal",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt reset to minimal");
    } catch (err) {
      console.error(
        "[useSettingsStore] resetAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveEnhancementThreshold(enabled: boolean, charCount: number) {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      isEnhancementThresholdEnabled.value = enabled;
      enhancementThresholdCharCount.value = validatedCharCount;

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmModel(id: LlmModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", id);
      await store.save();
      selectedLlmModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmProvider(providerId: LlmProviderId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmProviderId", providerId);

      // 切換 provider 時重設為該 provider 預設模型
      const defaultModelId = getDefaultModelIdForProvider(providerId);
      await store.set("llmModelId", defaultModelId);
      await store.save();

      selectedLlmProviderId.value = providerId;
      selectedLlmModelId.value = defaultModelId;

      const payload: SettingsUpdatedPayload = {
        key: "llmProvider",
        value: providerId,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] LLM provider saved: ${providerId}, model reset to: ${defaultModelId}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmProvider failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-llm-provider" });
      throw err;
    }
  }

  async function saveOpenaiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("openaiApiKey", trimmedKey);
      await store.save();
      openaiApiKey.value = trimmedKey;
      console.log("[useSettingsStore] OpenAI API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-openai-api-key" });
      throw err;
    }
  }

  async function deleteOpenaiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("openaiApiKey");
      await store.save();
      openaiApiKey.value = "";
      console.log("[useSettingsStore] OpenAI API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteOpenaiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveAnthropicApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("anthropicApiKey", trimmedKey);
      await store.save();
      anthropicApiKey.value = trimmedKey;
      console.log("[useSettingsStore] Anthropic API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-anthropic-api-key",
      });
      throw err;
    }
  }

  async function deleteAnthropicApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("anthropicApiKey");
      await store.save();
      anthropicApiKey.value = "";
      console.log("[useSettingsStore] Anthropic API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteAnthropicApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveGeminiApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }
    try {
      const store = await load(STORE_NAME);
      await store.set("geminiApiKey", trimmedKey);
      await store.save();
      geminiApiKey.value = trimmedKey;
      console.log("[useSettingsStore] Gemini API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-gemini-api-key",
      });
      throw err;
    }
  }

  async function deleteGeminiApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("geminiApiKey");
      await store.save();
      geminiApiKey.value = "";
      console.log("[useSettingsStore] Gemini API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteGeminiApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshLlmApiKey() {
    try {
      const store = await load(STORE_NAME);
      switch (selectedLlmProviderId.value) {
        case "groq": {
          const savedApiKey = await store.get<string>("groqApiKey");
          apiKey.value = savedApiKey?.trim() ?? "";
          break;
        }
        case "openai": {
          const savedKey = await store.get<string>("openaiApiKey");
          openaiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "anthropic": {
          const savedKey = await store.get<string>("anthropicApiKey");
          anthropicApiKey.value = savedKey?.trim() ?? "";
          break;
        }
        case "gemini": {
          const savedKey = await store.get<string>("geminiApiKey");
          geminiApiKey.value = savedKey?.trim() ?? "";
          break;
        }
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshLlmApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function saveWhisperModel(id: WhisperModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperModelId", id);
      await store.save();
      selectedWhisperModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "whisperModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Whisper model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveWhisperModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function loadAutoStartStatus() {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      isAutoStartEnabled.value = await isEnabled();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function toggleAutoStart() {
    try {
      if (isAutoStartEnabled.value) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        isAutoStartEnabled.value = false;
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        isAutoStartEnabled.value = true;
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLocale(locale: SupportedLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedLocale", locale);
      selectedLocale.value = locale;
      i18n.global.locale.value = locale;
      document.documentElement.lang = getHtmlLangForLocale(locale);

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-locale" });
      throw err;
    }
  }

  async function saveTranscriptionLocale(locale: TranscriptionLocale) {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedTranscriptionLocale", locale);
      selectedTranscriptionLocale.value = locale;

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "transcriptionLocale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Transcription locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveTranscriptionLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-transcription-locale",
      });
      throw err;
    }
  }

  function getWhisperLanguageCode(): string | null {
    return getWhisperCodeForTranscriptionLocale(
      selectedTranscriptionLocale.value,
    );
  }

  async function saveMuteOnRecording(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      isMuteOnRecordingEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-mute" });
      throw err;
    }
  }

  async function saveSoundEffectsEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundEffectsEnabled", enabled);
      await store.save();
      isSoundEffectsEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "soundEffectsEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  }

  async function saveSmartDictionaryEnabled(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("smartDictionaryEnabled", enabled);
      await store.save();
      isSmartDictionaryEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "smartDictionaryEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[useSettingsStore] smartDictionaryEnabled saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveSmartDictionaryEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-smart-dictionary",
      });
      throw err;
    }
  }

  async function saveRecordingAutoCleanup(enabled: boolean, days: number) {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("recordingAutoCleanupEnabled", enabled);
      await store.set("recordingAutoCleanupDays", validatedDays);
      await store.save();

      isRecordingAutoCleanupEnabled.value = enabled;
      recordingAutoCleanupDays.value = validatedDays;

      console.log(
        `[useSettingsStore] Recording auto cleanup saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveRecordingAutoCleanup failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-auto-cleanup",
      });
      throw err;
    }
  }

  async function saveAudioInputDevice(deviceName: string) {
    try {
      const store = await load(STORE_NAME);
      await store.set("audioInputDeviceName", deviceName);
      await store.save();

      selectedAudioInputDeviceName.value = deviceName;

      const payload: SettingsUpdatedPayload = {
        key: "audioInputDevice",
        value: deviceName,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Audio input device saved: "${deviceName || "(system default)"}"`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAudioInputDevice failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-audio-input-device",
      });
      throw err;
    }
  }

  async function refreshCrossWindowSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<TriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedApiKey = await store.get<string>("groqApiKey");
      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmProviderId =
        await store.get<LlmProviderId>("llmProviderId");
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedOpenaiKey = await store.get<string>("openaiApiKey");
      const savedAnthropicKey = await store.get<string>("anthropicApiKey");
      const savedGeminiKey = await store.get<string>("geminiApiKey");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );

      hotkeyConfig.value = {
        triggerKey: savedKey ?? getDefaultTriggerKey(),
        triggerMode: savedMode ?? "hold",
      };
      const isValidCustomOrCombo =
        savedCustomKey &&
        typeof savedCustomKey === "object" &&
        (isCustomTriggerKey(savedCustomKey) ||
          isComboTriggerKey(savedCustomKey));
      customTriggerKey.value = isValidCustomOrCombo ? savedCustomKey : null;
      customTriggerKeyDomCode.value = isValidCustomOrCombo
        ? (savedCustomDomCode ?? "")
        : "";
      // Locale + transcription locale must be synced first — aiPrompt fallback depends on them
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      selectedLocale.value = savedLocale ?? FALLBACK_LOCALE;
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      selectedTranscriptionLocale.value =
        savedTranscriptionLocale ?? selectedLocale.value;

      // Prompt mode (with runtime validation)
      const savedPromptMode = await store.get<string>("promptMode");
      promptMode.value =
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
          ? (savedPromptMode as PromptMode)
          : DEFAULT_PROMPT_MODE;

      apiKey.value = savedApiKey?.trim() ?? "";
      aiPrompt.value =
        savedPrompt?.trim() ||
        getMinimalPromptForLocale(getEffectivePromptLocale());
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      selectedLlmProviderId.value =
        savedLlmProviderId ?? DEFAULT_LLM_PROVIDER_ID;
      const effectiveCrossWindowModelId = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      const crossWindowModelConfig = findLlmModelConfig(effectiveCrossWindowModelId);
      selectedLlmModelId.value =
        crossWindowModelConfig?.providerId === selectedLlmProviderId.value
          ? effectiveCrossWindowModelId
          : getDefaultModelIdForProvider(selectedLlmProviderId.value);
      openaiApiKey.value = savedOpenaiKey?.trim() ?? "";
      anthropicApiKey.value = savedAnthropicKey?.trim() ?? "";
      geminiApiKey.value = savedGeminiKey?.trim() ?? "";
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;
      isSoundEffectsEnabled.value =
        savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED;
      isSmartDictionaryEnabled.value =
        savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED;

      const savedRecCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      isRecordingAutoCleanupEnabled.value =
        savedRecCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED;
      const savedRecCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      recordingAutoCleanupDays.value =
        savedRecCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS;

      const savedAudioDevice = await store.get<string>("audioInputDeviceName");
      selectedAudioInputDeviceName.value = savedAudioDevice ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "refresh-cross-window" });
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.save();
        isAutoStartEnabled.value = true;
        console.log("[useSettingsStore] Auto-start enabled on first launch");
      } else {
        await loadAutoStartStatus();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    aiPrompt,
    promptMode,
    showPromptUpgradeNotice,
    isAutoStartEnabled,
    isEnhancementThresholdEnabled,
    enhancementThresholdCharCount,
    selectedLlmProviderId,
    selectedLlmModelId,
    selectedWhisperModelId,
    hasLlmApiKey,
    openaiApiKey: computed(() => openaiApiKey.value),
    anthropicApiKey: computed(() => anthropicApiKey.value),
    geminiApiKey: computed(() => geminiApiKey.value),
    getApiKey,
    getLlmApiKey,
    getAiPrompt,
    savePromptMode,
    consumeUpgradeNotice,
    saveAiPrompt,
    resetAiPrompt,
    refreshApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveCustomTriggerKey,
    saveComboTriggerKey,
    switchToPresetMode,
    switchToCustomMode,
    getTriggerKeyDisplayName,
    customTriggerKey,
    customTriggerKeyDomCode,
    // Hotkey recording helpers (proxied from lib/ for views)
    getPlatformKeycode,
    getKeyDisplayName,
    isPresetEquivalentKey,
    getDangerousKeyWarning,
    getEscapeReservedMessage,
    getHotkeyRecordingTimeoutMessage,
    getHotkeyUnsupportedKeyMessage,
    getHotkeyPresetHint,
    saveApiKey,
    deleteApiKey,
    saveEnhancementThreshold,
    saveLlmModel,
    saveLlmProvider,
    saveOpenaiApiKey,
    deleteOpenaiApiKey,
    saveAnthropicApiKey,
    deleteAnthropicApiKey,
    saveGeminiApiKey,
    deleteGeminiApiKey,
    refreshLlmApiKey,
    saveWhisperModel,
    isMuteOnRecordingEnabled,
    saveMuteOnRecording,
    isSoundEffectsEnabled,
    saveSoundEffectsEnabled,
    isSmartDictionaryEnabled,
    saveSmartDictionaryEnabled,
    isRecordingAutoCleanupEnabled,
    recordingAutoCleanupDays,
    saveRecordingAutoCleanup,
    selectedAudioInputDeviceName,
    saveAudioInputDevice,
    selectedLocale,
    saveLocale,
    selectedTranscriptionLocale,
    saveTranscriptionLocale,
    getWhisperLanguageCode,
    refreshCrossWindowSettings,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
  };
});
