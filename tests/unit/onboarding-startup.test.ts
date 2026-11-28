import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "../../src/stores/useSettingsStore";
import { captureError } from "../../src/lib/sentry";

const h = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  select: vi.fn(),
  save: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => h.data.get(key),
  set: async (key: string, value: unknown) => { h.set(key, value); h.data.set(key, value); },
  save: h.save,
}) }));
vi.mock("../../src/lib/database", () => ({ getDatabase: () => ({ select: h.select }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("__APP_VERSION__", "0.17.0");
  vi.mocked(captureError).mockClear();
  h.data.clear(); h.set.mockReset(); h.save.mockReset().mockResolvedValue(undefined);
  h.select.mockReset().mockResolvedValue([{ count: 0 }]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("新安裝唯讀判斷不寫任何旗標或版本，prepare存版本後才顯示", async () => {
  const settings = useSettingsStore();
  expect(await settings.shouldShowOnboarding()).toBe(true);
  expect(h.set).not.toHaveBeenCalled();
  let saveDone!: () => void;
  h.save.mockReturnValueOnce(new Promise<void>((resolve) => { saveDone = resolve; }));
  const preparing = settings.prepareOnboarding();
  await vi.waitFor(() => expect(h.save).toHaveBeenCalled());
  expect(settings.onboardingState).toBe("pending");
  saveDone(); await preparing;
  expect(settings.onboardingState).toBe("showing");
  expect(h.data.get("lastSeenVersion")).toBe("0.17.0");
  expect(settings.showPromptUpgradeNotice).toBe(false);
});

it.each([
  ["lastSeenVersion", "0.16.0"], ["groqApiKey", "gsk_old"], ["onboardingCompleted", true],
])("既有 %s：不顯示且標記完成", async (key, value) => {
  h.data.set(key as string, value);
  const settings = useSettingsStore();
  expect(await settings.shouldShowOnboarding()).toBe(false);
  expect(h.set).not.toHaveBeenCalled();
  await settings.prepareOnboarding();
  expect(settings.onboardingState).toBe("done");
  expect(h.data.get("onboardingCompleted")).toBe(true);
});
it("歷史記錄：不顯示且寫完成旗標", async () => {
  h.select.mockResolvedValue([{ count: 1 }]);
  const settings = useSettingsStore(); await settings.prepareOnboarding();
  expect(settings.onboardingState).toBe("done");
  expect(h.data.get("onboardingCompleted")).toBe(true);
});
it("DB失敗：不顯示引導", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  h.select.mockRejectedValue(new Error("DB unavailable"));
  const settings = useSettingsStore(); await settings.prepareOnboarding();
  expect(settings.onboardingState).toBe("done");
  // 判不出來時不寫完成旗標：新安裝碰到一次性 DB 失敗，下次啟動仍要能顯示引導
  expect(h.data.get("onboardingCompleted")).toBeUndefined();
  expect(log).toHaveBeenCalledWith("[useSettingsStore] Onboarding eligibility failed:", "DB unavailable");
});
it("準備儲存失敗也會離開pending，且不顯示未完成準備的引導", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  h.save.mockRejectedValue(new Error("disk full"));
  const settings = useSettingsStore(); await settings.prepareOnboarding();
  expect(settings.onboardingState).toBe("done");
  expect(log).toHaveBeenCalledWith("[useSettingsStore] Prepare onboarding failed:", "disk full");
  expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: "settings", step: "prepare-onboarding" });
});

describe.each([true, false])("兩輪獨立 Pinia：存金鑰=%s", (saveKey) => {
  it("本版二次啟動無摘要，下一版正常有摘要", async () => {
    const first = useSettingsStore();
    await first.prepareOnboarding(); expect(first.onboardingState).toBe("showing");
    if (saveKey) await first.saveApiKey("gsk_new");
    await first.completeOnboarding();
    setActivePinia(createPinia());
    const second = useSettingsStore(); await second.prepareOnboarding();
    expect(second.onboardingState).toBe("done");
    expect(second.showPromptUpgradeNotice).toBe(false);
    expect(h.data.get("lastSeenVersion")).toBe("0.17.0");
    vi.stubGlobal("__APP_VERSION__", "0.18.0");
    setActivePinia(createPinia());
    const nextVersion = useSettingsStore(); await nextVersion.prepareOnboarding();
    expect(nextVersion.showPromptUpgradeNotice).toBe(true);
    expect(h.data.get("lastSeenVersion")).toBe("0.18.0");
  });
});
it("升級使用者保留既有摘要路徑", async () => {
  h.data.set("lastSeenVersion", "0.16.0");
  const settings = useSettingsStore(); await settings.prepareOnboarding();
  expect(settings.showPromptUpgradeNotice).toBe(true);
});
it("重新顯示只改UI狀態、不寫或清除完成旗標", async () => {
  h.data.set("onboardingCompleted", true);
  const settings = useSettingsStore(); settings.reopenOnboarding();
  expect(settings.onboardingState).toBe("showing");
  expect(h.set).not.toHaveBeenCalled();
  expect(h.data.get("onboardingCompleted")).toBe(true);
});

it("完成旗標save連續失敗後每次重試都必須再save，成功才done", async () => {
  const settings = useSettingsStore(); settings.reopenOnboarding();
  h.save.mockRejectedValueOnce(new Error("磁碟已滿")).mockRejectedValueOnce(new Error("仍然無法寫入"));
  await expect(settings.completeOnboarding()).rejects.toThrow("磁碟已滿");
  expect(h.data.get("onboardingCompleted")).toBe(true); expect(settings.onboardingState).toBe("showing");
  await expect(settings.completeOnboarding()).rejects.toThrow("仍然無法寫入");
  expect(h.save).toHaveBeenCalledTimes(2); expect(settings.onboardingState).toBe("showing");
  await settings.completeOnboarding();
  expect(h.save).toHaveBeenCalledTimes(3); expect(settings.onboardingState).toBe("done");
});

it("首次 DB 暫時失敗後，下次啟動仍顯示引導", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.select.mockRejectedValueOnce(new Error("DB temporarily unavailable"));
  const first = useSettingsStore();
  await first.prepareOnboarding();
  expect(first.onboardingState).toBe("done");
  expect(h.data.get("onboardingCompleted")).toBeUndefined();
  expect(h.data.get("lastSeenVersion")).toBeUndefined();
  expect(first.showPromptUpgradeNotice).toBe(false);
  setActivePinia(createPinia());
  const second = useSettingsStore();
  await second.prepareOnboarding();
  expect(second.onboardingState).toBe("showing");
});
it.each([
  ["lastSeenVersion", "0.16.0"],
  ["groqApiKey", "gsk_existing"],
])("既有 %s 時不需讀 DB：DB 失敗仍顯示摘要並離開 pending", async (key, value) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.data.set(key, value);
  h.select.mockRejectedValueOnce(new Error("DB temporarily unavailable"));
  const settings = useSettingsStore();
  await settings.prepareOnboarding();
  expect(settings.onboardingState).toBe("done");
  expect(settings.showPromptUpgradeNotice).toBe(true);
  expect(h.data.get("lastSeenVersion")).toBe("0.17.0");
});
