<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/useSettingsStore";

// 側欄底部狀態：是否就緒、怎麼開始說話、目前整理服務與模式。
// 一律讀實際設定（不寫死 Right ⌘），快捷鍵或模式在任何視窗改了都會跟著更新。
const { t } = useI18n();
const settingsStore = useSettingsStore();

const isReady = computed(() => settingsStore.hasApiKey);

const triggerKeyLabel = computed(() => {
  const key = settingsStore.hotkeyConfig?.triggerKey;
  return key ? settingsStore.getTriggerKeyDisplayName(key) : "";
});

const talkHint = computed(() =>
  settingsStore.triggerMode === "toggle"
    ? t("mainApp.status.pressToTalk")
    : t("mainApp.status.holdToTalk"),
);

const promptModeLabel = computed(() => {
  switch (settingsStore.promptMode) {
    case "active":
      return t("settings.prompt.modeActive");
    case "custom":
      return t("settings.prompt.modeCustom");
    default:
      return t("settings.prompt.modeMinimal");
  }
});
</script>

<template>
  <div class="flex flex-col gap-1 text-xs" data-testid="sidebar-status">
    <div class="flex items-center gap-1.5 font-medium text-sidebar-foreground">
      <span
        class="size-2 rounded-full"
        :class="isReady ? 'bg-success' : 'bg-warning'"
        aria-hidden="true"
      />
      <span>{{ isReady ? $t("mainApp.status.ready") : $t("mainApp.status.needsApiKey") }}</span>
    </div>
    <div v-if="triggerKeyLabel" class="flex flex-wrap items-center gap-1 text-muted-foreground">
      <span>{{ talkHint }}</span>
      <kbd
        class="rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-px font-sans text-[11px] text-sidebar-foreground"
      >{{ triggerKeyLabel }}</kbd>
    </div>
    <div class="text-muted-foreground">
      {{ settingsStore.llmProviderDisplayName }} · {{ promptModeLabel }}
    </div>
  </div>
</template>
