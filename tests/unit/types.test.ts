import { describe, it, expect } from "vitest";
import type { HudStatus, HudState } from "@/types";
import type { TranscriptionRecord } from "@/types/transcription";

describe("Type Definitions", () => {
  it("[P0] HudStatus accepts valid statuses", () => {
    // Given: all valid HUD statuses
    const validStatuses: HudStatus[] = [
      "idle",
      "recording",
      "transcribing",
      "enhancing",
      "success",
      "error",
    ];

    // Then: all statuses should be string values
    validStatuses.forEach((status) => {
      expect(typeof status).toBe("string");
    });
  });

  it("[P1] HudState has correct structure", () => {
    // Given: a valid HUD state
    const state: HudState = {
      status: "recording",
      message: "Recording...",
    };

    // Then: properties should be correctly typed
    expect(state.status).toBe("recording");
    expect(state.message).toBe("Recording...");
  });

  it("[P1] TranscriptionRecord has correct structure", () => {
    // Given: a transcription record
    const record: TranscriptionRecord = {
      id: "record-1",
      timestamp: 1_700_000_000_000,
      rawText: "Hello world",
      processedText: null,
      recordingDurationMs: 1200,
      transcriptionDurationMs: 1500,
      enhancementDurationMs: null,
      charCount: 11,
      triggerMode: "hold",
      wasEnhanced: false,
      wasModified: null,
      createdAt: "2026-03-01T00:00:00.000Z",
    };

    // Then: properties should be correctly typed
    expect(record.rawText).toBe("Hello world");
    expect(record.transcriptionDurationMs).toBe(1500);
  });
});
