/// <reference types="vite/client" />
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { THEME_MODE_VALUES, type ThemeMode } from "../types/settings";
import { listenToEvent, THEME_OS_CHANGED } from "../composables/useTauriEvents";

const STORE_NAME = "settings.json";
const THEME_STORE_KEY = "themeMode";
// 同步快取，供 HTML inline script 在首次繪製前讀取，避免閃色
const THEME_LOCAL_KEY = "sayit-theme-mode";
export const DEFAULT_THEME_MODE: ThemeMode = "system";

let mediaQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;
let activeMode: ThemeMode = DEFAULT_THEME_MODE;

// OS 外觀權威來源優先序：Rust `get_os_theme`（Windows 讀登錄檔，不受透明/隱藏
// 視窗 WebView2 影響）→ Tauri `window.theme()` → matchMedia（最後 fallback）。
// 透明+隱藏的 HUD 在 Windows 收不到 WM_THEMECHANGED，故 OS 變更改由 Rust 以
// `theme:os-changed` 自訂事件可靠廣播（見下方 ensureOsThemeBroadcastListener）。
let osThemeDark: boolean | null = null;
let osWatcherInit = false;
let unlistenOsThemeWatcher: (() => void) | null = null;
let unlistenOsThemeBroadcast: (() => void) | null = null;

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODE_VALUES as readonly string[]).includes(value)
  );
}

function prefersDark(): boolean {
  if (osThemeDark !== null) return osThemeDark;
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (prefersDark() ? "dark" : "light") : mode;
}

// 取得權威 OS 外觀，快取供同步的 applyTheme 使用。
// 優先 Rust `get_os_theme`（Windows 讀登錄檔，最可靠）→ Tauri `window.theme()`。
async function refreshOsTheme(): Promise<void> {
  try {
    const osTheme = await invoke<string | null>("get_os_theme");
    if (osTheme === "dark") {
      osThemeDark = true;
      return;
    }
    if (osTheme === "light") {
      osThemeDark = false;
      return;
    }
    // null（非 Windows / 讀取失敗）→ 往下 fallback
  } catch {
    // 非 Tauri 環境或 command 未註冊：往下 fallback
  }
  try {
    const t = await getCurrentWindow().theme();
    if (t === "dark") osThemeDark = true;
    else if (t === "light") osThemeDark = false;
    // null（如舊版 macOS）→ 維持原值，改用 matchMedia fallback
  } catch {
    // 非 Tauri 環境或無權限：維持 null，改用 matchMedia fallback
  }
}

// 訂閱 OS 外觀變更（system 模式時即時重新套用），全程僅訂閱一次
async function ensureOsThemeWatcher(): Promise<void> {
  if (osWatcherInit) return;
  osWatcherInit = true;
  try {
    unlistenOsThemeWatcher = await getCurrentWindow().onThemeChanged(
      ({ payload }) => {
        osThemeDark = payload === "dark";
        if (activeMode === "system") {
          document.documentElement.classList.toggle("dark", osThemeDark);
        }
      },
    );
  } catch {
    osWatcherInit = false; // 失敗允許之後重試
  }
}

// 訂閱 Rust 廣播的 OS 外觀變更（`theme:os-changed`）。透明+隱藏的 HUD 在
// Windows 收不到 WM_THEMECHANGED，此自訂事件走可靠 IPC，所有視窗皆能即時跟隨。
async function ensureOsThemeBroadcastListener(): Promise<void> {
  if (unlistenOsThemeBroadcast) return;
  try {
    unlistenOsThemeBroadcast = await listenToEvent<string>(
      THEME_OS_CHANGED,
      ({ payload }) => {
        osThemeDark = payload === "dark";
        if (activeMode === "system") {
          document.documentElement.classList.toggle("dark", osThemeDark);
        }
      },
    );
  } catch {
    // 監聽失敗允許之後重試（下次 initThemeFromStore）
  }
}

// Vite HMR：模組熱替換時解除舊訂閱，避免 dev 期間重複監聽
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unlistenOsThemeWatcher?.();
    unlistenOsThemeWatcher = null;
    osWatcherInit = false;
    unlistenOsThemeBroadcast?.();
    unlistenOsThemeBroadcast = null;
  });
}

// 只在 system 模式時掛系統偏好監聽（matchMedia fallback），其餘模式移除
function ensureSystemListener(mode: ThemeMode): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  if (mode === "system") {
    mediaQuery ??= window.matchMedia("(prefers-color-scheme: dark)");
    if (!systemListener) {
      systemListener = () => {
        // Tauri onThemeChanged 為主；此處僅在無權威值時 fallback
        if (activeMode === "system" && osThemeDark === null) {
          document.documentElement.classList.toggle("dark", prefersDark());
        }
      };
      mediaQuery.addEventListener("change", systemListener);
    }
  } else if (mediaQuery && systemListener) {
    mediaQuery.removeEventListener("change", systemListener);
    systemListener = null;
  }
}

// 套用主題：toggle <html>.dark（style.css 的 :root 為淺色、.dark 為深色）
export function applyTheme(mode: ThemeMode): void {
  activeMode = mode;
  document.documentElement.classList.toggle("dark", resolveTheme(mode) === "dark");
  try {
    localStorage.setItem(THEME_LOCAL_KEY, mode);
  } catch {
    // localStorage 不可用時略過快取，不影響套用
  }
  ensureSystemListener(mode);
}

// mount 前盡早讀取持久化主題並套用，避免閃白
export async function initThemeFromStore(): Promise<ThemeMode> {
  // 先註冊 OS 外觀廣播監聽，再做權威讀取：避免「監聽就緒前 OS 剛好變更、
  // Rust poll 已 emit 而前端漏接」的啟動競態（poll 不 replay current state，
  // 故 listener 須先就緒；之後 refreshOsTheme 直接讀登錄檔取得當下真值補正）。
  void ensureOsThemeWatcher();
  await ensureOsThemeBroadcastListener();
  await refreshOsTheme();

  let mode = DEFAULT_THEME_MODE;
  try {
    const store = await load(STORE_NAME);
    const saved = await store.get<ThemeMode>(THEME_STORE_KEY);
    if (isThemeMode(saved)) {
      mode = saved;
    }
  } catch {
    // 讀取失敗時沿用預設（system），不阻斷啟動
  }
  applyTheme(mode);
  return mode;
}
