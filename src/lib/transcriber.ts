import { fetch } from "@tauri-apps/plugin-http";
import { API_KEY_MISSING_ERROR } from "./errorUtils";

interface WhisperSegment {
  no_speech_prob: number;
}

interface WhisperVerboseResponse {
  text: string;
  segments: WhisperSegment[];
}

export interface TranscriptionResult {
  rawText: string;
  transcriptionDurationMs: number;
  noSpeechProbability: number;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MODEL = "whisper-large-v3";
const TRANSCRIPTION_LANGUAGE = "zh";
const MAX_WHISPER_PROMPT_TERMS = 50;

export function formatWhisperPrompt(termList: string[]): string {
  const terms = termList.slice(0, MAX_WHISPER_PROMPT_TERMS);
  return `Important Vocabulary: ${terms.join(", ")}`;
}

function getFileExtensionFromMime(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
  vocabularyTermList?: string[],
): Promise<TranscriptionResult> {
  if (apiKey.trim() === "") {
    throw new Error(API_KEY_MISSING_ERROR);
  }

  const startTime = performance.now();

  const extension = getFileExtensionFromMime(audioBlob.type);
  const formData = new FormData();
  formData.append("file", audioBlob, `recording.${extension}`);
  formData.append("model", GROQ_MODEL);
  formData.append("language", TRANSCRIPTION_LANGUAGE);
  formData.append("response_format", "verbose_json");

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const whisperPrompt = formatWhisperPrompt(vocabularyTermList);
    formData.append("prompt", whisperPrompt);
  }

  console.log(
    `[transcriber] Sending ${audioBlob.size} bytes (${audioBlob.type}) to Groq API...`,
  );

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorBody}`);
  }

  const json: WhisperVerboseResponse = await response.json();
  const rawText = (json.text ?? "").trim();
  const noSpeechProbability =
    json.segments.length > 0
      ? Math.max(...json.segments.map((s) => s.no_speech_prob))
      : 1.0;
  const transcriptionDurationMs = performance.now() - startTime;

  console.log(
    `[transcriber] Got response in ${Math.round(transcriptionDurationMs)}ms: "${rawText}" (noSpeechProb=${noSpeechProbability.toFixed(3)})`,
  );

  return { rawText, transcriptionDurationMs, noSpeechProbability };
}
