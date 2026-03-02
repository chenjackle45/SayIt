<script setup lang="ts">
import { computed } from "vue";
import type { HudStatus } from "../types";

const props = defineProps<{
  status: HudStatus;
  message: string;
}>();

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const NOTCH_SHAPES: Record<string, NotchShapeParams> = {
  idle: { width: 200, height: 34, topRadius: 8, bottomRadius: 16 },
  recording: { width: 360, height: 42, topRadius: 14, bottomRadius: 22 },
  transcribing: { width: 360, height: 42, topRadius: 14, bottomRadius: 22 },
  success: { width: 320, height: 40, topRadius: 12, bottomRadius: 20 },
  error: { width: 380, height: 44, topRadius: 16, bottomRadius: 24 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

const notchStyle = computed(() => {
  const params = NOTCH_SHAPES[props.status] ?? NOTCH_SHAPES.idle;
  return {
    width: `${params.width}px`,
    height: `${params.height}px`,
    clipPath: buildNotchPath(params),
  };
});
</script>

<template>
  <div v-if="status !== 'idle'" class="notch-wrapper">
    <div class="notch-hud" :style="notchStyle">
      <!-- Recording -->
      <div v-if="status === 'recording'" class="notch-content">
        <div class="notch-left">
          <span class="recording-dot" />
          <span class="text-white text-xs font-medium">{{ message }}</span>
        </div>
        <div class="notch-camera-gap" />
        <div class="notch-right" />
      </div>

      <!-- Transcribing -->
      <div v-else-if="status === 'transcribing'" class="notch-content">
        <div class="notch-left">
          <span class="spinner" />
          <span class="text-white text-xs font-medium">{{ message }}</span>
        </div>
        <div class="notch-camera-gap" />
        <div class="notch-right" />
      </div>

      <!-- Success -->
      <div v-else-if="status === 'success'" class="notch-content">
        <div class="notch-left">
          <span class="text-green-400 text-sm">&#10003;</span>
          <span class="text-green-400 text-xs font-medium">{{ message }}</span>
        </div>
        <div class="notch-camera-gap" />
        <div class="notch-right" />
      </div>

      <!-- Error -->
      <div v-else-if="status === 'error'" class="notch-content">
        <div class="notch-left">
          <span class="text-orange-400 text-sm">&#9888;</span>
        </div>
        <div class="notch-camera-gap" />
        <div class="notch-right">
          <span class="text-orange-400 text-xs font-medium truncate max-w-[140px]">
            {{ message || "Error" }}
          </span>
        </div>
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
}

.notch-hud {
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition:
    width 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    clip-path 0.35s cubic-bezier(0.32, 0.72, 0, 1);
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
  gap: 6px;
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
  gap: 6px;
}

.recording-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
