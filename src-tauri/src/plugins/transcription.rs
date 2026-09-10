use std::time::Instant;

use tauri::{command, State};

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_WHISPER_PROMPT_TERMS: usize = 50;
const MINIMUM_AUDIO_SIZE: usize = 1000;
/// Groq free tier 上限 25MB
const MAX_AUDIO_FILE_SIZE: usize = 25 * 1024 * 1024;
const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
const REQUEST_TIMEOUT_SECS: u64 = 120;
/// gh-10：429/5xx/連線失敗自動重試（初次 + 2 次重試）
const MAX_TRANSCRIPTION_ATTEMPTS: u32 = 3;
/// 各次重試前的固定等待秒數（無 Retry-After 提示時）
const RETRY_BACKOFF_SECS: [u64; 2] = [1, 2];
/// Retry-After 建議等待超過此上限就直接放棄——語音場景等太久不如早報錯
const MAX_RETRY_AFTER_WAIT_SECS: u64 = 10;

// ========== State ==========

pub struct TranscriptionState {
    client: reqwest::Client,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .use_rustls_tls()
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
    #[error("Audio file too large ({size_mb:.1} MB, limit {limit_mb} MB). Please shorten your recording.")]
    FileTooLarge { size_mb: f64, limit_mb: usize },
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

// ========== Retry Classification (gh-10) ==========

/// 單次嘗試的失敗分類——決定要不要重試
enum FailureKind {
    /// HTTP 429，帶 Retry-After 建議秒數（若可解析）
    RateLimited { retry_after_secs: Option<u64> },
    /// HTTP 5xx
    ServerError,
    /// 連線建立失敗（fail-fast 型，重試便宜）
    Connect,
    /// 4xx／timeout／parse 等——重試無意義或代價過高
    NoRetry,
}

struct AttemptFailure {
    error: TranscriptionError,
    kind: FailureKind,
}

fn failure_kind_label(kind: &FailureKind) -> &'static str {
    match kind {
        FailureKind::RateLimited { .. } => "rate-limited",
        FailureKind::ServerError => "server-error",
        FailureKind::Connect => "connect-failed",
        FailureKind::NoRetry => "no-retry",
    }
}

/// 只支援 Retry-After 的秒數格式；HTTP-date 格式解析失敗回 None（退回固定 backoff）
fn parse_retry_after_secs(value: Option<&str>) -> Option<u64> {
    value?.trim().parse::<u64>().ok()
}

/// 回傳 Some(等待秒數) = 該重試；None = 直接放棄。attempt 為剛失敗的嘗試序號（1-based）
fn retry_wait_secs(kind: &FailureKind, attempt: u32) -> Option<u64> {
    let backoff_index = (attempt as usize)
        .saturating_sub(1)
        .min(RETRY_BACKOFF_SECS.len() - 1);
    let backoff = RETRY_BACKOFF_SECS[backoff_index];
    match kind {
        FailureKind::RateLimited { retry_after_secs } => {
            let wait = retry_after_secs.unwrap_or(backoff);
            if wait > MAX_RETRY_AFTER_WAIT_SECS {
                None
            } else {
                Some(wait)
            }
        }
        FailureKind::ServerError | FailureKind::Connect => Some(backoff),
        FailureKind::NoRetry => None,
    }
}

// ========== Shared Transcription Logic ==========

/// 單次 API 嘗試：建 form → 送出 → 解析。回傳 (raw_text, no_speech_probability)
async fn attempt_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    api_key: &str,
    vocabulary_term_list: Option<&[String]>,
    model: &str,
    language: Option<&str>,
) -> Result<(String, f64), AttemptFailure> {
    let no_retry = |error: TranscriptionError| AttemptFailure {
        error,
        kind: FailureKind::NoRetry,
    };

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| no_retry(TranscriptionError::RequestFailed(e.to_string())))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string())
        .text("response_format", "verbose_json");

    // Conditionally add language — None means auto-detect
    if let Some(lang) = language {
        form = form.text("language", lang.to_string());
    }

    if let Some(terms) = vocabulary_term_list {
        if !terms.is_empty() {
            let prompt = format_whisper_prompt(terms);
            form = form.text("prompt", prompt);
        }
    }

    // Send request (reuse shared client for connection pooling)
    let response = match transcription_state
        .client
        .post(GROQ_API_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            // timeout 不重試：120 秒才超時的請求再試兩次是災難
            let kind = if e.is_connect() {
                FailureKind::Connect
            } else {
                FailureKind::NoRetry
            };
            return Err(AttemptFailure {
                error: TranscriptionError::RequestFailed(e.to_string()),
                kind,
            });
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let retry_after_secs = parse_retry_after_secs(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        );
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        let kind = match status {
            429 => FailureKind::RateLimited { retry_after_secs },
            // 5xx 刻意不採用 Retry-After，固定短 backoff 即可
            500..=599 => FailureKind::ServerError,
            _ => FailureKind::NoRetry,
        };
        return Err(AttemptFailure {
            error: TranscriptionError::ApiError(status, body),
            kind,
        });
    }

    // Parse response
    let json: WhisperVerboseResponse = response
        .json()
        .await
        .map_err(|e| no_retry(TranscriptionError::ParseError(e.to_string())))?;

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

    Ok((raw_text, no_speech_probability))
}

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

    if wav_data.len() > MAX_AUDIO_FILE_SIZE {
        let size_mb = wav_data.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = MAX_AUDIO_FILE_SIZE / (1024 * 1024);
        return Err(TranscriptionError::FileTooLarge { size_mb, limit_mb });
    }

    let model = model_id.unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    println!(
        "[transcription] Sending {} bytes WAV to Groq API (model={})",
        wav_data.len(),
        model
    );

    // 計時涵蓋重試等待——維持「使用者感受時長」語意
    let start_time = Instant::now();
    let mut wav_data = Some(wav_data);

    for attempt in 1..=MAX_TRANSCRIPTION_ATTEMPTS {
        // 最後一次嘗試 move 原始資料，clone 只發生在還有重試機會時
        let data = if attempt < MAX_TRANSCRIPTION_ATTEMPTS {
            wav_data.as_ref().expect("wav_data taken early").clone()
        } else {
            wav_data.take().expect("wav_data taken early")
        };

        match attempt_transcription_request(
            data,
            transcription_state,
            &api_key,
            vocabulary_term_list.as_deref(),
            &model,
            language.as_deref(),
        )
        .await
        {
            Ok((raw_text, no_speech_probability)) => {
                let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;
                println!(
                    "[transcription] Response in {transcription_duration_ms:.0}ms (attempt {attempt}): \"{raw_text}\" (noSpeechProb={no_speech_probability:.3})"
                );
                return Ok(TranscriptionResult {
                    raw_text,
                    transcription_duration_ms,
                    no_speech_probability,
                });
            }
            Err(failure) => {
                if attempt < MAX_TRANSCRIPTION_ATTEMPTS {
                    if let Some(wait) = retry_wait_secs(&failure.kind, attempt) {
                        println!(
                            "[transcription] Attempt {attempt} failed ({}): {}; retrying in {wait}s",
                            failure_kind_label(&failure.kind),
                            failure.error
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                        continue;
                    }
                }
                println!(
                    "[transcription] Attempt {attempt} failed ({}), giving up: {}",
                    failure_kind_label(&failure.kind),
                    failure.error
                );
                return Err(failure.error);
            }
        }
    }

    unreachable!("retry loop always returns within MAX_TRANSCRIPTION_ATTEMPTS")
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
        TranscriptionError::RequestFailed(format!("Failed to read WAV file: {e}"))
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

#[command]
pub async fn test_whisper_connection(
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    model_id: Option<String>,
) -> Result<(), TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    // 1 秒 16kHz silence ≈ 32044 bytes，遠超過 MINIMUM_AUDIO_SIZE 的 1000 byte 下限。
    let silence_samples = vec![0i16; 16_000];
    let wav_data = super::audio_recorder::encode_wav(&silence_samples, 16_000)
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let model = model_id.unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    // 連線測試走單次嘗試——要的就是即時真實結果，不重試
    attempt_transcription_request(wav_data, &transcription_state, &api_key, None, &model, None)
        .await
        .map(|_| ())
        .map_err(|failure| failure.error)
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
        let terms: Vec<String> = (0..100).map(|i| format!("term{i}")).collect();
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

    // ========== Retry classification (gh-10) ==========

    #[test]
    fn test_parse_retry_after_secs() {
        assert_eq!(parse_retry_after_secs(Some("3")), Some(3));
        assert_eq!(parse_retry_after_secs(Some(" 5 ")), Some(5));
        assert_eq!(parse_retry_after_secs(Some("0")), Some(0));
        // HTTP-date 格式不支援 → 退回固定 backoff
        assert_eq!(
            parse_retry_after_secs(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
        assert_eq!(parse_retry_after_secs(None), None);
    }

    #[test]
    fn test_retry_wait_rate_limited_honors_retry_after() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: Some(3),
        };
        assert_eq!(retry_wait_secs(&kind, 1), Some(3));
    }

    #[test]
    fn test_retry_wait_rate_limited_over_cap_gives_up() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: Some(MAX_RETRY_AFTER_WAIT_SECS + 1),
        };
        assert_eq!(retry_wait_secs(&kind, 1), None);
    }

    #[test]
    fn test_retry_wait_rate_limited_without_hint_uses_backoff() {
        let kind = FailureKind::RateLimited {
            retry_after_secs: None,
        };
        assert_eq!(retry_wait_secs(&kind, 1), Some(RETRY_BACKOFF_SECS[0]));
        assert_eq!(retry_wait_secs(&kind, 2), Some(RETRY_BACKOFF_SECS[1]));
    }

    #[test]
    fn test_retry_wait_server_error_and_connect_use_backoff() {
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 1),
            Some(RETRY_BACKOFF_SECS[0])
        );
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 2),
            Some(RETRY_BACKOFF_SECS[1])
        );
        assert_eq!(
            retry_wait_secs(&FailureKind::Connect, 1),
            Some(RETRY_BACKOFF_SECS[0])
        );
    }

    #[test]
    fn test_retry_wait_no_retry_kind_gives_up() {
        assert_eq!(retry_wait_secs(&FailureKind::NoRetry, 1), None);
    }

    #[test]
    fn test_retry_wait_attempt_beyond_backoff_table_clamps() {
        // 防未來調大 MAX_TRANSCRIPTION_ATTEMPTS 時越界
        assert_eq!(
            retry_wait_secs(&FailureKind::ServerError, 99),
            Some(RETRY_BACKOFF_SECS[RETRY_BACKOFF_SECS.len() - 1])
        );
    }
}
