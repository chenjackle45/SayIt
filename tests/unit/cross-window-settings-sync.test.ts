import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners: Record<string, () => void> = {};
const unlistenSpy = vi.fn();
vi.mock("../../src/composables/useTauriEvents", () => ({
  SETTINGS_UPDATED: "settings:updated",
  listenToEvent: vi.fn(async (name: string, cb: () => void) => {
    listeners[name] = cb;
    return unlistenSpy;
  }),
}));

const refreshSpy = vi.fn().mockResolvedValue(undefined);
const loadSpy = vi.fn();
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    refreshCrossWindowSettings: refreshSpy,
    loadSettings: loadSpy,
  }),
}));

import { useCrossWindowSettingsSync } from "../../src/composables/useCrossWindowSettingsSync";

const Host = defineComponent({
  setup() {
    useCrossWindowSettingsSync();
    return () => h("div");
  },
});

describe("useCrossWindowSettingsSync 跨視窗設定同步", () => {
  beforeEach(() => {
    refreshSpy.mockClear();
    loadSpy.mockClear();
    unlistenSpy.mockClear();
    delete listeners["settings:updated"];
  });

  it("收到 settings:updated 只做純讀 refresh，不重跑 loadSettings", async () => {
    mount(Host);
    await vi.waitFor(() => expect(listeners["settings:updated"]).toBeDefined());
    listeners["settings:updated"]();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("卸載時解除監聽", async () => {
    const wrapper = mount(Host);
    await vi.waitFor(() => expect(listeners["settings:updated"]).toBeDefined());
    wrapper.unmount();
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });
});
