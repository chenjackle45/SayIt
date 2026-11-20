import { mount } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { reactive } from "vue";
import i18n from "../../src/i18n";

const settingsState = reactive({
  hasApiKey: true,
  hotkeyConfig: { triggerKey: "fn", triggerMode: "hold" } as {
    triggerKey: string;
    triggerMode: string;
  } | null,
  triggerMode: "hold",
  promptMode: "minimal",
  llmProviderDisplayName: "OpenAI",
  getTriggerKeyDisplayName: (key: string) => (key === "fn" ? "Fn" : key),
});

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

import SidebarStatus from "../../src/components/SidebarStatus.vue";

function mountStatus() {
  return mount(SidebarStatus, { global: { plugins: [i18n] } });
}

describe("SidebarStatus 側欄狀態", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh-TW";
    Object.assign(settingsState, {
      hasApiKey: true,
      hotkeyConfig: { triggerKey: "fn", triggerMode: "hold" },
      triggerMode: "hold",
      promptMode: "minimal",
      llmProviderDisplayName: "OpenAI",
    });
  });

  it("有金鑰時顯示就緒，並讀實際觸發鍵（不寫死 Right ⌘）", () => {
    const text = mountStatus().text();
    expect(text).toContain("就緒");
    expect(text).toContain("按住說話");
    expect(text).toContain("Fn");
    expect(text).not.toContain("Right");
  });

  it("沒有 Groq 金鑰時提示尚未設定", () => {
    settingsState.hasApiKey = false;
    expect(mountStatus().text()).toContain("尚未設定 API 金鑰");
  });

  it("切換模式顯示「按一下開始說話」", () => {
    settingsState.triggerMode = "toggle";
    expect(mountStatus().text()).toContain("按一下開始說話");
  });

  it("顯示目前整理服務與整理模式，模式改了跟著變", async () => {
    const wrapper = mountStatus();
    expect(wrapper.text()).toContain("OpenAI · 精簡");
    settingsState.promptMode = "active";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("OpenAI · 積極");
  });
});
