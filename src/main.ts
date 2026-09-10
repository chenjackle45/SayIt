import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initSentryForHud, captureError } from "./lib/sentry";
import { initThemeFromStore } from "./lib/theme";
import { installConsoleForwarding } from "./lib/logger";
import i18n from "./i18n";
import "./style.css";

// 最早期安裝 console → plugin-log 轉送，涵蓋 HUD 之後所有 console 輸出
installConsoleForwarding();

const pinia = createPinia();
const app = createApp(App);

initSentryForHud(app);

window.addEventListener("unhandledrejection", (event) => {
  captureError(event.reason, { source: "hud-unhandled-rejection" });
});

app.config.errorHandler = (err, _instance, info) => {
  console.error("[HUD] Vue error:", err);
  captureError(err, { source: "hud-vue-error", info });
};

// mount 前套用持久化主題，避免閃白；失敗時 fallback 預設主題
void initThemeFromStore().finally(() => {
  app.use(pinia).use(i18n).mount("#app");
});
