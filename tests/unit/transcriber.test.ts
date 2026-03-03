import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { API_KEY_MISSING_ERROR } from "../../src/lib/errorUtils";

// ---------------------------------------------------------------------------
// Mock: @tauri-apps/plugin-http
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockFetch,
}));

const TEST_API_KEY = "test-api-key-123";

describe("transcriber.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Env var validation
  // ========================================================================

  describe("API key validation", () => {
    it("[P0] should throw if API key is whitespace-only", async () => {
      const { transcribeAudio } = await import("../../src/lib/transcriber");
      const audioBlob = new Blob(["audio-data"], { type: "audio/webm" });

      await expect(transcribeAudio(audioBlob, "  ")).rejects.toThrow(
        API_KEY_MISSING_ERROR,
      );
    });

    it("[P0] should throw if API key is empty string", async () => {
      const { transcribeAudio } = await import("../../src/lib/transcriber");
      const audioBlob = new Blob(["audio-data"], { type: "audio/webm" });

      await expect(transcribeAudio(audioBlob, "")).rejects.toThrow(
        API_KEY_MISSING_ERROR,
      );
    });
  });

  // ========================================================================
  // MIME-to-extension mapping
  // ========================================================================

  describe("MIME-to-extension mapping", () => {
    it.each([
      {
        mimeType: "audio/webm;codecs=opus",
        expectedFilename: "recording.webm",
      },
      { mimeType: "audio/webm", expectedFilename: "recording.webm" },
      { mimeType: "audio/mp4", expectedFilename: "recording.mp4" },
      { mimeType: "audio/ogg;codecs=opus", expectedFilename: "recording.ogg" },
      { mimeType: "audio/wav", expectedFilename: "recording.wav" },
      { mimeType: "audio/unknown", expectedFilename: "recording.webm" },
    ])(
      "[P0] should map $mimeType to $expectedFilename",
      async ({ mimeType, expectedFilename }) => {
        // Given: a blob with specific mime type
        const audioBlob = new Blob(["audio"], { type: mimeType });
        mockFetch.mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            text: "transcribed text",
            segments: [{ no_speech_prob: 0.01 }],
          }),
        });

        const { transcribeAudio } = await import("../../src/lib/transcriber");

        // When: transcribing audio
        await transcribeAudio(audioBlob, TEST_API_KEY);

        // Then: fetch should be called with FormData containing the correct filename
        const callArgs = mockFetch.mock.calls[0];
        const formData = callArgs[1].body as FormData;
        const file = formData.get("file") as File;
        expect(file.name).toBe(expectedFilename);
      },
    );
  });

  // ========================================================================
  // FormData construction
  // ========================================================================

  describe("FormData construction", () => {
    it("[P0] should send correct FormData fields to Groq API", async () => {
      // Given: a valid audio blob
      const audioBlob = new Blob(["audio-data"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "hello world",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: FormData should contain all expected fields
      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("model")).toBe("whisper-large-v3");
      expect(formData.get("language")).toBe("zh");
      expect(formData.get("response_format")).toBe("verbose_json");
      expect(formData.get("file")).toBeInstanceOf(Blob);
    });

    it("[P0] should send Authorization header with Bearer token", async () => {
      // Given: API key is set
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      await transcribeAudio(audioBlob, "my-secret-key");

      // Then: Authorization header should be set
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Bearer my-secret-key");
    });

    it("[P0] should POST to the correct Groq API URL", async () => {
      // Given: valid input
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: should call the correct URL with POST
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        "https://api.groq.com/openai/v1/audio/transcriptions",
      );
      expect(callArgs[1].method).toBe("POST");
    });
  });

  // ========================================================================
  // HTTP error handling
  // ========================================================================

  describe("HTTP error handling", () => {
    it("[P0] should throw with status and body on non-ok response", async () => {
      // Given: API returns 401 Unauthorized
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('{"error":"Invalid API key"}'),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When/Then: should throw with status and body
      await expect(transcribeAudio(audioBlob, TEST_API_KEY)).rejects.toThrow(
        'Groq API error (401): {"error":"Invalid API key"}',
      );
    });

    it("[P0] should throw with status 500 on server error", async () => {
      // Given: API returns 500 Internal Server Error
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When/Then: should throw with status
      await expect(transcribeAudio(audioBlob, TEST_API_KEY)).rejects.toThrow(
        "Groq API error (500): Internal Server Error",
      );
    });

    it("[P0] should propagate network/fetch errors", async () => {
      // Given: fetch itself throws (network failure)
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When/Then: error should propagate
      await expect(transcribeAudio(audioBlob, TEST_API_KEY)).rejects.toThrow(
        "Network request failed",
      );
    });
  });

  // ========================================================================
  // Response parsing & result
  // ========================================================================

  describe("response parsing", () => {
    it("[P0] should return trimmed text, transcription duration, and noSpeechProbability", async () => {
      // Given: API returns verbose_json with whitespace in text
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "  Hello World  \n",
          segments: [{ no_speech_prob: 0.05 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: text should be trimmed
      expect(result.rawText).toBe("Hello World");
      // And: duration should be a positive number
      expect(result.transcriptionDurationMs).toBeGreaterThan(0);
      expect(typeof result.transcriptionDurationMs).toBe("number");
      // And: noSpeechProbability should match the segment value
      expect(result.noSpeechProbability).toBe(0.05);
    });

    it("[P0] should return empty string when API returns only whitespace text", async () => {
      // Given: API returns verbose_json with whitespace-only text
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "   \n  ",
          segments: [{ no_speech_prob: 0.95 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: text should be empty after trim
      expect(result.rawText).toBe("");
      expect(result.noSpeechProbability).toBe(0.95);
    });

    it("[P0] should return max no_speech_prob across multiple segments", async () => {
      // Given: API returns verbose_json with multiple segments
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "谢谢大家",
          segments: [
            { no_speech_prob: 0.3 },
            { no_speech_prob: 0.95 },
            { no_speech_prob: 0.1 },
          ],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: noSpeechProbability should be the max across segments
      expect(result.noSpeechProbability).toBe(0.95);
    });

    it("[P0] should return noSpeechProbability=1.0 when segments array is empty", async () => {
      // Given: API returns verbose_json with no segments
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "",
          segments: [],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: noSpeechProbability should default to 1.0
      expect(result.noSpeechProbability).toBe(1.0);
    });

    it("[P0] normal speech should return noSpeechProbability close to 0", async () => {
      // Given: API returns verbose_json for normal speech
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "今天天氣很好",
          segments: [{ no_speech_prob: 0.02 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: noSpeechProbability should be close to 0
      expect(result.noSpeechProbability).toBe(0.02);
      expect(result.rawText).toBe("今天天氣很好");
    });
  });

  // ========================================================================
  // Vocabulary prompt injection (Story 3.2)
  // ========================================================================

  describe("vocabulary prompt injection", () => {
    it("[P0] should format vocabulary as Whisper prompt and append to FormData", async () => {
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "transcribed text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      await transcribeAudio(audioBlob, TEST_API_KEY, [
        "TypeScript",
        "Vue.js",
        "Tauri",
      ]);

      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("prompt")).toBe(
        "Important Vocabulary: TypeScript, Vue.js, Tauri",
      );
    });

    it("[P0] should not append prompt field when vocabulary is undefined", async () => {
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "transcribed text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      await transcribeAudio(audioBlob, TEST_API_KEY);

      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("prompt")).toBeNull();
    });

    it("[P0] should not append prompt field when vocabulary is empty array", async () => {
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "transcribed text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      await transcribeAudio(audioBlob, TEST_API_KEY, []);

      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("prompt")).toBeNull();
    });

    it("[P0] should truncate vocabulary to MAX_WHISPER_PROMPT_TERMS (50)", async () => {
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "transcribed text",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      const largeVocabulary = Array.from(
        { length: 60 },
        (_, i) => `Term${i + 1}`,
      );

      await transcribeAudio(audioBlob, TEST_API_KEY, largeVocabulary);

      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      const promptValue = formData.get("prompt") as string;
      expect(promptValue).toContain("Term1");
      expect(promptValue).toContain("Term50");
      expect(promptValue).not.toContain("Term51");
    });
  });

  // ========================================================================
  // formatWhisperPrompt (Story 3.2)
  // ========================================================================

  describe("formatWhisperPrompt", () => {
    it("[P0] should format terms as comma-separated list with prefix", async () => {
      const { formatWhisperPrompt } = await import("../../src/lib/transcriber");

      expect(formatWhisperPrompt(["Tauri", "Pinia"])).toBe(
        "Important Vocabulary: Tauri, Pinia",
      );
    });

    it("[P0] should handle single term", async () => {
      const { formatWhisperPrompt } = await import("../../src/lib/transcriber");

      expect(formatWhisperPrompt(["TypeScript"])).toBe(
        "Important Vocabulary: TypeScript",
      );
    });

    it("[P0] should truncate to 50 terms", async () => {
      const { formatWhisperPrompt } = await import("../../src/lib/transcriber");

      const terms = Array.from({ length: 60 }, (_, i) => `T${i}`);
      const result = formatWhisperPrompt(terms);
      const resultTerms = result
        .replace("Important Vocabulary: ", "")
        .split(", ");
      expect(resultTerms).toHaveLength(50);
      expect(resultTerms[0]).toBe("T0");
      expect(resultTerms[49]).toBe("T49");
    });
  });

  // ========================================================================
  // Duration measurement
  // ========================================================================

  describe("duration measurement", () => {
    it("[P0] should measure duration using performance.now()", async () => {
      // Given: controlled performance.now
      const perfNowSpy = vi.spyOn(performance, "now");
      perfNowSpy.mockReturnValueOnce(1000); // startTime
      perfNowSpy.mockReturnValueOnce(2500); // endTime (after response.json())

      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          text: "result",
          segments: [{ no_speech_prob: 0.01 }],
        }),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: duration should be the difference
      expect(result.transcriptionDurationMs).toBe(1500);

      perfNowSpy.mockRestore();
    });
  });
});
