use std::io::Cursor;
use std::sync::Mutex;
use std::time::Instant;

use tauri::{command, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const MINIMUM_AUDIO_SIZE: usize = 1000;
const TARGET_SAMPLE_RATE: u32 = 16000;

// ========== State ==========

struct WhisperEngine {
    context: WhisperContext,
}

// Safety: WhisperContext is internally thread-safe for read operations.
// We wrap the entire engine in a Mutex to ensure exclusive access during inference.
unsafe impl Send for WhisperEngine {}
unsafe impl Sync for WhisperEngine {}

pub struct LocalTranscriptionState {
    engine: Mutex<Option<WhisperEngine>>,
    model_path: Mutex<Option<String>>,
}

impl LocalTranscriptionState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            model_path: Mutex::new(None),
        }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum LocalTranscriptionError {
    #[error("No audio data available — call stop_recording first")]
    NoAudioData,
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("No local model loaded — call load_local_model first")]
    NoModelLoaded,
    #[error("Failed to load model: {0}")]
    ModelLoadFailed(String),
    #[error("Failed to read WAV data: {0}")]
    WavReadFailed(String),
    #[error("Transcription failed: {0}")]
    TranscriptionFailed(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for LocalTranscriptionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Result Types ==========

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub is_loaded: bool,
    pub model_path: Option<String>,
}

// ========== Audio Helpers ==========

/// Read WAV bytes from memory and convert to f32 samples.
/// Handles resampling if the source sample rate differs from 16kHz.
fn wav_bytes_to_samples(wav_data: &[u8]) -> Result<Vec<f32>, LocalTranscriptionError> {
    let cursor = Cursor::new(wav_data);
    let mut reader = hound::WavReader::new(cursor)
        .map_err(|e| LocalTranscriptionError::WavReadFailed(e.to_string()))?;

    let spec = reader.spec();
    let source_sample_rate = spec.sample_rate;

    // Read i16 samples and convert to f32
    let samples_i16: Vec<i16> = reader
        .samples::<i16>()
        .map(|s| s.map_err(|e| LocalTranscriptionError::WavReadFailed(e.to_string())))
        .collect::<Result<Vec<_>, _>>()?;

    let mut samples_f32: Vec<f32> = samples_i16
        .iter()
        .map(|&s| s as f32 / i16::MAX as f32)
        .collect();

    // Resample to 16kHz if needed
    if source_sample_rate != TARGET_SAMPLE_RATE {
        samples_f32 = resample(&samples_f32, source_sample_rate, TARGET_SAMPLE_RATE);
        println!(
            "[local-transcription] Resampled {}Hz -> {}Hz ({} -> {} samples)",
            source_sample_rate,
            TARGET_SAMPLE_RATE,
            samples_i16.len(),
            samples_f32.len()
        );
    }

    Ok(samples_f32)
}

/// Simple linear interpolation resampler.
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = (src_pos - src_idx as f64) as f32;

        if src_idx + 1 < samples.len() {
            output.push(samples[src_idx] * (1.0 - frac) + samples[src_idx + 1] * frac);
        } else if src_idx < samples.len() {
            output.push(samples[src_idx]);
        }
    }

    output
}

// ========== Commands ==========

#[command]
pub fn load_local_model(
    state: State<'_, LocalTranscriptionState>,
    model_path: String,
) -> Result<(), LocalTranscriptionError> {
    println!("[local-transcription] Loading model: {}", model_path);

    let context = WhisperContext::new_with_params(
        &model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| LocalTranscriptionError::ModelLoadFailed(e.to_string()))?;

    let engine = WhisperEngine { context };

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
    *engine_guard = Some(engine);

    let mut path_guard = state
        .model_path
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
    *path_guard = Some(model_path);

    println!("[local-transcription] Model loaded successfully");
    Ok(())
}

#[command]
pub fn unload_local_model(
    state: State<'_, LocalTranscriptionState>,
) -> Result<(), LocalTranscriptionError> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
    *engine_guard = None;

    let mut path_guard = state
        .model_path
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
    *path_guard = None;

    println!("[local-transcription] Model unloaded");
    Ok(())
}

#[command]
pub fn get_local_model_status(
    state: State<'_, LocalTranscriptionState>,
) -> Result<LocalModelStatus, LocalTranscriptionError> {
    let engine_guard = state
        .engine
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
    let path_guard = state
        .model_path
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;

    Ok(LocalModelStatus {
        is_loaded: engine_guard.is_some(),
        model_path: path_guard.clone(),
    })
}

#[command]
pub fn transcribe_audio_local(
    recorder_state: State<'_, AudioRecorderState>,
    local_state: State<'_, LocalTranscriptionState>,
    language: Option<String>,
    vocabulary_term_list: Option<Vec<String>>,
) -> Result<LocalTranscriptionResult, LocalTranscriptionError> {
    // Take WAV data from shared state (consume it)
    let wav_data = {
        let mut guard = recorder_state
            .wav_buffer
            .lock()
            .map_err(|_| LocalTranscriptionError::LockPoisoned)?;
        guard.take().ok_or(LocalTranscriptionError::NoAudioData)?
    };

    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(LocalTranscriptionError::AudioTooSmall(wav_data.len()));
    }

    // Convert WAV bytes to f32 samples
    let samples = wav_bytes_to_samples(&wav_data)?;

    println!(
        "[local-transcription] Processing {} samples ({:.1}s at 16kHz)",
        samples.len(),
        samples.len() as f64 / TARGET_SAMPLE_RATE as f64
    );

    let start_time = Instant::now();

    // Build initial prompt from vocabulary terms
    let initial_prompt = vocabulary_term_list
        .as_ref()
        .filter(|terms| !terms.is_empty())
        .map(|terms| {
            let limited: Vec<&str> = terms.iter().take(50).map(|s| s.as_str()).collect();
            format!("Important Vocabulary: {}", limited.join(", "))
        });

    // Run inference under the engine lock
    let mut engine_guard = local_state
        .engine
        .lock()
        .map_err(|_| LocalTranscriptionError::LockPoisoned)?;

    let engine = engine_guard
        .as_mut()
        .ok_or(LocalTranscriptionError::NoModelLoaded)?;

    // Create a new state for this inference
    let mut state = engine
        .context
        .create_state()
        .map_err(|e| LocalTranscriptionError::TranscriptionFailed(e.to_string()))?;

    let mut full_params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 3,
        patience: -1.0,
    });

    full_params.set_language(language.as_deref());
    full_params.set_translate(false);
    full_params.set_print_special(false);
    full_params.set_print_progress(false);
    full_params.set_print_realtime(false);
    full_params.set_print_timestamps(false);
    full_params.set_suppress_blank(true);
    full_params.set_suppress_non_speech_tokens(true);
    full_params.set_no_speech_thold(0.6);

    if let Some(ref p) = initial_prompt {
        full_params.set_initial_prompt(p);
    }

    state
        .full(full_params, &samples)
        .map_err(|e| LocalTranscriptionError::TranscriptionFailed(e.to_string()))?;

    let num_segments = state
        .full_n_segments()
        .map_err(|e| LocalTranscriptionError::TranscriptionFailed(e.to_string()))?;

    let mut full_text = String::new();
    let mut max_no_speech_prob: f64 = 0.0;

    for i in 0..num_segments {
        let text = state
            .full_get_segment_text(i)
            .map_err(|e| LocalTranscriptionError::TranscriptionFailed(e.to_string()))?;
        full_text.push_str(&text);
    }

    // If no segments, treat as full silence
    if num_segments == 0 {
        max_no_speech_prob = 1.0;
    }

    let raw_text = full_text.trim().to_string();
    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;

    println!(
        "[local-transcription] Done in {:.0}ms: \"{}\"",
        transcription_duration_ms, raw_text
    );

    Ok(LocalTranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability: max_no_speech_prob,
    })
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_same_rate() {
        let samples = vec![0.0, 0.5, 1.0, 0.5, 0.0];
        let result = resample(&samples, 16000, 16000);
        assert_eq!(result, samples);
    }

    #[test]
    fn test_resample_downsample() {
        // 48kHz -> 16kHz (3:1 ratio)
        let samples: Vec<f32> = (0..48).map(|i| (i as f32) / 48.0).collect();
        let result = resample(&samples, 48000, 16000);
        assert_eq!(result.len(), 16);
    }

    #[test]
    fn test_resample_empty() {
        let result = resample(&[], 48000, 16000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_local_transcription_result_serialization() {
        let result = LocalTranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: 0.01,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\""));
    }

    #[test]
    fn test_local_model_status_serialization() {
        let status = LocalModelStatus {
            is_loaded: true,
            model_path: Some("/path/to/model.bin".to_string()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"isLoaded\""));
        assert!(json.contains("\"modelPath\""));
    }
}
