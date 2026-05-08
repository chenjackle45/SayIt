use std::io::Cursor;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{command, ipc::Response, AppHandle, Emitter, Manager, State};

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum AudioRecorderError {
    #[error("No input device available")]
    NoInputDevice,
    #[error("Failed to get input config: {0}")]
    InputConfig(String),
    #[error("Failed to build audio stream: {0}")]
    BuildStream(String),
    #[error("Failed to start audio stream: {0}")]
    PlayStream(String),
    #[error("Not recording")]
    NotRecording,
    #[error("WAV encoding failed: {0}")]
    WavEncode(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for AudioRecorderError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Payloads ==========

#[derive(Clone, serde::Serialize)]
pub struct WaveformPayload {
    levels: [f32; 6],
}

#[derive(Clone, serde::Serialize)]
pub struct AudioPreviewLevelPayload {
    level: f32,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRecordingResult {
    recording_duration_ms: f64,
    peak_energy_level: f32,
    rms_energy_level: f32,
}

// ========== State ==========

struct RecordingInner {
    samples: Mutex<Vec<i16>>,
    should_stop: AtomicBool,
}

struct RecordingHandle {
    inner: Arc<RecordingInner>,
    thread: Option<std::thread::JoinHandle<()>>,
    start_time: Instant,
    sample_rate: u32,
}

pub struct AudioRecorderState {
    recording: Mutex<Option<RecordingHandle>>,
    pub(crate) wav_buffer: Mutex<Option<Vec<u8>>>,
}

impl AudioRecorderState {
    pub fn new() -> Self {
        Self {
            recording: Mutex::new(None),
            wav_buffer: Mutex::new(None),
        }
    }

    pub fn shutdown(&self) {
        let mut guard = match self.recording.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(mut handle) = guard.take() {
            handle.inner.should_stop.store(true, Ordering::SeqCst);
            if let Some(thread) = handle.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

// ========== Audio Preview State ==========

struct PreviewHandle {
    should_stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

pub struct AudioPreviewState {
    handle: Mutex<Option<PreviewHandle>>,
}

impl AudioPreviewState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }

    pub fn shutdown(&self) {
        stop_audio_preview_inner(self);
    }
}

fn stop_audio_preview_inner(state: &AudioPreviewState) {
    if let Ok(mut guard) = state.handle.lock() {
        if let Some(mut handle) = guard.take() {
            handle.should_stop.store(true, Ordering::SeqCst);
            if let Some(thread) = handle.thread.take() {
                let _ = thread.join();
            }
            println!("[audio-preview] Preview stopped and thread joined");
        }
    }
}

#[command]
pub fn start_audio_preview(
    app: AppHandle,
    preview_state: State<'_, AudioPreviewState>,
    device_name: String,
) -> Result<(), String> {
    // 如果錄音正在進行中，不啟動預覽（AC 11）
    if let Some(recorder_state) = app.try_state::<AudioRecorderState>() {
        if let Ok(guard) = recorder_state.recording.lock() {
            if guard.is_some() {
                println!("[audio-preview] Recording in progress, skipping preview start");
                return Ok(());
            }
        }
    }

    // 停止舊的 preview（join thread 確保裝置完全釋放）
    stop_audio_preview_inner(&preview_state);

    let should_stop = Arc::new(AtomicBool::new(false));
    let should_stop_for_thread = should_stop.clone();

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    let thread = std::thread::Builder::new()
        .name("audio-preview".to_string())
        .spawn(move || {
            run_preview_thread(app, should_stop_for_thread, device_name, ready_tx);
        })
        .map_err(|e| format!("Thread spawn failed: {e}"))?;

    // 等待 stream 建立成功/失敗
    match ready_rx.recv() {
        Ok(Ok(())) => {
            let mut guard = preview_state
                .handle
                .lock()
                .map_err(|_| "Lock poisoned".to_string())?;
            *guard = Some(PreviewHandle {
                should_stop,
                thread: Some(thread),
            });
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            let _ = thread.join();
            Err("Preview thread exited unexpectedly".to_string())
        }
    }
}

#[command]
pub fn stop_audio_preview(preview_state: State<'_, AudioPreviewState>) {
    stop_audio_preview_inner(&preview_state);
}

// ========== FFT Constants ==========

const FFT_SIZE: usize = 64;
/// Bin indices in the order the frontend expects for display
const FREQUENCY_BIN_PICK_INDEX_LIST: [usize; 6] = [9, 4, 1, 2, 6, 12];
const DB_FLOOR: f32 = -100.0;
const DB_CEILING: f32 = -20.0;
const WAVEFORM_EMIT_INTERVAL_MS: u128 = 16;

fn normalize_db(db: f32) -> f32 {
    ((db - DB_FLOOR) / (DB_CEILING - DB_FLOOR)).clamp(0.0, 1.0)
}

struct InputConfigSelection {
    supported_config: cpal::SupportedStreamConfig,
    sample_rate: u32,
    channels: u16,
}

// ========== Device Enumeration ==========

#[derive(Clone, serde::Serialize)]
pub struct AudioInputDeviceInfo {
    name: String,
}

#[command]
pub fn list_audio_input_devices() -> Vec<AudioInputDeviceInfo> {
    let host = cpal::default_host();
    let mut device_list = Vec::new();

    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                device_list.push(AudioInputDeviceInfo { name });
            }
        }
    }

    println!(
        "[audio-recorder] Listed {} input device(s)",
        device_list.len()
    );
    device_list
}

// ========== Device Query ==========

#[command]
pub fn get_default_input_device_name() -> Option<String> {
    let host = cpal::default_host();
    let result = host.default_input_device().and_then(|d| {
        d.name()
            .map_err(|e| {
                eprintln!("[audio-recorder] Failed to get default device name: {e}");
                e
            })
            .ok()
    });
    println!("[audio-recorder] Default input device: {result:?}");
    result
}

// ========== Commands ==========

#[command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, AudioRecorderState>,
    device_name: String,
) -> Result<(), AudioRecorderError> {
    // 先取得 recording lock，防止 preview 在此期間重啟（F1+F7 race fix）
    let mut guard = state
        .recording
        .lock()
        .map_err(|_| AudioRecorderError::LockPoisoned)?;

    if guard.is_some() {
        println!("[audio-recorder] Already recording, ignoring start_recording");
        return Ok(());
    }

    // 停止音量預覽（持有 recording lock，防止 preview 重啟）
    if let Some(preview_state) = app.try_state::<AudioPreviewState>() {
        stop_audio_preview_inner(&preview_state);
    }

    // Pre-allocate ~30 seconds at 16kHz (480,000 i16 samples ≈ 938KB)
    let inner = Arc::new(RecordingInner {
        samples: Mutex::new(Vec::with_capacity(16000 * 30)),
        should_stop: AtomicBool::new(false),
    });

    let inner_for_thread = inner.clone();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, AudioRecorderError>>();
    let start_time = Instant::now();

    let device_name_for_thread = device_name;
    let thread = std::thread::Builder::new()
        .name("audio-recorder".to_string())
        .spawn(move || {
            run_recording_thread(app, inner_for_thread, ready_tx, device_name_for_thread);
        })
        .map_err(|e| AudioRecorderError::BuildStream(format!("Thread spawn failed: {e}")))?;

    // Wait for the recording thread to report success or failure
    match ready_rx.recv() {
        Ok(Ok(sample_rate)) => {
            *guard = Some(RecordingHandle {
                inner,
                thread: Some(thread),
                start_time,
                sample_rate,
            });
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            let _ = thread.join();
            Err(AudioRecorderError::BuildStream(
                "Recording thread exited unexpectedly".to_string(),
            ))
        }
    }
}

#[command]
pub fn stop_recording(
    state: State<'_, AudioRecorderState>,
) -> Result<StopRecordingResult, AudioRecorderError> {
    let mut guard = state
        .recording
        .lock()
        .map_err(|_| AudioRecorderError::LockPoisoned)?;

    let mut handle = guard.take().ok_or(AudioRecorderError::NotRecording)?;
    let recording_duration_ms = handle.start_time.elapsed().as_secs_f64() * 1000.0;

    // Signal the recording thread to stop
    handle.inner.should_stop.store(true, Ordering::SeqCst);

    // Wait for the thread to finish (drops the cpal Stream → releases microphone)
    if let Some(thread) = handle.thread.take() {
        let _ = thread.join();
    }

    // Take the collected samples
    let samples = handle
        .inner
        .samples
        .lock()
        .map_err(|_| AudioRecorderError::LockPoisoned)?;

    // Encode WAV in memory
    let wav_data = encode_wav(&samples, handle.sample_rate)?;

    // Calculate peak & RMS energy levels (0.0 = silence, 1.0 = max volume)
    let (peak_energy_level, rms_energy_level) = if samples.is_empty() {
        (0.0_f32, 0.0_f32)
    } else {
        let mut peak = 0.0_f32;
        let mut sum_squares = 0.0_f64;
        for &s in samples.iter() {
            let abs_normalized = (s as f32).abs() / i16::MAX as f32;
            peak = peak.max(abs_normalized);
            let norm_f64 = s as f64 / i16::MAX as f64;
            sum_squares += norm_f64 * norm_f64;
        }
        let rms = (sum_squares / samples.len() as f64).sqrt() as f32;
        (peak, rms)
    };

    println!(
        "[audio-recorder] WAV encoded: {} samples, {} bytes, {:.0}ms, peakEnergy={:.4}, rmsEnergy={:.4}",
        samples.len(),
        wav_data.len(),
        recording_duration_ms,
        peak_energy_level,
        rms_energy_level,
    );

    // Store WAV buffer for transcription to consume
    let mut wav_guard = state
        .wav_buffer
        .lock()
        .map_err(|_| AudioRecorderError::LockPoisoned)?;
    *wav_guard = Some(wav_data);

    Ok(StopRecordingResult {
        recording_duration_ms,
        peak_energy_level,
        rms_energy_level,
    })
}

// ========== Recording Thread ==========

fn run_recording_thread(
    app: AppHandle,
    inner: Arc<RecordingInner>,
    ready_tx: std::sync::mpsc::Sender<Result<u32, AudioRecorderError>>,
    device_name: String,
) {
    // ── Get input device ──
    let host = cpal::default_host();
    let device = match select_input_device(&host, &device_name, "audio-recorder") {
        Some(d) => d,
        None => {
            let _ = ready_tx.send(Err(AudioRecorderError::NoInputDevice));
            return;
        }
    };
    println!(
        "[audio-recorder] Using device: {}",
        device.name().unwrap_or_else(|_| "<unknown>".to_string())
    );

    // ── Determine config (prefer 16 kHz mono, fallback to device default) ──
    let selection = match determine_input_config(&device) {
        Ok(c) => c,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    let sample_rate = selection.sample_rate;
    let channels = selection.channels;

    let stream = match build_input_stream(&device, &selection.supported_config, inner.clone(), app)
    {
        Ok(stream) => stream,
        Err(error) => {
            let _ = ready_tx.send(Err(error));
            return;
        }
    };

    // ── Play ──
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(AudioRecorderError::PlayStream(e.to_string())));
        return;
    }

    println!(
        "[audio-recorder] Recording started ({sample_rate}Hz, {channels}ch)"
    );
    let _ = ready_tx.send(Ok(sample_rate));

    // ── Keep stream alive until told to stop ──
    while !inner.should_stop.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // 顯式 pause：呼叫 AudioOutputUnitStop 停止麥克風捕獲。
    // 兜底防禦 cpal macOS disconnect listener 的 Arc 循環引用——
    // 即使 Arc cycle 導致 drop 無法觸發 AudioUnit 清理，pause 也能確保麥克風停止。
    // 已知限制：非預設裝置仍會因 Arc cycle 洩漏 ~1-2 KB/次（StreamInner + listener）。
    if let Err(e) = stream.pause() {
        // ⚠️ 安全相關：pause 失敗意味著麥克風可能仍在捕獲，且 drop 也無法停止
        eprintln!("[audio-recorder] SECURITY: Failed to pause stream, mic may remain active: {e:?}");
    }
    drop(stream);
    println!("[audio-recorder] Recording stopped, stream released");
}

// ========== Preview Thread ==========

const PREVIEW_EMIT_INTERVAL_MS: u64 = 30;
/// 預覽音量的 dB 映射範圍：-60 dB → 0%, -20 dB → 100%
/// AirPods Pro 等低增益麥克風的語音 RMS 約 0.005~0.018（-46 ~ -35 dB）
const PREVIEW_DB_FLOOR: f32 = -60.0;
const PREVIEW_DB_CEILING: f32 = -20.0;

fn run_preview_thread(
    app: AppHandle,
    should_stop: Arc<AtomicBool>,
    device_name: String,
    ready_tx: std::sync::mpsc::Sender<Result<(), String>>,
) {
    // ── 裝置選擇 ──
    let host = cpal::default_host();
    let device = match select_input_device(&host, &device_name, "audio-preview") {
        Some(d) => d,
        None => {
            let _ = ready_tx.send(Err("No input device available".to_string()));
            return;
        }
    };

    println!(
        "[audio-preview] Using device: '{}' (requested: '{}')",
        device.name().unwrap_or_else(|_| "<unknown>".to_string()),
        if device_name.is_empty() { "<system-default>" } else { &device_name }
    );

    // ── 輸入格式 ──
    let selection = match determine_input_config(&device) {
        Ok(c) => c,
        Err(e) => {
            let _ = ready_tx.send(Err(e.to_string()));
            return;
        }
    };
    let channels = selection.channels as usize;

    // ── 建立 preview stream ──
    // 使用單一 Mutex 確保 sum_squares 和 sample_count 的原子讀寫（F4 fix）
    let accumulator = Arc::new(Mutex::new((0.0f64, 0usize)));
    let accumulator_for_callback = accumulator.clone();

    let sample_format = selection.supported_config.sample_format();
    let config = selection.supported_config.config();

    let build_result = match sample_format {
        cpal::SampleFormat::I8 => build_preview_stream::<i8>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::I16 => build_preview_stream::<i16>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::I32 => build_preview_stream::<i32>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::I64 => build_preview_stream::<i64>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::U8 => build_preview_stream::<u8>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::U16 => build_preview_stream::<u16>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::U32 => build_preview_stream::<u32>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::U64 => build_preview_stream::<u64>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::F32 => build_preview_stream::<f32>(&device, &config, channels, accumulator_for_callback),
        cpal::SampleFormat::F64 => build_preview_stream::<f64>(&device, &config, channels, accumulator_for_callback),
        other => Err(format!("Unsupported sample format: {other}")),
    };

    let stream = match build_result {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };

    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(format!("Failed to play preview stream: {e}")));
        return;
    }

    println!("[audio-preview] Preview started");
    let _ = ready_tx.send(Ok(()));

    // ── 主迴圈：每 30ms 計算 RMS 並 emit ──
    while !should_stop.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(PREVIEW_EMIT_INTERVAL_MS));

        let (ss, count) = {
            let mut guard = match accumulator.lock() {
                Ok(g) => g,
                Err(_) => break,
            };
            let snapshot = *guard;
            *guard = (0.0, 0);
            snapshot
        };

        // 計算 RMS → dB → 正規化到 0.0~1.0
        // 線性 RMS 對語音太低（正常說話 ~0.03），dB 尺度才符合人耳感知
        let level = if count > 0 {
            let rms = (ss / count as f64).sqrt() as f32;
            if rms > 0.0 {
                let db = 20.0 * rms.log10();
                ((db - PREVIEW_DB_FLOOR) / (PREVIEW_DB_CEILING - PREVIEW_DB_FLOOR)).clamp(0.0, 1.0)
            } else {
                0.0
            }
        } else {
            0.0
        };

        let _ = app.emit("audio:preview-level", AudioPreviewLevelPayload { level });
    }

    // ── 清理（遵循 cpal macOS workaround） ──
    if let Err(e) = stream.pause() {
        eprintln!("[audio-preview] Failed to pause preview stream: {e:?}");
    }
    drop(stream);
    println!("[audio-preview] Preview stopped, stream released");
}

fn build_preview_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    accumulator: Arc<Mutex<(f64, usize)>>,
) -> Result<cpal::Stream, String>
where
    T: cpal::Sample + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut local_sum = 0.0f64;
                let mut local_count = 0usize;

                for chunk in data.chunks(channels) {
                    // F6 fix: clamp 防止 F32/F64 原生格式超出 [-1, 1]
                    let mono = if channels > 1 {
                        (chunk
                            .iter()
                            .map(|sample| sample.to_sample::<f32>())
                            .sum::<f32>()
                            / channels as f32)
                            .clamp(-1.0, 1.0)
                    } else {
                        chunk[0].to_sample::<f32>().clamp(-1.0, 1.0)
                    };

                    local_sum += (mono as f64) * (mono as f64);
                    local_count += 1;
                }

                if let Ok(mut guard) = accumulator.lock() {
                    guard.0 += local_sum;
                    guard.1 += local_count;
                }
            },
            move |err| {
                eprintln!("[audio-preview] Stream error: {err}");
            },
            None,
        )
        .map_err(|e| format!("Failed to build preview stream: {e}"))
}

// ========== Device Selection ==========

/// 共用裝置選擇邏輯（F10 fix: 消除 recording/preview 間的重複）
/// WORKAROUND: cpal 0.15.3 macOS CoreAudio 的 Arc cycle — 優先 default_input_device() 路徑
fn select_input_device(
    host: &cpal::Host,
    device_name: &str,
    tag: &str,
) -> Option<cpal::Device> {
    if device_name.is_empty() {
        host.default_input_device()
    } else {
        let default_device = host.default_input_device();
        let default_matches = default_device
            .as_ref()
            .and_then(|d| d.name().ok())
            .is_some_and(|n| n == device_name);

        if default_matches {
            println!(
                "[{tag}] Device '{device_name}' matches system default, using default_input_device"
            );
            default_device
        } else {
            let found = host
                .input_devices()
                .ok()
                .and_then(|mut devices| {
                    devices.find(|d| d.name().is_ok_and(|n| n == device_name))
                });
            if found.is_none() {
                println!(
                    "[{tag}] Device '{device_name}' not found, falling back to default"
                );
            }
            found.or(default_device)
        }
    }
}

// ========== Input Config ==========

fn determine_input_config(
    device: &cpal::Device,
) -> Result<InputConfigSelection, AudioRecorderError> {
    // Try 16 kHz mono first — smallest WAV, ideal for speech
    if let Ok(configs) = device.supported_input_configs() {
        let preferred = configs
            .filter(|range| {
                range.min_sample_rate().0 <= 16000 && range.max_sample_rate().0 >= 16000
            })
            .min_by_key(|range| {
                let mono_penalty = if range.channels() == 1 { 0 } else { 1 };
                (mono_penalty, range.channels())
            });

        if let Some(range) = preferred {
            let supported_config = range.with_sample_rate(cpal::SampleRate(16000));
            return Ok(InputConfigSelection {
                sample_rate: 16000,
                channels: supported_config.channels(),
                supported_config,
            });
        }
    }

    // Fallback: device default
    let supported_config = device
        .default_input_config()
        .map_err(|e| AudioRecorderError::InputConfig(e.to_string()))?;

    let sr = supported_config.sample_rate().0;
    let ch = supported_config.channels();

    println!(
        "[audio-recorder] 16 kHz not supported, using device default: {sr}Hz, {ch}ch"
    );

    Ok(InputConfigSelection {
        supported_config,
        sample_rate: sr,
        channels: ch,
    })
}

fn build_input_stream(
    device: &cpal::Device,
    supported_config: &cpal::SupportedStreamConfig,
    inner: Arc<RecordingInner>,
    app: AppHandle,
) -> Result<cpal::Stream, AudioRecorderError> {
    let sample_format = supported_config.sample_format();
    let config = supported_config.config();
    let channels = config.channels;

    match sample_format {
        cpal::SampleFormat::I8 => {
            build_typed_input_stream::<i8>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::I16 => {
            build_typed_input_stream::<i16>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::I32 => {
            build_typed_input_stream::<i32>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::I64 => {
            build_typed_input_stream::<i64>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::U8 => {
            build_typed_input_stream::<u8>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::U16 => {
            build_typed_input_stream::<u16>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::U32 => {
            build_typed_input_stream::<u32>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::U64 => {
            build_typed_input_stream::<u64>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::F32 => {
            build_typed_input_stream::<f32>(device, &config, channels, inner, app)
        }
        cpal::SampleFormat::F64 => {
            build_typed_input_stream::<f64>(device, &config, channels, inner, app)
        }
        other => Err(AudioRecorderError::BuildStream(format!(
            "Unsupported sample format: {other}"
        ))),
    }
}

fn build_typed_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: u16,
    inner: Arc<RecordingInner>,
    app: AppHandle,
) -> Result<cpal::Stream, AudioRecorderError>
where
    T: cpal::Sample + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let inner_for_callback = inner;
    let app_for_callback = app;
    let chunk_size = channels as usize;

    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_SIZE);
    let mut ring_buffer = vec![0.0f32; FFT_SIZE];
    let mut fft_scratch = vec![Complex::new(0.0f32, 0.0); FFT_SIZE];
    let mut ring_pos: usize = 0;
    let mut last_emit = Instant::now();
    let mut total_mono_samples: usize = 0;
    let mut mono_batch: Vec<i16> = Vec::with_capacity(1024);

    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                mono_batch.clear();

                for chunk in data.chunks(chunk_size) {
                    let mono = if chunk_size > 1 {
                        chunk
                            .iter()
                            .map(|sample| sample.to_sample::<f32>())
                            .sum::<f32>()
                            / chunk_size as f32
                    } else {
                        chunk[0].to_sample::<f32>()
                    };

                    let sample =
                        (mono * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                    mono_batch.push(sample);

                    ring_buffer[ring_pos] = mono;
                    ring_pos = (ring_pos + 1) % FFT_SIZE;
                    total_mono_samples += 1;
                }

                if let Ok(mut samples) = inner_for_callback.samples.lock() {
                    samples.extend_from_slice(&mono_batch);
                }

                if total_mono_samples >= FFT_SIZE
                    && last_emit.elapsed().as_millis() >= WAVEFORM_EMIT_INTERVAL_MS
                {
                    for (index, &sample) in ring_buffer.iter().enumerate() {
                        fft_scratch[index] = Complex::new(sample, 0.0);
                    }
                    fft.process(&mut fft_scratch);

                    let mut levels = [0.0f32; 6];
                    for (index, &bin_idx) in FREQUENCY_BIN_PICK_INDEX_LIST.iter().enumerate() {
                        if bin_idx < fft_scratch.len() {
                            let magnitude = fft_scratch[bin_idx].norm() / FFT_SIZE as f32;
                            let db = if magnitude > 0.0 {
                                20.0 * magnitude.log10()
                            } else {
                                DB_FLOOR
                            };
                            levels[index] = normalize_db(db);
                        }
                    }

                    let _ = app_for_callback.emit("audio:waveform", WaveformPayload { levels });
                    last_emit = Instant::now();
                }
            },
            move |err| {
                eprintln!("[audio-recorder] Stream error: {err}");
            },
            None,
        )
        .map_err(|e| AudioRecorderError::BuildStream(e.to_string()))
}

// ========== WAV Encoding ==========

fn encode_wav(samples: &[i16], sample_rate: u32) -> Result<Vec<u8>, AudioRecorderError> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut buffer = Cursor::new(Vec::with_capacity(samples.len() * 2 + 44));
    {
        let mut writer = hound::WavWriter::new(&mut buffer, spec)
            .map_err(|e| AudioRecorderError::WavEncode(e.to_string()))?;
        for &sample in samples {
            writer
                .write_sample(sample)
                .map_err(|e| AudioRecorderError::WavEncode(e.to_string()))?;
        }
        writer
            .finalize()
            .map_err(|e| AudioRecorderError::WavEncode(e.to_string()))?;
    }

    Ok(buffer.into_inner())
}

// ========== Recording File Management Commands ==========

#[command]
pub fn save_recording_file(
    id: String,
    app: AppHandle,
    state: State<'_, AudioRecorderState>,
) -> Result<String, String> {
    let wav_data = state
        .wav_buffer
        .lock()
        .map_err(|e| format!("Failed to lock wav_buffer: {e}"))?
        .clone()
        .ok_or_else(|| "No WAV data available".to_string())?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings dir: {e}"))?;

    let file_path = recordings_dir.join(format!("{id}.wav"));
    std::fs::write(&file_path, &wav_data)
        .map_err(|e| format!("Failed to write WAV file: {e}"))?;

    println!(
        "[audio-recorder] Recording saved: {} ({} bytes)",
        file_path.display(),
        wav_data.len()
    );

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn read_recording_file(id: String, app: AppHandle) -> Result<Response, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let file_path = app_data_dir.join("recordings").join(format!("{id}.wav"));
    let data = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read recording file: {e}"))?;
    Ok(Response::new(data))
}

#[command]
pub fn delete_all_recordings(app: AppHandle) -> Result<u32, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let recordings_dir = app_data_dir.join("recordings");
    if !recordings_dir.exists() {
        return Ok(0);
    }

    let mut count = 0u32;
    for entry in std::fs::read_dir(&recordings_dir)
        .map_err(|e| format!("Failed to read recordings dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "wav") {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
            count += 1;
        }
    }

    println!("[audio-recorder] Deleted {count} recording files");
    Ok(count)
}

#[command]
pub fn cleanup_old_recordings(days: u32, app: AppHandle) -> Result<Vec<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;

    let recordings_dir = app_data_dir.join("recordings");
    if !recordings_dir.exists() {
        return Ok(vec![]);
    }

    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(u64::from(days) * 24 * 60 * 60);

    let mut deleted_id_list: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&recordings_dir)
        .map_err(|e| format!("Failed to read recordings dir: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "wav") {
            continue;
        }
        let metadata =
            std::fs::metadata(&path).map_err(|e| format!("Failed to get metadata: {e}"))?;
        let modified = metadata
            .modified()
            .map_err(|e| format!("Failed to get modified time: {e}"))?;
        if modified < cutoff {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                deleted_id_list.push(stem.to_string());
            }
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
        }
    }

    println!(
        "[audio-recorder] Cleaned up {} old recordings (>{} days)",
        deleted_id_list.len(),
        days
    );
    Ok(deleted_id_list)
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_db_floor() {
        assert_eq!(normalize_db(-100.0), 0.0);
    }

    #[test]
    fn test_normalize_db_ceiling() {
        assert_eq!(normalize_db(-20.0), 1.0);
    }

    #[test]
    fn test_normalize_db_midpoint() {
        let result = normalize_db(-60.0);
        assert!((result - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_normalize_db_below_floor() {
        assert_eq!(normalize_db(-200.0), 0.0);
    }

    #[test]
    fn test_normalize_db_above_ceiling() {
        assert_eq!(normalize_db(0.0), 1.0);
    }

    #[test]
    fn test_encode_wav_basic() {
        let samples = vec![0i16, 1000, -1000, 32767, -32768];
        let wav = encode_wav(&samples, 16000).unwrap();

        // WAV header is 44 bytes, data: 5 samples * 2 bytes = 10 bytes
        assert_eq!(wav.len(), 44 + 10);

        // Check RIFF header
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }

    #[test]
    fn test_encode_wav_empty() {
        let samples: Vec<i16> = vec![];
        let wav = encode_wav(&samples, 16000).unwrap();
        assert_eq!(wav.len(), 44); // Header only
    }

    #[test]
    fn test_encode_wav_sample_rate_preserved() {
        let samples = vec![100i16; 16000]; // 1 second at 16 kHz
        let wav = encode_wav(&samples, 48000).unwrap();

        // Check sample rate in WAV header (bytes 24-27, little-endian u32)
        let sr = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
        assert_eq!(sr, 48000);
    }

    #[test]
    fn test_audio_recorder_state_new() {
        let state = AudioRecorderState::new();
        assert!(state.recording.lock().unwrap().is_none());
        assert!(state.wav_buffer.lock().unwrap().is_none());
    }

    #[test]
    fn test_audio_preview_state_new() {
        let state = AudioPreviewState::new();
        assert!(state.handle.lock().unwrap().is_none());
    }

    #[test]
    fn test_audio_preview_state_shutdown_no_panic() {
        let state = AudioPreviewState::new();
        state.shutdown(); // 無 handle 時 shutdown 不 panic
    }

    #[test]
    fn test_audio_preview_state_double_shutdown() {
        let state = AudioPreviewState::new();
        // 模擬有 active preview（不含 thread，僅測試 flag + take 行為）
        {
            let mut guard = state.handle.lock().unwrap();
            *guard = Some(PreviewHandle {
                should_stop: Arc::new(AtomicBool::new(false)),
                thread: None,
            });
        }
        state.shutdown(); // take() + set flag
        state.shutdown(); // handle 已 None，不 panic
    }

    #[test]
    fn test_audio_preview_state_stop_flag_propagation() {
        let state = AudioPreviewState::new();
        let flag = Arc::new(AtomicBool::new(false));
        {
            let mut guard = state.handle.lock().unwrap();
            *guard = Some(PreviewHandle {
                should_stop: flag.clone(),
                thread: None,
            });
        }
        state.shutdown();
        assert!(flag.load(Ordering::SeqCst));
        // shutdown uses take(), so handle should be None now
        assert!(state.handle.lock().unwrap().is_none());
    }
}
