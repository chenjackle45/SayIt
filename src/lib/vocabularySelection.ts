import type { VocabularyEntry, VocabularyReplacementEntry } from "../types/vocabulary";
import { findTermOccurrences } from "./vocabularyMatching";

export interface AiVocabularyCandidate {
  term: string;
  replacements: string[];
}

function timestamp(value: string): number {
  return Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}

export function selectWhisperVocabulary(
  vocabulary: VocabularyEntry[],
  recentRawTexts: string[],
  smartLearningEnabled: boolean,
  now: number,
): string[] {
  return vocabulary.filter((entry) => {
    if (entry.source === "manual") return true;
    if (entry.correctionCount < 1) return false;
    if (!smartLearningEnabled) return true;
    if (entry.lastCorrectedAt && now - timestamp(entry.lastCorrectedAt) < 30 * 86400000) return true;
    return recentRawTexts.slice(0, 300).filter((text) => findTermOccurrences(text, entry.term).length > 0).length < 8;
  }).sort((a, b) => {
    if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
    if (a.source === "manual") return timestamp(b.createdAt) - timestamp(a.createdAt);
    return b.correctionCount - a.correctionCount ||
      (b.lastCorrectedAt ? timestamp(b.lastCorrectedAt) : 0) - (a.lastCorrectedAt ? timestamp(a.lastCorrectedAt) : 0);
  }).map((entry) => entry.term);
}

function editDistance(left: string[], right: string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++) {
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[right.length];
}

function matchingRatio(term: string, rawText: string): number | null {
  const characters = Array.from(term.toLowerCase());
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)) {
    const raw = Array.from(rawText.toLowerCase());
    let best: number | null = null;
    for (let i = 0; i <= raw.length - characters.length; i++) {
      const matches = characters.filter((character, j) => character === raw[i + j]).length;
      if (matches >= Math.ceil(characters.length / 2)) best = Math.max(best ?? 0, matches / characters.length);
    }
    return best;
  }
  if (findTermOccurrences(rawText, term).length > 0) return 1;
  let best: number | null = null;
  for (const word of rawText.toLowerCase().match(/[\p{Script=Latin}\p{M}\p{N}_]+(?:[.+#-]+[\p{Script=Latin}\p{M}\p{N}_]*)*/gu) ?? []) {
    const distance = editDistance(characters, Array.from(word));
    if (distance <= Math.floor(characters.length / 3)) {
      const wordCharacters = Array.from(word);
      const matches = characters.filter((character, index) => character === wordCharacters[index]).length;
      best = Math.max(best ?? 0, matches / characters.length);
    }
  }
  return best;
}

/** 只送使用者在收件匣確認過（applied）的聽錯配對：自動學到的配對先當建議，避免回推出錯時悄悄污染整理 */
export function selectAiVocabulary(
  vocabulary: VocabularyEntry[],
  replacements: VocabularyReplacementEntry[],
  rawText: string,
): AiVocabularyCandidate[] {
  return vocabulary.map((entry) => ({
    entry,
    replacements: replacements.filter((pair) => pair.vocabularyId === entry.id && pair.status === "applied" && findTermOccurrences(rawText, pair.misheard).length > 0).map((pair) => pair.misheard),
    ratio: matchingRatio(entry.term, rawText),
  })).filter((candidate) => candidate.replacements.length > 0 || candidate.ratio !== null)
    .sort((a, b) => Number(b.replacements.length > 0) - Number(a.replacements.length > 0) ||
      (b.ratio ?? 0) - (a.ratio ?? 0) || Number(b.entry.source === "manual") - Number(a.entry.source === "manual") ||
      b.entry.correctionCount - a.entry.correctionCount)
    .slice(0, 20)
    .map(({ entry, replacements }) => ({ term: entry.term, replacements }));
}
