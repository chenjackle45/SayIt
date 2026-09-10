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
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({ emit: mockEmit }));

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
}));

describe("useSettingsStore debug log", () => {
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

  it("[P0] saveDebugLog 應持久化 enabled 並儲存、更新 reactive ref", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true);

    expect(mockStoreSet).toHaveBeenCalledWith("debugLogEnabled", true);
    expect(mockStoreSave).toHaveBeenCalled();
    expect(store.isDebugLogEnabled).toBe(true);
  });

  it("[P0] saveDebugLog 應透過 invoke 通知 Rust 切換開關（開與關都會）", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveDebugLog(true);
    await store.saveDebugLog(false);

    expect(mockInvoke).toHaveBeenCalledWith("set_file_logging_enabled", {
      enabled: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith("set_file_logging_enabled", {
      enabled: false,
    });
    expect(store.isDebugLogEnabled).toBe(false);
  });

  it("[P1] openDebugLogFolder 應經 store 呼叫 open_log_folder（view 不直接碰 lib）", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.openDebugLogFolder();

    expect(mockInvoke).toHaveBeenCalledWith("open_log_folder");
  });

  it("[P0] loadSettings 無儲存值時 debug log 應預設關閉", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.isDebugLogEnabled).toBe(false);
  });

  it("[P0] loadSettings 應載入已儲存的 debug log 設定", async () => {
    mockStoreData.set("debugLogEnabled", true);

    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.isDebugLogEnabled).toBe(true);
  });
});
