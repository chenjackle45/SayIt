import { describe, expect, it } from "vitest";
import {
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
    expect(getTranscriptionErrorMessage(error)).toBe(
      "請求過於頻繁，請稍後再試",
    );
  });

  it("[P0] Groq API 500+ 應映射為服務暫時無法使用", () => {
    const error = new Error("Groq API error (500): Internal Server Error");
    expect(getTranscriptionErrorMessage(error)).toBe(
      "語音轉錄服務暫時無法使用",
    );
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
});
