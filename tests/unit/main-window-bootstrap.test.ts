import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h as render } from "vue";

// 主視窗啟動：選單列最近 5 句的同步要在設定載入（語系已定）之後啟動；DB 初始化失敗就不啟動（v0.16 #6）

const h = vi.hoisted(() => ({
  order: [] as string[],
  initializeDatabase: vi.fn(),
  startTrayRecentSync: vi.fn(),
  prepareOnboarding: vi.fn(),
  push: vi.fn(), show: vi.fn(), focus: vi.fn(),
  settings: { hasApiKey: true, onboardingState: "pending" },
}));

vi.mock("../../src/MainApp.vue", () => ({ default: defineComponent({ render: () => render("div") }) }));
vi.mock("../../src/router", () => ({
  default: { install: vi.fn(), isReady: vi.fn().mockResolvedValue(undefined), push: h.push },
}));
vi.mock("../../src/lib/database", () => ({
  initializeDatabase: h.initializeDatabase,
  setDatabaseInitError: vi.fn(),
}));
vi.mock("../../src/composables/useTauriEvents", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  listenToEvent: vi.fn().mockResolvedValue(() => {}),
  DATABASE_READY: "database:ready",
  DATABASE_READY_PING: "database:ready-ping",
}));
vi.mock("../../src/lib/sentry", () => ({ initSentryForDashboard: vi.fn(), captureError: vi.fn() }));
vi.mock("../../src/lib/theme", () => ({ initThemeFromStore: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/lib/logger", () => ({ installConsoleForwarding: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show: h.show, setFocus: h.focus }),
}));
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: vi.fn(async () => {
      h.order.push("loadSettings");
    }),
    prepareOnboarding: h.prepareOnboarding,
    get onboardingState() { return h.settings.onboardingState; },
    initializeAutoStart: vi.fn().mockResolvedValue(undefined),
    get hasApiKey() { return h.settings.hasApiKey; },
    isRecordingAutoCleanupEnabled: false,
  }),
}));
vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => ({ startTrayRecentSync: h.startTrayRecentSync }),
}));

describe("主視窗啟動：選單列最近 5 句", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    h.order.length = 0;
    h.settings.hasApiKey = true; h.settings.onboardingState = "pending";
    h.push.mockReset().mockResolvedValue(undefined); h.show.mockClear(); h.focus.mockClear();
    h.prepareOnboarding.mockReset().mockImplementation(async () => { h.settings.onboardingState = "done"; });
    h.initializeDatabase.mockReset().mockResolvedValue(undefined);
    h.startTrayRecentSync.mockReset().mockImplementation(async () => {
      h.order.push("startTrayRecentSync");
    });
  });

  it("設定載入後啟動同步", async () => {
    await import("../../src/main-window");
    await vi.waitFor(() => expect(h.startTrayRecentSync).toHaveBeenCalledTimes(1));
    expect(h.order).toEqual(["loadSettings", "startTrayRecentSync"]);
  });

  it.each([false, true])("引導中金鑰=%s：顯示與聚焦，不導向設定", async (hasKey) => {
    h.settings.hasApiKey = hasKey;
    h.prepareOnboarding.mockImplementation(async () => { h.settings.onboardingState = "showing"; });
    await import("../../src/main-window");
    await vi.waitFor(() => expect(h.focus).toHaveBeenCalled());
    expect(h.push).not.toHaveBeenCalled(); expect(h.show).toHaveBeenCalledOnce();
  });
  it("不顯示引導且沒金鑰仍導向AI設定", async () => {
    h.settings.hasApiKey = false;
    await import("../../src/main-window");
    await vi.waitFor(() => expect(h.focus).toHaveBeenCalled());
    expect(h.push).toHaveBeenCalledWith("/settings/ai");
  });
  it("DB 初始化失敗 → 不啟動同步", async () => {
    h.initializeDatabase.mockRejectedValue(new Error("db broken"));
    await import("../../src/main-window");
    await vi.waitFor(() => expect(h.order).toContain("loadSettings"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.startTrayRecentSync).not.toHaveBeenCalled();
  });
});
