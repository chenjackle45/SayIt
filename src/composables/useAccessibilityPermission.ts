import { invoke } from "@tauri-apps/api/core";
import { ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useI18n } from "vue-i18n";
import { captureError } from "@/lib/sentry";

const PERMISSION_CHECK_INTERVAL_MS = 2000;

export function useAccessibilityPermission(
  active: MaybeRefOrGetter<boolean>,
  onGranted?: () => void,
) {
  const hasPermission = ref(false);
  const isReinitializing = ref(false);
  const reinitializeError = ref<string | null>(null);
  const { t } = useI18n();

  watch(
    () => toValue(active),
    (isActive, _previous, onCleanup) => {
      hasPermission.value = false;
      isReinitializing.value = false;
      reinitializeError.value = null;
      if (!isActive) return;

      let isCancelled = false;
      let isChecking = false;
      const pollingTimer = setInterval(
        () => void checkPermission(),
        PERMISSION_CHECK_INTERVAL_MS,
      );

      onCleanup(() => {
        isCancelled = true;
        clearInterval(pollingTimer);
      });

      async function checkPermission() {
        if (isChecking) return;
        isChecking = true;
        try {
          const granted = await invoke<boolean>(
            "check_accessibility_permission_command",
          );
          if (isCancelled || !granted) return;

          clearInterval(pollingTimer);
          isReinitializing.value = true;
          await invoke("reinitialize_hotkey_listener");
          if (isCancelled) return;

          hasPermission.value = true;
          onGranted?.();
        } catch (error) {
          if (isCancelled) return;
          const step = isReinitializing.value
            ? "reinitialize"
            : "check-permission";
          console.error(
            isReinitializing.value
              ? "[accessibility-guide] Reinitialize failed:"
              : "[accessibility-guide] Permission check failed:",
            error,
          );
          captureError(error, { source: "accessibility", step });
          if (isReinitializing.value) {
            reinitializeError.value = t("accessibility.reinitializeError");
          }
        } finally {
          isChecking = false;
          if (!isCancelled) isReinitializing.value = false;
        }
      }

      void checkPermission();
    },
    { immediate: true, flush: "sync" },
  );

  async function openSettings() {
    try {
      await invoke("open_accessibility_settings");
    } catch (error) {
      console.error("[accessibility-guide] Failed to open settings:", error);
      captureError(error, { source: "accessibility", step: "open-settings" });
    }
  }

  return { hasPermission, isReinitializing, reinitializeError, openSettings };
}
