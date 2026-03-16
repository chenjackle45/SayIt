import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainApp from "./MainApp.vue";
import router from "./router";
import { initializeDatabase, setDatabaseInitError } from "./lib/database";
import { extractErrorMessage } from "./lib/errorUtils";
import { initSentryForDashboard, captureError } from "./lib/sentry";
import { useSettingsStore } from "./stores/useSettingsStore";
import i18n from "./i18n";
import "./style.css";

// 停用 WebView 預設右鍵選單（Back / Reload），讓 app 行為更接近原生
document.addEventListener("contextmenu", (e) => e.preventDefault());

async function bootstrap() {
  const pinia = createPinia();
  const app = createApp(MainApp);

  initSentryForDashboard(app, router);

  window.addEventListener("unhandledrejection", (event) => {
    captureError(event.reason, { source: "dashboard-unhandled-rejection" });
  });

  app.config.errorHandler = (err, _instance, info) => {
    console.error("[Dashboard] Vue error:", err);
    captureError(err, { source: "dashboard-vue-error", info });
  };

  app.use(pinia).use(i18n).use(router);

  // DB 必須在 mount 之前初始化，否則 View 的 onMounted 會因 getDatabase() 拋錯而全部失敗
  try {
    await initializeDatabase();

    // 清除舊版內建幻覺詞（已改為純自動學習 + 手動新增機制）
    const { useHallucinationStore } = await import(
      "./stores/useHallucinationStore"
    );
    const hallucinationStore = useHallucinationStore();
    await hallucinationStore.removeBuiltinTerms();
  } catch (err) {
    const message = extractErrorMessage(err);
    console.error("[main-window] Database init failed:", message);
    captureError(err, { source: "database-init" });
    setDatabaseInitError(message);
    await invoke("debug_log", {
      level: "error",
      message: `Database init failed: ${message}`,
    });
  }

  app.mount("#app");
  await router.isReady();

  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  await settingsStore.consumeUpgradeNotice();
  await settingsStore.initializeAutoStart();

  if (!settingsStore.hasApiKey) {
    await router.push("/settings");
    await nextTick();
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
    console.log("[main-window] API Key missing, redirected to settings");
  }

  // 錄音檔自動清理（背景執行，不阻斷啟動）
  if (settingsStore.isRecordingAutoCleanupEnabled) {
    queueMicrotask(() => {
      void (async () => {
        try {
          const days = settingsStore.recordingAutoCleanupDays;
          const deletedIdList = await invoke<string[]>(
            "cleanup_old_recordings",
            { days },
          );
          if (deletedIdList.length > 0) {
            const { useHistoryStore } = await import(
              "./stores/useHistoryStore"
            );
            const historyStore = useHistoryStore();
            await historyStore.clearAudioFilePathByIdList(deletedIdList);
            console.log(
              `[main-window] Auto cleanup: removed ${deletedIdList.length} old recordings (>${days} days)`,
            );
          }
        } catch (err) {
          console.error(
            "[main-window] Auto cleanup failed:",
            extractErrorMessage(err),
          );
          captureError(err, { source: "auto-cleanup" });
        }
      })();
    });
  }

  // 更新檢查由 MainApp.vue onMounted 的 autoCheckAndDownload() 處理
  console.log("[main-window] Dashboard initialized");
}

bootstrap().catch((err) => {
  console.error("[main-window] Failed to initialize:", err);
  captureError(err, { source: "bootstrap" });
});
