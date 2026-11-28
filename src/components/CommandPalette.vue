<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { Check, Search } from "lucide-vue-next";
import { ListboxFilter } from "reka-ui";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSettingsNavigation } from "@/composables/useSettingsNavigation";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useVocabularyStore } from "@/stores/useVocabularyStore";
import type { TranscriptionRecord } from "@/types/transcription";
import type { PreferencesTab } from "@/types/settings";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();
const { t } = useI18n();
const historyStore = useHistoryStore();
const settingsStore = useSettingsStore();
const vocabularyStore = useVocabularyStore();
const { isInSettings, openSettings } = useSettingsNavigation();
const query = ref("");
const selectedValue = ref("");
const records = ref<TranscriptionRecord[]>([]);
const latestText = ref<string | null>(null);
const isSearchComplete = ref(false);
const matchedRecordCount = ref(0);
const errorMessage = ref("");
let previousFocus: HTMLElement;
let openSeq = 0;
const settingsTabs: PreferencesTab[] = ["general", "hotkey", "ai", "mic", "advanced", "about"];
const modes = ["minimal", "active"] as const;
const shouldOpenModeSettings = computed(() => isInSettings.value || settingsStore.promptMode === "custom");
const canAddTerm = computed(() => isSearchComplete.value
  && matchedRecordCount.value === 0 && !vocabularyStore.isDuplicateTerm(query.value));

function matchesLabel(label: string) {
  return label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase());
}

// 群組只在有可見子項時渲染；全空且查詢已完成才顯示「沒有結果」（避免防抖期間閃一下）
const isCopyLastVisible = computed(() => Boolean(latestText.value?.trim()) && matchesLabel(t("commandPalette.copyLast")));
const isModeSettingsVisible = computed(() => shouldOpenModeSettings.value && matchesLabel(t("commandPalette.modeSettings")));
const visibleModes = computed(() => shouldOpenModeSettings.value ? [] : modes.filter((mode) => matchesLabel(t(`commandPalette.mode.${mode}`))));
const hasVisibleActions = computed(() => isCopyLastVisible.value || canAddTerm.value || isModeSettingsVisible.value || visibleModes.value.length > 0);
const visibleSettingsTabs = computed(() => settingsTabs.filter((tab) => matchesLabel(t(`preferences.tabs.${tab}`))));
const hasNoResults = computed(() => isSearchComplete.value && !records.value.length && !hasVisibleActions.value && !visibleSettingsTabs.value.length);

function getRecordText(record: TranscriptionRecord) {
  return record.processedText ?? record.rawText;
}

watch(() => props.open, async (open, _previous, onCleanup) => {
  openSeq++;
  if (!open) return;
  previousFocus = document.activeElement as HTMLElement;
  query.value = "";
  latestText.value = null;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  try {
    const text = await historyStore.fetchLatestSuccessfulText();
    if (!cancelled) latestText.value = text;
  } catch {
    if (!cancelled) errorMessage.value = t("commandPalette.loadFailed");
  }
});

watch([() => props.open, query], ([open, search], _previous, onCleanup) => {
  records.value = [];
  selectedValue.value = "";
  isSearchComplete.value = false;
  errorMessage.value = "";
  if (!open || !search.trim()) return;
  let cancelled = false;
  const timeout = setTimeout(async () => {
    try {
      const results = await historyStore.searchTranscriptionList(search, 8, 0);
      if (cancelled) return;
      matchedRecordCount.value = results.length;
      records.value = results.filter((record) => getRecordText(record).trim());
      isSearchComplete.value = true;
      selectedValue.value = records.value[0] ? `record-${records.value[0].id}` : "add-term";
    } catch {
      if (!cancelled) errorMessage.value = t("commandPalette.searchFailed");
    }
  }, 150);
  onCleanup(() => {
    cancelled = true;
    clearTimeout(timeout);
  });
});

async function runCommand(action: () => Promise<unknown>, successMessage?: string) {
  const commandOpenSeq = openSeq;
  try {
    await action();
    if (successMessage) toast.success(successMessage);
    if (commandOpenSeq === openSeq) emit("update:open", false);
  } catch {
    if (commandOpenSeq === openSeq) errorMessage.value = t("commandPalette.actionFailed");
  }
}

function restoreFocus() {
  previousFocus.focus();
}

function guardComposition(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    event.stopPropagation();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="gap-0 overflow-hidden p-0" :show-close-button="false" @close-auto-focus="restoreFocus">
      <DialogTitle class="sr-only">{{ t("commandPalette.title") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t("commandPalette.description") }}</DialogDescription>
      <Command v-model="selectedValue" @keydown.capture="guardComposition">
        <!-- 記錄由資料庫決定命中，不能再讓 CommandInput 依顯示文字過濾。 -->
        <div class="flex items-center gap-2 border-b px-3">
          <Search class="size-4 shrink-0 text-muted-foreground" />
          <!-- 篩選框直接當輸入框（同官方 CommandInput 的寫法）；不包 Input 元件，避免兩份值互相覆蓋造成每兩鍵吃一字 -->
          <ListboxFilter
            v-model="query"
            :placeholder="t('commandPalette.placeholder')"
            :aria-label="t('commandPalette.title')"
            class="flex h-12 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground"
          />
        </div>
        <CommandList class="h-[300px]">
          <CommandGroup v-if="records.length" :heading="t('commandPalette.records')">
            <CommandItem v-for="record in records" :key="record.id" :value="`record-${record.id}`" @select="runCommand(() => invoke('copy_to_clipboard', { text: getRecordText(record) }), t('commandPalette.copied'))">
              <span class="truncate">{{ getRecordText(record) }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="hasVisibleActions" :heading="t('commandPalette.actions')">
            <CommandItem v-if="isCopyLastVisible" value="copy-last" @select="runCommand(() => invoke('copy_to_clipboard', { text: latestText }), t('commandPalette.copied'))">
              {{ t("commandPalette.copyLast") }}
            </CommandItem>
            <CommandItem v-if="canAddTerm" value="add-term" @select="runCommand(() => vocabularyStore.addTerm(query.trim()), t('commandPalette.added'))">
              {{ t("commandPalette.addTerm", { term: query.trim() }) }}
            </CommandItem>
            <template v-if="shouldOpenModeSettings">
              <CommandItem v-if="isModeSettingsVisible" value="mode-settings" @select="runCommand(() => openSettings('ai'))">
                {{ t("commandPalette.modeSettings") }}
              </CommandItem>
            </template>
            <template v-else>
              <template v-for="mode in visibleModes" :key="mode">
                <CommandItem :value="`mode-${mode}`" @select="runCommand(() => settingsStore.savePromptMode(mode))">
                  {{ t(`commandPalette.mode.${mode}`) }}
                  <Check v-if="settingsStore.promptMode === mode" class="ml-auto size-4" :aria-label="t('commandPalette.currentMode')" />
                </CommandItem>
              </template>
            </template>
          </CommandGroup>
          <CommandGroup v-if="visibleSettingsTabs.length" :heading="t('commandPalette.settings')">
            <CommandItem v-for="tab in visibleSettingsTabs" :key="tab" :value="`settings-${tab}`" @select="runCommand(() => openSettings(tab))">
              {{ t(`preferences.tabs.${tab}`) }}
            </CommandItem>
          </CommandGroup>
          <p v-if="hasNoResults" data-testid="command-palette-empty" class="px-3 py-6 text-center text-sm text-muted-foreground">
            {{ t("commandPalette.noResults") }}
          </p>
        </CommandList>
        <p v-if="errorMessage" role="alert" class="px-3 py-2 text-sm text-destructive">{{ errorMessage }}</p>
      </Command>
    </DialogContent>
  </Dialog>
</template>
