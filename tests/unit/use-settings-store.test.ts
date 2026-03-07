import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

describe("useSettingsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreDelete.mockClear();
    mockStoreSave.mockClear();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockEmit.mockClear().mockResolvedValue(undefined);
    vi.resetModules();
  });

  // ==========================================================================
  // loadSettings
  // ==========================================================================

  describe("loadSettings", () => {
    it("[P0] 應從 store 載入已儲存的 hotkey config", async () => {
      mockStoreData.set("hotkeyTriggerKey", "option");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("groqApiKey", "gsk_test123");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "option",
        triggerMode: "toggle",
      });
      expect(store.triggerMode).toBe("toggle");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 無儲存值時應使用平台預設值", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // 在 Node.js 環境中 navigator.userAgent 不含 "Mac"，預設為 rightAlt
      expect(store.hotkeyConfig?.triggerKey).toBeDefined();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P1] 載入後應同步 hotkey config 到 Rust", async () => {
      mockStoreData.set("hotkeyTriggerKey", "control");
      mockStoreData.set("hotkeyTriggerMode", "hold");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "control",
        triggerMode: "hold",
      });
    });

    it("[P1] store 載入失敗時應 fallback 到預設值", async () => {
      mockStoreGet.mockRejectedValueOnce(new Error("store corrupted"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      expect(store.hotkeyConfig).not.toBeNull();
      expect(store.hotkeyConfig?.triggerMode).toBe("hold");
    });

    it("[P2] 重複呼叫 loadSettings 應只執行一次", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();
      await store.loadSettings();

      // store.get 在第一次 loadSettings 中被呼叫多次（key, mode, apiKey, prompt）
      // 第二次不應再呼叫
      const callCountAfterFirst = mockStoreGet.mock.calls.length;
      await store.loadSettings();
      expect(mockStoreGet.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  // ==========================================================================
  // saveHotkeyConfig
  // ==========================================================================

  describe("saveHotkeyConfig", () => {
    it("[P0] 應持久化 triggerKey 和 triggerMode 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("command", "toggle");

      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerKey", "command");
      expect(mockStoreSet).toHaveBeenCalledWith("hotkeyTriggerMode", "toggle");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 應更新 hotkeyConfig ref", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("shift", "hold");

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "shift",
        triggerMode: "hold",
      });
      expect(store.triggerMode).toBe("hold");
    });

    it("[P0] 應透過 invoke 同步 config 到 Rust", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("fn", "toggle");

      expect(mockInvoke).toHaveBeenCalledWith("update_hotkey_config", {
        triggerKey: "fn",
        triggerMode: "toggle",
      });
    });

    it("[P0] 應發送 SETTINGS_UPDATED 事件廣播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("option", "hold");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "hotkey",
        value: { triggerKey: "option", triggerMode: "hold" },
      });
    });

    it("[P1] SETTINGS_UPDATED payload 應包含正確的 key 和 value", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveHotkeyConfig("control", "toggle");

      const emitCall = mockEmit.mock.calls[0];
      expect(emitCall[0]).toBe("settings:updated");
      expect(emitCall[1]).toEqual({
        key: "hotkey",
        value: { triggerKey: "control", triggerMode: "toggle" },
      });
    });
  });

  // ==========================================================================
  // saveApiKey
  // ==========================================================================

  describe("saveApiKey", () => {
    it("[P0] 應儲存 trimmed API key", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveApiKey("  gsk_abc123  ");

      expect(mockStoreSet).toHaveBeenCalledWith("groqApiKey", "gsk_abc123");
      expect(store.hasApiKey).toBe(true);
    });

    it("[P0] 空白 API key 應拋出錯誤", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveApiKey("   ")).rejects.toThrow(
        "API Key 不可為空白",
      );
    });
  });

  // ==========================================================================
  // deleteApiKey
  // ==========================================================================

  describe("deleteApiKey", () => {
    it("[P0] 應從 store 刪除 API key 並清空狀態", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveApiKey("gsk_test");
      expect(store.hasApiKey).toBe(true);

      await store.deleteApiKey();

      expect(mockStoreDelete).toHaveBeenCalledWith("groqApiKey");
      expect(mockStoreSave).toHaveBeenCalled();
      expect(store.hasApiKey).toBe(false);
    });
  });

  // ==========================================================================
  // saveAiPrompt / resetAiPrompt
  // ==========================================================================

  describe("saveAiPrompt", () => {
    it("[P0] 應儲存自訂 prompt", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveAiPrompt("自訂 prompt 內容");

      expect(mockStoreSet).toHaveBeenCalledWith("aiPrompt", "自訂 prompt 內容");
      expect(store.getAiPrompt()).toBe("自訂 prompt 內容");
    });

    it("[P0] 空白 prompt 應拋出錯誤", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveAiPrompt("  ")).rejects.toThrow(
        "Prompt 不可為空白",
      );
    });
  });

  describe("resetAiPrompt", () => {
    it("[P0] 應重置為預設 prompt", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveAiPrompt("自訂內容");
      await store.resetAiPrompt();

      // 應恢復為當前語言的預設 prompt（非空）
      expect(store.getAiPrompt()).not.toBe("自訂內容");
      expect(store.getAiPrompt().length).toBeGreaterThan(0);
      expect(mockStoreSet).toHaveBeenCalledWith(
        "aiPrompt",
        expect.stringContaining("繁體中文"),
      );
    });
  });

  // ==========================================================================
  // saveEnhancementThreshold
  // ==========================================================================

  describe("saveEnhancementThreshold", () => {
    it("[P0] 應持久化 enabled 和 charCount 到 store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 20);

      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdEnabled",
        false,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        20,
      );
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 應更新 reactive refs", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(false, 25);

      expect(store.isEnhancementThresholdEnabled).toBe(false);
      expect(store.enhancementThresholdCharCount).toBe(25);
    });

    it("[P0] 應發送 SETTINGS_UPDATED 事件廣播", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 15);

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "enhancementThreshold",
        value: { enabled: true, charCount: 15 },
      });
    });

    it("[P1] charCount < 1 應 fallback 到預設值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 0);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
      expect(mockStoreSet).toHaveBeenCalledWith(
        "enhancementThresholdCharCount",
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] 非整數 charCount 應 fallback 到預設值", async () => {
      const { useSettingsStore, DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT } =
        await import("../../src/stores/useSettingsStore");
      const store = useSettingsStore();

      await store.saveEnhancementThreshold(true, 3.5);

      expect(store.enhancementThresholdCharCount).toBe(
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
      );
    });

    it("[P1] store 儲存失敗時應拋出錯誤", async () => {
      mockStoreSave.mockRejectedValueOnce(new Error("disk full"));

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await expect(store.saveEnhancementThreshold(true, 10)).rejects.toThrow(
        "disk full",
      );
    });
  });

  // ==========================================================================
  // refreshCrossWindowSettings
  // ==========================================================================

  describe("refreshCrossWindowSettings", () => {
    it("[P0] 應整包重新讀取跨視窗會用到的設定", async () => {
      mockStoreData.set("hotkeyTriggerKey", "command");
      mockStoreData.set("hotkeyTriggerMode", "toggle");
      mockStoreData.set("customTriggerKey", { custom: { keycode: 321 } });
      mockStoreData.set("customTriggerKeyDomCode", "F13");
      mockStoreData.set("groqApiKey", "  gsk_sync  ");
      mockStoreData.set("aiPrompt", "  同步後 prompt  ");
      mockStoreData.set("enhancementThresholdEnabled", true);
      mockStoreData.set("enhancementThresholdCharCount", 42);
      mockStoreData.set("llmModelId", "llama-3.3-70b-versatile");
      mockStoreData.set("whisperModelId", "whisper-large-v3-turbo");
      mockStoreData.set("muteOnRecording", false);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.refreshCrossWindowSettings();

      expect(store.hotkeyConfig).toEqual({
        triggerKey: "command",
        triggerMode: "toggle",
      });
      expect(store.customTriggerKey).toEqual({ custom: { keycode: 321 } });
      expect(store.customTriggerKeyDomCode).toBe("F13");
      expect(store.getApiKey()).toBe("gsk_sync");
      expect(store.getAiPrompt()).toBe("同步後 prompt");
      expect(store.isEnhancementThresholdEnabled).toBe(true);
      expect(store.enhancementThresholdCharCount).toBe(42);
      expect(store.selectedLlmModelId).toBe("llama-3.3-70b-versatile");
      expect(store.selectedWhisperModelId).toBe("whisper-large-v3-turbo");
      expect(store.isMuteOnRecordingEnabled).toBe(false);
    });
  });

  // ==========================================================================
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') should persist to store", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale should emit SETTINGS_UPDATED event", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.saveLocale("ja");

      expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
        key: "locale",
        value: "ja",
      });
    });
  });

  // ==========================================================================
  // loadSettings locale
  // ==========================================================================

  describe("loadSettings locale", () => {
    it("[P0] should load saved locale from store", async () => {
      mockStoreData.set("selectedLocale", "en");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();

      await store.loadSettings();

      // When a saved locale exists, loadSettings should NOT re-set it
      // (the "first launch" path calls store.set("selectedLocale", detected))
      const selectedLocaleSetCallList = mockStoreSet.mock.calls.filter(
        ([key]: [string]) => key === "selectedLocale",
      );
      expect(selectedLocaleSetCallList).toHaveLength(0);
    });
  });
});
