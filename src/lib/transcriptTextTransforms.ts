import { convertSimplifiedToTraditional } from "./simplifiedToTraditional";

/**
 * 轉錄原文落地前的文字轉換（共用）。
 *
 * 目前只做：有效轉譯語言為繁中（zh-TW）或廣東話（yue，#74）時，把 Whisper 的簡體輸出轉成繁體（#39）。
 * 有效語言（auto 已解析為介面語言）由呼叫端（store）決定後傳入，
 * 以維持 `lib/` 不依賴 `stores/` 的分層規則。
 *
 * 即時轉錄（useVoiceFlowStore）與歷史「重新辨識」（useHistoryStore）共用此函式，
 * 確保兩條路徑寫入 raw_text 前都套用一致的轉換。
 */
export function applyTranscriptTextTransforms(
  rawText: string,
  effectiveLocale: string,
): string {
  if (!rawText) return rawText;
  // gh-74：廣東話（yue）也要繁體；OpenCC cn→tw 不碰粵語專用字（哋、嘅、唔…）
  return effectiveLocale === "zh-TW" || effectiveLocale === "yue"
    ? convertSimplifiedToTraditional(rawText)
    : rawText;
}
