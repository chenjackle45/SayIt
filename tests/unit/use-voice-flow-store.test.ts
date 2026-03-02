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
  mockGetCurrentWindow,
  mockWebviewWindowGetByLabel,
  mockMainWindowShow,
  mockMainWindowSetFocus,
  mockLoadSettings,
  mockSettingsState,
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
    mockTranscribeAudio: vi
      .fn()
      .mockResolvedValue({ rawText: "測試轉錄", transcriptionDurationMs: 320 }),
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
    },
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
}));

vi.mock("../../src/lib/transcriber", () => ({
  transcribeAudio: mockTranscribeAudio,
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: mockLoadSettings,
    getApiKey: () => mockSettingsState.apiKey,
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
    mockTranscribeAudio
      .mockClear()
      .mockResolvedValue({ rawText: "測試轉錄", transcriptionDurationMs: 320 });
    mockLoadSettings.mockClear().mockResolvedValue(undefined);
    mockSettingsState.apiKey = "test-api-key-123";
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
    vi.advanceTimersByTime(2000);
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

  it("[P0] HOTKEY_RELEASED 應完成 錄音→idle→貼上→success 並廣播事件", async () => {
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
    );
    expect(store.status).toBe("success");
    expect(store.message).toBe("已貼上 ✓");
    // 驗證貼上前有走 idle 轉換
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "idle",
      message: "",
    });
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

    expect(store.message).toBe("語音轉錄服務暫時無法使用");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "語音轉錄服務暫時無法使用",
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

  it("[P0] HOTKEY_ERROR 應轉為 error 狀態並廣播事件", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: "ACCESSIBILITY_DENIED",
      message: "請授予輔助使用權限",
    });

    expect(store.status).toBe("error");
    expect(store.message).toBe("請授予輔助使用權限");
    expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
      status: "error",
      message: "請授予輔助使用權限",
    });
  });

  it("[P0] HOTKEY_ERROR 為 accessibility_permission 時應開啟 main-window", async () => {
    const store = useVoiceFlowStore();
    await store.initialize();

    triggerHotkeyEvent("hotkey:error", {
      error: HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION,
      message: "請授予輔助使用權限",
    });
    await vi.waitFor(() => {
      expect(mockMainWindowSetFocus).toHaveBeenCalledTimes(1);
    });

    expect(mockWebviewWindowGetByLabel).toHaveBeenCalledWith("main-window");
    expect(mockMainWindowShow).toHaveBeenCalledTimes(1);
    expect(store.status).toBe("error");
    expect(store.message).toBe("請授予輔助使用權限");
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
});
