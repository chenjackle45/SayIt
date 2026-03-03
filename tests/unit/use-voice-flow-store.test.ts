import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { API_KEY_MISSING_ERROR } from "@/lib/errorUtils";
import { HOTKEY_ERROR_CODES } from "@/types/events";

const {
  mockListen,
  mockEmit,
  mockInvoke,
  mockInitializeMicrophone,
  mockStartRecording,
  mockStopRecording,
  mockTranscribeAudio,
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
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockInitializeMicrophone: vi.fn().mockResolvedValue(undefined),
    mockStartRecording: vi.fn(),
    mockStopRecording: vi
      .fn()
      .mockResolvedValue(new Blob(["audio"], { type: "audio/webm" })),
    mockTranscribeAudio: vi.fn().mockResolvedValue({
      rawText: "測試轉錄",
      transcriptionDurationMs: 320,
      noSpeechProbability: 0.01,
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
    },
    mockVocabularyState: {
      termList: [] as Array<{ id: string; term: string; createdAt: string }>,
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

vi.mock("../../src/lib/recorder", () => ({
  initializeMicrophone: mockInitializeMicrophone,
  startRecording: mockStartRecording,
  stopRecording: mockStopRecording,
  createAudioAnalyser: vi.fn(() => ({
    getFrequencyData: vi.fn(() => new Float32Array(32)),
    destroy: vi.fn(),
  })),
  destroyAudioAnalyser: vi.fn(),
}));

vi.mock("../../src/lib/transcriber", () => ({
  transcribeAudio: mockTranscribeAudio,
  GROQ_MODEL: "whisper-large-v3",
}));

vi.mock("../../src/lib/enhancer", () => ({
  enhanceText: mockEnhanceText,
  GROQ_LLM_MODEL: "llama-3.3-70b-versatile",
}));

vi.mock("../../src/lib/apiPricing", () => ({
  calculateWhisperCostCeiling: vi.fn(() => 0.000308),
  calculateChatCostCeiling: vi.fn(() => 0.000118),
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: mockLoadSettings,
    getApiKey: () => mockSettingsState.apiKey,
    getAiPrompt: () => mockSettingsState.aiPrompt,
    refreshApiKey: vi.fn().mockResolvedValue(undefined),
    triggerMode: mockSettingsState.triggerMode,
  }),
}));

vi.mock("../../src/stores/useVocabularyStore", () => ({
  useVocabularyStore: () => ({
    termList: mockVocabularyState.termList,
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

describe("useVoiceFlowStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listenerCallbackMap.clear();
    unlistenFunctionList.length = 0;
    mockListen.mockClear();
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockInitializeMicrophone.mockClear().mockResolvedValue(undefined);
    mockStartRecording.mockClear();
    mockStopRecording
      .mockClear()
      .mockResolvedValue(new Blob(["audio"], { type: "audio/webm" }));
    mockTranscribeAudio.mockClear().mockResolvedValue({
      rawText: "測試轉錄",
      transcriptionDurationMs: 320,
      noSpeechProbability: 0.01,
    });
    mockEnhanceText
      .mockClear()
      .mockResolvedValue({ text: "AI 整理後的書面語文字", usage: null });
    mockLoadSettings.mockClear().mockResolvedValue(undefined);
    mockSettingsState.apiKey = "test-api-key-123";
    mockSettingsState.aiPrompt = "自訂 prompt 內容";
    mockSettingsState.triggerMode = "hold";
    mockVocabularyState.termList = [];
    mockAddTranscription.mockClear().mockResolvedValue(undefined);
    mockAddApiUsage.mockClear().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn().mockResolvedValue(""),
      },
    });
    mockGetCurrentWindow.mockClear();
    mockWebviewWindowGetByLabel.mockClear();
    mockMainWindowShow.mockClear().mockResolvedValue(undefined);
    mockMainWindowSetFocus.mockClear().mockResolvedValue(undefined);
  });

  it("[P0] initialize 應載入設定、初始化麥克風並註冊所有熱鍵事件", async () => {
    const store = useVoiceFlowStore();

    await store.initialize();

    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
    expect(mockInitializeMicrophone).toHaveBeenCalledTimes(1);
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
  });

  it("[P0] transitionTo 應處理 HUD 顯示與 success/error 自動收合", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("recording", "錄音中...");
    expect(store.status).toBe("recording");
    expect(store.message).toBe("錄音中...");

    store.transitionTo("success", "已貼上 ✓");
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
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    expect(mockStartRecording).toHaveBeenCalledTimes(1);
    expect(store.status).toBe("recording");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "recording",
      message: "錄音中...",
    });
  });

  it("[P0] HOTKEY_RELEASED 應完成 錄音→轉錄→貼上→success 並廣播事件", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "測試轉錄",
      });
    });

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      expect.any(Blob),
      "test-api-key-123",
      undefined,
    );
    expect(store.status).toBe("success");
    expect(store.message).toBe("已貼上 ✓");
    // 貼上前隱藏視窗但不經過 idle，直接進 success
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "success",
      message: "已貼上 ✓",
    });
  });

  it("[P0] API Key 缺失時應進入 error 且不執行轉錄", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    mockSettingsState.apiKey = "";
    triggerHotkeyEvent("hotkey:released");

    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe(API_KEY_MISSING_ERROR);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: API_KEY_MISSING_ERROR,
    });
  });

  it("[P0] 空白轉錄結果時應回報「未偵測到語音」", async () => {
    mockTranscribeAudio.mockResolvedValueOnce({
      rawText: "",
      transcriptionDurationMs: 280,
      noSpeechProbability: 1.0,
    });

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("未偵測到語音");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 高 noSpeechProbability 時應觸發「未偵測到語音」", async () => {
    mockTranscribeAudio.mockResolvedValueOnce({
      rawText: "谢谢大家",
      transcriptionDurationMs: 280,
      noSpeechProbability: 0.95,
    });

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("未偵測到語音");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 已知幻覺短語「谢谢大家」應觸發「未偵測到語音」", async () => {
    mockTranscribeAudio.mockResolvedValueOnce({
      rawText: "谢谢大家",
      transcriptionDurationMs: 280,
      noSpeechProbability: 0.5,
    });

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("未偵測到語音");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 含幻覺子字串的長句應觸發「未偵測到語音」", async () => {
    mockTranscribeAudio.mockResolvedValueOnce({
      rawText: "請點贊、訂閱、轉發、打賞，支持《明鏡》和《點點》欄目。",
      transcriptionDurationMs: 280,
      noSpeechProbability: 0.5,
    });

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("未偵測到語音");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "paste_text",
      expect.anything(),
    );
  });

  it("[P0] 正常語音 + 低 noSpeechProbability 應正常貼上", async () => {
    mockTranscribeAudio.mockResolvedValueOnce({
      rawText: "你好",
      transcriptionDurationMs: 280,
      noSpeechProbability: 0.05,
    });

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
        text: "你好",
      });
    });

    expect(store.status).toBe("success");
  });

  it("[P0] 轉錄失敗時應回報中文錯誤訊息", async () => {
    mockTranscribeAudio.mockRejectedValueOnce(
      new Error("Groq API error (500)"),
    );

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    await vi.waitFor(() => {
      expect(store.status).toBe("error");
    });

    expect(store.message).toBe("轉錄服務暫時無法使用");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "轉錄服務暫時無法使用",
    });
  });

  it("[P0] 轉錄中再次觸發 HOTKEY_PRESSED 應被忽略（race condition 防護）", async () => {
    const deferredTranscription = createDeferredPromise<{
      rawText: string;
      transcriptionDurationMs: number;
    }>();
    mockTranscribeAudio.mockReturnValueOnce(deferredTranscription.promise);

    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:pressed");
    await vi.waitFor(() => {
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:released");
    triggerHotkeyEvent("hotkey:pressed");
    await Promise.resolve();

    expect(mockStartRecording).toHaveBeenCalledTimes(1);

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
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    triggerHotkeyEvent("hotkey:toggled", { mode: "toggle", action: "stop" });
    await vi.waitFor(() => {
      expect(mockStopRecording).toHaveBeenCalledTimes(1);
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
    expect(store.message).toBe("快捷鍵發生錯誤");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "快捷鍵發生錯誤",
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
    expect(store.message).toBe("需要輔助使用權限");
  });

  it("[P1] success auto-hide 應廣播 idle 事件", async () => {
    vi.useFakeTimers();
    const store = useVoiceFlowStore();

    store.transitionTo("success", "已貼上 ✓");
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

    store.transitionTo("success", "已貼上 ✓");
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      expect(store.message).toBe("已貼上 ✓");

      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "enhancing",
        message: "整理中...",
      });
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "已貼上 ✓",
      });
    });

    it("[P0] < 10 字應跳過 AI 整理，直接貼上原始文字", async () => {
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "短文字",
        transcriptionDurationMs: 200,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "短文字",
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
      expect(store.status).toBe("success");
      expect(store.message).toBe("已貼上 ✓");

      const enhancingCalls = mockEmit.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === "voice-flow:state-changed" &&
          (call[1] as { status: string }).status === "enhancing",
      );
      expect(enhancingCalls).toHaveLength(0);
    });

    it("[P0] AI 整理 timeout 應 fallback 至原始文字並顯示「已貼上（未整理）」", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("已貼上（未整理）");
    });

    it("[P0] AI 整理 API 錯誤應 fallback 至原始文字並顯示「已貼上（未整理）」", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理失敗：500"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: longText,
        });
      });

      expect(store.status).toBe("success");
      expect(store.message).toBe("已貼上（未整理）");
      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "success",
        message: "已貼上（未整理）",
      });
    });

    it("[P0] 恰好 10 字應走 AI 整理流程", async () => {
      const exactTenChars = "一二三四五六七八九十";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: exactTenChars,
        transcriptionDurationMs: 300,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後十個字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: nineChars,
        transcriptionDurationMs: 300,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: nineChars,
        });
      });

      expect(mockEnhanceText).not.toHaveBeenCalled();
    });

    // ========================================================================
    // Story 2.2: Prompt 自訂與上下文注入
    // ========================================================================

    it("[P0] AI 整理應傳遞 systemPrompt 參數", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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

    it("[P0] AI 整理應注入剪貼簿內容", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      Object.assign(navigator, {
        clipboard: {
          readText: vi.fn().mockResolvedValue("剪貼簿測試內容"),
        },
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          clipboardContent: "剪貼簿測試內容",
        }),
      );
    });

    it("[P0] AI 整理應注入詞彙清單", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        { id: "1", term: "TypeScript", createdAt: "2026-01-01" },
        { id: "2", term: "Vue.js", createdAt: "2026-01-01" },
      ];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
    it("[P0] 有詞彙時應將詞彙清單傳入 transcribeAudio", async () => {
      mockVocabularyState.termList = [
        { id: "1", term: "TypeScript", createdAt: "2026-01-01" },
        { id: "2", term: "Tauri", createdAt: "2026-01-01" },
      ];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
      });

      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        expect.any(Blob),
        "test-api-key-123",
        ["TypeScript", "Tauri"],
      );
    });

    it("[P0] 空詞彙時應傳 undefined 給 transcribeAudio", async () => {
      mockVocabularyState.termList = [];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
      });

      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        expect.any(Blob),
        "test-api-key-123",
        undefined,
      );
    });

    it("[P0] 詞彙清單應同時傳給 transcriber 和 enhancer", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後文字",
        usage: null,
      });

      mockVocabularyState.termList = [
        { id: "1", term: "Pinia", createdAt: "2026-01-01" },
        { id: "2", term: "Vitest", createdAt: "2026-01-01" },
      ];

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(mockEnhanceText).toHaveBeenCalledTimes(1);
      });

      // transcriber 收到詞彙
      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        expect.any(Blob),
        "test-api-key-123",
        ["Pinia", "Vitest"],
      );

      // enhancer 也收到詞彙
      expect(mockEnhanceText).toHaveBeenCalledWith(
        longText,
        "test-api-key-123",
        expect.objectContaining({
          vocabularyTermList: ["Pinia", "Vitest"],
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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

    it("[P0] AI fallback 貼上後應呼叫 start_quality_monitor", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "短文字",
        transcriptionDurationMs: 200,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockRejectedValueOnce(
        new Error("Groq API error (500)"),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockResolvedValueOnce({
        text: "整理後的書面語文字",
        usage: null,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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

    it("[P0] AI fallback 路徑應呼叫 addTranscription（wasEnhanced=false, processedText=null, enhancementDurationMs 有值）", async () => {
      const longText = "這是一段超過十個字的測試轉錄文字內容";
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "短文字",
        transcriptionDurationMs: 200,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockRejectedValueOnce(
        new Error("Groq API error (500)"),
      );

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      triggerHotkeyEvent("hotkey:released");
      await vi.waitFor(() => {
        expect(store.status).toBe("error");
      });

      expect(mockAddTranscription).not.toHaveBeenCalled();
    });

    it("[P0] 空白轉錄結果不應呼叫 addTranscription", async () => {
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "",
        transcriptionDurationMs: 280,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "短文字",
        transcriptionDurationMs: 200,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: "短文字",
        transcriptionDurationMs: 200,
        noSpeechProbability: 0.01,
      });

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
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
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
      mockTranscribeAudio.mockResolvedValueOnce({
        rawText: longText,
        transcriptionDurationMs: 400,
        noSpeechProbability: 0.01,
      });
      mockEnhanceText.mockRejectedValueOnce(new Error("AI 整理逾時"));

      const store = useVoiceFlowStore();
      await store.initialize();

      triggerHotkeyEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
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
});
