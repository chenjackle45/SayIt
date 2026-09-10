export interface AudioInputDeviceInfo {
  name: string;
}

export interface WaveformPayload {
  levels: number[];
}

export interface AudioPreviewLevelPayload {
  level: number;
}

export interface StopRecordingResult {
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
}

export interface TranscriptionResult {
  rawText: string;
  transcriptionDurationMs: number;
  noSpeechProbability: number;
  /** Peak energy 0.0..=1.0 of the source audio. 0 for the live path (energy comes
   *  from StopRecordingResult); populated by retranscribe_from_file for history retries. */
  peakEnergyLevel: number;
  /** RMS energy 0.0..=1.0 of the source audio. See peakEnergyLevel. */
  rmsEnergyLevel: number;
}
