import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainApp from "./MainApp.vue";
import router from "./router";
import { initializeDatabase } from "./lib/database";
import { extractErrorMessage } from "./lib/errorUtils";
import { useSettingsStore } from "./stores/useSettingsStore";
import "./style.css";

async function bootstrap() {
  const pinia = createPinia();
  const app = createApp(MainApp).use(pinia).use(router);

  // DB 必須在 mount 之前初始化，否則 View 的 onMounted 會因 getDatabase() 拋錯而全部失敗
  try {
    await initializeDatabase();
  } catch (err) {
    const message = extractErrorMessage(err);
    console.error("[main-window] Database init failed:", message);
    await invoke("debug_log", {
      level: "error",
      message: `Database init failed: ${message}`,
    });
  }

  app.mount("#app");
  await router.isReady();

  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  await settingsStore.initializeAutoStart();

  if (!settingsStore.hasApiKey) {
    await router.push("/settings");
    await nextTick();
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
    console.log("[main-window] API Key missing, redirected to settings");
  }

  // 背景定時檢查更新：啟動 5 秒後首次檢查，之後每 4 小時檢查一次
  const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  const runUpdateCheck = async () => {
    try {
      const { checkForAppUpdate } = await import("./lib/autoUpdater");
      await checkForAppUpdate();
    } catch (err) {
      console.error("[main-window] Update check failed (silenced):", err);
    }
  };
  setTimeout(() => {
    runUpdateCheck();
    setInterval(runUpdateCheck, UPDATE_CHECK_INTERVAL_MS);
  }, 5000);

  console.log("[main-window] Dashboard initialized");
}

bootstrap().catch((err) => {
  console.error("[main-window] Failed to initialize:", err);
});
