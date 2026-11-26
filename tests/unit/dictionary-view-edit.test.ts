/**
 * #81 字典頁搜尋＋行內編輯：元件層回歸測試。
 * 改寫自實作閘 R1（codex）的暫存重現測試；後三條原為錯誤重現，斷言改成修正後行為。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import DictionaryView from "../../src/views/DictionaryView.vue";
import { useVocabularyStore } from "../../src/stores/useVocabularyStore";
import i18n from "../../src/i18n";

const { execute, select, emit, toastSuccess } = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  emit: vi.fn(),
  toastSuccess: vi.fn(),
}));
// v0.16 #7：成功回饋改 toast
vi.mock("vue-sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({ execute, select }),
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({ isSmartDictionaryEnabled: true }),
}));
vi.mock("@tauri-apps/api/event", () => ({ emit }));

interface Row {
  id: string;
  term: string;
  source: string;
  weight: number;
  created_at: string;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let rows: Row[];
let wrappers: VueWrapper[] = [];

function row(id: string, term: string, source = "manual"): Row {
  return { id, term, source, weight: 7, created_at: "2026-11-16 00:00:00" };
}
function editInput(wrapper: VueWrapper) {
  return wrapper.find("tbody input");
}
function editButton(wrapper: VueWrapper, index = 0) {
  return wrapper.findAll('button[title="編輯"]')[index];
}
function searchInput(wrapper: VueWrapper) {
  return wrapper.find('input[placeholder="搜尋詞彙…"]');
}

async function render() {
  const pinia = createPinia();
  setActivePinia(pinia);
  i18n.global.locale.value = "zh-TW";
  const wrapper = mount(DictionaryView, {
    attachTo: document.body,
    global: { plugins: [pinia, i18n] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, store: useVocabularyStore() };
}

beforeEach(() => {
  // AI 表在前：編輯鈕 0＝AI Gamma、1＝Alpha、2＝Beta
  rows = [row("a", "Alpha"), row("b", "Beta"), row("c", "AI Gamma", "ai")];
  execute.mockReset().mockImplementation(async (_sql: string, params: string[]) => {
    const [term, id] = params;
    const found = rows.find((r) => r.id === id);
    if (found) found.term = term;
  });
  select.mockReset().mockImplementation(async () => structuredClone(rows));
  emit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  document.body.innerHTML = "";
});

describe("DictionaryView 搜尋＋編輯（#81）", () => {
  it("按鉛筆：編輯框出現、預填原詞、取得焦點", async () => {
    const { wrapper } = await render();
    await editButton(wrapper).trigger("click");
    await nextTick();
    expect(editInput(wrapper).element).toBe(document.activeElement);
    expect((editInput(wrapper).element as HTMLInputElement).value).toBe("AI Gamma");
  });

  it("輸入法組字中 Enter／Esc 不存檔也不取消；組字結束後 Esc 才取消", async () => {
    const { wrapper } = await render();
    await editButton(wrapper).trigger("click");
    await editInput(wrapper).setValue("AI New");
    await editInput(wrapper).trigger("keydown", { key: "Enter", isComposing: true });
    await editInput(wrapper).trigger("keydown", { key: "Escape", isComposing: true });
    expect(execute).not.toHaveBeenCalled();
    expect(editInput(wrapper).exists()).toBe(true);
    await editInput(wrapper).trigger("keydown", { key: "Escape" });
    expect(editInput(wrapper).exists()).toBe(false);
  });

  it("macOS WebKit 組字結束後補送的 Enter（keyCode 229、isComposing false）不存檔；之後一般 Enter 才存", async () => {
    const { wrapper } = await render();
    await editButton(wrapper).trigger("click");
    await editInput(wrapper).setValue("AI New");
    // 2026-11-26 Safari＋注音實測順序：Enter(229, composing) → compositionend → Enter(229, 非 composing)
    await editInput(wrapper).trigger("keydown", { key: "Enter", keyCode: 229, isComposing: true });
    await editInput(wrapper).trigger("compositionend", { data: "你" });
    await editInput(wrapper).trigger("keydown", { key: "Enter", keyCode: 229, isComposing: false });
    await editInput(wrapper).trigger("keydown", { key: "Escape", keyCode: 229, isComposing: false });
    expect(execute).not.toHaveBeenCalled();
    expect(editInput(wrapper).exists()).toBe(true);
    await editInput(wrapper).trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("新增詞框：組字中與 macOS WebKit 補送的 Enter（keyCode 229）不新增；之後一般 Enter 才新增", async () => {
    const { wrapper } = await render();
    const addInput = wrapper.find(`input[placeholder="${i18n.global.t("dictionary.inputPlaceholder")}"]`);
    await addInput.setValue("你");
    // 只帶 isComposing（keyCode 正常）也要擋：單獨守住 isComposing 判斷
    await addInput.trigger("keydown", { key: "Enter", keyCode: 13, isComposing: true });
    await addInput.trigger("keydown", { key: "Enter", keyCode: 229, isComposing: true });
    await addInput.trigger("compositionend", { data: "你" });
    await addInput.trigger("keydown", { key: "Enter", keyCode: 229, isComposing: false });
    await flushPromises();
    expect(execute).not.toHaveBeenCalled();
    await addInput.trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain("INSERT INTO vocabulary");
  });

  it("搜尋同時篩兩張表；清空後編輯列回來但不搶走搜尋框焦點、草稿保留", async () => {
    const { wrapper } = await render();
    await editButton(wrapper, 1).trigger("click");
    await editInput(wrapper).setValue("Alpha Draft");
    const search = searchInput(wrapper);
    (search.element as HTMLInputElement).focus();
    await search.setValue("not-found");
    expect(wrapper.findAll("tbody tr")).toHaveLength(0);
    expect(wrapper.text().match(/沒有符合的詞/g)).toHaveLength(2);
    await search.setValue("");
    expect(document.activeElement).toBe(search.element);
    expect((editInput(wrapper).element as HTMLInputElement).value).toBe("Alpha Draft");
    expect(wrapper.findAll("tbody tr")).toHaveLength(3);
  });

  it("重複詞：顯示錯誤、不寫 DB、草稿保留", async () => {
    const { wrapper } = await render();
    await editButton(wrapper, 1).trigger("click");
    await editInput(wrapper).setValue(" beta ");
    await wrapper.find('button[title="儲存"]').trigger("click");
    await flushPromises();
    expect(execute).not.toHaveBeenCalled();
    expect((editInput(wrapper).element as HTMLInputElement).value).toBe(" beta ");
    expect(wrapper.text()).toContain(i18n.global.t("dictionary.duplicateEntry"));
  });

  it("存檔期間鎖住編輯：鉛筆、取消停用、輸入框唯讀、Esc 無效；存完關閉編輯框", async () => {
    // 實作閘 R1–R3 的五個情境（存檔中切列、取消重編、續打、組字、別列組字）
    // 都源自「存檔中仍可編輯」，改成存檔期間鎖住一次消掉
    const { wrapper } = await render();
    const pending = deferred();
    execute.mockImplementationOnce(() => pending.promise);
    await editButton(wrapper, 1).trigger("click");
    await editInput(wrapper).setValue("Alpha Saved");
    await wrapper.find('button[title="儲存"]').trigger("click");

    for (const button of wrapper.findAll('button[title="編輯"]')) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.find('button[title="取消"]').attributes("disabled")).toBeDefined();
    expect(editInput(wrapper).attributes("readonly")).toBeDefined();
    await editInput(wrapper).trigger("keydown", { key: "Escape" });
    expect(editInput(wrapper).exists()).toBe(true);

    rows.find((r) => r.id === "a")!.term = "Alpha Saved";
    pending.resolve();
    await flushPromises();
    expect(editInput(wrapper).exists()).toBe(false);
    expect(wrapper.find('button[title="編輯"]').attributes("disabled")).toBeUndefined();
  });

  it("正常存檔：送出 UPDATE、關閉編輯框、顯示新舊詞", async () => {
    const { wrapper } = await render();
    await editButton(wrapper).trigger("click");
    await editInput(wrapper).setValue("AI New");
    await editInput(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(execute).toHaveBeenCalledWith(
      "UPDATE vocabulary SET term = $1, source = 'manual' WHERE id = $2",
      ["AI New", "c"],
    );
    expect(editInput(wrapper).exists()).toBe(false);
    expect(toastSuccess).toHaveBeenCalledWith("已將「AI Gamma」改為「AI New」");
  });

  it("清單重抓（別的視窗改字典）時不把焦點從搜尋框拉回編輯框", async () => {
    const { wrapper, store } = await render();
    await editButton(wrapper, 1).trigger("click");
    const search = searchInput(wrapper);
    (search.element as HTMLInputElement).focus();
    await search.setValue("alp");
    const pending = deferred<Row[]>();
    select.mockImplementationOnce(() => pending.promise);
    const fetching = store.fetchTermList();
    await nextTick();
    pending.resolve(structuredClone(rows));
    await fetching;
    await nextTick();
    expect(document.activeElement).toBe(search.element);
  });
});
