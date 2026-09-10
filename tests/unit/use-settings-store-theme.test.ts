import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

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

describe("useSettingsStore theme", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreSave.mockClear();
    mockEmit.mockClear().mockResolvedValue(undefined);
    document.documentElement.classList.remove("dark");
    vi.resetModules();
  });

  it("[P0] loadSettings 無儲存值時 themeMode 預設 system", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    expect(store.themeMode).toBe("system");
  });

  it("[P0] loadSettings 應載入已儲存的 themeMode", async () => {
    mockStoreData.set("themeMode", "light");
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    expect(store.themeMode).toBe("light");
  });

  it("[P0] saveTheme 應持久化、更新 reactive、發送 SETTINGS_UPDATED", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.saveTheme("dark");

    expect(mockStoreSet).toHaveBeenCalledWith("themeMode", "dark");
    expect(mockStoreSave).toHaveBeenCalled();
    expect(store.themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("settings:updated", {
      key: "theme",
      value: "dark",
    });
  });
});
