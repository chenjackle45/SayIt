/**
 * 自訂鍵錄製流程（從 SettingsView 抽出，gh-78）。
 * 契約：每輪最多一個終態回呼（captured／rejected／timeout／startFailed）。
 * 終態進入前先檢查「仍在錄製且是當輪」，通過即同步完成本地終止再回呼；
 * 晚到的（另一來源、舊輪 callback、舊 timeout、舊 start 的 resolve／reject、舊 listener 註冊）全部被擋或自卸。
 */
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
  listenToEvent,
} from "./useTauriEvents";
import { createDomHotkeyRecorder } from "./useDomHotkeyRecorder";
import type { RecordingCapturedPayload, RecordingRejectedPayload } from "../types/events";

const RECORDING_TIMEOUT_MS = 10_000;

export interface HotkeyRecordingSessionOptions {
  /** Windows 才開：SayIt 視窗有焦點時 hook 收不到鍵（gh-78）。 */
  enableDomSource: boolean;
  onCaptured: (payload: RecordingCapturedPayload) => void;
  onRejected: (payload: RecordingRejectedPayload) => void;
  onTimeout: () => void;
  onStartFailed: (error: unknown) => void;
}

// 日誌前綴要維持 "[SettingsView] hotkey"：Rust 診斷緩衝只收這個前綴（logging.rs HOTKEY_DIAG_PREFIXES）
const LOG_PREFIX = "[SettingsView] hotkey recording:";

export function useHotkeyRecordingSession(options: HotkeyRecordingSessionOptions) {
  const isRecording = ref(false);
  let requestSeq = 0;
  let unlisteners: UnlistenFn[] = [];
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const domRecorder = createDomHotkeyRecorder();

  function isCurrent(requestId: number): boolean {
    return isRecording.value && requestId === requestSeq;
  }

  /** 同步完成本地終止；cancel IPC 只發出不等待，其完成不改任何狀態。 */
  function terminate() {
    isRecording.value = false;
    clearTimeout(timeoutId);
    timeoutId = undefined;
    domRecorder.stop();
    for (const unlisten of unlisteners) unlisten();
    unlisteners = [];
    void invoke("cancel_hotkey_recording").catch(() => {});
  }

  function finish(requestId: number, deliver: () => void) {
    if (!isCurrent(requestId)) return;
    terminate();
    deliver();
  }

  async function start(): Promise<void> {
    if (isRecording.value) terminate();
    const requestId = ++requestSeq;
    isRecording.value = true;

    if (options.enableDomSource) {
      // 立刻掛上：blur 從按下「錄製」這一刻就在聽，等待 Tauri listener 註冊期間切走也算失焦
      const armed = domRecorder.start({
        onCaptured: (payload) =>
          finish(requestId, () => {
            console.info(`${LOG_PREFIX} dom captured keycode=0x${payload.keycode.toString(16)}`);
            options.onCaptured(payload);
          }),
        onRejected: (payload) =>
          finish(requestId, () => {
            console.info(`${LOG_PREFIX} dom rejected reason=${payload.reason}`);
            options.onRejected(payload);
          }),
      });
      console.info(`${LOG_PREFIX} dom source ${armed ? "armed" : "skipped (no focus)"}`);
    }

    // 每個註冊結果各自歸屬當輪：仍是當輪才收進清理清單，否則（已終結、已被 B 取代）立刻自卸
    const adopt = (unlisten: UnlistenFn) => {
      if (isCurrent(requestId)) unlisteners.push(unlisten);
      else unlisten();
    };
    // gh-30：先掛好 listener 再叫 Rust 進錄製模式，否則中間發出的 captured 會漏接（Tauri 不補播）
    const registrations = await Promise.allSettled([
      listenToEvent<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED, (event) =>
        finish(requestId, () => {
          console.info(`${LOG_PREFIX} captured received keycode=0x${event.payload.keycode.toString(16)}`);
          options.onCaptured(event.payload);
        }),
      ).then(adopt),
      listenToEvent<RecordingRejectedPayload>(HOTKEY_RECORDING_REJECTED, (event) =>
        finish(requestId, () => {
          console.info(`${LOG_PREFIX} rejected reason=${event.payload.reason}`);
          options.onRejected(event.payload);
        }),
      ).then(adopt),
    ]);
    const failed = registrations.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      // 一成一敗：成功者已在清單（或已自卸），走同一條終態路徑回收
      finish(requestId, () => {
        console.info(`${LOG_PREFIX} listen failed`);
        options.onStartFailed(failed.reason);
      });
      return;
    }
    if (!isCurrent(requestId)) return; // 註冊期間已終結或已被取代：listener 已由 adopt 自卸，不啟動 Rust
    console.info(`${LOG_PREFIX} listeners ready`);

    try {
      await invoke("start_hotkey_recording");
    } catch (err) {
      finish(requestId, () => {
        console.info(`${LOG_PREFIX} start failed`);
        options.onStartFailed(err);
      });
      return;
    }
    if (!isCurrent(requestId)) return;

    timeoutId = setTimeout(() => {
      finish(requestId, () => {
        console.info(`${LOG_PREFIX} timeout fired`);
        options.onTimeout();
      });
    }, RECORDING_TIMEOUT_MS);
  }

  function stop() {
    if (!isRecording.value) return;
    terminate();
  }

  return { isRecording, start, stop };
}
