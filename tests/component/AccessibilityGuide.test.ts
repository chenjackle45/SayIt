import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import zhTW from "../../src/i18n/locales/zh-TW.json";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import AccessibilityGuide from "../../src/components/AccessibilityGuide.vue";

const i18n = createI18n({
  legacy: false,
  locale: "zh-TW",
  messages: { "zh-TW": zhTW },
});

describe("AccessibilityGuide", () => {
  it("[P0] visible=false 時不應渲染任何內容", () => {
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: false },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("[P0] visible=true 時應渲染 dialog 並包含 aria 屬性", () => {
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("aria-modal")).toBe("true");
    expect(dialog.attributes("aria-labelledby")).toBe(
      "accessibility-guide-title",
    );
  });

  it("[P0] 點擊「開啟系統設定」應呼叫 invoke", async () => {
    mockInvoke.mockClear();
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });

    const primaryButton = wrapper.findAll("button")[0];
    expect(primaryButton.text()).toBe("開啟系統設定");
    await primaryButton.trigger("click");

    expect(mockInvoke).toHaveBeenCalledWith("open_accessibility_settings");
  });

  it("[P0] 點擊「稍後設定」應 emit close 事件", async () => {
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });

    const secondaryButton = wrapper.findAll("button")[1];
    expect(secondaryButton.text()).toBe("稍後設定");
    await secondaryButton.trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("[P1] Escape 鍵應 emit close 事件", async () => {
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });

    await wrapper.find('[role="dialog"]').trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
