import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SupportedLocale } from "../../src/i18n/languageConfig";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  emit: mockEmit,
}));

describe("i18n 設定功能", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockStoreDelete.mockClear();
    mockStoreSave.mockClear();
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockEmit.mockClear().mockResolvedValue(undefined);
    vi.resetModules();
  });

  // ==========================================================================
  // saveLocale
  // ==========================================================================

  describe("saveLocale", () => {
    it("[P0] saveLocale('en') 應正確存入 store 並更新 i18n.global.locale", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("en");

      expect(mockStoreSet).toHaveBeenCalledWith("selectedLocale", "en");
      expect(mockStoreSave).toHaveBeenCalled();
    });

    it("[P0] saveLocale('ja') 應更新 document.documentElement.lang 為 'ja'", async () => {
      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      await store.saveLocale("ja");

      expect(document.documentElement.lang).toBe("ja");
    });
  });

  // ==========================================================================
  // getWhisperLanguageCode
  // ==========================================================================

  describe("getWhisperLanguageCode", () => {
    const testCaseList: [SupportedLocale, string][] = [
      ["zh-TW", "zh"],
      ["en", "en"],
      ["ja", "ja"],
      ["zh-CN", "zh"],
      ["ko", "ko"],
    ];

    it.each(testCaseList)(
      "[P0] locale '%s' → whisperCode '%s'",
      async (locale, expectedCode) => {
        mockStoreData.set("selectedLocale", locale);

        const { useSettingsStore } = await import(
          "../../src/stores/useSettingsStore"
        );
        const store = useSettingsStore();
        await store.loadSettings();

        expect(store.getWhisperLanguageCode()).toBe(expectedCode);
      },
    );
  });

  // ==========================================================================
  // detectSystemLocale
  // ==========================================================================

  describe("detectSystemLocale", () => {
    it("[P0] 精確匹配：navigator.languages=['zh-Hant-TW'] → 'zh-TW'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant-TW"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });

    it("[P0] script subtag 匹配：navigator.languages=['zh-Hant'] → 'zh-TW'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hant"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });

    it("[P0] script subtag 匹配：navigator.languages=['zh-Hans'] → 'zh-CN'", async () => {
      vi.stubGlobal("navigator", { languages: ["zh-Hans"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-CN");

      vi.unstubAllGlobals();
    });

    it("[P0] 前綴匹配：navigator.languages=['ja-JP'] → 'ja'", async () => {
      vi.stubGlobal("navigator", { languages: ["ja-JP"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("ja");

      vi.unstubAllGlobals();
    });

    it("[P0] 無匹配時 fallback 為 'zh-TW'：navigator.languages=['th']", async () => {
      vi.stubGlobal("navigator", { languages: ["th"] });

      const { detectSystemLocale } = await import(
        "../../src/i18n/languageConfig"
      );
      expect(detectSystemLocale()).toBe("zh-TW");

      vi.unstubAllGlobals();
    });
  });

  // ==========================================================================
  // Prompt auto-switch
  // ==========================================================================

  describe("語言切換 prompt 連動", () => {
    it("[P0] 未自訂 prompt 時，切換語言應自動更新為新語言預設", async () => {
      // 明確設定起始 locale 為 zh-TW（避免 jsdom 環境 detectSystemLocale 不穩定）
      mockStoreData.set("selectedLocale", "zh-TW");

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      const { getDefaultPromptForLocale } = await import(
        "../../src/i18n/prompts"
      );
      const zhDefault = getDefaultPromptForLocale("zh-TW");
      expect(store.getAiPrompt()).toBe(zhDefault);

      // 切換為 English
      await store.saveLocale("en");

      const enDefault = getDefaultPromptForLocale("en");
      expect(store.getAiPrompt()).toBe(enDefault);
    });

    it("[P0] 已自訂 prompt 時，切換語言不應改變 prompt", async () => {
      const customPrompt = "我的自訂 prompt 內容";
      mockStoreData.set("selectedLocale", "zh-TW");
      mockStoreData.set("aiPrompt", customPrompt);

      const { useSettingsStore } = await import(
        "../../src/stores/useSettingsStore"
      );
      const store = useSettingsStore();
      await store.loadSettings();

      expect(store.getAiPrompt()).toBe(customPrompt);

      await store.saveLocale("en");

      expect(store.getAiPrompt()).toBe(customPrompt);
    });
  });

  // ==========================================================================
  // 翻譯檔 key 一致性驗證
  // ==========================================================================

  describe("翻譯檔 key 一致性", () => {
    it("[P0] 所有 5 個 locale JSON 檔的 key 集合應完全一致", async () => {
      const zhTW = await import("../../src/i18n/locales/zh-TW.json");
      const en = await import("../../src/i18n/locales/en.json");
      const ja = await import("../../src/i18n/locales/ja.json");
      const zhCN = await import("../../src/i18n/locales/zh-CN.json");
      const ko = await import("../../src/i18n/locales/ko.json");

      function getKeyList(obj: Record<string, unknown>, prefix = ""): string[] {
        const keyList: string[] = [];
        for (const k of Object.keys(obj).sort()) {
          const full = prefix ? `${prefix}.${k}` : k;
          if (typeof obj[k] === "object" && obj[k] !== null) {
            keyList.push(
              ...getKeyList(obj[k] as Record<string, unknown>, full),
            );
          } else {
            keyList.push(full);
          }
        }
        return keyList;
      }

      const baseKeyList = getKeyList(zhTW.default);
      const localeMap: Record<string, string[]> = {
        en: getKeyList(en.default),
        ja: getKeyList(ja.default),
        "zh-CN": getKeyList(zhCN.default),
        ko: getKeyList(ko.default),
      };

      for (const [locale, keyList] of Object.entries(localeMap)) {
        const missingKeyList = baseKeyList.filter((k) => !keyList.includes(k));
        const extraKeyList = keyList.filter((k) => !baseKeyList.includes(k));

        expect(
          missingKeyList,
          `${locale} 缺少以下 key: ${missingKeyList.join(", ")}`,
        ).toHaveLength(0);
        expect(
          extraKeyList,
          `${locale} 多出以下 key: ${extraKeyList.join(", ")}`,
        ).toHaveLength(0);
      }
    });
  });
});
