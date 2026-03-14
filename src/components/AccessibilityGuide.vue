<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/sentry";
import { ShieldCheck, ExternalLink } from "lucide-vue-next";

const PERMISSION_CHECK_INTERVAL_MS = 2000;

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDivElement | null>(null);
const primaryButtonRef = ref<InstanceType<typeof Button> | null>(null);
const isReinitializing = ref(false);
const reinitializeError = ref<string | null>(null);
const { t } = useI18n();
const stepKeyList = [
  "accessibility.step1",
  "accessibility.step2",
  "accessibility.step3",
] as const;

let pollingTimer: ReturnType<typeof setInterval> | null = null;

function startPermissionPolling() {
  stopPermissionPolling();
  pollingTimer = setInterval(async () => {
    if (isReinitializing.value) return;
    try {
      const hasPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      if (hasPermission) {
        stopPermissionPolling();
        await handlePermissionGranted();
      }
    } catch (error) {
      console.error("[accessibility-guide] Permission check failed:", error);
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }, PERMISSION_CHECK_INTERVAL_MS);
}

function stopPermissionPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function handlePermissionGranted() {
  isReinitializing.value = true;
  reinitializeError.value = null;
  try {
    await invoke("reinitialize_hotkey_listener");
    emit("close");
  } catch (error) {
    console.error("[accessibility-guide] Reinitialize failed:", error);
    captureError(error, { source: "accessibility", step: "reinitialize" });
    reinitializeError.value = t("accessibility.reinitializeError");
  } finally {
    isReinitializing.value = false;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      reinitializeError.value = null;
      nextTick(() => {
        const el = primaryButtonRef.value?.$el as HTMLElement | undefined;
        el?.focus();
      });
      startPermissionPolling();
    } else {
      stopPermissionPolling();
    }
  },
);

onBeforeUnmount(() => {
  stopPermissionPolling();
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
    return;
  }

  if (event.key === "Tab" && dialogRef.value) {
    const focusableList =
      dialogRef.value.querySelectorAll<HTMLElement>("button");
    if (focusableList.length === 0) return;

    const firstElement = focusableList[0];
    const lastElement = focusableList[focusableList.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}

async function handleOpenAccessibilitySettings() {
  try {
    await invoke("open_accessibility_settings");
  } catch (error) {
    console.error("[accessibility-guide] Failed to open settings:", error);
    captureError(error, { source: "accessibility", step: "open-settings" });
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="dialogRef"
    role="dialog"
    aria-modal="true"
    aria-labelledby="accessibility-guide-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @keydown="handleKeydown"
  >
    <div class="mx-4 flex w-[420px] flex-col gap-5 rounded-2xl bg-card p-6 shadow-2xl">
      <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/12">
        <ShieldCheck class="h-6 w-6 text-warning" />
      </div>

      <h2
        id="accessibility-guide-title"
        class="text-xl font-bold text-foreground"
      >
        {{ $t("accessibility.title") }}
      </h2>

      <p class="text-sm leading-relaxed text-muted-foreground">
        {{ $t("accessibility.description") }}
      </p>

      <div class="flex flex-col gap-3 pl-1">
        <div v-for="(stepKey, index) in stepKeyList" :key="stepKey" class="flex items-center gap-2.5">
          <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            {{ index + 1 }}
          </div>
          <span class="text-sm leading-normal text-foreground">{{ $t(stepKey) }}</span>
        </div>
      </div>

      <p v-if="isReinitializing" class="text-sm text-primary">
        {{ $t("accessibility.reinitializing") }}
      </p>
      <p v-if="reinitializeError" class="text-sm text-destructive">
        {{ reinitializeError }}
      </p>

      <div class="flex flex-col gap-2">
        <Button
          ref="primaryButtonRef"
          class="h-11 w-full rounded-[10px]"
          :disabled="isReinitializing"
          @click="handleOpenAccessibilitySettings"
        >
          <ExternalLink class="h-4 w-4" />
          {{ $t("accessibility.openSettings") }}
        </Button>
        <Button
          variant="ghost"
          class="h-11 w-full rounded-[10px] text-muted-foreground"
          :disabled="isReinitializing"
          @click="emit('close')"
        >
          {{ $t("accessibility.later") }}
        </Button>
      </div>
    </div>
  </div>
</template>
