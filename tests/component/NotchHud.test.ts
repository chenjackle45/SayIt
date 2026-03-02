import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import NotchHud from "../../src/components/NotchHud.vue";

describe("NotchHud", () => {
  it("[P0] recording 狀態應顯示傳入的 message", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "recording",
        message: "錄音中...",
      },
    });

    expect(wrapper.text()).toContain("錄音中...");
    expect(wrapper.text()).not.toContain("Recording...");
  });

  it("[P0] transcribing 狀態應顯示傳入的 message", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "transcribing",
        message: "轉錄中...",
      },
    });

    expect(wrapper.text()).toContain("轉錄中...");
    expect(wrapper.text()).not.toContain("Transcribing...");
  });

  it("[P0] success 狀態應顯示傳入的 message", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "success",
        message: "已貼上 ✓",
      },
    });

    expect(wrapper.text()).toContain("已貼上 ✓");
    expect(wrapper.text()).not.toContain("Pasted!");
  });
});
