# Architecture — Frontend Part

> Vue 3 + TypeScript + Tauri JS API · 雙視窗 SPA
> 掃描日期：2026-05-08 · 版本：0.9.5 · part_id: `frontend` · root: `src/`

---

## 一、Executive Summary

SayIt frontend 是一個 **Tauri WebView 中執行的雙入口 Vue 3 SPA**：

- **HUD（`label="main"`）** — 470×100 透明永遠最上層瀏海狀態浮窗，訂閱事件顯示錄音狀態
- **Dashboard（`label="main-window"`）** — 960×680 可拖拉視窗，提供設定、歷史、字典、統計

兩個視窗共用同一 SQLite 連線池（`tauri-plugin-sql` HashMap pool），共用同一份 i18n / Pinia store 模組碼，但**獨立 mount 兩棵 Vue 樹**並走不同的 Vite entry chunk。

---

## 二、Technology Stack

| 層級           | 技術                  | 版本       | 備註                                              |
| -------------- | --------------------- | ---------- | ------------------------------------------------- |
| 框架           | Vue                   | ^3.5       | **Composition API only**（禁止 Options API）      |
| 語言           | TypeScript            | ^5.7       | strict mode                                       |
| State          | Pinia                 | ^3.0.4     | setup syntax                                      |
| Router         | vue-router            | 5.0.3      | `createWebHashHistory()`（Tauri 必要）            |
| UI 元件        | shadcn-vue            | new-york   | 強制使用，禁止手寫替代品                          |
| UI 底層        | reka-ui               | ^2.8.2     | shadcn-vue 的無頭 UI 庫                           |
| CSS            | Tailwind CSS          | ^4         | `@import "tailwindcss"` 語法（v4）                |
| 圖示           | lucide-vue-next       | ^0.576.0   | **唯一允許的圖示庫**                              |
| 表格           | @tanstack/vue-table   | ^8.21.3    | DataTable 邏輯                                    |
| 圖表           | @unovis/vue + ts      | ^1.6.4     | shadcn-vue chart 底層                             |
| 工具           | @vueuse/core          | ^14.2.1    | composable 工具                                   |
| i18n           | vue-i18n              | ^11.3.0    | 5 語系（zh-TW / zh-CN / en / ja / ko）            |
| Telemetry      | @sentry/vue           | ^10.42.0   | 兩個視窗各自初始化                                |
| Build          | Vite                  | ^6         | 多入口（`index.html` + `main-window.html`）       |
| Test (unit)    | Vitest                | ^4.0.18    | jsdom 環境                                        |
| Test (E2E)     | Playwright            | ^1.58.2    | —                                                 |

---

## 三、Architecture Pattern：「Pinia-中心 + Composable-輔助」

```
┌──────────────────────────────────────────────────────┐
│                Views（路由元件）                      │
│  Dashboard / History / Dictionary / Settings / Guide │
└──────────────┬───────────────────────────────────────┘
               │ 不可直接呼叫 lib/，必須透過 store
┌──────────────▼───────────────────────────────────────┐
│              Stores（Pinia · 業務狀態）              │
│  useVoiceFlowStore      ── 核心 voice flow 狀態機    │
│  useSettingsStore       ── 全部設定 + autostart      │
│  useHistoryStore        ── 轉錄歷史 CRUD              │
│  useVocabularyStore     ── 字典 CRUD + 廣播           │
└──────┬─────────────────────────┬─────────────────────┘
       │                         │
       │ 業務邏輯/外部 IO          │ 跨元件邏輯
       ▼                         ▼
┌──────────────────────┐    ┌────────────────────────┐
│      lib/            │    │   composables/         │
│ database.ts          │    │ useTauriEvents（常數） │
│ enhancer.ts          │    │ useAudioWaveform       │
│ vocabularyAnalyzer   │    │ useAudioPreview        │
│ llmProvider          │    │ useFeedbackMessage     │
│ modelRegistry        │    └────────────────────────┘
│ database / sentry    │
│ autoUpdater          │
└──────┬───────────────┘
       │
       ▼
   外部 IO：Tauri Command / Event / SQLite / fetch (HTTP plugin)
```

**依賴方向硬規則**：

```
views/   ──→ components/ + stores/ + composables/   （不可 import lib/）
stores/  ──→ lib/                                    （業務邏輯下沉）
lib/     ──→ External APIs (Groq / OpenAI / Anthropic / Gemini)
```

> 這條規則由 `protect-config.sh` 與 PR review 共同把關。違反例子：`SettingsView.vue` 直接 `import { fetch }` 呼叫 Groq → 應改為 `useSettingsStore().validateApiKey()`。

---

## 四、Module Inventory

### 4.1 Entry Points

| 檔案                       | mount target | 視窗 label    | 職責                                          |
| -------------------------- | ------------ | ------------- | --------------------------------------------- |
| `src/main.ts` (22 行)      | `#app` (HUD) | `main`        | initSentryForHud → mount App.vue              |
| `src/main-window.ts` (103) | `#app` (Dashboard) | `main-window` | DB init → router → settings → autostart |

### 4.2 Stores（4 個 · ~4 KLOC）

| Store              | LOC  | 內部狀態（精選）                                                                                            |
| ------------------ | ---: | ----------------------------------------------------------------------------------------------------------- |
| useVoiceFlowStore  | 1871 | hud state、recording session、transcription、enhancement、quality monitor、edit mode、smart dict、模式切換 |
| useSettingsStore   | 1395 | apiKey（store plugin）、provider/model、hotkey config、audio device、auto-update、autostart、所有偏好設定 |
| useHistoryStore    |  580 | transcriptions list、search、cursor pagination、retranscribe                                                |
| useVocabularyStore |  200 | vocabulary list、CRUD、AI 學習提交                                                                          |

### 4.3 Lib Modules（13 個 · ~2.6 KLOC）

詳見 `source-tree-analysis.md` 第 2.4 節，重點：

- **`database.ts`** — singleton + double-init 防護（HUD 用 `connectToDatabase()`、Dashboard 用 `initializeDatabase()`）；支援 v1→v8 migration；含恢復邏輯（issue #27 vocabulary column 修復）
- **`llmProvider.ts`** — 四 provider 抽象，差異點封裝在 `buildFetchParams` / `parseProviderResponse`
- **`modelRegistry.ts`** — 集中管理模型清單；`DECOMMISSIONED_MODEL_MAP` 支援舊 ID 自動遷移到新 ID
- **`hallucinationDetector.ts`** — Whisper 幻覺偵測 v3，含繁中常見幻覺詞表
- **`sentry.ts`** — 兩個 init function（HUD 輕量 / Dashboard 完整含 router tracing），統一 `captureError` 入口

### 4.4 Composables（4 個 · ~220 LOC）

| Composable             | 用途                                          | 訂閱事件                |
| ---------------------- | --------------------------------------------- | ----------------------- |
| useTauriEvents.ts      | 唯一允許的 event API import 點                | （re-export）           |
| useAudioWaveform.ts    | HUD 波形動畫                                  | `audio:waveform`        |
| useAudioPreview.ts     | SettingsView 音量條                           | `audio:preview-level`   |
| useFeedbackMessage.ts  | UI 訊息提示                                   | —                       |

### 4.5 Views（5 個 · ~3 KLOC）

| View                  | LOC  | 路徑          | 主要互動                                    |
| --------------------- | ---: | ------------- | ------------------------------------------- |
| SettingsView.vue      | 1907 | /settings     | 全部設定（API Key、模型、熱鍵、音訊、進階）  |
| HistoryView.vue       |  379 | /history      | 歷史瀏覽 + 搜尋 + 重新轉錄 + 音訊播放        |
| DashboardView.vue     |  309 | /dashboard    | 統計卡片 + 使用量圖表 + 近期清單             |
| DictionaryView.vue    |  281 | /dictionary   | 字典 CRUD + 智慧學習                         |
| FeatureGuideView.vue  |   56 | /guide        | 功能導覽                                     |

### 4.6 Components（11 個 · ~1.9 KLOC）+ shadcn-vue UI（21 個）

詳見 `source-tree-analysis.md` 第 2.6 節。

---

## 五、Data Flow — 核心錄音流程

```
[使用者按住熱鍵]
       │
       ▼  Rust 端 hotkey_listener emit("hotkey:pressed")
       │
[useVoiceFlowStore 收到 event]
       │
       ├─ play_start_sound()         ── 音效
       ├─ capture_target_window()    ── 紀錄焦點視窗
       ├─ mute_system_audio()        ── 靜音系統
       ├─ start_recording()          ── cpal 錄音
       └─ HUD 切到 "recording" 狀態
       
[使用者放開熱鍵]
       │
       ▼  Rust emit("hotkey:released")
       │
[useVoiceFlowStore]
       │
       ├─ stop_recording() → 取得 audio buffer
       ├─ play_stop_sound()
       ├─ restore_system_audio()
       ├─ HUD 切到 "transcribing"
       │
       ├─ transcribe_audio(api_key, vocabulary, model, language)
       │  └── Rust 直接打 Groq Whisper API（繞過前端 fetch）
       │
       ├─ HUD 切到 "enhancing"
       │
       ├─ enhancer.enhance(rawText, vocabulary, prompt)
       │  └── llmProvider.fetch → Groq/OpenAI/Anthropic/Gemini
       │
       ├─ paste_text(processedText)  ── CGEvent / SendInput
       ├─ save_recording_file(id)
       ├─ DB insert transcription + api_usage
       ├─ start_quality_monitor()    ── 後續監測修正
       └─ HUD 切到 "success" → 1.5s 後 idle
```

**ESC 全域中止**：任何階段 Rust 端 emit `escape:pressed` → store 立即 cleanup → HUD 回 idle。

---

## 六、Sentry / 錯誤上報邊界

| 點位                                  | 行為                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `main.ts` `unhandledrejection`        | `captureError(reason, { source: "hud-unhandled-rejection" })` |
| `main.ts` `app.config.errorHandler`   | `captureError(err, { source: "hud-vue-error", info })`    |
| `main-window.ts` `unhandledrejection` | `captureError(reason, { source: "dashboard-unhandled-rejection" })` |
| `main-window.ts` `errorHandler`       | `captureError(err, { source: "dashboard-vue-error", info })` |
| 業務點位                              | `captureError(err, { source: "..." })`，視窗用 `tags: { window: "hud"|"dashboard" }` 區分 |

> **Production-only**：`initSentryForHud` / `initSentryForDashboard` 內部檢查 DSN 與環境變數，dev 模式不發送。

---

## 七、Internationalization (i18n)

```
src/i18n/
├── index.ts            # createI18n({ legacy: false, locale, ... })
├── languageConfig.ts   # 語系列表 + Whisper 語言代碼映射
├── prompts.ts          # 各語系的 LLM enhancement prompt
└── locales/{en,zh-TW,zh-CN,ja,ko}.json
```

**Whisper 語言代碼映射特例**：`languageConfig.ts` 的 `getWhisperLanguageCode()` 對 "auto" 模式回傳 `null`（讓 Whisper 自動偵測），其餘語言回傳對應 ISO code。Rust fallback 為 `"zh"`。

---

## 八、Build 配置與多入口

`vite.config.ts` 設定兩個 entry：

```
input:
  - index.html         → src/main.ts        → HUD bundle
  - main-window.html   → src/main-window.ts → Dashboard bundle
```

兩個 bundle 共用 chunk（如 stores、lib），但各自有獨立 entry chunk。Tauri 運行時用 `WebviewWindow` 的 `url` 屬性指定載入哪個 HTML。

---

## 九、Testing Strategy

| 類別     | 工具                | 位置                | 範圍                                    |
| -------- | ------------------- | ------------------- | --------------------------------------- |
| Unit     | Vitest + jsdom      | `tests/unit/`       | stores、lib（純邏輯）                   |
| Component| @vue/test-utils     | `tests/component/`  | components（rendering + interaction）   |
| E2E      | Playwright          | `tests/e2e/`        | 跨視窗使用者旅程                         |
| Coverage | @vitest/coverage-v8 | —                   | `pnpm test:coverage`                    |

CI 只跑 `pnpm test`（unit + component），E2E 目前未在 CI 執行（仍在本機跑）。

---

## 十、不可違反的硬規則（最常踩）

1. **❌ 瀏覽器原生 `fetch`** → ✅ 用 `@tauri-apps/plugin-http` 的 `fetch`（避開 CORS）
2. **❌ Options API** → ✅ `<script setup lang="ts">`
3. **❌ views 直接 import lib/** → ✅ 透過 Pinia store
4. **❌ SQLite 存 API Key** → ✅ 只能用 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩** → ✅ 語意變數（`bg-primary`、`text-foreground`、`border-border`）
6. **❌ `@tabler/icons-vue`** → ✅ 只用 `lucide-vue-next`
7. **❌ 手寫 UI 元件** → ✅ 用 shadcn-vue（new-york style）
8. **❌ 直接 import Tauri event API** → ✅ 透過 `composables/useTauriEvents.ts`
9. **❌ 未經 Pencil 設計直接寫 UI** → ✅ 先在 `design.pen` 完成設計

---

## 十一、Open Issues / Tech Debt

| Issue              | 描述                                                         |
| ------------------ | ------------------------------------------------------------ |
| `@tabler/icons-vue` 殘留 | dashboard-01 block 附帶安裝，新程式碼不應使用                |
| `addApiUsage` FK 失敗 (787) | `transcriptions` 與 `api_usage` 寫入 race，待調查           |
| autoUpdater 的 `window.confirm` | Tauri WKWebView 會靜默忽略，需改 in-app UI                |
| FeatureGuideView 內容不足 | 56 行，多數靜態文案                                          |
