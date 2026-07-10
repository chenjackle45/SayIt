import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// ── Mocks（vi.hoisted 確保工廠可安全引用）─────────────────────────────────────

const h = vi.hoisted(() => {
  const mockStoreData = new Map<string, unknown>();
  return {
    mockStoreData,
    mockStoreGet: vi.fn(async (key: string) => mockStoreData.get(key)),
    mockStoreSet: vi.fn(async (key: string, value: unknown) => {
      mockStoreData.set(key, value);
    }),
    mockStoreDelete: vi.fn(async (key: string) => {
      mockStoreData.delete(key);
    }),
    mockStoreSave: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockEmit: vi.fn().mockResolvedValue(undefined),
    mockEnable: vi.fn().mockResolvedValue(undefined),
    mockDisable: vi.fn().mockResolvedValue(undefined),
    mockIsEnabled: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: h.mockStoreGet,
    set: h.mockStoreSet,
    delete: h.mockStoreDelete,
    save: h.mockStoreSave,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: h.mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: h.mockEmit,
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: h.mockEnable,
  disable: h.mockDisable,
  isEnabled: h.mockIsEnabled,
}));

import { useSettingsStore } from "../../src/stores/useSettingsStore";
import type { SettingsPayload } from "../../src/lib/settingsTransfer";

describe("useSettingsStore — exportSettings / importSettings", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.mockStoreData.clear();
    h.mockStoreGet.mockClear();
    h.mockStoreSet.mockClear();
    h.mockStoreDelete.mockClear();
    h.mockStoreSave.mockClear();
    h.mockInvoke.mockClear().mockResolvedValue(undefined);
    h.mockEmit.mockClear().mockResolvedValue(undefined);
    h.mockEnable.mockClear().mockResolvedValue(undefined);
    h.mockDisable.mockClear().mockResolvedValue(undefined);
    h.mockIsEnabled.mockClear().mockResolvedValue(false);
  });

  describe("exportSettings", () => {
    it("[P0] 含 autoStartEnabled 合成欄位、排除內部旗標", async () => {
      h.mockStoreData.set("hotkeyTriggerKey", "option");
      h.mockStoreData.set("groqApiKey", "gsk_secret");
      h.mockStoreData.set("lastSeenVersion", "9.9.9"); // 內部旗標，不應匯出
      h.mockStoreData.set("llmMigratedFromKimiK2", true); // 內部旗標

      const store = useSettingsStore();
      const exported = await store.exportSettings(false);

      expect(exported.hotkeyTriggerKey).toBe("option");
      expect(exported.groqApiKey).toBe("gsk_secret");
      expect(exported).toHaveProperty("autoStartEnabled");
      expect(exported).not.toHaveProperty("lastSeenVersion");
      expect(exported).not.toHaveProperty("llmMigratedFromKimiK2");
    });

    it("[P0] excludeSecrets=true 剔除金鑰、保留非敏感設定", async () => {
      h.mockStoreData.set("groqApiKey", "gsk_secret");
      h.mockStoreData.set("openaiApiKey", "sk_secret");
      h.mockStoreData.set("muteOnRecording", true);

      const store = useSettingsStore();
      const exported = await store.exportSettings(true);

      expect(exported).not.toHaveProperty("groqApiKey");
      expect(exported).not.toHaveProperty("openaiApiKey");
      expect(exported.muteOnRecording).toBe(true);
    });
  });

  describe("importSettings 副作用（防 raw-set 退化）", () => {
    it("[P0] 寫回白名單 key 並忽略內部旗標與未知 key", async () => {
      const store = useSettingsStore();
      const payload: SettingsPayload = {
        hotkeyTriggerKey: "command",
        hotkeyTriggerMode: "toggle",
        muteOnRecording: false,
        lastSeenVersion: "9.9.9", // 內部旗標 → 忽略
        bogusKey: "x", // 未知 key → 忽略
      };
      await store.importSettings(payload);

      expect(h.mockStoreData.get("hotkeyTriggerKey")).toBe("command");
      expect(h.mockStoreData.get("muteOnRecording")).toBe(false);
      expect(h.mockStoreData.has("lastSeenVersion")).toBe(false);
      expect(h.mockStoreData.has("bogusKey")).toBe(false);
      expect(h.mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] 匯入後向 Rust 重新註冊熱鍵（update_hotkey_config）", async () => {
      const store = useSettingsStore();
      await store.importSettings({
        hotkeyTriggerKey: "command",
        hotkeyTriggerMode: "toggle",
      });

      expect(h.mockInvoke).toHaveBeenCalledWith(
        "update_hotkey_config",
        expect.objectContaining({ triggerKey: "command" }),
      );
    });

    it("[P0] 匯入後 emit SETTINGS_UPDATED", async () => {
      const store = useSettingsStore();
      await store.importSettings({ muteOnRecording: true });
      expect(h.mockEmit).toHaveBeenCalledWith(
        "settings:updated",
        expect.objectContaining({ key: "imported" }),
      );
    });

    it("[P0] autoStartEnabled=true 時呼叫 autostart enable", async () => {
      const store = useSettingsStore();
      await store.importSettings({ autoStartEnabled: true });
      expect(h.mockEnable).toHaveBeenCalled();
      expect(h.mockDisable).not.toHaveBeenCalled();
    });

    it("[P0] autoStartEnabled 非 store key，不寫入 settings.json", async () => {
      const store = useSettingsStore();
      await store.importSettings({ autoStartEnabled: true });
      expect(h.mockStoreData.has("autoStartEnabled")).toBe(false);
    });
  });
});
