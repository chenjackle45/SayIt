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
          text: vi.fn().mockResolvedValue("transcribed text"),
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
        text: vi.fn().mockResolvedValue("hello world"),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: FormData should contain all expected fields
      const callArgs = mockFetch.mock.calls[0];
      const formData = callArgs[1].body as FormData;
      expect(formData.get("model")).toBe("whisper-large-v3");
      expect(formData.get("language")).toBe("zh");
      expect(formData.get("response_format")).toBe("text");
      expect(formData.get("file")).toBeInstanceOf(Blob);
    });

    it("[P0] should send Authorization header with Bearer token", async () => {
      // Given: API key is set
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("text"),
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
        text: vi.fn().mockResolvedValue("text"),
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
    it("[P0] should return trimmed text and transcription duration", async () => {
      // Given: API returns text with whitespace
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("  Hello World  \n"),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: text should be trimmed
      expect(result.rawText).toBe("Hello World");
      // And: duration should be a positive number
      expect(result.transcriptionDurationMs).toBeGreaterThan(0);
      expect(typeof result.transcriptionDurationMs).toBe("number");
    });

    it("[P0] should return empty string when API returns only whitespace", async () => {
      // Given: API returns whitespace-only
      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("   \n  "),
      });

      const { transcribeAudio } = await import("../../src/lib/transcriber");

      // When: transcribing
      const result = await transcribeAudio(audioBlob, TEST_API_KEY);

      // Then: text should be empty after trim
      expect(result.rawText).toBe("");
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
      perfNowSpy.mockReturnValueOnce(2500); // endTime (after response.text())

      const audioBlob = new Blob(["audio"], { type: "audio/webm" });
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("result"),
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
