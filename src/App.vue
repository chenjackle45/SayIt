<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import NotchHud from "./components/NotchHud.vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useVoiceFlowStore } from "./stores/useVoiceFlowStore";

const voiceFlowStore = useVoiceFlowStore();
const startupPhase = ref<
  "hidden" | "closed" | "expanded" | "collapsing" | "fading"
>("hidden");

const isExpanded = computed(() => startupPhase.value === "expanded");

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const NOTCH_SHAPES: Record<string, NotchShapeParams> = {
  hidden: { width: 200, height: 34, topRadius: 8, bottomRadius: 16 },
  closed: { width: 200, height: 34, topRadius: 8, bottomRadius: 16 },
  expanded: { width: 360, height: 42, topRadius: 14, bottomRadius: 22 },
  collapsing: { width: 200, height: 34, topRadius: 8, bottomRadius: 16 },
  fading: { width: 180, height: 30, topRadius: 6, bottomRadius: 14 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  // DynamicNotchKit / BoringNotch 的 NotchShape:
  // 頂部平齊 → 肩部 QuadCurve → 垂直側邊 → 底部 QuadCurve 圓角
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

const notchStyle = computed(() => {
  const params = NOTCH_SHAPES[startupPhase.value];
  return {
    width: `${params.width}px`,
    height: `${params.height}px`,
    clipPath: buildNotchPath(params),
    opacity: startupPhase.value === "fading" ? 0 : 1,
  };
});

onMounted(async () => {
  console.log("[App] Mounted, initializing voice flow...");

  const appWindow = getCurrentWindow();
  await appWindow.show();
  await voiceFlowStore.initialize();

  startupPhase.value = "closed";

  setTimeout(() => {
    startupPhase.value = "expanded";
  }, 600);

  setTimeout(() => {
    startupPhase.value = "collapsing";
  }, 2500);

  setTimeout(() => {
    startupPhase.value = "fading";
  }, 3100);

  setTimeout(async () => {
    startupPhase.value = "hidden";
    if (voiceFlowStore.status === "idle") {
      await appWindow.hide();
    }
  }, 3700);
});

onUnmounted(() => {
  voiceFlowStore.cleanup();
});
</script>

<template>
  <div class="h-screen w-screen bg-transparent">
    <!-- Notch Extension Startup -->
    <div
      v-if="startupPhase !== 'hidden' && voiceFlowStore.status === 'idle'"
      class="notch-wrapper"
      :class="{ 'has-shadow': isExpanded }"
    >
      <div class="notch-extension" :style="notchStyle">
        <div v-if="isExpanded" class="notch-content">
          <div class="notch-left">
            <span class="text-white/90 text-xs font-semibold">🎙 Voice Ready</span>
          </div>
          <div class="notch-camera-gap" />
          <div class="notch-right">
            <span class="text-white/40 text-xs">Press Fn</span>
          </div>
        </div>
        <div v-else class="closed-content">
          <span class="status-dot" />
        </div>
      </div>
    </div>

    <NotchHud :status="voiceFlowStore.status" :message="voiceFlowStore.message" />
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
  transition: filter 0.45s ease;
}

.notch-wrapper.has-shadow {
  filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.4));
}

.notch-extension {
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: notchEnter 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition:
    width 0.45s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.45s cubic-bezier(0.32, 0.72, 0, 1),
    clip-path 0.45s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.5s ease;
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

.closed-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notch-content {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 40px;
  animation: contentFadeIn 0.3s ease-out;
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

@keyframes contentFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
}
</style>
