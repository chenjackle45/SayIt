import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// gh-30：純修飾鍵和弦（ChordTriggerKey）在 store 的載入、跨視窗刷新、儲存與 Rust 同步

const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreDelete = vi.fn();
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: mockStoreGet,
    set: mockStoreSet,
    save: mockStoreSave,
    delete: mockStoreDelete,
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));
vi.mock("../../src/i18n", () => ({
  default: { global: { locale: { value: "zh-TW" }, t: (key: string) => key } },
}));
vi.mock("../../src/i18n/prompts", () => ({
  getMinimalPromptForLocale: () => "m",
  getPromptForModeAndLocale: () => "m",
  isKnownDefaultPrompt: () => true,
  MINIMAL_PROMPTS: { "zh-TW": "m" },
  ACTIVE_PROMPTS: { "zh-TW": "a" },
}));
vi.mock("../../src/i18n/languageConfig", () => ({
  FALLBACK_LOCALE: "zh-TW",
  detectSystemLocale: () => "zh-TW",
  getHtmlLangForLocale: () => "zh-TW",
  getWhisperCodeForTranscriptionLocale: () => null,
}));
vi.mock("../../src/lib/enhancer", () => ({ getDefaultSystemPrompt: () => "m" }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn(),
  SETTINGS_UPDATED: "settings:updated",
}));
vi.mock("../../src/lib/errorUtils", () => ({
  extractErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  getHotkeyRecordingTimeoutMessage: () => "",
  getHotkeyUnsupportedKeyMessage: () => "",
  getHotkeyPresetHint: () => "",
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/lib/keycodeMap", () => ({
  getKeyDisplayName: () => "",
  getPlatformKeycode: () => 0,
  isPresetEquivalentKey: () => false,
  getDangerousKeyWarning: () => null,
  getEscapeReservedMessage: () => null,
  getComboTriggerKeyDisplayName: () => "COMBO",
  getChordTriggerKeyDisplayName: () => "CHORD",
}));
vi.mock("../../src/lib/modelRegistry", () => ({
  DEFAULT_LLM_MODEL_ID: "test-llm",
  DEFAULT_LLM_PROVIDER_ID: "groq",
  DEFAULT_WHISPER_MODEL_ID: "test-whisper",
  getEffectiveLlmModelId: (id: string | null) => id ?? "test-llm",
  getEffectiveWhisperModelId: (id: string | null) => id ?? "test-whisper",
  getModelListByProvider: () => [],
  getDefaultModelIdForProvider: () => "test-llm",
  findLlmModelConfig: () => undefined,
  findWhisperModelConfig: () => undefined,
}));
vi.mock("../../src/lib/llmProvider", () => ({ findProviderConfig: () => undefined }));

const CHORD = { chord: { keycodes: [0xa5, 0xa3] } };

describe("useSettingsStore — ChordTriggerKey", () => {
  beforeEach(() => {
    vi.resetModules();
    mockStoreGet.mockReset();
    mockStoreSet.mockReset();
    mockStoreSave.mockReset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    mockStoreGet.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  function setupStoreGetMock(overrides: Record<string, unknown>) {
    mockStoreGet.mockImplementation((key: string) =>
      Promise.resolve(key in overrides ? overrides[key] : null),
    );
  }
  async function createStore() {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSettingsStore } = await import("../../src/stores/useSettingsStore");
    return useSettingsStore();
  }

  it("loadSettings 接受 chord 並以和弦名稱顯示", async () => {
    setupStoreGetMock({ hotkeyTriggerKey: CHORD, customTriggerKey: CHORD, customTriggerKeyDomCode: "" });
    const store = await createStore();
    await store.loadSettings();
    expect(store.customTriggerKey).toEqual(CHORD);
    expect(store.hotkeyConfig?.triggerKey).toEqual(CHORD);
    expect(store.getTriggerKeyDisplayName(CHORD)).toBe("CHORD");
  });

  it("refreshCrossWindowSettings 接受 chord（重啟／跨視窗後仍顯示）", async () => {
    setupStoreGetMock({ hotkeyTriggerKey: "fn", customTriggerKey: CHORD });
    const store = await createStore();
    await store.refreshCrossWindowSettings();
    expect(store.customTriggerKey).toEqual(CHORD);
    // 切到預設鍵後 customTriggerKey 仍保留，切回自訂即還原
    expect(store.hotkeyConfig?.triggerKey).toBe("fn");
  });

  it("saveComboTriggerKey 接受 chord：持久化到 customTriggerKey 槽並同步 Rust", async () => {
    const store = await createStore();
    await store.saveComboTriggerKey(CHORD, "", "hold");
    expect(mockStoreSet).toHaveBeenCalledWith("customTriggerKey", CHORD);
    expect(store.customTriggerKey).toEqual(CHORD);
    expect(store.hotkeyConfig?.triggerKey).toEqual(CHORD);
    const syncCall = mockInvoke.mock.calls.find((c) => c[0] === "update_hotkey_config");
    expect(syncCall?.[1]).toMatchObject({ triggerKey: CHORD });
  });
});
