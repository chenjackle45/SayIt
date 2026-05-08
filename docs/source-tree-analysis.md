# Source Tree Analysis

> 由 BMad Document Project 工作流自動產生
> 掃描層級：**Exhaustive** · 掃描日期：2026-05-08 · 專案版本：0.9.5

本文件以「兩個 part」為視角註解 SayIt 的原始碼結構：

- **frontend** — `src/`（Vue 3 + Tauri JS API）
- **backend** — `src-tauri/`（Tauri v2 Rust runtime）

---

## 一、頂層結構（Repository Root）

```
say-it/
├── src/                    # Frontend part — Vue 3 + TS（雙視窗）
├── src-tauri/              # Backend part — Tauri v2 Rust runtime
├── tests/                  # 跨端測試（unit / component / e2e）
├── scripts/                # 發版腳本
│   └── release.sh          #   版本同步 + commit + tag + push
├── assets/                 # 共用靜態資源
├── _bmad/                  # BMad framework（不入版本記錄）
├── _bmad-output/           # BMad 規劃 / 實作 / 測試產出物
│   ├── project-context.md  #   AI Agent 必讀規則（323 條）
│   ├── planning-artifacts/ #   PRD / Architecture / UX-UI Spec
│   ├── implementation-artifacts/  # Story / Tech Spec
│   └── test-artifacts/     #   測試框架文件
├── docs/                   # ← 本次掃描產出
├── .github/workflows/      # CI/CD
│   ├── ci.yml              #   PR/push 檢查
│   ├── release.yml         #   tag → 多平台建構 + Apple notarize
│   ├── claude.yml          #   Claude Code GitHub Actions
│   └── claude-code-review.yml
├── .claude/                # Claude Code skills + hooks 設定
├── design.pen              # Pencil MCP 設計稿（UI 實作前必讀）
├── CLAUDE.md               # Claude Code 專案記憶檔
├── CHANGELOG.md
├── README.md
├── package.json            # pnpm@10.28.2 / type=module
├── pnpm-lock.yaml          # 🔴 受 protect-config.sh hook 保護
├── pnpm-workspace.yaml
├── vite.config.ts          # 多入口（HUD + Dashboard）
├── vitest.config.ts        # jsdom 環境
├── playwright.config.ts
├── eslint.config.js
├── tsconfig.json           # strict mode
├── components.json         # shadcn-vue 配置（new-york style）
├── index.html              # HUD 入口
├── main-window.html        # Dashboard 入口
└── .nvmrc                  # 鎖定 Node 24
```

> **入口點關鍵**：HUD 與 Dashboard 是兩個獨立 HTML 入口，各自有獨立 Vite entry，編譯成兩個 bundle 由 Tauri 載入到不同 `WebviewWindow`。

---

## 二、Frontend 結構（`src/`）

### 2.1 雙入口檔案

| 路徑                          | LOC | 職責                                                                                                |
| ----------------------------- | --: | --------------------------------------------------------------------------------------------------- |
| `src/main.ts`                 |  22 | **HUD 入口** — 載入 `App.vue`，初始化 Sentry HUD（無 tracing）、Pinia、i18n                         |
| `src/main-window.ts`          | 103 | **Dashboard 入口** — 載入 `MainApp.vue`，初始化 DB（migration v1→v8）、Sentry Dashboard、router、autostart、自動清理錄音檔 |
| `src/App.vue`                 |   – | HUD root component（瀏海狀態浮窗）                                                                  |
| `src/MainApp.vue`             |   – | Dashboard root component（含 Sidebar、Sidebar Footer 的「檢查更新」按鈕）                           |
| `src/router.ts`               |  20 | 5 routes：`/dashboard` `/history` `/dictionary` `/settings` `/guide`，使用 `createWebHashHistory()` |

### 2.2 Stores（Pinia · `src/stores/`）

| 檔案                          | LOC  | 範疇                                                                                                              |
| ----------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------- |
| `useVoiceFlowStore.ts`        | 1871 | **核心狀態機** — 錄音→轉錄→AI 整理→貼上的完整 voice flow，協調所有 Tauri Command + Event |
| `useSettingsStore.ts`         | 1395 | API Key / 熱鍵 / 模型 / 音訊裝置 / 自動更新等所有設定（單一來源），含 `settings:updated` 廣播 |
| `useHistoryStore.ts`          |  580 | 轉錄歷史 CRUD（SQLite `transcriptions` 表）                                                                       |
| `useVocabularyStore.ts`       |  200 | 字典 CRUD + 廣播 `vocabulary:changed` / `vocabulary:learned`                                                      |

### 2.3 Composables（`src/composables/`）

| 檔案                       | LOC | 職責                                                       |
| -------------------------- | --: | ---------------------------------------------------------- |
| `useTauriEvents.ts`        |  27 | **唯一 Event API 入口** — 所有事件常數集中於此（避免散落） |
| `useAudioPreview.ts`       |  82 | 設定頁面音量條（訂閱 `audio:preview-level`）              |
| `useAudioWaveform.ts`      |  84 | HUD 波形動畫（訂閱 `audio:waveform`）                     |
| `useFeedbackMessage.ts`    |  29 | UI 訊息提示                                                |

### 2.4 Lib（無框架邏輯 · `src/lib/`）

| 檔案                          | LOC | 職責                                                                                                |
| ----------------------------- | --: | --------------------------------------------------------------------------------------------------- |
| `database.ts`                 | 492 | SQLite 連線池（HUD 與 Dashboard 共用）+ migration v1→v8                                             |
| `enhancer.ts`                 | 168 | LLM 文字整理（口語→書面語）                                                                         |
| `vocabularyAnalyzer.ts`       | 160 | LLM 智慧字典學習                                                                                    |
| `hallucinationDetector.ts`    | 139 | Whisper 幻覺偵測 v3                                                                                 |
| `errorUtils.ts`               | 139 | 錯誤訊息正規化                                                                                      |
| `keycodeMap.ts`               | 568 | 跨平台鍵碼對應（macOS / Windows）                                                                  |
| `llmProvider.ts`              | 368 | **多 Provider 抽象層** — Groq / Gemini / OpenAI / Anthropic 統一 fetch / parse                     |
| `modelRegistry.ts`            | 254 | LLM + Whisper 模型清單、預設值、下架遷移（`DECOMMISSIONED_MODEL_MAP`）                              |
| `sentry.ts`                   |  83 | 雙視窗各自初始化（`initSentryForHud` / `initSentryForDashboard`）+ `captureError` 統一入口          |
| `autoUpdater.ts`              |  76 | 自動更新檢查（5 秒首次 + 4 小時間隔）                                                               |
| `formatUtils.ts`              |  68 | 時間 / 字數 / 大小格式化                                                                            |
| `apiPricing.ts`               |  39 | API 成本估算                                                                                        |
| `utils.ts`                    |   7 | shadcn-vue `cn()` helper                                                                            |

### 2.5 Views（`src/views/`）

| 檔案                       | LOC  | 路由         | 職責                                                |
| -------------------------- | ---: | ------------ | --------------------------------------------------- |
| `SettingsView.vue`         | 1907 | `/settings`  | API Key / 模型 / 熱鍵 / 音訊裝置 / 進階設定         |
| `HistoryView.vue`          |  379 | `/history`   | 轉錄歷史瀏覽 / 搜尋 / 複製 / 重新轉錄 / 音訊播放    |
| `DashboardView.vue`        |  309 | `/dashboard` | 統計卡片 + 使用量圖表 + 近期轉錄                    |
| `DictionaryView.vue`       |  281 | `/dictionary`| 字典 CRUD（手動 + AI 學習）                         |
| `FeatureGuideView.vue`     |   56 | `/guide`     | 功能導覽                                            |

### 2.6 Components（`src/components/`）

| 檔案                       | LOC | 類別                                              |
| -------------------------- | --: | ------------------------------------------------- |
| `NotchHud.vue`             | 861 | **HUD 主元件** — 狀態切換、波形、字典學到提示 |
| `AccessibilityGuide.vue`   | 191 | macOS 輔助使用權限引導                            |
| `AppSidebar.vue`           | 177 | Dashboard 側邊欄（shadcn-vue Sidebar）            |
| `NavUser.vue`              | 114 | 側邊欄底部使用者區塊                              |
| `SectionCards.vue`         | 106 | Dashboard 統計卡片                                |
| `NavDocuments.vue`         |  91 | 側邊欄文件區                                      |
| `DashboardUsageChart.vue`  |  89 | unovis 統計圖表                                   |
| `NavMain.vue`              |  57 | 側邊欄主導航                                      |
| `NavSecondary.vue`         |  41 | 側邊欄次要導航                                    |
| `SiteHeader.vue`           |  15 | Dashboard 頂部                                    |
| `ui/`                      |   – | shadcn-vue 元件庫（21 種，禁止改動樣式）          |

### 2.7 i18n（`src/i18n/`）

```
src/i18n/
├── index.ts            # i18n 初始化
├── languageConfig.ts   # 語系列表、預設語系
├── prompts.ts          # 各 LLM 提示詞（依語系切換）
└── locales/
    ├── en.json
    ├── zh-TW.json     # 預設
    ├── zh-CN.json
    ├── ja.json
    └── ko.json
```

### 2.8 Types（`src/types/`）

| 檔案                  | 命名後綴               | 範疇                                  |
| --------------------- | ---------------------- | ------------------------------------- |
| `index.ts`            | `*Status`, `*State`    | HUD 狀態列舉                          |
| `events.ts`           | `*Payload`             | Tauri Event payload 介面              |
| `transcription.ts`    | `*Record`              | SQLite `transcriptions` 表型別        |
| `vocabulary.ts`       | `*Record`, `*Entry`    | 字典型別                              |
| `audio.ts`            | `*Handle`, `*Config`   | 音訊處理型別                          |
| `settings.ts`         | `*Config`              | 設定物件型別                          |

---

## 三、Backend 結構（`src-tauri/`）

```
src-tauri/
├── Cargo.toml                    # 🟡 受 protect-config.sh 警告
├── Cargo.lock                    # 🔴 受 protect-config.sh 阻擋
├── tauri.conf.json               # 🟡 視窗設定 / CSP / Bundle / Updater
├── Entitlements.plist            # macOS 權限（accessibility, audio-input）
├── Info.plist                    # macOS Bundle metadata
├── build.rs                      # tauri-build
├── capabilities/
│   └── default.json              # Tauri v2 permission system（HTTP allowlist）
├── icons/                        # 跨平台圖示（macOS .icns / Windows .ico / iOS / Android）
├── resources/sounds/             # start.wav / stop.wav（錄音回饋音）
└── src/
    ├── main.rs                   # 5 行 — 直接呼叫 sayit_lib::run()
    ├── lib.rs                    # 892 行 — 主 entry + invoke handler 註冊 + tray + graceful shutdown
    └── plugins/
        ├── mod.rs                # 8 行 — 模組宣告
        ├── hotkey_listener.rs    # 1571 行 — 全域熱鍵（CGEventTap / Win32 Hook）
        ├── audio_recorder.rs     # 1116 行 — cpal 錄音 + WAV 寫檔 + 波形 FFT
        ├── keyboard_monitor.rs   #  629 行 — 品質監測 + 矯正監測
        ├── clipboard_paste.rs    #  483 行 — Cmd+V / Ctrl+V 模擬貼上
        ├── audio_control.rs      #  447 行 — 系統音量 mute / restore
        ├── transcription.rs      #  324 行 — Groq Whisper API（Rust 直呼）
        ├── text_field_reader.rs  #  325 行 — AX API 讀取游標文字
        └── sound_feedback.rs     #  206 行 — start/stop/error/learned 音效
```

### 3.1 Backend 模組責任分布

| 模組                  | 平台特化                                          | 對外契約                                                      |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `hotkey_listener`     | macOS：CGEventTap；Windows：SetWindowsHookEx      | 8 個 Command + 8 個 Event（pressed/released/toggled/error...） |
| `audio_recorder`      | cpal 跨平台 + macOS Arc cycle workaround          | 11 個 Command + 2 個 Event（waveform / preview-level）        |
| `keyboard_monitor`    | macOS：CGEventTap                                 | 2 個 Command + 2 個 Event（quality / correction）             |
| `clipboard_paste`     | macOS：CGEvent；Windows：SendInput                | 3 個 Command                                                  |
| `audio_control`       | macOS：CoreAudio FFI；Windows：IAudioEndpointVolume | 2 個 Command                                                  |
| `transcription`       | 跨平台 reqwest                                    | 2 個 Command（含 retranscribe_from_file）                     |
| `text_field_reader`   | macOS：AX API                                     | 2 個 Command                                                  |
| `sound_feedback`      | 跨平台 cpal                                       | 4 個 Command                                                  |

### 3.2 lib.rs 的關鍵函式

| 函式                                | 用途                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `run()`                             | Tauri Builder 主入口（含 plugin 註冊、tray、setup、shutdown）                                  |
| `configure_macos_notch_window()`    | macOS：用 `objc::msg_send` 設定 NSWindow level=27 + collectionBehavior（瀏海覆蓋層）           |
| `configure_windows_topmost_window()`| Windows：HWND_TOPMOST + WS_EX_TOOLWINDOW + WS_EX_NOACTIVATE                                    |
| `find_monitor_for_cursor()`         | 純函式，11 個單元測試（含 Retina + portrait + dual-DPI fallback）                              |
| `calculate_centered_window_x_logical()` | logical 座標置中（繞過 tao cross-DPI bug）                                                  |
| `request_app_restart()` + `RunEvent::Exit` | 用 `_exit(0)` 截殺 Tauri 內建 restart 後自行 spawn — 確保 graceful shutdown 順序          |

---

## 四、Tests 結構（`tests/`）

```
tests/
├── README.md         # 測試總覽
├── unit/             # Vitest unit
├── component/        # @vue/test-utils
├── e2e/              # Playwright
└── support/          # 共用 fixture / helper
```

> Rust 單元測試內嵌於 `src-tauri/src/**/*.rs` 的 `#[cfg(test)] mod tests`，例如 `lib.rs` 末段有 17 個 `find_monitor_for_cursor` / `calculate_centered_window_x*` 測試。

---

## 五、Hooks 與保護檔案

`.claude/settings.json` 設定四個 PostToolUse / PreToolUse hooks：

| Hook                  | 觸發             | 行為                                                          |
| --------------------- | ---------------- | ------------------------------------------------------------- |
| `protect-config.sh`   | PreToolUse Edit  | 🔴 `Cargo.lock` / `pnpm-lock.yaml` 禁改；🟡 `tauri.conf.json` / `Cargo.toml` 警告 |
| `typecheck.sh`        | PostToolUse Edit | `.ts/.vue` 改動後跑 `vue-tsc --noEmit`（非阻斷）              |
| `rustfmt.sh`          | PostToolUse Edit | `.rs` 改動後跑 `rustfmt`                                      |
| `eslint.sh`           | PostToolUse Edit | `.ts/.vue` 改動後 `eslint --fix`（跳過 `components/ui/`）     |

---

## 六、關鍵交互點（為 PRD 提供導引）

1. **「錄音 → 轉錄 → 整理 → 貼上」流程的中樞** = `useVoiceFlowStore.ts`（1871 行）— 修改錄音流程必先讀此檔。
2. **「設定」全部入口** = `useSettingsStore.ts`（1395 行）+ `SettingsView.vue`（1907 行）— 新增任何設定欄位需同步兩處。
3. **「IPC 契約」唯一定義處** = `lib.rs` 的 `invoke_handler!` macro + `useTauriEvents.ts` 常數 — 新增 Command / Event 必須兩端對齊（用 `tauri-reviewer` subagent 審查）。
4. **「DB Schema」單一來源** = `src/lib/database.ts` 的 migration 鏈（v1→v8）— 加欄位請追加 v9，不要直接改舊 migration。
5. **「LLM Provider」抽象邊界** = `src/lib/llmProvider.ts` — 新增 provider 在此擴展即可，業務層（`enhancer.ts` / `vocabularyAnalyzer.ts`）不需改。
