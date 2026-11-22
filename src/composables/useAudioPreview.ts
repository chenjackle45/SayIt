import { ref, onUnmounted } from "vue";
import { useRafFn } from "@vueuse/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { listenToEvent, AUDIO_PREVIEW_LEVEL } from "./useTauriEvents";
import type { AudioPreviewLevelPayload } from "../types/audio";

const LERP_SPEED = 0.2;

function lerp(current: number, target: number, speed: number): number {
  return current + (target - current) * speed;
}

export function useAudioPreview() {
  const previewLevel = ref(0);
  const isPreviewActive = ref(false);
  let targetLevel = 0;
  let unlistenPreview: UnlistenFn | null = null;
  let startRequestId = 0;

  const { pause, resume } = useRafFn(
    () => {
      previewLevel.value = lerp(previewLevel.value, targetLevel, LERP_SPEED);
    },
    { immediate: false },
  );

  async function startPreview(deviceName: string): Promise<void> {
    const currentRequestId = ++startRequestId;
    await stopPreviewOutput();

    // F12 fix: 如果在 stopPreview 期間有新的 startPreview 呼叫，放棄本次
    if (currentRequestId !== startRequestId) return;

    try {
      await invoke("start_audio_preview", { deviceName });
      if (currentRequestId !== startRequestId) return;

      const nextUnlisten = await listenToEvent<AudioPreviewLevelPayload>(
        AUDIO_PREVIEW_LEVEL,
        (event) => {
          targetLevel = event.payload.level;
        },
      );

      // 再次檢查：如果期間被取消，立即清理新建的 listener
      if (currentRequestId !== startRequestId) {
        nextUnlisten();
        return;
      }

      unlistenPreview = nextUnlisten;
      isPreviewActive.value = true;
      resume();
    } catch (err) {
      console.error("[useAudioPreview] start failed:", err);
    }
  }

  async function stopPreviewOutput(): Promise<void> {
    isPreviewActive.value = false;
    pause();
    targetLevel = 0;
    previewLevel.value = 0;
    if (unlistenPreview) {
      unlistenPreview();
      unlistenPreview = null;
    }
    try {
      await invoke("stop_audio_preview");
    } catch {
      /* ignore — preview may not be running */
    }
  }

  /** 停止預覽，並作廢還在等待中的 startPreview（否則它完成後會把預覽重新打開） */
  function stopPreview(): Promise<void> {
    startRequestId += 1;
    return stopPreviewOutput();
  }

  onUnmounted(() => {
    void stopPreview();
  });

  return { previewLevel, isPreviewActive, startPreview, stopPreview };
}
