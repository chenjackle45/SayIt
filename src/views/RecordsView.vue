<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMediaQuery } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import { useQuotaSummary } from "../composables/useQuotaSummary";
import { groupRecordsByDay } from "../composables/useRecordGroups";
import type { TranscriptionRecord } from "../types/transcription";
import {
  getDisplayText,
  formatDuration,
  formatDurationMs,
  formatDurationFromMs,
  formatNumber,
} from "../lib/formatUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle,
  Check,
  Copy,
  Info,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-vue-next";
import { captureError } from "../lib/sentry";

const { t, locale } = useI18n();
const historyStore = useHistoryStore();
const {
  hasAnyPaidProvider,
  isQuotaHiddenLlmProvider,
  quotaDimensionList,
  hasFreeQuota,
  paidUsageList,
  quotaRemainingPercent,
  quotaBottleneckLabel,
  quotaBarColorClass,
} = useQuotaSummary();

const SEARCH_DEBOUNCE_MS = 300;
const COPIED_FEEDBACK_MS = 2500;

const searchInput = ref("");
const selectedId = ref<string | null>(null);
const showRawText = ref(false);
const copiedKey = ref<string | null>(null);
const retryError = ref<{ id: string; key: string } | null>(null);
const nowMs = ref(Date.now());
const listRef = ref<HTMLElement | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);
const isSentinelVisible = ref(false);
// 補頁失敗就停住自動補頁；使用者按「重試載入」、搜尋或重新整理才恢復（避免同一頁無限重查）
const isAutoLoadPaused = ref(false);
// 頁面自己的「補頁中」旗標：錯誤處理完（暫停旗標設好）才放開，watcher 才不會搶在前面重查
const isLoadMoreInFlight = ref(false);
// 視窗窄於 840px：細節窗格收成可切換的右側抽屜
const isNarrow = useMediaQuery("(max-width: 839px)");
const isDetailDrawerOpen = ref(false);

// 播放：同時只有一段；換選取或離開頁面就停
const playingId = ref<string | null>(null);
const playProgress = ref(0);
const playElapsedMs = ref(0);
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
let unlistenTranscriptionCompleted: UnlistenFn | null = null;

const retryingId = computed(() => historyStore.retryingId);
const retryingAction = computed(() => historyStore.retryingAction);
const recordList = computed(() => historyStore.transcriptionList);
const dayGroupList = computed(() =>
  groupRecordsByDay(recordList.value, nowMs.value),
);
// 選取只存 id：store 重抓或重試會換掉物件，細節一律從當下列表推導
const selectedRecord = computed(
  () => recordList.value.find((r) => r.id === selectedId.value) ?? null,
);
const hasDistinctRawText = computed(() => {
  const r = selectedRecord.value;
  return !!r && r.wasEnhanced && !!r.processedText && r.processedText !== r.rawText;
});
const detailText = computed(() => {
  const r = selectedRecord.value;
  if (!r) return "";
  return showRawText.value && hasDistinctRawText.value ? r.rawText : getDisplayText(r);
});
const stats = computed(() => historyStore.dashboardStats);
const avgCharacters = computed(() =>
  stats.value.totalTranscriptions > 0
    ? Math.round(stats.value.totalCharacters / stats.value.totalTranscriptions)
    : 0,
);

function formatDayLabel(kind: string, dayStartMs: number): string {
  if (kind === "today") return t("records.today");
  if (kind === "yesterday") return t("records.yesterday");
  return new Date(dayStartMs).toLocaleDateString(locale.value, {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(locale.value, {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatClockSeconds(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function isFailed(record: TranscriptionRecord): boolean {
  return record.status === "failed";
}

function canRetranscribe(record: TranscriptionRecord): boolean {
  return !!record.audioFilePath && !record.isEditMode && retryingId.value === null;
}

function canReEnhance(record: TranscriptionRecord): boolean {
  return !!record.rawText.trim() && !record.isEditMode && retryingId.value === null;
}

function isRetrying(record: TranscriptionRecord, action: "transcribe" | "enhance") {
  return retryingId.value === record.id && retryingAction.value === action;
}

// ── 選取與鍵盤 ──

function selectRecord(id: string, shouldScroll = false) {
  selectedId.value = id;
  if (!shouldScroll) return;
  void nextTick(() => {
    document.getElementById(`record-${id}`)?.scrollIntoView?.({ block: "nearest" });
  });
}

function handleRowClick(id: string) {
  selectRecord(id);
  if (isNarrow.value) isDetailDrawerOpen.value = true;
}

function moveSelection(delta: number) {
  const list = recordList.value;
  if (list.length === 0) return;
  const index = list.findIndex((r) => r.id === selectedId.value);
  const next = Math.max(0, Math.min(list.length - 1, (index < 0 ? 0 : index) + delta));
  selectRecord(list[next].id, true);
  // 按到最後一筆時順手載下一頁（列高變矮後，捲動不一定觸發 sentinel）
  if (next === list.length - 1) void loadMoreSafely();
}

function hasTextSelection(): boolean {
  const selection = window.getSelection?.();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== "";
}

// 鍵盤只掛在清單上：搜尋框、選單聚焦時自然讓位；另擋 IME 組字與文字選取
function handleListKeydown(event: KeyboardEvent) {
  // 列內按鈕（例如失敗列的重試）收到的按鍵交給按鈕自己處理
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (hasTextSelection()) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === "Enter") {
    const r = selectedRecord.value;
    if (!r || isFailed(r)) return;
    event.preventDefault();
    void copyText(r.id, getDisplayText(r));
  }
}

// ── 複製、刪除、重試 ──

async function copyText(key: string, text: string) {
  try {
    await invoke("copy_to_clipboard", { text });
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedKey.value = key;
    copiedTimer = setTimeout(() => {
      copiedKey.value = null;
    }, COPIED_FEEDBACK_MS);
  } catch {
    // clipboard write may fail in some contexts, silently ignore
  }
}

async function handleDelete(record: TranscriptionRecord) {
  try {
    // 刪掉後選取由列表 watcher 退回現存第一筆
    await historyStore.deleteTranscription(record.id);
    void historyStore.refreshDashboard();
  } catch {
    // DB 刪除失敗，靜默處理（Sentry 已在 store 層捕獲）
  }
}

async function handleRetranscribe(record: TranscriptionRecord) {
  if (!canRetranscribe(record)) return;
  retryError.value = null;
  const result = await historyStore.retranscribeRecord(record);
  if (result.ok) {
    void historyStore.refreshDashboard();
  } else {
    retryError.value = { id: record.id, key: result.errorKey ?? "history.retranscribeFailed" };
  }
}

async function handleReEnhance(record: TranscriptionRecord) {
  if (!canReEnhance(record)) return;
  retryError.value = null;
  const result = await historyStore.reEnhanceRecord(record);
  if (result.ok) {
    void historyStore.refreshDashboard();
  } else {
    retryError.value = { id: record.id, key: result.errorKey ?? "history.reEnhanceFailed" };
  }
}

// ── 播放 ──

function cleanupAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  playProgress.value = 0;
  playElapsedMs.value = 0;
}

function stopPlayback() {
  cleanupAudio();
  playingId.value = null;
}

async function togglePlayback(record: TranscriptionRecord) {
  if (playingId.value === record.id) {
    stopPlayback();
    return;
  }
  stopPlayback();
  if (!record.audioFilePath) return;
  playingId.value = record.id;
  try {
    // macOS WKWebView IPC 回傳 number[]，非 macOS 回傳 ArrayBuffer
    const raw = await invoke<number[]>("read_recording_file", { id: record.id });
    if (playingId.value !== record.id) return;
    const blob = new Blob([new Uint8Array(raw)], { type: "audio/wav" });
    currentBlobUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentBlobUrl);
    currentAudio = audio;
    audio.addEventListener("timeupdate", () => {
      if (currentAudio !== audio) return;
      playElapsedMs.value = audio.currentTime * 1000;
      const totalMs = Number.isFinite(audio.duration)
        ? audio.duration * 1000
        : record.recordingDurationMs;
      playProgress.value = totalMs > 0 ? Math.min(1, playElapsedMs.value / totalMs) : 0;
    });
    audio.addEventListener("ended", stopPlayback);
    audio.addEventListener("error", stopPlayback);
    await audio.play();
  } catch (err) {
    stopPlayback();
    captureError(err, { source: "records-view", step: "play-recording" });
  }
}

// ── 載入 ──

function handleSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    historyStore.searchQuery = searchInput.value;
    isAutoLoadPaused.value = false;
    void historyStore.resetAndFetch();
  }, SEARCH_DEBOUNCE_MS);
}

async function loadMoreSafely() {
  if (
    !historyStore.hasMore ||
    historyStore.isLoading ||
    isLoadMoreInFlight.value ||
    isAutoLoadPaused.value
  ) {
    return;
  }
  isLoadMoreInFlight.value = true;
  try {
    await historyStore.loadMore();
    // 新列可能已把 sentinel 推出畫面：先當成不可見，請 observer 依實際版面重新回報，
    // 仍看得到才補下一頁（每頁都等一次真實量測，不會在微任務裡連續暴衝）
    isSentinelVisible.value = false;
    await nextTick();
    if (observer && sentinelRef.value) {
      observer.unobserve(sentinelRef.value);
      observer.observe(sentinelRef.value);
    }
  } catch (err) {
    isAutoLoadPaused.value = true;
    captureError(err, { source: "records-view", step: "load-more" });
  } finally {
    isLoadMoreInFlight.value = false;
  }
}

function retryLoadMore() {
  isAutoLoadPaused.value = false;
  void loadMoreSafely();
}

async function refreshAll() {
  nowMs.value = Date.now();
  isAutoLoadPaused.value = false;
  await Promise.all([historyStore.resetAndFetch(), historyStore.refreshDashboard()]);
}

// 主視窗常駐隱藏：隔天再打開時「今天」分組與統計要重算
function handleWindowFocus() {
  const previous = new Date(nowMs.value).toDateString();
  nowMs.value = Date.now();
  if (new Date(nowMs.value).toDateString() !== previous) {
    void historyStore.refreshDashboard();
  }
}

// 列表沒選中（或選中的那筆已不在列表）就選第一筆
watch(
  recordList,
  (list) => {
    if (!list.some((r) => r.id === selectedId.value)) {
      selectedId.value = list[0]?.id ?? null;
    }
  },
  { immediate: true },
);

watch(selectedId, () => {
  stopPlayback();
  showRawText.value = false;
});

// sentinel 一直可見時（列高矮、第一頁填不滿），每次載入結束都再補一頁
watch(
  () => [isSentinelVisible.value, isLoadMoreInFlight.value, historyStore.isLoading, historyStore.hasMore] as const,
  ([visible, inFlight, loading, hasMore]) => {
    if (visible && !inFlight && !loading && hasMore) void loadMoreSafely();
  },
);

watch(isNarrow, (narrow) => {
  if (!narrow) isDetailDrawerOpen.value = false;
});

onMounted(async () => {
  window.addEventListener("focus", handleWindowFocus);
  try {
    await refreshAll();
  } catch (err) {
    // DB 初始化失敗時 graceful degradation，MainApp Banner 已通知使用者
    captureError(err, { source: "records-view-mount" });
  }

  unlistenTranscriptionCompleted = await listenToEvent(TRANSCRIPTION_COMPLETED, () => {
    void refreshAll();
  });

  observer = new IntersectionObserver(
    (entries) => {
      isSentinelVisible.value = entries[0]?.isIntersecting ?? false;
    },
    { root: listRef.value, threshold: 0 },
  );
  if (sentinelRef.value) observer.observe(sentinelRef.value);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", handleWindowFocus);
  stopPlayback();
  unlistenTranscriptionCompleted?.();
  observer?.disconnect();
  if (searchTimer) clearTimeout(searchTimer);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 搜尋＋統計列 -->
    <div class="border-b border-border px-5 pt-3 pb-2.5">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="searchInput"
            type="search"
            :placeholder="$t('history.searchPlaceholder')"
            :aria-label="$t('history.searchPlaceholder')"
            class="h-8 w-full pl-9"
            @input="handleSearchInput"
          />
        </div>
        <Button
          v-if="isNarrow"
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('records.toggleDetail')"
          :aria-pressed="isDetailDrawerOpen"
          data-testid="detail-toggle"
          @click="isDetailDrawerOpen = !isDetailDrawerOpen"
        >
          <PanelRight class="h-4 w-4" />
        </Button>
      </div>

      <TooltipProvider :delay-duration="200">
        <div class="mt-2.5 flex flex-wrap items-center gap-y-1 text-xs text-muted-foreground" data-testid="records-stats">
          <span class="border-r border-border pr-3 mr-3">
            {{ $t("records.statToday", { count: formatNumber(stats.todayTranscriptions), chars: formatNumber(stats.todayCharacters) }) }}
          </span>
          <span class="border-r border-border pr-3 mr-3">
            {{ $t("records.statWeek", { chars: formatNumber(stats.weekCharacters) }) }}
          </span>

          <!-- 免費額度／今日用量：hover 顯示既有明細全文 -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="mr-3 h-6 gap-1.5 rounded-none border-r border-border px-0 pr-3 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                data-testid="records-quota"
              >
                <template v-if="hasFreeQuota">
                  <span class="inline-block h-1.5 w-1.5 rounded-full" :class="quotaBarColorClass" />
                  {{ $t("records.quotaLeft", { pct: `${Math.round(quotaRemainingPercent * 100)}%` }) }}
                </template>
                <template v-else>{{ $t("dashboard.dailyUsage") }}</template>
                <Badge v-if="hasAnyPaidProvider" variant="secondary" class="h-4 px-1.5 text-[10px]">{{ $t("dashboard.billedPlan") }}</Badge>
              </Button>
            </TooltipTrigger>
            <TooltipContent class="w-72 border border-border bg-popover p-3 text-popover-foreground" side="bottom" :side-offset="6" hide-arrow>
              <p class="mb-2 text-xs font-medium">{{ hasFreeQuota ? $t("dashboard.dailyQuotaDetail") : $t("dashboard.dailyUsage") }}</p>
              <p v-if="hasFreeQuota" class="mb-2 truncate text-xs text-muted-foreground">{{ quotaBottleneckLabel }}</p>
              <div v-if="hasFreeQuota" class="space-y-2">
                <div v-for="(dim, idx) in quotaDimensionList" :key="idx">
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-muted-foreground">{{ dim.label }}</span>
                    <span class="font-medium">{{ Math.round(Math.max(0, dim.remaining) * 100) }}%</span>
                  </div>
                  <div class="mt-0.5 h-1 w-full rounded-full bg-muted">
                    <div class="h-full rounded-full" :class="quotaBarColorClass" :style="{ width: `${Math.round(Math.max(0, dim.remaining) * 100)}%` }" />
                  </div>
                </div>
              </div>
              <p v-if="isQuotaHiddenLlmProvider" class="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {{ $t("dashboard.geminiQuotaHint") }}
              </p>
              <div v-if="paidUsageList.length > 0" class="space-y-1" :class="{ 'mt-2 border-t border-border pt-2': hasFreeQuota }">
                <p v-for="(item, idx) in paidUsageList" :key="`paid-${idx}`" class="text-xs text-muted-foreground">{{ item.label }}</p>
                <p class="text-xs text-muted-foreground">{{ $t("dashboard.billedNoFreeQuota") }}</p>
              </div>
              <p v-if="stats.dailyQuotaUsage.vocabularyAnalysisRequestCount > 0" class="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                {{ $t("dashboard.vocabularyAnalysisUsage", { requests: stats.dailyQuotaUsage.vocabularyAnalysisRequestCount, tokens: formatNumber(stats.dailyQuotaUsage.vocabularyAnalysisTotalTokens) }) }}
              </p>
            </TooltipContent>
          </Tooltip>

          <!-- 累計：ⓘ 展開原儀表板五項 -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 gap-1 px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                data-testid="records-cumulative"
              >
                {{ $t("records.savedTotal", { time: formatDurationFromMs(stats.estimatedTimeSavedMs) }) }}
                <Info class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent class="w-64 border border-border bg-popover p-3 text-popover-foreground" side="bottom" :side-offset="6" hide-arrow>
              <p class="mb-2 text-xs font-medium">{{ $t("records.cumulative") }}</p>
              <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                <dt class="text-muted-foreground">{{ $t("dashboard.totalRecordingTime") }}</dt>
                <dd class="text-right">{{ formatDurationFromMs(stats.totalRecordingDurationMs) }}</dd>
                <dt class="text-muted-foreground">{{ $t("dashboard.totalCharacters") }}</dt>
                <dd class="text-right">{{ formatNumber(stats.totalCharacters) }} {{ $t("dashboard.characterUnit") }}</dd>
                <dt class="text-muted-foreground">{{ $t("dashboard.timeSaved") }}</dt>
                <dd class="text-right">{{ formatDurationFromMs(stats.estimatedTimeSavedMs) }}</dd>
                <dt class="text-muted-foreground">{{ $t("dashboard.totalTranscriptions") }}</dt>
                <dd class="text-right">{{ formatNumber(stats.totalTranscriptions) }} {{ $t("dashboard.transcriptionUnit") }}</dd>
                <dt class="text-muted-foreground">{{ $t("dashboard.avgCharacters") }}</dt>
                <dd class="text-right">{{ formatNumber(avgCharacters) }} {{ $t("dashboard.characterUnit") }}</dd>
              </dl>
              <p class="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{{ $t("records.savedHint") }}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>

    <div class="relative flex min-h-0 flex-1">
      <!-- 清單 -->
      <div
        ref="listRef"
        class="min-w-0 flex-1 overflow-y-auto px-2 pb-3 outline-none"
        role="listbox"
        tabindex="0"
        :aria-label="$t('records.listLabel')"
        :aria-activedescendant="selectedId ? `record-${selectedId}` : undefined"
        data-testid="records-list"
        @keydown="handleListKeydown"
      >
        <div
          v-if="historyStore.isLoading && recordList.length === 0"
          class="py-12 text-center text-sm text-muted-foreground"
        >
          {{ $t("history.loading") }}
        </div>
        <div
          v-else-if="recordList.length === 0"
          class="py-12 text-center text-sm text-muted-foreground"
          data-testid="records-empty"
        >
          {{ searchInput.trim() ? $t("history.noResults", { query: searchInput.trim() }) : $t("history.emptyState") }}
        </div>

        <template v-for="group in dayGroupList" :key="group.key">
          <div class="sticky top-0 z-10 bg-background px-2.5 pt-3 pb-1 text-xs font-semibold text-foreground" role="presentation">
            {{ formatDayLabel(group.kind, group.dayStartMs) }}
          </div>
          <div
            v-for="record in group.recordList"
            :id="`record-${record.id}`"
            :key="record.id"
            :data-record-id="record.id"
            role="option"
            :aria-selected="record.id === selectedId"
            class="group grid h-9 cursor-default grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 text-sm transition-colors"
            :class="record.id === selectedId ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'"
            @click="handleRowClick(record.id)"
            @dblclick="!isFailed(record) && copyText(record.id, getDisplayText(record))"
          >
            <span class="font-mono text-xs tabular-nums" :class="record.id === selectedId ? '' : 'text-muted-foreground'">
              {{ formatClock(record.timestamp) }}
            </span>
            <span v-if="isFailed(record)" class="flex min-w-0 items-center gap-2" :class="record.id === selectedId ? '' : 'text-destructive'">
              <AlertCircle class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{{ $t("history.failedBadge") }}</span>
            </span>
            <span v-else class="truncate">{{ getDisplayText(record) }}</span>
            <span class="flex items-center justify-end gap-1.5 text-xs" :class="record.id === selectedId ? '' : 'text-muted-foreground'">
              <Button
                v-if="isFailed(record) && canRetranscribe(record) && record.id !== selectedId"
                variant="outline"
                size="sm"
                class="h-6 gap-1 px-2 text-xs"
                data-testid="row-retry"
                @click.stop="handleRetranscribe(record)"
              >
                <Loader2 v-if="isRetrying(record, 'transcribe')" class="h-3 w-3 animate-spin" />
                <RefreshCw v-else class="h-3 w-3" />
                {{ $t("records.retry") }}
              </Button>
              <Check v-else-if="copiedKey === record.id" class="h-3.5 w-3.5" />
              <span v-else-if="!isFailed(record)" class="tabular-nums">{{ formatDuration(record.recordingDurationMs) }}</span>
            </span>
          </div>
        </template>

        <div v-if="historyStore.isLoading && recordList.length > 0" class="py-3 text-center text-xs text-muted-foreground">
          {{ $t("history.loadingMore") }}
        </div>
        <div v-else-if="isAutoLoadPaused && historyStore.hasMore" class="py-2 text-center">
          <Button variant="ghost" size="sm" class="text-xs" data-testid="retry-load-more" @click="retryLoadMore">
            <RefreshCw class="h-3.5 w-3.5" />
            {{ $t("records.retryLoad") }}
          </Button>
        </div>
        <div ref="sentinelRef" class="h-4" data-testid="records-sentinel" />
      </div>

      <!-- 細節窗格 -->
      <aside
        v-show="!isNarrow || isDetailDrawerOpen"
        class="flex w-[19.5rem] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border px-4 py-4"
        :class="isNarrow ? 'absolute inset-y-0 right-0 z-20 bg-background shadow-xl' : ''"
        aria-live="polite"
        data-testid="records-detail"
      >
        <p v-if="!selectedRecord" class="pt-10 text-center text-sm text-muted-foreground">
          {{ recordList.length > 0 ? $t("records.selectHint") : "" }}
        </p>

        <template v-else>
          <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{{ formatFullDate(selectedRecord.timestamp) }}</span>
            <div
              v-if="!isFailed(selectedRecord) && hasDistinctRawText"
              class="inline-flex rounded-md border border-border p-0.5"
              role="group"
              :aria-label="$t('records.contentVersion')"
            >
              <Button
                :variant="showRawText ? 'ghost' : 'secondary'"
                size="sm"
                class="h-6 px-2 text-xs"
                :aria-pressed="!showRawText"
                @click="showRawText = false"
              >
                {{ $t("records.viewEnhanced") }}
              </Button>
              <Button
                :variant="showRawText ? 'secondary' : 'ghost'"
                size="sm"
                class="h-6 px-2 text-xs"
                :aria-pressed="showRawText"
                data-testid="view-raw"
                @click="showRawText = true"
              >
                {{ $t("records.viewRaw") }}
              </Button>
            </div>
          </div>

          <!-- 失敗記錄 -->
          <div v-if="isFailed(selectedRecord)" class="flex gap-2.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-testid="failed-box">
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p class="font-semibold">{{ $t("history.failedBadge") }}</p>
              <p class="mt-0.5 text-foreground">
                {{ selectedRecord.audioFilePath ? $t("records.failedHint") : $t("records.failedNoAudio") }}
              </p>
            </div>
          </div>

          <p
            v-else
            class="select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed"
            :class="showRawText && hasDistinctRawText ? 'text-muted-foreground' : 'text-foreground'"
            data-testid="detail-text"
          >
            {{ detailText }}
          </p>

          <!-- 播放 -->
          <div v-if="selectedRecord.audioFilePath" class="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1.5">
            <Button
              size="icon"
              class="h-6 w-6 shrink-0 rounded-full"
              :aria-label="$t('history.playRecording')"
              data-testid="detail-play"
              @click="togglePlayback(selectedRecord)"
            >
              <Pause v-if="playingId === selectedRecord.id" class="h-3 w-3 fill-current" />
              <Play v-else class="h-3 w-3 fill-current" />
            </Button>
            <div class="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <div class="h-full bg-foreground" :style="{ width: `${playingId === selectedRecord.id ? playProgress * 100 : 0}%` }" />
            </div>
            <span class="min-w-[4.5rem] text-right text-xs tabular-nums text-muted-foreground" aria-live="off">
              {{ formatClockSeconds(playingId === selectedRecord.id ? playElapsedMs : 0) }} / {{ formatClockSeconds(selectedRecord.recordingDurationMs) }}
            </span>
          </div>

          <!-- 工具列 -->
          <div class="flex items-center gap-1.5">
            <Button
              v-if="isFailed(selectedRecord)"
              size="sm"
              :disabled="!canRetranscribe(selectedRecord)"
              data-testid="detail-retry"
              @click="handleRetranscribe(selectedRecord)"
            >
              <Loader2 v-if="isRetrying(selectedRecord, 'transcribe')" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              {{ $t("records.retry") }}
            </Button>
            <template v-else>
              <Button size="sm" data-testid="detail-copy" @click="copyText(selectedRecord.id, detailText)">
                <Check v-if="copiedKey === selectedRecord.id" class="h-3.5 w-3.5" />
                <Copy v-else class="h-3.5 w-3.5" />
                {{ copiedKey === selectedRecord.id ? $t("history.copied") : $t("history.copy") }}
                <kbd class="ml-0.5 rounded border border-primary-foreground/50 px-1 text-[11px] font-normal">↵</kbd>
              </Button>
              <span class="flex-1" />
              <Button
                variant="outline"
                size="sm"
                :disabled="!canReEnhance(selectedRecord)"
                data-testid="reenhance-button"
                @click="handleReEnhance(selectedRecord)"
              >
                <Loader2 v-if="isRetrying(selectedRecord, 'enhance')" class="h-3.5 w-3.5 animate-spin" />
                <Sparkles v-else class="h-3.5 w-3.5" />
                {{ isRetrying(selectedRecord, "enhance") ? $t("history.reEnhancing") : $t("history.reEnhance") }}
              </Button>
            </template>
            <span v-if="isFailed(selectedRecord)" class="flex-1" />

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-sm" :aria-label="$t('records.moreActions')" data-testid="detail-more">
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem
                  v-if="!isFailed(selectedRecord)"
                  :disabled="!canRetranscribe(selectedRecord)"
                  data-testid="retranscribe-button"
                  @select="handleRetranscribe(selectedRecord)"
                >
                  <RefreshCw />
                  {{ isRetrying(selectedRecord, "transcribe") ? $t("history.retranscribing") : $t("history.retranscribe") }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="!isFailed(selectedRecord)" @select="copyText(`${selectedRecord.id}:raw`, selectedRecord.rawText)">
                  <Copy />
                  {{ $t("records.copyRaw") }}
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="!isFailed(selectedRecord)" />
                <DropdownMenuItem variant="destructive" data-testid="detail-delete" @select="handleDelete(selectedRecord)">
                  <Trash2 />
                  {{ $t("history.delete") }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p v-if="retryError && retryError.id === selectedRecord.id" class="text-xs text-destructive" data-testid="retry-error">
            {{ $t(retryError.key) }}
          </p>

          <!-- meta：耗時有值才顯示 -->
          <div class="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground" data-testid="detail-meta">
            <span>{{ $t("history.recordingLabel") }}{{ formatDurationMs(selectedRecord.recordingDurationMs) }}</span>
            <span v-if="selectedRecord.transcriptionDurationMs > 0">{{ $t("history.transcriptionLabel") }}{{ formatDurationMs(selectedRecord.transcriptionDurationMs) }}</span>
            <span v-if="selectedRecord.enhancementDurationMs !== null">{{ $t("history.aiLabel") }}{{ formatDurationMs(selectedRecord.enhancementDurationMs) }}</span>
            <span v-if="!isFailed(selectedRecord)">{{ $t("history.charCountLabel") }}{{ selectedRecord.charCount }}</span>
            <span>{{ $t("history.modeLabel") }}{{ selectedRecord.triggerMode === "hold" ? $t("history.holdMode") : $t("history.toggleMode") }}</span>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>
