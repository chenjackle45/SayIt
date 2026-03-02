export function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const MICROPHONE_DEFAULT_ERROR = "麥克風初始化失敗";

export function getMicrophoneErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return MICROPHONE_DEFAULT_ERROR;
  }

  switch (error.name) {
    case "NotAllowedError":
      return "需要麥克風權限才能錄音";
    case "NotFoundError":
      return "未偵測到麥克風裝置";
    case "NotReadableError":
      return "麥克風被其他程式佔用";
    default:
      return MICROPHONE_DEFAULT_ERROR;
  }
}

export function getTranscriptionErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "網路連線中斷";
  }

  if (error instanceof Error) {
    if (error.message.includes("Groq API error")) {
      const statusMatch = error.message.match(/\((\d+)\)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        if (status === 401) return "API Key 無效或已過期";
        if (status === 429) return "請求過於頻繁，請稍後再試";
        if (status >= 500) return "語音轉錄服務暫時無法使用";
      }
      return "語音轉錄失敗";
    }

    if (error.message.includes("MediaRecorder")) {
      return "錄音裝置發生錯誤";
    }
  }

  return "操作失敗";
}

export const API_KEY_MISSING_ERROR =
  "API Key 未設定，請至設定頁面輸入 Groq API Key";
