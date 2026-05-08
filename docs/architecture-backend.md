# Architecture — Backend Part

> Tauri v2 Rust runtime · macOS Private API + Windows Win32
> 掃描日期：2026-05-08 · 版本：0.9.5 · part_id: `backend` · root: `src-tauri/`

---

## 一、Executive Summary

SayIt backend 是一個 **Tauri v2 Rust runtime**，扮演四個角色：

1. **WebView 容器與視窗管理** — 載入兩個 webview（HUD + Dashboard），配置 macOS 瀏海覆蓋層級 / Windows TOPMOST
2. **System integration broker** — 全域熱鍵、剪貼簿模擬貼上、系統音量控制、AX API 文字場讀取
3. **音訊管線** — cpal 錄音、WAV 寫檔、FFT 波形分析、檔案管理（含自動清理）
4. **轉錄客戶端** — Rust 直接呼叫 Groq Whisper API（繞過前端 fetch）

整個 binary 大小靠 release profile（`panic=abort`、`lto=true`、`opt-level=s`、`strip=true`、`codegen-units=1`）壓到最小。

---

## 二、Technology Stack

| 類別               | 套件                  | 版本    | 用途                                                |
| ------------------ | --------------------- | ------- | --------------------------------------------------- |
| Framework          | tauri                 | 2       | features: tray-icon, macos-private-api, image-png, protocol-asset |
| Edition            | Rust                  | 2021    | stable toolchain                                    |
| Plugins            | shell, http, sql (sqlite), store, autostart, updater, process, single-instance | 2.x | 全部官方 plugin |
| Telemetry          | sentry                | 0.46    | guard 模式，environment / DSN 用 env 驅動           |
| 音訊               | cpal                  | 0.15    | 跨平台輸入裝置（macOS Arc cycle workaround）        |
| 音訊編碼           | hound                 | 3.5     | WAV writer                                          |
| 音訊分析           | rustfft               | 6       | FFT 波形                                            |
| HTTP               | reqwest               | 0.12    | features: multipart, json（Whisper API）            |
| 剪貼簿             | arboard               | 3       | 跨平台讀寫剪貼簿                                    |
| 序列化             | serde + serde_json    | 1       | derive macro                                        |
| 錯誤               | thiserror             | 2       | 結構化錯誤型別                                      |
| **macOS only**     | core-graphics         | 0.24    | CGEventTap、CGEvent                                 |
|                    | core-foundation       | 0.10    | CFRelease                                           |
|                    | objc                  | 0.2     | NSWindow private API（setLevel:、collectionBehavior） |
|                    | （原生 FFI）          | —       | CoreAudio AudioObjectGet/SetPropertyData（系統音量） |
| **Windows only**   | windows               | 0.61    | Win32：foundation、WindowsAndMessaging、KeyboardAndMouse、Audio、Audio_Endpoints、Com、Threading |

---

## 三、Architecture Pattern：「lib.rs 中央註冊 + plugins/ 平面模組」

```
┌──────────────────────────────────────────────────────────┐
│                       lib.rs (892 LOC)                   │
│                                                          │
│   pub fn run() {                                         │
│     sentry::init(...)                                    │
│     tauri::Builder::default()                            │
│       .plugin(single_instance, shell, http, sql, ...)    │
│       .plugin(plugins::hotkey_listener::init())          │
│       .invoke_handler(generate_handler![ 34 commands ])  │
│       .setup(|app| {                                     │
│           app.manage(KeyboardMonitorState::new());       │
│           app.manage(AudioControlState::new());          │
│           app.manage(FocusState::new());                 │
│           app.manage(AudioRecorderState::new());         │
│           app.manage(AudioPreviewState::new());          │
│           app.manage(TranscriptionState::new());         │
│           // tray + window config                        │
│       })                                                 │
│       .on_window_event(close → hide)                     │
│       .build().run(|_, RunEvent::Exit| {                 │
│           graceful_shutdown_in_order();                  │
│           _exit(0);                                      │
│       })                                                 │
│   }                                                      │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────┐
        │            plugins/ (8 個模組)          │
        │  hotkey_listener   audio_recorder       │
        │  keyboard_monitor  clipboard_paste      │
        │  audio_control     transcription        │
        │  text_field_reader sound_feedback       │
        └─────────────────────────────────────────┘
```

**模組組織邏輯**：

- `plugins/mod.rs` 只有 8 行 — 純 `pub mod xxx;` 宣告，**不做 facade**
- 每個模組自包含：state struct + commands + helper functions + tests
- `hotkey_listener` 是唯一以 Tauri plugin 形式註冊（透過 `init()`），其他都是 `invoke_handler!` 直接列出

---

## 四、Plugin Module 詳細

### 4.1 `hotkey_listener.rs`（1571 LOC · 最大模組）

**職責**：跨平台全域熱鍵監聽 + 錄製模式（讓使用者按下鍵組合錄成設定）

| 平台    | 實作                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| macOS   | `CGEventTap` 在 background thread + RunLoop                                         |
| Windows | `SetWindowsHookEx(WH_KEYBOARD_LL)` 全域低階 hook                                    |

**對外契約**：
- 7 個 Command：`check_accessibility_permission_command`、`open_accessibility_settings`、`reinitialize_hotkey_listener`、`reset_hotkey_state`、`start_hotkey_recording`、`cancel_hotkey_recording`、（透過 `lib.rs` 的 `update_hotkey_config`）
- 8 個 Event：`hotkey:pressed`、`hotkey:released`、`hotkey:toggled`、`hotkey:error`、`hotkey:mode-toggle`、`escape:pressed`、`hotkey:recording-captured`、`hotkey:recording-rejected`

**關鍵型別**：`TriggerKey`、`TriggerMode`（"hold"/"toggle"）、`HotkeyEventPayload`

**Windows 怪行為**：Copilot 鍵會發送 `VK_F23 (0x86)`，hook 必須 early-return 否則干擾 Quick View（PR #29，v0.9.5+）

**State 管理**：`HotkeyListenerState` 由 `init()` 內部註冊，含 `update_config()` 與 `shutdown()` 方法

### 4.2 `audio_recorder.rs`（1116 LOC）

**職責**：cpal 錄音 + WAV 寫檔 + 波形 FFT + 檔案管理

| 函式類別          | 範例                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| 錄音生命週期      | `start_recording`、`stop_recording`                                                  |
| 預覽（音量條）    | `start_audio_preview`、`stop_audio_preview` → emit `audio:preview-level`             |
| 檔案管理          | `save_recording_file`、`read_recording_file`、`delete_all_recordings`、`cleanup_old_recordings` |
| 裝置查詢          | `get_default_input_device_name`、`list_audio_input_devices`                          |

**事件**：
- `audio:waveform` — 錄音中每幀 FFT 後送 6 段振幅給 HUD 動畫
- `audio:preview-level` — 設定頁面音量條

**已知 macOS 怪事**：cpal 0.15.3 在非預設裝置切換時會因 CoreAudio disconnect listener 的 Arc cycle 洩漏 ~1-2 KB/次。已加 workaround 但等 cpal 上游修復。

**State**：`AudioRecorderState`（共用 cpal Stream + buffer）、`AudioPreviewState`（獨立 cpal Stream）

### 4.3 `keyboard_monitor.rs`（629 LOC）

**職責**：監測使用者後續鍵盤行為（用於 hallucination 偵測 + 智慧字典學習）

- `start_quality_monitor` — 貼上後監測使用者是否大幅修改 → emit `quality-monitor:result`（payload 含修改比例）
- `start_correction_monitor` — 監測修正動作 → emit `correction-monitor:result`（payload 含 corrected term）

兩者都用 macOS `CGEventTap` 監聽 keyDown 事件，結束條件是「N 秒無動作」或「使用者切視窗」。

### 4.4 `clipboard_paste.rs`（483 LOC）

| Command                  | 平台實作                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `paste_text`             | macOS：`simulate_paste_via_cgevent()`（Cmd+V）；Windows：`SendInput Ctrl+V`                  |
| `copy_to_clipboard`      | 跨平台 `arboard`                                                                               |
| `capture_target_window`  | 紀錄錄音前的焦點視窗（macOS NSWorkspace），用於貼上前恢復焦點                                  |

**ADR 參考**（`docs/adr-paste-mechanism.md`，2026-03-08）：
- 排除：AX Menu Press（LINE 無選單）、osascript（需 Automation 權限）
- 選定：CGEvent Cmd+V

**State**：`FocusState`（Windows 用，紀錄焦點視窗 HWND）

### 4.5 `audio_control.rs`（447 LOC）

**職責**：靜音 / 還原系統音訊（避免錄音時 app 自身音效回授）

| 平台    | 實作                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| macOS   | 原生 CoreAudio FFI：`AudioObjectGetPropertyData` / `AudioObjectSetPropertyData` 控制 `kAudioDevicePropertyMute` |
| Windows | `IAudioEndpointVolume::SetMute`                                                     |

**State**：`AudioControlState` 紀錄是否已 mute、原始 mute state（用於還原）

> ⚠️ `RunEvent::Exit` 必須**最先**呼叫 `shutdown()` 還原音量，不然 app 結束後系統永遠靜音。

### 4.6 `transcription.rs`（324 LOC）

**職責**：直接從 Rust 端打 Groq Whisper API（繞過前端 CORS / fetch）

| Command                  | 用途                                              |
| ------------------------ | ------------------------------------------------- |
| `transcribe_audio`       | 從 `AudioRecorderState` 拿 buffer 直接 multipart 送 Groq |
| `retranscribe_from_file` | HistoryView 對歷史 .wav 重新轉錄                  |

**State**：`TranscriptionState` 持有共用的 `reqwest::Client`（避免每次 new TLS）

**參數**：`api_key`, `vocabulary_term_list?`, `model_id?`（預設 `whisper-large-v3`）, `language?`（`null` = auto）

### 4.7 `text_field_reader.rs`（325 LOC · macOS only）

**職責**：用 macOS Accessibility API 讀取游標所在輸入框內容（用於 Edit Mode）

- `read_focused_text_field` — 讀取焦點輸入框完整內容
- `read_selected_text` — 讀取選取文字（v0.9.1 改用 Cmd+C clipboard approach 後相容更多 App）

**已知問題**：選取文字方案在 Fn 按住期間執行會因 hardware flag 穿透導致 "c" 字元輸入（GitHub #25）

### 4.8 `sound_feedback.rs`（206 LOC）

播放 `resources/sounds/start.wav`、`stop.wav` 與內建 error / learned 音效。用 `cpal` 直接播放 buffer，不依賴系統音效。

---

## 五、Managed States（5 個）

Tauri v2 的 `app.manage()` 註冊單例 state，每個 `#[command]` 透過 `State<T>` 注入：

| State                          | 模組                              | 包含                                                  |
| ------------------------------ | --------------------------------- | ----------------------------------------------------- |
| `KeyboardMonitorState`         | keyboard_monitor                  | quality / correction CGEventTap 控制                  |
| `AudioControlState`            | audio_control                     | mute 旗標、原始 state（還原用）                       |
| `FocusState`                   | clipboard_paste                   | Windows 焦點 HWND 紀錄                                |
| `AudioRecorderState`           | audio_recorder                    | cpal Stream、WAV writer、buffer                       |
| `AudioPreviewState`            | audio_recorder                    | 獨立 cpal Stream（音量預覽用，不污染主錄音）          |
| `TranscriptionState`           | transcription                     | 共用 `reqwest::Client`                                |
| `HotkeyListenerState`          | hotkey_listener                   | （由 plugin init 自行註冊）TriggerKey / Mode、CGEventTap |

> 所有 State 都實作 `shutdown()`，用於 `RunEvent::Exit` 釋放系統資源。

---

## 六、Window Configuration（macOS / Windows 差異）

### 6.1 macOS（`configure_macos_notch_window`）

```
NSWindow 屬性透過 objc::msg_send 設定：
  setLevel: 27                       ← NSMainMenuWindowLevel(24) + 3
  setCollectionBehavior:             ← 1 | 16 | 64 | 256
    canJoinAllSpaces (1)
    stationary (16)                  ← 桌面切換不移動
    ignoresCycle (64)
    fullScreenAuxiliary (256)        ← 全螢幕時仍顯示
  setMovable: false                  ← 防止拖動
```

> 此設定模仿 BoringNotch 的瀏海覆蓋層級。

### 6.2 Windows（`configure_windows_topmost_window`）

```
GetWindowLongPtrW(GWL_EXSTYLE) → 加入：
  WS_EX_TOOLWINDOW   ← 不出現 Alt+Tab / taskbar，跨虛擬桌面
  WS_EX_NOACTIVATE   ← 點擊不搶焦點
SetWindowPos(HWND_TOPMOST, ...)
  SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED
```

---

## 七、Multi-Monitor HUD Tracking

`get_hud_target_position` Command 是 HUD 的**多螢幕定位核心**：

```
1. get_cursor_position()                   ← macOS logical points / Windows virtual screen
2. app.available_monitors()                ← 列舉所有螢幕
3. find_monitor_for_cursor(cursor, monitors, is_macos)
                                           ← 純函式，11 個單元測試
4. calculate_centered_window_x_logical(width, sf, HUD_WIDTH)
                                           ← logical 偏移（繞過 tao cross-DPI bug）
5. 回傳 LogicalPosition + monitor_key
```

**為什麼用 logical 而非 physical 座標？** tao 的 `set_outer_position` 在 cross-DPI 環境下會用「視窗當前螢幕的 sf」而非「目標螢幕的 sf」做轉換 — 這個 bug 在外接顯示器+Retina 場景下會把視窗放到錯誤位置。改用 `LogicalPosition` 跳過 tao 的轉換邏輯。

`find_monitor_for_cursor` 的 fallback 行為：若游標不在任何螢幕內（rounding 間隙），找**距離游標最近的螢幕中心**而非固定 index 0。這是經過真實多螢幕場景測試過的設計。

---

## 八、Sentry Integration

```
fn run() {
  let _sentry_guard = if is_sentry_enabled() {
    Some(sentry::init((dsn, ClientOptions {
      release: Some(get_sentry_release().into()),  ← 預設 sayit@<CARGO_PKG_VERSION>
      environment: Some(get_sentry_environment().into()),
      send_default_pii: false,                     ← 不發送 PII
      ..Default::default()
    })))
  } else { None };
  // ... tauri::Builder ...
}
```

**Guard 模式**：`_sentry_guard` 綁在 `run()` 局部變數，app 結束時 drop 才 flush。`RunEvent::Exit` handler 額外呼叫 `client.flush(2s)` 確保事件送出。

**啟用條件**：`SENTRY_ENVIRONMENT == "production"` 且 `SENTRY_DSN` 有值且非 `__` 開頭。

> 「`__` 開頭」這個篩選是為了防 GitHub Secret 沒設時 fallback 變數被當成有效值。

---

## 九、Restart 機制（`request_app_restart` + `RunEvent::Exit`）

Tauri 內建 restart 邏輯與 `_exit(0)` 不相容（`_exit` 會 bypass cleanup），因此 SayIt 自製：

```
1. Frontend invoke('request_app_restart')
2. Rust set RESTART_REQUESTED = true
3. app.exit(0) → 觸發 RunEvent::Exit
4. Exit handler 跑完所有 graceful shutdown
5. 檢查 RESTART_REQUESTED：
   true → Command::new(current_exe).spawn() 啟新 process
6. _exit(0) 結束舊 process
```

> 用 `_exit(0)` 而非 `std::process::exit(0)` 是為了確保 cleanup 後立刻結束、不執行 atexit handler / static destructor（避免 Tauri 內建 restart 邏輯介入）。

---

## 十、Build Profile（Release 最佳化）

```toml
[profile.release]
panic = "abort"        # 不展開 unwind stack（縮小 binary）
codegen-units = 1      # 全 crate 一起 codegen（最佳化更激進）
lto = true             # Link-Time Optimization
opt-level = "s"        # 大小優先（不是 "z"，留一點速度）
strip = true           # 剝離 debug symbols
```

**結果**：macOS arm64 dmg 約 8-12 MB，Windows .exe 約 10-15 MB。

---

## 十一、Testing

Rust 測試內嵌於各模組的 `#[cfg(test)] mod tests`：

| 模組                              | 測試焦點                                        |
| --------------------------------- | ----------------------------------------------- |
| `lib.rs`                          | `find_monitor_for_cursor`（11 測試）+ `calculate_centered_window_x*`（5 測試） |
| `hotkey_listener.rs`              | TriggerKey 解析、modifier 邏輯                  |
| `clipboard_paste.rs`              | （需測試實機因依賴系統 API）                    |

CI 只跑 `cargo check`（不跑 `cargo test`）— **這是個 CI tech debt**，後續應加 `cargo test --workspace`。

---

## 十二、Hard Rules / 不可違反

1. **❌ webview 直接 fetch Groq Whisper** → ✅ Rust `transcribe_audio` 直呼（multipart 在前端有限制）
2. **❌ `shutdown()` 順序錯亂** → ✅ 嚴守 §RunEvent::Exit 的順序（音量 → 預覽 → 錄音 → keyboard monitor → hotkey）
3. **❌ 在 Rust 端硬編碼 Sentry release** → ✅ 用 `option_env!("SENTRY_RELEASE")` 由 release.yml 注入
4. **❌ 修改 `Cargo.lock`** → ✅ `protect-config.sh` hook 阻擋；只能透過 `cargo` 自動更新
5. **❌ 動 `panic = "abort"`** → ✅ 影響 binary 大小與 fault tolerance，非必要不改
6. **❌ 在 plugin 內部呼叫 `app.exit(0)`** → ✅ 統一由 frontend 發起或 tray menu 觸發

---

## 十三、Open Tech Debt

| 項目                                                           | 影響                                  |
| -------------------------------------------------------------- | ------------------------------------- |
| CI 只跑 `cargo check`，沒跑 `cargo test`                        | 17+ 純函式測試沒有 CI 守門            |
| 沒有 `cargo clippy` lint                                       | 風格 / lint 錯誤可能漏網              |
| cpal 0.15.3 非預設裝置 Arc cycle workaround                     | 上游修復 cpal 0.16+ 後可移除          |
| `text_field_reader::read_selected_text` Fn-c 字元穿透           | issue #25 待修                        |
| Windows 貼上 / 焦點切換 P0 issue                                | 待修                                  |
| addApiUsage FK 失敗 (787)                                       | DB 統計資料偶失                       |
