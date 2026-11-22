import { createRouter, createWebHashHistory } from "vue-router";
import RecordsView from "./views/RecordsView.vue";
import DictionaryView from "./views/DictionaryView.vue";
import PreferencesView from "./views/PreferencesView.vue";
import FeatureGuideView from "./views/FeatureGuideView.vue";
import { guardSettingsNavigation } from "./composables/useSettingsNavigation";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/records" },
    { path: "/records", component: RecordsView },
    // 儀表板與歷史記錄已合併成記錄頁；舊路徑導過去
    { path: "/dashboard", redirect: "/records" },
    { path: "/history", redirect: "/records" },
    { path: "/dictionary", component: DictionaryView },
    // 設定模式：側欄換成設定分類，一個分類一個網址
    { path: "/settings", redirect: "/settings/general" },
    { path: "/settings/:tab", component: PreferencesView, props: true },
    { path: "/guide", component: FeatureGuideView },
  ],
});

router.beforeEach(guardSettingsNavigation);

export default router;
