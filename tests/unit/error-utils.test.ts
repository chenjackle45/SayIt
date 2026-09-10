import { describe, expect, it } from "vitest";
import {
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../../src/lib/errorUtils";

describe("getMicrophoneErrorMessage", () => {
  it("[P0] NotAllowedError 應映射為中文權限提示", () => {
    const error = new DOMException("Permission denied", "NotAllowedError");
    expect(getMicrophoneErrorMessage(error)).toBe("需要麥克風權限才能錄音");
  });

  it("[P0] NotFoundError 應映射為裝置不存在訊息", () => {
    const error = new DOMException("No device found", "NotFoundError");
    expect(getMicrophoneErrorMessage(error)).toBe("未偵測到麥克風裝置");
  });

  it("[P0] NotReadableError 應映射為裝置被佔用訊息", () => {
    const error = new DOMException("Device busy", "NotReadableError");
    expect(getMicrophoneErrorMessage(error)).toBe("麥克風被其他程式佔用");
  });

  it("[P0] 未知 DOMException name 應回傳預設中文訊息", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(getMicrophoneErrorMessage(error)).toBe("麥克風初始化失敗");
  });

  it("[P0] 非 DOMException 錯誤應回傳預設中文訊息", () => {
    expect(getMicrophoneErrorMessage(new Error("Unknown"))).toBe(
      "麥克風初始化失敗",
    );
  });
});

describe("getTranscriptionErrorMessage", () => {
  it("[P0] TypeError 應映射為網路連線中斷", () => {
    expect(getTranscriptionErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "網路連線中斷",
    );
  });

  it("[P0] Groq API 401 應映射為 API Key 無效", () => {
    const error = new Error("Groq API error (401): Unauthorized");
    expect(getTranscriptionErrorMessage(error)).toBe("API Key 無效或已過期");
  });

  it("[P0] Groq API 429 應映射為請求過於頻繁", () => {
    const error = new Error("Groq API error (429): Rate limit exceeded");
    expect(getTranscriptionErrorMessage(error)).toBe("請求過於頻繁，稍後再試");
  });

  it("[P0] Groq API 500+ 應映射為服務暫時無法使用", () => {
    const error = new Error("Groq API error (500): Internal Server Error");
    expect(getTranscriptionErrorMessage(error)).toBe("轉錄服務暫時無法使用");
  });

  it("[P0] Groq API 未知狀態碼應映射為語音轉錄失敗", () => {
    const error = new Error("Groq API error (418): I'm a teapot");
    expect(getTranscriptionErrorMessage(error)).toBe("語音轉錄失敗");
  });

  it("[P0] Groq API 無狀態碼應映射為語音轉錄失敗", () => {
    const error = new Error("Groq API error: unknown");
    expect(getTranscriptionErrorMessage(error)).toBe("語音轉錄失敗");
  });

  it("[P0] MediaRecorder 錯誤應映射為錄音裝置錯誤", () => {
    const error = new Error("MediaRecorder error during stop.");
    expect(getTranscriptionErrorMessage(error)).toBe("錄音裝置發生錯誤");
  });

  it("[P0] 未知錯誤應回傳操作失敗", () => {
    expect(getTranscriptionErrorMessage("some string error")).toBe("操作失敗");
  });

  it("[P0] Tauri HTTP network error 應映射為網路連線中斷", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("network error: connection refused"),
      ),
    ).toBe("網路連線中斷");
  });

  it("[P0] DNS resolution failure 應映射為網路連線中斷", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("dns resolve error: no such host"),
      ),
    ).toBe("網路連線中斷");
  });

  it("[P0] connection timeout 應映射為網路連線中斷", () => {
    expect(getTranscriptionErrorMessage(new Error("connect timeout"))).toBe(
      "網路連線中斷",
    );
  });

  it("[P0] Audio file too large 應映射為錄音檔案過大", () => {
    const error = new Error(
      "Audio file too large (35.2 MB, limit 25 MB). Please shorten your recording.",
    );
    expect(getTranscriptionErrorMessage(error)).toBe(
      "錄音檔案過大，請縮短錄音時間",
    );
  });

  it("[P0] Groq API error 包含 network 字眼時不應被誤判為網路錯誤", () => {
    expect(
      getTranscriptionErrorMessage(
        new Error("Groq API error (500): network issue on server"),
      ),
    ).toBe("轉錄服務暫時無法使用");
  });

  // ── Rust 端實際透過 Tauri invoke reject 的「純字串」形式（#37/#38 真實情境）──
  it("[P0] 純字串 Groq API returned error (429) 應映射為請求過於頻繁", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (429): Rate limit reached",
      ),
    ).toBe("請求過於頻繁，稍後再試");
  });

  it("[P0] 純字串 Groq API returned error (503) 應映射為服務暫時無法使用", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (503): Service Unavailable",
      ),
    ).toBe("轉錄服務暫時無法使用");
  });

  it("[P0] 純字串 Groq API returned error (401) 應映射為 API Key 無效", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (401): Invalid API Key",
      ),
    ).toBe("API Key 無效或已過期");
  });

  it("[P0] 純字串 Groq API request failed 應映射為網路連線中斷", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API request failed: error sending request for url",
      ),
    ).toBe("網路連線中斷");
  });

  it("[P0] 純字串 Groq API returned error 含 network 字眼時仍判服務暫時無法使用", () => {
    expect(
      getTranscriptionErrorMessage(
        "Groq API returned error (500): upstream connect timeout",
      ),
    ).toBe("轉錄服務暫時無法使用");
  });
});

describe("getEnhancementErrorMessage - 網路錯誤", () => {
  it("[P0] TypeError 應映射為網路連線中斷", () => {
    expect(getEnhancementErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "網路連線中斷",
    );
  });

  it("[P0] Tauri HTTP network error 應映射為網路連線中斷", () => {
    expect(
      getEnhancementErrorMessage(
        new Error("network error: connection refused"),
      ),
    ).toBe("網路連線中斷");
  });
});

describe("getHotkeyErrorMessage", () => {
  it("[P0] accessibility_permission 應映射為輔助使用權限", () => {
    expect(getHotkeyErrorMessage("accessibility_permission")).toBe(
      "需要輔助使用權限",
    );
  });

  it("[P0] hook_install_failed 應映射為快捷鍵初始化失敗", () => {
    expect(getHotkeyErrorMessage("hook_install_failed")).toBe(
      "快捷鍵初始化失敗",
    );
  });

  it("[P0] 未知錯誤碼應回傳通用快捷鍵錯誤", () => {
    expect(getHotkeyErrorMessage("unknown_error")).toBe("快捷鍵發生錯誤");
  });
});
