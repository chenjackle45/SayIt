import { computed } from "vue";
import { useRoute, useRouter, type RouteLocationNormalized } from "vue-router";
import { isPreferencesTab, type PreferencesTab } from "../types/settings";

// 設定模式（v0.16 #4）：偏好設定在主視窗內，側欄換成設定分類；返回時回到進入前那一頁

const DEFAULT_RETURN_PATH = "/records";
let settingsReturnPath = DEFAULT_RETURN_PATH;

export function isSettingsPath(path: string): boolean {
  return path === "/settings" || path.startsWith("/settings/");
}

/**
 * 掛在 router.beforeEach（全域：/settings/a → /settings/b 是同一路由換參數，beforeEnter 不會重跑）：
 * 不認得的分頁導回一般；從一般頁進入設定時記下來處。
 */
export function guardSettingsNavigation(
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): string | undefined {
  if (to.path.startsWith("/settings/") && !isPreferencesTab(to.params.tab)) return "/settings/general";
  if (isSettingsPath(to.path) && !isSettingsPath(from.path) && from.matched.length > 0) {
    settingsReturnPath = from.fullPath;
  }
  return undefined;
}

export function useSettingsNavigation() {
  const router = useRouter();
  const route = useRoute();
  const isInSettings = computed(() => isSettingsPath(route.path));

  /** 已在設定模式且沒指定分頁時不動：⌘, 不會把人從目前分頁拉走（例如正在錄快捷鍵）。 */
  async function openSettings(tab?: PreferencesTab): Promise<void> {
    if (isInSettings.value && !tab) return;
    await router.push(tab ? `/settings/${tab}` : "/settings");
  }

  async function exitSettings(): Promise<void> {
    await router.push(settingsReturnPath);
  }

  return { isInSettings, openSettings, exitSettings };
}
