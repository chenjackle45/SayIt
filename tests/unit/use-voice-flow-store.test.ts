import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
// "errors.apiKeyMissing" removed — now uses i18n key
import { HOTKEY_ERROR_CODES } from "@/types/events";

const {
  mockListen,
  mockEmit,
  mockInvoke,
  mockEnhanceText,
  mockGetCurrentWindow,
  mockWebviewWindowGetByLabel,
  mockMainWindowShow,
  mockMainWindowSetFocus,
  mockLoadSettings,
  mockSettingsState,
  mockVocabularyState,
  mockAddTranscription,
  mockAddApiUsage,
  listenerCallbackMap,
  unlistenFunctionList,
} = vi.hoisted(() => {
  type EventCallback = (event: { payload: unknown }) => void;
  const listenerCallbackMap = new Map<string, EventCallback>();
  const unlistenFunctionList: Array<ReturnType<typeof vi.fn>> = [];

  const mockListen = vi.fn(
    async (eventName: string, callback: EventCallback) => {
      listenerCallbackMap.set(eventName, callback);
      const unlisten = vi.fn();
      unlistenFunctionList.push(unlisten);
      return unlisten;
    },
  );
  const mockMainWindowShow = vi.fn().mockResolvedValue(undefined);
  const mockMainWindowSetFocus = vi.fn().mockResolvedValue(undefined);
  const mockWebviewWindowGetByLabel = vi.fn(async (label: string) => {
    if (label !== "main-window") return null;
    return {
      show: mockMainWindowShow,
      setFocus: mockMainWindowSetFocus,
    };
  });

  return {
    mockListen,
    mockEmit: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn(async (cmd: string) => {
      switch (cmd) {
        case "start_recording":
          return undefined;
        case "stop_recording":
          return { recordingDurationMs: 2500 };
        case "transcribe_audio":
          return {
            rawText: "測試轉錄",
            transcriptionDurationMs: 320,
            noSpeechProbability: 0.01,
          };
        case "get_hud_target_position":
          return { monitorKey: "test", x: 100, y: 0 };
        default:
          return undefined;
      }
    }),
    mockEnhanceText: vi
      .fn()
      .mockResolvedValue({ text: "AI 整理後的書面語文字", usage: null }),
    mockGetCurrentWindow: vi.fn(() => ({
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
    })),
    mockMainWindowShow,
    mockMainWindowSetFocus,
    mockWebviewWindowGetByLabel,
    mockLoadSettings: vi.fn().mockResolvedValue(undefined),
    mockSettingsState: {
      apiKey: "test-api-key-123",
      aiPrompt: "自訂 prompt 內容",
      triggerMode: "hold" as string,
      isEnhancementThresholdEnabled: true,
      enhancementThresholdCharCount: 10,
      selectedLlmModelId: "llama-3.3-70b-versatile",
      selectedWhisperModelId: "whisper-large-v3",
      isMuteOnRecordingEnabled: false,
      isSmartDictionaryEnabled: false,
      whisperLanguageCode: "zh" as string | null,
    },
    mockVocabularyState: {
      termList: [] as Array<{
        id: string;
        term: string;
        weight: number;
        source: string;
        createdAt: string;
      }>,
      getTopTermListByWeight: vi.fn().mockResolvedValue([]),
      batchIncrementWeights: vi.fn().mockResolvedValue(undefined),
    },
    mockAddTranscription: vi.fn().mockResolvedValue(undefined),
    mockAddApiUsage: vi.fn().mockResolvedValue(undefined),
    listenerCallbackMap,
    unlistenFunctionList,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: mockEmit,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
  Window: {
    getByLabel: mockWebviewWindowGetByLabel,
  },
}));

vi.mock("../../src/lib/enhancer", () => {
  class EnhancerApiError extends Error {
    constructor(
      public statusCode: number,
      statusText: string,
      public body: string,
    ) {
      super(`Enhancement API error: ${statusCode} ${statusText}`);
      this.name = "EnhancerApiError";
    }
  }
  return {
    enhanceText: mockEnhanceText,
    EnhancerApiError,
  };
});

vi.mock("../../src/i18n", () => ({
  default: {
    global: {
      locale: { value: "zh-TW" },
      t: (key: string) => key,
    },
  },
}));

vi.mock("../../src/lib/apiPricing", () => ({
  calculateWhisperCostCeiling: vi.fn(() => 0.000308),
  calculateChatCostCeiling: vi.fn(() => 0.000118),
}));

vi.mock("../../src/lib/vocabularyAnalyzer", () => ({
  analyzeCorrections: vi.fn().mockResolvedValue({
    suggestedTermList: [],
    usage: null,
  }),
}));

vi.mock("../../src/lib/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: mockLoadSettings,
    getApiKey: () => mockSettingsState.apiKey,
    getAiPrompt: () => mockSettingsState.aiPrompt,
    refreshApiKey: vi.fn().mockResolvedValue(undefined),
    refreshEnhancementThreshold: vi.fn().mockResolvedValue(undefined),
    triggerMode: mockSettingsState.triggerMode,
    get isEnhancementThresholdEnabled() {
      return mockSettingsState.isEnhancementThresholdEnabled;
    },
    get enhancementThresholdCharCount() {
      return mockSettingsState.enhancementThresholdCharCount;
    },
    get selectedLlmModelId() {
      return mockSettingsState.selectedLlmModelId;
    },
    get selectedWhisperModelId() {
      return mockSettingsState.selectedWhisperModelId;
    },
    get isMuteOnRecordingEnabled() {
      return mockSettingsState.isMuteOnRecordingEnabled;
    },
    get isSmartDictionaryEnabled() {
      return mockSettingsState.isSmartDictionaryEnabled;
    },
    getWhisperLanguageCode: () => mockSettingsState.whisperLanguageCode,
  }),
}));

vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({
    termList: mockVocabularyState.termList,
    getTopTermListByWeight: mockVocabularyState.getTopTermListByWeight,
    batchIncrementWeights: mockVocabularyState.batchIncrementWeights,
  }),
}));

vi.mock("../../src/stores/useHistoryStore", () => ({
  useHistoryStore: () => ({
    addTranscription: mockAddTranscription,
    addApiUsage: mockAddApiUsage,
  }),
}));

import { useVoiceFlowStore } from "../../src/stores/useVoiceFlowStore";

function triggerHotkeyEvent(eventName: string, payload: unknown = undefined) {
  const callback = listenerCallbackMap.get(eventName);
  if (!callback) {
    throw new Error(`找不到事件監聽器: ${eventName}`);
  }
  callback({ payload });
}

function createDeferredPromise<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolvePromise, rejectPromise };
}

const DEFAULT_TRANSCRIBE_RESULT = {
  rawText: "測試轉錄",
  transcriptionDurationMs: 320,
  noSpeechProbability: 0.01,
};

function createMockInvokeHandler(options?: {
  transcribeResult?: unknown;
  transcribeError?: Error;
  stopRecordingResult?: {
    recordingDurationMs: number;
  };
}): any {
  return async (cmd: string) => {
    switch (cmd) {
      case "start_recording":
        return undefined;
      case "stop_recording":
        return options?.stopRecordingResult ?? { recordingDurationMs: 2500 };
      case "transcribe_audio":
        if (options?.transcribeError) throw options.transcribeError;
        if (options?.transcribeResult !== undefined) {
          return options.transcribeResult instanceof Promise
            ? await options.transcribeResult
            : options.transcribeResult;
        }
        return DEFAULT_TRANSCRIBE_RESULT;
      case "get_hud_target_position":
        return { monitorKey: "test", x: 100, y: 0 };
      default:
        return undefined;
    }
  };
}

describe("useVoiceFlowStore", () => {
  let performanceNowCounter = 0;

  beforeEach(() => {
    performanceNowCounter = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      performanceNowCounter += 500;
      return performanceNowCounter;
    });
    setActivePinia(createPinia());
    listenerCallbackMap.clear();
    unlistenFunctionList.length = 0;
    mockListen.mockClear();
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear().mockImplementation(createMockInvokeHandler());
    mockEnhanceText
      .mockClear()
      .mockResolvedValue({ text: "AI 整理後的書面語文字", usage: null });
    mockLoadSettings.mockClear().mockResolvedValue(undefined);
    mockSettingsState.apiKey = "test-api-key-123";
    mockSettingsState.aiPrompt = "自訂 prompt 內容";
    mockSettingsState.triggerMode = "hold";
    mockSettingsState.isEnhancementThresholdEnabled = true;
    mockSettingsState.enhancementThresholdCharCount = 10;
    mockSettingsState.selectedLlmModelId = "llama-3.3-70b-versatile";
    mockSettingsState.selectedWhisperModelId = "whisper-large-v3";
    mockSettingsState.isMuteOnRecordingEnabled = false;
    mockSettingsState.isSmartDictionaryEnabled = false;
    mockSettingsState.whisperLanguageCode = "zh";
    mockVocabularyState.termList = [];
    mockVocabularyState.getTopTermListByWeight
      .mockClear()
      .mockResolvedValue([]);
    mockVocabularyState.batchIncrementWeights
      .mockClear()
      .mockResolvedValue(undefined);
    mockAddTranscription.mockClear().mockResolvedValue(undefined);
    mockAddApiUsage.mockClear().mockResolvedValue(undefined);
    mockGetCurrentWindow.mockClear();
    mockWebviewWindowGetByLabel.mockClear();
    mockMainWindowShow.mockClear().mockResolvedValue(undefined);
    mockMainWindowSetFocus.mockClear().mockResolvedValue(undefined);
  });

  it("[P0] initialize 應載入設定並註冊所有熱鍵事件", async () => {
    const store = useVoiceFlowStore();

    await store.initialize();

    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:pressed",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:released",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:toggled",
      expect.any(Function),
    );
    expect(mockListen).toHaveBeenCalledWith(
      "hotkey:error",
      expect.any(Function),
    );
    expect(mockListen).not.toHaveBeenCalledWith(
      "cancel:requested",
      expect.any(Function),
    );
  });

  it("[P0] transitionTo 應處理 HUD 顯示與 success/error 自動收合", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("recording", "voiceFlow.recording");
    expect(store.status).toBe("recording");
    expect(store.message).toBe("voiceFlow.recording");

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    expect(store.status).toBe("success");
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(store.status).toBe("idle");

    store.transitionTo("error", "網路異常");
    expect(store.status).toBe("error");
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(store.status).toBe("idle");

    vi.useRealTimers();
  });

  it("[P0] HOTKEY_PRESSED 只會在未錄音時啟動錄音並廣播 recording", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    const startRecordingCallCount = mockInvoke.mock.calls.filter(
      (call) => call[0] === "start_recording",
    ).length;
    expect(startRecordingCallCount).toBe(1);
    expect(store.status).toBe("recording");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "recording",
      message: "voiceFlow.recording",
    });
  });

  it("[P0] HOTKEY_RELEASED 應完成 錄音→轉錄→貼上→success 並廣播事件", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "測試轉錄",
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
    expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
      apiKey: "test-api-key-123",
      vocabularyTermList: null,
      modelId: "whisper-large-v3",
      language: "zh",
    });
    expect(store.status).toBe("success");
    expect(store.message).toBe("voiceFlow.pasteSuccess");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "success",
      message: "voiceFlow.pasteSuccess",
    });
  });

  it("[P0] stop_recording 回報短時長時應顯示「錄音時間太短」並跳過轉錄", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        stopRecordingResult: { recordingDurationMs: 150 },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.recordingTooShort");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "transcribe_audio",
      expect.anything(),
    );
  });

  it("[P0] API Key 缺失時應進入 error 且不執行轉錄", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    mockSettingsState.apiKey = "";
    triggerHotkeyEvent("hotkey:released");

    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("errors.apiKeyMissing");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "transcribe_audio",
      expect.anything(),
    );
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.apiKeyMissing",
    });
  });

  it("[P0] 空白轉錄結果時應回報「未偵測到語音」", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "",
          transcriptionDurationMs: 280,
          noSpeechProbability: 1.0,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.noSpeechDetected");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 高 noSpeechProbability 但有文字時應正常貼上（不攔截幻聽）", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "谢谢大家",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.95,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", expect.anything());
    });

    expect(store.status).toBe("success");
  });

  it("[P0] 已知幻覺短語有文字時應正常貼上（讓使用者自行判斷）", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "谢谢大家",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.5,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", expect.anything());
    });

    expect(store.status).toBe("success");
  });

  it("[P0] 正常語音應正常貼上", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "你好",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.05,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "你好",
      });
    });

    expect(store.status).toBe("success");
  });

  it("[P1] 純空白字串應視為空轉錄，觸發「未偵測到語音」", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: {
          rawText: "   ",
          transcriptionDurationMs: 280,
          noSpeechProbability: 0.8,
        },
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("voiceFlow.noSpeechDetected");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 轉錄失敗時應回報中文錯誤訊息", async () => {
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeError: new Error("Groq API error (500)"),
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("errors.transcription.serviceUnavailable");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.transcription.serviceUnavailable",
    });
  });

  it("[P0] 轉錄中再次觸發 HOTKEY_PRESSED 應被忽略（race condition 防護）", async () => {
    const deferredTranscription = createDeferredPromise<{
      rawText: string;
      transcriptionDurationMs: number;
      noSpeechProbability: number;
    }>();
    mockInvoke.mockImplementation(
      createMockInvokeHandler({
        transcribeResult: deferredTranscription.promise,
      }),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:released");
    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    const startRecordingCallCount = mockInvoke.mock.calls.filter(
      (call) => call[0] === "start_recording",
    ).length;
    expect(startRecordingCallCount).toBe(1);

    deferredTranscription.resolvePromise({
      rawText: "完成轉錄",
      transcriptionDurationMs: 100,
      noSpeechProbability: 0.01,
    });

    await vi.waitFor(() => {
      expect(store.status).toBe("success");
    });
  });

  it("[P1] HOTKEY_TOGGLED 應依 action 分別觸發 start 與 stop", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:toggled", { mode: "toggle", action: "start" });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    triggerHotkeyEvent("hotkey:toggled", { mode: "toggle", action: "stop" });
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("stop_recording");
    });
  });

  it("[P0] HOTKEY_ERROR 應轉為 error 狀態並顯示中文 HUD 訊息", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: "ACCESSIBILITY_DENIED",
      message: "CGEventTap creation failed",
    });

    expect(store.status).toBe("error");
    expect(store.message).toBe("errors.hotkey.default");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "errors.hotkey.default",
    });
  });

  it("[P0] HOTKEY_ERROR 為 accessibility_permission 時應開啟 main-window 並顯示權限訊息", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION,
      message: "CGEventTap creation failed. Grant Accessibility permission.",
    });
    await vi.waitFor(() => {
      expect(mockMainWindowSetFocus).toHaveBeenCalledTimes(1);
    });

    expect(mockWebviewWindowGetByLabel).toHaveBeenCalledWith("main-window");
    expect(mockMainWindowShow).toHaveBeenCalledTimes(1);
    expect(store.status).toBe("error");
    expect(store.message).toBe("errors.hotkey.accessibilityPermission");
  });

  it("[P1] success auto-hide 應廣播 idle 事件", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    mockEmit.mockClear();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(store.status).toBe("idle");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "idle",
      message: "",
    });

    vi.useRealTimers();
  });

  it("[P0] cleanup 應清除 timer 並解除所有事件監聽", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();
    await store.initialize();

    store.transitionTo("success", "voiceFlow.pasteSuccess");
    store.cleanup();
    vi.advanceTimersByTime(1000);

    expect(store.status).toBe("success");
    unlistenFunctionList.forEach((unlisten) => {
      expect(unlisten).toHaveBeenCalledTimes(1);
    });
    vi.useRealTimers();
  });

  // ==========================================================================
  // AI 文字整理 (Story 2.1)
  // ==========================================================================

  describe("AI 文字整理", () => {
    it("[P0] >= 10 字應走 AI 整理流程：recording → transcribing → enhancing → success", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "整理後的書面語文字",
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          systemPrompt: "自訂 prompt 內容",
        }),
      );
      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccess");

      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "enhancing",
        message: "voiceFlow.enhancing",
      });
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "voiceFlow.pasteSuccess",
      });
    });

    it("[P0] < 10 字應跳過 AI 整理，直接貼上原始文字", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccess");

      const enhancingCalls = mockEmit.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === "voice-flow:state-changed" &&
          (call[1] as { status: string }).status === "enhancing",
      );
      expect(enhancingCalls).toHaveLength(0);
    });

    it("[P0] AI 整理 timeout 應 fallback 貼原始文字並顯示「已貼上（未整理）」", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccessUnenhanced");
    });

    it("[P0] AI 整理 API 錯誤應 fallback 貼原始文字並顯示「已貼上（未整理）」", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理失敗：500"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("voiceFlow.pasteSuccessUnenhanced");
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "voiceFlow.pasteSuccessUnenhanced",
      });
    });

    it("[P0] 恰好 10 字應走 AI 整理流程", async () => {
      const exactTenChars = "一二三四五六七八九十";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: exactTenChars,
            transcriptionDurationMs: 300,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後十個字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "整理後十個字",
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledTimes(1);
    });

    it("[P0] 9 字應跳過 AI 整理", async () => {
      const nineChars = "一二三四五六七八九";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: nineChars,
            transcriptionDurationMs: 300,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: nineChars,
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
    });

    it("[P0] 門檻停用時，短文字仍走 AI 整理", async () => {
      mockSettingsState.isEnhancementThresholdEnabled = false;
      const shortText = "短文字";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: shortText,
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "AI 整理過的短文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "AI 整理過的短文字",
        });
      });

      expect(mockEnhanceText).toHaveBeenCalledTimes(1);
    });

    // ========================================================================
    // Story 2.2: Prompt 自訂與上下文注入
    // ========================================================================

    it("[P0] AI 整理應傳遞 systemPrompt 參數", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          systemPrompt: "自訂 prompt 內容",
        }),
      );
    });

    it("[P0] AI 整理應注入詞彙清單", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        {
          id: "1",
          term: "TypeScript",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Vue.js",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "TypeScript",
        "Vue.js",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          vocabularyTermList: ["TypeScript", "Vue.js"],
        }),
      );
    });

    it("[P0] 空詞彙清單不應傳遞 vocabularyTermList (Story 2.2)", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          vocabularyTermList: undefined,
        }),
      );
    });
  });

  // ==========================================================================
  // 詞彙注入 Whisper (Story 3.2)
  // ==========================================================================

  describe("詞彙注入 Whisper", () => {
    it("[P0] 有詞彙時應將詞彙清單傳入 transcribe_audio", async () => {
      mockVocabularyState.termList = [
        {
          id: "1",
          term: "TypeScript",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Tauri",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "TypeScript",
        "Tauri",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "transcribe_audio",
          expect.anything(),
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        apiKey: "test-api-key-123",
        vocabularyTermList: ["TypeScript", "Tauri"],
        modelId: "whisper-large-v3",
        language: "zh",
      });
    });

    it("[P0] 空詞彙時應傳 null 給 transcribe_audio", async () => {
      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "transcribe_audio",
          expect.anything(),
        );
      });

      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        apiKey: "test-api-key-123",
        vocabularyTermList: null,
        modelId: "whisper-large-v3",
        language: "zh",
      });
    });

    it("[P0] 詞彙清單應同時傳給 transcriber 和 enhancer", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        {
          id: "1",
          term: "Pinia",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
        {
          id: "2",
          term: "Vitest",
          weight: 1,
          source: "manual",
          createdAt: "2026-01-01",
        },
      ];
      mockVocabularyState.getTopTermListByWeight.mockResolvedValue([
        "Pinia",
        "Vitest",
      ]);

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      // transcriber 收到詞彙
      expect(mockInvoke).toHaveBeenCalledWith("transcribe_audio", {
        apiKey: "test-api-key-123",
        vocabularyTermList: ["Pinia", "Vitest"],
        modelId: "whisper-large-v3",
        language: "zh",
      });

      // enhancer 也收到詞彙
      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          vocabularyTermList: ["Pinia", "Vitest"],
          modelId: "llama-3.3-70b-versatile",
        }),
      );
    });
  });

  // ==========================================================================
  // 貼上後品質監控 (Story 2.3)
  // ==========================================================================

  describe("貼上後品質監控", () => {
    it("[P0] AI 整理成功貼上後應呼叫 start_quality_monitor", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "整理後的書面語文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] AI 整理失敗 fallback 後仍應啟動品質監控", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] 跳過 AI 直接貼上後應呼叫 start_quality_monitor", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_quality_monitor");
      });
    });

    it("[P0] 收到 quality-monitor:result 事件應更新 lastWasModified", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      expect(store.lastWasModified).toBeNull();

      triggerHotkeyEvent("quality-monitor:result", { wasModified: true });
      expect(store.lastWasModified).toBe(true);

      triggerHotkeyEvent("quality-monitor:result", { wasModified: false });
      expect(store.lastWasModified).toBe(false);
    });

    it("[P0] 開始錄音時應重置 lastWasModified 為 null", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      // 先模擬收到品質監控結果
      triggerHotkeyEvent("quality-monitor:result", { wasModified: true });
      expect(store.lastWasModified).toBe(true);

      // 開始新一輪錄音
      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      expect(store.lastWasModified).toBeNull();
    });

    it("[P0] initialize 應註冊 quality-monitor:result 事件監聽", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      expect(mockListen).toHaveBeenCalledWith(
        "quality-monitor:result",
        expect.any(Function),
      );
    });

    it("[P0] 轉錄失敗時不應呼叫 start_quality_monitor", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeError: new Error("Groq API error (500)"),
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(mockInvoke).not.toHaveBeenCalledWith("start_quality_monitor");
    });
  });

  // ==========================================================================
  // 轉錄記錄自動儲存 (Story 4.1)
  // ==========================================================================

  describe("轉錄記錄自動儲存", () => {
    it("[P0] AI 整理成功路徑應呼叫 addTranscription（wasEnhanced=true, processedText 有值）", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "整理後的書面語文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe(longText);
      expect(record.processedText).toBe("整理後的書面語文字");
      expect(record.wasEnhanced).toBe(true);
      expect(record.enhancementDurationMs).toBeGreaterThanOrEqual(0);
      expect(record.charCount).toBe("整理後的書面語文字".length);
      expect(record.triggerMode).toBe("hold");
      expect(record.wasModified).toBeNull();
      expect(record.id).toBeTruthy();
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it("[P0] AI 整理失敗路徑應呼叫 addTranscription（wasEnhanced=false, processedText=null, enhancementDurationMs 有值）", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe(longText);
      expect(record.processedText).toBeNull();
      expect(record.wasEnhanced).toBe(false);
      expect(record.enhancementDurationMs).toBeGreaterThanOrEqual(0);
      expect(record.charCount).toBe(longText.length);
      expect(record.wasModified).toBeNull();
    });

    it("[P0] 跳過 AI 路徑應呼叫 addTranscription（wasEnhanced=false, processedText=null, enhancementDurationMs=null）", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockAddTranscription).toHaveBeenCalledTimes(1);
      });

      const record = mockAddTranscription.mock.calls[0][0];
      expect(record.rawText).toBe("短文字");
      expect(record.processedText).toBeNull();
      expect(record.wasEnhanced).toBe(false);
      expect(record.enhancementDurationMs).toBeNull();
      expect(record.charCount).toBe("短文字".length);
      expect(record.wasModified).toBeNull();
    });

    it("[P0] 轉錄失敗時不應呼叫 addTranscription", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeError: new Error("Groq API error (500)"),
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(mockAddTranscription).not.toHaveBeenCalled();
    });

    it("[P0] 空白轉錄結果不應呼叫 addTranscription", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "",
            transcriptionDurationMs: 280,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(mockAddTranscription).not.toHaveBeenCalled();
    });

    it("[P0] addTranscription 失敗不應影響主流程（fire-and-forget）", async () => {
      mockAddTranscription.mockRejectedValueOnce(
        new Error("SQLite write failed"),
      );
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      // 主流程仍然成功
      expect(store.status).toBe("success");
      expect(mockAddTranscription).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // API Usage 記錄 (saveApiUsageRecordList)
  // ==========================================================================

  describe("API Usage 記錄", () => {
    it("[P0] 跳過 AI 路徑應只呼叫 addApiUsage 一次（Whisper）", async () => {
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: "短文字",
            transcriptionDurationMs: 200,
            noSpeechProbability: 0.01,
          },
        }),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(1);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");
      expect(whisperRecord.model).toBe("whisper-large-v3");
      expect(whisperRecord.audioDurationMs).toBeGreaterThanOrEqual(0);
      expect(whisperRecord.estimatedCostCeiling).toBe(0.000308);
    });

    it("[P0] AI 整理成功應呼叫 addApiUsage 兩次（Whisper + Chat）", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          promptTimeMs: 200,
          completionTimeMs: 300,
          totalTimeMs: 500,
        },
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "整理後的書面語文字",
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(2);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");

      const chatRecord = mockAddApiUsage.mock.calls[1][0];
      expect(chatRecord.apiType).toBe("chat");
      expect(chatRecord.model).toBe("llama-3.3-70b-versatile");
      expect(chatRecord.promptTokens).toBe(100);
      expect(chatRecord.completionTokens).toBe(50);
      expect(chatRecord.totalTokens).toBe(150);
      expect(chatRecord.estimatedCostCeiling).toBe(0.000118);
    });

    it("[P0] AI 整理失敗 fallback 應只呼叫 addApiUsage 一次（Whisper）", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockInvoke.mockImplementation(
        createMockInvokeHandler({
          transcribeResult: {
            rawText: longText,
            transcriptionDurationMs: 400,
            noSpeechProbability: 0.01,
          },
        }),
      );
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      await vi.waitFor(() => {
        expect(mockAddApiUsage).toHaveBeenCalledTimes(1);
      });

      const whisperRecord = mockAddApiUsage.mock.calls[0][0];
      expect(whisperRecord.apiType).toBe("whisper");
    });
  });

  describe("音效回饋", () => {
    it("開始錄音時應呼叫 play_start_sound", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });
      expect(mockInvoke).toHaveBeenCalledWith("play_start_sound");
    });

    it("結束錄音時應呼叫 play_stop_sound", async () => {
      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("play_stop_sound");
      });
    });

    it("play_start_sound 失敗不應影響錄音流程", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "play_start_sound")
          throw new Error("sound playback failed");
        return createMockInvokeHandler()(cmd);
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(store.status).toBe("recording");
      });

      expect(mockInvoke).toHaveBeenCalledWith("start_recording");
    });

    it("play_stop_sound 失敗不應影響轉錄流程", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "play_stop_sound") throw new Error("sound playback failed");
        return createMockInvokeHandler()(cmd);
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("start_recording");
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "測試轉錄",
        });
      });

      expect(store.status).toBe("success");
    });
  });
});
