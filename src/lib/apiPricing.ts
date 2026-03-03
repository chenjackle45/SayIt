/**
 * Groq 定價常數（美元）— 用於費用上限估算
 * Source: https://groq.com/pricing (2026-03-03)
 * Whisper Large V3: $0.111/hour
 * Llama 3.3 70B Versatile: input $0.59/M, output $0.79/M（取較貴的 output 價格作為上限）
 */
const WHISPER_LARGE_V3_COST_PER_HOUR = 0.111;
const WHISPER_MIN_BILLING_MS = 10_000;
const LLAMA_70B_MAX_COST_PER_TOKEN = 0.00000079;

/**
 * 計算 Whisper API 費用上限。
 * Groq 最低計費 10 秒/次，不足 10 秒一律按 10 秒算。
 */
export function calculateWhisperCostCeiling(audioDurationMs: number): number {
  const billedMs = Math.max(audioDurationMs, WHISPER_MIN_BILLING_MS);
  return (billedMs / 3_600_000) * WHISPER_LARGE_V3_COST_PER_HOUR;
}

/**
 * 計算 Chat LLM API 費用上限。
 * 全部 token 按較貴的 output 價格算（$0.79/M），保證是上限。
 */
export function calculateChatCostCeiling(totalTokens: number): number {
  return totalTokens * LLAMA_70B_MAX_COST_PER_TOKEN;
}
