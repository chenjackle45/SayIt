import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import i18n from "../../src/i18n";
import RecordsView from "../../src/views/RecordsView.vue";
import type { TranscriptionRecord } from "../../src/types/transcription";

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(vi.fn()),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

// v0.16 #7：成功回饋改 toast
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("vue-sonner", () => ({ toast: { success: toastSuccess } }));

// 視窗寬度：預設寬版；窄版測試改成 true
const narrowFlag = ref(false);
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vueuse/core")>()),
  useMediaQuery: () => narrowFlag,
}));

let historyState: Record<string, unknown>;
let settingsState: Record<string, unknown>;

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => historyState,
}));
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

// IntersectionObserver：保留 callback 讓測試能模擬 sentinel 可見
let ioCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
let observeCount = 0;
class IOStub {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    ioCallback = cb;
  }
  observe() {
    observeCount += 1;
  }
  unobserve() {}
  disconnect() {}
}

function createRecord(overrides: Partial<TranscriptionRecord> = {}): TranscriptionRecord {
  return {
    id: "rec-1",
    timestamp: Date.now() - 60_000,
    rawText: "原始文字內容",
    processedText: null,
    recordingDurationMs: 3000,
    transcriptionDurationMs: 280,
    enhancementDurationMs: null,
    charCount: 6,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: "C:/rec/rec-1.wav",
    status: "success",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  };
}

function makeHistory(records: TranscriptionRecord[], usage: Record<string, number> = {}) {
  return reactive({
    transcriptionList: records,
    isLoading: false,
    hasMore: false,
    searchQuery: "",
    resetAndFetch: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    refreshDashboard: vi.fn().mockResolvedValue(undefined),
    deleteTranscription: vi.fn().mockResolvedValue(undefined),
    retryingId: null as string | null,
    retryingAction: null as string | null,
    retranscribeRecord: vi.fn().mockResolvedValue({ ok: true }),
    reEnhanceRecord: vi.fn().mockResolvedValue({ ok: true }),
    dashboardStats: {
      totalTranscriptions: 0,
      totalCharacters: 0,
      totalRecordingDurationMs: 0,
      todayTranscriptions: 3,
      todayCharacters: 120,
      weekCharacters: 900,
      estimatedTimeSavedMs: 0,
      dailyQuotaUsage: {
        whisperRequestCount: 10,
        whisperBilledAudioMs: 0,
        llmRequestCount: 5,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
        ...usage,
      },
    },
  });
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    selectedLlmProviderId: "groq",
    selectedWhisperModelId: "whisper-large-v3",
    selectedLlmModelId: "llama-3.3-70b-versatile",
    ...overrides,
  };
}

const passThrough = { template: "<div><slot /></div>" };
const ButtonStub = {
  name: "Button",
  inheritAttrs: false,
  template: '<button v-bind="$attrs"><slot /></button>',
};
// 選單項目：直接渲染、點擊觸發 select（reka 的事件名）
const MenuItemStub = {
  props: ["disabled", "variant"],
  emits: ["select"],
  template: '<button :disabled="disabled || undefined" @click="$emit(\'select\')"><slot /></button>',
};

function mountRecords(renderTooltip = false) {
  return mount(RecordsView, {
    attachTo: document.body,
    global: {
      plugins: [i18n],
      stubs: {
        Button: ButtonStub,
        TooltipProvider: passThrough,
        Tooltip: passThrough,
        TooltipTrigger: passThrough,
        TooltipContent: renderTooltip ? passThrough : { template: "<div />" },
        DropdownMenu: passThrough,
        DropdownMenuTrigger: passThrough,
        DropdownMenuContent: passThrough,
        DropdownMenuSeparator: true,
        DropdownMenuItem: MenuItemStub,
      },
    },
  });
}

beforeEach(() => {
  narrowFlag.value = false;
  observeCount = 0;
  i18n.global.locale.value = "zh-TW";
  vi.stubGlobal("IntersectionObserver", IOStub);
  invokeMock.mockClear();
  settingsState = makeSettings();
});

describe("RecordsView 清單與分組", () => {
  it("[P1] 依日期分組、預設選第一筆並在細節窗格顯示", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    historyState = makeHistory([
      createRecord({ id: "a", processedText: "今天這句", wasEnhanced: true }),
      createRecord({ id: "b", timestamp: yesterday.getTime(), rawText: "昨天那句" }),
    ]);
    const wrapper = mountRecords();
    await flushPromises();

    const text = wrapper.find('[data-testid="records-list"]').text();
    expect(text).toContain("今天");
    expect(text).toContain("昨天");
    expect(wrapper.find('[data-testid="detail-text"]').text()).toBe("今天這句");
    wrapper.unmount();
  });

  it("[P1] ↓ 移動選取、Enter 複製選中那筆", async () => {
    historyState = makeHistory([
      createRecord({ id: "a", rawText: "第一句" }),
      createRecord({ id: "b", rawText: "第二句" }),
    ]);
    const wrapper = mountRecords();
    await flushPromises();
    const list = wrapper.find('[data-testid="records-list"]');

    await list.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.find('[data-testid="detail-text"]').text()).toBe("第二句");
    toastSuccess.mockClear();
    await list.trigger("keydown", { key: "Enter" });
    expect(invokeMock).toHaveBeenCalledWith("copy_to_clipboard", { text: "第二句" });
    await flushPromises();
    expect(toastSuccess).toHaveBeenCalledWith("已複製");
    wrapper.unmount();
  });

  it("[P1] IME 組字中的 Enter 不複製", async () => {
    historyState = makeHistory([createRecord({ rawText: "第一句" })]);
    const wrapper = mountRecords();
    await flushPromises();

    await wrapper.find('[data-testid="records-list"]').trigger("keydown", { key: "Enter", isComposing: true });
    expect(invokeMock).not.toHaveBeenCalledWith("copy_to_clipboard", expect.anything());
    wrapper.unmount();
  });

  it("[P1] sentinel 補完一頁後重新量測，仍可見才再補下一頁", async () => {
    historyState = makeHistory([createRecord()]);
    historyState.hasMore = true;
    const wrapper = mountRecords();
    await flushPromises();

    ioCallback?.([{ isIntersecting: true }]);
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(1);
    expect(observeCount).toBeGreaterThanOrEqual(2); // 補完後重新 observe

    // observer 依新版面回報「仍可見」（第一頁填不滿）→ 再補一頁
    ioCallback?.([{ isIntersecting: true }]);
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(2);

    // 沒有新回報就不會自己一直補
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("[P0] 補頁失敗就停住，按「重試載入」才恢復", async () => {
    historyState = makeHistory([createRecord()]);
    historyState.hasMore = true;
    historyState.loadMore = vi.fn(async () => {
      historyState.isLoading = true;
      await Promise.resolve();
      historyState.isLoading = false;
      throw new Error("db busy");
    });
    const wrapper = mountRecords();
    await flushPromises();

    ioCallback?.([{ isIntersecting: true }]);
    await flushPromises();
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(1);

    // 捲離再捲回不會自動重試；按「重試載入」才恢復
    ioCallback?.([{ isIntersecting: false }]);
    await flushPromises();
    ioCallback?.([{ isIntersecting: true }]);
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(1);
    await wrapper.find('[data-testid="retry-load-more"]').trigger("click");
    await flushPromises();
    expect(historyState.loadMore).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("[P1] 列內重試鈕上的 Enter 不會被清單攔去複製別筆", async () => {
    historyState = makeHistory([
      createRecord({ id: "ok", rawText: "選中的成功記錄" }),
      createRecord({ id: "f", status: "failed", rawText: "" }),
    ]);
    const wrapper = mountRecords();
    await flushPromises();

    await wrapper.find('[data-testid="row-retry"]').trigger("keydown", { key: "Enter" });
    expect(invokeMock).not.toHaveBeenCalledWith("copy_to_clipboard", expect.anything());
    wrapper.unmount();
  });

  it("[P1] 有文字選取時 ↑↓ 不切換記錄", async () => {
    historyState = makeHistory([
      createRecord({ id: "a", rawText: "第一句" }),
      createRecord({ id: "b", rawText: "第二句" }),
    ]);
    const wrapper = mountRecords();
    await flushPromises();
    const detail = wrapper.find('[data-testid="detail-text"]').element;
    const range = document.createRange();
    range.selectNodeContents(detail);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    await wrapper.find('[data-testid="records-list"]').trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.find('[data-testid="detail-text"]').text()).toBe("第一句");
    window.getSelection()?.removeAllRanges();
    wrapper.unmount();
  });

  it("[P1] 窄視窗：細節收成抽屜，點列或切換鈕才打開", async () => {
    narrowFlag.value = true;
    historyState = makeHistory([createRecord({ id: "a", rawText: "第一句" })]);
    const wrapper = mountRecords();
    await flushPromises();
    const detail = () => wrapper.find('[data-testid="records-detail"]').element as HTMLElement;

    expect(detail().style.display).toBe("none");
    await wrapper.find('[data-record-id="a"]').trigger("click");
    expect(detail().style.display).toBe("");
    await wrapper.find('[data-testid="detail-toggle"]').trigger("click");
    expect(detail().style.display).toBe("none");
    wrapper.unmount();
  });

  it("[P1] 刪除後選取退回現存第一筆並刷新統計", async () => {
    historyState = makeHistory([
      createRecord({ id: "a", rawText: "第一句" }),
      createRecord({ id: "b", rawText: "第二句" }),
    ]);
    historyState.deleteTranscription = vi.fn(async (id: string) => {
      historyState.transcriptionList = (historyState.transcriptionList as TranscriptionRecord[]).filter((r) => r.id !== id);
    });
    const wrapper = mountRecords();
    await flushPromises();
    (historyState.refreshDashboard as ReturnType<typeof vi.fn>).mockClear();

    await wrapper.find('[data-testid="detail-delete"]').trigger("click");
    await flushPromises();
    expect(historyState.deleteTranscription).toHaveBeenCalledWith("a");
    expect(toastSuccess).toHaveBeenCalledWith("已刪除");
    expect(wrapper.find('[data-testid="detail-text"]').text()).toBe("第二句");
    expect(historyState.refreshDashboard).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("RecordsView 重試（沿用歷史頁的禁用條件）", () => {
  async function mountWith(record: TranscriptionRecord) {
    historyState = makeHistory([record]);
    const wrapper = mountRecords();
    await flushPromises();
    return wrapper;
  }

  it("[P1] 有錄音檔與原文 → 重新辨識、重新整理皆可用", async () => {
    const wrapper = await mountWith(createRecord({ rawText: "有原文" }));
    expect(wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-testid="reenhance-button"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("[P1] 無錄音檔 → 重新辨識 disabled、重新整理仍可用", async () => {
    const wrapper = await mountWith(createRecord({ audioFilePath: null, rawText: "有原文" }));
    expect(wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="reenhance-button"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("[P1] 編輯模式紀錄 → 兩者都 disabled（都會毀掉編輯結果）", async () => {
    const wrapper = await mountWith(
      createRecord({ rawText: "改成正式語氣", processedText: "編輯結果", isEditMode: true }),
    );
    expect(wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="reenhance-button"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("[P1] store 有重試在途 → 兩者都 disabled（鎖在 store）", async () => {
    historyState = makeHistory([createRecord({ rawText: "有原文" })]);
    historyState.retryingId = "other-record";
    historyState.retryingAction = "enhance";
    const wrapper = mountRecords();
    await flushPromises();
    expect(wrapper.find('[data-testid="retranscribe-button"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="reenhance-button"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("[P1] 點重新辨識／重新整理呼叫 store，成功後刷新統計", async () => {
    const record = createRecord({ rawText: "可整理的原文" });
    const wrapper = await mountWith(record);
    (historyState.refreshDashboard as ReturnType<typeof vi.fn>).mockClear();
    toastSuccess.mockClear();

    await wrapper.find('[data-testid="retranscribe-button"]').trigger("click");
    await flushPromises();
    expect(toastSuccess).toHaveBeenLastCalledWith("已重新辨識");
    await wrapper.find('[data-testid="reenhance-button"]').trigger("click");
    await flushPromises();
    expect(toastSuccess).toHaveBeenLastCalledWith("已重新整理");
    expect(historyState.retranscribeRecord).toHaveBeenCalledTimes(1);
    expect(historyState.reEnhanceRecord).toHaveBeenCalledTimes(1);
    expect(historyState.refreshDashboard).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("[P1] 失敗記錄：有錄音 → 細節與清單都能重試；無錄音 → 不能重試並說明", async () => {
    const withAudio = await mountWith(createRecord({ status: "failed", rawText: "" }));
    expect(withAudio.find('[data-testid="failed-box"]').text()).toContain("錄音還在");
    expect(withAudio.find('[data-testid="detail-retry"]').attributes("disabled")).toBeUndefined();
    withAudio.unmount();

    const noAudio = await mountWith(createRecord({ status: "failed", rawText: "", audioFilePath: null }));
    expect(noAudio.find('[data-testid="failed-box"]').text()).toContain("無法重試");
    expect(noAudio.find('[data-testid="detail-retry"]').attributes("disabled")).toBeDefined();
    noAudio.unmount();
  });

  it("[P2] 未選中的失敗列顯示列內重試，按下即重新辨識該筆", async () => {
    const failed = createRecord({ id: "f", status: "failed", rawText: "" });
    historyState = makeHistory([createRecord({ id: "ok" }), failed]);
    const wrapper = mountRecords();
    await flushPromises();

    await wrapper.find('[data-testid="row-retry"]').trigger("click");
    expect(historyState.retranscribeRecord).toHaveBeenCalledWith(failed);
    wrapper.unmount();
  });
});

describe("RecordsView 統計列", () => {
  it("[P1] 顯示今天、本週與全免費的剩餘額度，無計費標籤", async () => {
    historyState = makeHistory([]);
    const wrapper = mountRecords();
    await flushPromises();
    const text = wrapper.find('[data-testid="records-stats"]').text();
    expect(text).toContain("今天 3 句・120 字");
    expect(text).toContain("本週 900 字");
    expect(text).toContain("免費額度 剩");
    expect(text).not.toContain("計費");
    wrapper.unmount();
  });

  it("[P1] 混用（免費 Whisper＋計費 OpenAI）：仍顯示免費額度並標計費，明細含付費用量", async () => {
    settingsState = makeSettings({ selectedLlmProviderId: "openai" });
    historyState = makeHistory([], { llmRequestCount: 8, llmTotalTokens: 4500 });
    const wrapper = mountRecords(true);
    await flushPromises();
    const text = wrapper.find('[data-testid="records-stats"]').text();
    expect(text).toContain("免費額度 剩");
    expect(text).toContain("計費");
    expect(text).toContain("LLM：8 次 · 4,500 tokens");
    expect(text).toContain("付費方案 — 無免費額度限制");
    expect(text).not.toContain("Infinity");
    wrapper.unmount();
  });

  it("[P1] 累計明細保留原儀表板五項", async () => {
    historyState = makeHistory([]);
    const wrapper = mountRecords(true);
    await flushPromises();
    const text = wrapper.find('[data-testid="records-stats"]').text();
    for (const label of ["總口述時間", "口述字數", "節省時間", "總使用次數", "平均每次字數"]) {
      expect(text).toContain(label);
    }
    wrapper.unmount();
  });
});
