---
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-03-27'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules', 'sentry_telemetry', 'i18n', 'smart_dictionary', 'model_registry_v2', 'esc_global_abort', 'hallucination_v3', 'sound_feedback', 'enhancement_anomaly', 'audio_input_device', 'audio_preview']
status: 'complete'
rule_count: 285
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
| Telemetry (Frontend) | @sentry/vue | ^10.42.0 | 僅生產環境啟用，雙視窗分別初始化 |
| Telemetry (Backend) | sentry (Rust) | 0.46 | 環境變數驅動，Guard 模式 |

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
| `vue-i18n` | ^11.3.0 | 多語言國際化（Composition API `useI18n()` + 全域 `i18n.global.t()`） |
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
| 原生 CoreAudio FFI（`extern "C"`，無 crate wrapper） | macOS | 系統音量控制（AudioObjectGetPropertyData/SetPropertyData） |
| `windows` 0.61 | Windows | Win32 API、鍵盤 Hook、IAudioEndpointVolume（系統音量） |
| `arboard` 3 | 跨平台 | 剪貼簿存取 |
| `cpal` 0.15 + `hound` 3.5 + `rustfft` 6 | 跨平台 | 音訊錄製、WAV 編碼、FFT 波形分析 |
| `reqwest` 0.12 (multipart, json) | 跨平台 | Groq Whisper API（Rust 直接呼叫） |

### External APIs

- Groq Whisper API — `https://api.groq.com/openai/v1/audio/transcriptions`（預設模型：`whisper-large-v3`，語言：由 `getWhisperLanguageCode()` 回傳 `string | null`（auto 模式回傳 `null` 表示 Whisper 自動偵測），Rust fallback `"zh"`，可選 `whisper-large-v3-turbo`）
- Groq LLM API — `https://api.groq.com/openai/v1/chat/completions`，兩個獨立模型設定：
  - **文字整理**（enhancer）：預設 `moonshotai/kimi-k2-instruct`，可選 Llama 3.3 70B / Llama 4 Scout 17B / Qwen3 32B，temperature: 0.1，timeout: 5s
  - **字典分析**（vocabularyAnalyzer）：預設 `llama-3.3-70b-versatile`，可選 Kimi K2 Instruct，temperature: 0，max_tokens: 256
- **模型註冊** — `src/lib/modelRegistry.ts` 集中管理：
  - 三組獨立型別：`LlmModelId`、`VocabularyAnalysisModelId`、`WhisperModelId`
  - 三個獨立模型清單：`LLM_MODEL_LIST`、`VOCABULARY_ANALYSIS_MODEL_LIST`、`WHISPER_MODEL_LIST`
  - 三個安全取得函式：`getEffectiveLlmModelId()`、`getEffectiveVocabularyAnalysisModelId()`、`getEffectiveWhisperModelId()`
  - 價格、免費配額、Badge 標籤（`badgeKey`）
  - **下架遷移機制** — `DECOMMISSIONED_MODEL_MAP: Record<string, LlmModelId>`，舊 ID → 新 ID 映射，`getEffectiveLlmModelId()` 自動遷移（僅 LLM 模型，Whisper/字典分析直接 fallback 預設）
- CSP 白名單：`connect-src 'self' https://api.groq.com`

### Sentry/Telemetry 整合

#### 架構概覽

- **前端** — `@sentry/vue` ^10.42.0，集中在 `src/lib/sentry.ts`，兩個視窗分別初始化
- **後端** — `sentry` 0.46（Rust crate），在 `lib.rs` 的 `run()` 中初始化
- **僅生產環境** — 兩端都只在 production 環境且 DSN 存在時啟用，開發模式不發送

#### 前端初始化（lib/sentry.ts）

- **`initSentryForHud(app)`** — HUD 視窗輕量初始化（無 tracing integration），`main.ts` 呼叫
- **`initSentryForDashboard(app, router)`** — Dashboard 視窗完整初始化（含 `browserTracingIntegration`），`main-window.ts` 呼叫
- **`captureError(error, context?)`** — 統一錯誤上報入口，帶可選 context 物件
- **視窗標籤** — `tags: { window: "hud" | "dashboard" }` 區分錯誤來源

#### Rust 初始化（lib.rs）

- **Guard 模式** — `let _sentry_guard = sentry::init(...)` 綁定在 `run()` 局部變數，app 結束才釋放
- **`send_default_pii: false`** — 不發送個人識別資訊
- **DSN 過濾** — 忽略空字串和 `__` 開頭的 CI 佔位符

#### Sentry 規則

- **錯誤上報** — 關鍵流程失敗（錄音、轉錄、AI 整理、DB 初始化、bootstrap）必須呼叫 `captureError(error, { source, step })`
- **context 結構規範** — `captureError(err, { source: "模組名", step: "操作名" })`，`source` 對應模組（`settings`/`voice-flow`/`history`/`database-init`/`bootstrap`），`step` 對應操作（`load`/`save-locale`/`transcribe`）
- **上報層級** — 只從 store actions 或啟動腳本（`main.ts`, `main-window.ts`）呼叫，`lib/` 層只拋錯不上報
- **覆蓋範圍** — 56 個 `captureError` 呼叫點：`useVoiceFlowStore`（17）、`useSettingsStore`（11）、`useHistoryStore`（8）、`useVocabularyStore`（6）、`main-window.ts`（5）、`MainApp.vue`（3）、`AccessibilityGuide.vue`（3）、`main.ts`（2）、`lib/sentry.ts`（1）
- **全域錯誤處理** — 兩個視窗各自設定 `app.config.errorHandler`（Vue 元件錯誤）+ `window.addEventListener("unhandledrejection")`（未捕獲 Promise），確保逃逸的錯誤也能上報
- **Rust 端清理** — App 退出前呼叫 `sentry::end_session()` + `client.flush(Duration::from_secs(2))`，確保最後的 event 發送完成
- **Release 格式** — `sayit@<version>`，由 CI/CD 環境變數自動設定
- **Sourcemap 上傳** — 僅 `release.yml` 的 macOS ARM64 job 執行（避免重複），使用 `@sentry/cli`

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
- **錯誤訊息本地化** — 使用 `src/lib/errorUtils.ts` 集中管理使用者可見的錯誤訊息，透過 `i18n.global.t('errors.xxx')` 動態翻譯（支援 5 種語言），按功能分函式：`getMicrophoneErrorMessage()`, `getTranscriptionErrorMessage()`, `getEnhancementErrorMessage()`
- **結構化 Error class** — `EnhancerApiError extends Error` 帶 `statusCode` 屬性，`errorUtils.ts` 用 `instanceof EnhancerApiError` 檢查取代字串解析。新增 lib 層錯誤 class 時必須帶語意屬性（如 `statusCode`、`code`），禁止將結構化資訊編碼在 `message` 字串中

#### Rust

- **Tauri Command 簽名** — 必須加泛型 `<R: Runtime>` 約束，返回 `Result<T, CustomError>`
- **錯誤型別** — 使用 `thiserror` crate 定義 enum，且必須手動 `impl serde::Serialize`
- **平台隔離** — `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 隔離，不可在同一函式中混合
- **unsafe 標記** — macOS `objc::msg_send!` 呼叫必須在 `unsafe {}` 區塊內
- **原子操作** — 跨執行緒共享狀態使用 `AtomicBool` + `Ordering::SeqCst`
- **Plugin 模式** — 每個功能模組是獨立的 `TauriPlugin<R>`，在 `plugins/mod.rs` 中 `pub mod` 匯出（目前：`clipboard_paste`, `hotkey_listener`, `keyboard_monitor`, `audio_control`, `audio_recorder`, `transcription`, `sound_feedback`, `text_field_reader`）。`hotkey_listener` 額外提供 `reset_hotkey_state` command（ESC 中斷後重置 toggle 狀態）。`sound_feedback` 提供 `play_start_sound`/`play_stop_sound`/`play_error_sound`/`play_learned_sound` commands，前端透過 `playSoundIfEnabled()` 依 `isSoundEffectsEnabled` 設定條件呼叫
- **audio_recorder 錄音檔管理 Commands（Story 4.4）** — `save_recording_file`（寫入 WAV 至 `{APP_DATA}/recordings/`）、`read_recording_file`（接受 `id` 參數，Rust 端組合路徑讀取 WAV 位元組，回傳 `Response`）、`delete_all_recordings`（清除所有錄音檔）、`cleanup_old_recordings`（按天數清理過期檔案，回傳被刪除的 transcription ID list）
- **transcription 重送 Command（Story 4.5）** — `retranscribe_from_file`（從磁碟讀取 WAV 重新轉錄），內部共用 `send_transcription_request()` 函式（與 `transcribe_audio` 共用 Groq API 邏輯，避免重複實作）
- **Plugin State shutdown 慣例** — 每個 Plugin State struct 必須實作 `pub fn shutdown(&self)` 方法，用於 App 退出時清理資源（停止錄音、恢復音量、取消 CGEventTap 等）。`shutdown()` 內部必須處理 `Mutex` poisoned 的情況（`match lock() { Err(_) => return }`）
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

#### Graceful Shutdown（App 退出清理）

- **觸發點** — `lib.rs` 的 `RunEvent::Exit` handler
- **執行順序**（必須嚴格遵守，避免資源洩漏）：
  1. `audio_control.shutdown()` — 恢復系統音量（最高優先：避免永久靜音）
  2. `audio_recorder.shutdown()` — 停止 cpal 錄音 stream + join thread
  3. `keyboard_monitor.shutdown()` — 取消 CGEventTap / unhook Windows Hook
  4. `hotkey_listener.shutdown()` — 停止 hotkey CGEventTap
  5. `sleep(200ms)` — 等待背景 thread 完成清理
  6. `_exit(0)` — 強制退出（繞過 Tauri 預設行為）
- **新 Plugin 加入時** — 必須在對應位置加入 `shutdown()` 呼叫，並考慮順序依賴
- **`try_state::<T>()`** — 使用 `try_state` 而非 `state`，因為 Exit 事件不保證所有 state 都已註冊

#### CGEvent 貼上機制（clipboard_paste）

- **事件源** — 使用 `CGEventSourceStateID::Private`（隔離事件源），不繼承物理鍵盤的 modifier 狀態。禁止使用 `HIDSystemState` 或 `CombinedSessionState`，否則 Toggle 模式下 modifier trigger key（如右 Option）的殘留 Alternate flag 會污染模擬的 Cmd+V，導致目標 app 收到 Opt+Cmd+V 觸發重複貼上
- **投遞位置** — 使用 `CGEventTapLocation::Session`（Session 層），不走 HID 管線。新版 macOS（15.x+）的 HID 層事件可能經由多重路徑投遞導致重複
- **事件序列** — Cmd↓ → V↓ → V↑ → Cmd↑（4 事件完整配對），V↓/V↑ 帶 `CGEventFlagCommand`，Cmd↑ 帶 `CGEventFlagNull`

#### Persistent Event Tap 模式（keyboard_monitor）

- **持久監聽器** — `keyboard_monitor.rs` 在 `KeyboardMonitorState::new()` 時建立一次 CGEventTap（macOS）/ Windows Hook，App 生命週期內永不銷毀
- **Flag 控制** — 靠 `is_monitoring: AtomicBool`（品質監控）和 `correction_monitoring: AtomicBool`（修正偵測）獨立控制是否處理事件。兩個 monitor 使用完全獨立的 flag 集，可同時啟用
- **設計動機** — 重複建立/銷毀 CGEventTap 會產生幽靈按鍵（ghost Enter key），這是已確認的 bug 根因

#### ESC 全域中斷（VoiceFlow Abort Pattern）

- **觸發** — Rust `hotkey_listener.rs` 偵測 ESC KeyDown（macOS keycode 53 / Windows VK 0x1B），emit `escape:pressed` 事件（不經過 `handle_key_event()`，獨立路徑）
- **前端處理** — `useVoiceFlowStore` 的 `handleEscapeAbort()` 根據當前狀態中斷操作（idle/success/error/cancelled 時忽略）
- **abort 機制** — `isAborted: Ref<boolean>` + `AbortController`，recording 時停止錄音、transcribing 時丟棄結果、enhancing 時 abort fetch（signal 傳入 `enhanceText()`）
- **狀態重置** — 無條件設 `isRecording = false`、清理所有 timer/polling/listener、呼叫 `reset_hotkey_state` command 重置 Rust 端 `is_pressed`/`is_toggled_on`
- **abort guard 慣例** — `handleStopRecording()` 和 `handleRetryTranscription()` 的所有 `await` 之後及外層 `catch` 必須檢查 `if (isAborted.value) return;`
- **重置時機** — `handleStartRecording()` 和 `handleRetryTranscription()` 開頭重置 `isAborted = false` + `abortController = new AbortController()`
- **HUD 回饋** — 轉為 `"cancelled"` 狀態（`NotchHud.vue` X 圖示 + "已取消" label），顯示 1 秒後 collapse
- **ESC 為保留鍵** — `keycodeMap.ts` 中 ESC 為 hard block（`getDangerousKeyWarning("Escape")` 回傳 null，`getEscapeReservedMessage()` 提供錯誤訊息），設定頁面拒絕設定 ESC 為 trigger key
- **已知限制** — Rust 端 `transcribe_audio` HTTP 請求無法真正取消，僅前端忽略結果（API 費用照算）

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
| `correction-monitor:result` | `CORRECTION_MONITOR_RESULT` | Rust → HUD | `CorrectionMonitorResultPayload` |
| `audio:waveform` | `AUDIO_WAVEFORM` | Rust → HUD | `WaveformPayload { levels: [f32; 6] }` |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore → HUD | `VocabularyLearnedPayload` |
| `escape:pressed` | `ESCAPE_PRESSED` | Rust → HUD | — |

#### SettingsKey 跨視窗同步

- **`SettingsKey` 型別** — 定義 `settings:updated` event 的 `key` 欄位（`events.ts`）：`hotkey` | `apiKey` | `aiPrompt` | `enhancementThreshold` | `llmModel` | `vocabularyAnalysisModel` | `whisperModel` | `muteOnRecording` | `smartDictionaryEnabled` | `locale` | `transcriptionLocale` | `soundEffectsEnabled` | `promptMode` | `audioInputDevice`
- **智慧字典開關** — `isSmartDictionaryEnabled`（macOS 預設啟用，Windows 預設關閉——因 Windows 尚未支援 `read_focused_text_field` AX API）
- **字典分析模型獨立** — `selectedVocabularyAnalysisModelId` 與 `selectedLlmModelId` 分開儲存和選擇，各自有獨立的模型清單和設定 UI

#### i18n 多語言（vue-i18n）

- **支援語言** — zh-TW（繁體中文，fallback）、en（英文，vue-i18n fallbackLocale）、ja、zh-CN、ko
- **雙視窗 instance** — HUD 和 Dashboard 各自建立獨立的 `createI18n()` instance（不是 singleton），語言切換透過 `emitEvent(SETTINGS_UPDATED, { key: "locale" })` + `refreshCrossWindowSettings()` 同步
- **Vue 元件翻譯** — `const { t } = useI18n()` + template 中 `$t('key')` / `{{ t('key') }}`
- **lib/store 層翻譯** — `i18n.global.t('key', params)` — 因為不在 Vue 元件 setup 中，不能用 `useI18n()`
- **翻譯檔案** — `src/i18n/locales/{locale}.json`，key 結構按功能分組（`settings.*`, `dashboard.*`, `errors.*`, `voiceFlow.*` 等），5 個檔案的 key 集合必須完全一致
- **AI Prompt 多語言** — `src/i18n/prompts.ts` 管理三層 prompt map：`LEGACY_DEFAULT_PROMPTS`（遷移用）、`MINIMAL_PROMPTS`、`ACTIVE_PROMPTS`。函式：`getMinimalPromptForLocale()`、`getPromptForModeAndLocale(mode, locale)`、`isKnownDefaultPrompt()`。Active prompt 規則：合併重複表達時保留原語氣（問句仍是問句、請求仍是請求）、禁止將問句改寫為肯定句
- **語言偵測** — `detectSystemLocale()` 5 層匹配：精確 → script subtag（`zh-Hant` → `zh-TW`）→ 語言前綴 → 裸 `zh` → fallback `zh-TW`（保護既有中文使用者升級路徑）
- **HTML lang 屬性** — `document.documentElement.lang` 隨 locale 更新（zh-TW → `zh-Hant`、zh-CN → `zh-Hans`）

#### 幻覺偵測架構（v3 — 二層偵測，語速異常 + 無人聲偵測）

- **偵測模組** — `src/lib/hallucinationDetector.ts`，純函式（無 Vue/Pinia 依賴），`detectHallucination()` 回傳 `HallucinationDetectionResult`
- **輸入參數** — `HallucinationDetectionParams { rawText, recordingDurationMs, peakEnergyLevel, rmsEnergyLevel, noSpeechProbability }`
- **回傳型別** — `{ reason: "speed-anomaly" | "no-speech-detected" | null }`
- **二層判定邏輯**（優先級由高到低）：
  - **Layer 1（語速異常）** — `recordingDurationMs < 1000 && charCount > 10` → reason: `speed-anomaly`
  - **Layer 2（無人聲偵測）** — 兩個子條件（OR 關係）：
    - **2a**：`peakEnergyLevel < 0.02`（SILENCE_PEAK_ENERGY_THRESHOLD）→ 峰值極低，幾乎確定無聲音
    - **2b**：`peakEnergyLevel < 0.03`（LAYER2B_PEAK_ENERGY_CEILING）且 `rmsEnergyLevel < 0.015`（SILENCE_RMS_THRESHOLD）且 `noSpeechProbability > 0.7`（SILENCE_NSP_THRESHOLD）→ peak 偏低 + 低 RMS + 高 NSP 聯合判斷。若 peak >= 0.03 表示有明確可聽聲音，跳過此檢查避免小聲說話因 RMS 被靜音段稀釋而誤判
    - → reason: `no-speech-detected`
  - **其他** — 放行，正常流程
- **RMS 能量** — Rust `audio_recorder.rs` 的 `stop_recording()` 同時計算 `peak_energy_level`（峰值）和 `rms_energy_level`（均方根），單次遍歷。RMS 是整段錄音的平均值，會被錄音前後的靜音段稀釋，因此不適合單獨作為語音判斷依據
- **NSP 使用策略** — `noSpeechProbability` 不單獨使用（已知不可靠，Whisper 對中文軟音常報高 NSP），僅作為 Layer 2b 的輔助信號搭配 peak + RMS 使用
- **無幻覺詞庫** — 已移除 `hallucination_terms` 表和 `useHallucinationStore`，偵測完全基於錄音品質信號，不依賴詞庫比對
- **幻覺攔截行為** — 判定為幻覺 → 不貼上，HUD 顯示「未偵測到語音」，寫入 `transcriptions` 表 `status: 'failed'`，設定重送狀態（`canRetry`）
- **整合位置** — `useVoiceFlowStore` 的 `handleStopRecording()` 和 `handleRetryTranscription()` 在轉錄結果回傳後、`isEmptyTranscription` 檢查之後執行幻覺偵測
- **`isEmptyTranscription()`** — 仍保留，只攔截完全空白文字（`!rawText.trim()`），與幻覺偵測互補

#### 增強後異常偵測（Enhancement Anomaly Detection）

- **偵測函式** — `detectEnhancementAnomaly()`（`src/lib/hallucinationDetector.ts`），純函式，檢查 LLM 增強是否產出異常結果
- **長度爆炸偵測** — `enhancedText.length >= rawText.length * 2`（`ENHANCEMENT_LENGTH_EXPLOSION_RATIO = 2`）→ LLM 在回答問題或產生幻覺
- **重試機制** — `useVoiceFlowStore` 偵測到異常後自動重試（最多 `MAX_ENHANCEMENT_RETRY_COUNT = 3` 次），重試仍異常則 fallback 到 rawText（`wasEnhanced: false`）
- **整合位置** — `handleStopRecording()` 在 `enhanceText()` 之後，`completePasteFlow()` 之前

#### 音訊輸入裝置選擇

- **Rust Commands** — `list_audio_input_devices` → `Vec<AudioInputDeviceInfo>`（列舉 cpal 輸入裝置）；`get_default_input_device_name` → `Option<String>`（查詢系統預設裝置名稱）
- **`start_recording` 參數** — `device_name: String`，空字串 = 系統預設，依名稱查找失敗時 fallback 到預設裝置
- **共用裝置選擇** — `select_input_device(host, device_name, tag)` helper 封裝 cpal Arc cycle workaround，recording/preview thread 共用
- **macOS cpal 0.15.3 workaround** — `input_devices()` 回傳的 Device（`is_default=false`）會觸發 disconnect listener 的 Arc 循環引用，導致 `drop(stream)` 無法釋放 AudioUnit。因此 `select_input_device` 優先比對 `default_input_device()`（`is_default=true`），stream 結束時必須 `stream.pause()` before drop
- **前端型別** — `AudioInputDeviceInfo { name: string }`、`AudioPreviewLevelPayload { level: number }`（`src/types/audio.ts`）
- **設定儲存** — `useSettingsStore.selectedAudioInputDeviceName`（預設空字串），持久化 key `audioInputDeviceName`
- **UI** — `SettingsView.vue` 的「輸入裝置」Card，Select 元件 + 重新整理按鈕 + 音量預覽條
- **預設裝置名稱顯示** — 「系統預設」選項後方括號顯示實際裝置名稱（`systemDefaultWithDevice` i18n key）
- **i18n key** — `settings.audioInput.{title, description, deviceLabel, systemDefault, systemDefaultWithDevice, volumePreview, refresh, refreshed, updated}`

#### 音量預覽（Audio Preview）

- **獨立 State** — `AudioPreviewState { handle: Mutex<Option<PreviewHandle>> }`，`PreviewHandle` 含 `should_stop: Arc<AtomicBool>` + `thread: Option<JoinHandle<()>>`，與 `AudioRecorderState` 完全隔離
- **Rust Commands** — `start_audio_preview(app, preview_state, device_name)` → `Result<(), String>`；`stop_audio_preview(preview_state)` → `()`
- **Event** — `audio:preview-level`（常量 `AUDIO_PREVIEW_LEVEL`），payload `AudioPreviewLevelPayload { level: f32 }`，30ms 間隔 emit
- **RMS → dB 映射** — `PREVIEW_DB_FLOOR = -60.0`、`PREVIEW_DB_CEILING = -20.0`（40 dB 動態範圍），線性 RMS 轉 dB 後正規化。AirPods Pro 等低增益麥克風語音 RMS 約 0.005~0.018（-46 ~ -35 dB）→ 35%~63% 顯示
- **preview stream** — `build_preview_stream<T>` 泛型，callback 計算 mono mix + clamp + 累積 `(sum_squares, sample_count)` 到單一 `Mutex<(f64, usize)>`（原子一致性），不存 samples、不做 FFT
- **生命週期** — 設定頁 `onMounted` 啟動（先 `loadAudioInputDeviceList` 再 `startPreview`）、`onBeforeUnmount` 停止；切換裝置時重啟；錄音開始時自動停止（`start_recording` 持有 recording lock 期間呼叫 `stop_audio_preview_inner`）；錄音進行中不啟動（AC 11 檢查）
- **Thread 清理** — `stop_audio_preview_inner` 會 `take()` handle → set flag → `thread.join()`，確保裝置完全釋放。`RunEvent::Exit` 中 preview shutdown 必須在 recorder shutdown 之前
- **Composable** — `useAudioPreview.ts`：`useRafFn` + LERP(0.2) + `startRequestId` re-entrancy guard + `onUnmounted` cleanup
- **UI** — `role="meter"` + `aria-valuenow` + `Mic` icon + `bg-primary` bar + `transition-[width] duration-75`

#### 轉錄語言分離（TranscriptionLocale）

- **型別** — `TranscriptionLocale = SupportedLocale | "auto"`（定義於 `languageConfig.ts`）
- **UI locale vs 轉錄 locale** — `selectedLocale`（UI 語言）和 `selectedTranscriptionLocale`（Whisper 語言）獨立儲存，使用者可選不同語言組合（如 UI 繁中 + Whisper 英文）
- **`selectedTranscriptionLocale` state** — 存在 `useSettingsStore`，持久化 key `selectedTranscriptionLocale`，首次遷移預設為 UI locale
- **`saveTranscriptionLocale(locale)`** — 儲存轉錄語言 + `settings:updated` event
- **`getWhisperLanguageCode()`** — 回傳 `string | null`，根據 `selectedTranscriptionLocale` 解析：`"auto"` → `null`（Whisper 自動偵測），具體語言 → 對應 Whisper code
- **`getWhisperCodeForTranscriptionLocale(locale)`** — 純函式版本（`languageConfig.ts`），`"auto"` → `null`
- **`TRANSCRIPTION_LANGUAGE_OPTIONS`** — 含 `auto` + 5 語言的下拉選單選項陣列（`TranscriptionLanguageOption[]`）
- **`getEffectivePromptLocale()`** — 內部 helper，解析 prompt 預設值應用哪個 locale：transcription 為 auto 時跟 UI locale，否則跟 transcription locale

#### Prompt Mode 機制（⚠️ 關鍵行為）

- **三種模式** — `PromptMode = "minimal" | "active" | "custom"`，持久化 key `promptMode`，預設 `"active"`
- **preset 模式（minimal/active）** — `getAiPrompt()` 即時計算，呼叫 `getPromptForModeAndLocale(mode, locale)` 自動跟隨 locale 切換，無需手動同步
- **custom 模式** — 使用者自訂 prompt，切語言不影響 prompt 內容
- **`refreshCrossWindowSettings()` 順序** — 必須先載入 `selectedLocale` + `selectedTranscriptionLocale`，再載入 `promptMode`，最後計算 `aiPrompt` fallback（因為 `getEffectivePromptLocale()` 依賴這些值）
- **v0.8.7 一次性遷移** — `loadSettings()` 檢查 `llmMigratedToKimiK2` flag（`tauri-plugin-store`），首次為 false 時強制將 LLM 模型設為 `DEFAULT_LLM_MODEL_ID`（Kimi K2），寫入 flag 後不再觸發。使用者可在設定中手動切回其他模型

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
- **欄位命名** — snake_case（`raw_text`, `was_enhanced`）
- **主鍵** — `TEXT PRIMARY KEY`（UUID，前端 `crypto.randomUUID()` 產生）
- **時間戳** — `created_at TEXT DEFAULT (datetime('now'))`
- **操作限制** — SQLite 操作只從 Pinia store actions 發起，元件不可直接執行 SQL
- **SQL 參數** — 使用 `$1`, `$2` 位置參數語法（tauri-plugin-sql 規範）
- **Schema Migration** — `schema_version` 表追蹤版本號，migration 在 `database.ts` 中依序執行（`if (currentVersion < N)` → 建表/改表 → 更新版本號），當前版本：v7
  - v3：vocabulary.weight/source 欄位 + api_usage CHECK constraint 擴展
  - v4（Story 4.4）：`ALTER TABLE transcriptions ADD COLUMN audio_file_path TEXT`、`ADD COLUMN status TEXT NOT NULL DEFAULT 'success'`、`CREATE INDEX idx_transcriptions_status`
  - v5（Story 2.4）：`CREATE TABLE hallucination_terms`（已於 v7 移除）
  - v6：重新計算 `transcriptions.char_count`（從 `raw_text` 重算）
  - v7：`DROP TABLE IF EXISTS hallucination_terms`
- **TRANSACTION Migration 模式** — v4 起使用 `BEGIN TRANSACTION / COMMIT / ROLLBACK` 包裹每個 migration，確保 schema 變更原子性
- **外鍵關聯** — `api_usage.transcription_id` → `transcriptions.id`，新增表時必須同步建立 index
- **表命名** — 複數 snake_case（`transcriptions`, `vocabulary`, `api_usage`）

#### 錄音檔案管理（Story 4.4）

- **儲存位置** — `{APP_DATA}/recordings/{transcription_id}.wav`（Tauri `app_data_dir()`）
- **Rust Commands** — `save_recording_file`（寫入 WAV）、`read_recording_file`（讀取 WAV 位元組，接受 id 參數）、`delete_all_recordings`（清除所有）、`cleanup_old_recordings`（按天數清理，回傳被刪 ID list）
- **DB 關聯** — `transcriptions.audio_file_path` 記錄完整路徑，`transcriptions.status` 記錄 `'success' | 'failed'`
- **失敗記錄保存** — 空轉錄、錄音太短、API 錯誤、幻覺攔截均寫入 `status: 'failed'` 記錄，保留錄音檔供重送
- **Blob URL 播放** — `invoke("read_recording_file", { id })` 透過 Rust IPC 讀取 WAV 位元組（macOS 上 asset protocol URL 被 CSP 阻擋），前端轉為 `new Uint8Array(raw)` → `Blob` → `URL.createObjectURL()` 播放，需 CSP `media-src 'self' blob:`
- **自動清理** — `main-window.ts` 啟動時 `queueMicrotask` 非阻斷清理，呼叫 `cleanup_old_recordings` 後用回傳 ID list 批次 SQL UPDATE `audio_file_path = NULL`
- **設定** — `useSettingsStore` 的 `isRecordingAutoCleanupEnabled`（boolean）和 `recordingAutoCleanupDays`（number, default 7）

#### 轉錄重送機制（Story 4.5）

- **Rust Command** — `retranscribe_from_file`：從磁碟讀取 WAV，共用 `send_transcription_request()` 內部函式（與 `transcribe_audio` 共用 Groq API 邏輯）
- **重送狀態** — `useVoiceFlowStore` 的 `lastFailedTranscriptionId`、`lastFailedAudioFilePath`、`lastFailedRecordingDurationMs`（失敗時設定，新錄音時重置）
- **`canRetry` computed** — `status === 'error' && lastFailedAudioFilePath !== null && !isRetryAttempt`
- **重試感知 HUD 時長** — error HUD 預設 3 秒自動消失（`ERROR_DISPLAY_DURATION_MS`），有重試按鈕時延長至 6 秒（`ERROR_WITH_RETRY_DISPLAY_DURATION_MS`），讓使用者有足夠時間點擊重試
- **重送限制** — 限 1 次（`isRetryAttempt` flag），重送失敗不再提供重送按鈕
- **`skipRecordSaving` 模式** — 重送成功時 `completePasteFlow({ skipRecordSaving: true })`，跳過 INSERT（避免 PK 衝突），改由 `updateTranscriptionOnRetrySuccess()` UPDATE 現有 failed 記錄
- **API usage 串接** — 重送路徑的 `saveApiUsageRecordList` 必須在 `updateTranscriptionOnRetrySuccess` 完成後執行（FK 依賴）
- **幻覺偵測** — 重送結果也需通過幻覺偵測（`handleRetryTranscription` 內整合）
- **競態處理** — 重送期間使用者觸發新錄音：`handleStartRecording` 重置 retry 狀態，舊 invoke 回來後靜默丟棄

#### API 用量追蹤

- **費用計算** — `src/lib/apiPricing.ts` 提供 `calculateWhisperCostCeiling()` 和 `calculateChatCostCeiling()` 純函式
- **費用上限原則** — 一律取較貴的費率計算（如 LLM 取 output token 價格 $0.79/M），確保是費用上限而非精確值
- **Whisper 最低計費** — 不足 10 秒一律按 10 秒算（Groq 計費規則）
- **api_usage 表** — 每次 API 呼叫存一筆記錄（`whisper` / `chat` / `vocabulary_analysis`），由 `useVoiceFlowStore` 在轉錄/AI 整理/字典分析完成後透過 `useHistoryStore` 寫入
- **型別** — `ApiUsageRecord`, `ChatUsageData`, `EnhanceResult`, `DailyUsageTrend`, `ApiType = "whisper" | "chat" | "vocabulary_analysis"`（定義在 `src/types/transcription.ts`）
- **Dashboard 統計排除 failed** — `DASHBOARD_STATS_SQL` 和 `DAILY_USAGE_TREND_SQL` 加 `WHERE status != 'failed'`，失敗記錄不計入總使用次數和趨勢圖

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
| `enhancer.test.ts` | Groq LLM AI 整理邏輯 |
| `error-utils.test.ts` | 錯誤訊息本地化 |
| `auto-updater.test.ts` | 自動更新流程（UpdateCheckResult） |
| `use-voice-flow-store.test.ts` | 錄音→轉錄→AI 整理流程狀態（mock Tauri invoke） |
| `use-history-store.test.ts` | 歷史記錄 CRUD + 統計查詢 |
| `use-settings-store.test.ts` | 設定讀寫（hotkey, API Key, prompt, prompt mode 遷移） |
| `use-settings-store-autostart.test.ts` | 開機自啟動邏輯 |
| `api-pricing.test.ts` | API 費用計算邏輯 |
| `format-utils.test.ts` | 時間/文字格式化工具 |
| `factories.test.ts` | 測試資料工廠 |
| `types.test.ts` | 型別定義驗證 |
| `NotchHud.test.ts`（component） | HUD 元件 6 態顯示 |
| `i18n-settings.test.ts` | 語言偵測、locale 儲存/載入、Whisper code 映射、prompt 連動、翻譯檔 key 一致性 |
| `AccessibilityGuide.test.ts`（component） | 輔助使用權限引導 |
| `use-vocabulary-store.test.ts` | 字典 CRUD + 權重 + AI 推薦詞 + getTopTermListByWeight |
| `i18n-smoke.test.ts`（component） | mount View + 切換 locale + 斷言 UI 文字切換 |
| `hallucination-detector.test.ts` | 二層幻覺偵測邏輯（語速異常 + 無人聲偵測） |
| `smoke.test.ts`（e2e） | 端對端冒煙測試 |

#### 測試規則

- **不主動新增測試** — 除非 Story 明確要求或使用者指示，AI agents 不應自行建立測試
- **i18n mock 模式** — 測試 store/lib 時需 mock `src/i18n`（回傳 `{ global: { locale: { value: "zh-TW" }, t: (key) => key } }`）和 `src/i18n/prompts`、`src/i18n/languageConfig`
- **元件測試 i18n 掛載** — mount 元件時必須在 `global.plugins` 加入 i18n instance（`createI18n({ legacy: false, locale: "zh-TW", messages: { "zh-TW": zhTW } })`）
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
| Service/Lib 檔案 | camelCase | `enhancer.ts`, `errorUtils.ts`, `formatUtils.ts`, `apiPricing.ts` |
| Pinia Store 檔案 | camelCase + use 前綴 | `useSettingsStore.ts`, `useVoiceFlowStore.ts` |
| Rust 模組檔案 | snake_case | `clipboard_paste.rs`, `hotkey_listener.rs`, `keyboard_monitor.rs`, `audio_recorder.rs`, `transcription.rs` |
| 資料夾 | kebab-case | `src-tauri/`, `components/` |
| TS 變數/函式 | camelCase | `startRecording()`, `enhancedText` |
| TS 型別/介面 | PascalCase + 後綴 | `TranscriptionRecord`, `HotkeyConfig`, `WaveformPayload`, `StopRecordingResult` |
| TS 布林變數 | is/has/can/should 前綴 | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS 常數 | UPPER_SNAKE_CASE | `FALLBACK_LOCALE`, `ENHANCEMENT_TIMEOUT_MS` |
| TS Error class | PascalCase + Error 後綴 | `EnhancerApiError` |
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
│   ├── NotchHud.vue     # HUD 7 態狀態顯示（含 cancelled，自訂動畫引擎）
│   ├── AccessibilityGuide.vue # macOS 輔助使用權限引導
│   ├── AppSidebar.vue   # Dashboard 側邊欄（shadcn Sidebar）
│   ├── DashboardUsageChart.vue # API 用量趨勢圖表（unovis）
│   ├── Nav*.vue / SiteHeader.vue # 導覽元件群（shadcn blocks）
│   └── ui/              # shadcn-vue CLI 生成元件（不手動修改）
├── i18n/                    # 多語言國際化
│   ├── index.ts             # createI18n() instance（非 singleton，各 WebView 獨立）
│   ├── languageConfig.ts    # SupportedLocale、TranscriptionLocale 型別、LANGUAGE_OPTIONS、TRANSCRIPTION_LANGUAGE_OPTIONS、detectSystemLocale()、getWhisperCodeForTranscriptionLocale()
│   ├── prompts.ts           # 三層 AI Prompt map（getMinimalPromptForLocale, getPromptForModeAndLocale, isKnownDefaultPrompt）
│   └── locales/             # 翻譯 JSON 檔（5 語言，key 結構必須一致）
│       ├── zh-TW.json       # 繁體中文（基準語言）
│       ├── en.json          # English（vue-i18n fallbackLocale）
│       ├── ja.json, zh-CN.json, ko.json
├── composables/          # Vue composables（跨元件邏輯）
│   ├── useTauriEvents.ts    # Tauri Event 常量 + 封裝
│   ├── useFeedbackMessage.ts # 臨時回饋訊息模式
│   └── useAudioWaveform.ts  # 音訊波形視覺化（Tauri Event push 模式）
├── lib/                  # Service 層（純邏輯，無 Vue 依賴）
│   ├── enhancer.ts          # Groq LLM AI 整理
│   ├── vocabularyAnalyzer.ts # Groq LLM 字典分析（修正偵測後 AI 差異比對）
│   ├── database.ts          # SQLite 初始化 + migration
│   ├── autoUpdater.ts       # tauri-plugin-updater 封裝（回傳 UpdateCheckResult）
│   ├── sentry.ts            # Sentry 初始化 + captureError（雙視窗策略）
│   ├── modelRegistry.ts     # LLM/Whisper/字典分析 模型註冊、價格、Badge、下架遷移
│   ├── keycodeMap.ts        # DOM event.code → 平台原生 keycode 映射
│   ├── errorUtils.ts        # 錯誤訊息本地化（繁體中文）
│   ├── hallucinationDetector.ts   # 二層幻覺偵測純函式（語速異常 + 無人聲偵測）
│   ├── formatUtils.ts       # 時間/文字格式化工具
│   ├── apiPricing.ts        # API 費用上限計算（Whisper + LLM）
│   └── utils.ts             # cn() shadcn-vue 工具函式
├── stores/               # Pinia stores
│   ├── useSettingsStore.ts      # 快捷鍵 / API Key / AI Prompt / Prompt Mode / 開機啟動 / UI locale / 轉錄 locale / Whisper 語言 / 字典分析模型
│   ├── useHistoryStore.ts       # 歷史記錄 CRUD + Dashboard 統計 + 分頁
│   ├── useVocabularyStore.ts    # 詞彙字典 CRUD + 權重系統 + AI 推薦詞管理
│   └── useVoiceFlowStore.ts     # 錄音/轉錄/AI 整理/貼上/修正偵測/字典學習完整流程
├── views/                # Main Window 頁面
│   ├── DashboardView.vue    # 統計卡片 + 最近轉錄列表
│   ├── HistoryView.vue      # 歷史記錄搜尋與管理
│   ├── DictionaryView.vue   # 詞彙字典 CRUD
│   └── SettingsView.vue     # 快捷鍵 / API Key / AI Prompt / Prompt Mode 切換 設定
├── types/                # TypeScript 型別定義
│   ├── index.ts             # HudStatus（含 cancelled）, TriggerMode, HudTargetPosition 等共用型別
│   ├── transcription.ts     # TranscriptionRecord, DashboardStats, ApiUsageRecord, DailyUsageTrend
│   ├── vocabulary.ts        # VocabularyEntry（含 weight, source）
│   ├── settings.ts          # TriggerKey (含右側修飾鍵: rightOption, rightControl), HotkeyConfig, SettingsDto
│   ├── events.ts            # 所有 Tauri Event payload 型別
│   └── audio.ts             # WaveformPayload, StopRecordingResult（含 rmsEnergyLevel）, TranscriptionResult
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
- **自動更新** — `tauri-plugin-updater` + GitHub Releases endpoint（啟動 5 秒後首次檢查，每 4 小時 `setInterval` 定時檢查 + Sidebar「檢查更新」按鈕顯示 `UpdateCheckResult` 狀態）

#### CI/CD

- **CI** — `.github/workflows/ci.yml`（push/PR to main → vue-tsc + Vitest）
- **Release** — `.github/workflows/release.yml`（tag `v*` 或 `workflow_dispatch` → 3 平台建構 + Apple 簽名 + Sentry sourcemap upload + 自動公開 Release）
- **發版腳本** — `./scripts/release.sh X.Y.Z`（bump 版本 → commit → tag → 分開推送 branch/tag）
- **GitHub Secrets** — 13 個（`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`）
- **Stable-name Assets** — Release workflow 自動上傳固定名稱 DMG/EXE（`SayIt-mac-arm64.dmg`, `SayIt-mac-x64.dmg`, `SayIt-windows-x64.exe`），支援官網固定下載 URL
- **Release 公開流程** — `tauri-action` 先建立 Draft release，待 matrix build 全部成功後由 `publish-release` job 自動執行 `gh release edit --draft=false`
- **Tag 推送陷阱** — `git push origin main --tags` 可能不觸發 tag 事件，必須分開推送（release.sh 已修正）
- **版本同步硬規則** — 發版時 `git tag`、`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 必須一致，Sentry release 一律綁定同一個版本號

#### 環境變數

**建構/簽署（CI/CD only）：**
- **`TAURI_SIGNING_PRIVATE_KEY`** / **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** — Updater 簽署
- **`APPLE_CERTIFICATE` 等 6 個** — Apple Code Signing（見 CLAUDE.md）

**Sentry（CI/CD 注入，生產環境用）：**

| 端 | 變數名 | 用途 | Fallback |
|----|--------|------|----------|
| Frontend | `VITE_SENTRY_DSN` | Frontend DSN | 無（不啟用） |
| Frontend | `VITE_SENTRY_ENVIRONMENT` | 環境標籤 | `import.meta.env.MODE` |
| Frontend | `VITE_SENTRY_RELEASE` | Release 版本 | `sayit@${__APP_VERSION__}` |
| Frontend | `VITE_SENTRY_TRACES_SAMPLE_RATE` | 追蹤採樣率 | `0`（不開啟） |
| Frontend | `VITE_SENTRY_SOURCEMAPS_ENABLED` | Sourcemap 生成 | `false` |
| Rust | `SENTRY_DSN` | Rust 端 DSN | 無（不啟用） |
| Rust | `SENTRY_ENVIRONMENT` | 環境標籤 | `production` / `development` |
| Rust | `SENTRY_RELEASE` | Release 版本 | `sayit@CARGO_PKG_VERSION` |
| CI/CD | `SENTRY_AUTH_TOKEN` | Sourcemap upload 認證 | — |
| CI/CD | `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry 組織/專案 | — |

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
- **❌ 錄音時未靜音系統喇叭** — 錄音開始前必須呼叫 `mute_system_audio`，結束後呼叫 `restore_system_audio`，避免系統音效被錄進去
- **❌ Singleton 提前賦值** — `database.ts` 的 `db` 變數絕不在 `Database.load()` 後立即賦值，必須等所有 `CREATE TABLE` 成功後才設定。否則 `getDatabase()` 返回無表空連線，所有 query 靜默失敗
- **❌ 假設 `sql:default` 包含寫入權限** — Tauri v2 的 `sql:default` 只有 `load/select/close`，任何 DDL/DML 操作需要額外的 `sql:allow-execute`。新增 Tauri plugin 時務必用 `acl-manifests.json` 確認 default 權限組的實際內容
- **❌ mount 前未初始化 DB** — `main-window.ts` 中 `app.mount()` 會觸發所有元件的 `onMounted`，若 DB 尚未初始化，Store 的 `getDatabase()` 會拋錯且被 try-catch 靜默吞掉
- **❌ 每次轉錄重建/銷毀 CGEventTap** — `keyboard_monitor` 必須使用持久 CGEventTap/Hook 模式：App 啟動時建立一次，靠 `is_monitoring: AtomicBool` flag 控制是否處理事件。重複建立/銷毀 CGEventTap 會產生幽靈按鍵（ghost Enter key），這是已確認的 bug 根因
- **❌ CGEvent 貼上使用 HIDSystemState / CombinedSessionState 事件源** — `simulate_paste_via_cgevent()` 必須使用 `CGEventSourceStateID::Private`，否則 Toggle 模式 + modifier trigger key（如右 Option）會殘留 Alternate flag 導致重複貼上。投遞位置必須用 `CGEventTapLocation::Session`
- **❌ `RunEvent::Exit` 中用 `state()` 取 managed state** — 必須用 `try_state::<T>()` + `if let Some(state)` 模式，避免 state 未註冊時 panic
- **❌ 硬編碼使用者可見字串** — 所有使用者看得到的文字必須使用 i18n 翻譯鍵（Vue 元件用 `$t()` / `t()`，lib/store 用 `i18n.global.t()`），禁止中文/英文硬編碼。程式碼註解和日誌不需翻譯
- **❌ 字串解析提取結構化資訊** — 禁止用 regex 從 `error.message` 提取 status code 等資訊（如 `match(/：(\d+)/)`），必須用 Error class 屬性（如 `EnhancerApiError.statusCode`）
- **❌ 在 lib 層使用 `useI18n()`** — `useI18n()` 只能在 Vue 元件 `<script setup>` 中使用，lib/store 層必須用 `i18n.global.t()`
- **❌ 新增翻譯鍵但不同步所有 locale 檔案** — 5 個 locale JSON 的 key 結構必須完全一致，新增鍵時必須同時更新所有檔案
- **❌ preset 模式下手動持久化 prompt 文字** — `promptMode` 為 `minimal` 或 `active` 時，prompt 由 `getAiPrompt()` 即時計算，禁止額外呼叫 `store.set("aiPrompt")`
- **❌ `refreshCrossWindowSettings` 中先算 prompt 再載 locale/promptMode** — 必須先載入 `selectedLocale` + `selectedTranscriptionLocale` + `promptMode`，再計算 `aiPrompt` fallback，否則 `getEffectivePromptLocale()` 會用到舊值
- **❌ 硬編碼模型 ID** — 模型 ID 必須從 `modelRegistry.ts` 的 type union（`LlmModelId` / `VocabularyAnalysisModelId` / `WhisperModelId`）取值，禁止字串硬編碼。新增/移除模型時必須同時更新 type、清單、預設值
- **❌ 忽略下架模型遷移** — 新模型取代舊模型時必須在 `DECOMMISSIONED_MODEL_MAP` 加入舊 ID → 新 ID 映射，否則舊版使用者升級後設定會 fallback 到預設而非指定替代
- **❌ 字典分析使用 enhancer 模型清單** — 字典分析（`vocabularyAnalyzer.ts`）和文字整理（`enhancer.ts`）使用完全獨立的模型清單（`VOCABULARY_ANALYSIS_MODEL_LIST` vs `LLM_MODEL_LIST`）和 ID 型別（`VocabularyAnalysisModelId` vs `LlmModelId`），不可混用
- **❌ abort 後未檢查 `isAborted` 繼續執行** — `handleStopRecording` / `handleRetryTranscription` 中每個 `await` 之後及外層 `catch` 必須加 `if (isAborted.value) return;`，否則 abort 引發的錯誤或舊結果會覆蓋 cancelled 狀態。`handleStartRecording` 的 `await invoke("start_recording")` 之後也需要檢查
- **❌ 使用 ESC（keycode 53 / VK 0x1B）作為 Custom trigger key** — ESC 已保留為全域中斷鍵，`keycodeMap.ts` 的 `getDangerousKeyWarning("Escape")` 回傳 null（不走 warning 路徑），由 `getEscapeReservedMessage()` 提供 hard block 錯誤訊息
- **❌ 重送成功時 INSERT 新 transcription 記錄** — 重送路徑必須使用 `completePasteFlow({ skipRecordSaving: true })` + `updateTranscriptionOnRetrySuccess()` UPDATE 現有 failed 記錄，禁止 INSERT（PK 衝突 + FK 787 錯誤）
- **❌ 重送的 API usage 不等 transcription UPDATE 完成** — `saveApiUsageRecordList` 必須串接在 `updateTranscriptionOnRetrySuccess().then()` 之後，確保 FK 依賴正確
- **❌ 在幻覺偵測中單獨依賴 NSP** — `noSpeechProbability` 不可靠（Whisper 對中文軟音常報高 NSP），只能搭配 peak + RMS 能量作為輔助信號（Layer 2b），不可單獨用於判斷
- **❌ 使用 peakEnergyLevel 判斷「有沒有人說話」** — peak 只反映瞬時最大振幅，背景噪音也能達到 0.15+。但 peak >= 0.03 可作為 Layer 2b 的 escape hatch，跳過 RMS+NSP 檢查避免小聲說話誤判

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
- **錯誤訊息本地化** — `src/lib/errorUtils.ts` 集中管理 i18n 錯誤訊息。`getMicrophoneErrorMessage()` 優先匹配 Rust `AudioRecorderError` 字串（`"No input device"` / `"Failed to build audio stream"` / `"Failed to get input config"`），fallback 到 `DOMException` 分支
- **自動更新失敗** — 背景檢查靜默處理，手動檢查回傳 `{ status: 'error', error: message }` 供 UI 顯示

#### 安全規則

- **CSP 硬限制** — `default-src 'self'; connect-src 'self' https://api.groq.com; media-src 'self' http://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'`
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

Last Updated: 2026-03-27 (v14 — 音量預覽系統：AudioPreviewState + dB 映射 + select_input_device 共用 helper + thread join cleanup + useAudioPreview composable + 預設裝置名稱顯示)
