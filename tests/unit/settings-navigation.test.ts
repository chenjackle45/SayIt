import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  guardSettingsNavigation,
  useSettingsNavigation,
} from "../../src/composables/useSettingsNavigation";

// 同一個元件兼任路由頁與測試宿主：setup 時抓出 useSettingsNavigation 的回傳值
let nav!: ReturnType<typeof useSettingsNavigation>;
const Host = defineComponent({
  setup() {
    nav = useSettingsNavigation();
    return () => h("div");
  },
});

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/records", component: Host },
      { path: "/dictionary", component: Host },
      { path: "/settings", redirect: "/settings/general" },
      { path: "/settings/:tab", component: Host },
    ],
  });
  router.beforeEach(guardSettingsNavigation);
  return router;
}

async function setup(startPath: string) {
  const router = createTestRouter();
  await router.push(startPath);
  mount(Host, { global: { plugins: [router] } });
  return { router, nav: () => nav };
}

describe("設定模式導覽", () => {
  it("從詞庫進設定、切分頁後返回 → 回到詞庫", async () => {
    const { router, nav } = await setup("/dictionary");
    await nav().openSettings();
    expect(router.currentRoute.value.path).toBe("/settings/general");
    await router.push("/settings/mic");
    await nav().exitSettings();
    expect(router.currentRoute.value.path).toBe("/dictionary");
  });

  it("已在設定模式時 ⌘,（不帶分頁）不會把人拉回第一個分頁", async () => {
    const { router, nav } = await setup("/records");
    await router.push("/settings/hotkey");
    await nav().openSettings();
    expect(router.currentRoute.value.path).toBe("/settings/hotkey");
  });

  it("指定分頁時一定切過去（無 API 金鑰導向轉錄與整理）", async () => {
    const { router, nav } = await setup("/settings/general");
    await nav().openSettings("ai");
    expect(router.currentRoute.value.path).toBe("/settings/ai");
  });

  it("同一路由換成不認得的分頁 → 導回一般，不會停在無效網址", async () => {
    const { router } = await setup("/settings/ai");
    await router.push("/settings/unknown");
    expect(router.currentRoute.value.path).toBe("/settings/general");
  });
});
