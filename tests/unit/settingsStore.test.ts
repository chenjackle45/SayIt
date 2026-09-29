import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock tauri-plugin-store
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/i18n/prompts", async () => {
  const LEGACY_PROMPT = "你是文字校對工具，不是對話助理。";
  const MINIMAL_PROMPT = "你是語音逐字稿的文字校對工具。";
  const ACTIVE_PROMPT = "你是語音逐字稿整理工具。";

  return {
    getMinimalPromptForLocale: () => MINIMAL_PROMPT,
    getPromptForModeAndLocale: (mode: string) =>
      mode === "active" ? ACTIVE_PROMPT : MINIMAL_PROMPT,
    getAutoLanguagePrompt: (mode: string, uiLocale: string) =>
      `AUTO:${mode}:${uiLocale}`,
    isKnownDefaultPrompt: (prompt: string) => {
      const trimmed = prompt.trim();
      return trimmed === LEGACY_PROMPT || trimmed === MINIMAL_PROMPT;
    },
    MINIMAL_PROMPTS: { "zh-TW": MINIMAL_PROMPT },
    ACTIVE_PROMPTS: { "zh-TW": ACTIVE_PROMPT },
  };
});

vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-TW",
  detectSystemLocale: () => "zh-TW",
  getHtmlLangForLocale: () => "zh-TW",
  getWhisperCodeForTranscriptionLocale: () => null,
}));

vi.mock("../../src/lib/enhancer", () => ({
  getDefaultSystemPrompt: () => "你是語音逐字稿的文字校對工具。",
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn(),
  SETTINGS_UPDATED: "settings:updated",
}));

vi.mock("../../src/lib/errorUtils", () => ({
  extractErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getHotkeyRecordingTimeoutMessage: () => "",
  getHotkeyUnsupportedKeyMessage: () => "",
  getHotkeyPresetHint: () => "",
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/lib/keycodeMap", () => ({
  getKeyDisplayName: () => "",
  getPlatformKeycode: () => 0,
  isPresetEquivalentKey: () => false,
  getDangerousKeyWarning: () => null,
  getEscapeReservedMessage: () => null,
}));

vi.mock("../../src/lib/modelRegistry", () => ({
  DEFAULT_LLM_MODEL_ID: "test-llm",
  DEFAULT_LLM_PROVIDER_ID: "groq",
  DEFAULT_WHISPER_MODEL_ID: "test-whisper",
  getEffectiveLlmModelId: (id: string | null) => id ?? "test-llm",
  getEffectiveWhisperModelId: (id: string | null) => id ?? "test-whisper",
  getModelListByProvider: () => [],
  getDefaultModelIdForProvider: () => "test-llm",
}));

vi.mock("../../src/lib/llmProvider", () => ({
  findProviderConfig: () => undefined,
}));

describe("useSettingsStore — prompt mode 遷移", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    mockStoreDelete.mockReset();

    // Default: return null for all keys
    mockStoreGet.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupStoreGetMock(overrides: Record<string, unknown>) {
    mockStoreGet.mockImplementation((key: string) => {
      if (key in overrides) return Promise.resolve(overrides[key]);
      return Promise.resolve(null);
    });
  }

  async function createStore() {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    return useSettingsStore();
  }

  it("[P0] 新安裝（store 無 promptMode 且無 aiPrompt）→ 設為 minimal", async () => {
    setupStoreGetMock({});
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 舊版預設 prompt（匹配 LEGACY）→ 遷移為 minimal", async () => {
    setupStoreGetMock({
      aiPrompt: "你是文字校對工具，不是對話助理。",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("minimal");
  });

  it("[P0] 舊版自訂 prompt（不匹配任何預設）→ 遷移為 custom，保留原文", async () => {
    const customPrompt = "我的自訂 prompt 完全不一樣";
    setupStoreGetMock({
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("custom");
    expect(store.getAiPrompt()).toBe(customPrompt);
  });

  it("[P0] 已有 promptMode（非遷移）→ 直接使用存的值", async () => {
    setupStoreGetMock({
      promptMode: "active",
      aiPrompt: "some prompt",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.promptMode).toBe("active");
  });

  it("[P0] getAiPrompt() minimal 模式 → 回傳 minimal preset", async () => {
    setupStoreGetMock({
      promptMode: "minimal",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是語音逐字稿的文字校對工具。");
  });

  it("[P0] getAiPrompt() active 模式 → 回傳 active preset", async () => {
    setupStoreGetMock({
      promptMode: "active",
    });
    const store = await createStore();
    await store.loadSettings();

    const prompt = store.getAiPrompt();
    expect(prompt).toBe("你是語音逐字稿整理工具。");
  });

  it("[P0] getAiPrompt() custom 模式 → 回傳 aiPrompt ref 值", async () => {
    const customPrompt = "完全自訂的 prompt";
    setupStoreGetMock({
      promptMode: "custom",
      aiPrompt: customPrompt,
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe(customPrompt);
  });

  it("[P0] #83 辨識語言自動 → getAiPrompt 改用自動版，帶介面語系", async () => {
    setupStoreGetMock({
      promptMode: "active",
      selectedLocale: "en",
      selectedTranscriptionLocale: "auto",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe("AUTO:active:en");
  });

  it("[P0] #83 辨識語言自動＋自訂指示 → 仍原樣回傳自訂指示", async () => {
    const customPrompt = "完全自訂的 prompt";
    setupStoreGetMock({
      promptMode: "custom",
      aiPrompt: customPrompt,
      selectedTranscriptionLocale: "auto",
    });
    const store = await createStore();
    await store.loadSettings();

    expect(store.getAiPrompt()).toBe(customPrompt);
  });
});
