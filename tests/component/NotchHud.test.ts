import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import NotchHud from "../../src/components/NotchHud.vue";

describe("NotchHud", () => {
  it("[P0] recording 狀態應顯示波形元素和計時器", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "recording",
        analyserHandle: null,
        recordingElapsedSeconds: 3,
        message: "",
      },
    });

    expect(wrapper.find(".waveform-container").exists()).toBe(true);
    expect(wrapper.findAll(".waveform-element").length).toBe(6);
    expect(wrapper.find(".elapsed-timer").text()).toBe("0:03");
  });

  it("[P0] transcribing 狀態應顯示脈衝 dots", async () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "recording",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    await wrapper.setProps({ status: "transcribing" });
    expect(wrapper.find(".waveform-container").exists()).toBe(true);
  });

  it("[P0] success 狀態應顯示 SVG checkmark 和 converge dots", async () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "success",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    expect(wrapper.find(".checkmark-svg").exists()).toBe(true);
    expect(wrapper.find(".checkmark-svg path").attributes("stroke")).toBe(
      "#22c55e",
    );
    expect(wrapper.findAll(".waveform-converge").length).toBe(6);
  });

  it("[P0] error 狀態無 message 應顯示 scatter dots 和 retry icon", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "error",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    expect(wrapper.find(".retry-icon").exists()).toBe(true);
    expect(wrapper.find(".error-message").exists()).toBe(false);
  });

  it("[P0] error 狀態有 message 應在瀏海下方顯示錯誤訊息", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "error",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "API Key 未設定",
      },
    });

    // scatter dots 仍在上排顯示
    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    // 訊息在獨立的下排
    expect(wrapper.find(".error-message-row").exists()).toBe(true);
    expect(wrapper.find(".error-message").text()).toBe("API Key 未設定");
    // notch 應展開
    expect(wrapper.find(".notch-hud").classes()).toContain(
      "notch-hud-expanded",
    );
  });

  it("[P0] idle 狀態應隱藏整個 HUD", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "idle",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] error 狀態的 retry icon 應 emit retry 事件", async () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "error",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    await wrapper.find(".retry-icon").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("[P1] success 狀態應帶有 notch-green-flash class", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "success",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    expect(wrapper.find(".notch-hud").classes()).toContain("notch-green-flash");
  });

  it("[P1] error 狀態應帶有 notch-shake class", () => {
    const wrapper = mount(NotchHud, {
      props: {
        status: "error",
        analyserHandle: null,
        recordingElapsedSeconds: 0,
        message: "",
      },
    });

    expect(wrapper.find(".notch-hud").classes()).toContain("notch-shake");
  });
});
