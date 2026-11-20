import { createRouter, createWebHashHistory } from "vue-router";
import DashboardView from "./views/DashboardView.vue";
import HistoryView from "./views/HistoryView.vue";
import DictionaryView from "./views/DictionaryView.vue";
import SettingsView from "./views/SettingsView.vue";
import FeatureGuideView from "./views/FeatureGuideView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/history" },
    { path: "/dashboard", component: DashboardView },
    { path: "/history", component: HistoryView },
    { path: "/dictionary", component: DictionaryView },
    { path: "/settings", component: SettingsView },
    { path: "/guide", component: FeatureGuideView },
  ],
});

export default router;
