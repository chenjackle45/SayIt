<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, ref } from "vue";
import { RouterLink, RouterView } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: "📊" },
  { path: "/history", label: "歷史記錄", icon: "📝" },
  { path: "/dictionary", label: "自訂字典", icon: "📖" },
  { path: "/settings", label: "設定", icon: "⚙️" },
];

const showAccessibilityGuide = ref(false);

onMounted(async () => {
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (!isMacOS) return;

  try {
    const hasAccessibilityPermission = await invoke<boolean>(
      "check_accessibility_permission_command",
    );
    showAccessibilityGuide.value = !hasAccessibilityPermission;
  } catch (error) {
    console.error(
      "[main-window] Failed to check accessibility permission:",
      error,
    );
  }
});
</script>

<template>
  <div class="flex h-screen bg-zinc-950 text-white">
    <!-- Sidebar -->
    <nav class="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900">
      <div class="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
        <span class="text-lg font-semibold">SayIt</span>
      </div>
      <div class="flex flex-1 flex-col gap-1 p-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          active-class="!bg-zinc-800 !text-white"
        >
          <span>{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <RouterView />
    </main>

    <AccessibilityGuide
      :visible="showAccessibilityGuide"
      @close="showAccessibilityGuide = false"
    />
  </div>
</template>
