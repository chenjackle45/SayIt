import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import DashboardView from "../../src/views/DashboardView.vue";

vi.mock("../../src/composables/useTauriEvents", () => ({
  listenToEvent: vi.fn().mockResolvedValue(vi.fn()),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

let settingsState: Record<string, unknown>;
let historyState: Record<string, unknown>;

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsState,
}));

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => historyState,
}));

function makeHistory(usage: Record<string, number> = {}) {
  return {
    dashboardStats: {
      totalRecordingDurationMs: 0,
      totalCharacters: 0,
      estimatedTimeSavedMs: 0,
      totalTranscriptions: 0,
      dailyQuotaUsage: {
        whisperRequestCount: 0,
        whisperBilledAudioMs: 0,
        llmRequestCount: 0,
        llmTotalTokens: 0,
        vocabularyAnalysisRequestCount: 0,
        vocabularyAnalysisTotalTokens: 0,
        ...usage,
      },
    },
    dailyUsageTrendList: [],
    recentTranscriptionList: [],
    refreshDashboard: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    selectedLlmProviderId: "groq",
    selectedWhisperModelId: "whisper-large-v3",
    selectedLlmModelId: "llama-3.3-70b-versatile",
    ...overrides,
  };
}

const passThroughStub = { template: "<div><slot /></div>" };

// renderTooltip=false 時 TooltipContent 不渲染 slot → 只測「卡片主體」；
// renderTooltip=true 時渲染 tooltip 內容 → 測 tooltip 行為。
function mountDashboard(renderTooltip = false) {
  return mount(DashboardView, {
    global: {
      plugins: [i18n],
      stubs: {
        DashboardUsageChart: true,
        TooltipProvider: passThroughStub,
        Tooltip: passThroughStub,
        TooltipTrigger: passThroughStub,
        TooltipContent: renderTooltip ? passThroughStub : { template: "<div />" },
      },
    },
  });
}

describe("DashboardView 額度卡片", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh-TW";
    historyState = makeHistory({ whisperRequestCount: 10, llmRequestCount: 5 });
  });

  it("[P0] 全免費 provider：主體顯示剩餘免費額度百分比，無計費標籤", () => {
    settingsState = makeSettings();
    const text = mountDashboard().text();

    expect(text).toContain("今日剩餘免費額度");
    expect(text).toContain("%");
    expect(text).not.toContain("計費");
    expect(text).not.toContain("今日用量");
  });

  it("[P0] 混用（免費 Whisper + 計費 OpenAI LLM）：主體同時顯示免費 % 與付費 LLM 用量行，但不含無額度提示", () => {
    settingsState = makeSettings({
      selectedLlmProviderId: "openai",
    });
    historyState = makeHistory({
      whisperRequestCount: 10,
      llmRequestCount: 8,
      llmTotalTokens: 4500,
    });
    const text = mountDashboard().text();

    expect(text).toContain("今日剩餘免費額度");
    expect(text).toContain("%");
    expect(text).toContain("計費");
    // 付費 LLM 用量行（含實際數字）出現在卡片主體（不再只在 tooltip）
    expect(text).toContain("LLM：8 次 · 4,500 tokens");
    // 混用主體不應顯示「無免費額度」提示（與免費 % 矛盾）
    expect(text).not.toContain("付費方案 — 無免費額度限制");
    expect(text).not.toContain("Infinity");
  });

  it("[P0] 混用 tooltip 仍保留付費用量與無額度提示", () => {
    settingsState = makeSettings({
      selectedLlmProviderId: "openai",
    });
    historyState = makeHistory({ llmRequestCount: 8, llmTotalTokens: 4500 });
    // renderTooltip=true → tooltip 內容會被渲染
    const text = mountDashboard(true).text();

    expect(text).toContain("付費方案 — 無免費額度限制");
    expect(text).toContain("LLM");
  });
});
