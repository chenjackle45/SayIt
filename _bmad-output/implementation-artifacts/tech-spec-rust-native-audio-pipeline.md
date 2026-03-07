---
title: 'Rust Native Audio Pipeline'
slug: 'rust-native-audio-pipeline'
created: '2026-03-07 22:36:47'
status: 'done'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
tech_stack: ['Rust', 'cpal 0.15+', 'hound', 'rustfft', 'reqwest (via tauri-plugin-http)', 'Tauri v2 Commands/Events', 'TypeScript', 'Vue 3', 'Pinia']
files_to_modify: ['src-tauri/Cargo.toml', 'src-tauri/src/plugins/mod.rs', 'src-tauri/src/plugins/audio_recorder.rs', 'src-tauri/src/plugins/transcription.rs', 'src-tauri/src/lib.rs', 'src/lib/recorder.ts (DELETE)', 'src/lib/transcriber.ts (DELETE)', 'src/stores/useVoiceFlowStore.ts', 'src/composables/useAudioWaveform.ts', 'src/composables/useTauriEvents.ts', 'src/types/audio.ts', 'src/components/NotchHud.vue', 'src/App.vue', 'tests/component/NotchHud.test.ts', 'tests/unit/use-voice-flow-store.test.ts', 'tests/unit/recorder.test.ts (DELETE)', 'tests/unit/transcriber.test.ts (DELETE)']
code_patterns: ['Tauri Command (invoke) for request-response', 'Tauri Event (emit) for streaming waveform data to frontend', 'Mutex<Option<T>> singleton pattern for Rust state (see audio_control.rs)', 'platform_* helper functions wrapping cfg(target_os) blocks (see audio_control.rs)', 'Pinia store as sole bridge between views and lib/', 'app.manage(State) for Tauri managed state injection', 'invoke_handler generate_handler![] for Command registration']
test_patterns: ['Vitest + vi.mock for Tauri invoke/listen', 'vi.hoisted for mock declarations', 'Rust #[cfg(test)] mod tests in same file', 'existing use-voice-flow-store.test.ts needs major refactor']
---

# Tech-Spec: Rust Native Audio Pipeline

**Created:** 2026-03-07 22:36:47

## Overview

### Problem Statement

SayIt 的音訊擷取目前使用 Web API（`getUserMedia` / `MediaRecorder`），運行在 Tauri HUD webview 中。這導致兩個問題：

1. **WKWebView 背景限制**：macOS 的 WKWebView 要求 webview 處於「活躍」狀態才能完成 `getUserMedia`。快捷鍵觸發時前景 app 持有焦點，HUD webview 在背景，導致 `getUserMedia` 掛起。因此無法實現 lazy init（按需初始化麥克風），麥克風圖示在 app 啟動後即常駐 macOS 狀態列。

2. **職責錯置**：HUD webview 承擔了錄音控制、音訊分析、轉錄 API 呼叫等非 UI 職責，違反「UI 層只做顯示」的架構原則。轉錄 API 呼叫也因此受限於 webview 的生命週期。

### Solution

將整個音訊管線搬到 Rust 側：

- **錄音**：使用 `cpal` crate 跨平台擷取 PCM 音訊，`hound` 編碼為 WAV
- **轉錄**：Rust 直接呼叫 Groq Whisper API（`reqwest`）
- **波形資料**：Rust 計算頻率資料，透過 Tauri Event 推送給前端
- **前端**：HUD webview 退化為純 UI 顯示層，透過 Tauri Commands 控制錄音、透過 Events 接收狀態更新

Rust 不受 WKWebView 限制，可實現真正的 lazy init — 麥克風圖示僅在錄音期間出現。

### Scope

**In Scope:**
- Rust 新增 `audio_recorder` plugin：`cpal` 錄音、WAV 編碼、麥克風 lazy init/release
- Rust 新增 `transcription` plugin：Groq Whisper API 呼叫（含詞彙注入）
- Rust 推送波形頻率資料給前端（Tauri Event）
- 前端移除 `recorder.ts`、`transcriber.ts`
- `useVoiceFlowStore` 改用 Tauri Commands/Events 驅動錄音流程
- `useAudioWaveform` 改為監聽 Rust 推送的頻率資料
- 更新相關測試

**Out of Scope:**
- AI 整理（`enhancer.ts`）遷移 — 保留在前端
- HUD UI 元件/動畫重設計
- 新增音訊格式支援（WAV 足夠，Groq API 支援）
- Windows 平台實作（本 spec 先完成 macOS，Windows 結構預留但不實作）

## Context for Development

### Codebase Patterns

- **Rust plugin 結構**：plugins 放在 `src-tauri/src/plugins/`，在 `mod.rs` 用 `pub mod` 註冊，`lib.rs` 的 `invoke_handler` 用 `generate_handler![]` 掛載 Commands
- **Rust state 管理**：`app.manage(XxxState::new())` 在 `setup()` 中初始化，Command 透過 `State<XxxState>` 注入。內部用 `Mutex<Option<T>>` 做 singleton（參見 `audio_control.rs`）
- **平台條件編譯**：`mod macos {}` + `mod windows_xxx {}` 分模組，再用 `platform_*()` helper wrapping `cfg(target_os)` blocks（參見 `audio_control.rs:257-286`）
- **前端架構**：`lib/` 封裝外部 API，`stores/` 透過 Pinia 管理狀態，`views/` 不直接呼叫 `lib/`
- **IPC 模式**：Commands 用 `invoke()` 做 request-response，Events 用 `emit()`/`listen()` 做 push/streaming
- **IPC 契約**：`CLAUDE.md` 有完整 Command/Event 表格，新增需同步更新
- **波形資料流（現有）**：`useVoiceFlowStore` 持有 `analyserHandle: ref<AudioAnalyserHandle | null>`，prop 傳到 `NotchHud.vue` → `useAudioWaveform.ts`，用 `useRafFn` 每幀讀取 6 個 frequency bin（index: 9,4,1,2,6,12），做 dB normalize + lerp 平滑

### Files to Reference

| File | Purpose | Action |
| ---- | ------- | ------ |
| `src/lib/recorder.ts` | Web API 錄音：`getUserMedia`, `MediaRecorder`, `AudioContext` analyser | **DELETE** |
| `src/lib/transcriber.ts` | Groq Whisper API：`FormData` + `@tauri-apps/plugin-http` fetch | **DELETE** |
| `tests/unit/recorder.test.ts` | recorder.ts 測試（mock MediaRecorder/getUserMedia） | **DELETE** |
| `src/stores/useVoiceFlowStore.ts` | 語音流程 Pinia store：改用 Tauri Commands/Events 驅動錄音與轉錄 | **MAJOR REFACTOR** |
| `src/composables/useAudioWaveform.ts` | 波形動畫：`useRafFn` + `AudioAnalyserHandle.getFrequencyData()` | **REFACTOR** |
| `src/types/audio.ts` | `AudioAnalyserHandle` interface + `DEFAULT_ANALYSER_CONFIG` | **REPLACE** |
| `src/components/NotchHud.vue` | HUD 元件：接收 `analyserHandle` prop | **UPDATE** |
| `src/App.vue` | HUD 入口：傳遞 `voiceFlowStore.analyserHandle` | **UPDATE** |
| `tests/component/NotchHud.test.ts` | HUD 狀態與波形生命週期測試 | **UPDATE** |
| `tests/unit/use-voice-flow-store.test.ts` | store 測試：mock Tauri commands/events | **MAJOR REFACTOR** |
| `src-tauri/src/plugins/audio_control.rs` | 系統音量控制（441 行） | **REFERENCE** |
| `src-tauri/src/plugins/hotkey_listener.rs` | 快捷鍵 + Event emit | **REFERENCE** |
| `src-tauri/src/lib.rs` | Tauri Builder：`invoke_handler`, `setup`, `app.manage()` | **MODIFY** |
| `src-tauri/src/plugins/mod.rs` | Plugin 模組註冊 | **MODIFY** |
| `src-tauri/Cargo.toml` | Rust 依賴 | **MODIFY** |

### Technical Decisions

- **`cpal` 跨平台音訊擷取**：`Host::default()` → `host.default_input_device()` → 選擇裝置實際支援的 `SupportedStreamConfig`。優先 16kHz；若裝置不支援則 fallback 到 `default_input_config()`。`build_input_stream()` 需依 `sample_format`（`f32`/`i16`/`u16` 等）分派對應 callback。`Stream` drop 時自動釋放裝置 — 天然 lazy init
- **`hound` WAV 編碼**：`WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: Int }`。錄音期間 PCM 寫入 `Vec<i16>`，停止時用 `WavWriter::new(Cursor::new(Vec))` 編碼到記憶體（不落磁碟）
- **`reqwest` 呼叫 Groq API**：已在依賴樹（`tauri-plugin-http` 間接引入），加 `reqwest = { version = "0.12", features = ["multipart"] }`。用 `multipart::Form` 建構 FormData
- **FFT 頻率分析**：`rustfft` 做 64-point FFT（對應現有 `fftSize: 64`），取 magnitude 轉 dB。只取 6 bin（index 9,4,1,2,6,12），normalize 後推送
- **Tauri Event 推送波形**：`app.emit("audio:waveform", WaveformPayload { levels: [f32; 6] })` 每 ~16ms 推送。前端 `useAudioWaveform` 改為 `listen("audio:waveform")` + `useRafFn` lerp
- **API Key 傳遞**：`invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })` 時傳入，Rust 不持久化
- **lazy init**：`start_recording` Command 開啟 `cpal` stream → `stop_recording` 關閉 stream + 編碼 WAV → `transcribe_audio` 送 Groq API
- **錄音資料傳遞**：`stop_recording` 將 WAV buffer 暫存在 Rust State，`transcribe_audio` 從 State 取用並清空，避免大型 binary 經過 IPC
- **`isSilenceOrHallucination` 保留前端**：Rust 回傳 `rawText` + `noSpeechProbability`，前端現有邏輯判斷

## Implementation Plan

### Tasks

- [x] Task 1: 新增 Rust 依賴
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[dependencies]` 新增 `cpal`、`hound`、`rustfft`、`reqwest`（含 multipart feature）
  - 實作細節:
    ```toml
    cpal = "0.15"
    hound = "3.5"
    rustfft = "6"
    reqwest = { version = "0.12", features = ["multipart", "json"] }
    ```
  - Notes: `reqwest` 已在依賴樹中（`tauri-plugin-http` 間接引入），顯式加入以使用 `multipart` feature。`json` feature 用於解析 Groq API 回應

- [x] Task 2: 建立 `audio_recorder` Rust plugin
  - File: `src-tauri/src/plugins/audio_recorder.rs`（新建）
  - Action: 實作 Rust 側錄音模組
  - 實作細節:
    - **State 結構**：
      ```rust
      pub struct AudioRecorderState {
          inner: Mutex<Option<RecordingSession>>,
          wav_buffer: Mutex<Option<Vec<u8>>>,
      }

      struct RecordingSession {
          stream: cpal::Stream,
          samples: Arc<Mutex<Vec<i16>>>,
          sample_rate: u32,
          app_handle: AppHandle,
      }
      ```
    - **`start_recording` Command**：
      1. 取得 `Mutex` lock，檢查是否已在錄音（冪等 guard）
      2. `cpal::default_host().default_input_device()` 取得麥克風
      3. 先從 `supported_input_configs()` 選擇裝置真的支援的設定；優先 16kHz，否則 fallback 到 `default_input_config()`
      4. `device.build_input_stream()` 依 `sample_format` 分派對應 callback：
         - 將 PCM samples（f32 → i16 轉換）寫入 `Arc<Mutex<Vec<i16>>>`
         - 每 ~16ms 對最近的 64 個 sample 做 FFT，計算 6 個 bin 的 dB 值
         - `app.emit("audio:waveform", WaveformPayload { levels })` 推送給前端
      5. `stream.play()` 開始錄音
      6. 將 `RecordingSession` 存入 State
    - **`stop_recording` Command**：
      1. 從 State 取出 `RecordingSession`（take → drop `Stream` → 麥克風釋放）
      2. 取出 `samples: Vec<i16>`
      3. 用 `hound::WavWriter::new(Cursor::new(Vec::new()), WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: Int })` 編碼 WAV
      4. 將 WAV `Vec<u8>` 存入 `wav_buffer` State
      5. 回傳 `StopRecordingResult { recording_duration_ms: f64 }` 給前端
    - **Error 型別**：`AudioRecorderError` enum，實作 `thiserror::Error` + `serde::Serialize`（同 `ClipboardError` 模式）
  - Notes:
    - `cpal::Stream` 不是 `Send`，需要在建立 stream 的同一 thread 持有。使用 dedicated thread + channel 或 `Arc` 包裝
    - FFT 計算在 audio callback 中執行，不要 block — 使用 ring buffer 或 atomic 傳遞 sample 到另一 thread
    - `f32 → i16` 轉換：`(sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16`

- [x] Task 3: 實作 FFT 波形分析
  - File: `src-tauri/src/plugins/audio_recorder.rs`（同 Task 2 檔案）
  - Action: 在 audio callback 中計算頻率資料並推送 Tauri Event
  - 實作細節:
    - 維護一個 64-sample 的 ring buffer
    - 當 buffer 滿時（每 64 samples ≈ 4ms @ 16kHz），執行一次 FFT：
      1. `rustfft::FftPlanner::new().plan_fft_forward(64)`
      2. 將 i16 samples 轉為 `Complex<f32>`
      3. 計算 magnitude → dB：`20.0 * log10(magnitude / fft_size as f32)`
      4. 從 FFT 結果取 6 個 bin（index 1,2,4,6,9,12）
      5. dB normalize：`(dB - (-100)) / ((-20) - (-100))` clamp 到 [0, 1]
    - 限制推送頻率：每 16ms 最多推送一次（`Instant::elapsed()`）
    - **Event payload**:
      ```rust
      #[derive(Clone, serde::Serialize)]
      struct WaveformPayload {
          levels: [f32; 6],
      }
      ```
    - `app.emit("audio:waveform", payload)`
  - Notes: 前端 `FREQUENCY_BIN_PICK_INDEX_LIST = [9, 4, 1, 2, 6, 12]` — 注意順序是前端顯示順序，不是 bin index 大小順序

- [x] Task 4: 建立 `transcription` Rust plugin
  - File: `src-tauri/src/plugins/transcription.rs`（新建）
  - Action: 實作 Groq Whisper API 呼叫
  - 實作細節:
    - **`transcribe_audio` Command**：
      ```rust
      #[command]
      pub async fn transcribe_audio(
          state: State<'_, AudioRecorderState>,
          api_key: String,
          vocabulary_term_list: Option<Vec<String>>,
          model_id: Option<String>,
      ) -> Result<TranscriptionResult, TranscriptionError>
      ```
    - 流程：
      1. 從 `state.wav_buffer` 取出 WAV data（`take()`），若無資料則回傳錯誤
      2. 檢查 WAV 大小 ≥ 1000 bytes（對應現有 `MINIMUM_AUDIO_BLOB_SIZE`）
      3. 建構 `reqwest::multipart::Form`：
         - `file`: `Part::bytes(wav_data).file_name("recording.wav").mime_str("audio/wav")`
         - `model`: `model_id.unwrap_or("whisper-large-v3")`
         - `language`: `"zh"`
         - `response_format`: `"verbose_json"`
         - `prompt`（可選）：`format_whisper_prompt(&vocabulary_term_list)`（最多 50 個 term）
      4. `reqwest::Client::new().post(GROQ_API_URL).bearer_auth(&api_key).multipart(form).send().await`
      5. 解析 JSON 回應，提取 `text`、`segments[].no_speech_prob`
      6. 回傳 `TranscriptionResult { raw_text, transcription_duration_ms, no_speech_probability }`
    - **常數**（從 `transcriber.ts` 搬過來）：
      ```rust
      const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
      const TRANSCRIPTION_LANGUAGE: &str = "zh";
      const MAX_WHISPER_PROMPT_TERMS: usize = 50;
      const MINIMUM_AUDIO_SIZE: usize = 1000;
      const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
      ```
    - **`format_whisper_prompt()`**：
      ```rust
      fn format_whisper_prompt(term_list: &[String]) -> String {
          let terms: Vec<&str> = term_list.iter().take(MAX_WHISPER_PROMPT_TERMS).map(|s| s.as_str()).collect();
          format!("Important Vocabulary: {}", terms.join(", "))
      }
      ```
    - **回傳型別**（Tauri Command 需 Serialize）：
      ```rust
      #[derive(serde::Serialize)]
      #[serde(rename_all = "camelCase")]
      pub struct TranscriptionResult {
          pub raw_text: String,
          pub transcription_duration_ms: f64,
          pub no_speech_probability: f64,
      }
      ```
    - **Groq API 回應結構**（Deserialize）：
      ```rust
      #[derive(serde::Deserialize)]
      struct WhisperVerboseResponse {
          text: String,
          segments: Vec<WhisperSegment>,
      }
      #[derive(serde::Deserialize)]
      struct WhisperSegment {
          no_speech_prob: f64,
      }
      ```
  - Notes: `reqwest` 的 async 需在 Tauri Command 中使用 `async fn`。Tauri v2 支援 async commands

- [x] Task 5: 註冊 Rust plugins 和 Commands
  - File: `src-tauri/src/plugins/mod.rs`, `src-tauri/src/lib.rs`
  - Action:
    1. `mod.rs` 新增：`pub mod audio_recorder;` 和 `pub mod transcription;`
    2. `lib.rs` `setup()` 新增：`app.manage(plugins::audio_recorder::AudioRecorderState::new());`
    3. `lib.rs` `invoke_handler` 新增：
       ```rust
       plugins::audio_recorder::start_recording,
       plugins::audio_recorder::stop_recording,
       plugins::transcription::transcribe_audio,
       ```
  - Notes: 遵循現有的 `audio_control` 註冊模式

- [x] Task 6: 更新前端型別定義
  - File: `src/types/audio.ts`
  - Action: 替換 `AudioAnalyserHandle` 為波形 level 相關型別
  - 實作細節:
    ```typescript
    export interface WaveformPayload {
      levels: number[];
    }

    export interface StopRecordingResult {
      recordingDurationMs: number;
    }

    export interface TranscriptionResult {
      rawText: string;
      transcriptionDurationMs: number;
      noSpeechProbability: number;
    }
    ```
  - Notes: 移除 `AudioAnalyserHandle`、`AudioAnalyserConfig`、`DEFAULT_ANALYSER_CONFIG`

- [x] Task 7: 重構 `useAudioWaveform` composable
  - File: `src/composables/useAudioWaveform.ts`
  - Action: 從 `AudioAnalyserHandle.getFrequencyData()` pull 模式改為 Tauri Event push 模式
  - 實作細節:
    - 移除：`analyserHandle` 參數、`useRafFn` 中的 `getFrequencyData()` 呼叫
    - 新增：`listen("audio:waveform")` 監聽 Rust 推送的 `WaveformPayload`
    - 保留：`useRafFn` 用於 lerp 平滑動畫（從 Event 收到的 target levels → lerp → 實際顯示 levels）
    - 簽名變更：
      ```typescript
      // Before: export function useAudioWaveform(analyserHandle: Ref<AudioAnalyserHandle | null>)
      // After:
      export function useAudioWaveform()
      ```
    - 新增 `startListening()` / `stopListening()` 控制 Event 監聽的生命週期
    - 避免 listener 晚到時殘留，確保快速切換狀態時不會留下多餘監聽
    - `stopListening()` 時 unlisten + 將 target levels 歸零
  - Notes: lerp 常數（`LERP_SPEED = 0.25`、`DB_FLOOR`、`DB_CEILING`）不再需要 — Rust 側已做 normalize，前端只做 lerp

- [x] Task 8: 重構 `useVoiceFlowStore`
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 移除 `recorder.ts` 和 `transcriber.ts` 的 import 和呼叫，改用 Tauri Commands
  - 實作細節:
    - **移除 import**：
      ```
      initializeMicrophone, startRecording, stopRecording,
      createAudioAnalyser, destroyAudioAnalyser
      ```
      和 `transcribeAudio` from `../lib/transcriber`
    - **移除 state**：`analyserHandle: ref<AudioAnalyserHandle | null>(null)` — 波形動畫改由 `useAudioWaveform` 內部管理
    - **移除 return**：`analyserHandle` 從 store 的 return 物件中移除
    - **`handleStartRecording()` 改為**：
      ```typescript
      async function handleStartRecording() {
        if (isRecording.value) return;
        isRecording.value = true;
        lastWasModified.value = null;
        recordingStartTime = performance.now();
        try {
          await Promise.all([
            muteSystemAudioIfEnabled(),
            invoke("start_recording"),
          ]);
          startElapsedTimer();
          transitionTo("recording", RECORDING_MESSAGE);
          writeInfoLog("useVoiceFlowStore: recording started");
        } catch (error) {
          const errorMessage = getMicrophoneErrorMessage(error);
          failRecordingFlow(errorMessage, `...`, error);
        }
      }
      ```
    - **`handleStopRecording()` 改為**：
      1. `const result = await invoke<StopRecordingResult>("stop_recording")` — 停止錄音 + 取得 WAV
      2. 用 `result.recordingDurationMs` 檢查最短錄音時間
      3. `transitionTo("transcribing", ...)`
      4. `const transcription = await invoke<TranscriptionResult>("transcribe_audio", { apiKey, vocabularyTermList, modelId })` — Rust 呼叫 Groq API
      5. 後續 `isSilenceOrHallucination()`、enhancement、paste 邏輯不變
    - **`initialize()` 改為**：移除 `try { await initializeMicrophone(); ... } catch { ... }` 區塊 — Rust 側不需要啟動時初始化
    - **`cleanup()` 改為**：移除 `destroyAudioAnalyser()` 呼叫 — 前端不再管理音訊資源
    - **`failRecordingFlow()` 中**：不需要呼叫 `restoreSystemAudio()` 以外的清理（Rust `Stream` 已在 `stop_recording` 中 drop）
  - Notes:
    - `audioBlob` 不再存在 — Rust 內部管理 WAV buffer
    - `transcribeAudio()` 的簽名變了 — 不再傳 `audioBlob`，改為 Rust Command 直接從內部 State 取 WAV
    - `recordingDurationMs` 改為從 Rust `stop_recording` 回傳值取得；此值刻意包含麥克風/裝置啟動成本，作為「錄音時間太短」UX 緩衝的一部分

- [x] Task 9: 更新 `NotchHud.vue` 和 `App.vue`
  - File: `src/components/NotchHud.vue`, `src/App.vue`
  - Action: 移除 `analyserHandle` prop，改為 composable 內部管理
  - 實作細節:
    - **`NotchHud.vue`**：
      - 移除 `analyserHandle` prop 定義
      - 移除 `const analyserHandleRef = toRef(props, "analyserHandle")`
      - 改為直接呼叫 `const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } = useAudioWaveform()`（無參數）
      - 其餘 waveform 顯示邏輯不變（`barStyleList` computed 用 `waveformLevelList`）
    - **`App.vue`**：
      - 移除 `NotchHud` 上的 `:analyser-handle="voiceFlowStore.analyserHandle"` prop
  - Notes: `useAudioWaveform` 的 `startWaveformAnimation()` 和 `stopWaveformAnimation()` 語義不變，但內部改為控制 Event listener + lerp animation

- [x] Task 10: 刪除前端錄音/轉錄模組
  - File: `src/lib/recorder.ts`, `src/lib/transcriber.ts`, `tests/unit/recorder.test.ts`
  - Action: 刪除這三個檔案
  - Notes:
    - 確認無其他檔案 import 這些模組（Task 8 已移除 store 的 import）
    - `transcriber.ts` 中的 `TranscriptionResult` 型別已在 Task 6 於 `types/audio.ts` 重新定義
    - `transcriber.ts` 中的 `formatWhisperPrompt()` 已在 Task 4 於 Rust 重新實作
    - `SettingsView.vue` 中有 `startRecording`/`stopRecording` 函式名稱，但那是快捷鍵錄製的本地函式（與 `recorder.ts` 無關），不受影響

- [x] Task 11: 重構前端測試
  - File: `tests/unit/use-voice-flow-store.test.ts`
  - Action: 將 mock 從 `recorder.ts`/`transcriber.ts` 改為 mock `invoke()`/`listen()`
  - 實作細節:
    - **移除 mock**：
      - `mockInitializeMicrophone`, `mockStartRecording`, `mockStopRecording`, `mockReleaseMicrophone`
      - `mockTranscribeAudio`
      - `vi.mock("../../src/lib/recorder", ...)` 整個 mock block
      - `vi.mock("../../src/lib/transcriber", ...)` 整個 mock block
    - **新增 mock**：
      - `mockInvoke` 改為按 command 名稱分派：
        ```typescript
        mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
          switch (cmd) {
            case "start_recording": return undefined;
            case "stop_recording": return { recordingDurationMs: 2500 };
            case "transcribe_audio": return {
              rawText: "測試轉錄",
              transcriptionDurationMs: 320,
              noSpeechProbability: 0.01,
            };
            // ... 其他既有 commands (debug_log, paste_text 等) ...
            default: return undefined;
          }
        });
        ```
    - **測試案例調整**：
      - `initialize` 測試：移除「應初始化麥克風」的 assertion
      - `handleStartRecording` 測試：改為 assert `mockInvoke` 被呼叫 with `"start_recording"`
      - `handleStopRecording` 測試：改為 assert `mockInvoke` 被呼叫 with `"stop_recording"` 和 `"transcribe_audio"`
      - 錯誤處理測試：mock `invoke("start_recording")` reject
  - Notes: 測試的核心邏輯（狀態轉換、mute/restore、paste、enhancement）不變，只是 mock 的對象從前端模組改為 Tauri IPC

- [x] Task 12: 更新 Tauri 前端權限設定
  - File: `src-tauri/capabilities/default.json`（如存在）
  - Action: 確認 Tauri v2 的 capability 設定允許新增的 Commands 被前端呼叫
  - Notes: Tauri v2 的 capability system 可能需要在 `default.json` 中加入新 command 的權限。檢查現有設定是否用 wildcard 或需要明確列出

### Acceptance Criteria

- [x] AC 1: Given 應用剛啟動且使用者未按快捷鍵, when 檢視 macOS 狀態列, then 不應出現 SayIt 的麥克風圖示
- [x] AC 2: Given 應用已啟動且處於 idle 狀態, when 使用者按下快捷鍵, then 麥克風圖示出現且 HUD 顯示錄音狀態（含波形動畫）
- [x] AC 3: Given 正在錄音中, when 使用者放開快捷鍵且轉錄/貼上成功, then 麥克風圖示在停止錄音後消失、轉錄結果正確貼上
- [x] AC 4: Given 正在錄音中, when 錄音流程發生錯誤（如 API key 缺失、轉錄失敗）, then 麥克風圖示消失且 HUD 顯示錯誤訊息
- [x] AC 5: Given 使用者剛完成一次錄音, when 再次按下快捷鍵, then 麥克風重新啟動且錄音正常運作（連續使用不中斷）
- [x] AC 6: Given 使用者體感可接受的錄音時間仍不足以覆蓋裝置啟動與收音成本, when 系統判定為太短, then HUD 顯示「錄音時間太短」且麥克風圖示消失
- [x] AC 7: Given 錄音中, when HUD 顯示波形動畫, then 波形跟隨音訊輸入即時變化（視覺效果與遷移前一致）
- [x] AC 8: Given 使用者設定了自訂詞彙, when 錄音並轉錄, then Groq API 收到的 prompt 包含詞彙列表（與遷移前行為一致）
- [x] AC 9: Given Groq API 回傳 `no_speech_prob` 高於閾值, when 前端判斷為靜默, then HUD 顯示「未偵測到語音」（靜默偵測邏輯不變）
- [x] AC 10: Given AI 整理（enhancement）啟用, when 轉錄完成, then 整理流程正常運作（不受 Rust 遷移影響）

## Additional Context

### Dependencies

**新增 Rust crate：**
- `cpal = "0.15"` — 跨平台音訊輸入
- `hound = "3.5"` — WAV 編碼
- `rustfft = "6"` — FFT 頻率分析
- `reqwest = { version = "0.12", features = ["multipart", "json"] }` — HTTP multipart（已在依賴樹，顯式加入以使用 multipart feature）

**移除前端依賴：** 無（`getUserMedia` / `MediaRecorder` 是瀏覽器原生 API，不需移除套件）

### Testing Strategy

**Rust 單元測試：**
- WAV 編碼正確性：已知 PCM samples → 驗證 WAV header + data 長度
- `format_whisper_prompt()`：空列表、超過 50 個 term、正常列表
- FFT normalize：已知 dB 值 → 預期 [0,1] 範圍
- `TranscriptionResult` 序列化：確認 camelCase rename

**前端單元測試：**
- `useVoiceFlowStore`：mock `invoke()` 按 command 分派，測試狀態轉換、錯誤處理、短錄音 UX 路徑
- `NotchHud` / `useAudioWaveform`：mock `listen("audio:waveform")`，驗證 listener 晚到時不殘留、波形生命週期正確
- 移除 `recorder.test.ts`（379 行）

**手動測試：**
1. 啟動 app → 確認狀態列無麥克風圖示
2. 按快捷鍵 → 確認圖示出現 → 放開 → 確認圖示消失
3. 連續錄音 3 次 → 確認穩定性
4. 波形動畫正常顯示且跟隨音訊
5. 轉錄結果正確（含詞彙注入）
6. 極短按壓（<300ms）→ 確認「錄音時間太短」
7. 錯誤情境（無 API key、API 失敗）→ 確認錯誤訊息正確

### Notes

- **`cpal::Stream` 非 `Send` 問題**：`cpal::Stream` 在某些平台不是 `Send`，不能直接存入 `Mutex<Option<Stream>>`。解法：在 dedicated OS thread 上建立 stream，用 `mpsc::channel` 控制 start/stop，stream 的生命週期由該 thread 管理
- **FFT 效能**：64-point FFT 在 audio callback 中執行，計算量極小（~幾十微秒），不會影響錄音品質
- **WAV 大小**：16kHz mono 16-bit 的 WAV，每秒 32KB。5 秒錄音 ≈ 160KB + 44 bytes header，Groq API 上限 25MB，完全足夠
- **Groq API timeout**：現有前端沒有設定 timeout，Rust 側建議加上 30 秒 timeout（`reqwest::Client::builder().timeout(Duration::from_secs(30))`）
- **`enhancer.ts` 保留前端**：AI 整理仍使用前端的 `@tauri-apps/plugin-http` fetch 呼叫 Groq LLM API，不受此遷移影響
- **Windows 預留**：`audio_recorder.rs` 的 `cpal` 部分是跨平台的，Windows 無需額外 `cfg` 條件。`transcription.rs` 也是純 Rust HTTP，跨平台。但 spec 標記 Windows 為 Out of Scope 以控制測試範圍
- **首次使用麥克風權限**：macOS 會在 `cpal` 首次存取麥克風時彈出系統權限對話框。`start_recording` Command 的 catch 區塊需能處理權限被拒絕的情況（`cpal::BuildStreamError`）
- **短錄音 UX 緩衝**：`recordingDurationMs` 刻意包含麥克風與裝置啟動時間，目的是把硬體暖機成本包進使用者體感；「錄音時間太短」不只是字面上的發聲時間不足，也是啟動成本未被覆蓋的 UX 訊號
