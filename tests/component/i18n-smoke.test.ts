import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import zhTW from "../../src/i18n/locales/zh-TW.json";
import en from "../../src/i18n/locales/en.json";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import AccessibilityGuide from "../../src/components/AccessibilityGuide.vue";

describe("i18n smoke test", () => {
  it("[P0] 切換 locale 後 UI 文字應更新為對應語言", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "zh-TW",
      messages: { "zh-TW": zhTW, en },
    });

    const wrapper = mount(AccessibilityGuide, {
      props: { visible: true },
      global: { plugins: [i18n] },
    });

    // 驗證 zh-TW 文字已正確渲染
    expect(wrapper.text()).toContain("需要輔助使用權限");
    const buttonListZh = wrapper.findAll("button");
    expect(buttonListZh[0].text()).toBe("開啟系統設定");
    expect(buttonListZh[1].text()).toBe("稍後設定");

    // 切換到 English
    i18n.global.locale.value = "en";
    await wrapper.vm.$nextTick();

    // 驗證 English 文字已正確渲染
    expect(wrapper.text()).toContain("Accessibility Permission Required");
    const buttonListEn = wrapper.findAll("button");
    expect(buttonListEn[0].text()).toBe("Open System Settings");
    expect(buttonListEn[1].text()).toBe("Later");
  });
});
