import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import i18n from "../../src/i18n";
import SettingsView from "../../src/views/SettingsView.vue";

// 主視窗設定模式分頁生命週期（C1）：麥克風預覽只在「麥克風」分頁、錄鍵離開「快捷鍵」分頁就停；Esc 離開設定

const startPreview = vi.fn().mockResolvedValue(undefined);
const stopPreview = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/composables/useAudioPreview", () => ({
  useAudioPreview: () => ({
    previewLevel: ref(0),
    isPreviewActive: ref(false),
    startPreview,
    stopPreview,
  }),
}));

const stopKeyRecording = vi.fn();
const isKeyRecording = ref(false);
vi.mock("../../src/composables/useHotkeyRecordingSession", () => ({
  useHotkeyRecordingSession: () => ({ isRecording: isKeyRecording, start: vi.fn(), stop: stopKeyRecording }),
}));

let resolveDeviceList: (list: unknown[]) => void = () => {};
const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === "list_audio_input_devices") {
    return new Promise((resolve) => {
      resolveDeviceList = resolve;
    });
  }
  return null;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invokeMock(cmd) }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/stores/useHistoryStore", () => ({ useHistoryStore: () => ({}) }));

// 只提供四個分頁會讀到的欄位；其餘欄位回傳 undefined，函式回傳 vi.fn
const settingsState = reactive<Record<string, unknown>>({
  selectedAudioInputDeviceName: "",
  hotkeyConfig: { triggerKey: "fn", triggerMode: "hold" },
  customTriggerKey: null,
  promptMode: "minimal",
  isMuteOnRecordingEnabled: true,
  isSoundEffectsEnabled: true,
  isHideDockIconEnabled: false,
  isStartHiddenEnabled: false,
  isAutoStartEnabled: false,
  isCopyTranscriptionToClipboardEnabled: false,
  themeMode: "system",
  selectedLocale: "zh-TW",
  hasApiKey: true,
  getAiPrompt: () => "",
  getApiKey: () => "",
  loadAutoStartStatus: vi.fn().mockResolvedValue(undefined),
});
vi.mock("../../src/stores/useSettingsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/stores/useSettingsStore")>()),
  useSettingsStore: () =>
    new Proxy(settingsState, {
      get(target, key: string) {
        if (key in target) return target[key];
        return undefined;
      },
    }),
}));

function mountTab(tab: string) {
  return mount(SettingsView, {
    props: { tab },
    global: {
      plugins: [i18n],
      stubs: { AlertDialog: true, ConnectionTestButton: true, Select: true },
    },
  });
}

beforeEach(() => {
  i18n.global.locale.value = "zh-TW";
  startPreview.mockClear();
  stopPreview.mockClear();
  stopKeyRecording.mockClear();
  invokeMock.mockClear();
  isKeyRecording.value = false;
});

describe("SettingsView 分頁生命週期", () => {
  it("在麥克風分頁：裝置清單載完才開預覽；離開分頁就停預覽", async () => {
    const wrapper = mountTab("mic");
    await flushPromises();
    expect(startPreview).not.toHaveBeenCalled();

    resolveDeviceList([]);
    await flushPromises();
    expect(startPreview).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ tab: "general" });
    expect(stopPreview).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("裝置清單還沒載完就切走 → 不會開預覽", async () => {
    const wrapper = mountTab("mic");
    await flushPromises();
    await wrapper.setProps({ tab: "about" });
    resolveDeviceList([]);
    await flushPromises();
    expect(startPreview).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("預覽清單載入中就離開設定（卸載）→ 不會開預覽", async () => {
    const wrapper = mountTab("mic");
    await flushPromises();
    wrapper.unmount();
    resolveDeviceList([]);
    await flushPromises();
    expect(startPreview).not.toHaveBeenCalled();
  });

  it("按重新整理後、清單回來前切走 → 不會重開預覽", async () => {
    const wrapper = mountTab("mic");
    await flushPromises();
    resolveDeviceList([]);
    await flushPromises();
    startPreview.mockClear();

    await wrapper.get("button[aria-label='重新整理']").trigger("click");
    await flushPromises();
    await wrapper.setProps({ tab: "general" });
    resolveDeviceList([]);
    await flushPromises();
    expect(startPreview).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("不在麥克風分頁 → 完全不碰麥克風", async () => {
    const wrapper = mountTab("general");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalledWith("list_audio_input_devices");
    expect(startPreview).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("離開快捷鍵分頁就停止錄鍵", async () => {
    const wrapper = mountTab("hotkey");
    await flushPromises();
    stopKeyRecording.mockClear();
    await wrapper.setProps({ tab: "ai" });
    expect(stopKeyRecording).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("只顯示目前分頁的卡片", async () => {
    const wrapper = mountTab("about");
    await flushPromises();
    expect(wrapper.text()).toContain("關於 SayIt");
    expect(wrapper.text()).not.toContain("快捷鍵設定");
    wrapper.unmount();
  });

  it("Esc 離開設定；錄鍵中、焦點在輸入框或下拉控制項時讓位；卸載後不再觸發", async () => {
    const onExit = vi.fn();
    const wrapper = mount(SettingsView, {
      props: { tab: "general", onExit },
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { AlertDialog: true, ConnectionTestButton: true, Select: true } },
    });
    await flushPromises();
    const pressEscape = (target: EventTarget = window) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    pressEscape();
    expect(onExit).toHaveBeenCalledTimes(1);

    isKeyRecording.value = true;
    pressEscape();
    expect(onExit).toHaveBeenCalledTimes(1);
    isKeyRecording.value = false;

    const combobox = document.createElement("button");
    combobox.setAttribute("role", "combobox");
    document.body.appendChild(combobox);
    pressEscape(combobox);
    expect(onExit).toHaveBeenCalledTimes(1);
    combobox.remove();

    const input = document.createElement("input");
    document.body.appendChild(input);
    pressEscape(input);
    expect(onExit).toHaveBeenCalledTimes(1);
    input.remove();

    wrapper.unmount();
    pressEscape();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsView 下拉選單跟著介面語言換字", () => {
  it("切換介面語言後，佈景主題選單顯示的選項文字跟著換（不殘留舊語言）", async () => {
    const wrapper = mount(SettingsView, {
      props: { tab: "general" },
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { AlertDialog: true, ConnectionTestButton: true } },
    });
    await flushPromises();
    expect(wrapper.get("#theme-select").text()).toContain("跟隨系統");

    i18n.global.locale.value = "en";
    await flushPromises();
    expect(wrapper.get("#theme-select").text()).toContain("System");
    expect(wrapper.get("#theme-select").text()).not.toContain("跟隨系統");
    wrapper.unmount();
  });
});
