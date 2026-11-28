import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick } from "vue";
import MainApp from "../../src/MainApp.vue";
import PreferencesView from "../../src/views/PreferencesView.vue";
import { useSettingsStore } from "../../src/stores/useSettingsStore";
import i18n from "../../src/i18n";

const h = vi.hoisted(() => ({
  data: new Map<string, unknown>(), invoke: vi.fn(), download: vi.fn(), save: vi.fn(),
  listeners: new Map<string, (event: unknown) => void>(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => h.data.get(key), set: async (key: string, value: unknown) => { h.data.set(key, value); }, save: h.save,
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => h.invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), listen: vi.fn(async (event: string, callback: (event: unknown) => void) => {
  h.listeners.set(event, callback); return () => h.listeners.delete(event);
}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: vi.fn(), setFocus: vi.fn() }) }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/lib/database", () => ({ getDatabaseInitError: () => null, getDatabase: () => ({ select: async () => [{ count: 0 }] }) }));
vi.mock("../../src/stores/useVocabularyStore", () => ({ useVocabularyStore: () => ({ fetchTermList: vi.fn().mockResolvedValue(undefined), inboxCount: 0 }) }));
vi.mock("../../src/composables/useCrossWindowSettingsSync", () => ({ useCrossWindowSettingsSync: vi.fn() }));
vi.mock("../../src/lib/autoUpdater", () => ({
  checkForAppUpdate: vi.fn(async () => ({ status: "update-available", version: "0.18.0" })), downloadUpdate: h.download,
}));

const slot = { template: "<div><slot /></div>" };
const stubs = Object.fromEntries(["SidebarProvider", "Sidebar", "SidebarHeader", "SidebarContent", "SidebarGroup", "SidebarGroupContent", "SidebarMenu", "SidebarMenuItem", "SidebarMenuButton", "SidebarInset", "SidebarFooter"].map((s) => [s, slot]));
const wrappers: VueWrapper[] = [];
const modals = () => Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true }));
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/records", component: { template: "<p>記錄</p>" } },
    { path: "/dictionary", component: { template: "<p>詞庫</p>" } },
    { path: "/settings/:tab", component: { template: "<p>設定</p>" } },
    { path: "/settings", redirect: "/settings/general" },
  ] });
  await router.push("/records");
  const wrapper = mount(MainApp, { attachTo: document.body, global: { plugins: [i18n, router], stubs: { ...stubs, SidebarStatus: true, SiteHeader: true, Toaster: true } } });
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router };
}
beforeEach(() => {
  setActivePinia(createPinia()); h.data.clear(); h.listeners.clear();
  h.save.mockReset().mockResolvedValue(undefined); h.invoke.mockReset().mockResolvedValue(false); h.download.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("__APP_VERSION__", "0.17.0");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  Element.prototype.scrollIntoView = vi.fn();
  i18n.global.locale.value = "zh-TW";
});
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("慢載入、權限false先回、引導中快捷鍵／原生導頁與下載完成：最多一個模態；done先權限後更新", async () => {
  const { wrapper, router } = await render();
  const settings = useSettingsStore();
  expect(settings.onboardingState).toBe("pending"); expect(modals()).toHaveLength(0);
  // pending 期間不啟動獨立權限檢查，不讓false先回搶開AccessibilityGuide。
  expect(h.invoke).not.toHaveBeenCalledWith("check_accessibility_permission_command");
  press("k"); press(","); h.listeners.get("main-window:navigate")!({ payload: { path: "/settings" } });
  await flushPromises(); expect(router.currentRoute.value.path).toBe("/records"); expect(modals()).toHaveLength(0);
  let finishSaving!: () => void;
  h.save.mockReturnValueOnce(new Promise<void>((resolve) => { finishSaving = resolve; }));
  const preparing = settings.prepareOnboarding(); await flushPromises();
  expect(settings.onboardingState).toBe("pending");
  finishSaving(); await preparing; await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain("先開啟輔助使用權限");
  press("k"); press(","); h.listeners.get("main-window:navigate")!({ payload: {} });
  await vi.advanceTimersByTimeAsync(5000);
  await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce()); await flushPromises();
  expect(router.currentRoute.value.path).toBe("/records"); expect(modals()).toHaveLength(1);
  expect(document.body.textContent).not.toContain("更新已下載完成");
  let finishPermission!: (value: boolean) => void;
  h.invoke.mockImplementation((command: string) => command === "check_accessibility_permission_command"
    ? new Promise<boolean>((resolve) => { finishPermission = resolve; }) : Promise.resolve());
  await settings.completeOnboarding(); await flushPromises();
  expect(modals()).toHaveLength(0); // 等待權限，不先搶開更新
  finishPermission(false); await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain("需要輔助使用權限");
  wrapper.getComponent({ name: "AccessibilityGuide" }).vm.$emit("close"); await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain(i18n.global.t("mainApp.update.autoInstallTitle"));
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === i18n.global.t("mainApp.update.later"))!.click();
  await flushPromises(); expect(modals()).toHaveLength(0);
  expect(router.currentRoute.value.path).toBe("/records"); // 暫緩的導頁不補執行
});
it("舊權限檢查晚回不蓋過重新開啟的引導；showing關閉已開面板", async () => {
  const settings = useSettingsStore(); settings.onboardingState = "done";
  h.invoke.mockResolvedValue(true);
  await render(); press("k"); await flushPromises();
  expect(modals()).toHaveLength(1);
  expect(document.querySelector('[data-slot="dialog-content"] input')).not.toBeNull();
  settings.reopenOnboarding(); await flushPromises();
  expect(modals()).toHaveLength(1); expect(document.querySelector('[data-slot="dialog-content"] input')).toBeNull();
  let oldPermission!: (value: boolean) => void;
  h.invoke.mockImplementation((command: string) => command === "check_accessibility_permission_command"
    ? new Promise<boolean>((resolve) => { oldPermission = resolve; }) : Promise.resolve());
  await settings.completeOnboarding(); settings.reopenOnboarding();
  oldPermission(false); await flushPromises();
  expect(modals()).toHaveLength(1); expect(document.body.textContent).not.toContain("需要輔助使用權限");
});
it("done後權限、更新摘要與下載提示逐個顯示，不疊窗", async () => {
  const settings = useSettingsStore(); await render();
  await vi.advanceTimersByTimeAsync(5000);
  await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce()); await flushPromises();
  settings.showPromptUpgradeNotice = true; settings.onboardingState = "done"; await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain("需要輔助使用權限");
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "稍後設定")!.click(); await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain(i18n.global.t("mainApp.upgradeNotice.title"));
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === i18n.global.t("mainApp.upgradeNotice.dismiss"))!.click(); await flushPromises();
  expect(modals()).toHaveLength(1); expect(modals()[0].textContent).toContain(i18n.global.t("mainApp.update.autoInstallTitle"));
});
it("關於的重新顯示入口只開引導、不清完成旗標", async () => {
  h.data.set("onboardingCompleted", true);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/settings/about", component: { template: "<p />" } }] });
  await router.push("/settings/about");
  const wrapper = mount(PreferencesView, { props: { tab: "about" }, global: { plugins: [i18n, router], stubs: { SettingsView: true } } }); wrappers.push(wrapper);
  await wrapper.get('[data-testid="reopen-onboarding"]').trigger("click");
  expect(useSettingsStore().onboardingState).toBe("showing"); expect(h.data.get("onboardingCompleted")).toBe(true); expect(h.save).not.toHaveBeenCalled();
});

it("重開並關閉引導後，舊輪權限晚回不能蓋過新輪已授權結果", async () => {
  const resolvers: Array<(value: boolean) => void> = [];
  h.invoke.mockImplementation((command: string) => command === "check_accessibility_permission_command"
    ? new Promise<boolean>((resolve) => { resolvers.push(resolve); }) : Promise.resolve());
  const settings = useSettingsStore(); settings.onboardingState = "done"; await render();
  settings.reopenOnboarding(); await flushPromises();
  await settings.completeOnboarding(); await flushPromises();
  // 0=第一輪獨立檢查，1=引導步驟，2=第二輪獨立檢查
  resolvers[2](true); await flushPromises(); expect(modals()).toHaveLength(0);
  resolvers[0](false); await flushPromises(); expect(modals()).toHaveLength(0);
});
it("更新接管已開面板後，關閉更新不重播面板", async () => {
  h.invoke.mockResolvedValue(true); const settings = useSettingsStore(); settings.onboardingState = "done";
  await render(); press("k"); await flushPromises(); expect(modals()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000); await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce()); await flushPromises();
  expect(modals()).toHaveLength(1); expect(document.querySelector('[data-slot="dialog-content"] input')).toBeNull();
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === i18n.global.t("mainApp.update.later"))!.click(); await flushPromises();
  expect(modals()).toHaveLength(0); expect(document.querySelector('[data-slot="dialog-content"] input')).toBeNull();
});

it("手動更新提示也經過單一模態排程", async () => {
  h.invoke.mockResolvedValue(true); useSettingsStore().onboardingState = "done"; await render();
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === i18n.global.t("mainApp.update.checkUpdate"))!.click();
  await vi.waitFor(() => expect(modals()).toHaveLength(1));
  expect(modals()[0].textContent).toContain(i18n.global.t("mainApp.update.newVersionTitle"));
});

it("前次已驗權限，重開引導後done仍須等這次權限才顯示排隊更新", async () => {
  h.invoke.mockResolvedValue(true); const settings = useSettingsStore(); settings.onboardingState = "done"; await render();
  settings.reopenOnboarding(); await flushPromises();
  await vi.advanceTimersByTimeAsync(5000); await vi.waitFor(() => expect(h.download).toHaveBeenCalledOnce()); await flushPromises();
  let resolve!: (value: boolean) => void;
  h.invoke.mockImplementation((command: string) => command === "check_accessibility_permission_command"
    ? new Promise<boolean>((r) => { resolve = r; }) : Promise.resolve());
  await settings.completeOnboarding(); await flushPromises(); expect(modals()).toHaveLength(0);
  resolve(false); await flushPromises(); expect(modals()).toHaveLength(1);
  expect(modals()[0].textContent).toContain("需要輔助使用權限");
});
