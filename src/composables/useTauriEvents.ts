import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export {
  emit as emitEvent,
  emitTo as emitToWindow,
} from "@tauri-apps/api/event";
export { listen as listenToEvent } from "@tauri-apps/api/event";

export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const SETTINGS_UPDATED = "settings:updated" as const;
export const VOCABULARY_CHANGED = "vocabulary:changed" as const;

export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;

export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;

export const AUDIO_WAVEFORM = "audio:waveform" as const;
export const AUDIO_PREVIEW_LEVEL = "audio:preview-level" as const;

export const CORRECTION_MONITOR_RESULT = "correction-monitor:result" as const;
export const VOCABULARY_LEARNED = "vocabulary:learned" as const;
export const ESCAPE_PRESSED = "escape:pressed" as const;
export const HOTKEY_MODE_TOGGLE = "hotkey:mode-toggle" as const;
export const HOTKEY_RECORDING_CAPTURED = "hotkey:recording-captured" as const;
export const HOTKEY_RECORDING_REJECTED = "hotkey:recording-rejected" as const;

// Dashboard 完成 DB migration 後廣播；HUD 收到才開始存取連線池
export const DATABASE_READY = "database:ready" as const;
// HUD 請 Dashboard 重新廣播 DATABASE_READY（解決事件早於監聽的競態）
export const DATABASE_READY_PING = "database:ready-ping" as const;

/**
 * HUD 等待 Dashboard 完成資料庫 migration 後再存取連線池。
 *
 * 動機：tauri-plugin-sql 連線池無連線親和性，若 HUD 在 Dashboard 跑
 * migration 時併發存取同一個 pool，會強迫 pool 多開一條連線，破壞
 * migration 的跨語句假設（曾導致 "cannot commit - no transaction is active"）。
 *
 * 以 ping/replay 解決「Dashboard 早於 HUD 監聽就已廣播」的競態；逾時則
 * 回傳 false，呼叫端可 fallback 至 connectToDatabase() 的 retry 迴圈
 *（Dashboard 缺席或 init 失敗時 HUD 仍可嘗試自行連線）。
 */
export async function waitForDatabaseReady(timeoutMs = 8000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unlisten: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
      resolve(ready);
    };

    void listen(DATABASE_READY, () => finish(true)).then((fn) => {
      unlisten = fn;
      // 監聽建立前就逾時：立即解除剛建立的監聽
      if (settled) {
        fn();
        return;
      }
      // 監聽就緒後請 Dashboard 重新廣播，補捉早於監聽的 ready 事件
      void emit(DATABASE_READY_PING);
    });

    timer = setTimeout(() => finish(false), timeoutMs);
  });
}
