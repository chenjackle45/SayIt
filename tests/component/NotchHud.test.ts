import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import NotchHud from "../../src/components/NotchHud.vue";

const { mockListen } = vi.hoisted(() => ({
  mockListen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: vi.fn().mockResolvedValue(undefined),
}));

const i18n = createI18n({
  legacy: false,
  locale: "zh-TW",
  messages: {
    "zh-TW": {
      voiceFlow: {
        vocabularyLearned: "已學習：{terms}",
        vocabularyLearnedTruncated: "已學習：{terms} 等 {count} 個詞",
        hud: {
          transcribing: "轉錄中",
          enhancingWithMode: "整理中・{mode}",
          editing: "編輯中",
          pasted: "已貼上・{count} 字",
          failedGoRetry: "辨識失敗・到記錄重試",
        },
      },
    },
  },
});

function mountNotchHud(props: Record<string, unknown>) {
  return mount(NotchHud, {
    props: { isEditMode: false, pastedCharacterCount: 0, promptModeLabel: "", isRetryInRecordsHintVisible: false, ...props },
    global: {
      plugins: [i18n],
    },
  });
}

describe("NotchHud", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockListen.mockReset();
    mockListen.mockResolvedValue(vi.fn());
  });

  it("[P0] recording 狀態應顯示波形元素和計時器", () => {
    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 3,
      message: "",
    });

    expect(wrapper.find(".waveform-container").exists()).toBe(true);
    expect(wrapper.findAll(".waveform-element").length).toBe(6);
    expect(wrapper.find(".elapsed-timer").text()).toBe("0:03");
  });

  it("[P0] transcribing 狀態應顯示脈衝 dots", async () => {
    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "transcribing" });
    expect(wrapper.find(".waveform-container").exists()).toBe(true);
  });

  it("[P0] success 狀態應顯示 SVG checkmark 和 converge dots", async () => {
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".checkmark-svg").exists()).toBe(true);
    expect(wrapper.findAll(".waveform-converge").length).toBe(6);
  });

  it("[P0] 剛存了失敗記錄的轉錄錯誤應顯示 scatter dots、retry icon 與「辨識失敗・到記錄重試」", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "未偵測到語音",
      canRetry: true,
      isRetryInRecordsHintVisible: true,
    });

    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    expect(wrapper.find(".retry-icon").exists()).toBe(true);
    expect(wrapper.find(".error-message").text()).toBe("辨識失敗・到記錄重試");
  });

  it("[P0] error 狀態 canRetry=false 不應顯示 retry icon", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
      canRetry: false,
    });

    expect(wrapper.findAll(".waveform-scatter").length).toBe(6);
    expect(wrapper.find(".retry-icon").exists()).toBe(false);
  });

  it("[P0] error 狀態有 message 應在瀏海下方顯示錯誤訊息", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "API Key 未設定",
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
    const wrapper = mountNotchHud({
      status: "idle",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] error 狀態的 retry icon 應 emit retry 事件", async () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
      canRetry: true,
    });

    await wrapper.find(".retry-icon").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("[P1] success 狀態不應帶有 notch-green-flash class（底色 flash 已移除）", () => {
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-hud").classes()).not.toContain(
      "notch-green-flash",
    );
  });

  it("[P1] error 狀態應帶有 notch-shake class", () => {
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-hud").classes()).toContain("notch-shake");
  });

  it("[P1] error → idle 應先進入 collapsing 再隱藏", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();

    // collapsing 狀態中仍可見
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    // 動畫結束後隱藏
    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] success → idle 應先進入 collapsing 再隱藏", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "success",
      recordingElapsedSeconds: 0,
      message: "",
    });

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(false);
  });

  it("[P1] collapsing 期間切換到 recording 應取消收縮", async () => {
    vi.useFakeTimers();
    const wrapper = mountNotchHud({
      status: "error",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "idle" });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-hud").classes()).toContain("notch-collapsing");

    // 收縮期間切換到 recording
    await wrapper.setProps({ status: "recording" });
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
    expect(wrapper.find(".notch-hud").classes()).not.toContain(
      "notch-collapsing",
    );

    // 推進時間後不應隱藏
    vi.advanceTimersByTime(400);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".notch-wrapper").exists()).toBe(true);
  });

  it("[P1] 波形 listener 晚到時應立即解除，避免殘留監聽", async () => {
    let resolveListen!: (unlisten: () => void) => void;
    const deferredListen = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    const mockUnlisten = vi.fn();
    mockListen.mockImplementationOnce(async () => deferredListen);

    const wrapper = mountNotchHud({
      status: "recording",
      recordingElapsedSeconds: 0,
      message: "",
    });

    await wrapper.setProps({ status: "idle" });
    resolveListen(mockUnlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockUnlisten).toHaveBeenCalledTimes(1);
  });

  describe("C3 狀態文字", () => {
    it("transcribing／enhancing／editing 分別說轉錄中、整理中・模式、編輯中", async () => {
      const wrapper = mountNotchHud({ status: "transcribing", recordingElapsedSeconds: 0, message: "", promptModeLabel: "積極" });
      expect(wrapper.get("[data-testid='hud-processing-label']").text()).toBe("轉錄中");
      await wrapper.setProps({ status: "enhancing" });
      expect(wrapper.get("[data-testid='hud-processing-label']").text()).toBe("整理中・積極");
      await wrapper.setProps({ status: "editing" });
      expect(wrapper.get("[data-testid='hud-processing-label']").text()).toBe("編輯中");
    });

    it("success 顯示言標與實際貼上的字數", () => {
      const wrapper = mountNotchHud({ status: "success", recordingElapsedSeconds: 0, message: "已貼上 ✓", pastedCharacterCount: 11 });
      const label = wrapper.get("[data-testid='hud-success-label']");
      expect(label.find(".hud-mark").text()).toBe("言");
      expect(label.text()).toContain("已貼上・11 字");
    });

    it("沒有導流提示的錯誤照原本的具體文案（即使 canRetry 仍為 true）", () => {
      const wrapper = mountNotchHud({ status: "error", recordingElapsedSeconds: 0, message: "需要輔助使用權限", canRetry: true });
      expect(wrapper.find(".error-message").text()).toBe("需要輔助使用權限");
    });
  });
});
