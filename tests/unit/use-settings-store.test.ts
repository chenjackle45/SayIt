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

      // 應恢復為 DEFAULT_SYSTEM_PROMPT（非空）
      expect(store.getAiPrompt()).not.toBe("自訂內容");
      expect(store.getAiPrompt().length).toBeGreaterThan(0);
      expect(mockStoreSet).toHaveBeenCalledWith(
        "aiPrompt",
        expect.stringContaining("繁體中文"),
      );
    });
  });
});
