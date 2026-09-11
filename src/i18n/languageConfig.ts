export type SupportedLocale = "zh-TW" | "en" | "ja" | "zh-CN" | "ko";

export const FALLBACK_LOCALE: SupportedLocale = "zh-TW";

export interface LanguageOption {
  locale: SupportedLocale;
  displayName: string;
  whisperCode: string;
  htmlLang: string;
  navigatorPatternList: string[];
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    locale: "zh-TW",
    displayName: "\u7E41\u9AD4\u4E2D\u6587",
    whisperCode: "zh",
    htmlLang: "zh-Hant",
    navigatorPatternList: ["zh-Hant-TW", "zh-Hant", "zh-TW"],
  },
  {
    locale: "en",
    displayName: "English",
    whisperCode: "en",
    htmlLang: "en",
    navigatorPatternList: ["en"],
  },
  {
    locale: "ja",
    displayName: "\u65E5\u672C\u8A9E",
    whisperCode: "ja",
    htmlLang: "ja",
    navigatorPatternList: ["ja"],
  },
  {
    locale: "zh-CN",
    displayName: "\u7B80\u4F53\u4E2D\u6587",
    whisperCode: "zh",
    htmlLang: "zh-Hans",
    navigatorPatternList: ["zh-Hans", "zh-CN"],
  },
  {
    locale: "ko",
    displayName: "\uD55C\uAD6D\uC5B4",
    whisperCode: "ko",
    htmlLang: "ko",
    navigatorPatternList: ["ko"],
  },
];

export function detectSystemLocale(): SupportedLocale {
  const browserLanguageList =
    typeof navigator !== "undefined" ? navigator.languages : [];

  for (const browserLang of browserLanguageList) {
    // 1. Exact match (e.g. "zh-Hant-TW" -> zh-TW)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some(
          (pattern) => pattern.toLowerCase() === browserLang.toLowerCase(),
        )
      ) {
        return option.locale;
      }
    }

    // 2. Script subtag match (e.g. "zh-Hant" -> zh-TW, "zh-Hans" -> zh-CN)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some((pattern) =>
          browserLang.toLowerCase().startsWith(pattern.toLowerCase() + "-"),
        )
      ) {
        return option.locale;
      }
    }

    // 3. Language prefix match (e.g. "ja-JP" -> ja, "ko-KR" -> ko, "en-US" -> en)
    const langPrefix = browserLang.split("-")[0].toLowerCase();
    for (const option of LANGUAGE_OPTIONS) {
      if (option.locale.toLowerCase() === langPrefix) {
        return option.locale;
      }
    }

    // 4. Bare "zh" -> zh-TW (protect traditional Chinese users)
    if (langPrefix === "zh") {
      return "zh-TW";
    }
  }

  // 5. Fallback
  return FALLBACK_LOCALE;
}

export function getHtmlLangForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.htmlLang ?? "zh-Hant";
}

export function getWhisperCodeForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.whisperCode ?? "zh";
}

/** 只作轉錄語言、不是介面語言：gh-74 廣東話（Whisper `yue`） */
export type TranscriptionOnlyLocale = "yue";

export type TranscriptionLocale =
  | SupportedLocale
  | TranscriptionOnlyLocale
  | "auto";

export interface TranscriptionLanguageOption {
  locale: TranscriptionLocale;
  displayName: string;
  whisperCode: string | null;
}

export const TRANSCRIPTION_LANGUAGE_OPTIONS: TranscriptionLanguageOption[] = [
  {
    locale: "auto",
    displayName: "自動偵測",
    whisperCode: null,
  },
  ...LANGUAGE_OPTIONS.map((opt) => ({
    locale: opt.locale as TranscriptionLocale,
    displayName: opt.displayName,
    whisperCode: opt.whisperCode,
  })),
  {
    locale: "yue",
    displayName: "\u5EE3\u6771\u8A71",
    whisperCode: "yue",
  },
];

export function getWhisperCodeForTranscriptionLocale(
  locale: TranscriptionLocale,
): string | null {
  if (locale === "auto") return null;
  if (locale === "yue") return "yue";
  return getWhisperCodeForLocale(locale);
}
