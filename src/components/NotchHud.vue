<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { HudStatus } from "../types";
import type { VocabularyLearnedPayload } from "../types/events";
import { useAudioWaveform } from "../composables/useAudioWaveform";
import {
  listenToEvent,
  VOCABULARY_LEARNED,
} from "../composables/useTauriEvents";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../stores/useSettingsStore";

const { t } = useI18n();

type VisualMode =
  | "hidden"
  | "recording"
  | "morphing"
  | "transcribing"
  | "success"
  | "error"
  | "cancelled"
  | "collapsing"
  | "learned"
  | "mode-switch";

const props = defineProps<{
  status: HudStatus;
  recordingElapsedSeconds: number;
  message: string;
  canRetry: boolean;
  promptModeLabel: string;
  modeSwitchLabel: string;
  isEditMode: boolean;
  pastedCharacterCount: number;
  isRetryInRecordsHintVisible: boolean;
}>();

defineEmits<{
  retry: [];
}>();

const visualMode = ref<VisualMode>("hidden");
let morphingTimer: ReturnType<typeof setTimeout> | null = null;
let collapsingTimer: ReturnType<typeof setTimeout> | null = null;
let learnedTimer: ReturnType<typeof setTimeout> | null = null;
let unlistenVocabularyLearned: UnlistenFn | null = null;
const pendingLearnedTermList = ref<string[][]>([]);
const learnedDisplayText = ref("");
const COLLAPSE_ANIMATION_DURATION_MS = 400;
const LEARNED_DISPLAY_DURATION_MS = 2000;
const MAX_DISPLAY_TERM_COUNT = 3;

const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } =
  useAudioWaveform();

const WAVEFORM_ELEMENT_COUNT = 6;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 28;
const ERROR_WITH_MESSAGE_HEIGHT = 72;

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const DEFAULT_NOTCH_SHAPE: NotchShapeParams = {
  width: 420,
  height: 42,
  topRadius: 14,
  bottomRadius: 22,
};

const NOTCH_SHAPE_OVERRIDES: Partial<Record<VisualMode, NotchShapeParams>> = {
  collapsing: { width: 200, height: 32, topRadius: 10, bottomRadius: 16 },
  "mode-switch": { width: 350, height: 36, topRadius: 12, bottomRadius: 18 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

// C3：剛存了失敗記錄且有錄音的轉錄錯誤說「辨識失敗・到記錄重試」，其餘照具體錯誤文案
const displayedErrorMessage = computed(() =>
  props.isRetryInRecordsHintVisible ? t("voiceFlow.hud.failedGoRetry") : props.message,
);

const hasErrorMessage = computed(
  () => visualMode.value === "error" && displayedErrorMessage.value !== "",
);

// C3：轉錄中／整理中・模式／編輯中分開說（動畫仍共用同一個 transcribing 視覺）
const processingLabel = computed(() => {
  if (visualMode.value !== "morphing" && visualMode.value !== "transcribing") return "";
  if (props.status === "editing") return t("voiceFlow.hud.editing");
  if (props.status === "enhancing") {
    return t("voiceFlow.hud.enhancingWithMode", { mode: props.promptModeLabel });
  }
  if (props.status === "transcribing") return t("voiceFlow.hud.transcribing");
  return "";
});

const isExpandedMode = computed(
  () =>
    hasErrorMessage.value ||
    visualMode.value === "learned" ||
    visualMode.value === "success" ||
    visualMode.value === "mode-switch" ||
    processingLabel.value !== "",
);

const notchStyle = computed(() => {
  let params = NOTCH_SHAPE_OVERRIDES[visualMode.value] ?? DEFAULT_NOTCH_SHAPE;
  if (isExpandedMode.value) {
    params = { ...params, height: ERROR_WITH_MESSAGE_HEIGHT };
  }
  return {
    width: `${params.width}px`,
    height: `${params.height}px`,
    clipPath: buildNotchPath(params),
  };
});

const formattedElapsedTime = computed(() => {
  const totalSeconds = props.recordingElapsedSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const barStyleList = computed(() => {
  const styleList: Record<string, string>[] = [];
  for (let i = 0; i < WAVEFORM_ELEMENT_COUNT; i++) {
    if (visualMode.value === "recording") {
      const level = waveformLevelList.value[i] ?? 0;
      const height =
        MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      styleList.push({
        height: `${Math.round(height)}px`,
        width: "4px",
        borderRadius: "2px",
      });
    } else {
      styleList.push({});
    }
  }
  return styleList;
});

const waveformElementClass = computed(() => {
  switch (visualMode.value) {
    case "recording":
      return "waveform-bar";
    case "morphing":
      return "waveform-morphing";
    case "transcribing":
      return "waveform-dot";
    case "success":
      return "waveform-converge";
    case "error":
      return "waveform-scatter";
    default:
      return "";
  }
});

const notchHudClassList = computed(() => ({
  "notch-shake": visualMode.value === "error",
  "notch-collapsing": visualMode.value === "collapsing",
}));

const isHighPriorityMode = computed(() => {
  const mode = visualMode.value;
  return (
    mode === "recording" ||
    mode === "morphing" ||
    mode === "transcribing" ||
    mode === "success" ||
    mode === "error" ||
    mode === "cancelled"
  );
});

function clearMorphingTimer() {
  if (morphingTimer) {
    clearTimeout(morphingTimer);
    morphingTimer = null;
  }
}

function clearCollapsingTimer() {
  if (collapsingTimer) {
    clearTimeout(collapsingTimer);
    collapsingTimer = null;
  }
}

function clearLearnedTimer() {
  if (learnedTimer) {
    clearTimeout(learnedTimer);
    learnedTimer = null;
  }
}

function formatLearnedText(termList: string[]): string {
  if (termList.length <= MAX_DISPLAY_TERM_COUNT) {
    return t("voiceFlow.vocabularyLearned", {
      terms: termList.join(", "),
    });
  }
  const displayedTermList = termList.slice(0, MAX_DISPLAY_TERM_COUNT);
  return t("voiceFlow.vocabularyLearnedTruncated", {
    terms: displayedTermList.join(", "),
    count: termList.length - MAX_DISPLAY_TERM_COUNT,
  });
}

function showLearnedNotification(termList: string[]) {
  learnedDisplayText.value = formatLearnedText(termList);
  visualMode.value = "learned";
  if (useSettingsStore().isSoundEffectsEnabled) {
    void invoke("play_learned_sound").catch(() => {});
  }
  clearLearnedTimer();
  learnedTimer = setTimeout(() => {
    visualMode.value = "collapsing";
    collapsingTimer = setTimeout(() => {
      visualMode.value = "hidden";
      processNextLearnedNotification();
    }, COLLAPSE_ANIMATION_DURATION_MS);
  }, LEARNED_DISPLAY_DURATION_MS);
}

function processNextLearnedNotification() {
  if (pendingLearnedTermList.value.length === 0) return;
  if (isHighPriorityMode.value) return;
  const nextTermList = pendingLearnedTermList.value.shift()!;
  showLearnedNotification(nextTermList);
}

function handleVocabularyLearned(payload: VocabularyLearnedPayload) {
  console.log(
    `[NotchHud] VOCABULARY_LEARNED received: termList=${JSON.stringify(payload.termList)}, visualMode=${visualMode.value}, isHighPriority=${isHighPriorityMode.value}`,
  );
  if (!payload.termList || payload.termList.length === 0) return;

  if (isHighPriorityMode.value || visualMode.value === "learned") {
    console.log("[NotchHud] queued (high priority or already showing learned)");
    pendingLearnedTermList.value.push(payload.termList);
    return;
  }

  console.log("[NotchHud] showing learned notification now");
  showLearnedNotification(payload.termList);
}

let modeSwitchTimer: ReturnType<typeof setTimeout> | null = null;

function clearModeSwitchTimer() {
  if (modeSwitchTimer) {
    clearTimeout(modeSwitchTimer);
    modeSwitchTimer = null;
  }
}

watch(
  () => props.modeSwitchLabel,
  (label) => {
    if (!label) {
      // Label cleared → trigger collapsing animation
      if (visualMode.value === "mode-switch") {
        visualMode.value = "collapsing";
        collapsingTimer = setTimeout(() => {
          visualMode.value = "hidden";
          processNextLearnedNotification();
        }, COLLAPSE_ANIMATION_DURATION_MS);
      }
      return;
    }
    // Label set → show mode-switch visual
    clearModeSwitchTimer();
    clearCollapsingTimer();
    visualMode.value = "mode-switch";
  },
);

watch(
  () => props.status,
  (nextStatus) => {
    clearMorphingTimer();
    clearCollapsingTimer();
    clearLearnedTimer();

    if (nextStatus === "idle") {
      stopWaveformAnimation();
      if (visualMode.value === "learned") return;
      if (visualMode.value === "mode-switch") return;
      if (visualMode.value === "hidden") {
        processNextLearnedNotification();
        return;
      }
      visualMode.value = "collapsing";
      collapsingTimer = setTimeout(() => {
        visualMode.value = "hidden";
        processNextLearnedNotification();
      }, COLLAPSE_ANIMATION_DURATION_MS);
      return;
    }

    if (nextStatus === "recording") {
      visualMode.value = "recording";
      startWaveformAnimation();
      return;
    }

    if (
      nextStatus === "transcribing" ||
      nextStatus === "enhancing" ||
      nextStatus === "editing"
    ) {
      stopWaveformAnimation();
      if (
        visualMode.value === "recording" ||
        visualMode.value === "morphing"
      ) {
        visualMode.value = "morphing";
        morphingTimer = setTimeout(() => {
          visualMode.value = "transcribing";
        }, 300);
      } else {
        visualMode.value = "transcribing";
      }
      return;
    }

    if (nextStatus === "success") {
      stopWaveformAnimation();
      visualMode.value = "success";
      return;
    }

    if (nextStatus === "error") {
      stopWaveformAnimation();
      visualMode.value = "error";
      return;
    }

    if (nextStatus === "cancelled") {
      stopWaveformAnimation();
      visualMode.value = "cancelled";
      return;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  unlistenVocabularyLearned = await listenToEvent<VocabularyLearnedPayload>(
    VOCABULARY_LEARNED,
    (event) => {
      handleVocabularyLearned(event.payload);
    },
  );
});

onUnmounted(() => {
  clearMorphingTimer();
  clearCollapsingTimer();
  clearLearnedTimer();
  clearModeSwitchTimer();
  stopWaveformAnimation();
  unlistenVocabularyLearned?.();
});
</script>

<template>
  <div
    v-if="visualMode !== 'hidden'"
    class="notch-wrapper"
    :class="{
      'notch-wrapper-success': visualMode === 'success',
      'notch-wrapper-learned': visualMode === 'learned',
    }"
  >
    <div
      class="notch-hud"
      :class="[notchHudClassList, { 'notch-hud-expanded': isExpandedMode }]"
      :style="notchStyle"
    >
      <div class="notch-content">
        <div class="notch-left">
          <!-- Cancelled: X icon -->
          <svg
            v-if="visualMode === 'cancelled'"
            class="cancelled-icon-svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255, 255, 255, 0.6)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <!-- Learned: book icon -->
          <svg
            v-else-if="visualMode === 'learned'"
            class="learned-icon-svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(147, 197, 253, 0.95)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <!-- Other modes: waveform + checkmark -->
          <template v-else>
            <div class="waveform-container">
              <span
                v-for="(style, index) in barStyleList"
                :key="index"
                class="waveform-element"
                :class="waveformElementClass"
                :style="style"
              />
            </div>
            <svg
              v-if="visualMode === 'success'"
              class="checkmark-svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 12l6 6L20 6"
                fill="none"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </template>
        </div>

        <div class="notch-camera-gap" />

        <div class="notch-right">
          <span v-if="visualMode === 'cancelled'" class="cancelled-label">
            {{ $t('voiceFlow.cancelled') }}
          </span>
          <span v-else-if="visualMode === 'learned'" class="learned-label">
            {{ $t('voiceFlow.vocabularyLearnedLabel') }}
          </span>
          <template v-else-if="visualMode === 'recording'">
            <span v-if="props.isEditMode" class="hud-badge edit-mode-badge">{{ t('voiceFlow.editMode') }}</span>
            <span v-else-if="props.promptModeLabel" class="hud-badge prompt-mode-badge">{{ props.promptModeLabel }}</span>
            <span class="elapsed-timer">
              {{ formattedElapsedTime }}
            </span>
          </template>
          <span
            v-else-if="visualMode === 'error' && canRetry"
            class="retry-icon"
            @click.stop="$emit('retry')"
          >&#x21BB;</span>
        </div>
      </div>

      <!-- Learned: terms row below camera -->
      <div v-if="visualMode === 'learned'" class="learned-terms-row">
        <span class="learned-terms">{{ learnedDisplayText }}</span>
      </div>

      <!-- C3 狀態文字放瀏海下方第二行：HUD 貼齊螢幕頂端，右欄在瀏海機只露約 77px，英日韓放不下 -->
      <div v-if="processingLabel" class="status-row">
        <span class="status-label" data-testid="hud-processing-label">{{ processingLabel }}</span>
      </div>
      <!-- 模式切換提示同樣放第二行：右欄五語系都放不下（日文 192px > 右欄 150px） -->
      <div v-else-if="visualMode === 'mode-switch'" class="status-row">
        <span class="status-label mode-switch-label" data-testid="hud-mode-switch-label">{{ props.modeSwitchLabel }}</span>
      </div>
      <div v-else-if="visualMode === 'success'" class="status-row">
        <span class="status-label" data-testid="hud-success-label">
          <span class="hud-mark" aria-hidden="true">言</span>
          {{ t('voiceFlow.hud.pasted', { count: props.pastedCharacterCount }) }}
        </span>
      </div>

      <div v-if="hasErrorMessage" class="error-message-row">
        <span class="error-message">{{ displayedErrorMessage }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notch-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
  animation: notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.notch-wrapper {
  --notch-bg: #ffffff;
  --notch-fg: #18181b;
  --notch-fg-soft: rgba(24, 24, 27, 0.4);
  --notch-learned: #1d4ed8;
  --notch-mode: #6d28d9;
  --notch-edit-bg: rgba(180, 83, 9, 0.15);
  --notch-edit-fg: #b45309;
  --notch-success: #16733a;
  --notch-warn: #c2410c;
}

.notch-hud {
  background: var(--notch-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    width 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    clip-path 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    background 0.3s ease;
}

html.dark .notch-wrapper {
  --notch-bg: #000000;
  --notch-fg: #ffffff;
  --notch-fg-soft: rgba(255, 255, 255, 0.4);
  --notch-learned: rgba(147, 197, 253, 0.95);
  --notch-mode: rgba(167, 139, 250, 0.95);
  --notch-edit-bg: rgba(251, 191, 36, 0.25);
  --notch-edit-fg: rgba(251, 191, 36, 0.9);
  --notch-success: #30d158;
  --notch-warn: #ff9f0a;
}

@keyframes notchEnter {
  from {
    opacity: 0;
    transform: scaleX(0.6) scaleY(0.3);
  }
  to {
    opacity: 1;
    transform: scaleX(1) scaleY(1);
  }
}

.notch-content {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 40px;
}

.notch-left {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  position: relative;
}

.notch-camera-gap {
  width: 40px;
  flex-shrink: 0;
}

.notch-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* ---- Waveform Container ---- */
.waveform-container {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 28px;
}

/* ---- Shared Waveform Element ---- */
.waveform-element {
  background: var(--notch-fg);
  transition:
    height 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    width 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.3s ease,
    transform 0.3s ease;
}

/* Recording: dynamic bars */
.waveform-bar {
  /* height & width set via inline style */
}

/* ---- Gap 2: Morphing stagger delay ---- */
.waveform-morphing {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.waveform-morphing:nth-child(1) { transition-delay: 0ms; }
.waveform-morphing:nth-child(2) { transition-delay: 50ms; }
.waveform-morphing:nth-child(3) { transition-delay: 100ms; }
.waveform-morphing:nth-child(4) { transition-delay: 150ms; }
.waveform-morphing:nth-child(5) { transition-delay: 200ms; }
.waveform-morphing:nth-child(6) { transition-delay: 250ms; }

/* ---- Gap 3: Transcribing dots sliding window ---- */
.waveform-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
  border: 1.5px solid var(--notch-fg-soft);
  animation: dotSlide 1.5s ease-in-out infinite;
}
.waveform-dot:nth-child(1) { animation-delay: 0s; }
.waveform-dot:nth-child(2) { animation-delay: 0.3s; }
.waveform-dot:nth-child(3) { animation-delay: 0.6s; }
.waveform-dot:nth-child(4) { animation-delay: 0.9s; }
.waveform-dot:nth-child(5) { animation-delay: 1.2s; }
.waveform-dot:nth-child(6) {
  display: none;
}

@keyframes dotSlide {
  0%     { background: var(--notch-fg); border-color: var(--notch-fg); }
  50%    { background: var(--notch-fg); border-color: var(--notch-fg); }
  50.01% { background: transparent; border-color: var(--notch-fg-soft); }
  100%   { background: transparent; border-color: var(--notch-fg-soft); }
}

/* ---- Success: converge + SVG checkmark ---- */
.waveform-converge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: dotConverge 0.35s ease-in forwards;
}
.waveform-converge:nth-child(1) { --converge-offset: -12px; }
.waveform-converge:nth-child(2) { --converge-offset: -7px; }
.waveform-converge:nth-child(3) { --converge-offset: -3px; }
.waveform-converge:nth-child(4) { --converge-offset: 3px; }
.waveform-converge:nth-child(5) { --converge-offset: 7px; }
.waveform-converge:nth-child(6) { --converge-offset: 12px; }

@keyframes dotConverge {
  from { transform: translateX(var(--converge-offset)) scale(1); opacity: 1; }
  to   { transform: translateX(0) scale(0); opacity: 0; }
}

/* Gap 5: SVG checkmark stroke animation */
.checkmark-svg {
  position: absolute;
  left: 0;
}
.checkmark-svg path {
  stroke: var(--notch-success);
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  animation: drawCheck 0.3s ease-out 0.35s forwards;
}
@keyframes drawCheck {
  to { stroke-dashoffset: 0; }
}

/* ---- Success: green glow from notch edge ---- */
.notch-wrapper-success {
  filter:
    drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
    drop-shadow(0 0 10px color-mix(in srgb, var(--notch-success) 50%, transparent))
    drop-shadow(0 0 25px color-mix(in srgb, var(--notch-success) 20%, transparent));
  animation: successGlow 0.8s ease-out forwards;
}

@keyframes successGlow {
  0% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 12px color-mix(in srgb, var(--notch-success) 60%, transparent))
      drop-shadow(0 0 30px color-mix(in srgb, var(--notch-success) 30%, transparent));
  }
  100% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 2px transparent);
  }
}


/* ---- Learned: blue glow + text ---- */
.notch-wrapper-learned {
  filter:
    drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
    drop-shadow(0 0 10px color-mix(in srgb, var(--notch-learned) 50%, transparent))
    drop-shadow(0 0 25px color-mix(in srgb, var(--notch-learned) 20%, transparent));
  animation: learnedGlow 2s ease-out forwards;
}

@keyframes learnedGlow {
  0% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 12px color-mix(in srgb, var(--notch-learned) 60%, transparent))
      drop-shadow(0 0 30px color-mix(in srgb, var(--notch-learned) 30%, transparent));
  }
  100% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 2px transparent);
  }
}

.learned-icon-svg {
  /* 用主題變數而非硬編碼淺藍：淺色主題下 --notch-learned 為深藍(#1d4ed8)才看得見。
     inline stroke 屬性作為 fallback（CSS stroke 屬性優先度高於 presentation attribute）。 */
  stroke: var(--notch-learned);
  animation: learnedIconFadeIn 0.3s ease-out;
}

@keyframes learnedIconFadeIn {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}

.learned-label {
  color: var(--notch-learned);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  animation: learnedTextFadeIn 0.3s ease-out;
}

.learned-terms-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px 6px;
  animation: learnedTextFadeIn 0.3s ease-out 0.2s both;
}

.learned-terms {
  color: var(--notch-learned);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes learnedTextFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Cancelled: X icon + label ---- */
.cancelled-icon-svg {
  stroke: var(--notch-fg-soft);
  animation: cancelledIconFadeIn 0.3s ease-out;
}

@keyframes cancelledIconFadeIn {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}

.cancelled-label {
  color: var(--notch-fg-soft);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  animation: cancelledTextFadeIn 0.3s ease-out;
}

@keyframes cancelledTextFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Mode Switch ---- */
.mode-switch-label {
  color: var(--notch-mode);
  font-weight: 600;
}

/* ---- HUD Badge (shared base) ---- */
.hud-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  margin-right: 6px;
}
.prompt-mode-badge { background: var(--notch-fg-soft); color: var(--notch-fg); opacity: 0.7; }
.edit-mode-badge   { background: var(--notch-edit-bg);  color: var(--notch-edit-fg); }
/* 深色模式：prompt-mode badge 背景略調暗，避免在黑底上過亮（維護者 review 順手項）。
   只針對此 badge 覆蓋背景，不動共用的 --notch-fg-soft（錄音環邊框也用它）。 */
html.dark .notch-hud .prompt-mode-badge { background: rgba(255, 255, 255, 0.2); }

/* ---- Error: scatter + shake ---- */
.waveform-scatter {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--notch-warn);
  animation: dotScatter 0.4s ease-out forwards;
}
.waveform-scatter:nth-child(1) { --scatter-offset: -6; }
.waveform-scatter:nth-child(2) { --scatter-offset: -3; }
.waveform-scatter:nth-child(3) { --scatter-offset: 0; }
.waveform-scatter:nth-child(4) { --scatter-offset: 3; }
.waveform-scatter:nth-child(5) { --scatter-offset: 6; }
.waveform-scatter:nth-child(6) { --scatter-offset: 9; }

@keyframes dotScatter {
  from {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateX(calc(var(--scatter-offset) * 1px)) scale(0.8);
    opacity: 0.7;
  }
}

.notch-shake {
  animation: notchShake 0.4s ease-out 0.1s;
}

@keyframes notchShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}


/* ---- Gap 7: Timer font ---- */
.elapsed-timer {
  font-family: 'JetBrains Mono', monospace;
  color: var(--notch-fg-soft);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ---- Error: expanded notch with message ---- */
.notch-hud-expanded {
  flex-direction: column;
  justify-content: flex-start;
}

.notch-hud-expanded .notch-content {
  height: 42px;
  flex-shrink: 0;
}

.error-message-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px 6px;
  animation: errorMessageFadeIn 0.3s ease-out 0.2s both;
}

.error-message {
  color: var(--notch-warn);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes errorMessageFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- Retry Icon ---- */
.retry-icon {
  color: var(--notch-warn);
  font-size: 16px;
  cursor: pointer;
}

/* ---- C3 狀態文字（轉錄中／整理中・模式／編輯中／已貼上・N 字）：瀏海下方第二行 ---- */
.status-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px 6px;
  animation: errorMessageFadeIn 0.3s ease-out 0.1s both;
}

.status-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--notch-fg);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.hud-mark {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: var(--notch-fg);
  color: var(--notch-bg);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  font-family: "Songti TC", "PingFang TC", serif;
  line-height: 1;
}

/* ---- Collapsing: 內容淡出 ---- */
.notch-collapsing .notch-content,
.notch-collapsing .error-message-row,
.notch-collapsing .learned-terms-row {
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* 系統「減少動態效果」：關掉補間、光暈、抖動與循環動畫，狀態直接切換 */
@media (prefers-reduced-motion: reduce) {
  .notch-wrapper,
  .notch-hud,
  .notch-hud *,
  .notch-wrapper-success,
  .notch-wrapper-learned {
    animation: none !important;
    transition: none !important;
  }
  .checkmark-svg path {
    stroke-dashoffset: 0;
  }
}
</style>
