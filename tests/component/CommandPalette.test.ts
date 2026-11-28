import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick, isReadonly } from "vue";
import CommandPalette from "../../src/components/CommandPalette.vue";
import { RadioGroup } from "../../src/components/ui/radio-group";
import { CommandItem } from "../../src/components/ui/command";
import MainApp from "../../src/MainApp.vue";
import SettingsView from "../../src/views/SettingsView.vue";
import { getDatabase, initializeDatabase } from "../../src/lib/database";
import { useHistoryStore } from "../../src/stores/useHistoryStore";
import { useSettingsStore } from "../../src/stores/useSettingsStore";
import { useVocabularyStore } from "../../src/stores/useVocabularyStore";
import { isAnyHotkeyRecording, useHotkeyRecordingSession } from "../../src/composables/useHotkeyRecordingSession";
import { guardSettingsNavigation } from "../../src/composables/useSettingsNavigation";
import i18n from "../../src/i18n";

const state = vi.hoisted(() => ({
  connection: null as unknown as DatabaseSync,
  invoke: vi.fn().mockResolvedValue(true),
  toast: vi.fn(),
  values: new Map<string, unknown>(),
}));
vi.mock("@tauri-apps/plugin-sql", () => {
  const bind = (params: SQLInputValue[]) => Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));
  return { default: { load: async () => ({
    execute: async (sql: string, params: SQLInputValue[] = []) => {
      if (!params.length) { state.connection.exec(sql); return { rowsAffected: 0 }; }
      return { rowsAffected: Number(state.connection.prepare(sql).run(bind(params)).changes) };
    },
    select: async (sql: string, params: SQLInputValue[] = []) => params.length
      ? state.connection.prepare(sql).all(bind(params)) : state.connection.prepare(sql).all(),
  }) } };
});
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => state.values.get(key),
  set: async (key: string, value: unknown) => { state.values.set(key, value); },
  save: async () => {},
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => state.invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(), emitTo: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: vi.fn(), setFocus: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ isEnabled: async () => false }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/composables/useCrossWindowSettingsSync", () => ({ useCrossWindowSettingsSync: vi.fn() }));
vi.mock("../../src/composables/useAudioPreview", () => ({ useAudioPreview: () => ({ startPreview: vi.fn(), stopPreview: vi.fn() }) }));
vi.mock("vue-sonner", () => ({ toast: { success: state.toast }, Toaster: { template: "<div />" } }));

const wrappers: VueWrapper[] = [];
const sessions: ReturnType<typeof useHotkeyRecordingSession>[] = [];
const slot = { template: "<div><slot /></div>" };
const mainStubs = Object.fromEntries([
  "SidebarProvider", "Sidebar", "SidebarHeader", "SidebarContent", "SidebarGroup", "SidebarGroupContent",
  "SidebarMenu", "SidebarMenuItem", "SidebarMenuButton", "SidebarInset", "SidebarFooter",
].map((name) => [name, slot]));

beforeEach(async () => {
  if (!state.connection) {
    state.connection = new DatabaseSync(":memory:");
    await initializeDatabase();
  }
  state.connection.exec("DELETE FROM transcriptions; DELETE FROM vocabulary");
  setActivePinia(createPinia());
  state.invoke.mockReset().mockResolvedValue(true);
  state.toast.mockClear(); state.values.clear();
  vi.stubGlobal("__APP_VERSION__", "0.17.0");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  i18n.global.locale.value = "zh-TW";
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessions.splice(0).forEach((session) => session.stop());
  document.body.innerHTML = "";
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
afterAll(() => state.connection.close());

function seed(id: string, timestamp: number, raw = "原始句", processed: string | null = "整理句", status = "success") {
  state.connection.prepare(`INSERT INTO transcriptions (id, timestamp, raw_text, processed_text,
    recording_duration_ms, transcription_duration_ms, char_count, trigger_mode, was_enhanced, status)
    VALUES (?, ?, ?, ?, 1000, 100, 3, 'hold', 1, ?)`).run(id, timestamp, raw, processed, status);
}
async function render(component: typeof CommandPalette | typeof MainApp = CommandPalette, path = "/records") {
  useSettingsStore().onboardingState = "done";
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/records", component: { template: "<input id='original-focus' />" } },
    { path: "/dictionary", component: { template: "<p>詞庫</p>" } },
    { path: "/settings", redirect: "/settings/general" },
    { path: "/settings/:tab", component: SettingsView, props: true },
  ] });
  router.beforeEach(guardSettingsNavigation);
  await router.push(path);
  const wrapper = mount(component, { attachTo: document.body, props: component === CommandPalette ? { open: false, "onUpdate:open": (open: boolean) => { void wrapper.setProps({ open }); } } : {}, global: {
    plugins: [i18n, router], stubs: { ...mainStubs, SidebarStatus: true, SiteHeader: true, AccessibilityGuide: true, ConnectionTestButton: true },
  } });
  wrappers.push(wrapper);
  if (component === CommandPalette) await wrapper.setProps({ open: true });
  await flushPromises(); await vi.advanceTimersByTimeAsync(2); await nextTick();
  return { wrapper, router };
}
function input() { return document.querySelector<HTMLInputElement>('[data-slot="dialog-content"] input')!; }
function options() { return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')); }
async function select(value: string) {
  const item = wrappers.flatMap((wrapper) => wrapper.findAllComponents(CommandItem)).find((item) => item.props("value") === value);
  if (!item) throw new Error(`找不到選項 ${value}`);
  (item.element as HTMLElement).click(); await flushPromises();
}
async function type(value: string, advance = 150) {
  input().value = value; input().dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
  if (advance) { await vi.advanceTimersByTimeAsync(advance); await flushPromises(); }
}
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event); return event;
}

describe("指令面板：真實 command 與 SQLite", () => {
  it("晚到資料庫命中、靜態指令全隱藏，焦點在輸入框直接 Enter 複製首筆，且不二次篩選整理文字", async () => {
    seed("old", 1, "只在原始文字命中火星", "整理文字沒有關鍵詞");
    for (let index = 0; index < 25; index++) seed(`new-${index}`, index + 2);
    const store = useHistoryStore(); await store.resetAndFetch();
    const search = vi.spyOn(store, "searchTranscriptionList");
    await render();
    await type("火星", 149);
    expect(options()).toHaveLength(0); expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(search).toHaveBeenCalledWith("火星", 8, 0);
    expect(options()).toHaveLength(1); expect(options()[0].textContent).toContain("整理文字沒有關鍵詞");
    await type("火");
    expect(document.activeElement).toBe(input());
    press("Enter", {}, input()); await flushPromises();
    expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理文字沒有關鍵詞" });
    expect(state.toast).toHaveBeenCalledWith("已複製");
  });
  it("最新成功在 LIMIT 前篩選，只有失敗時隱藏，且搜尋列表與分頁狀態不變", async () => {
    seed("success", 1); for (let index = 0; index < 9; index++) seed(`failed-${index}`, index + 2, "", null, "failed");
    const store = useHistoryStore(); await store.resetAndFetch(); store.searchQuery = "頁面搜尋"; store.currentOffset = 40; store.hasMore = false;
    const snapshot = JSON.parse(JSON.stringify(store.$state));
    const selectLatest = vi.spyOn(getDatabase(), "select");
    expect(await store.fetchLatestSuccessfulText()).toBe("整理句");
    expect(selectLatest).toHaveBeenLastCalledWith(expect.stringContaining("WHERE status = 'success'"), [1]);
    expect(store.$state).toEqual(snapshot);
    const { wrapper } = await render();
    await type("原始"); expect(store.$state).toEqual(snapshot); await type("");
    options().find((el) => el.textContent?.includes("複製上一句"))!.click(); await flushPromises();
    expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理句" });
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    state.connection.exec("UPDATE transcriptions SET processed_text=NULL WHERE status='success'");
    expect(await store.fetchLatestSuccessfulText()).toBe("原始句");
    state.connection.exec("DELETE FROM transcriptions WHERE status='success'");
    expect(await store.fetchLatestSuccessfulText()).toBeNull();
    await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises();
    expect(options().some((el) => el.textContent?.includes("複製上一句"))).toBe(false);
  });
});

describe("指令面板查詢與動作", () => {
  it("重開清空搜尋文字，空字串與純空白輸入不送資料庫搜尋", async () => {
    const search = vi.spyOn(useHistoryStore(), "searchTranscriptionList");
    const { wrapper } = await render(); await vi.advanceTimersByTimeAsync(150);
    expect(search).not.toHaveBeenCalled();
    await type("   "); expect(search).not.toHaveBeenCalled();
    await type("舊搜尋"); expect(search).toHaveBeenCalledExactlyOnceWith("舊搜尋", 8, 0);
    search.mockClear();
    await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises();
    expect(input().value).toBe("");
    await vi.advanceTimersByTimeAsync(150); expect(search).not.toHaveBeenCalled();
    await type(""); expect(search).not.toHaveBeenCalled();
  });
  it("重開的上一句查詢尚未完成時，不沿用上次開啟的上一句", async () => {
    seed("last", 1);
    const { wrapper } = await render(); expect(options().some((el) => el.textContent?.includes("複製上一句"))).toBe(true);
    await wrapper.setProps({ open: false }); state.connection.exec("DELETE FROM transcriptions");
    let resolveLatest!: (text: string | null) => void;
    vi.spyOn(useHistoryStore(), "fetchLatestSuccessfulText").mockImplementation(() => new Promise((resolve) => { resolveLatest = resolve; }));
    await wrapper.setProps({ open: true }); await flushPromises();
    expect(options().some((el) => el.textContent?.includes("複製上一句"))).toBe(false);
    resolveLatest(null); await flushPromises();
    expect(options().some((el) => el.textContent?.includes("複製上一句"))).toBe(false);
  });
  it("已有搜尋結果時，新輸入在150ms等待中立即撤下舊記錄", async () => {
    seed("old", 1, "火星記錄", null); await render(); await type("火星");
    expect(options()[0].textContent).toContain("火星記錄");
    await type("新查詢", 149); expect(options()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(options()[0].textContent).toContain("把「新查詢」加進詞庫");
  });
  it("上次零命中已完成後，新輸入查詢完成前不提供新增詞", async () => {
    await render(); await type("第一個新詞"); expect(options()[0].textContent).toContain("第一個新詞");
    await type("第二個新詞", 149); expect(options()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(options()[0].textContent).toContain("把「第二個新詞」加進詞庫");
  });
  it("連續輸入在150ms內合併，關閉前未送出的查詢取消", async () => {
    const search = vi.spyOn(useHistoryStore(), "searchTranscriptionList");
    const { wrapper } = await render(); await type("第", 80); await type("第二", 149);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(search).toHaveBeenCalledExactlyOnceWith("第二", 8, 0);
    await type("關閉前", 20); await wrapper.setProps({ open: false });
    await vi.advanceTimersByTimeAsync(150); await flushPromises(); expect(search).toHaveBeenCalledTimes(1);
  });
  it("舊開啟輪次的上一句讀取失敗不顯示到重開的面板", async () => {
    let rejectOld!: (error: Error) => void;
    vi.spyOn(useHistoryStore(), "fetchLatestSuccessfulText").mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; })).mockResolvedValue(null);
    const { wrapper } = await render(); await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises();
    rejectOld(new Error("舊輪中斷")); await flushPromises();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("靜態指令只按自身標籤過濾，忽略大小寫與兩側空白", async () => {
    seed("last", 1); i18n.global.locale.value = "en";
    await render(); await type("  cOpY  ");
    expect(options().some((el) => el.textContent?.includes("Copy last transcript"))).toBe(true);
    expect(options().some((el) => el.textContent?.includes("Switch to"))).toBe(false);
  });
  it("目前查詢才可新增；新增成功沿用真詞庫 store，空白不新增", async () => {
    const { wrapper } = await render();
    await type("  新詞  ", 149);
    expect(options().some((el) => el.textContent?.includes("加進詞庫"))).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(options()[0].textContent).toContain("把「新詞」加進詞庫");
    press("Enter", {}, input()); await flushPromises();
    expect(useVocabularyStore().termList.map((entry) => entry.term)).toContain("新詞");
    expect(state.toast).toHaveBeenCalledWith("已加入");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    await wrapper.setProps({ open: true }); await flushPromises();
    await type("   "); expect(options().some((el) => el.textContent?.includes("加進詞庫"))).toBe(false);
  });
  it("有DB命中或大小寫重複時不新增，無文字失敗記錄隱藏但仍算原始命中", async () => {
    await useVocabularyStore().addTerm("Tauri");
    await render(); await type("tAuRi");
    expect(options()).toHaveLength(0);
    seed("empty-failure", 1, "", null, "failed");
    seed("space-failure", 2, "   ", null, "failed");
    const store = useHistoryStore();
    const rawResults = await store.searchTranscriptionList("", 8, 0);
    vi.spyOn(store, "searchTranscriptionList").mockResolvedValue(rawResults);
    await type("沒有文字");
    expect(options()).toHaveLength(0);
  });
  it("全部不符時不留空標題，查詢完成才顯示沒有結果", async () => {
    await useVocabularyStore().addTerm("Tauri");
    await render();
    const headings = () => document.querySelectorAll('[data-slot="dialog-content"] [data-slot="command-group"]');
    const empty = () => document.querySelector('[data-testid="command-palette-empty"]');
    await type("tauri", 0);
    expect(empty()).toBeNull();
    await vi.advanceTimersByTimeAsync(150); await flushPromises();
    expect(options()).toHaveLength(0);
    expect(headings()).toHaveLength(0);
    expect(empty()?.textContent).toContain("沒有符合的結果");
  });
  it("查詢限制最多8筆，原文後備可複製且上下鍵改變選取", async () => {
    for (let index = 0; index < 12; index++) seed(`record-${index}`, index, `火星${index}`, null);
    await render(); await type("火星");
    expect(options()).toHaveLength(8);
    press("ArrowDown", {}, input()); press("Enter", {}, input()); await flushPromises();
    expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "火星10" });
  });
  it("新輸入當刻使舊查詢失效，150ms內不接受舊零命中或舊結果", async () => {
    seed("first", 1, "舊結果", null);
    const store = useHistoryStore(); const record = (await store.searchTranscriptionList("", 8, 0))[0];
    const resolvers: ((records: typeof record[]) => void)[] = [];
    vi.spyOn(store, "searchTranscriptionList").mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    await render(); await type("舊查詢");
    await type("新查詢", 0); resolvers[0]([]); await flushPromises();
    expect(options()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150); await flushPromises();
    resolvers[1]([record]); await flushPromises();
    expect(options()[0].textContent).toContain("舊結果");
    await type("第三次"); await type("第四次");
    resolvers[3]([]); await flushPromises();
    expect(options()[0].textContent).toContain("把「第四次」加進詞庫");
    resolvers[2]([record]); await flushPromises();
    expect(options()).toHaveLength(1); expect(options()[0].textContent).toContain("第四次");
  });
  it("關閉與重開也使舊查詢和上一句讀取失效", async () => {
    const store = useHistoryStore();
    let resolveLatest!: (text: string) => void;
    let resolveSearch!: (records: []) => void;
    vi.spyOn(store, "fetchLatestSuccessfulText").mockImplementationOnce(() => new Promise((resolve) => { resolveLatest = resolve; })).mockResolvedValue(null);
    vi.spyOn(store, "searchTranscriptionList").mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
    const { wrapper } = await render(); await type("舊輸入");
    await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises();
    resolveLatest("過期上一句"); resolveSearch([]); await flushPromises();
    expect(options().some((el) => el.textContent?.includes("複製上一句") || el.textContent?.includes("加進詞庫"))).toBe(false);
  });
  it("搜尋失敗有錯誤提示且不當成零命中，較舊查詢的失敗不覆蓋目前結果", async () => {
    const store = useHistoryStore(); let rejectOld!: (error: Error) => void;
    vi.spyOn(store, "searchTranscriptionList").mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; })).mockRejectedValueOnce(new Error("資料庫中斷")).mockResolvedValue([]);
    await render(); await type("舊輸入"); await type("失敗");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("搜尋失敗，請稍後再試");
    expect(options()).toHaveLength(0);
    await type("成功"); rejectOld(new Error("過期錯誤")); await flushPromises();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(options()[0].textContent).toContain("成功");
  });
  it("上一句讀取與命令寫入失敗皆提示錯誤，寫入失敗保持面板開啟", async () => {
    vi.spyOn(useHistoryStore(), "fetchLatestSuccessfulText").mockRejectedValue(new Error("資料庫中斷"));
    const { wrapper } = await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("無法載入上一句，請稍後再試");
    vi.spyOn(useSettingsStore(), "savePromptMode").mockRejectedValue(new Error("磁碟中斷"));
    await select("mode-active");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("操作失敗，請稍後再試");
    expect(wrapper.emitted("update:open")).toBeUndefined(); expect(state.toast).not.toHaveBeenCalled();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])("IME Enter %j 不執行且保留預設組字行為", async (init) => {
    seed("record", 1); await render(); await type("原始");
    const event = press("Enter", init, input()); await flushPromises();
    expect(event.defaultPrevented).toBe(false); expect(state.invoke).not.toHaveBeenCalled();
    press("Enter", {}, input()); await flushPromises();
    expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理句" });
  });
  it("真composition事件序列中Enter不執行，compositionend之後可執行", async () => {
    seed("record", 1); await render(); await type("原始");
    input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    press("Enter", {}, input()); await flushPromises(); expect(state.invoke).not.toHaveBeenCalled();
    input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await nextTick();
    press("Enter", {}, input()); await flushPromises(); expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理句" });
  });
  it("Esc關閉後還原開啟前焦點", async () => {
    const original = document.createElement("input"); document.body.append(original); original.focus();
    const { wrapper } = await render(); expect(document.activeElement).toBe(input());
    press("Escape", {}, input()); await flushPromises(); await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.emitted("update:open")).toEqual([[false]]); expect(document.activeElement).toBe(original);
  });
  it.each(["general", "hotkey", "ai", "mic", "advanced", "about"])("設定導航：%s", async (tab) => {
    const { router, wrapper } = await render(); await select(`settings-${tab}`);
    expect(router.currentRoute.value.path).toBe(`/settings/${tab}`);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(state.toast).not.toHaveBeenCalled();
  });
});

const MAC_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15";
function stubUserAgent(value: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(value);
}

describe("主視窗快捷鍵與模式草稿", () => {
  // 預設以 macOS 跑（⌘K）；平台差異另有專門案例
  beforeEach(() => stubUserAgent(MAC_USER_AGENT));

  it.each([
    { platform: "macOS", userAgent: MAC_USER_AGENT, opens: { metaKey: true }, ignored: { ctrlKey: true } },
    { platform: "Windows", userAgent: WINDOWS_USER_AGENT, opens: { ctrlKey: true }, ignored: { metaKey: true } },
  ])("$platform：只有對應修飾鍵＋K 開面板，另一個不攔（macOS 的 Ctrl+K 留給文字框刪到行尾）", async ({ userAgent, opens, ignored }) => {
    stubUserAgent(userAgent);
    await render(MainApp);
    expect(press("k", ignored).defaultPrevented).toBe(false); await flushPromises(); expect(input()).toBeNull();
    expect(press("k", opens).defaultPrevented).toBe(true); await flushPromises(); expect(input()).not.toBeNull();
  });

  it("舊複製完成時保留成功提示，不關閉Esc後重開的新面板", async () => {
    seed("last", 1);
    let finishCopy!: () => void;
    state.invoke.mockImplementation((command: string) => command === "copy_to_clipboard"
      ? new Promise<void>((resolve) => { finishCopy = resolve; }) : Promise.resolve(true));
    await render(MainApp); press("k", { metaKey: true }); await flushPromises();
    await select("copy-last"); expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理句" });
    press("Escape", {}, input()); await flushPromises(); expect(input()).toBeNull();
    press("k", { metaKey: true }); await flushPromises();
    const reopenedInput = input(); expect(reopenedInput).not.toBeNull();
    finishCopy(); await flushPromises();
    expect(input()).toBe(reopenedInput); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith("已複製");
  });
  it("舊複製失敗時不將錯誤寫入Esc後重開的新面板", async () => {
    seed("last", 1);
    let failCopy!: (error: Error) => void;
    state.invoke.mockImplementation((command: string) => command === "copy_to_clipboard"
      ? new Promise<void>((_resolve, reject) => { failCopy = reject; }) : Promise.resolve(true));
    await render(MainApp); press("k", { metaKey: true }); await flushPromises();
    await select("copy-last"); expect(state.invoke).toHaveBeenCalledWith("copy_to_clipboard", { text: "整理句" });
    press("Escape", {}, input()); await flushPromises(); expect(input()).toBeNull();
    press("k", { metaKey: true }); await flushPromises();
    const reopenedInput = input(); expect(reopenedInput).not.toBeNull();
    failCopy(new Error("舊複製失敗")); await flushPromises();
    expect(input()).toBe(reopenedInput); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(state.toast).not.toHaveBeenCalled();
  });
  it.each([{ metaKey: true }, { ctrlKey: true }])("%j + 逗號進入設定，已在設定分頁時不切頁", async (modifier) => {
    const { router } = await render(MainApp);
    expect(press(",", modifier).defaultPrevented).toBe(true); await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings/general");
    await router.push("/settings/ai"); await flushPromises();
    expect(press(",", modifier).defaultPrevented).toBe(true); await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings/ai");
    expect(input()).toBeNull();
  });
  it.each([
    { modifier: { metaKey: true }, userAgent: MAC_USER_AGENT },
    { modifier: { ctrlKey: true }, userAgent: WINDOWS_USER_AGENT },
  ])("$modifier + K開關；沒有修飾鍵及其他鍵不攔截", async ({ modifier, userAgent }) => {
    stubUserAgent(userAgent);
    await render(MainApp);
    expect(press("k").defaultPrevented).toBe(false); expect(input()).toBeNull();
    expect(press("x", modifier).defaultPrevented).toBe(false);
    expect(press("k", modifier).defaultPrevented).toBe(true); await flushPromises(); expect(input()).not.toBeNull();
    press("K", modifier); await flushPromises(); expect(input()).toBeNull();
  });
  it.each([{ isComposing: true }, { repeat: true }, { altKey: true }, { shiftKey: true }])("⌘K與⌘,讓位：%j", async (extra) => {
    const { router } = await render(MainApp);
    for (const key of ["k", ","]) expect(press(key, { metaKey: true, ...extra }).defaultPrevented).toBe(false);
    await flushPromises(); expect(input()).toBeNull(); expect(router.currentRoute.value.path).toBe("/records");
  });
  it("錄鍵共享唯讀狀態，⌘K/⌘,讓位，錄完的repeat仍不開啟", async () => {
    const { router } = await render(MainApp);
    const session = useHotkeyRecordingSession({ enableDomSource: false, onCaptured: vi.fn(), onRejected: vi.fn(), onTimeout: vi.fn(), onStartFailed: vi.fn() });
    sessions.push(session); await session.start(); expect(isReadonly(isAnyHotkeyRecording)).toBe(true); expect(isAnyHotkeyRecording.value).toBe(true);
    for (const key of ["k", ","]) expect(press(key, { metaKey: true }).defaultPrevented).toBe(false);
    await flushPromises(); expect(input()).toBeNull(); expect(router.currentRoute.value.path).toBe("/records");
    session.stop(); expect(isAnyHotkeyRecording.value).toBe(false);
    press("k", { metaKey: true, repeat: true }); press(",", { metaKey: true, repeat: true }); await flushPromises();
    expect(input()).toBeNull(); expect(router.currentRoute.value.path).toBe("/records");
    press("k", { metaKey: true }); await flushPromises(); expect(input()).not.toBeNull();
  });
  it("直接切積極保留自訂文字；之後進設定，真編輯器顯示積極模式及內容", async () => {
    const settings = useSettingsStore(); settings.aiPrompt = "保存的自訂文字";
    const { wrapper, router } = await render(MainApp);
    press("k", { metaKey: true }); await flushPromises();
    const checked = document.querySelector('[aria-label="目前模式"]'); expect(checked?.parentElement?.textContent).toContain("精簡");
    await select("mode-active"); expect(settings.promptMode).toBe("active"); expect(settings.aiPrompt).toBe("保存的自訂文字");
    expect(state.values.get("promptMode")).toBe("active"); expect(state.toast).not.toHaveBeenCalled();
    press(",", { metaKey: true }); await flushPromises(); await router.push("/settings/ai"); await flushPromises();
    const view = wrapper.getComponent(SettingsView);
    expect(view.findAllComponents(RadioGroup).some((group) => group.props("modelValue") === "active")).toBe(true);
    expect((view.get("textarea").element as HTMLTextAreaElement).value).toBe(settings.getAiPrompt());
  });
  it.each(["custom", "minimal"] as const)("設定草稿（%s）只導設定，內容與模式不改", async (mode) => {
    const settings = useSettingsStore(); settings.promptMode = mode; settings.aiPrompt = "已儲存自訂";
    const { wrapper, router } = await render(MainApp, "/settings/ai");
    const view = wrapper.getComponent(SettingsView); await view.get("textarea").setValue("未儲存草稿");
    press("k", { metaKey: true }); await flushPromises();
    expect(options().some((el) => el.textContent?.includes("切換為"))).toBe(false);
    expect(options().some((el) => el.textContent?.includes("到設定頁調整整理模式"))).toBe(true);
    await select("mode-settings"); expect(router.currentRoute.value.path).toBe("/settings/ai");
    expect(settings.promptMode).toBe(mode); expect(settings.aiPrompt).toBe("已儲存自訂");
    expect((view.get("textarea").element as HTMLTextAreaElement).value).toBe("未儲存草稿");
  });
  it("在記錄頁自訂模式時也只提供設定入口，無模式勾選", async () => {
    useSettingsStore().promptMode = "custom"; const { router } = await render();
    expect(options().some((el) => el.textContent?.includes("切換為"))).toBe(false);
    expect(document.querySelector('[aria-label="目前模式"]')).toBeNull();
    await select("mode-settings"); expect(useSettingsStore().promptMode).toBe("custom");
    expect(router.currentRoute.value.path).toBe("/settings/ai"); expect(state.toast).not.toHaveBeenCalled();
  });
  it.each(["/records", "/settings/ai"])("%s 中的整理模式設定入口照標籤過濾", async (path) => {
    useSettingsStore().promptMode = "custom"; await render(CommandPalette, path);
    expect(options().some((el) => el.textContent?.includes("到設定頁調整整理模式"))).toBe(true);
    await type("火星", 149); expect(options()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await flushPromises();
    expect(options()).toHaveLength(1); expect(options()[0].textContent).toContain("把「火星」加進詞庫");
  });
  it("五語系key與插值對齊，切語言後面板有對應文案", async () => {
    await render();
    const messages = i18n.global.messages.value;
    const expected = Object.keys(messages["zh-TW"].commandPalette).sort();
    for (const locale of ["zh-TW", "zh-CN", "en", "ja", "ko"] as const) {
      const text = messages[locale].commandPalette;
      expect(Object.keys(text).sort()).toEqual(expected); expect(Object.keys(text.mode).sort()).toEqual(["active", "minimal"]);
      expect(text.addTerm.match(/\{\w+\}/g)).toEqual(["{term}"]);
      expect(Object.values(text).filter((value) => typeof value === "string").every((value) => value.trim())).toBe(true);
      i18n.global.locale.value = locale; await nextTick();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(text.title);
    }
  });
});
