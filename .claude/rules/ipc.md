---
paths:
  - src-tauri/**
  - src/composables/useTauriEvents.ts
  - src/types/events.ts
---

# IPC 契約（Rust ↔ Vue）

> 2026-09-11 自 `CLAUDE.md` 搬入，內容未改。改 command／event 時同步更新本表，並用 `tauri-reviewer` subagent 審雙端一致性。新增 command 的步驟見 `docs/development-guide.md` §4.2。

## Tauri Commands（Frontend → Rust）

| Command | Rust 位置 | 前端呼叫點 | 參數 | 回傳 |
|---------|-----------|-----------|------|------|
| `set_file_logging_enabled` | `plugins/logging.rs` | useSettingsStore（logger.ts） | `enabled: bool, app: AppHandle` | `Result<(), String>`（關閉時清掉記錄檔） |
| `open_log_folder` | `plugins/logging.rs` | useSettingsStore（logger.ts） | `app: AppHandle` | `Result<(), String>` |
| `request_app_restart` | `lib.rs` | main-window.ts | — | `()` |
| `update_hotkey_config` | `lib.rs` | useSettingsStore | `trigger_key: TriggerKey, trigger_mode: TriggerMode` | `Result<(), String>` |
| `get_hud_target_position` | `lib.rs` | — | `app: AppHandle` | `Result<HudTargetPosition, String>` |
| `get_os_theme` | `lib.rs` | lib/theme.ts | — | `Option<String>`（`"dark"` \| `"light"`，非 Windows 回 `null`） |
| `paste_text` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | `text: String` | `Result<(), ClipboardError>` |
| `copy_to_clipboard` | `plugins/clipboard_paste.rs` | HistoryView | `text: String` | `Result<(), ClipboardError>` |
| `capture_target_window` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | — | `()` |
| `check_accessibility_permission_command` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `bool` |
| `open_accessibility_settings` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `Result<(), String>` |
| `reinitialize_hotkey_listener` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | `app: AppHandle` | `Result<(), String>` |
| `reset_hotkey_state` | `plugins/hotkey_listener.rs` | useVoiceFlowStore | `state: State<HotkeyListenerState>` | `()` |
| `start_quality_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `start_correction_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `read_focused_text_field` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selected_text` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selection_state` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `SelectionState { kind, text }` |
| `mute_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `restore_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `get_default_input_device_name` | `plugins/audio_recorder.rs` | SettingsView | — | `Option<String>` |
| `list_audio_input_devices` | `plugins/audio_recorder.rs` | SettingsView | — | `Vec<AudioInputDeviceInfo>` |
| `start_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `app: AppHandle, preview_state: State<AudioPreviewState>, device_name: String` | `Result<(), String>` |
| `stop_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `preview_state: State<AudioPreviewState>` | `()` |
| `start_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `app: AppHandle, state: State<AudioRecorderState>, device_name: String` | `Result<(), AudioRecorderError>` |
| `stop_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>` | `Result<StopRecordingResult, AudioRecorderError>` |
| `save_recording_file` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `id: String, app: AppHandle, state: State<AudioRecorderState>` | `Result<String, String>` |
| `read_recording_file` | `plugins/audio_recorder.rs` | HistoryView | `id: String, app: AppHandle` | `Result<Response, String>` |
| `delete_all_recordings` | `plugins/audio_recorder.rs` | SettingsView | `app: AppHandle` | `Result<u32, String>` |
| `cleanup_old_recordings` | `plugins/audio_recorder.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `transcribe_audio` | `plugins/transcription.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>, transcription_state: State<TranscriptionState>, api_key: String, vocabulary_term_list: Option<Vec<String>>, model_id: Option<String>, language: Option<String>` | `Result<TranscriptionResult, TranscriptionError>` |
| `retranscribe_from_file` | `plugins/transcription.rs` | useVoiceFlowStore | `path: String, api_key: String, vocabulary_term_list: Option<Vec<String>>, model_id: Option<String>, language: Option<String>` | `Result<TranscriptionResult, TranscriptionError>` |
| `play_start_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_stop_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_error_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_learned_sound` | `plugins/sound_feedback.rs` | NotchHud.vue | — | `()` |
| `start_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `cancel_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |

## Rust → Frontend Events

| Event | Rust 發送點 | 常量 | Payload |
|-------|------------|------|---------|
| `hotkey:pressed` | hotkey_listener.rs | `HOTKEY_PRESSED` | — |
| `hotkey:released` | hotkey_listener.rs | `HOTKEY_RELEASED` | — |
| `hotkey:toggled` | hotkey_listener.rs | `HOTKEY_TOGGLED` | `HotkeyEventPayload` |
| `hotkey:error` | hotkey_listener.rs | `HOTKEY_ERROR` | `HotkeyErrorPayload` |
| `hotkey:mode-toggle` | hotkey_listener.rs | `HOTKEY_MODE_TOGGLE` | `()` |
| `escape:pressed` | hotkey_listener.rs | `ESCAPE_PRESSED` | `()` |
| `hotkey:recording-captured` | hotkey_listener.rs | `HOTKEY_RECORDING_CAPTURED` | `RecordingCapturedPayload` |
| `hotkey:recording-rejected` | hotkey_listener.rs | `HOTKEY_RECORDING_REJECTED` | `RecordingRejectedPayload` |
| `quality-monitor:result` | keyboard_monitor.rs | `QUALITY_MONITOR_RESULT` | `QualityMonitorResultPayload` |
| `correction-monitor:result` | keyboard_monitor.rs | `CORRECTION_MONITOR_RESULT` | `CorrectionMonitorResultPayload` |
| `theme:os-changed` | lib.rs（Windows 輪詢登錄檔） | `THEME_OS_CHANGED` | `"dark"` \| `"light"` |
| `audio:waveform` | audio_recorder.rs | `AUDIO_WAVEFORM` | `WaveformPayload { levels: [f32; 6] }` |
| `audio:preview-level` | audio_recorder.rs | `AUDIO_PREVIEW_LEVEL` | `AudioPreviewLevelPayload { level: f32 }` |

## Frontend-only Events（不經 Rust）

| Event | 常量 | 發送方 | 接收方 |
|-------|------|--------|--------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD VoiceFlow | Dashboard |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | VoiceFlow | Main Window |
| `settings:updated` | `SETTINGS_UPDATED` | SettingsStore | All Windows |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | VocabularyStore | All Windows |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore | HUD NotchHud |

## 規則

- **❌ 直接 import Tauri event API** → 一律經 `useTauriEvents.ts` 封裝；事件 payload 型別以 `*Payload` 後綴放 `src/types/events.ts`
- Rust 端不要 panic，回 `Result<T, E>` 或 `Result<T, String>`；平台特化用 `#[cfg(target_os = "...")]`
- API Key 只走參數傳入 Rust、不落 SQLite 也不落日誌

## Tauri v2 macOS 注意事項

- **IPC binary response**：`tauri::ipc::Response` raw bytes 在 macOS 走 JSON 序列化（`number[]`），非 `ArrayBuffer`。前端必須用 `new Uint8Array(raw)` 轉換
- **CSP 與 asset protocol**：`convertFileSrc` 在 macOS 產生 `asset://localhost/` URL，但 CSP `media-src` 需要 `http://asset.localhost`。Dev mode 不受 CSP 影響，production build 會被阻擋。偏好使用 Rust IPC + Blob URL 繞過
- **Dev vs Production 差異**：`pnpm tauri dev` 從 Vite dev server 載入，CSP 行為不同。安全性相關功能必須用 `pnpm tauri build --debug` 測試

## Subagent

- **tauri-reviewer** — 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別）；改 IPC 後 commit 前必跑
