use std::time::Instant;

use tauri::{command, State};

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_WHISPER_PROMPT_TERMS: usize = 50;
const MINIMUM_AUDIO_SIZE: usize = 1000;
const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
const REQUEST_TIMEOUT_SECS: u64 = 30;

// ========== State ==========

pub struct TranscriptionState {
    client: reqwest::Client,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to build HTTP client");
        Self { client }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("No audio data available — call stop_recording first")]
    NoAudioData,
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("API key is missing")]
    ApiKeyMissing,
    #[error("Groq API request failed: {0}")]
    RequestFailed(String),
    #[error("Groq API returned error ({0}): {1}")]
    ApiError(u16, String),
    #[error("Failed to parse API response: {0}")]
    ParseError(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for TranscriptionError {
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
pub struct TranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: f64,
}

// ========== Groq API Response ==========

#[derive(serde::Deserialize)]
struct WhisperVerboseResponse {
    text: String,
    segments: Vec<WhisperSegment>,
}

#[derive(serde::Deserialize)]
struct WhisperSegment {
    no_speech_prob: f64,
}

// ========== Helpers ==========

fn format_whisper_prompt(term_list: &[String]) -> String {
    let terms: Vec<&str> = term_list
        .iter()
        .take(MAX_WHISPER_PROMPT_TERMS)
        .map(|s| s.as_str())
        .collect();
    format!("Important Vocabulary: {}", terms.join(", "))
}

// ========== Shared Transcription Logic ==========

async fn send_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(TranscriptionError::AudioTooSmall(wav_data.len()));
    }

    let model = model_id.unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    println!(
        "[transcription] Sending {} bytes WAV to Groq API (model={})",
        wav_data.len(),
        model
    );

    let start_time = Instant::now();

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model)
        .text("response_format", "verbose_json");

    // Conditionally add language — None means auto-detect
    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    if let Some(ref terms) = vocabulary_term_list {
        if !terms.is_empty() {
            let prompt = format_whisper_prompt(terms);
            form = form.text("prompt", prompt);
        }
    }

    // Send request (reuse shared client for connection pooling)
    let response = transcription_state
        .client
        .post(GROQ_API_URL)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        return Err(TranscriptionError::ApiError(status, body));
    }

    // Parse response
    let json: WhisperVerboseResponse = response
        .json()
        .await
        .map_err(|e| TranscriptionError::ParseError(e.to_string()))?;

    let raw_text = json.text.trim().to_string();
    // Use MIN: if any segment detects speech (low NSP), trust it — real speech
    // always produces at least one low-NSP segment, while pure noise/hallucination
    // keeps all segments high.
    let no_speech_probability = json
        .segments
        .iter()
        .map(|s| s.no_speech_prob)
        .fold(1.0_f64, f64::min);
    // If no segments, treat as full silence
    let no_speech_probability = if json.segments.is_empty() {
        1.0
    } else {
        no_speech_probability
    };

    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;

    println!(
        "[transcription] Response in {:.0}ms: \"{}\" (noSpeechProb={:.3})",
        transcription_duration_ms, raw_text, no_speech_probability
    );

    Ok(TranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability,
    })
}

// ========== Commands ==========

#[command]
pub async fn transcribe_audio(
    state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // Take WAV data from shared state (consume it)
    let wav_data = {
        let mut guard = state
            .wav_buffer
            .lock()
            .map_err(|_| TranscriptionError::LockPoisoned)?;
        guard.take().ok_or(TranscriptionError::NoAudioData)?
    };

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
    )
    .await
}

#[command]
pub async fn retranscribe_from_file(
    transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // 注意：std::fs::read 是同步 I/O，但 WAV 檔案通常很小（< 1MB），
    // 在 Tauri command 的 async context 中可接受。
    let wav_data = std::fs::read(&file_path).map_err(|e| {
        TranscriptionError::RequestFailed(format!("Failed to read WAV file: {}", e))
    })?;

    println!(
        "[transcription] Retranscribing from file: {} ({} bytes)",
        file_path,
        wav_data.len()
    );

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
    )
    .await
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_whisper_prompt_basic() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string(), "Vue".to_string()];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: Tauri, Rust, Vue");
    }

    #[test]
    fn test_format_whisper_prompt_empty() {
        let terms: Vec<String> = vec![];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: ");
    }

    #[test]
    fn test_format_whisper_prompt_exceeds_max() {
        let terms: Vec<String> = (0..100).map(|i| format!("term{}", i)).collect();
        let result = format_whisper_prompt(&terms);
        // Should only include first 30 terms
        let parts: Vec<&str> = result
            .strip_prefix("Important Vocabulary: ")
            .unwrap()
            .split(", ")
            .collect();
        assert_eq!(parts.len(), MAX_WHISPER_PROMPT_TERMS);
        assert_eq!(parts[0], "term0");
        assert_eq!(parts[29], "term29");
    }

    #[test]
    fn test_transcription_result_serialization() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: 0.01,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\""));
    }
}
