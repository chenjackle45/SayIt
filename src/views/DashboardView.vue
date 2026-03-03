<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatNumber,
  formatCostCeiling,
} from "../lib/formatUtils";
import DashboardUsageChart from "../components/DashboardUsageChart.vue";

const historyStore = useHistoryStore();
const router = useRouter();

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

function navigateToHistory() {
  void router.push("/history");
}

onMounted(async () => {
  await historyStore.refreshDashboard();

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      void historyStore.refreshDashboard();
    },
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
</script>

<template>
  <div class="p-6 text-white">
    <h1 class="text-2xl font-bold text-white">Dashboard</h1>
    <p class="mt-2 text-zinc-400">語音轉文字統計總覽</p>

    <!-- 統計卡片 -->
    <div class="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">總口述時間</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ formatDurationFromMs(historyStore.dashboardStats.totalRecordingDurationMs) }}
        </p>
      </div>

      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">口述字數</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ formatNumber(historyStore.dashboardStats.totalCharacters) }} 字
        </p>
      </div>

      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">節省時間</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ formatDurationFromMs(historyStore.dashboardStats.estimatedTimeSavedMs) }}
        </p>
      </div>

      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">總使用次數</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ formatNumber(historyStore.dashboardStats.totalTranscriptions) }} 次
        </p>
      </div>

      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">平均每次字數</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ historyStore.dashboardStats.totalTranscriptions > 0 ? formatNumber(Math.round(historyStore.dashboardStats.totalCharacters / historyStore.dashboardStats.totalTranscriptions)) : 0 }} 字
        </p>
      </div>

      <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <p class="text-sm text-zinc-400">API 費用上限</p>
        <p class="mt-1 text-2xl font-bold text-white">
          {{ formatCostCeiling(historyStore.dashboardStats.totalCostCeiling) }}
        </p>
        <p class="mt-1 text-xs text-zinc-500">實際費用不超過此金額</p>
      </div>
    </div>

    <!-- 每日使用趨勢圖表 -->
    <section v-if="historyStore.dailyUsageTrendList.length > 0" class="mt-6">
      <DashboardUsageChart :data="historyStore.dailyUsageTrendList" />
    </section>

    <!-- 最近轉錄 -->
    <section class="mt-8 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">最近轉錄</h2>
        <button
          v-if="historyStore.recentTranscriptionList.length > 0"
          type="button"
          class="text-sm text-blue-400 transition hover:text-blue-300"
          @click="navigateToHistory"
        >
          查看全部
        </button>
      </div>

      <!-- 空狀態 -->
      <div
        v-if="historyStore.recentTranscriptionList.length === 0"
        class="mt-4 rounded-lg border border-dashed border-zinc-600 px-4 py-8 text-center text-zinc-400"
      >
        開始使用語音輸入，統計數據將在此顯示
      </div>

      <!-- 最近列表 -->
      <div v-else class="mt-4 space-y-2">
        <button
          v-for="record in historyStore.recentTranscriptionList"
          :key="record.id"
          type="button"
          class="w-full rounded-lg border border-zinc-700 px-4 py-3 text-left transition hover:bg-zinc-800/50"
          @click="navigateToHistory"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm text-zinc-400">
              {{ formatTimestamp(record.timestamp) }}
            </span>
            <span
              v-if="record.wasEnhanced"
              class="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400"
            >
              AI 整理
            </span>
          </div>
          <p class="mt-1 text-sm text-zinc-300 truncate">
            {{ truncateText(getDisplayText(record)) }}
          </p>
        </button>
      </div>
    </section>
  </div>
</template>
