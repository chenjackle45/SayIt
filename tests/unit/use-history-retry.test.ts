import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { TranscriptionRecord } from "../../src/types/transcription";

const h = vi.hoisted(() => {
  const mockDbExecute = vi.fn();
  const mockInvoke = vi.fn();
  const mockEnhanceGuard = vi.fn();
  const mockGetTopTerms = vi.fn();
  const mockTransform = vi.fn();
  const settingsStub = {
    getApiKey: () => "whisper-key",
    refreshApiKey: vi.fn(),
    selectedWhisperModelId: "whisper-large-v3-turbo",
    getWhisperLanguageCode: () => "zh",
    selectedTranscriptionLocale: "en",
    selectedLocale: "en",
    refreshLlmApiKey: vi.fn(),
    getLlmApiKey: () => "llm-key",
    selectedLlmModelId: "llama-3.3-70b-versatile",
    getAiPrompt: () => "prompt",
  };
  return {
    mockDbExecute,
    mockInvoke,
    mockEnhanceGuard,
    mockGetTopTerms,
    mockTransform,
    settingsStub,
  };
});

vi.mock("../../src/lib/database", () => ({
  getDatabase: () => ({ execute: h.mockDbExecute, select: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.mockInvoke }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  emitToWindow: vi.fn().mockResolvedValue(undefined),
  TRANSCRIPTION_COMPLETED: "transcription:completed",
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/lib/enhancer", () => ({
  enhanceWithAnomalyGuard: h.mockEnhanceGuard,
}));
vi.mock("../../src/lib/transcriptTextTransforms", () => ({
  applyTranscriptTextTransforms: h.mockTransform,
}));
vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => h.settingsStub,
}));
vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({ getTopTermListByWeight: h.mockGetTopTerms }),
}));

import { useHistoryStore } from "../../src/stores/useHistoryStore";

function createRecord(
  overrides: Partial<TranscriptionRecord> = {},
): TranscriptionRecord {
  return {
    id: "rec-1",
    timestamp: 1700000000000,
    rawText: "",
    processedText: null,
    recordingDurationMs: 3000,
    transcriptionDurationMs: 0,
    enhancementDurationMs: null,
    charCount: 0,
    triggerMode: "hold",
    wasEnhanced: false,
    wasModified: null,
    createdAt: "",
    audioFilePath: "C:/rec/rec-1.wav",
    status: "failed",
    isEditMode: false,
    editSourceText: null,
    ...overrides,
  };
}

const GOOD_TRANSCRIBE_RESULT = {
  rawText: "這是重新辨識後得到的完整句子內容。",
  transcriptionDurationMs: 280,
  noSpeechProbability: 0.01,
  peakEnergyLevel: 0.5,
  rmsEnergyLevel: 0.1,
};

describe("useHistoryStore retry", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.mockDbExecute
      .mockReset()
      .mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    h.mockInvoke.mockReset();
    h.mockEnhanceGuard.mockReset();
    h.mockGetTopTerms.mockReset().mockResolvedValue([]);
    h.mockTransform.mockReset().mockImplementation((text: string) => text);
    h.settingsStub.selectedTranscriptionLocale = "en";
    h.settingsStub.selectedLocale = "en";
    h.settingsStub.refreshApiKey.mockReset().mockResolvedValue(undefined);
    h.settingsStub.refreshLlmApiKey.mockReset().mockResolvedValue(undefined);
  });

  describe("retranscribeRecord", () => {
    it("[P1] 成功重新辨識 → flip success、更新原文、清空整理結果", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(true);
      expect(h.mockInvoke).toHaveBeenCalledWith(
        "retranscribe_from_file",
        expect.objectContaining({ filePath: record.audioFilePath }),
      );
      expect(store.transcriptionList[0].status).toBe("success");
      expect(store.transcriptionList[0].rawText).toBe(
        GOOD_TRANSCRIBE_RESULT.rawText,
      );
      expect(store.transcriptionList[0].processedText).toBeNull();
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
    });

    it("[P1] 無錄音檔 → 不呼叫後端並回 noRecordingFile", async () => {
      const store = useHistoryStore();
      const record = createRecord({ audioFilePath: null });
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.noRecordingFile");
      expect(h.mockInvoke).not.toHaveBeenCalled();
    });

    it("[P1] 空轉錄結果 → 保留 failed、不覆寫原文", async () => {
      h.mockInvoke.mockResolvedValue({ ...GOOD_TRANSCRIBE_RESULT, rawText: "  " });
      const store = useHistoryStore();
      const record = createRecord({ rawText: "原本失敗" });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.retranscribeFailed");
      expect(store.transcriptionList[0].status).toBe("failed");
      expect(store.transcriptionList[0].rawText).toBe("原本失敗");
    });

    it("[P2] 幻覺結果（靜音 + 高 NSP）→ 保留 failed", async () => {
      h.mockInvoke.mockResolvedValue({
        rawText: "幻覺出來的一長串文字但其實完全沒有人聲",
        transcriptionDurationMs: 280,
        noSpeechProbability: 0.95,
        peakEnergyLevel: 0,
        rmsEnergyLevel: 0,
      });
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(store.transcriptionList[0].status).toBe("failed");
    });

    it("[P2] 樂觀鎖 rowsAffected=0 → 回失敗、紀錄不變", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      h.mockDbExecute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(store.transcriptionList[0].status).toBe("failed");
    });

    it("[P2] recordingDurationMs<=0 仍可成功（跳過語速異常層、保留能量/NSP）", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord({ recordingDurationMs: 0 });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].status).toBe("success");
    });

    it("[P2] 已整理的成功紀錄重新辨識 → 清空整理、status 仍 success", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "舊的整理結果",
        rawText: "舊原文",
      });
      store.transcriptionList.push(record);
      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].status).toBe("success");
      expect(store.transcriptionList[0].rawText).toBe(
        GOOD_TRANSCRIBE_RESULT.rawText,
      );
      expect(store.transcriptionList[0].processedText).toBeNull();
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
      // 樂觀鎖：UPDATE 以 snapshot raw_text（"舊原文"）作為條件
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(updateCall?.[1]).toContain("舊原文");
    });

    it("[P1] zh-TW → 落地前套用簡繁轉換（共用 transform），存入轉換後文字", async () => {
      h.mockInvoke.mockResolvedValue({
        ...GOOD_TRANSCRIBE_RESULT,
        rawText: "简体转录结果",
      });
      h.settingsStub.selectedTranscriptionLocale = "zh-TW";
      h.mockTransform.mockImplementation((text: string) =>
        text === "简体转录结果" ? "簡體轉錄結果" : text,
      );
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(true);
      expect(h.mockTransform).toHaveBeenCalledWith("简体转录结果", "zh-TW");
      expect(store.transcriptionList[0].rawText).toBe("簡體轉錄結果");
      // 證明寫入 DB 的 raw_text（SQL $1）也是轉換後文字，而非本地才轉
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(updateCall?.[1]?.[0]).toBe("簡體轉錄結果");
    });

    it("[P1] auto 模式 → transform 以介面語言解析的 effectiveLocale 呼叫", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      h.settingsStub.selectedTranscriptionLocale = "auto";
      h.settingsStub.selectedLocale = "zh-TW";
      const store = useHistoryStore();
      const record = createRecord();
      store.transcriptionList.push(record);

      await store.retranscribeRecord(record);

      expect(h.mockTransform).toHaveBeenCalledWith(
        GOOD_TRANSCRIBE_RESULT.rawText,
        "zh-TW",
      );
    });

    it("[P2] 重新辨識 → 重置 was_modified（SQL + 本地皆歸零）", async () => {
      h.mockInvoke.mockResolvedValue(GOOD_TRANSCRIBE_RESULT);
      const store = useHistoryStore();
      const record = createRecord({ wasModified: true });
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].wasModified).toBeNull();
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(String(updateCall?.[0])).toContain("was_modified = NULL");
    });
  });

  describe("retranscribeRecord 守衛（維護者接手 #60）", () => {
    it("[P1] 編輯模式紀錄 → 直接拒絕、不呼叫後端、不動 DB（否則會清掉編輯結果）", async () => {
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "把這句改成正式語氣",
        processedText: "使用者的編輯結果",
        isEditMode: true,
      });
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);

      expect(res.ok).toBe(false);
      expect(h.mockInvoke).not.toHaveBeenCalled();
      expect(h.mockDbExecute).not.toHaveBeenCalled();
      expect(store.transcriptionList[0].processedText).toBe("使用者的編輯結果");
    });

    it("[P1] 同筆重試在途時再送一次 → 第二次被鎖拒絕、後端只被呼叫一次", async () => {
      let resolveFirst: (v: unknown) => void = () => {};
      h.mockInvoke.mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      );
      const store = useHistoryStore();
      const record = createRecord({ rawText: "舊原文" });
      store.transcriptionList.push(record);

      const first = store.retranscribeRecord(record);
      await Promise.resolve();
      expect(store.retryingId).toBe(record.id);
      expect(store.retryingAction).toBe("transcribe");

      const second = await store.retranscribeRecord(record);
      expect(second.ok).toBe(false);

      resolveFirst(GOOD_TRANSCRIBE_RESULT);
      const firstRes = await first;
      expect(firstRes.ok).toBe(true);
      expect(h.mockInvoke).toHaveBeenCalledTimes(1);
      expect(store.retryingId).toBeNull();
    });

    it("[P1] 字典讀取拋錯（外層 catch）→ 回失敗、上報、鎖釋放", async () => {
      const { captureError } = await import("../../src/lib/sentry");
      h.mockGetTopTerms.mockRejectedValueOnce(new Error("db locked"));
      const store = useHistoryStore();
      const record = createRecord({ rawText: "舊原文" });
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.retranscribeFailed");
      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ source: "history", step: "retranscribe" }),
      );
      expect(h.mockInvoke).not.toHaveBeenCalled();
      expect(store.retryingId).toBeNull();
    });

    it("[P1] 後端拋錯 → 回失敗、鎖釋放（錯誤在 store 收斂，不再由頁面上報）", async () => {
      h.mockInvoke.mockRejectedValueOnce(new Error("boom"));
      const store = useHistoryStore();
      const record = createRecord({ rawText: "舊原文" });
      store.transcriptionList.push(record);

      const res = await store.retranscribeRecord(record);
      expect(res.ok).toBe(false);
      expect(store.retryingId).toBeNull();
      expect(store.retryingAction).toBeNull();
    });
  });

  describe("reEnhanceRecord", () => {
    it("[P2] LLM 空回應（wasEmptyResponse）→ 保留既有整理結果、不寫 DB", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "原始口語內容",
        usage: null,
        wasAnomalous: false,
        wasDrift: false,
        wasEmptyResponse: true,
        driftOverlapRatio: 1,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: true,
        processedText: "既有的整理結果",
      });
      store.transcriptionList.push(record);

      const res = await store.reEnhanceRecord(record);

      expect(res.ok).toBe(false);
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(updateCall).toBeUndefined();
      expect(store.transcriptionList[0].processedText).toBe("既有的整理結果");
    });

    it("[P1] 成功整理 → 寫入 processed_text、標記 was_enhanced", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "整理後的書面語句子。",
        usage: null,
        wasAnomalous: false,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].processedText).toBe(
        "整理後的書面語句子。",
      );
      expect(store.transcriptionList[0].wasEnhanced).toBe(true);
    });

    it("[P1] 空原文 → 不呼叫 LLM 並回失敗", async () => {
      const store = useHistoryStore();
      const record = createRecord({ status: "success", rawText: "   " });
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceFailed");
      expect(h.mockEnhanceGuard).not.toHaveBeenCalled();
    });

    it("[P1] 長度爆炸 anomaly → 不 finalize、保留未整理", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "原始口語內容",
        usage: null,
        wasAnomalous: true,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceFailed");
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
      expect(store.transcriptionList[0].processedText).toBeNull();
    });

    it("[P2] 已整理紀錄可再次重新整理（覆寫整理結果）", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "新的整理結果。",
        usage: null,
        wasAnomalous: false,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        wasEnhanced: true,
        processedText: "舊整理",
        rawText: "原始口語內容",
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(true);
      expect(store.transcriptionList[0].processedText).toBe("新的整理結果。");
      expect(store.transcriptionList[0].wasEnhanced).toBe(true);
    });

    it("[P2] 樂觀鎖 rowsAffected=0（raw_text 並行變動）→ 回失敗、不覆寫整理", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "基於舊原文的整理。",
        usage: null,
        wasAnomalous: false,
      });
      h.mockDbExecute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: false,
      });
      store.transcriptionList.push(record);
      const res = await store.reEnhanceRecord(record);
      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceFailed");
      expect(store.transcriptionList[0].wasEnhanced).toBe(false);
      expect(store.transcriptionList[0].processedText).toBeNull();
      // 樂觀鎖：UPDATE 以 snapshot raw_text 作為條件
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(updateCall?.[1]).toContain(record.rawText);
    });

    it("[P1] 編輯模式紀錄 → 直接拒絕、不呼叫 LLM、不動 DB（防繞過守衛）", async () => {
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "把這句改成正式語氣",
        processedText: "使用者的編輯結果",
        isEditMode: true,
      });
      store.transcriptionList.push(record);

      const res = await store.reEnhanceRecord(record);

      expect(res.ok).toBe(false);
      expect(h.mockEnhanceGuard).not.toHaveBeenCalled();
      expect(h.mockDbExecute).not.toHaveBeenCalled();
      expect(h.settingsStub.refreshLlmApiKey).not.toHaveBeenCalled();
      expect(h.mockGetTopTerms).not.toHaveBeenCalled();
      expect(store.transcriptionList[0].processedText).toBe("使用者的編輯結果");
    });

    it("[P1] 語意飄移（wasDrift）→ 拒絕並保留既有結果、不寫 DB、回 reEnhanceDrift", async () => {
      h.mockEnhanceGuard.mockResolvedValue({
        text: "與原文完全不相干的回答內容。",
        usage: null,
        wasAnomalous: false,
        wasDrift: true,
        driftOverlapRatio: 0.05,
      });
      const store = useHistoryStore();
      const record = createRecord({
        status: "success",
        rawText: "原始口語內容",
        wasEnhanced: true,
        processedText: "既有的整理結果",
      });
      store.transcriptionList.push(record);

      const res = await store.reEnhanceRecord(record);

      expect(res.ok).toBe(false);
      expect(res.errorKey).toBe("history.reEnhanceDrift");
      // 拒絕並保留：不執行 UPDATE，既有 processedText 原封不動
      const updateCall = h.mockDbExecute.mock.calls.find((c) =>
        String(c[0]).includes("UPDATE transcriptions"),
      );
      expect(updateCall).toBeUndefined();
      expect(store.transcriptionList[0].processedText).toBe("既有的整理結果");
    });
  });
});
