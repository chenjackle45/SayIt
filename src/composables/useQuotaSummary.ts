import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { formatDurationFromMs, formatNumber } from "../lib/formatUtils";
import {
  findLlmModelConfig,
  findWhisperModelConfig,
} from "../lib/modelRegistry";

// 今日免費額度／用量摘要。原本寫在 DashboardView，改版後記錄頁統計列沿用，邏輯原樣搬移。
export function useQuotaSummary() {
  const { t } = useI18n();
  const historyStore = useHistoryStore();
  const settingsStore = useSettingsStore();

  // 付費偵測依 LLM provider id：openai / anthropic 為計費方案（無免費額度）；
  // groq / gemini 提供免費額度。Whisper 目前僅 Groq，一律視為免費額度。
  const isPaidWhisperProvider = computed(() => false);

  const isPaidLlmProvider = computed(() => {
    const providerId = settingsStore.selectedLlmProviderId;
    return providerId !== "groq" && providerId !== "gemini";
  });

  const hasAnyPaidProvider = computed(
    () => isPaidWhisperProvider.value || isPaidLlmProvider.value,
  );

  // Gemini 免費額度已不公開（依帳號浮動、僅能在 AI Studio 查詢）：
  // registry 將其 freeQuotaRpd 設 0 → 額度條自動略過，改以「今日用量」呈現
  const isQuotaHiddenLlmProvider = computed(() => {
    if (isPaidLlmProvider.value) return false;
    const lConfig = findLlmModelConfig(settingsStore.selectedLlmModelId);
    return (lConfig?.freeQuotaRpd ?? 0) === 0;
  });

  const quotaDimensionList = computed(() => {
    const usage = historyStore.dashboardStats.dailyQuotaUsage;
    const dimensionList: { remaining: number; label: string }[] = [];

    if (!isPaidWhisperProvider.value) {
      const wConfig = findWhisperModelConfig(settingsStore.selectedWhisperModelId);
      const wRpdLimit = wConfig?.freeQuotaRpd ?? 2000;
      const wAudioLimitMs = (wConfig?.freeQuotaAudioSecondsPerDay ?? 28800) * 1000;
      if (wRpdLimit > 0) {
        dimensionList.push({
          remaining: 1 - usage.whisperRequestCount / wRpdLimit,
          label: t("dashboard.quotaWhisperRequests", { used: usage.whisperRequestCount, limit: formatNumber(wRpdLimit) }),
        });
      }
      if (wAudioLimitMs > 0) {
        dimensionList.push({
          remaining: 1 - usage.whisperBilledAudioMs / wAudioLimitMs,
          label: t("dashboard.quotaAudio", { used: formatDurationFromMs(usage.whisperBilledAudioMs), limit: formatDurationFromMs(wAudioLimitMs) }),
        });
      }
    }

    if (!isPaidLlmProvider.value) {
      const lConfig = findLlmModelConfig(settingsStore.selectedLlmModelId);
      const lRpdLimit = lConfig?.freeQuotaRpd ?? 1000;
      const lTpdLimit = lConfig?.freeQuotaTpd ?? 100_000;
      if (lRpdLimit > 0) {
        dimensionList.push({
          remaining: 1 - usage.llmRequestCount / lRpdLimit,
          label: t("dashboard.quotaLlmRequests", { used: usage.llmRequestCount, limit: formatNumber(lRpdLimit) }),
        });
      }
      if (lTpdLimit > 0) {
        dimensionList.push({
          remaining: 1 - usage.llmTotalTokens / lTpdLimit,
          label: t("dashboard.quotaLlmTokens", { used: formatNumber(usage.llmTotalTokens), limit: formatNumber(lTpdLimit) }),
        });
      }
    }

    return dimensionList;
  });

  const hasFreeQuota = computed(() => quotaDimensionList.value.length > 0);

  // 計費方案（OpenAI/Anthropic）無免費額度，改顯示今日實際用量
  const paidUsageList = computed(() => {
    const usage = historyStore.dashboardStats.dailyQuotaUsage;
    const list: { label: string }[] = [];
    if (isPaidWhisperProvider.value) {
      list.push({
        label: t("dashboard.usageWhisper", {
          requests: formatNumber(usage.whisperRequestCount),
          audio: formatDurationFromMs(usage.whisperBilledAudioMs),
        }),
      });
    }
    if (isPaidLlmProvider.value || isQuotaHiddenLlmProvider.value) {
      list.push({
        label: t("dashboard.usageLlm", {
          requests: formatNumber(usage.llmRequestCount),
          tokens: formatNumber(usage.llmTotalTokens),
        }),
      });
    }
    return list;
  });

  const quotaRemainingPercent = computed(() => {
    if (quotaDimensionList.value.length === 0) return 0;
    const minRemaining = Math.min(...quotaDimensionList.value.map((d) => d.remaining));
    return Math.max(0, minRemaining);
  });

  const quotaBottleneckLabel = computed(() => {
    if (quotaDimensionList.value.length === 0) return "";
    const sorted = [...quotaDimensionList.value].sort((a, b) => a.remaining - b.remaining);
    return sorted[0].label;
  });

  const quotaBarColorClass = computed(() => {
    const pct = quotaRemainingPercent.value;
    if (pct >= 0.5) return "bg-success";
    if (pct >= 0.2) return "bg-warning";
    return "bg-destructive";
  });

  return {
    hasAnyPaidProvider,
    isQuotaHiddenLlmProvider,
    quotaDimensionList,
    hasFreeQuota,
    paidUsageList,
    quotaRemainingPercent,
    quotaBottleneckLabel,
    quotaBarColorClass,
  };
}
