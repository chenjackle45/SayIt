---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - prd.md
  - product-brief-sayit-2026-02-28.md
  - voice-transcription-poc-spec.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-03-01'
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-02-28'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements：**

36 條 FR 涵蓋 8 個能力領域。架構面最關鍵的需求群組：

| 能力領域 | FR 數量 | 架構意涵 |
|----------|---------|---------|
| 語音觸發與錄音 | 5 | 需跨平台全域熱鍵（OS-native API），Hold/Toggle 雙模式狀態機 |
| AI 文字整理 | 5 | Groq LLM 整合層，prompt 管理，上下文注入（剪貼簿+詞彙），字數門檻分支邏輯 |
| 文字輸出 | 3 | 剪貼簿操作 + 鍵盤模擬跨平台封裝，貼上後鍵盤監控（品質衡量） |
| 歷史記錄與統計 | 6 | SQLite 資料層，聚合查詢（Dashboard 統計），全文搜尋 |
| 狀態回饋 HUD | 4 | 6 態狀態機（idle → recording → transcribing → enhancing → success/error → idle） |
| 應用程式管理 | 7 | System Tray、自動更新、開機自啟動、權限引導 |

**Non-Functional Requirements：**

| 類別 | 關鍵指標 | 架構影響 |
|------|---------|---------|
| 效能 | E2E < 3s（含 AI）、< 1.5s（跳過 AI）、idle < 100MB | API 呼叫需非同步、HUD 動畫不能阻塞主流程 |
| 效能 | HUD 狀態轉換 < 100ms、SQLite 查詢 < 200ms | 前端狀態管理需高效、SQLite 需適當索引 |
| 安全 | API Key 本地儲存，不外洩 | tauri-plugin-store 明文 JSON，安全依賴 OS 檔案系統權限 |
| 整合 | Groq API timeout 5 秒，超時 fallback 原始文字 | 需 timeout + 降級策略的服務層 |
| 可靠 | 系統可用率 > 99%、SQLite WAL 模式 | 錯誤隔離，API 失敗不影響 App 穩定性 |

**Scale & Complexity：**

- Primary domain：Desktop Full-Stack（Rust + Vue + SQLite）
- Complexity level：Low-Medium
- 估計架構元件數：~12（Rust plugins × 4 + Frontend services × 5 + Stores × 3）

### Technical Constraints & Dependencies

**Brownfield 約束（現有 POC 程式碼）：**

| 元件 | 現狀 | V2 動作 |
|------|------|---------|
| `fn_key_listener.rs` | CGEventTap（僅 macOS） | 擴展重寫 → OS-native 雙平台（macOS CGEventTap + Windows SetWindowsHookExW） |
| `clipboard_paste.rs` | arboard + AX API menu press（macOS）+ SendInput（Windows） | 保留，擴展貼上後監控 |
| `lib.rs` | 單視窗設定 + System Tray | 擴展支援雙視窗 |
| `recorder.ts` | MediaRecorder 錄音 | **DELETED** — 遷移至 `audio_recorder.rs`（Rust cpal） |
| `transcriber.ts` | Groq Whisper API | **DELETED** — 遷移至 `transcription.rs`（Rust reqwest） |
| `useVoiceFlow.ts` | 錄音→轉錄流程 | 擴展 AI 整理步驟 |
| `NotchHud.vue` | 3 態 HUD | 擴展為 6 態 |
| `App.vue` | 單視窗（HUD only） | HUD 視窗保留，Main Window 新增 |

**框架約束：**
- Tauri v2：雙視窗需在 tauri.conf.json 定義，前後端通訊走 Tauri Commands + Events
- Vue 3 Composition API：現有模式已採用，V2 延續
- pnpm：套件管理已確立

**外部依賴：**
- Groq Whisper API（語音轉文字，無替代方案）
- Groq LLM API（AI 文字整理，5 秒 timeout 降級為原始文字）
- 無其他雲端服務依賴

### Cross-Cutting Concerns Identified

1. **跨平台行為抽象** — OS 原生鍵盤 API（macOS CGEventTap / Windows SetWindowsHookExW）的事件模型差異（鍵碼對應、權限需求、事件觸發頻率）需要統一的抽象層
2. **雙視窗狀態同步** — HUD Window 和 Main Window 需共享應用程式狀態（錄音狀態、設定變更、歷史更新），Tauri Events 或 Pinia 跨視窗同步是關鍵決策點
3. **API 錯誤降級** — Groq API 的 timeout/失敗需要一致的降級策略：Whisper 失敗 → 顯示錯誤；LLM 超時 → 跳過 AI 直接貼上原始文字
4. **安全金鑰儲存** — API Key 使用 tauri-plugin-store 儲存於 App Data 目錄（明文 JSON），安全依賴 OS 檔案系統權限，不暴露於日誌或網路
5. **資料持久化層** — SQLite 需統一的存取模式（Tauri Commands 封裝），歷史記錄和詞彙字典共用同一資料庫但各自的 table

## Starter Template Evaluation

### Primary Technology Domain

**Desktop Full-Stack（Brownfield）** — 現有 Tauri v2 + Vue 3 專案，技術棧已確立。本節記錄現有基礎並規劃 V2 所需的新依賴。

### Existing Stack Confirmation

**現有技術棧（POC 已驗證）：**

| 層級 | 技術 | 版本 | 狀態 |
|------|------|------|------|
| 桌面框架 | Tauri | v2.10.x | ✅ 已採用 |
| 前端框架 | Vue 3 | 3.5.29 | ✅ 已採用 |
| 語言（前端） | TypeScript | 5.9.3 | ✅ 已採用 |
| 語言（後端） | Rust | 2021 edition | ✅ 已採用 |
| CSS 框架 | Tailwind CSS | 4.2.1 | ✅ 已採用 |
| 建構工具 | Vite | 6.4.1 | ✅ 已採用 |
| 套件管理 | pnpm | — | ✅ 已採用 |
| 剪貼簿 | arboard | 3.6.1 | ✅ 已採用 |
| ~~鍵盤模擬~~ | ~~enigo~~ | ~~0.2~~ | ❌ 已移除（零使用死依賴） |
| HTTP 請求 | tauri-plugin-http | 2.x | ✅ 已採用 |
| macOS 視窗 | objc + core-graphics | 0.2 / 0.24 | ✅ 已採用 |
| Windows 視窗 | windows crate | 0.61 | ✅ 已採用 |

### V2 New Dependencies Required

**Rust (Cargo) — 新增：**

| 依賴 | 版本 | 用途 | Cargo feature |
|------|------|------|-------------|
| `tauri-plugin-sql` | 2.3.1 | SQLite 資料庫（歷史記錄 + 詞彙字典） | `sqlite` |
| `tauri-plugin-autostart` | 2.5.1 | 開機自啟動 | — |
| `tauri-plugin-updater` | ~2.2.0 | 自動更新 | — |
| `tauri-plugin-store` | ~2.x | API Key 本地儲存（明文 JSON） | — |
| `cpal` | 0.15 | 跨平台音訊錄製 | — |
| `hound` | 3.5 | WAV 編碼 | — |
| `rustfft` | 6 | FFT 波形分析 | — |
| `reqwest` | 0.12 | Groq Whisper API | `multipart`, `json` |

**JavaScript (pnpm) — 新增：**

| 依賴 | 版本 | 用途 |
|------|------|------|
| `vue-router` | 5.0.3 | Main Window 頁面路由 |
| `pinia` | 3.x | 跨視窗狀態管理 |
| `@tauri-apps/plugin-sql` | ~2.3.1 | SQLite 前端 bindings |
| `@tauri-apps/plugin-autostart` | ~2.5.1 | 開機自啟動前端 bindings |
| `@tauri-apps/plugin-updater` | ~2.2.0 | 自動更新前端 bindings |
| `@tauri-apps/plugin-store` | ~2.x | 本地儲存前端 bindings |

### Architectural Decisions Provided by Existing Stack

**Language & Runtime：**
- Rust 2021 edition（後端系統操作）
- TypeScript strict mode（前端邏輯）
- 雙語言架構透過 Tauri Commands + Events 橋接

**Styling Solution：**
- Tailwind CSS 4.x（utility-first，已在 HUD 使用）

**Build Tooling：**
- Vite 6.x（前端 dev server + 打包）
- `cargo tauri dev/build`（整合建構）
- `vue-tsc --noEmit`（型別檢查）

**Code Organization（現有模式，V2 延續）：**
- Rust plugins 在 `src-tauri/src/plugins/`
- Vue composables 在 `src/composables/`
- Service 層在 `src/lib/`
- 元件在 `src/components/`
- 型別定義在 `src/types/`

**Note：** V2 不需要專案初始化 — 基於現有 POC 結構擴展。第一個實作 Story 應是新增 SQLite 基礎架構 + 擴展 OS-native 熱鍵監聽。

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions（阻塞實作）：**
- API Key 儲存方式
- Groq API 呼叫位置
- 雙視窗狀態同步機制
- SQLite Schema 設計策略

**Important Decisions（影響架構品質）：**
- 錯誤處理模式
- 自動更新機制

**Deferred Decisions（Phase 2+）：**
- 無 — 所有架構決策已在本輪完成

### Data Architecture

**決策：前端直接 SQL（tauri-plugin-sql）**

- tauri-plugin-sql 前端直接執行 SQL，資料存取邏輯集中在 Pinia stores 的 actions 中
- 不建立額外的 Rust Command 資料存取層，避免過度抽象
- SQLite WAL 模式確保寫入安全
- Schema migration：App 啟動時版本檢查 + `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`

**Schema 設計：**

```sql
-- 歷史記錄
CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  processed_text TEXT,
  recording_duration_ms INTEGER NOT NULL,
  transcription_duration_ms INTEGER NOT NULL,
  enhancement_duration_ms INTEGER,
  char_count INTEGER NOT NULL,
  trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
  was_enhanced INTEGER NOT NULL DEFAULT 0,
  was_modified INTEGER,          -- 貼上後是否被使用者修改
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transcriptions_timestamp ON transcriptions(timestamp DESC);
CREATE INDEX idx_transcriptions_created_at ON transcriptions(created_at);

-- 自訂詞彙
CREATE TABLE IF NOT EXISTS vocabulary (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema 版本追蹤
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
```

### Security

**決策：tauri-plugin-store 本地儲存 API Key**

- 使用 tauri-plugin-store 將 API Key 儲存於本地 App Data 目錄（明文 JSON）
- 不整合 OS 原生 Keychain/Credential Manager — 內部效率工具，安全依賴 OS 檔案系統權限已足夠
- API Key 不進入 SQLite，獨立於 store 檔案中
- API Key 不暴露於日誌、網路傳輸或 Tauri Events

### API & Communication Patterns

**決策：Groq API 呼叫分層 — Whisper 走 Rust、LLM 走前端**

- Groq Whisper API 已遷移至 Rust 側（`transcription.rs` via `reqwest`），音訊錄製到轉錄全程在 Rust 完成，避免跨語言傳遞音訊 blob
- Groq LLM API 維持前端呼叫（`enhancer.ts` via `@tauri-apps/plugin-http`），因文字處理邏輯與前端狀態緊耦合
- CSP 仍限制 `connect-src` 至 `self` + `https://api.groq.com`（LLM 呼叫仍從前端發出）
- API Key 在本地 App 環境中，不存在瀏覽器公開暴露風險

**錯誤處理模式：**

- Rust → TypeScript：Tauri Command 的 `Result<T, E>` 自動轉為前端 Promise rejection，前端 `try/catch` 處理
- Groq API 錯誤：人類可讀訊息傳給 HUD 顯示
- Whisper API 失敗 → HUD 顯示錯誤訊息，使用者可重試
- LLM API 超時（5 秒）→ 跳過 AI 整理，直接貼上原始轉錄文字
- 不建立統一錯誤碼系統，保持簡單

### Frontend Architecture

**決策：Tauri Events 跨視窗同步 + Pinia 各視窗本地狀態**

- 每個視窗（HUD / Main Window）各自持有 Pinia store instance
- 關鍵狀態變更透過 Tauri v2 `emitTo(windowLabel, event, payload)` 跨視窗廣播
- 需同步的事件：錄音狀態變化、新轉錄記錄產生、設定更新、詞彙變更
- HUD Window 訂閱錄音/轉錄/AI 整理狀態事件
- Main Window 訂閱新記錄事件以更新 Dashboard

**路由：** Vue Router 5.x，hash mode（桌面 App 無需 history mode）

**Pinia Stores 結構：**
- `useSettingsStore` — 快捷鍵、API Key、AI Prompt
- `useHistoryStore` — 歷史記錄 CRUD + Dashboard 統計查詢
- `useVocabularyStore` — 詞彙字典 CRUD
- `useVoiceFlowStore` — 錄音/轉錄/AI 整理流程狀態（擴展現有 useVoiceFlow）

### Infrastructure & Deployment

**決策：GitHub Releases 自動更新**

- 使用 tauri-plugin-updater + GitHub Releases endpoint
- Updater endpoint: `https://github.com/chenjackle45/SayIt/releases/latest/download/latest.json`
- Public repo: `chenjackle45/SayIt`
- 使用者體驗：
  - **定時檢查** — 啟動 5 秒後首次檢查，之後每 4 小時背景檢查
  - **手動檢查** — Sidebar Footer 的「檢查更新」按鈕，結果以 inline feedback 顯示（2.5 秒自動消失）
  - **更新流程** — 自動下載 → 提示重啟 → 一鍵完成
- `checkForAppUpdate()` 回傳 `UpdateCheckResult`（`up-to-date` | `update-available` | `error`），供 UI 顯示結果

**CI/CD Pipeline（已實作）：**
- **CI**（`.github/workflows/ci.yml`）— push/PR to main 觸發 vue-tsc + Vitest
- **Release**（`.github/workflows/release.yml`）— push tag `v*` 觸發 3 平台建構
  - macOS ARM + Intel：Apple Code Signing + Notarization
  - Windows x64：NSIS installer

**發版流程：**
1. `./scripts/release.sh X.Y.Z`（自動更新版本號、commit、tag、push）
2. 等 GitHub Actions 完成（約 10-15 分鐘）
3. 到 GitHub Releases 手動 Publish draft release
4. 使用者的 App 自動偵測並提示更新

**Code Signing（已實作）：**
- macOS：Developer ID Application — `Tai-Cheng Chen (G9J8D2T6DV)`，含 Notarization
- Windows：暫無 EV code signing certificate，初期使用者手動信任

**安裝包格式：**
- macOS：`.dmg`（含 `.app`）+ `.app.tar.gz`（updater 用）
- Windows：NSIS `.exe` + `.msi`

### Decision Impact Analysis

**Implementation Sequence：**

```
1. SQLite 初始化（schema + migration）
2. Pinia stores 建立（settings / history / vocabulary）
3. 雙視窗架構（tauri.conf.json + Vue Router）
4. Tauri Events 跨視窗同步機制
5. API Key 儲存（tauri-plugin-store）
6. Groq LLM 整合（enhancer.ts）
7. 自動更新（tauri-plugin-updater + endpoint）
```

**Cross-Component Dependencies：**

```
SQLite ──→ historyStore / vocabularyStore
     │
tauri-plugin-store ──→ settingsStore（API Key）
     │
Tauri Events ──→ HUD Window ←──→ Main Window
     │
enhancer.ts ──→ useVoiceFlowStore（AI 整理步驟）
     │
tauri-plugin-updater ──→ 獨立模組，App 啟動時初始化
```

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**識別出 5 大衝突領域，18 個潛在衝突點**

### Naming Patterns

**Database Naming（SQLite）：**
- Table：複數 snake_case → `transcriptions`, `vocabulary`, `schema_version`
- Column：snake_case → `raw_text`, `recording_duration_ms`, `was_enhanced`
- Index：`idx_{table}_{column}` → `idx_transcriptions_timestamp`
- Primary Key：`id`（TEXT UUID）

**Rust Naming：**
- Functions/variables：snake_case → `paste_text()`, `listen_hotkey()`
- Types/Structs：PascalCase → `TranscriptionRecord`, `HotkeyConfig`
- Tauri Commands：snake_case → `#[command] fn paste_text()`
- Plugin modules：snake_case → `hotkey_listener.rs`, `clipboard_paste.rs`

**TypeScript Naming：**
- Variables/functions：camelCase → `addTranscription()`, `enhancedText`
- Types/Interfaces：PascalCase + 後綴 → `TranscriptionRecord`, `SettingsDto`, `VoiceFlowState`
- Boolean 變數：`is/has/can/should` 前綴 → `isRecording`, `wasEnhanced`, `hasApiKey`
- Constants：UPPER_SNAKE_CASE → `DEFAULT_PROMPT`, `API_TIMEOUT_MS`

**Vue Components：**
- 檔案名：PascalCase → `NotchHud.vue`, `DashboardStats.vue`, `HistoryList.vue`
- 元件名：PascalCase → `<NotchHud />`, `<DashboardStats />`

**Pinia Stores：**
- 檔案名：camelCase → `useSettingsStore.ts`, `useHistoryStore.ts`
- Store ID：kebab-case → `defineStore('settings', ...)`, `defineStore('history', ...)`

**Tauri Events：**
- 命名空間：`{domain}:{action}` kebab-case → `voice-flow:state-changed`, `transcription:completed`, `settings:updated`, `vocabulary:changed`

**資料夾：**
- 一律 kebab-case → `src/stores/`, `src/views/`, `src/components/`

### Structure Patterns

**V2 完整專案結構：**

```
src/
├── components/           # 共用 UI 元件
│   ├── NotchHud.vue     # HUD 狀態顯示（現有，擴展）
│   └── ui/              # 通用 UI 元件（按鈕、輸入框等）
├── composables/          # Vue composables（跨元件邏輯）
│   ├── useHudState.ts   # HUD 狀態管理（現有）
│   └── useVoiceFlow.ts  # 錄音/轉錄流程（現有，擴展）
├── lib/                  # Service 層（純邏輯，不依賴 Vue）
│   ├── enhancer.ts      # Groq LLM AI 整理（新增）
│   └── database.ts      # SQLite 初始化 + migration（新增）
│   # recorder.ts — DELETED，遷移至 audio_recorder.rs（Rust cpal）
│   # transcriber.ts — DELETED，遷移至 transcription.rs（Rust reqwest）
├── stores/               # Pinia stores（新增目錄）
│   ├── useSettingsStore.ts
│   ├── useHistoryStore.ts
│   ├── useVocabularyStore.ts
│   └── useVoiceFlowStore.ts
├── views/                # Main Window 頁面（新增目錄）
│   ├── DashboardView.vue
│   ├── HistoryView.vue
│   ├── DictionaryView.vue
│   └── SettingsView.vue
├── types/                # TypeScript 型別定義
│   └── index.ts         # 現有，擴展
├── App.vue              # HUD Window 入口（現有）
├── MainApp.vue          # Main Window 入口（新增）
├── router.ts            # Vue Router 設定（新增）
├── main.ts              # HUD Window 啟動（現有）
├── main-window.ts       # Main Window 啟動（新增）
└── style.css

src-tauri/src/
├── plugins/
│   ├── mod.rs
│   ├── hotkey_listener.rs   # OS-native 跨平台熱鍵（擴展重寫）
│   ├── clipboard_paste.rs   # 剪貼簿操作（現有，擴展）
│   ├── keyboard_monitor.rs  # 貼上後鍵盤監控（新增）
│   ├── audio_recorder.rs    # cpal 音訊錄製 + WAV 編碼 + FFT 波形 [新增]
│   └── transcription.rs     # Groq Whisper API via reqwest [新增]
├── lib.rs                   # App 設定（現有，擴展雙視窗）
└── main.rs
```

**規則：**
- 元件放 `components/`，頁面放 `views/`
- 純邏輯（無 Vue 依賴）放 `lib/`，Vue 相關邏輯放 `composables/` 或 `stores/`
- 每個 Pinia store 一個檔案，檔案名 = store composable 名
- Rust plugin 一個檔案一個模組，統一在 `mod.rs` export

### Format Patterns

**SQLite ↔ TypeScript 資料映射：**
- SQLite column snake_case → TypeScript interface camelCase
- 映射在 Pinia store 的 actions 中處理（query 出來做 field mapping）
- 範例：`raw_text` → `rawText`, `was_enhanced` → `wasEnhanced`

**Tauri Event Payload：**
- 一律 camelCase JSON
- 範例：`{ status: 'recording', message: '錄音中...' }`

**日期格式：**
- SQLite：`datetime('now')` 產生的 ISO 字串用於 `created_at`
- 數值時長：`INTEGER` 毫秒 → `recordingDurationMs`
- 前端顯示：`Intl.DateTimeFormat` 格式化

### Communication Patterns

**Tauri Events 完整清單：**

| Event Name | Direction | Payload | 用途 |
|------------|-----------|---------|------|
| `voice-flow:state-changed` | HUD ← VoiceFlow | `{ status, message }` | HUD 狀態更新 |
| `transcription:completed` | → Main Window | `{ id, rawText, processedText, ... }` | 新記錄通知 |
| `settings:updated` | → All Windows | `{ key, value }` | 設定變更同步 |
| `vocabulary:changed` | → All Windows | `{ action, term }` | 詞彙變更同步 |
| `audio:waveform` | Rust → HUD | `{ levels: [f32; 6] }` | 波形頻率資料推送 |

**Pinia Store Action 命名：**
- CRUD：`addXxx()`, `removeXxx()`, `updateXxx()`, `fetchXxxList()`
- 查詢：`getXxxById()`, `searchXxx()`
- 計算：`calculateDashboardStats()`

### Process Patterns

**錯誤處理標準流程：**

```typescript
// Service 層（lib/）— 拋出有意義的錯誤
async function enhanceText(text: string): Promise<string> {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error(`AI 整理失敗：${response.status}`);
  }
  return result;
}

// Store 層 — catch + 狀態更新 + 使用者提示
async function processTranscription() {
  try {
    const enhanced = await enhanceText(rawText);
  } catch (error) {
    // 降級：直接使用原始文字
    emit('voice-flow:state-changed', { status: 'success', message: '已貼上（未整理）' });
  }
}
```

**Loading 狀態：**
- 每個 store 各自管理 `isLoading: boolean`
- 不使用全域 loading 狀態
- HUD 的 loading 由 `voice-flow:state-changed` 事件驅動

### Enforcement Guidelines

**All AI Agents MUST：**

1. 嚴格遵循 CLAUDE.md 的命名規範（camelCase / PascalCase / UPPER_SNAKE_CASE / kebab-case）
2. 新增檔案前確認目錄歸屬（components/ vs views/ vs lib/ vs stores/）
3. SQLite 欄位使用 snake_case，TypeScript 介面使用 camelCase，在 store action 中做映射
4. Tauri Events 使用 `{domain}:{action}` kebab-case 命名
5. 錯誤處理遵循「Service 層拋出 → Store 層 catch + 降級」模式

## Project Structure & Boundaries

### FR Category → Architecture Mapping

| FR Category | FR 範圍 | 架構元件 | 目錄位置 |
|-------------|---------|---------|---------|
| 語音觸發與錄音 | FR1-5 | hotkey_listener.rs, audio_recorder.rs, useVoiceFlow.ts, useVoiceFlowStore.ts | plugins/, composables/, stores/ |
| 語音轉文字 | FR6-7 | transcription.rs, useVoiceFlow.ts | plugins/, composables/ |
| AI 文字整理 | FR8-12 | enhancer.ts, useVoiceFlowStore.ts, useSettingsStore.ts | lib/, stores/ |
| 文字輸出 | FR13-15 | clipboard_paste.rs, keyboard_monitor.rs | plugins/ |
| 自訂詞彙字典 | FR16-19 | useVocabularyStore.ts, DictionaryView.vue | stores/, views/ |
| 歷史記錄與統計 | FR20-25 | database.ts, useHistoryStore.ts, DashboardView.vue, HistoryView.vue | lib/, stores/, views/ |
| 狀態回饋 HUD | FR26-29 | NotchHud.vue, useHudState.ts, App.vue | components/, composables/, src/ |
| 應用程式管理 | FR30-36 | lib.rs, useSettingsStore.ts, SettingsView.vue, updater.ts | src-tauri/src/, stores/, views/, lib/ |

**跨 FR 共用元件：**
- `useSettingsStore.ts` — 被 AI 整理、應用程式管理、詞彙字典共用（API Key + Prompt + 快捷鍵）
- `database.ts` — 被歷史記錄、詞彙字典共用（統一初始化 + migration）
- `useVoiceFlowStore.ts` — 串連語音觸發、轉文字、AI 整理、文字輸出的完整流程
- Tauri Events — 跨 HUD / Main Window 同步所有狀態變更

### Complete Project Directory Structure

```
sayit/
├── .github/
│   └── workflows/
│       └── build.yml                  # CI: 型別檢查 + 建構測試
│
├── src/                                # ── Frontend (Vue 3 + TypeScript) ──
│   ├── components/                     # 共用 UI 元件
│   │   ├── NotchHud.vue               # HUD 6 態狀態顯示 [現有，擴展]
│   │   └── ui/                         # 通用 UI 原子元件
│   │       ├── AppButton.vue
│   │       ├── AppInput.vue
│   │       ├── AppModal.vue
│   │       └── AppToast.vue
│   │
│   ├── composables/                    # Vue composables
│   │   ├── useHudState.ts             # HUD 動畫狀態管理 [現有]
│   │   ├── useVoiceFlow.ts            # 錄音→轉錄→AI整理流程 [現有，擴展]
│   │   └── useTauriEvents.ts          # Tauri Event 訂閱/發送封裝 [新增]
│   │
│   ├── lib/                            # Service 層（純邏輯，無 Vue 依賴）
│   │   ├── enhancer.ts                # Groq LLM AI 文字整理 [新增]
│   │   ├── database.ts                # SQLite 初始化 + schema migration [新增]
│   │   └── updater.ts                 # tauri-plugin-updater 封裝 [新增]
│   │   # recorder.ts — DELETED，遷移至 audio_recorder.rs（Rust cpal）
│   │   # transcriber.ts — DELETED，遷移至 transcription.rs（Rust reqwest）
│   │
│   ├── stores/                         # Pinia stores [新增目錄]
│   │   ├── useSettingsStore.ts        # 快捷鍵 / API Key / AI Prompt
│   │   ├── useHistoryStore.ts         # 歷史記錄 CRUD + Dashboard 統計
│   │   ├── useVocabularyStore.ts      # 詞彙字典 CRUD
│   │   └── useVoiceFlowStore.ts       # 錄音/轉錄/AI 整理流程狀態
│   │
│   ├── views/                          # Main Window 頁面 [新增目錄]
│   │   ├── DashboardView.vue          # 統計卡片 + 最近轉錄列表
│   │   ├── HistoryView.vue            # 歷史記錄搜尋與管理
│   │   ├── DictionaryView.vue         # 詞彙字典 CRUD
│   │   └── SettingsView.vue           # 快捷鍵 / API Key / AI Prompt 設定
│   │
│   ├── types/                          # TypeScript 型別定義
│   │   ├── index.ts                   # 共用型別 [現有，擴展]
│   │   ├── transcription.ts           # TranscriptionRecord, DashboardStats
│   │   ├── vocabulary.ts              # VocabularyEntry
│   │   ├── settings.ts                # SettingsDto, HotkeyConfig
│   │   └── events.ts                  # Tauri Event payload 型別
│   │
│   ├── App.vue                         # HUD Window 入口 [現有]
│   ├── MainApp.vue                     # Main Window 入口 [新增]
│   ├── router.ts                       # Vue Router hash mode 設定 [新增]
│   ├── main.ts                         # HUD Window 啟動腳本 [現有]
│   ├── main-window.ts                  # Main Window 啟動腳本 [新增]
│   └── style.css                       # Tailwind 全域樣式 [現有]
│
├── src-tauri/                          # ── Backend (Rust + Tauri v2) ──
│   ├── src/
│   │   ├── plugins/
│   │   │   ├── mod.rs                 # Plugin 統一匯出 [現有，擴展]
│   │   │   ├── hotkey_listener.rs     # OS-native 跨平台全域熱鍵 [擴展重寫]
│   │   │   ├── clipboard_paste.rs     # arboard + AX API menu press（macOS）+ SendInput（Windows） [現有，擴展]
│   │   │   ├── keyboard_monitor.rs    # 貼上後鍵盤監控 [新增]
│   │   │   ├── audio_recorder.rs      # cpal 音訊錄製 + WAV 編碼 + FFT 波形 [新增]
│   │   │   └── transcription.rs       # Groq Whisper API via reqwest [新增]
│   │   ├── lib.rs                     # App 配置 + 雙視窗 + Tray [現有，擴展]
│   │   └── main.rs                    # Rust 入口 [現有]
│   │
│   ├── Cargo.toml                     # Rust 依賴 [現有，擴展]
│   ├── tauri.conf.json                # Tauri 配置：雙視窗 + CSP + 權限 [現有，擴展]
│   ├── capabilities/
│   │   └── default.json               # Tauri v2 capability 定義 [現有，擴展]
│   ├── icons/                          # App 圖示 [現有]
│   └── build.rs                        # 建構腳本 [現有]
│
├── update-server/                      # ── 自動更新靜態檔案 ──（不進 App 建構）
│   ├── latest.json                    # 更新 endpoint JSON
│   └── README.md                      # 部署說明
│
├── package.json                        # pnpm 依賴 + scripts [現有，擴展]
├── pnpm-lock.yaml                     # 鎖定檔 [現有]
├── tsconfig.json                      # TypeScript 設定 [現有]
├── tsconfig.node.json                 # Node 型別設定 [現有]
├── vite.config.ts                     # Vite 建構設定 [現有]
├── tailwind.config.ts                 # Tailwind CSS 設定 [現有]
├── .gitignore                         # [現有]
├── .env.example                       # 環境變數範例（TAURI_SIGNING_PRIVATE_KEY）[新增]
└── README.md                          # [現有]
```

### Architectural Boundaries

**API Boundaries：**

- 外部 API 邊界：僅 `api.groq.com`，CSP `connect-src 'self' https://api.groq.com` 硬限制
- 無後端 API server — App 是純本地桌面應用
- 自動更新 endpoint：唯讀 GET（latest.json + 安裝包下載 URL）
- API Key 從 tauri-plugin-store 讀取，不離開本地環境
- Timeout：Whisper 無特殊限制 / LLM 5 秒超時降級

**Component Boundaries：**

| 元件 | 職責 | 擁有的 Store | 不可觸碰 |
|------|------|-------------|---------|
| HUD Window (App.vue) | 狀態顯示、錄音觸發 | useVoiceFlowStore, useHudState | database.ts（不直接操作 DB） |
| Main Window (MainApp.vue) | 使用者互動、資料管理 | useHistoryStore, useVocabularyStore, useSettingsStore, useVoiceFlowStore | — |
| lib/ Services | 純邏輯執行（API 呼叫、DB 操作） | 無（被 store 呼叫） | Vue reactive API |
| Rust Plugins | 系統層操作（熱鍵、剪貼簿、鍵盤） | 無 | 前端 UI 邏輯 |

- HUD Window：僅負責狀態顯示與錄音觸發，不做資料管理
- Main Window：負責所有使用者互動（設定、歷史、詞彙）
- lib/ 層：純邏輯，兩個視窗都可呼叫，但 database.ts 主要由 Main Window stores 使用
- composables/：Vue 生命週期相關邏輯，各視窗獨立實例

**Rust ↔ WebView Boundaries：**

| 方向 | 機制 | 範例 |
|------|------|------|
| WebView → Rust | `invoke()` Tauri Command | `invoke('paste_text', { text })` |
| Rust → WebView | `emit()` / `emitTo()` | 熱鍵按下事件、鍵盤監控結果 |
| Rust → Groq | Rust reqwest（Whisper API） | `transcription.rs`（音訊錄製到轉錄全程 Rust） |
| WebView → Groq | 直接 HTTPS（LLM API，不經 Rust） | `enhancer.ts` |

**Data Boundaries：**

| 儲存 | 內容 | 存取方式 | 存取者 |
|------|------|---------|--------|
| SQLite (app.db) | transcriptions, vocabulary, schema_version | tauri-plugin-sql 前端直接 SQL | Pinia store actions only |
| tauri-plugin-store (plaintext JSON) | groqApiKey, hotkeyConfig, aiPrompt, triggerMode | plugin-store API | useSettingsStore only |

- SQLite 與 Store 是獨立的資料邊界 — API Key 不進 SQLite
- SQLite 存取：只從 Pinia store actions 發起，不在 Vue components 直接操作
- Store 存取：只從 `useSettingsStore` 讀寫，其他 store 不直接碰 plugin-store

### Integration Points

**Internal Communication — 核心語音流程：**

```
User presses hotkey (Fn/右Alt)
    │
    ↓ OS-native event (CGEventTap / WH_KEYBOARD_LL)
hotkey_listener.rs ──→ Tauri Event: hotkey:pressed
    │
    ↓
useVoiceFlow.ts ──→ invoke('start_recording') → audio_recorder.rs (cpal)
    │                     │
    │                     ↓ (WAV 保存於 Rust state，不跨語言傳遞)
    │               invoke('transcribe_audio') → transcription.rs (Rust reqwest → Groq Whisper)
    │                     │
    │                     ↓ raw text
    │               enhancer.ts (Groq LLM, skip if < 10 chars)
    │                     │
    │                     ↓ processed text
    │               invoke('paste_text') ──→ clipboard_paste.rs
    │                     │
    │                     ↓
    │               Text appears at cursor position
    │
    ↓ voice-flow:state-changed events (每步)
NotchHud.vue (6-state display: idle→recording→transcribing→enhancing→success/error)
    │
    ↓ transcription:completed event
useHistoryStore (save to SQLite) ──→ Main Window Dashboard refresh
```

**External Integrations：**

| 外部服務 | 整合模組 | 協定 | 失敗策略 |
|----------|----------|------|----------|
| Groq Whisper API | `transcription.rs` | Rust reqwest multipart | HUD 顯示錯誤訊息，使用者可重試 |
| Groq LLM API | `enhancer.ts` | HTTPS POST JSON | 5 秒 timeout → 跳過 AI，貼上原始文字 |
| 自動更新 Endpoint | `updater.ts` | HTTPS GET JSON | 靜默失敗，下次啟動再試 |

### File Organization Patterns

**Configuration Files：**
- 根目錄：前端建構配置（`package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`）
- `src-tauri/`：Rust + Tauri 配置（`Cargo.toml`, `tauri.conf.json`, `capabilities/`）
- `.env.example`：記錄需要的環境變數（`TAURI_SIGNING_PRIVATE_KEY`），不含實際值
- `.gitignore`：排除 `target/`, `dist/`, `node_modules/`, `.env`

**Source Organization：**
- 嚴格按「職責」分資料夾：`lib/`（純邏輯）→ `stores/`（狀態管理）→ `composables/`（Vue 邏輯）→ `views/`（頁面）→ `components/`（元件）
- 依賴方向單向：`views → components + stores + composables`，`stores → lib`，`lib → 外部 API`
- 禁止 `views/` 直接呼叫 `lib/`，必須透過 store

**Test Organization：**
- MVP 階段以手動測試為主，不在 Phase 1 建立測試框架
- 目錄結構預留供 Phase 2 加入

**Asset Organization：**
- App 圖示 + Tray 圖示：`src-tauri/icons/`
- 前端靜態資源（如有）：`public/`

### Development Workflow Integration

**Development Server：**
```bash
pnpm tauri dev    # 同時啟動 Vite dev server + Rust 編譯
                   # HUD Window: localhost:1420
                   # Main Window: localhost:1420/main.html
```

**Build Process：**
```bash
pnpm tauri build  # 1. Vite 打包前端 → dist/
                   # 2. Cargo 編譯 Rust → target/release/
                   # 3. Tauri bundler 產出安裝包
                   # 環境變數: TAURI_SIGNING_PRIVATE_KEY（自動更新簽署）
```

**Deployment：**
- macOS 產出：`target/release/bundle/dmg/*.dmg`
- Windows 產出：`target/release/bundle/msi/*.msi`
- Signatures：`*.sig`（配對簽署檔）
- 部署步驟：`cargo tauri build` → 上傳安裝包 + .sig → 更新 `update-server/latest.json`

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility：**
- Tauri v2.10.x 與所有 Tauri plugins（sql 2.3.1, autostart 2.5.1, updater ~2.2.0, store ~2.x）版本相容
- Vue 3.5.29 + Pinia 3.x + Vue Router 5.0.3 生態相容
- arboard 3.6.1 為獨立 Rust crate，無衝突（enigo 已移除，rdev 改用 OS-native API 取代）
- Groq API 分層呼叫：Whisper 走 Rust（reqwest）、LLM 走前端（plugin-http），CSP 白名單仍需保留 `https://api.groq.com`
- cpal 0.15 + hound 3.5 + rustfft 6 + reqwest 0.12 為獨立 Rust crate，與現有依賴無衝突
- tauri-plugin-store 本地儲存與 SQLite 資料層分離，職責清晰

**Pattern Consistency：**
- 命名慣例在所有層級一致：Rust snake_case → TS camelCase → Vue PascalCase
- SQLite snake_case → TS camelCase 映射規則統一在 store actions 處理
- Tauri Events `{domain}:{action}` kebab-case 命名一致
- 錯誤處理模式「Service 拋出 → Store catch + 降級」全架構統一

**Structure Alignment：**
- 專案目錄結構完整支援所有架構決策
- 雙視窗架構有清楚的 boundary 定義
- 依賴方向單向：views → stores → lib → 外部 API

### Requirements Coverage Validation ✅

**Functional Requirements（36/36 covered）：**

| FR | 需求 | 架構支援 |
|----|------|---------|
| FR1-5 | 語音觸發與錄音 | hotkey_listener.rs (OS-native) + audio_recorder.rs (cpal) + useVoiceFlow.ts |
| FR6-7 | 語音轉文字 | transcription.rs (Rust reqwest → Groq Whisper API + 詞彙 prompt 注入) |
| FR8-12 | AI 文字整理 | enhancer.ts (Groq LLM) + useSettingsStore (prompt) + 詞彙/剪貼簿上下文注入 |
| FR13-15 | 文字輸出 | clipboard_paste.rs (arboard + AX API menu press / SendInput) + keyboard_monitor.rs |
| FR16-19 | 自訂詞彙字典 | useVocabularyStore + DictionaryView.vue + SQLite vocabulary table |
| FR20-25 | 歷史記錄與統計 | useHistoryStore + DashboardView.vue + HistoryView.vue + SQLite transcriptions table |
| FR26-29 | 狀態回饋 HUD | NotchHud.vue (6-state) + useHudState.ts + voice-flow:state-changed events |
| FR30-36 | 應用程式管理 | SettingsView.vue + useSettingsStore + lib.rs + updater.ts + tauri-plugin-autostart |

**Non-Functional Requirements（全部 covered）：**

| NFR | 目標 | 架構支援 |
|-----|------|---------|
| E2E < 3s | 含 AI 整理 | 非同步 API 呼叫，HUD 動畫不阻塞 |
| E2E < 1.5s | 跳過 AI | 字數 < 10 門檻分支 |
| LLM timeout 5s | fallback 原始文字 | enhancer.ts timeout + 降級策略 |
| Memory < 100MB | idle 狀態 | 輕量 Tauri + WebView 架構 |
| HUD < 100ms | 狀態轉換 | Tauri Events 驅動，非輪詢 |
| SQLite < 200ms | 查詢回應 | 索引 idx_transcriptions_timestamp, idx_transcriptions_created_at |
| API Key 安全 | 不外洩至日誌或網路 | tauri-plugin-store 本地儲存（明文 JSON，OS 檔案權限保護） |
| 資料本地 | 不上傳第三方 | SQLite 本地 + HTTPS 僅至 Groq |
| 可用率 > 99% | 排除網路問題 | 錯誤隔離，API 失敗不影響 App |
| WAL 模式 | 寫入安全 | SQLite WAL mode |

### Implementation Readiness Validation ✅

**Decision Completeness：** 6 個架構決策全部附帶版本號、理由、具體實作方式
**Structure Completeness：** 完整檔案樹，每個檔案標注 [現有] / [新增] / [重寫]
**Pattern Completeness：** 5 大 pattern 類別、18 個衝突點全部定義

### Gap Analysis Results

| 優先級 | Gap | 狀態 |
|--------|-----|------|
| Critical | tauri-plugin-store 漏列 V2 新依賴 | ✅ 已修正 — 新增至 Rust + JS 依賴列表 |
| Important | Step 6 FR 編號範圍與 PRD 不符 | ✅ 已修正 — 對齊 PRD FR1-36 編號 |
| Nice-to-have | FR12 剪貼簿上下文注入的具體流程 | 延至實作階段 Story 中處理 |

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] 專案上下文徹底分析
- [x] 規模與複雜度評估
- [x] 技術約束識別
- [x] 跨切面關注點映射

**✅ Architectural Decisions**
- [x] 6 個關鍵決策附版本號
- [x] 技術棧完整指定
- [x] 整合模式定義
- [x] 效能考量處理

**✅ Implementation Patterns**
- [x] 命名慣例建立
- [x] 結構模式定義
- [x] 通訊模式指定
- [x] 流程模式文件化

**✅ Project Structure**
- [x] 完整目錄結構定義
- [x] 元件邊界建立
- [x] 整合點映射
- [x] 需求到結構映射完成

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths：**
1. Brownfield 優勢 — POC 已驗證核心技術可行性，V2 是擴展而非推翻
2. 極簡架構 — 單一外部 API 提供商（Groq），無微服務，無後端 server
3. 清晰的邊界定義 — 雙視窗職責分明，依賴方向單向
4. 完整的降級策略 — LLM 超時自動 fallback，不影響核心體驗

**Areas for Future Enhancement：**
- Phase 2 的測試框架選型（目前 MVP 手動測試）
- CI/CD pipeline 的具體設定（目前只有 build.yml 佔位）
- FR12 剪貼簿上下文注入的實作細節

### Implementation Handoff

**AI Agent Guidelines：**
- 遵循架構文件中所有決策
- 一致使用命名慣例和實作模式
- 尊重專案結構和邊界
- 所有架構相關問題參照本文件

**First Implementation Priority：**
1. 新增 SQLite 基礎架構 + 擴展 OS-native 熱鍵（Layer 0）
2. 建立 Pinia stores + 雙視窗架構
3. 依 PRD 建議開發順序推進
