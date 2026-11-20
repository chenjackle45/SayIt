import { createRouter, createWebHashHistory } from "vue-router";
import RecordsView from "./views/RecordsView.vue";
import DictionaryView from "./views/DictionaryView.vue";
import SettingsView from "./views/SettingsView.vue";
import FeatureGuideView from "./views/FeatureGuideView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/records" },
    { path: "/records", component: RecordsView },
    // 儀表板與歷史記錄已合併成記錄頁；舊路徑導過去
    { path: "/dashboard", redirect: "/records" },
    { path: "/history", redirect: "/records" },
    { path: "/dictionary", component: DictionaryView },
    { path: "/settings", component: SettingsView },
    { path: "/guide", component: FeatureGuideView },
  ],
});

export default router;
