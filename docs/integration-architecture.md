# Integration Architecture — Frontend ↔ Backend

> Tauri v2 multi-part desktop app · Vue 3 frontend ↔ Rust backend
> 同步來源：`CLAUDE.md` 的 IPC 契約表（authoritative） + `lib.rs:416` 的 `invoke_handler!` macro
> 掃描日期：2026-05-08 · 版本：0.9.5

本文件描述 SayIt 兩個 part 之間如何協作 — 是 PRD / 新功能設計時必讀的「邊界契約」。

---

## 一、整合形式總覽

SayIt 採典型 **Tauri 雙向 IPC 模式**，沒有外部 message broker，所有跨端通訊走兩條軌道：

```
 ┌─────────────────────────────────────────────────────────────┐
 │            Frontend Bundle（兩個獨立 entry）                │
 │                                                             │
 │   ┌──────────────────┐         ┌──────────────────────┐     │
 │   │   HUD WebView    │         │  Dashboard WebView   │     │
 │   │ index.html       │         │ main-window.html     │     │
 │   │ main.ts → App    │         │ main-window.ts → MainApp │ │
 │   │ label="main"     │         │ label="main-window"  │     │
 │   └────┬──────┬──────┘         └────┬──────┬──────────┘     │
 │        │      ▲                     │      ▲                │
 │        │ invoke()           emit/listen    │                │
 │        ▼      │                     ▼      │                │
 │  ─────────────────────  Tauri IPC Bus  ───────────────────  │
 │        │      ▲                     │      ▲                │
 │        ▼      │                     ▼      │                │
 │   ┌─────────────────────────────────────────────────────┐   │
 │   │                Tauri Backend (Rust)                 │   │
 │   │  lib.rs::run() invoke_handler! + plugin macros      │   │
 │   │  ┌──────────────┐  ┌──────────────────┐             │   │
 │   │  │ 8 plugins    │  │ 5 managed states │             │   │
 │   │  │ (.rs)        │  │ (Arc<Mutex>)     │             │   │
 │   │  └──────────────┘  └──────────────────┘             │   │
 │   └─────────────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────────────┘
```

**整合點分類**：

| 軌道                             | 方向              | 用途                                                                                |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| **Tauri Commands（invoke）**     | Frontend → Rust   | RPC 式同步呼叫，回傳 `Result<T, E>`。共 **34 個** command                          |
| **Tauri Events（emit/listen）**  | Rust → Frontend   | 系統推送（熱鍵、波形、品質監測）。共 **15 個** Rust→FE event                        |
| **Frontend-only Events**         | FE Window ↔ FE Window | HUD 與 Dashboard 跨視窗廣播（不經 Rust）。共 **5 個** FE-only event              |

---

## 二、Frontend 雙視窗的責任切分

| 視窗            | label          | HTML 入口             | TS 入口               | 大小      | 顯示策略                                            |
| --------------- | -------------- | --------------------- | --------------------- | --------- | --------------------------------------------------- |
| **HUD**         | `main`         | `index.html`          | `src/main.ts`         | 470×100   | 透明、無裝飾、永遠最上層、預設不顯示                |
| **Dashboard**   | `main-window`  | `main-window.html`    | `src/main-window.ts`  | 960×680（最小 720×480） | 標準視窗、預設隱藏，啟動後若無 API Key 才顯示 |

**狀態責任分割**：

- HUD 是「狀態浮窗」— 只負責顯示「目前在錄音 / 轉錄 / 整理 / 完成 / 失敗」，**沒有 DB 寫權**
- Dashboard 是「設定與歷史中心」— 擁有 DB migration 權、所有 CRUD 操作、autostart 控制

**DB 連線共享**（很重要）：

```
┌────────────────────────────────┐
│ Dashboard 啟動 (main-window.ts)│
│  ↓                             │
│  initializeDatabase()          │
│  → Database.load(...)          │
│  → 跑 migration v1→v8          │
│  → 設定 singleton db           │
└────────────┬───────────────────┘
             │
             ▼ tauri-plugin-sql 共用 connection pool
┌────────────────────────────────┐
│ HUD 啟動 (main.ts)             │
│  ↓                             │
│  connectToDatabase()           │
│  → Database.get(...)           │ ← 不重新 load！避免覆蓋 transaction context
│  → 用既有 pool                 │
└────────────────────────────────┘
```

> **為什麼 HUD 不能呼叫 `Database.load()`？** 因為 `tauri-plugin-sql` 的 Rust 端用 `HashMap.insert()` 覆蓋既有 Pool — 若 Dashboard 正在跑 migration，舊 pool 的 transaction context 會遺失，破壞性 DDL 失去 rollback 保護。

---

## 三、Tauri Commands（Frontend → Rust）

> 完整列表見 `CLAUDE.md` 「IPC 契約表」。本節按「業務語意」分組，並標出 frontend 主要呼叫點。

### 3.1 系統與生命週期

| Command                        | 模組          | 主要呼叫點                                            | 用途                              |
| ------------------------------ | ------------- | ----------------------------------------------------- | --------------------------------- |
| `debug_log`                    | `lib.rs`      | stores、`main-window.ts`                              | webview 統一 log channel          |
| `request_app_restart`          | `lib.rs`      | `main-window.ts`（自動更新後）                        | 自行 spawn 新 process（見 §6.1） |
| `get_hud_target_position`      | `lib.rs`      | NotchHud（多螢幕追蹤）                                | 取得 HUD 應定位的 logical 座標    |

### 3.2 熱鍵（10 個）

| Command                                  | 來源                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `update_hotkey_config`                   | `useSettingsStore`                                    |
| `check_accessibility_permission_command` | `AccessibilityGuide.vue`                              |
| `open_accessibility_settings`            | `AccessibilityGuide.vue`                              |
| `reinitialize_hotkey_listener`           | `AccessibilityGuide.vue`                              |
| `reset_hotkey_state`                     | `useVoiceFlowStore`                                   |
| `start_hotkey_recording`                 | `SettingsView`                                        |
| `cancel_hotkey_recording`                | `SettingsView`                                        |

### 3.3 音訊（11 個）

| Command                          | 場景                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `start_recording` / `stop_recording`           | 觸發 / 停止錄音（核心 voice flow）                   |
| `save_recording_file`            | 完成轉錄後另存錄音檔（給 retranscribe 用）            |
| `read_recording_file`            | HistoryView 播放歷史錄音（IPC binary response）       |
| `delete_all_recordings` / `cleanup_old_recordings` | SettingsView 與啟動自動清理                       |
| `start_audio_preview` / `stop_audio_preview`   | SettingsView 音量條                                  |
| `get_default_input_device_name`  | SettingsView 顯示當前裝置                             |
| `list_audio_input_devices`       | SettingsView 切換麥克風                               |

### 3.4 系統音量

| Command                | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `mute_system_audio`    | 錄音前靜音系統音訊（避免回授）             |
| `restore_system_audio` | 結束錄音後還原                             |

> ⚠️ **Graceful shutdown 順序敏感**：`lib.rs:529 RunEvent::Exit` 必須先呼叫 `audio_control.shutdown()` 還原音量，否則 app 結束後系統會永遠靜音。

### 3.5 剪貼簿與貼上

| Command                  | 平台實作                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `paste_text`             | macOS：`simulate_paste_via_cgevent()`；Windows：`SendInput Ctrl+V` |
| `copy_to_clipboard`      | 跨平台 `arboard`                                                    |
| `capture_target_window`  | 紀錄錄音前焦點視窗（macOS）                                         |

### 3.6 文字場讀取（macOS only）

| Command                  | 用途                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `read_focused_text_field`| 取游標所在輸入框內容（給 Edit Mode）                            |
| `read_selected_text`     | 取選取文字（給 Edit Mode）— 已知問題：Fn 按住期間可能輸入 "c"  |

### 3.7 鍵盤監測

| Command                     | 觸發時機                                              |
| --------------------------- | ----------------------------------------------------- |
| `start_quality_monitor`     | 貼上後監測使用者是否大幅修改（驅動 hallucination 偵測） |
| `start_correction_monitor`  | 監測使用者修正動作（驅動智慧字典學習）                |

### 3.8 LLM 與轉錄

| Command                  | 用途                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| `transcribe_audio`       | Rust 直接呼叫 Groq Whisper（繞過前端 fetch）                              |
| `retranscribe_from_file` | HistoryView 對歷史錄音重新轉錄                                            |

### 3.9 音效回饋

`play_start_sound` / `play_stop_sound` / `play_error_sound` / `play_learned_sound` — `cpal` 播放 `resources/sounds/*.wav`。

---

## 四、Rust → Frontend Events（15 個）

### 4.1 熱鍵類

| Event                          | Payload                       | 訂閱者                         |
| ------------------------------ | ----------------------------- | ------------------------------ |
| `hotkey:pressed`               | —                             | useVoiceFlowStore              |
| `hotkey:released`              | —                             | useVoiceFlowStore              |
| `hotkey:toggled`               | `HotkeyEventPayload`          | useVoiceFlowStore              |
| `hotkey:error`                 | `HotkeyErrorPayload`          | useVoiceFlowStore              |
| `hotkey:mode-toggle`           | `()`                          | useVoiceFlowStore              |
| `escape:pressed`               | `()`                          | useVoiceFlowStore（全域中止）   |
| `hotkey:recording-captured`    | `RecordingCapturedPayload`    | SettingsView 熱鍵設定          |
| `hotkey:recording-rejected`    | `RecordingRejectedPayload`    | SettingsView 熱鍵設定          |

### 4.2 鍵盤監測類

| Event                       | Payload                          | 訂閱者              |
| --------------------------- | -------------------------------- | ------------------- |
| `quality-monitor:result`    | `QualityMonitorResultPayload`    | useVoiceFlowStore   |
| `correction-monitor:result` | `CorrectionMonitorResultPayload` | useVoiceFlowStore   |

### 4.3 音訊類

| Event                  | Payload                                  | 訂閱者                |
| ---------------------- | ---------------------------------------- | --------------------- |
| `audio:waveform`       | `WaveformPayload { levels: [f32; 6] }`   | useAudioWaveform → HUD |
| `audio:preview-level`  | `AudioPreviewLevelPayload { level: f32 }`| useAudioPreview → SettingsView |

### 4.4 設計準則

- 所有 event 名稱常數**集中在 `src/composables/useTauriEvents.ts`**（27 行）— 禁止散落到各檔案
- Rust 端發送點以 const 字串集中於 `hotkey_listener.rs` / `keyboard_monitor.rs` / `audio_recorder.rs` 的 mod 頂部
- Payload 型別後綴一律 `*Payload`（型別命名規範）

---

## 五、Frontend-only Events（5 個）

> 不經 Rust，純 webview 內 / 跨 webview 廣播。常數定義同樣集中在 `useTauriEvents.ts`。

| Event                          | 發送方             | 接收方                |
| ------------------------------ | ------------------ | --------------------- |
| `voice-flow:state-changed`     | HUD VoiceFlow      | Dashboard             |
| `transcription:completed`      | VoiceFlow          | Main Window           |
| `settings:updated`             | useSettingsStore   | All Windows           |
| `vocabulary:changed`           | useVocabularyStore | All Windows           |
| `vocabulary:learned`           | useVoiceFlowStore  | HUD NotchHud          |

> 跨視窗廣播使用 `emitTo("main-window", ...)` 或 `emitTo("main", ...)`；自視窗用 `emit(...)`。

---

## 六、生命週期與資源管理

### 6.1 啟動順序

```
1. Rust: tauri::Builder::default()
   ├── plugin: tauri_plugin_single_instance.init(callback)
   │   └── 第二次啟動時觸發 callback → show_main_window(app)
   ├── plugin: shell, http, sql, store, autostart, updater, process
   ├── plugin: hotkey_listener (custom)
   ├── invoke_handler! 註冊 34 個 command
   ├── setup(|app|) 初始化 5 個 managed state
   └── 載入 tray icon + 配置視窗 level（macOS=27 / Windows=TOPMOST）

2. Frontend HUD：main.ts → initSentryForHud → mount
3. Frontend Dashboard：main-window.ts → initSentryForDashboard
   → initializeDatabase（migration v1→v8）
   → settingsStore.loadSettings + initializeAutoStart
   → 若缺 API Key：強制顯示視窗並導向 /settings
   → 背景：cleanup_old_recordings（不阻斷啟動）
```

### 6.2 結束順序（`RunEvent::Exit`，`lib.rs:529`）

順序敏感，必須這樣排：

```
1. audio_control.shutdown()      ← 還原系統音量（避免永久靜音）
2. audio_preview.shutdown()      ← 在 cpal 之前（避免兩者同時釋放裝置）
3. audio_recorder.shutdown()     ← join thread, drop AudioUnit
4. keyboard_monitor.shutdown()   ← 取消 CGEventTap
5. hotkey_listener.shutdown()    ← 取消 CGEventTap
6. sleep 200ms                    ← 等待背景 thread 清理
7. sentry.client.flush(2s)        ← Flush 事件佇列
8. 若 RESTART_REQUESTED：spawn 新 process
9. _exit(0)                       ← 截殺 Tauri 內建邏輯
```

### 6.3 Single-instance（v0.9.5 跨平台統一）

`tauri-plugin-single-instance`：第二次啟動 .exe / .app 時，原 process 接到 callback 把 Dashboard 拉到前景，新 process 直接退出。**Windows 特別需要**（macOS 有 Launch Services 守門但 dev mode 仍需此保險）。

---

## 七、外部 API 整合

```
┌──────────────────────────────┐
│   Rust Backend               │     reqwest (multipart, json)
│   transcription.rs           │ ───────────────────────────────► Groq Whisper API
│                              │                                  /v1/audio/transcriptions
└──────────────────────────────┘                                  whisper-large-v3 / -turbo

┌──────────────────────────────┐
│   Frontend (Dashboard)       │     @tauri-apps/plugin-http
│   src/lib/llmProvider.ts     │ ───────────────────────────────► Groq / Gemini / OpenAI / Anthropic
│   buildFetchParams()         │                                  /chat/completions（或對應端點）
│   parseProviderResponse()    │
└──────────────────────────────┘
```

**Provider 抽象層的職責**：

- `buildFetchParams()` — 把通用 messages 轉成各 provider 的 body / header（OpenAI `max_completion_tokens`、Anthropic `system` 頂層欄位、Gemini `system_instruction` + URL 內 model 名稱）
- `parseProviderResponse()` — Gemini 額外檢查 `finishReason`，非 `STOP`/`MAX_TOKENS` 時拋錯（避免 SAFETY 過濾靜默 fallback）

**CSP 與 capabilities 的差異**（⚠️ **見驗證報告**）：

- `capabilities/default.json` 已開放四家 (Groq / OpenAI / Anthropic / Gemini)
- 但 `tauri.conf.json` 的 `connect-src` CSP 只列 Groq / Gemini

---

## 八、整合風險與已知一致性問題

| 問題                                                          | 影響                                                       | 建議                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| ⚠️ CSP 缺少 `https://api.openai.com` / `https://api.anthropic.com`（`tauri.conf.json:51`） | 切到 OpenAI / Anthropic provider 在 production build 可能被 CSP 阻擋（dev mode 不受影響） | 用 `pnpm tauri build --debug` 實測 OpenAI / Anthropic 端對端 |
| `text_field_reader::read_selected_text` 在 Fn 按住時觸發會輸入 "c" | Edit Mode 偶發誤輸入                                       | 已記錄於 GitHub #25                                 |
| `addApiUsage(whisper/chat)` 偶發 `FOREIGN KEY constraint failed` (787) | 統計資料寫入失敗，不影響核心轉錄                           | 待調查（可能是 transcription 與 api_usage 的 race） |
| 非預設音訊裝置切換時 cpal 0.15.3 macOS Arc cycle               | 每次切換洩漏 ~1-2 KB                                       | 上游修復待 cpal 0.16+                               |

---

## 九、為新功能設計時的決策樹

```
新功能要新增什麼？
│
├── 純 UI / 設定 / 顯示
│   └─ 改 src/views/ + src/stores/ + src/components/ → 不需動 Rust
│
├── 需要存取系統資源（OS API、檔案、視窗操作）
│   └─ 1. 在 src-tauri/src/plugins/ 新增模組或擴充現有 plugin
│      2. 在 lib.rs invoke_handler! 註冊
│      3. 在 useTauriEvents.ts 新增 event 常數（若有事件）
│      4. 用 tauri-reviewer subagent 審查兩端對齊
│
├── 需要新 LLM Provider
│   └─ 改 src/lib/llmProvider.ts 與 modelRegistry.ts → 不需動業務層
│
├── 需要新 DB 欄位
│   └─ database.ts 追加 migration v9（不要改舊 migration）
│
└── 需要跨視窗同步狀態
    └─ 在 useTauriEvents.ts 新增 frontend-only event 常數
       發送方 emit；接收方 listen
```
