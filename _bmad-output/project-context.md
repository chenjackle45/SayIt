---
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-03-04'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 106
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Core Technologies

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Desktop Framework | Tauri | v2.10.x | 雙視窗、System Tray、macOS Private API |
| Frontend | Vue 3 | ^3.5 | Composition API only（禁止 Options API） |
| Language (Frontend) | TypeScript | ^5.7 | strict mode 啟用 |
| Language (Backend) | Rust | 2021 edition | — |
| CSS | Tailwind CSS | ^4 | v4 使用 `@import "tailwindcss"` 語法 |
| UI 元件 | shadcn-vue | new-york style | 強制使用，詳見 ux-ui-design-spec.md |
| State Management | Pinia | ^3.0.4 | — |
| Router | vue-router | 5.0.3 | webHashHistory |
| Build | Vite | ^6 | 多入口（HUD + Dashboard） |
| Package Manager | pnpm | — | 必須使用 pnpm，不可用 npm/yarn |
| Node | 24 | .nvmrc 鎖定 | — |
| Test (Unit) | Vitest | ^4.0.18 | jsdom 環境 |
| Test (E2E) | Playwright | ^1.58.2 | — |

### Frontend Dependencies

| 套件 | 版本 | 用途 |
|------|------|------|
| `reka-ui` | ^2.8.2 | shadcn-vue 底層無頭 UI 庫 |
| `lucide-vue-next` | ^0.576.0 | 唯一允許的圖標庫 |
| `@vueuse/core` | ^14.2.1 | Vue Composition 工具函式 |
| `@tanstack/vue-table` | ^8.21.3 | 表格邏輯（DataTable 元件） |
| `@unovis/ts` + `@unovis/vue` | ^1.6.4 | 圖表庫（shadcn-vue chart 底層） |
| `class-variance-authority` | ^0.7.1 | CSS 變體管理（shadcn-vue 依賴） |
| `clsx` + `tailwind-merge` | ^2.1.1 / ^3.5.0 | `cn()` 工具函式底層（`src/lib/utils.ts`） |
| `@faker-js/faker` | ^10.3.0 | 開發用假資料（devDependency） |

### ⚠️ 已安裝但不應使用

| 套件 | 原因 |
|------|------|
| `@tabler/icons-vue` | UI 設計規範強制只用 `lucide-vue-next`，此套件為 dashboard-01 block 附帶安裝，新程式碼禁止使用 |

### Tauri Plugins（Rust + JS 雙端）

| Plugin | Rust Version | JS Version | 用途 |
|--------|-------------|-----------|------|
| `tauri-plugin-shell` | 2 | ^2 | Shell 操作 |
| `tauri-plugin-http` | 2 | ^2.5.7 | HTTP 請求（繞過 CORS） |
| `tauri-plugin-sql` | 2.3.1 | ^2.3.2 | SQLite 資料庫 |
| `tauri-plugin-autostart` | 2.5.1 | ^2.5.1 | 開機啟動 |
| `tauri-plugin-updater` | ~2.10.0 | ^2.10.0 | 應用更新 |
| `tauri-plugin-store` | ~2.4 | ^2.4.2 | 鍵值存儲（API Key） |
| `tauri-plugin-process` | 2 | ^2.3.1 | App 重啟（自動更新後 relaunch） |

### Rust Platform Dependencies

| 套件 | 平台 | 用途 |
|------|------|------|
| `core-graphics` 0.24 + `core-foundation` 0.10 + `objc` 0.2 | macOS | 視窗控制、CGEventTap |
| `windows` 0.61 | Windows | Win32 API、鍵盤 Hook |
| `arboard` 3 | 跨平台 | 剪貼簿存取 |

### External APIs

- Groq Whisper API — `https://api.groq.com/openai/v1/audio/transcriptions`（模型：`whisper-large-v3`，語言：`zh`）
- Groq LLM API — `https://api.groq.com/openai/v1/chat/completions`（模型：`llama-3.3-70b-versatile`，temperature: 0.3，timeout: 5s）
- CSP 白名單：`connect-src 'self' https://api.groq.com`

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript

- **strict mode 啟用** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` 全部開啟
- **target ES2021** — 可使用 `Promise.allSettled()`, `??`, `?.`，不可使用 ES2022+ 特性
- **`import type` 分離** — 純型別匯入必須使用 `import type { Xxx }` 語法
- **模組系統** — ESNext modules（`"type": "module"`），匯入路徑不帶 `.ts` 副檔名
- **路徑別名** — `@/*` → `./src/*`（tsconfig.json + vite.config.ts 同步設定）
- **環境變數前綴** — 前端環境變數必須以 `VITE_` 或 `TAURI_` 開頭
- **編譯時常數** — `__APP_VERSION__`（Vite `define`，值來自 `package.json` version），用於 UI 顯示版本號
- **錯誤訊息格式** — `err instanceof Error ? err.message : String(err)` 作為標準錯誤取值模式（使用 `extractErrorMessage()` from `errorUtils.ts`）
- **錯誤訊息本地化** — 使用 `src/lib/errorUtils.ts` 集中管理使用者可見的錯誤訊息（繁體中文），按功能分函式：`getMicrophoneErrorMessage()`, `getTranscriptionErrorMessage()`, `getEnhancementErrorMessage()`

#### Rust

- **Tauri Command 簽名** — 必須加泛型 `<R: Runtime>` 約束，返回 `Result<T, CustomError>`
- **錯誤型別** — 使用 `thiserror` crate 定義 enum，且必須手動 `impl serde::Serialize`
- **平台隔離** — `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 隔離，不可在同一函式中混合
- **unsafe 標記** — macOS `objc::msg_send!` 呼叫必須在 `unsafe {}` 區塊內
- **原子操作** — 跨執行緒共享狀態使用 `AtomicBool` + `Ordering::SeqCst`
- **Plugin 模式** — 每個功能模組是獨立的 `TauriPlugin<R>`，在 `plugins/mod.rs` 中 `pub mod` 匯出（目前：`clipboard_paste`, `hotkey_listener`, `keyboard_monitor`）
- **Serde JSON 序列化** — Rust → 前端的 payload struct 使用 `#[serde(rename_all = "camelCase")]` 確保前端收到 camelCase JSON
- **Crate 命名** — `name = "sayit_lib"`，`crate-type = ["staticlib", "cdylib", "rlib"]`
- **Release profile** — `panic = "abort"`, `lto = true`, `opt-level = "s"`（檔案大小最佳化）

### Framework-Specific Rules

#### Vue 3 (Composition API)

- **僅使用 `<script setup lang="ts">`** — 禁止 Options API（data/methods/computed 物件語法）
- **Composable 模式** — 可複用邏輯封裝為 `useXxx()` 函式，放在 `src/composables/`
- **狀態暴露** — Composable 內部用 `ref()` 管理，對外返回 `readonly()` 防止直接修改
- **計算屬性** — 衍生狀態一律用 `computed()` 而非手動 watch + 賦值
- **元件命名** — SFC 檔案名 PascalCase，模板中使用 `<PascalCase />` 自閉合標籤
- **條件 class** — 使用 `:class="{ 'class-name': condition }"` 綁定語法

#### Pinia Store

- **Store ID** — kebab-case，如 `defineStore('settings', ...)`
- **Store 檔案** — `useXxxStore.ts` 放在 `src/stores/`
- **Store 是唯一的資料存取層** — views 不可直接呼叫 `lib/`，必須透過 store actions
- **Store 內部結構** — 使用 Setup Store 語法（`defineStore('id', () => { ... })`），搭配 `ref()`, `computed()`, 函式
- **跨 Store 引用** — Store actions 中可用 `useOtherStore()` 取得其他 store instance（如 `useVoiceFlowStore` 引用 `useSettingsStore`、`useVocabularyStore`、`useHistoryStore`）

#### Vue Router

- **History 模式** — `createWebHashHistory()`（Tauri WebView 不支援 HTML5 History）
- **路由定義** — `src/router.ts`，四個頁面路由：`/dashboard`、`/history`、`/dictionary`、`/settings`
- **預設路由** — `/` redirect 到 `/dashboard`

#### Tauri v2 通訊

- **前端 → Rust** — `invoke('command_name', { args })`
- **Rust → 前端** — `emit()` / `emitTo(windowLabel, event, payload)`
- **前端監聽** — `listen('event-name', callback)`，元件卸載時 `unlisten()`
- **Event 命名** — `{domain}:{action}` kebab-case（如 `voice-flow:state-changed`）
- **Event 封裝** — `src/composables/useTauriEvents.ts` 統一匯出常量和函式：`emitEvent`, `emitToWindow`, `listenToEvent` + 所有 event name 常量
- **HTTP 請求** — 使用 `@tauri-apps/plugin-http` 的 `fetch`（非瀏覽器原生 fetch），繞過 CORS
- **視窗操作** — `getCurrentWindow()` 取得當前視窗實例
- **多入口架構** — HUD（`index.html` → `main.ts` → `App.vue`）和 Dashboard（`main-window.html` → `main-window.ts` → `MainApp.vue`）為獨立入口

#### Tauri Events 完整清單

| Event Name | 常量名 | Direction | Payload |
|------------|--------|-----------|---------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD ← VoiceFlow | `VoiceFlowStateChangedPayload` |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | → Main Window | `TranscriptionCompletedPayload` |
| `settings:updated` | `SETTINGS_UPDATED` | → All Windows | `SettingsUpdatedPayload` |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | → All Windows | `VocabularyChangedPayload` |
| `hotkey:pressed` | `HOTKEY_PRESSED` | Rust → HUD | — |
| `hotkey:released` | `HOTKEY_RELEASED` | Rust → HUD | — |
| `hotkey:toggled` | `HOTKEY_TOGGLED` | Rust → HUD | `HotkeyEventPayload` |
| `hotkey:error` | `HOTKEY_ERROR` | Rust → HUD | `HotkeyErrorPayload` |
| `quality-monitor:result` | `QUALITY_MONITOR_RESULT` | Rust → HUD | `QualityMonitorResultPayload` |

#### Tailwind CSS v4

- **入口語法** — `@import "tailwindcss"`（非 v3 的 @tailwind 指令）
- **Vite 整合** — 透過 `@tailwindcss/vite` plugin，非 PostCSS 配置
- **色彩空間** — oklch（CSS 變數定義在 `src/style.css`）
- **自訂變體** — `@custom-variant dark (&:is(.dark *))`

#### UI 設計規範（強制）

- **規範文件** — `_bmad-output/planning-artifacts/ux-ui-design-spec.md`，所有 UI 實作必須遵循
- **設計稿先行** — 任何 UI 實作前必須先在 `design.pen` 完成設計稿並取得使用者確認
- **shadcn-vue 強制** — 所有 UI 元件使用 shadcn-vue（new-york style, neutral base），禁止手寫替代品
- **語意色彩** — 禁止 Tailwind 原生色彩（`zinc-*`, `teal-*`），必須用語意變數（`bg-primary`, `text-foreground`）
- **品牌色** — Teal 主題（`pnpm dlx shadcn-vue@latest init --theme teal`）
- **圖標** — 僅 `lucide-vue-next`，禁止 Emoji 和 `@tabler/icons-vue`
- **例外** — `NotchHud.vue` 和 `App.vue` 允許手寫 CSS（Notch 動畫引擎）
- **cn() 工具** — `src/lib/utils.ts` 提供 `cn()` 函式，用於合併 Tailwind class，不可移除或修改

#### SQLite（tauri-plugin-sql）

- **初始化** — `src/lib/database.ts` 定義 schema，`main-window.ts` 在 `app.mount()` **之前**呼叫 `initializeDatabase()`（避免 `onMounted` race condition）
- **Singleton 防禦模式** — `initializeDatabase()` 使用 local `connection` 變數執行所有 schema DDL，**只有全部成功後**才賦值給 module-level `db`。避免「半初始化狀態」——`getDatabase()` 返回無表的空連線
- **Tauri 權限** — `sql:default` 僅包含 `allow-load/select/close`（唯讀），寫入操作（`CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`）需要在 `capabilities/default.json` 額外加上 `sql:allow-execute`
- **WAL 模式** — `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`
- **表命名** — 複數 snake_case（`transcriptions`, `vocabulary`, `api_usage`）
- **欄位命名** — snake_case（`raw_text`, `was_enhanced`）
- **主鍵** — `TEXT PRIMARY KEY`（UUID，前端 `crypto.randomUUID()` 產生）
- **時間戳** — `created_at TEXT DEFAULT (datetime('now'))`
- **操作限制** — SQLite 操作只從 Pinia store actions 發起，元件不可直接執行 SQL
- **SQL 參數** — 使用 `$1`, `$2` 位置參數語法（tauri-plugin-sql 規範）
- **Schema Migration** — `schema_version` 表追蹤版本號，migration 在 `database.ts` 中依序執行（`if (currentVersion < N)` → 建表/改表 → 更新版本號），當前版本：v2
- **外鍵關聯** — `api_usage.transcription_id` → `transcriptions.id`，新增表時必須同步建立 index

#### API 用量追蹤

- **費用計算** — `src/lib/apiPricing.ts` 提供 `calculateWhisperCostCeiling()` 和 `calculateChatCostCeiling()` 純函式
- **費用上限原則** — 一律取較貴的費率計算（如 LLM 取 output token 價格 $0.79/M），確保是費用上限而非精確值
- **Whisper 最低計費** — 不足 10 秒一律按 10 秒算（Groq 計費規則）
- **api_usage 表** — 每次 API 呼叫存一筆記錄（`whisper` / `chat`），由 `useVoiceFlowStore` 在轉錄/AI 整理完成後透過 `useHistoryStore` 寫入
- **型別** — `ApiUsageRecord`, `ChatUsageData`, `EnhanceResult`, `DailyUsageTrend`（定義在 `src/types/transcription.ts`）

### Testing Rules

#### 測試框架

- **單元/元件測試** — Vitest ^4.0.18（jsdom 環境，`test.globals: true`）
- **E2E 測試** — Playwright ^1.58.2（baseURL `http://localhost:1420`）
- **覆蓋率** — V8 provider（`@vitest/coverage-v8`）
- **Vue 測試工具** — `@vue/test-utils` ^2.4.6

#### 測試檔案組織

- **單元測試** — `tests/unit/**/*.test.ts`
- **元件測試** — `tests/component/**/*.test.ts`
- **E2E 測試** — `tests/e2e/`
- **覆蓋率排除** — `src/main.ts`、`src/main-window.ts`、`src/**/*.d.ts`

#### 現有測試清單

| 測試檔案 | 測試對象 |
|----------|---------|
| `transcriber.test.ts` | Groq Whisper API 呼叫邏輯 |
| `enhancer.test.ts` | Groq LLM AI 整理邏輯 |
| `recorder.test.ts` | MediaRecorder 錄音邏輯 |
| `error-utils.test.ts` | 錯誤訊息本地化 |
| `auto-updater.test.ts` | 自動更新流程 |
| `use-voice-flow-store.test.ts` | 錄音→轉錄→AI 整理流程狀態 |
| `use-history-store.test.ts` | 歷史記錄 CRUD + 統計查詢 |
| `use-settings-store.test.ts` | 設定讀寫（hotkey, API Key, prompt） |
| `use-settings-store-autostart.test.ts` | 開機自啟動邏輯 |
| `api-pricing.test.ts` | API 費用計算邏輯 |
| `format-utils.test.ts` | 時間/文字格式化工具 |
| `factories.test.ts` | 測試資料工廠 |
| `types.test.ts` | 型別定義驗證 |

#### 測試規則

- **不主動新增測試** — 除非 Story 明確要求或使用者指示，AI agents 不應自行建立測試
- **型別檢查作為品質門檻** — `vue-tsc --noEmit` 是 build 前自動執行的品質檢查
- **手動驗證重點** — E2E 流程：熱鍵觸發 → 錄音 → 轉錄 → (AI 整理) → 貼上，以及 HUD 狀態轉換
- **假資料** — 使用 `@faker-js/faker` 生成測試/開發用資料
- **Playwright 設定** — 完全並行、60s 測試 timeout、trace on-first-retry、screenshot only-on-failure

#### 測試執行指令

| 指令 | 用途 |
|------|------|
| `pnpm test` | Vitest 單次執行 |
| `pnpm test:watch` | Vitest 監看模式 |
| `pnpm test:coverage` | V8 覆蓋率報告 |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm test:e2e:ui` | Playwright UI 模式 |

### Code Quality & Style Rules

#### 命名慣例

| 類型 | 慣例 | 範例 |
|------|------|------|
| Vue 元件檔案 | PascalCase | `NotchHud.vue`, `DashboardView.vue` |
| Composable 檔案 | camelCase + use 前綴 | `useTauriEvents.ts`, `useFeedbackMessage.ts` |
| Service/Lib 檔案 | camelCase | `recorder.ts`, `transcriber.ts`, `errorUtils.ts`, `formatUtils.ts` |
| Pinia Store 檔案 | camelCase + use 前綴 | `useSettingsStore.ts`, `useVoiceFlowStore.ts` |
| Rust 模組檔案 | snake_case | `clipboard_paste.rs`, `hotkey_listener.rs`, `keyboard_monitor.rs` |
| 資料夾 | kebab-case | `src-tauri/`, `components/` |
| TS 變數/函式 | camelCase | `startRecording()`, `enhancedText` |
| TS 型別/介面 | PascalCase + 後綴 | `TranscriptionRecord`, `HotkeyConfig`, `AudioAnalyserHandle` |
| TS 布林變數 | is/has/can/should 前綴 | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS 常數 | UPPER_SNAKE_CASE | `DEFAULT_SYSTEM_PROMPT`, `ENHANCEMENT_TIMEOUT_MS` |
| Rust 函式/變數 | snake_case | `paste_text()`, `listen_hotkey()` |
| Rust 型別/Struct | PascalCase | `ClipboardError`, `HotkeyConfig` |
| SQLite table | 複數 snake_case | `transcriptions`, `vocabulary` |
| SQLite column | snake_case | `raw_text`, `was_enhanced` |
| Tauri Events | {domain}:{action} kebab-case | `voice-flow:state-changed` |
| Pinia Store ID | kebab-case | `defineStore('settings', ...)` |

#### 檔案組織規則

```
src/
├── components/           # 共用 UI 元件
│   ├── NotchHud.vue     # HUD 狀態顯示
│   ├── DashboardUsageChart.vue # API 用量趨勢圖表（unovis）
│   └── ui/              # shadcn-vue CLI 生成元件（不手動修改）
├── composables/          # Vue composables（跨元件邏輯）
│   ├── useTauriEvents.ts    # Tauri Event 常量 + 封裝
│   ├── useFeedbackMessage.ts # 臨時回饋訊息模式
│   └── useAudioWaveform.ts  # 音訊視覺化
├── lib/                  # Service 層（純邏輯，無 Vue 依賴）
│   ├── recorder.ts          # MediaRecorder 麥克風錄音
│   ├── transcriber.ts       # Groq Whisper API
│   ├── enhancer.ts          # Groq LLM AI 整理
│   ├── database.ts          # SQLite 初始化 + migration
│   ├── autoUpdater.ts       # tauri-plugin-updater 封裝
│   ├── errorUtils.ts        # 錯誤訊息本地化（繁體中文）
│   ├── formatUtils.ts       # 時間/文字格式化工具
│   ├── apiPricing.ts        # API 費用上限計算（Whisper + LLM）
│   └── utils.ts             # cn() shadcn-vue 工具函式
├── stores/               # Pinia stores
│   ├── useSettingsStore.ts      # 快捷鍵 / API Key / AI Prompt / 開機啟動
│   ├── useHistoryStore.ts       # 歷史記錄 CRUD + Dashboard 統計 + 分頁
│   ├── useVocabularyStore.ts    # 詞彙字典 CRUD
│   └── useVoiceFlowStore.ts     # 錄音/轉錄/AI 整理/貼上完整流程
├── views/                # Main Window 頁面
│   ├── DashboardView.vue    # 統計卡片 + 最近轉錄列表
│   ├── HistoryView.vue      # 歷史記錄搜尋與管理
│   ├── DictionaryView.vue   # 詞彙字典 CRUD
│   └── SettingsView.vue     # 快捷鍵 / API Key / AI Prompt 設定
├── types/                # TypeScript 型別定義
│   ├── index.ts             # HudStatus, TriggerMode, HudTargetPosition 等共用型別
│   ├── transcription.ts     # TranscriptionRecord, DashboardStats, ApiUsageRecord, DailyUsageTrend
│   ├── vocabulary.ts        # VocabularyEntry
│   ├── settings.ts          # TriggerKey (含右側修飾鍵: rightOption, rightControl), HotkeyConfig, SettingsDto
│   ├── events.ts            # 所有 Tauri Event payload 型別
│   └── audio.ts             # AudioAnalyserHandle, AudioAnalyserConfig
├── App.vue              # HUD Window 入口
├── MainApp.vue          # Main Window 入口
├── router.ts            # Vue Router hash mode 設定
├── main.ts              # HUD Window 啟動
├── main-window.ts       # Main Window 啟動（DB 初始化、設定載入、自動更新）
└── style.css            # Tailwind 全域樣式 + oklch 變數
```

- **依賴方向單向** — `views → components + stores + composables`，`stores → lib`，`lib → 外部 API`
- **禁止** `views/` 直接呼叫 `lib/`，必須透過 store

#### 日誌格式

- **TypeScript** — `console.log("[ModuleName] message")`
- **Rust** — `println!("[module-name] message")` / `eprintln!("[module-name] ERROR: message")`
- **Store 日誌** — `[useXxxStore]` 前綴（如 `[useSettingsStore]`）
- **Rust invoke 日誌** — 使用 `invoke("debug_log", { level, message })` Tauri Command
- **所有日誌必須帶模組名前綴**

#### Linter/Formatter

- 目前無 ESLint / Prettier — 依賴 TypeScript strict mode + 手動一致性
- AI agents 應遵循現有程式碼風格，不主動新增 linting 工具

### Development Workflow Rules

#### 開發指令

| 指令 | 用途 |
|------|------|
| `pnpm tauri dev` | 開發模式（Vite dev server + Rust 編譯） |
| `pnpm build` | 型別檢查（vue-tsc）+ Vite 打包 + Cargo 編譯 + Tauri bundler |
| `pnpm preview` | 預覽編譯結果 |

#### 開發伺服器

- **前端** — `localhost:1420`（port strict mode）
- **HMR** — port 1421，當 `TAURI_DEV_HOST` 設定時使用 `ws://host:1421`
- **Vite watch 排除** — `**/src-tauri/**`，Rust 變更不觸發 HMR

#### 多入口架構

| 入口 | HTML | TS 入口 | Vue App | 用途 |
|------|------|--------|---------|------|
| HUD | `index.html` | `main.ts` | `App.vue` | Notch 浮動通知視窗 |
| Dashboard | `main-window.html` | `main-window.ts` | `MainApp.vue` | 主儀表板（含路由、DB 初始化、自動更新） |

- **Dashboard 啟動順序** — `main-window.ts` 中必須依序：`createApp().use(pinia).use(router)` → `await initializeDatabase()` → `app.mount("#app")`。DB init 必須在 mount 之前，否則所有 View 的 `onMounted` 會因 `getDatabase()` 拋錯而失敗
- **HUD 啟動順序** — `App.vue` 的 `onMounted` 中 `await initializeDatabase()` → `voiceFlowStore.initialize()`，因為 HUD 入口 `main.ts` 是同步 mount

#### Git 慣例

- **Commit message** — Conventional Commits 格式（`feat:`, `fix:`, `refactor:` 等）
- **不主動 commit** — AI agents 完成修改後報告 git 狀態，等使用者指示
- **單一主題** — 每個 commit 聚焦一個主題，大量變更（20+ 檔案）分批 commit

#### 產出格式

- **macOS** — `.dmg`（含 `.app`），Apple Developer ID 簽名 + Notarization
- **Windows** — NSIS `.exe` + `.msi`
- **自動更新** — `tauri-plugin-updater` + GitHub Releases endpoint（啟動 5 秒後首次檢查，每 4 小時定時檢查 + Sidebar 手動檢查按鈕）

#### CI/CD

- **CI** — `.github/workflows/ci.yml`（push/PR to main → vue-tsc + Vitest）
- **Release** — `.github/workflows/release.yml`（tag `v*` → 3 平台建構 + Apple 簽名）
- **發版腳本** — `./scripts/release.sh X.Y.Z`
- **GitHub Secrets** — 8 個（Tauri signing key + Apple 簽名 6 個）

#### 環境變數

- **`TAURI_SIGNING_PRIVATE_KEY`** — Updater 簽署金鑰（CI/CD）
- **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** — 私鑰密碼（CI/CD）
- **`APPLE_CERTIFICATE` 等 6 個** — Apple Code Signing（CI/CD，見 CLAUDE.md）
- **`.env` 不進 git** — `.gitignore` 排除

### Critical Don't-Miss Rules

#### Anti-Patterns（絕對禁止）

- **❌ 瀏覽器原生 `fetch`** — 必須用 `@tauri-apps/plugin-http` 的 `fetch`，否則被 CSP 擋住或遇 CORS
- **❌ Options API** — 禁止 `data()`, `methods:`, `computed:` 物件語法
- **❌ views 直接呼叫 lib** — 頁面元件不可直接 import `lib/` 下的模組，必須透過 Pinia store
- **❌ SQLite 存 API Key** — API Key 只存在 `tauri-plugin-store`（`$APP_DATA/settings.json`），絕不進 SQLite
- **❌ 跨平台程式碼混合** — macOS 和 Windows 邏輯不可在同一函式中，必須用 `#[cfg]` 隔離
- **❌ 元件中直接執行 SQL** — SQLite 操作只從 Pinia store actions 發起
- **❌ 使用 `@tabler/icons-vue`** — 雖已安裝（dashboard-01 block 附帶），但 UI 規範強制只用 `lucide-vue-next`
- **❌ 手寫 Button/Input/Card/Dialog** — 必須安裝並使用 shadcn-vue 元件
- **❌ 使用 Tailwind 原生色彩** — `zinc-*`, `teal-*`, `red-*` 等全部禁止，用 `bg-primary`, `text-foreground` 等語意變數
- **❌ 未經設計稿確認就寫 UI** — 所有 UI 實作前必須先在 `design.pen` 完成設計稿並取得使用者確認
- **❌ 手動修改 `src/components/ui/`** — shadcn CLI 生成的元件不手動修改，透過 `cn()` 在使用端覆蓋
- **❌ 直接 import Tauri event API** — 使用 `useTauriEvents.ts` 匯出的封裝函式和常量，不直接從 `@tauri-apps/api/event` import
- **❌ Singleton 提前賦值** — `database.ts` 的 `db` 變數絕不在 `Database.load()` 後立即賦值，必須等所有 `CREATE TABLE` 成功後才設定。否則 `getDatabase()` 返回無表空連線，所有 query 靜默失敗
- **❌ 假設 `sql:default` 包含寫入權限** — Tauri v2 的 `sql:default` 只有 `load/select/close`，任何 DDL/DML 操作需要額外的 `sql:allow-execute`。新增 Tauri plugin 時務必用 `acl-manifests.json` 確認 default 權限組的實際內容
- **❌ mount 前未初始化 DB** — `main-window.ts` 中 `app.mount()` 會觸發所有元件的 `onMounted`，若 DB 尚未初始化，Store 的 `getDatabase()` 會拋錯且被 try-catch 靜默吞掉

#### 資料映射陷阱

- **SQLite → TypeScript 欄位映射** — SQLite `snake_case` → TS `camelCase`，在 store action 中手動轉換（透過 `mapRowToRecord()` / `mapRowToEntry()` 函式）
- **SQLite 布林值** — SQLite 無布林型別，`was_enhanced INTEGER` → TS `wasEnhanced: row.was_enhanced === 1`
- **SQLite null 布林** — `was_modified INTEGER | null` → TS `wasModified: row.was_modified === null ? null : row.was_modified === 1`
- **Tauri Event payload** — 一律 camelCase JSON，不是 Rust 的 snake_case
- **Rust Command 回傳** — `serde` 預設序列化為 snake_case JSON，前端需對應處理（建議 payload struct 加 `#[serde(rename_all = "camelCase")]`）

#### 錯誤處理鏈路

- **Service 層（lib/）** — 拋出有意義的 `Error`，帶上下文訊息
- **Store 層** — `try/catch` 攔截 → 狀態更新 → 降級策略
- **Whisper API 失敗** → HUD 顯示錯誤，使用者可重試
- **LLM API 超時（5 秒）** → 跳過 AI 整理，直接貼上原始文字（`PASTE_SUCCESS_UNENHANCED_MESSAGE`）
- **Enhancement 字元門檻** — 轉錄文字 < 10 字元跳過 AI 整理，直接貼上
- **Rust Command 失敗** → `Result<T, E>` 自動轉前端 Promise rejection
- **錯誤訊息本地化** — `src/lib/errorUtils.ts` 集中管理繁體中文錯誤訊息
- **自動更新失敗** — 靜默處理，不影響 App 正常使用

#### 安全規則

- **CSP 硬限制** — `default-src 'self'; connect-src 'self' https://api.groq.com; style-src 'self' 'unsafe-inline'; script-src 'self'`
- **API Key 不出本地** — 只在 tauri-plugin-store 中，不上傳、不寫入日誌、不透過 Events 傳播
- **macOS 權限** — Accessibility 權限是全域熱鍵監聽的前提（CGEventTap）
- **macOS Entitlements** — 需 `Entitlements.plist`，`macOSPrivateApi: true`

#### 效能注意事項

- **HUD 動畫不阻塞主流程** — 狀態轉換透過 Tauri Events 驅動，非輪詢
- **E2E 延遲目標** — 含 AI < 3 秒、不含 AI < 1.5 秒
- **字數門檻** — 轉錄文字 < 10 字元跳過 AI 整理，直接貼上
- **idle 記憶體** — 目標 < 100MB
- **Release binary** — `lto = true`, `opt-level = "s"`, `strip = true`（最小化檔案大小）
- **History 分頁** — `PAGE_SIZE = 20`，避免一次載入全部記錄

#### Tauri 視窗配置

| 視窗 | 標籤 | 尺寸 | 特性 |
|------|------|------|------|
| HUD | `main` | 400×100 | transparent, alwaysOnTop, no decorations, skipTaskbar |
| Dashboard | `main-window` | 960×680（min 720×480） | decorations, resizable, 預設隱藏 |

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Reference `_bmad-output/planning-artifacts/architecture.md` for detailed architectural decisions
- Reference `_bmad-output/planning-artifacts/ux-ui-design-spec.md` for UI design rules, color system, component patterns, and page layouts

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-04
