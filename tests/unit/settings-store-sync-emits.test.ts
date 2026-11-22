import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// v0.16 #4：這些設定原本存了不通知其他視窗（HUD 會用舊值整理／清理），
// 補 emit settings:updated，且不經事件傳 API 金鑰

const mockStoreData = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => mockStoreData.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      mockStoreData.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      mockStoreData.delete(key);
    }),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({ emit: mockEmit }));

async function createStore() {
  const { useSettingsStore } = await import("../../src/stores/useSettingsStore");
  return useSettingsStore();
}

beforeEach(() => {
  setActivePinia(createPinia());
  mockStoreData.clear();
  mockInvoke.mockClear().mockResolvedValue(undefined);
  mockEmit.mockClear().mockResolvedValue(undefined);
  vi.resetModules();
});

describe("設定寫入後通知其他視窗", () => {
  const cases: Array<[string, (s: Awaited<ReturnType<typeof createStore>>) => Promise<unknown>, string]> = [
    ["saveOpenaiApiKey", (s) => s.saveOpenaiApiKey("sk-openai-secret"), "providerApiKey"],
    ["deleteOpenaiApiKey", (s) => s.deleteOpenaiApiKey(), "providerApiKey"],
    ["saveAnthropicApiKey", (s) => s.saveAnthropicApiKey("sk-ant-secret"), "providerApiKey"],
    ["deleteAnthropicApiKey", (s) => s.deleteAnthropicApiKey(), "providerApiKey"],
    ["saveGeminiApiKey", (s) => s.saveGeminiApiKey("gemini-secret"), "providerApiKey"],
    ["deleteGeminiApiKey", (s) => s.deleteGeminiApiKey(), "providerApiKey"],
    ["saveRecordingAutoCleanup", (s) => s.saveRecordingAutoCleanup(true, 14), "recordingAutoCleanup"],
    ["saveDebugLog", (s) => s.saveDebugLog(true), "debugLog"],
  ];

  it.each(cases)("%s 會 emit settings:updated", async (_name, act, key) => {
    const store = await createStore();
    await act(store);
    expect(mockEmit).toHaveBeenCalledWith("settings:updated", { key, value: null });
  });

  it("金鑰不會出現在事件內容裡", async () => {
    const store = await createStore();
    await store.saveOpenaiApiKey("sk-openai-secret");
    expect(JSON.stringify(mockEmit.mock.calls)).not.toContain("sk-openai-secret");
  });
});
