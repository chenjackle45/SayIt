# API Contracts — Backend (Tauri)

> Frontend → Rust 的 Tauri Commands · Rust → Frontend 的 Tauri Events
> 掃描日期：2026-05-08 · 版本：0.9.5
> Authoritative source：`src-tauri/src/lib.rs:416-452` 的 `invoke_handler!` macro + `CLAUDE.md` IPC 契約表

---

## 一、契約總覽

| 軌道                       | 數量    | 來源                                                                        |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| Tauri Commands             | **34**  | `lib.rs::run()` 的 `invoke_handler!` macro                                  |
| Rust → Frontend Events     | **15**  | 各 plugin 模組頂部的 `pub const` 字串                                        |
| Frontend-only Events       | **5**   | `src/composables/useTauriEvents.ts`                                         |

> 所有 event 名稱常數在前端**只能**從 `useTauriEvents.ts` import；Rust 端定義在各 plugin 模組頂部。新增時兩端必須對齊（用 `tauri-reviewer` subagent 審查）。

---

## 二、Tauri Commands

格式：`fn(params) -> ReturnType`，所有 command 由 frontend `invoke('name', { params })` 呼叫。

### 2.1 系統與生命週期（3 個）

#### `debug_log`
```ts
invoke('debug_log', { level: 'info'|'warn'|'error', message: string }) → void
```
- **Rust 位置**：`lib.rs:91`
- **用途**：webview console.log 統一導向 Rust stdout/stderr（方便 production 用 `Console.app` / Windows ETW 追問題）

#### `request_app_restart`
```ts
invoke('request_app_restart') → void
```
- **Rust 位置**：`lib.rs:84`
- **用途**：自動更新後重啟 app（內部設 RESTART_REQUESTED 旗標 + `app.exit(0)`）

#### `get_hud_target_position`
```ts
invoke('get_hud_target_position') → { x: number, y: number, monitorKey: string }
```
- **Rust 位置**：`lib.rs:296`
- **用途**：HUD 多螢幕追蹤（取得游標所在螢幕的 logical 中心位置）
- **錯誤**：若 `app.available_monitors()` 失敗或無螢幕 → `Result::Err(String)`

### 2.2 熱鍵（7 個 · `plugins/hotkey_listener.rs`）

| Command                                  | 簽名                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `update_hotkey_config`                   | `(trigger_key, trigger_mode) → Result<(), String>`                     |
| `check_accessibility_permission_command` | `() → bool`（macOS only，Windows 永遠回 true）                         |
| `open_accessibility_settings`            | `() → Result<(), String>`                                              |
| `reinitialize_hotkey_listener`           | `(app: AppHandle) → Result<(), String>`                                |
| `reset_hotkey_state`                     | `(state: State<HotkeyListenerState>) → ()`                             |
| `start_hotkey_recording`                 | `(state) → ()`                                                         |
| `cancel_hotkey_recording`                | `(state) → ()`                                                         |

**型別**：
- `TriggerKey` = `'fn' | 'control' | 'option' | 'command' | { combo: string[] }`
- `TriggerMode` = `'hold' | 'toggle'`

### 2.3 音訊（11 個 · `plugins/audio_recorder.rs`）

| Command                              | 簽名                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `get_default_input_device_name`      | `() → Option<String>`                                                                                              |
| `list_audio_input_devices`           | `() → Vec<AudioInputDeviceInfo>`                                                                                   |
| `start_audio_preview`                | `(app, preview_state, device_name) → Result<(), String>`                                                          |
| `stop_audio_preview`                 | `(preview_state) → ()`                                                                                             |
| `start_recording`                    | `(app, state, device_name) → Result<(), AudioRecorderError>`                                                      |
| `stop_recording`                     | `(state) → Result<StopRecordingResult, AudioRecorderError>`                                                       |
| `save_recording_file`                | `(id, app, state) → Result<String, String>` （回傳檔案路徑）                                                      |
| `read_recording_file`                | `(id, app) → Result<Response, String>` （**IPC binary response**，macOS 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換） |
| `delete_all_recordings`              | `(app) → Result<u32, String>`                                                                                      |
| `cleanup_old_recordings`             | `(days, app) → Result<Vec<String>, String>` （回傳已刪檔的 id list）                                              |

**型別**：
- `AudioInputDeviceInfo = { name: string, isDefault: boolean }`
- `StopRecordingResult = { audioBufferId: string, durationMs: number, sampleRate: number }`
- `AudioRecorderError`（thiserror enum，serialize 為 string）

### 2.4 系統音量（2 個 · `plugins/audio_control.rs`）

```ts
invoke('mute_system_audio')    → Result<(), String>
invoke('restore_system_audio') → Result<(), String>
```

**順序敏感**：必須在錄音前 mute、錄音後立刻 restore；shutdown 時也必須最先還原（見 `architecture-backend.md` §RunEvent::Exit）

### 2.5 剪貼簿與貼上（3 個 · `plugins/clipboard_paste.rs`）

| Command                  | 簽名                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `paste_text`             | `(text: string) → Result<(), ClipboardError>`              |
| `copy_to_clipboard`      | `(text: string) → Result<(), ClipboardError>`              |
| `capture_target_window`  | `() → ()`                                                  |

### 2.6 鍵盤監測（2 個 · `plugins/keyboard_monitor.rs`）

```ts
invoke('start_quality_monitor', { app: AppHandle })    → void
invoke('start_correction_monitor', { app: AppHandle }) → void
```

### 2.7 文字場讀取（2 個 · `plugins/text_field_reader.rs`，macOS only）

```ts
invoke('read_focused_text_field') → Result<string | null, string>
invoke('read_selected_text')      → Result<string | null, string>
```

### 2.8 LLM / 轉錄（2 個 · `plugins/transcription.rs`）

#### `transcribe_audio`
```ts
invoke('transcribe_audio', {
  api_key: string,
  vocabulary_term_list?: string[],
  model_id?: string,        // 預設 'whisper-large-v3'
  language?: string | null, // null = Whisper 自動偵測；undefined → Rust fallback 'zh'
}) → Result<TranscriptionResult, TranscriptionError>
```

#### `retranscribe_from_file`
```ts
invoke('retranscribe_from_file', {
  path: string,
  api_key: string,
  vocabulary_term_list?: string[],
  model_id?: string,
  language?: string | null,
}) → Result<TranscriptionResult, TranscriptionError>
```

**型別**：
- `TranscriptionResult = { text: string, durationMs: number, ... }`
- `TranscriptionError`（thiserror enum）

### 2.9 音效回饋（4 個 · `plugins/sound_feedback.rs`）

```ts
invoke('play_start_sound')    → void
invoke('play_stop_sound')     → void
invoke('play_error_sound')    → void
invoke('play_learned_sound')  → void
```

---

## 三、Rust → Frontend Events（15 個）

> 所有 payload 介面定義於 `src/types/events.ts`（後綴 `*Payload`）。

### 3.1 熱鍵類（8 個 · `plugins/hotkey_listener.rs`）

| Event                          | 常量名                          | Payload                          |
| ------------------------------ | ------------------------------- | -------------------------------- |
| `hotkey:pressed`               | `HOTKEY_PRESSED`                | —                                |
| `hotkey:released`              | `HOTKEY_RELEASED`               | —                                |
| `hotkey:toggled`               | `HOTKEY_TOGGLED`                | `HotkeyEventPayload`             |
| `hotkey:error`                 | `HOTKEY_ERROR`                  | `HotkeyErrorPayload`             |
| `hotkey:mode-toggle`           | `HOTKEY_MODE_TOGGLE`            | `()`                             |
| `escape:pressed`               | `ESCAPE_PRESSED`                | `()`                             |
| `hotkey:recording-captured`    | `HOTKEY_RECORDING_CAPTURED`     | `RecordingCapturedPayload`       |
| `hotkey:recording-rejected`    | `HOTKEY_RECORDING_REJECTED`     | `RecordingRejectedPayload`       |

### 3.2 鍵盤監測類（2 個 · `plugins/keyboard_monitor.rs`）

| Event                       | 常量名                              | Payload                            |
| --------------------------- | ----------------------------------- | ---------------------------------- |
| `quality-monitor:result`    | `QUALITY_MONITOR_RESULT`            | `QualityMonitorResultPayload`      |
| `correction-monitor:result` | `CORRECTION_MONITOR_RESULT`         | `CorrectionMonitorResultPayload`   |

### 3.3 音訊類（2 個 · `plugins/audio_recorder.rs`）

| Event                  | 常量名                       | Payload                                           |
| ---------------------- | ---------------------------- | ------------------------------------------------- |
| `audio:waveform`       | `AUDIO_WAVEFORM`             | `WaveformPayload { levels: [f32; 6] }`            |
| `audio:preview-level`  | `AUDIO_PREVIEW_LEVEL`        | `AudioPreviewLevelPayload { level: f32 }`         |

---

## 四、Frontend-only Events（5 個 · 不經 Rust）

| Event                          | 常量名                          | 發送方             | 接收方             |
| ------------------------------ | ------------------------------- | ------------------ | ------------------ |
| `voice-flow:state-changed`     | `VOICE_FLOW_STATE_CHANGED`      | HUD VoiceFlow      | Dashboard          |
| `transcription:completed`      | `TRANSCRIPTION_COMPLETED`       | VoiceFlow          | Main Window        |
| `settings:updated`             | `SETTINGS_UPDATED`              | useSettingsStore   | All Windows        |
| `vocabulary:changed`           | `VOCABULARY_CHANGED`            | useVocabularyStore | All Windows        |
| `vocabulary:learned`           | `VOCABULARY_LEARNED`            | useVoiceFlowStore  | HUD NotchHud       |

---

## 五、Permissions Mapping（`capabilities/default.json`）

Tauri v2 採 capability-based permission 系統，Frontend 只能呼叫已授權的 command：

| 來源        | 必要 permissions（節錄）                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 視窗操作    | `core:window:allow-show`、`allow-hide`、`allow-set-position`、`allow-set-focus`、`allow-set-ignore-cursor-events`、`allow-start-dragging`、`allow-center` |
| 事件        | `core:event:allow-listen`、`allow-emit`、`allow-emit-to`                                                 |
| Shell       | `shell:allow-open`（用於開系統設定）                                                                    |
| SQL         | `sql:default`、`sql:allow-execute`                                                                       |
| Store       | `store:default`                                                                                          |
| HTTP        | `http:default` 開放：`api.groq.com/*`、`api.openai.com/*`、`api.anthropic.com/*`、`generativelanguage.googleapis.com/*` |
| Autostart   | `autostart:default`                                                                                      |
| Updater     | `updater:default`                                                                                        |
| Process     | `process:default`                                                                                        |

> **⚠️ 一致性差異**：`http:default` 已開放四家 LLM API，但 `tauri.conf.json` CSP `connect-src` 只列 Groq + Gemini，**缺 OpenAI / Anthropic**。使用者切到這兩家在 production build 可能被 CSP 攔截（dev mode 不受影響）。

---

## 六、外部 API 契約（節選）

### 6.1 Groq Whisper（Rust 直呼）

```
POST https://api.groq.com/openai/v1/audio/transcriptions
  multipart/form-data:
    file: <wav binary>
    model: whisper-large-v3 | whisper-large-v3-turbo
    language: zh | en | ja | ko | ...（或省略 = auto）
    prompt: <vocabulary terms joined>
  Authorization: Bearer <api_key>
```

### 6.2 LLM Provider（Frontend 透過 `@tauri-apps/plugin-http`）

| Provider   | Endpoint                                                                                | Auth Header                       | Body 特例                                                |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| Groq       | `https://api.groq.com/openai/v1/chat/completions`                                       | `Authorization: Bearer ...`       | OpenAI 風格                                              |
| OpenAI     | `https://api.openai.com/v1/chat/completions`                                            | `Authorization: Bearer ...`       | 用 `max_completion_tokens`，**非** `max_tokens`          |
| Anthropic  | `https://api.anthropic.com/v1/messages`                                                 | `x-api-key: ...` + `anthropic-version: 2023-06-01` | system message 提取至頂層 `system` 欄位       |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`       | `x-goog-api-key: ...`             | model 在 URL；user/assistant 在 `contents[].parts[].text`；assistant role → `"model"`；config 用 `generationConfig.maxOutputTokens` |

**Gemini finishReason 檢查**：`parseGeminiResponse` 會檢查 `candidates[0].finishReason`，非 `STOP`/`MAX_TOKENS`（如 `SAFETY`、`RECITATION`）拋錯，避免安全過濾靜默 fallback。

---

## 七、新增 Command / Event 的 Checklist

```
□ Rust 端
  ├─ 寫 #[command] 函式（確認回傳 Result 而非 panic）
  ├─ 在 plugins/<module>.rs（或 lib.rs）內定義
  ├─ 在 lib.rs::run() 的 invoke_handler! 註冊（lib.rs:416）
  └─ 若是 event，在 plugin 模組頂部加 pub const NAME = "..."

□ Frontend 端
  ├─ 在 src/types/events.ts 新增 *Payload 介面
  ├─ 在 src/composables/useTauriEvents.ts 加 export const
  ├─ 在 store / view 內 import 常數使用（不可直接 import @tauri-apps/api/event）
  └─ 若 command 用到，可加型別別名於 src/types/

□ 文件
  ├─ 更新 CLAUDE.md IPC 契約表
  ├─ 更新 docs/api-contracts-backend.md
  └─ 用 tauri-reviewer subagent 審查兩端對齊
```
