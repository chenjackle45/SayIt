<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  AudioLines,
  BookOpen,
  Download,
  Info,
  Keyboard,
  Mic,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import CommandPalette from "./components/CommandPalette.vue";
import SiteHeader from "./components/SiteHeader.vue";
import SidebarStatus from "./components/SidebarStatus.vue";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeedbackMessage } from "./composables/useFeedbackMessage";
import { useCrossWindowSettingsSync } from "./composables/useCrossWindowSettingsSync";
import {
  listenToEvent,
  MAIN_WINDOW_NAVIGATE,
  VOCABULARY_CHANGED,
} from "./composables/useTauriEvents";
import { useSettingsNavigation } from "./composables/useSettingsNavigation";
import { isAnyHotkeyRecording } from "./composables/useHotkeyRecordingSession";
import type { PreferencesTab } from "./types/settings";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { captureError } from "./lib/sentry";
import { getDatabaseInitError } from "./lib/database";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateCheckResult } from "./lib/autoUpdater";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;
const { t } = useI18n();

// 改版側欄只留兩項；偏好設定在側欄底部，按下進入「設定模式」（側欄換成設定分類）。
// 功能介紹 v0.17 才移除、路由保留（設定「關於」有連結）。
const navItems = computed(() => [
  { path: "/records", label: t("mainApp.nav.records"), icon: markRaw(AudioLines) },
  { path: "/dictionary", label: t("mainApp.nav.words"), icon: markRaw(BookOpen) },
]);

// 設定分類：順序照拍板 demo，各設定放哪一頁照計畫功能去向表
const settingsTabItems: Array<{ id: PreferencesTab; icon: object }> = [
  { id: "general", icon: markRaw(Settings) },
  { id: "hotkey", icon: markRaw(Keyboard) },
  { id: "ai", icon: markRaw(Sparkles) },
  { id: "mic", icon: markRaw(Mic) },
  { id: "advanced", icon: markRaw(SlidersHorizontal) },
  { id: "about", icon: markRaw(Info) },
];

const route = useRoute();
const { isInSettings, openSettings, exitSettings } = useSettingsNavigation();
const PAGE_TITLE_KEYS: Record<string, string> = {
  "/records": "mainApp.nav.records",
  "/dictionary": "mainApp.nav.words",
  "/guide": "mainApp.nav.guide",
};
const currentPageTitle = computed(() => {
  if (isInSettings.value) return t(`preferences.tabs.${String(route.params.tab ?? "general")}`);
  const matched = Object.keys(PAGE_TITLE_KEYS).find((p) => route.path.startsWith(p));
  return matched ? t(PAGE_TITLE_KEYS[matched]) : "SayIt";
});

// 必須在 app.mount() 後讀取 — setDatabaseInitError 在 bootstrap catch 中已設定
const databaseError = ref(getDatabaseInitError());
const showAccessibilityGuide = ref(false);

// ── 更新相關狀態 ──
type UpdateUiState = "idle" | "checking" | "downloading" | "ready-to-install" | "installing";
const updateState = ref<UpdateUiState>("idle");
const availableVersion = ref("");
const updateFeedback = useFeedbackMessage();
const AUTO_CHECK_INITIAL_DELAY_MS = 5_000;
const AUTO_CHECK_INTERVAL_MS = 15 * 60_000; // 15 分鐘
let autoCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
let autoCheckIntervalId: ReturnType<typeof setInterval> | null = null;

// AlertDialog 控制
const showManualUpdateDialog = ref(false);
const showAutoInstallDialog = ref(false);

// 升級提示（watch 而非 onMounted，因為 loadSettings 在 mount 之後才執行）
const settingsStore = useSettingsStore();
const showUpgradeNoticeDialog = ref(false);
const upgradeNoticeItemCount = 4;
watch(() => settingsStore.showPromptUpgradeNotice, (shouldShow) => {
  if (shouldShow) {
    showUpgradeNoticeDialog.value = true;
    settingsStore.showPromptUpgradeNotice = false;
  }
});

// ── 流程 1：自動偵測（靜默檢查 → 靜默下載 → 通知安裝） ──
async function autoCheckAndDownload() {
  if (updateState.value !== "idle") return;

  try {
    const { checkForAppUpdate, downloadUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status !== "update-available" || !result.version) return;

    availableVersion.value = result.version;
    updateState.value = "downloading";

    await downloadUpdate();

    updateState.value = "ready-to-install";

    // 確保 Dashboard 可見再彈 dialog
    // gh-76：使用者開了「啟動時隱藏主視窗」就不主動跳出來，對話框留在視窗內、開啟時再看
    if (!settingsStore.isStartHiddenEnabled) {
      const currentWindow = getCurrentWindow();
      await currentWindow.show();
      await currentWindow.setFocus();
    }

    showAutoInstallDialog.value = true;
  } catch (err) {
    console.error("[main-window] Auto update check/download failed:", err);
    captureError(err, { source: "updater", step: "auto-check" });
    updateState.value = "idle";
  }
}

// 使用者在自動流程的 AlertDialog 中點「安裝並重啟」
async function handleAutoInstall() {
  showAutoInstallDialog.value = false;
  updateState.value = "installing";
  try {
    const { installAndRelaunch } = await import("./lib/autoUpdater");
    await installAndRelaunch();
  } catch (err) {
    console.error("[main-window] Auto install failed:", err);
    updateFeedback.show("error", t("mainApp.update.installFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 使用者在自動流程的 AlertDialog 中點「稍後」
function handleAutoInstallLater() {
  showAutoInstallDialog.value = false;
  // 保持 ready-to-install 狀態，sidebar 仍顯示「立即安裝」按鈕
}

// sidebar footer 的「立即安裝」按鈕（自動下載完成後顯示）
async function handleSidebarInstall() {
  showAutoInstallDialog.value = true;
}

// ── 流程 2：手動檢查更新 ──
async function handleManualCheck() {
  if (updateState.value !== "idle" && updateState.value !== "ready-to-install") return;

  // 如果已有待安裝的更新，直接彈 dialog
  if (updateState.value === "ready-to-install") {
    showAutoInstallDialog.value = true;
    return;
  }

  updateState.value = "checking";
  try {
    const { checkForAppUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();
    handleManualCheckResult(result);
  } catch (err) {
    console.error("[main-window] Manual update check failed:", err);
    captureError(err, { source: "updater", step: "manual-check" });
    updateFeedback.show("error", t("mainApp.update.checkError"));
    updateState.value = "idle";
  }
}

function handleManualCheckResult(result: UpdateCheckResult) {
  if (result.status === "up-to-date") {
    updateFeedback.show("success", t("mainApp.update.upToDate"));
    updateState.value = "idle";
  } else if (result.status === "update-available") {
    availableVersion.value = result.version ?? "";
    updateState.value = "idle";
    showManualUpdateDialog.value = true;
  } else {
    updateFeedback.show("error", t("mainApp.update.checkFailed"));
    updateState.value = "idle";
  }
}

// 使用者在手動流程的 AlertDialog 中點「開始更新」
async function handleManualUpdate() {
  showManualUpdateDialog.value = false;
  updateState.value = "downloading";
  try {
    const { downloadInstallAndRelaunch } = await import("./lib/autoUpdater");
    await downloadInstallAndRelaunch();
  } catch (err) {
    console.error("[main-window] Manual update failed:", err);
    updateFeedback.show("error", t("mainApp.update.updateFailed"));
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// ── Sidebar footer 顯示邏輯 ──
const updateButtonLabel = computed(() => {
  switch (updateState.value) {
    case "checking": return t("mainApp.update.checking");
    case "downloading": return t("mainApp.update.downloading");
    case "installing": return t("mainApp.update.installing");
    default: return t("mainApp.update.checkUpdate");
  }
});

const isUpdateBusy = computed(() =>
  updateState.value === "checking" ||
  updateState.value === "downloading" ||
  updateState.value === "installing"
);


// HUD 雙擊切整理模式等跨視窗設定變更 → 側欄狀態等即時更新
useCrossWindowSettingsSync();

const vocabularyStore = useVocabularyStore();
let unlistenVocabularyChanged: UnlistenFn | null = null;
let unlistenMainWindowNavigate: UnlistenFn | null = null;

const isCommandPaletteOpen = ref(false);
// ⌘, / Ctrl+,：進入設定模式（已在設定模式就不動，不打斷目前分頁）
// ⌘K（macOS）／Ctrl+K（其他平台）：開關指令面板；macOS 的 Ctrl+K 是文字框「刪到行尾」，不攔
function handlePreferencesShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.repeat || isAnyHotkeyRecording.value) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
  const isMacOS = navigator.userAgent.includes("Macintosh");
  const isPaletteModifier = isMacOS ? event.metaKey : event.ctrlKey;
  if (event.key.toLowerCase() === "k" && isPaletteModifier) {
    event.preventDefault();
    isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
  } else if (event.key === ",") {
    event.preventDefault();
    void openSettings();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handlePreferencesShortcut);
  // macOS 應用程式選單「Settings… ⌘,」：Rust 已叫出主視窗，這裡只進入設定模式
  unlistenMainWindowNavigate = await listenToEvent(MAIN_WINDOW_NAVIGATE, () => {
    void openSettings();
  });

  // 監聽詞彙變更（HUD 視窗 AI 新增詞彙時同步 Dashboard）
  unlistenVocabularyChanged = await listenToEvent(VOCABULARY_CHANGED, () => {
    console.log("[main-window] VOCABULARY_CHANGED received, refreshing termList");
    void vocabularyStore.fetchTermList();
  });

  void vocabularyStore.fetchTermList().catch(() => { /* store 已記錄讀取錯誤 */ });

  // macOS 無障礙權限檢查
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (isMacOS) {
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
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }

  // 自動檢查更新：啟動 5 秒後首次檢查，之後每 15 分鐘重查
  autoCheckTimeoutId = setTimeout(() => {
    autoCheckAndDownload();
    autoCheckIntervalId = setInterval(autoCheckAndDownload, AUTO_CHECK_INTERVAL_MS);
  }, AUTO_CHECK_INITIAL_DELAY_MS);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handlePreferencesShortcut);
  unlistenMainWindowNavigate?.();
  unlistenVocabularyChanged?.();
  if (autoCheckTimeoutId) clearTimeout(autoCheckTimeoutId);
  if (autoCheckIntervalId) clearInterval(autoCheckIntervalId);
});
</script>

<template>
  <!-- macOS Overlay 自訂標題列：fixed z-20 蓋住 Sidebar(z-10)，整條可拖動 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
  >
    <span data-tauri-drag-region class="text-xs font-medium text-muted-foreground select-none">SayIt - 言</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9" style="--sidebar-width: 13rem">
    <Sidebar collapsible="offcanvas">
      <SidebarHeader class="flex-row h-12 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="@/assets/logo-yan.png" alt="言" class="h-7 w-auto" />
        <span class="text-base font-semibold text-sidebar-foreground tracking-wide" style="font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;">SayIt</span>
      </SidebarHeader>
      <SidebarContent>
        <!-- 設定模式：側欄換成返回＋設定分類 -->
        <SidebarGroup v-if="isInSettings" data-testid="settings-sidebar">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton data-testid="exit-settings" @click="exitSettings">
                  <ArrowLeft />
                  <span>{{ $t("preferences.back") }}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu class="mt-2">
              <SidebarMenuItem v-for="item in settingsTabItems" :key="item.id">
                <SidebarMenuButton as-child :is-active="route.params.tab === item.id">
                  <RouterLink :to="`/settings/${item.id}`" :data-testid="`settings-tab-${item.id}`">
                    <component :is="item.icon" />
                    <span>{{ $t(`preferences.tabs.${item.id}`) }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup v-else>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
                <SidebarMenuBadge v-if="item.path === '/dictionary' && vocabularyStore.inboxCount > 0" data-testid="vocabulary-inbox-count">
                  {{ vocabularyStore.inboxCount }}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="gap-3 px-3 py-3">
        <SidebarMenu v-if="!isInSettings">
          <SidebarMenuItem>
            <SidebarMenuButton data-testid="open-preferences" @click="openSettings()">
              <Settings />
              <span>{{ $t("mainApp.nav.preferences") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div class="border-t border-sidebar-border pt-3 px-1">
          <SidebarStatus />
        </div>
        <div class="flex items-center justify-between px-1">
          <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
          <!-- ready-to-install 時不顯示檢查按鈕，改顯示安裝提示 -->
          <Button
            v-if="updateState !== 'ready-to-install'"
            variant="link"
            class="h-auto p-0 text-xs text-muted-foreground"
            :disabled="isUpdateBusy"
            @click="handleManualCheck"
          >
            {{ updateButtonLabel }}
          </Button>
        </div>
        <!-- 自動下載完成：顯示持久的安裝提示 -->
        <div v-if="updateState === 'ready-to-install'" class="mt-1.5 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5">
          <span class="text-xs font-medium text-link">v{{ availableVersion }} {{ $t("mainApp.update.ready") }}</span>
          <Button
            size="sm"
            class="h-6 gap-1 px-2 text-xs"
            @click="handleSidebarInstall"
          >
            <Download class="h-3 w-3" />
            {{ $t("mainApp.update.installNow") }}
          </Button>
        </div>
        <p
          v-if="updateFeedback.message.value"
          class="mt-1 text-xs text-destructive"
        >
          {{ updateFeedback.message.value }}
        </p>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div
        v-if="databaseError"
        class="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p class="font-medium">{{ $t("errors.databaseInitFailed") }}</p>
        <p class="mt-1 text-xs text-destructive">{{ databaseError }}</p>
      </div>
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <!-- 成功類回饋（儲存、切換、刪除…）統一由這裡淡出 -->
  <Toaster position="bottom-right" :duration="2500" />
  <CommandPalette v-model:open="isCommandPaletteOpen" />

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />

  <!-- 自動流程 AlertDialog：更新已下載，詢問是否安裝重啟 -->
  <AlertDialog :open="showAutoInstallDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.autoInstallTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.autoInstallDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleAutoInstallLater">{{ $t("mainApp.update.later") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleAutoInstall">{{ $t("mainApp.update.installRestart") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 升級提示 AlertDialog -->
  <AlertDialog :open="showUpgradeNoticeDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.upgradeNotice.title") }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <ol class="mt-2 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
            <li v-for="i in upgradeNoticeItemCount" :key="i">
              {{ $t(`mainApp.upgradeNotice.item${i}`) }}
            </li>
          </ol>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction @click="showUpgradeNoticeDialog = false">{{ $t("mainApp.upgradeNotice.dismiss") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 手動流程 AlertDialog：發現新版本，詢問是否開始更新 -->
  <AlertDialog :open="showManualUpdateDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("mainApp.update.newVersionTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ $t("mainApp.update.newVersionDescription", { version: availableVersion }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showManualUpdateDialog = false">{{ $t("mainApp.update.cancel") }}</AlertDialogCancel>
        <AlertDialogAction @click="handleManualUpdate">{{ $t("mainApp.update.startUpdate") }}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
