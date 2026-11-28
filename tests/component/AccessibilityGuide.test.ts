import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

enableAutoUnmount(afterEach);

describe("AccessibilityGuide", () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockImplementation((command: string) =>
      Promise.resolve(command === "check_accessibility_permission_command" ? false : undefined),
    );
  });

  afterEach(() => vi.restoreAllMocks());

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

  it("授權後重啟期間顯示提示並停用按鈕，成功才關閉", async () => {
    let finishReinitialize!: () => void;
    mockInvoke.mockResolvedValueOnce(true).mockReturnValueOnce(new Promise<void>((resolve) => {
      finishReinitialize = resolve;
    }));
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain(zhTW.accessibility.reinitializing);
    expect(wrapper.findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(wrapper.emitted("close")).toBeUndefined();

    finishReinitialize();
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("重啟失敗仍顯示既有錯誤提示且不關閉", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("重啟失敗"));
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain(zhTW.accessibility.reinitializeError);
    expect(wrapper.findAll("button").every((button) => button.attributes("disabled") === undefined)).toBe(true);
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("隱藏後的重啟結果不得再發 close", async () => {
    let finishReinitialize!: () => void;
    mockInvoke.mockResolvedValueOnce(true).mockReturnValueOnce(new Promise<void>((resolve) => {
      finishReinitialize = resolve;
    }));
    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await wrapper.setProps({ visible: false });
    finishReinitialize();
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
  });
});
