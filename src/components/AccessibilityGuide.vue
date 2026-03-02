<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDivElement | null>(null);
const primaryButtonRef = ref<HTMLButtonElement | null>(null);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      nextTick(() => primaryButtonRef.value?.focus());
    }
  },
);

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
    <div class="mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
      <h2
        id="accessibility-guide-title"
        class="text-xl font-semibold text-zinc-900"
      >
        需要輔助使用權限
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-zinc-700">
        SayIt 需要「輔助使用」權限來監聽全域快捷鍵。若未授權，快捷鍵功能將無法使用。
      </p>
      <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-700">
        <li>點擊下方按鈕開啟系統設定。</li>
        <li>在清單中找到 SayIt 並勾選。</li>
        <li>回到 App 後重新啟動程式。</li>
      </ol>

      <div class="mt-6 flex gap-3">
        <button
          ref="primaryButtonRef"
          type="button"
          class="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          @click="handleOpenAccessibilitySettings"
        >
          開啟系統設定
        </button>
        <button
          type="button"
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          @click="emit('close')"
        >
          稍後設定
        </button>
      </div>
    </div>
  </div>
</template>
