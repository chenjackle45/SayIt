import i18n from "../i18n";
import { EnhancerApiError } from "./enhancer";

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

export function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getMicrophoneErrorMessage(error: unknown): string {
  // Rust AudioRecorderError 字串匹配（透過 Tauri invoke 傳來的字串錯誤）
  const message = extractErrorMessage(error);
  if (message.includes("No input device")) {
    return t("errors.mic.notFound");
  }
  if (message.includes("Failed to build audio stream")) {
    return t("errors.mic.busy");
  }
  if (message.includes("Failed to get input config")) {
    return t("errors.mic.configFailed");
  }

  // 瀏覽器 DOMException（備用）
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return t("errors.mic.permission");
      case "NotFoundError":
        return t("errors.mic.notFound");
      case "NotReadableError":
        return t("errors.mic.busy");
      default:
        return t("errors.mic.default");
    }
  }

  return t("errors.mic.default");
}

const NETWORK_ERROR_PATTERN =
  /network|connect|dns|resolve|offline|timed?\s*out|ECONNREFUSED|ENOTFOUND|os error/i;

export function getTranscriptionErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return t("errors.network");
  }

  // Rust TranscriptionError 透過 Tauri invoke 以「字串」reject（serialize_str），
  // 不能依賴 error instanceof Error；一律用 extractErrorMessage 取訊息字串比對。
  const message = extractErrorMessage(error);

  // ApiError 的 Display 為 "Groq API returned error ({status}): {body}"
  //（同時相容舊字串 "Groq API error"）
  const isApiStatusError = /Groq API (?:returned )?error/i.test(message);

  if (message.includes("Audio file too large")) {
    return t("errors.transcription.fileTooLarge");
  }

  // 先判 API 狀態碼（避免 body 含 network 字眼被誤判為網路錯誤）
  if (isApiStatusError) {
    const statusMatch = message.match(/\((\d+)\)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      if (status === 400) return t("errors.transcription.invalidAudio");
      if (status === 401) return t("errors.transcription.invalidApiKey");
      if (status === 429) return t("errors.transcription.rateLimited");
      if (status >= 500) return t("errors.transcription.serviceUnavailable");
    }
    return t("errors.transcription.failed");
  }

  // 網路/傳輸層失敗：RequestFailed 的 Display 為 "Groq API request failed: ..."，
  // 或含一般網路關鍵字（connect/dns/timeout/os error…）
  if (
    message.includes("Groq API request failed") ||
    NETWORK_ERROR_PATTERN.test(message)
  ) {
    return t("errors.network");
  }

  if (message.includes("MediaRecorder")) {
    return t("errors.transcription.recorderError");
  }

  return t("errors.transcription.operationFailed");
}

export function getEnhancementErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return t("errors.network");
  }

  if (error instanceof EnhancerApiError) {
    if (error.body.includes("model_decommissioned")) {
      return t("errors.enhancement.modelDecommissioned");
    }
    const status = error.statusCode;
    const mappedBase =
      status === 401
        ? t("errors.enhancement.invalidApiKey")
        : status === 429
          ? t("errors.enhancement.rateLimited")
          : status === 400
            ? t("errors.enhancement.badRequest")
            : status >= 500
              ? t("errors.enhancement.serviceUnavailable")
              : null;
    // 已映射的狀態碼也附上 HTTP code，自訂端點除錯時一眼可見
    if (mappedBase) return `${mappedBase} (HTTP ${status})`;
    // 未映射的狀態碼（如 402/403/404）：附上狀態碼與回應 body 摘要
    //（EnhancerApiError 的 message 不含 body，必須顯式取用）
    const bodySnippet = truncateErrorDetail(error.body);
    return `${t("errors.enhancement.failed")} (HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ""})`;
  }

  if (error instanceof Error) {
    if (NETWORK_ERROR_PATTERN.test(error.message)) {
      return t("errors.network");
    }

    if ((error as Error & { code?: string }).code === "ENHANCEMENT_TIMEOUT") {
      return t("errors.enhancement.timeout");
    }
  }

  // 兜底：附上原始錯誤摘要（狀態碼／回應片段），自訂端點除錯時才看得出原因
  return `${t("errors.enhancement.failed")}: ${truncateErrorDetail(extractErrorMessage(error))}`;
}

/**
 * 錯誤詳情摘要：壓縮空白、截斷，避免把整頁 HTML 灌進 UI。
 */
export function truncateErrorDetail(message: string, maxLength = 160): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…`;
}

const HOTKEY_ERROR_KEY_MAP: Record<string, string> = {
  accessibility_permission: "errors.hotkey.accessibilityPermission",
  hook_install_failed: "errors.hotkey.hookInstallFailed",
};

export function getHotkeyErrorMessage(errorCode: string): string {
  const key = HOTKEY_ERROR_KEY_MAP[errorCode];
  return key ? t(key) : t("errors.hotkey.default");
}

export function getHotkeyConflictWarning(displayName: string): string {
  return t("errors.hotkey.conflictWarning", { displayName });
}

export function getHotkeyCapslockWarning(): string {
  return t("errors.hotkey.capslockWarning");
}

export function getHotkeyPresetHint(): string {
  return t("errors.hotkey.presetHint");
}

export function getHotkeyRecordingTimeoutMessage(): string {
  return t("errors.hotkey.recordingTimeout");
}

export function getHotkeyUnsupportedKeyMessage(): string {
  return t("errors.hotkey.unsupportedKey");
}
