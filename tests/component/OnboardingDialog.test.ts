import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import i18n from "../../src/i18n";
import OnboardingDialog from "../../src/components/OnboardingDialog.vue";
import { Dialog } from "../../src/components/ui/dialog";
import ConnectionTestButton from "../../src/components/ConnectionTestButton.vue";
import { useSettingsStore } from "../../src/stores/useSettingsStore";
import { isAnyHotkeyRecording } from "../../src/composables/useHotkeyRecordingSession";

const h = vi.hoisted(() => ({
  data: new Map<string, unknown>(), save: vi.fn(), test: vi.fn(), invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => h.data.get(key),
  set: async (key: string, value: unknown) => { h.data.set(key, value); }, save: h.save,
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => h.invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn(async (event: string, callback: (event: { payload: unknown }) => void) => {
  h.listeners.set(event, callback); return () => h.listeners.delete(event);
}) }));
vi.mock("../../src/lib/connectionTest", () => ({ testWhisperConnection: (...args: unknown[]) => h.test(...args) }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

const wrappers: VueWrapper[] = [];
const field = () => new DOMWrapper(document.querySelector("#onboarding-api-key") as HTMLInputElement);
const action = (name: string) => new DOMWrapper(document.querySelector(`[data-testid="onboarding-${name}"]`) as HTMLButtonElement);
const nextDisabled = () => (action("next").element as HTMLButtonElement).disabled;
async function render(mac = false, hasKey = false) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(mac ? "Macintosh" : "Windows");
  if (hasKey) h.data.set("groqApiKey", "existing");
  const settings = useSettingsStore(); await settings.loadSettings(); settings.reopenOnboarding();
  const wrapper = mount(OnboardingDialog, { attachTo: document.body, global: { plugins: [i18n] } });
  wrappers.push(wrapper); await flushPromises(); return { settings, wrapper };
}
async function testKey(wrapper: VueWrapper, value = "A") {
  await field().setValue(value);
  await wrapper.getComponent(ConnectionTestButton).get("button").trigger("click");
  await flushPromises();
}
beforeEach(() => {
  setActivePinia(createPinia());
  h.data.clear(); h.data.set("selectedLocale", "zh-TW"); h.listeners.clear(); h.save.mockReset().mockResolvedValue(undefined);
  h.test.mockReset().mockResolvedValue({ ok: true, durationMs: 1 });
  h.invoke.mockReset().mockResolvedValue(true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  i18n.global.locale.value = "zh-TW";
});
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])("macOS=%s：步驟前進、回上一步、試講只空框且自動聚焦、完成寫旗標", async (mac) => {
  const { wrapper, settings } = await render(mac);
  expect(Boolean(document.querySelector('[data-testid="onboarding-permission"]'))).toBe(mac);
  if (mac) {
    expect(nextDisabled()).toBe(false);
    expect(document.body.textContent).toContain("已完成");
    await action("next").trigger("click");
  }
  expect(nextDisabled()).toBe(true);
  await testKey(wrapper); expect(nextDisabled()).toBe(false);
  await action("next").trigger("click");
  expect(document.body.textContent).toContain(settings.getTriggerKeyDisplayName(settings.hotkeyConfig!.triggerKey));
  await action("back").trigger("click");
  expect(document.querySelector("#onboarding-api-key")).not.toBeNull();
  await action("next").trigger("click"); await action("next").trigger("click"); await nextTick();
  expect(document.querySelector("#onboarding-trial")).toBe(document.activeElement);
  expect((document.activeElement as HTMLTextAreaElement).value).toBe("");
  expect(document.body.textContent).toContain("按住");
  await settings.saveHotkeyConfig(settings.hotkeyConfig!.triggerKey, "toggle"); await nextTick();
  expect(document.body.textContent).toContain("再按一下停止並貼上");
  await action("next").trigger("click"); await flushPromises();
  expect(h.data.get("onboardingCompleted")).toBe(true); expect(settings.onboardingState).toBe("done");
});
it("每步均可略過整個引導，已有金鑰顯示完成", async () => {
  const { settings } = await render(false, true);
  expect(nextDisabled()).toBe(false); expect(document.body.textContent).toContain("已完成");
  await action("skip").trigger("click"); await flushPromises();
  expect(settings.onboardingState).toBe("done"); expect(h.data.get("onboardingCompleted")).toBe(true);
});
it("A測成功後改B：不能前進且清除舊成功訊息", async () => {
  const { wrapper } = await render(); await testKey(wrapper);
  expect(nextDisabled()).toBe(false); expect(wrapper.getComponent(ConnectionTestButton).text()).toContain("✅");
  await field().setValue("B");
  expect(nextDisabled()).toBe(true); expect(wrapper.getComponent(ConnectionTestButton).text()).not.toContain("✅");
});
it("A晚回來時已改B：不能儲存A或前進，也不顯示舊成功", async () => {
  let resolve!: (value: unknown) => void;
  h.test.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { wrapper } = await render(); await testKey(wrapper);
  await field().setValue("B");
  expect(wrapper.getComponent(ConnectionTestButton).props("disabled")).toBe(true);
  resolve({ ok: true, durationMs: 1 }); await flushPromises();
  expect(wrapper.getComponent(ConnectionTestButton).props("disabled")).toBe(false);
  expect(nextDisabled()).toBe(true); expect(h.data.has("groqApiKey")).toBe(false);
  expect(wrapper.getComponent(ConnectionTestButton).text()).not.toContain("✅");
});
it("測試成功但儲存失敗：不能前進且顯示錯誤", async () => {
  const { wrapper } = await render(); h.save.mockRejectedValueOnce(new Error("寫入失敗"));
  await testKey(wrapper); expect(nextDisabled()).toBe(true);
  expect(document.body.textContent).toContain("寫入失敗");
});
it("測試失敗不儲存、不放行，顯示測試錯誤", async () => {
  const { wrapper } = await render(); h.test.mockResolvedValue({ ok: false, durationMs: 1, errorMessage: "無法連線" });
  await testKey(wrapper); expect(nextDisabled()).toBe(true); expect(h.data.has("groqApiKey")).toBe(false);
  expect(document.body.textContent).toContain("無法連線");
});
it("離開引導後才回的測試結果不儲存金鑰", async () => {
  let resolve!: (value: unknown) => void; h.test.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { wrapper } = await render(); await testKey(wrapper); wrapper.unmount(); wrappers.pop();
  resolve({ ok: true, durationMs: 1 }); await flushPromises(); expect(h.data.has("groqApiKey")).toBe(false);
});
it("儲存還在途時修改輸入：成功後也不能放行B", async () => {
  const { wrapper } = await render(); let finishSave!: () => void;
  h.save.mockReturnValueOnce(new Promise<void>((resolve) => { finishSave = resolve; }));
  await testKey(wrapper); await field().setValue("B"); finishSave(); await flushPromises(); expect(nextDisabled()).toBe(true);
});
it.each(["back", "next", "skip", "unmount"])("錄鍵中 %s：stop共享session，不留錄鍵狀態", async (actionName) => {
  const { wrapper } = await render(false, true); await action("next").trigger("click");
  const recordButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!;
  recordButton.click(); await flushPromises(); expect(isAnyHotkeyRecording.value).toBe(true);
  h.invoke.mockClear();
  if (actionName === "unmount") { wrapper.unmount(); wrappers.pop(); }
  else await action(actionName).trigger("click");
  await flushPromises(); expect(isAnyHotkeyRecording.value).toBe(false);
  expect(h.invoke).toHaveBeenCalledWith("cancel_hotkey_recording");
});
it("錄得一般鍵／組合鍵／和弦沿用既有儲存API", async () => {
  const { settings } = await render(false, true); await action("next").trigger("click");
  for (const payload of [
    { keycode: 0x41, modifiers: [], chordKeycodes: [] },
    { keycode: 0x42, modifiers: ["control"], chordKeycodes: [] },
    { keycode: 0xa3, modifiers: [], chordKeycodes: [0xa3, 0xa5] },
  ]) {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!.click(); await flushPromises();
    h.listeners.get("hotkey:recording-captured")!({ payload }); await flushPromises();
    expect(settings.hotkeyConfig?.triggerKey).toEqual(payload.chordKeycodes.length ? { chord: { keycodes: payload.chordKeycodes } }
      : payload.modifiers.length ? { combo: { modifiers: payload.modifiers, keycode: payload.keycode } } : { custom: { keycode: payload.keycode } });
  }
});

it.each(["permission", "key", "hotkey", "try"])("%s步驟可略過並寫旗標", async (step) => {
  const { settings } = await render(true, true);
  const index = ["permission", "key", "hotkey", "try"].indexOf(step);
  for (let i = 0; i < index; i++) await action("next").trigger("click");
  await action("skip").trigger("click"); await flushPromises();
  expect(settings.onboardingState).toBe("done"); expect(h.data.get("onboardingCompleted")).toBe(true);
});
it("完成儲存失敗仍留在引導並可重試，錯誤文字可見", async () => {
  const { settings } = await render(); h.save.mockClear(); h.save.mockRejectedValueOnce(new Error("完成旗標寫入失敗"));
  await action("skip").trigger("click"); await flushPromises();
  expect(settings.onboardingState).toBe("showing"); expect(document.body.textContent).toContain("完成旗標寫入失敗");
  expect((action("skip").element as HTMLButtonElement).disabled).toBe(false);
  h.save.mockRejectedValueOnce(new Error("重試仍失敗"));
  await action("skip").trigger("click"); await flushPromises();
  expect(h.save).toHaveBeenCalledTimes(2); expect(settings.onboardingState).toBe("showing");
  expect(document.body.textContent).toContain("重試仍失敗");
});
it("權限未授權不放行，可打開系統設定", async () => {
  h.invoke.mockResolvedValue(false); await render(true);
  expect(nextDisabled()).toBe(true);
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "開啟系統設定")!.click(); await flushPromises();
  expect(h.invoke).toHaveBeenCalledWith("open_accessibility_settings");
});
it.each(["esc_reserved", "unsupported"])("錄鍵拒絕%s顯示具體訊息", async (reason) => {
  const { settings } = await render(false, true); await action("next").trigger("click");
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!.click(); await flushPromises();
  h.listeners.get("hotkey:recording-rejected")!({ payload: { reason } }); await flushPromises();
  expect(document.body.textContent).toContain(reason === "esc_reserved" ? settings.getEscapeReservedMessage() : settings.getHotkeyUnsupportedKeyMessage());
  await action("back").trigger("click"); expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("錄鍵儲存失敗顯示錯誤", async () => {
  await render(false, true); await action("next").trigger("click");
  h.save.mockRejectedValueOnce(new Error("按鍵儲存失敗"));
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!.click(); await flushPromises();
  h.listeners.get("hotkey:recording-captured")!({ payload: { keycode: 0x41, modifiers: [], chordKeycodes: [] } }); await flushPromises();
  expect(document.body.textContent).toContain("按鍵儲存失敗");
});
it("錄鍵啟動失敗顯示錯誤", async () => {
  await render(false, true); await action("next").trigger("click");
  h.invoke.mockRejectedValueOnce(new Error("錄鍵無法啟動"));
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!.click(); await flushPromises();
  expect(document.body.textContent).toContain("錄鍵無法啟動");
});
it("錄鍵逾時顯示既有訊息", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { settings } = await render(false, true); await action("next").trigger("click");
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "更換按鍵")!.click(); await flushPromises();
  await vi.advanceTimersByTimeAsync(10000); await flushPromises();
  expect(document.body.textContent).toContain(settings.getHotkeyRecordingTimeoutMessage()); vi.useRealTimers();
});

it("空白金鑰不送出連線測試，輸入值會先trim再測與儲存", async () => {
  const { wrapper } = await render();
  expect((wrapper.getComponent(ConnectionTestButton).get("button").element as HTMLButtonElement).disabled).toBe(true);
  (wrapper.getComponent(ConnectionTestButton).get("button").element as HTMLButtonElement).click();
  expect(h.test).not.toHaveBeenCalled();
  await testKey(wrapper, " A "); expect(h.test).toHaveBeenCalledWith(useSettingsStore().selectedWhisperModelId, "A");
  expect(h.data.get("groqApiKey")).toBe("A"); expect(nextDisabled()).toBe(false);
});
it("完成尚在儲存時按鈕停用，等待成功才完成", async () => {
  const { settings } = await render(false, true); let resolve!: () => void;
  h.save.mockReturnValueOnce(new Promise<void>((r) => { resolve = r; }));
  await action("skip").trigger("click");
  expect(settings.onboardingState).toBe("showing");
  expect((action("skip").element as HTMLButtonElement).disabled).toBe(true); expect(nextDisabled()).toBe(true);
  resolve(); await flushPromises(); expect(settings.onboardingState).toBe("done");
});
it("關閉對話框寫完成旗標", async () => {
  const { wrapper, settings } = await render();
  wrapper.getComponent(Dialog).vm.$emit("update:open", false); await flushPromises();
  expect(settings.onboardingState).toBe("done"); expect(h.data.get("onboardingCompleted")).toBe(true);
});
it("設定載入失敗留下null觸發鍵時不顯示null或拋錯", async () => {
  const { settings } = await render(false, true); settings.hotkeyConfig = null;
  await action("next").trigger("click"); expect(document.querySelector("kbd")?.textContent).toBe("");
});
