<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import type { TranscriptionRecord } from "../types/transcription";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDuration,
  formatDurationMs,
} from "../lib/formatUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, Copy, Check, Trash2, Play, Pause, RefreshCw, Sparkles, Loader2 } from "lucide-vue-next";
import { captureError } from "../lib/sentry";

const historyStore = useHistoryStore();

const searchInput = ref("");
const expandedRecordId = ref<string | null>(null);
const copiedRecordId = ref<string | null>(null);
const copiedRawRecordId = ref<string | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);
const playingRecordId = ref<string | null>(null);
// 重試鎖在 store（跨路由存活）；頁面只讀狀態來顯示 spinner / disabled
const retryingId = computed(() => historyStore.retryingId);
const retryingAction = computed(() => historyStore.retryingAction);
const retryError = ref<{ id: string; key: string } | null>(null);
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let copiedRawTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
let unlistenTranscriptionCompleted: UnlistenFn | null = null;

const SEARCH_DEBOUNCE_MS = 300;

function toggleExpand(recordId: string) {
  expandedRecordId.value =
    expandedRecordId.value === recordId ? null : recordId;
}

function handleSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    historyStore.searchQuery = searchInput.value;
    void historyStore.resetAndFetch();
  }, SEARCH_DEBOUNCE_MS);
}

async function handleCopyText(record: TranscriptionRecord) {
  const textToCopy = getDisplayText(record);
  try {
    await invoke("copy_to_clipboard", { text: textToCopy });
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedRecordId.value = record.id;
    copiedTimer = setTimeout(() => {
      copiedRecordId.value = null;
    }, 2500);
  } catch {
    // clipboard write may fail in some contexts, silently ignore
  }
}

async function handleCopyRawText(record: TranscriptionRecord) {
  try {
    await invoke("copy_to_clipboard", { text: record.rawText });
    if (copiedRawTimer) clearTimeout(copiedRawTimer);
    copiedRawRecordId.value = record.id;
    copiedRawTimer = setTimeout(() => {
      copiedRawRecordId.value = null;
    }, 2500);
  } catch {
    // clipboard write may fail in some contexts, silently ignore
  }
}

async function handleDeleteRecord(record: TranscriptionRecord) {
  try {
    await historyStore.deleteTranscription(record.id);
    if (expandedRecordId.value === record.id) {
      expandedRecordId.value = null;
    }
  } catch {
    // DB 刪除失敗，靜默處理（Sentry 已在 store 層捕獲）
  }
}

function cleanupAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

async function handlePlayRecording(record: TranscriptionRecord) {
  // 停止正在播放的
  cleanupAudio();

  // 如果點擊同一個（暫停）
  if (playingRecordId.value === record.id) {
    playingRecordId.value = null;
    return;
  }

  if (!record.audioFilePath) return;

  playingRecordId.value = record.id;

  try {
    // macOS WKWebView IPC 回傳 number[]，非 macOS 回傳 ArrayBuffer
    const raw = await invoke<number[]>("read_recording_file", {
      id: record.id,
    });

    // 防止 race condition：invoke 回來時已經切換到別的紀錄
    if (playingRecordId.value !== record.id) return;

    const blob = new Blob([new Uint8Array(raw)], { type: "audio/wav" });
    currentBlobUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentBlobUrl);

    currentAudio.addEventListener("ended", () => {
      cleanupAudio();
      playingRecordId.value = null;
    });

    currentAudio.addEventListener("error", () => {
      cleanupAudio();
      playingRecordId.value = null;
    });

    await currentAudio.play();
  } catch (err) {
    cleanupAudio();
    playingRecordId.value = null;
    captureError(err, { source: "history-view", step: "play-recording" });
  }
}

// 鎖、錯誤攔截與上報都在 store；頁面只把結果轉成訊息
async function handleRetranscribe(record: TranscriptionRecord) {
  if (retryingId.value) return;
  retryError.value = null;
  const result = await historyStore.retranscribeRecord(record);
  if (!result.ok) {
    retryError.value = {
      id: record.id,
      key: result.errorKey ?? "history.retranscribeFailed",
    };
  }
}

async function handleReEnhance(record: TranscriptionRecord) {
  if (retryingId.value) return;
  retryError.value = null;
  const result = await historyStore.reEnhanceRecord(record);
  if (!result.ok) {
    retryError.value = {
      id: record.id,
      key: result.errorKey ?? "history.reEnhanceFailed",
    };
  }
}

onMounted(async () => {
  try {
    await historyStore.resetAndFetch();
  } catch (err) {
    // DB 初始化失敗時 graceful degradation，MainApp Banner 已通知使用者
    captureError(err, { source: "history-view-mount" });
  }

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      void historyStore.resetAndFetch();
    },
  );

  observer = new IntersectionObserver(
    (entries) => {
      if (
        entries[0].isIntersecting &&
        historyStore.hasMore &&
        !historyStore.isLoading
      ) {
        void historyStore.loadMore();
      }
    },
    { threshold: 0.1 },
  );
  if (sentinelRef.value) {
    observer.observe(sentinelRef.value);
  }
});

onBeforeUnmount(() => {
  // 停止播放、釋放 Audio + Blob URL 資源
  cleanupAudio();
  playingRecordId.value = null;

  unlistenTranscriptionCompleted?.();
  observer?.disconnect();
  if (searchTimer) clearTimeout(searchTimer);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="p-6">
    <!-- 搜尋列 -->
    <div class="relative mb-6">
      <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        v-model="searchInput"
        type="text"
        :placeholder="$t('history.searchPlaceholder')"
        class="w-full pl-9"
        @input="handleSearchInput"
      />
    </div>

    <!-- 歷史記錄卡片 -->
    <Card>
      <CardContent class="p-0">
        <!-- 載入狀態（初次載入） -->
        <div
          v-if="historyStore.isLoading && historyStore.transcriptionList.length === 0"
          class="text-center text-muted-foreground py-12"
        >
          {{ $t("history.loading") }}
        </div>

        <!-- 空狀態 -->
        <div
          v-else-if="historyStore.transcriptionList.length === 0"
          class="py-12 text-center text-muted-foreground"
        >
          <template v-if="searchInput.trim()">
            {{ $t("history.noResults", { query: searchInput.trim() }) }}
          </template>
          <template v-else>
            {{ $t("history.emptyState") }}
          </template>
        </div>

        <!-- 記錄列表 -->
        <template v-else>
          <div
            v-for="(record, index) in historyStore.transcriptionList"
            :key="record.id"
          >
            <!-- 摘要行（可點擊展開） -->
            <div
              class="px-5 py-4 cursor-pointer hover:bg-accent/50 transition"
              :class="{ 'border-b border-border': index < historyStore.transcriptionList.length - 1 || expandedRecordId === record.id }"
              @click="toggleExpand(record.id)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    {{ formatTimestamp(record.timestamp) }}
                  </span>
                  <Badge
                    v-if="record.wasEnhanced"
                    class="bg-emerald-500/20 text-emerald-400 border-0 text-[11px]"
                  >
                    {{ $t("dashboard.aiEnhanced") }}
                  </Badge>
                  <Badge
                    v-if="record.status === 'failed'"
                    variant="destructive"
                    class="text-[11px]"
                  >
                    {{ $t("history.failedBadge") }}
                  </Badge>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    {{ formatDuration(record.recordingDurationMs) }}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    :disabled="!record.audioFilePath"
                    :title="record.audioFilePath ? $t('history.playRecording') : $t('history.noRecordingFile')"
                    @click.stop="handlePlayRecording(record)"
                  >
                    <Pause v-if="playingRecordId === record.id" class="h-3.5 w-3.5" />
                    <Play v-else class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    @click.stop="handleCopyText(record)"
                  >
                    <Check v-if="copiedRecordId === record.id" class="h-3.5 w-3.5 text-green-400" />
                    <Copy v-else class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    data-testid="retranscribe-button"
                    :disabled="!record.audioFilePath || record.isEditMode || retryingId !== null"
                    :title="retryingId === record.id && retryingAction === 'transcribe' ? $t('history.retranscribing') : (record.audioFilePath ? $t('history.retranscribe') : $t('history.noRecordingFile'))"
                    @click.stop="handleRetranscribe(record)"
                  >
                    <Loader2 v-if="retryingId === record.id && retryingAction === 'transcribe'" class="h-3.5 w-3.5 animate-spin" />
                    <RefreshCw v-else class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    data-testid="reenhance-button"
                    :disabled="!record.rawText.trim() || record.isEditMode || retryingId !== null"
                    :title="retryingId === record.id && retryingAction === 'enhance' ? $t('history.reEnhancing') : $t('history.reEnhance')"
                    @click.stop="handleReEnhance(record)"
                  >
                    <Loader2 v-if="retryingId === record.id && retryingAction === 'enhance'" class="h-3.5 w-3.5 animate-spin" />
                    <Sparkles v-else class="h-3.5 w-3.5" />
                  </Button>
                  <ChevronDown
                    class="h-3.5 w-3.5 text-muted-foreground transition-transform"
                    :class="{ 'rotate-180': expandedRecordId === record.id }"
                  />
                </div>
              </div>
              <p class="mt-1.5 text-sm text-muted-foreground truncate">
                {{ truncateText(getDisplayText(record)) }}
              </p>
            </div>
            <!-- 重試錯誤訊息（每筆常駐顯示）-->
            <p
              v-if="retryError && retryError.id === record.id"
              class="px-5 pb-2 text-xs text-destructive"
              data-testid="retry-error"
            >
              {{ $t(retryError.key) }}
            </p>

            <!-- 展開詳細 -->
            <div
              v-if="expandedRecordId === record.id"
              class="bg-card px-5 py-4 space-y-3"
              :class="{ 'border-b border-border': index < historyStore.transcriptionList.length - 1 }"
            >
              <!-- 整理後文字 -->
              <div v-if="record.wasEnhanced && record.processedText">
                <p class="text-xs font-medium text-emerald-400 mb-1">{{ $t("history.enhancedText") }}</p>
                <p class="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {{ record.processedText }}
                </p>
              </div>

              <!-- 原始文字 -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <p class="text-xs font-medium text-muted-foreground">{{ $t("history.rawText") }}</p>
                  <button
                    class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    @click.stop="handleCopyRawText(record)"
                  >
                    <Check v-if="copiedRawRecordId === record.id" class="h-3 w-3 text-green-400" />
                    <Copy v-else class="h-3 w-3" />
                    <span>{{ copiedRawRecordId === record.id ? $t("history.copied") : $t("history.copy") }}</span>
                  </button>
                </div>
                <p class="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {{ record.rawText }}
                </p>
              </div>

              <!-- 詳細資訊 -->
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
                <span>{{ $t("history.recordingLabel") }}{{ formatDurationMs(record.recordingDurationMs) }}</span>
                <span>{{ $t("history.transcriptionLabel") }}{{ formatDurationMs(record.transcriptionDurationMs) }}</span>
                <span v-if="record.enhancementDurationMs !== null">
                  {{ $t("history.aiLabel") }}{{ formatDurationMs(record.enhancementDurationMs) }}
                </span>
                <span>{{ $t("history.charCountLabel") }}{{ record.charCount }}</span>
                <span>{{ $t("history.modeLabel") }}{{ record.triggerMode === "hold" ? $t("history.holdMode") : $t("history.toggleMode") }}</span>
              </div>

              <!-- 操作按鈕 -->
              <div class="flex justify-end gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  @click.stop="handleCopyText(record)"
                >
                  <Check v-if="copiedRecordId === record.id" class="h-3.5 w-3.5 mr-1.5" />
                  <Copy v-else class="h-3.5 w-3.5 mr-1.5" />
                  {{ copiedRecordId === record.id ? $t("history.copied") : $t("history.copy") }}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  @click.stop="handleDeleteRecord(record)"
                >
                  <Trash2 class="h-3.5 w-3.5 mr-1.5" />
                  {{ $t("history.delete") }}
                </Button>
              </div>
            </div>
          </div>
        </template>

        <!-- 載入更多指示 -->
        <div
          v-if="historyStore.isLoading && historyStore.transcriptionList.length > 0"
          class="py-4 text-center text-sm text-muted-foreground"
        >
          {{ $t("history.loadingMore") }}
        </div>

        <!-- 無限捲動 sentinel -->
        <div ref="sentinelRef" class="h-4" />
      </CardContent>
    </Card>
  </div>
</template>
