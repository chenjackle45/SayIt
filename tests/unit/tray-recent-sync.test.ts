import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import type { TranscriptionRecord } from "../../src/types/transcription";

// 選單列最近 5 句（v0.16 #6）：每條落地路徑都要刷新 Rust 端選單

const h = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
  mockInvoke: vi.fn(),
  mockEnhanceGuard: vi.fn(),
  listeners: new Map<string, () => void>(),
  settingsStub: {
    getApiKey: () => "whisper-key",
    refreshApiKey: vi.fn().mockResolvedValue(undefined),
    selectedWhisperModelId: "whisper-large-v3-turbo",
    getWhisperLanguageCode: () => "zh",
    selectedTranscriptionLocale: "en",
    selectedLocale: "en",
    refreshLlmApiKey: vi.fn().mockResolvedValue(undefined),
    getLlmApiKey: () => "llm-key",
    selectedLlmModelId: "llama-3.3-70b-versatile",
    getAiPrompt: () => "prompt",
    getAiPromptLocale: () => "ja",
  },
}));

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({ execute: h.mockDbExecute, select: h.mockDbSelect }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.mockInvoke }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  emitToWindow: vi.fn().mockResolvedValue(undefined),
  listenToEvent: vi.fn(async (name: string, cb: () => void) => {
    h.listeners.set(name, cb);
    return () => {};
  }),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/lib/enhancer", () => ({ enhanceWithAnomalyGuard: h.mockEnhanceGuard }));
vi.mock("../../src/lib/transcriptTextTransforms", () => ({
  applyTranscriptTextTransforms: (text: string) => text,
}));
vi.mock("../../src/stores/useSettingsStore", () => ({ useSettingsStore: () => h.settingsStub }));
vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({ getWhisperTermList: vi.fn().mockResolvedValue([]), getAiTermList: vi.fn().mockResolvedValue([]) }),
}));

import i18n from "../../src/i18n";
import { useHistoryStore } from "../../src/stores/useHistoryStore";

function createRecord(overrides: Partial<TranscriptionRecord> = {}): TranscriptionRecord {
  return {
    id: "rec-1",
    timestamp: 1700000000000,
    rawText: "原始口語內容",
    processedText: null,
    recordingDurationMs: 3000,
    transcriptionDurationMs: 0,
    enhancementDurationMs: null,
    charCount: 0,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: "/rec/rec-1.wav",
    status: "success",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  };
}

const trayCalls = () => h.mockInvoke.mock.calls.filter(([cmd]) => cmd === "update_tray_recent");

describe("選單列最近 5 句刷新", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    h.listeners.clear();
    h.mockDbExecute.mockReset().mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    h.mockDbSelect.mockReset().mockResolvedValue([
      { id: "a", raw_text: "原文 A", processed_text: "整理後 A" },
      { id: "b", raw_text: "原文 B", processed_text: null },
    ]);
    h.mockInvoke.mockReset().mockImplementation(async (cmd: string) =>
      cmd === "retranscribe_from_file"
        ? { rawText: "重新辨識後的句子內容。", transcriptionDurationMs: 280, noSpeechProbability: 0.01, peakEnergyLevel: 0.5, rmsEnergyLevel: 0.1 }
        : undefined,
    );
    h.mockEnhanceGuard.mockReset();
    // 前面測試啟動的語系 watcher 仍掛在全域 i18n 上（正式環境只啟動一次）：重設語系後等它們跑完再歸零
    i18n.global.locale.value = "zh-TW";
    await nextTick();
    await vi.waitFor(() => Promise.resolve());
    h.mockInvoke.mockClear();
    h.mockDbSelect.mockClear();
  });

  it("啟動：查最近成功記錄，整理後優先，附在地化標籤", async () => {
    await useHistoryStore().startTrayRecentSync();
    expect(h.mockDbSelect).toHaveBeenCalledWith(expect.stringContaining("status = 'success'"), [5]);
    expect(trayCalls()).toEqual([
      [
        "update_tray_recent",
        {
          items: [
            { id: "a", text: "整理後 A" },
            { id: "b", text: "原文 B" },
          ],
          labels: { recentHint: "最近說的話・點一下複製", openMain: "開啟 SayIt", quit: "結束 SayIt" },
        },
      ],
    ]);
  });

  it("HUD 新增或重送成功（TRANSCRIPTION_COMPLETED）→ 刷新", async () => {
    await useHistoryStore().startTrayRecentSync();
    h.listeners.get("transcription:completed")?.();
    await vi.waitFor(() => expect(trayCalls()).toHaveLength(2));
  });

  it("切語系 → 用新語言刷新標籤", async () => {
    await useHistoryStore().startTrayRecentSync();
    h.mockInvoke.mockClear();
    i18n.global.locale.value = "en";
    await vi.waitFor(() => expect(trayCalls().length).toBeGreaterThan(0));
    expect(trayCalls().at(-1)?.[1]).toMatchObject({ labels: { openMain: "Open SayIt", quit: "Quit SayIt" } });
  });

  it("刪除 → 刷新", async () => {
    await useHistoryStore().deleteTranscription("a");
    await vi.waitFor(() => expect(trayCalls()).toHaveLength(1));
  });

  it("重新辨識成功 → 刷新；失敗不刷新", async () => {
    const store = useHistoryStore();
    await store.retranscribeRecord(createRecord({ status: "failed", rawText: "" }));
    await vi.waitFor(() => expect(trayCalls()).toHaveLength(1));

    h.mockInvoke.mockClear();
    await store.retranscribeRecord(createRecord({ audioFilePath: null }));
    await Promise.resolve();
    expect(trayCalls()).toHaveLength(0);
  });

  it("較早的查詢晚到，也不會用舊資料蓋掉較新的選單", async () => {
    const store = useHistoryStore();
    let releaseStaleQuery: (rows: unknown[]) => void = () => {};
    h.mockDbSelect
      .mockImplementationOnce(() => new Promise((resolve) => (releaseStaleQuery = resolve)))
      .mockResolvedValueOnce([{ id: "b", raw_text: "原文 B", processed_text: null }]);

    const staleRefresh = store.refreshTrayRecent(); // 查詢 A：刪除前送出，卡住
    const freshRefresh = store.refreshTrayRecent(); // 查詢 B：刪除後送出
    await vi.waitFor(() => expect(h.mockDbSelect).toHaveBeenCalled());
    releaseStaleQuery([
      { id: "a", raw_text: "已刪的 A", processed_text: null },
      { id: "b", raw_text: "原文 B", processed_text: null },
    ]);
    await Promise.all([staleRefresh, freshRefresh]);

    expect(trayCalls().at(-1)?.[1]).toMatchObject({ items: [{ id: "b", text: "原文 B" }] });
  });

  it("重新整理成功 → 刷新", async () => {
    h.mockEnhanceGuard.mockResolvedValue({ text: "整理後的書面語句子。", usage: null, wasAnomalous: false });
    await useHistoryStore().reEnhanceRecord(createRecord());
    await vi.waitFor(() => expect(trayCalls()).toHaveLength(1));
  });
});
