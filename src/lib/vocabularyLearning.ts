import { findTermOccurrences } from "./vocabularyMatching";

interface AlignmentSpan {
  originalStart: number;
  originalEnd: number;
  correctedStart: number;
  correctedEnd: number;
  changed: boolean;
}

export interface LearnedVocabularyPair {
  term: string;
  misheard: string;
}

/** 比較學習內容時忽略格式與大小寫，來源配對仍保留原文。 */
function normalizeComparison(text: string): string {
  return text.replace(/[\s\p{P}]/gu, "").toLowerCase();
}

/** 合併連續空白，保留標點定位與每個字元的原文位置。 */
function normalizeText(text: string) {
  const raw = Array.from(text);
  const positions = raw.map((_, index) => index).filter((index) =>
    !(/\s/u.test(raw[index]) && /\s/u.test(raw[index - 1] ?? "")),
  );
  return { raw, positions, characters: positions.map((index) => raw[index]) };
}

/** 相同字元一對一；兩個相同區段間的差異整段對整段。索引為 Unicode 字元。 */
function alignText(original: string[], corrected: string[]): AlignmentSpan[] {
  // 原文完整保留時只有周邊文字，不讓新增內容的重複字重新配位。
  if (corrected.join("").includes(original.join(""))) return [];
  // 摘錄可省略原文頭尾：原文前綴／後綴不計編輯成本。
  const costs = Array.from({ length: original.length + 1 }, () => new Int32Array(corrected.length + 1));
  for (let j = 0; j <= corrected.length; j++) costs[0][j] = j;
  for (let i = 1; i <= original.length; i++) {
    for (let j = 1; j <= corrected.length; j++) {
      costs[i][j] = Math.min(
        costs[i - 1][j - 1] + (original[i - 1] === corrected[j - 1] ? -1 : 1),
        costs[i - 1][j] + 1, costs[i][j - 1] + 1,
      );
    }
  }
  let i = original.length;
  let j = corrected.length;
  // 同分取最早終點，未錨定的原文尾端留在摘錄外，避免吸進邊界詞。
  for (let end = original.length - 1; end >= 0; end--) {
    if (costs[end][j] <= costs[i][j]) i = end;
  }
  const steps: AlignmentSpan[] = [];
  while (j > 0) {
    const originalEnd = i;
    const correctedEnd = j;
    let changed = true;
    // 同成本時保留較早的相同字元，避免把原有字元配到之後純新增的重複字。
    if (costs[i][j] === costs[i][j - 1] + 1) j--;
    else if (i > 0 && costs[i][j] === costs[i - 1][j - 1] + (original[i - 1] === corrected[j - 1] ? -1 : 1)) {
      changed = original[--i] !== corrected[--j];
    } else i--;
    steps.push({ originalStart: i, originalEnd, correctedStart: j, correctedEnd, changed });
  }
  const spans: AlignmentSpan[] = [];
  for (const step of steps.reverse()) {
    const previous = spans[spans.length - 1];
    if (step.changed && previous?.changed) {
      previous.originalEnd = step.originalEnd;
      previous.correctedEnd = step.correctedEnd;
    } else spans.push(step);
  }
  return spans;
}

function overlaps(span: AlignmentSpan, start: number, end: number): boolean {
  return span.correctedStart === span.correctedEnd
    ? span.correctedStart >= start && span.correctedStart <= end
    : span.correctedStart < end && span.correctedEnd > start;
}

/** 摘錄頭尾被省略的原文不算內部修改，避免未改動時呼叫 AI。 */
export function hasInternalCorrection(pasted: string, corrected: string): boolean {
  const source = normalizeText(pasted);
  const target = normalizeText(corrected);
  const original = source.characters;
  const characters = target.characters;
  return alignText(original, characters).some((span) =>
    span.changed &&
    normalizeComparison(original.slice(span.originalStart, span.originalEnd).join("")) !==
      normalizeComparison(characters.slice(span.correctedStart, span.correctedEnd).join("")) &&
    !(span.originalStart === span.originalEnd &&
      (span.originalStart === 0 || span.originalEnd === original.length)) &&
    overlaps(span, 0, characters.length),
  );
}

/** AI 只負責判斷專有名詞；本函式把關位置並回推可寫入的整詞配對。 */
export function learnVocabularyCorrections(
  pasted: string,
  corrected: string,
  suggestedTerms: string[],
): LearnedVocabularyPair[] {
  const source = normalizeText(pasted);
  const target = normalizeText(corrected);
  const original = source.characters;
  const characters = target.characters;
  const spans = alignText(original, characters);
  const candidates: (LearnedVocabularyPair & { range: string })[] = [];
  const seenTerms = new Set<string>();
  for (const term of suggestedTerms.map((value) => value.trim())) {
    const key = term.toLowerCase();
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    for (const rawStart of findTermOccurrences(corrected, term)) {
      const rawEnd = rawStart + Array.from(term).length;
      const start = target.positions.filter((position) => position < rawStart).length;
      const end = target.positions.filter((position) => position < rawEnd).length;
      const mapped = spans.filter((span) => overlaps(span, start, end));
      const changes = mapped.filter((span) => span.changed);
      if (changes.length === 0) continue;
      // 移除候選後仍可保留對應摘錄的原文順序，這次出現便可完全視為新增。
      const originalExcerpt = Array.from(normalizeComparison(original.slice(spans[0].originalStart, spans[spans.length - 1].originalEnd).join("")));
      let originalIndex = 0;
      for (const character of normalizeComparison([...characters.slice(0, start), ...characters.slice(end)].join(""))) {
        if (character === originalExcerpt[originalIndex]) originalIndex++;
      }
      if (originalIndex === originalExcerpt.length) continue;
      if (changes.some((span) =>
        characters.slice(span.correctedStart, Math.min(start, span.correctedEnd)).join("").trim() !== "" ||
        characters.slice(Math.max(end, span.correctedStart), span.correctedEnd).join("").trim() !== "",
      )) continue;
      const originalStart = Math.min(...mapped.map((span) => span.originalStart));
      let originalEnd = Math.max(...mapped.map((span) => span.originalEnd));
      // 有共同字元且未錨定尾端等長，才把句尾插入解讀為完整替換。
      const tail = changes[changes.length - 1];
      if (end === characters.length && tail.correctedEnd === end &&
        original.length - originalEnd === tail.correctedEnd - tail.correctedStart && mapped.some((span) => !span.changed)) {
        originalEnd = original.length;
      }
      const misheard = source.raw.slice(source.positions[originalStart] ?? source.raw.length, source.positions[originalEnd - 1] + 1).join("").trim();
      if (!misheard) continue;
      const normalizedMisheard = normalizeComparison(misheard);
      if (normalizedMisheard === normalizeComparison(term)) continue;
      if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(normalizedMisheard)) continue;
      // 候選之外仍保留原詞時，無法唯一區分改正與新增；整詞插字不算保留原詞。
      const termCharacters = normalizeText(term).characters;
      const termStarts = findTermOccurrences(characters.join(""), termCharacters.join(""));
      const remainingCorrected = characters.filter((_, index) =>
        !termStarts.some((termStart) => index >= termStart && index < termStart + termCharacters.length),
      ).join("");
      if (findTermOccurrences(remainingCorrected, normalizeText(misheard).characters.join("")).length > 0) continue;
      if ((start === 0 && originalStart > 0) || (end === characters.length && originalEnd < original.length)) continue;
      candidates.push({ term, misheard, range: `${originalStart}:${originalEnd}` });
    }
  }
  const result: LearnedVocabularyPair[] = [];
  for (const candidate of candidates) {
    if (candidates.some((other) => other.range === candidate.range && other.term !== candidate.term)) continue;
    if (result.some((other) => other.term === candidate.term && other.misheard === candidate.misheard)) continue;
    result.push({ term: candidate.term, misheard: candidate.misheard });
  }
  return result;
}
