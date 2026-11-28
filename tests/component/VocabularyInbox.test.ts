import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick } from "vue";
import InboxSection from "../../src/components/vocabulary/InboxSection.vue";
import DictionaryView from "../../src/views/DictionaryView.vue";
import MainApp from "../../src/MainApp.vue";
import { useVocabularyStore } from "../../src/stores/useVocabularyStore";
import { initializeDatabase } from "../../src/lib/database";
import i18n from "../../src/i18n";

const state = vi.hoisted(() => ({
  connection: null as unknown as DatabaseSync,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  toast: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-sql", () => {
  const bind = (params: SQLInputValue[]) => Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));
  const adapter = {
    execute: async (sql: string, params: SQLInputValue[] = []) => {
      if (!params.length) { state.connection.exec(sql); return { rowsAffected: 0 }; }
      const result = state.connection.prepare(sql).run(bind(params));
      return { rowsAffected: Number(result.changes) };
    },
    select: async (sql: string, params: SQLInputValue[] = []) => params.length
      ? state.connection.prepare(sql).all(bind(params)) : state.connection.prepare(sql).all(),
  };
  return { default: { load: async () => adapter } };
});
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    state.listeners.set(name, callback);
    return () => state.listeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(true) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ show: vi.fn(), setFocus: vi.fn() }) }));
vi.mock("vue-sonner", () => ({ toast: { success: state.toast, error: state.toastError }, Toaster: { template: "<div />" } }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/stores/useSettingsStore", () => ({ useSettingsStore: () => ({ isSmartDictionaryEnabled: true, showPromptUpgradeNotice: false }) }));
vi.mock("../../src/composables/useCrossWindowSettingsSync", () => ({ useCrossWindowSettingsSync: vi.fn() }));

afterAll(() => state.connection.close());

let wrappers: VueWrapper[] = [];
beforeEach(async () => {
  // initializeDatabase singleton 僅建立一次；每案清空相同連線的測試資料。
  if (!state.connection) {
    state.connection = new DatabaseSync(":memory:");
    await initializeDatabase();
  }
  state.connection.exec("DELETE FROM vocabulary");
  state.toast.mockClear(); state.toastError.mockClear(); state.listeners.clear();
  vi.stubGlobal("__APP_VERSION__", "0.17.0");
  setActivePinia(createPinia());
  i18n.global.locale.value = "zh-TW";
});
afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers = []; vi.unstubAllGlobals(); });

async function seed(kind: "empty" | "term" | "pair" | "both") {
  const store = useVocabularyStore();
  if (kind === "term" || kind === "both") await store.addAiSuggestedTerm("Tauri");
  if (kind === "pair" || kind === "both") {
    await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
  }
  return store;
}
function render(component = InboxSection) {
  const wrapper = mount(component, { global: { plugins: [i18n] } });
  wrappers.push(wrapper); return wrapper;
}
function button(wrapper: VueWrapper, text: string) { return wrapper.findAll("button").find((b) => b.text() === text)!; }
async function click(wrapper: VueWrapper, text: string) { await button(wrapper, text).trigger("click"); await flushPromises(); }

describe("收件匣元件與真 store", () => {
  it("同一次改字後，收件匣只有配對列、徽章只算配對，AI 推薦有新詞", async () => {
    const store = useVocabularyStore();
    await store.recordCorrections([{ term: "陳泰呈", misheard: "陳太誠" }]);
    const wrapper = render();
    expect(state.connection.prepare("SELECT is_reviewed FROM vocabulary WHERE term = ?").get("陳泰呈")).toMatchObject({ is_reviewed: 1 });
    expect(store.aiSuggestedTermList.map((entry) => entry.term)).toEqual(["陳泰呈"]);
    expect(await store.getAiTermList("陳泰呈")).toEqual(["陳泰呈"]);
    expect(store.inboxTermList).toEqual([]);
    expect(wrapper.findAll("[data-inbox-term]")).toHaveLength(0);
    expect(wrapper.findAll("[data-inbox-replacement]")).toHaveLength(1);
    expect(wrapper.get("[data-inbox-replacement]").text()).toContain("聽成「陳太誠」→ 改成「陳泰呈」");
    expect(store.suggestedReplacementList[0]).toMatchObject({ term: "陳泰呈", misheard: "陳太誠", status: "suggested" });
    expect(store.inboxCount).toBe(1);
  });
  it.each([ ["empty", 0, 0], ["term", 1, 0], ["pair", 0, 1], ["both", 1, 1] ] as const)("四態：%s", async (kind, terms, pairs) => {
    const store = await seed(kind); const wrapper = render();
    expect(wrapper.findAll("[data-inbox-term]")).toHaveLength(terms);
    expect(wrapper.findAll("[data-inbox-replacement]")).toHaveLength(pairs);
    expect(store.inboxCount).toBe(terms + pairs);
    if (kind === "empty") {
      expect(wrapper.text()).toBe(i18n.global.t("dictionary.inbox.empty"));
      expect(wrapper.find("button").exists()).toBe(false);
    } else expect(wrapper.text()).toContain("Tauri");
    if (pairs) expect(wrapper.text()).toContain("聽成「陶里」→ 改成「Tauri」");
  });
  it("保留只消掉新詞列與一個徽章，配對與主列表總數都在", async () => {
    const store = await seed("both"); const wrapper = render(DictionaryView); await flushPromises();
    expect(store.termCount).toBe(1); expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    await click(wrapper, "保留");
    expect(wrapper.findAll("[data-inbox-term]")).toHaveLength(0);
    expect(wrapper.findAll("[data-inbox-replacement]")).toHaveLength(1);
    expect(store.inboxCount).toBe(1); expect(store.termCount).toBe(1);
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  });
  it("刪除減總數與配對；toast復原讓兩者回來", async () => {
    const store = await seed("both"); const wrapper = render(DictionaryView); await flushPromises();
    await click(wrapper, "刪除"); expect(store.termCount).toBe(0); expect(store.inboxCount).toBe(0);
    expect(wrapper.findAll("tbody tr")).toHaveLength(0);
    const options = state.toast.mock.calls[0][1]; expect(options.action.label).toBe("復原");
    options.action.onClick(); await flushPromises();
    expect(store.termCount).toBe(1); expect(store.inboxCount).toBe(2);
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(state.toast).toHaveBeenLastCalledWith("已復原");
  });
  it("同名復原衝突：顯示未復原且保留新資料，不顯示成功", async () => {
    const store = await seed("both"); const wrapper = render();
    await click(wrapper, "刪除"); const undo = state.toast.mock.calls[0][1].action.onClick;
    await store.addTerm("tauri"); const current = store.termList[0];
    undo(); await flushPromises();
    expect(state.toastError).toHaveBeenCalledWith("已有同名詞，未復原");
    expect(store.termList[0]).toEqual(current); expect(state.toast).toHaveBeenCalledTimes(1);
  });
  it("刪除後離開詞庫頁，再學到同名詞，復原錯誤仍由全域 toast 顯示", async () => {
    const store = await seed("both"); const wrapper = render();
    await click(wrapper, "刪除"); const undo = state.toast.mock.calls[0][1].action.onClick;
    wrapper.unmount(); wrappers = [];
    await store.recordCorrections([{ term: "tauri", misheard: "重學" }]);
    const current = store.termList[0];
    undo(); await flushPromises();
    expect(state.toastError).toHaveBeenCalledWith("已有同名詞，未復原");
    expect(store.termList[0]).toEqual(current); expect(state.toast).toHaveBeenCalledTimes(1);
  });
  it.each(["套用", "不要"])("配對操作：%s；不會把新詞標已檢視", async (label) => {
    const store = await seed("both"); const wrapper = render();
    await click(wrapper, label);
    expect(store.inboxCount).toBe(1); expect(wrapper.findAll("[data-inbox-term]")).toHaveLength(1);
    expect(wrapper.findAll("[data-inbox-replacement]")).toHaveLength(0);
    expect(await store.getAiTermList("陶里")).toEqual(label === "套用" ? ["Tauri (陶里 → Tauri)"] : []);
  });
  it("操作失敗留在原處顯示原因，之後可重試", async () => {
    const store = await seed("term"); const wrapper = render();
    vi.spyOn(store, "markTermReviewed").mockRejectedValueOnce(new Error("disk full"));
    await click(wrapper, "保留");
    expect(wrapper.get('[role="alert"]').text()).toBe("disk full");
    await click(wrapper, "保留"); expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(store.inboxCount).toBe(0);
  });
  it("別的視窗已刪除，不產生空的復原 toast", async () => {
    const store = await seed("term"); const wrapper = render();
    state.connection.exec("DELETE FROM vocabulary");
    await click(wrapper, "刪除"); expect(state.toast).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    // 沿用跨視窗變更事件入口來刷新消失的列。
    await store.fetchTermList(); expect(store.inboxCount).toBe(0);
  });
});

describe("MainApp 側欄徽章", () => {
  async function renderMain() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/records", component: { template: "<p>記錄頁</p>" } }, { path: "/dictionary", component: DictionaryView }] });
    await router.push("/records");
    const slot = { template: "<div><slot /></div>" };
    const wrapper = mount(MainApp, { global: { plugins: [i18n, router], stubs: {
      SidebarProvider: slot, Sidebar: slot, SidebarHeader: slot, SidebarContent: slot,
      SidebarGroup: slot, SidebarGroupContent: slot, SidebarMenu: slot, SidebarMenuItem: slot,
      SidebarMenuButton: slot, SidebarInset: slot, SidebarFooter: slot,
      SidebarStatus: true, SiteHeader: true, AccessibilityGuide: true,
    } } });
    wrappers.push(wrapper); await flushPromises(); return wrapper;
  }
  it("冷啟動停在記錄頁，reviewed詞＋suggested配對也顯示1；只有配對變動也刷新", async () => {
    await seed("pair");
    setActivePinia(createPinia()); // 清空記憶體，資料仍在 DB。
    const store = useVocabularyStore(); expect(store.inboxCount).toBe(0);
    const wrapper = await renderMain();
    expect(wrapper.text()).toContain("記錄頁");
    expect(wrapper.get('[data-testid="vocabulary-inbox-count"]').text()).toBe("1");
    state.connection.exec("UPDATE vocabulary_replacements SET status='applied'");
    state.listeners.get("vocabulary:changed")!({ payload: { action: "added", term: "" } });
    await flushPromises(); expect(wrapper.find('[data-testid="vocabulary-inbox-count"]').exists()).toBe(false);
    state.connection.exec("UPDATE vocabulary_replacements SET status='suggested'");
    state.listeners.get("vocabulary:changed")!({ payload: { action: "added", term: "" } });
    await flushPromises(); expect(wrapper.get('[data-testid="vocabulary-inbox-count"]').text()).toBe("1");
  });
  it("冷啟動載入詞庫失敗仍可掛載記錄頁，不留下未處理 rejection", async () => {
    const store = useVocabularyStore();
    let fetchCalls = 0;
    // 不用 mockRejectedValue：spy 會為 settledResults 掛上拒絕處理，掩蓋未處理 rejection。
    store.fetchTermList = async () => { fetchCalls += 1; throw new Error("database unavailable"); };
    const wrapper = await renderMain();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCalls).toBe(1); expect(wrapper.text()).toContain("記錄頁");
    expect(wrapper.find('[data-testid="vocabulary-inbox-count"]').exists()).toBe(false);
  });
});


describe("收件匣五語系", () => {
  it("key 與插值對齊，長詞完整顯示", async () => {
    const localeMessages = i18n.global.messages.value;
    const expected = Object.keys(localeMessages["zh-TW"].dictionary.inbox).sort();
    const store = await seed("both");
    const longTerm = "Tauri".repeat(40);
    store.termList[0].term = longTerm;
    store.suggestedReplacementList[0].term = longTerm;
    const wrapper = render();
    for (const locale of ["zh-TW", "zh-CN", "en", "ja", "ko"] as const) {
      const inbox = localeMessages[locale].dictionary.inbox;
      expect(Object.keys(inbox).sort()).toEqual(expected);
      expect(inbox.replacement.match(/\{\w+\}/g)?.sort()).toEqual(["{misheard}", "{term}"]);
      expect(Object.values(inbox).every((text) => text.trim().length > 0)).toBe(true);
      i18n.global.locale.value = locale; await nextTick();
      expect(wrapper.text()).toContain(inbox.title);
      expect(wrapper.get("[data-inbox-term]").text()).toContain(longTerm);
      expect(wrapper.get("[data-inbox-replacement]").text()).toContain(longTerm);
    }
  });
});
