import { onBeforeUnmount, onMounted } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listenToEvent, SETTINGS_UPDATED } from "./useTauriEvents";
import { useSettingsStore } from "../stores/useSettingsStore";

// 其他視窗（HUD 雙擊切整理模式、偏好設定視窗）存了設定後，本視窗只 refresh 記憶體：
// 不重跑 loadSettings（那會送 update_hotkey_config 重設錄音按鍵狀態），也不反向 emit。
// 例外：「隱藏 Dock 圖示」值有變時 refresh 會冪等地重套一次（#82 的既有跨視窗同步設計）。
export function useCrossWindowSettingsSync() {
  const settingsStore = useSettingsStore();
  let unlisten: UnlistenFn | null = null;
  let isUnmounted = false;

  onMounted(async () => {
    const fn = await listenToEvent(SETTINGS_UPDATED, () => {
      void settingsStore.refreshCrossWindowSettings();
    });
    if (isUnmounted) {
      fn();
      return;
    }
    unlisten = fn;
  });

  onBeforeUnmount(() => {
    isUnmounted = true;
    unlisten?.();
    unlisten = null;
  });
}
