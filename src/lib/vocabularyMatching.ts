const LATIN_WORD_CHARACTER = /[\p{Script=Latin}\p{M}\p{N}_]/u;

/** 回傳字元索引；拉丁詞不可命中較長單字的一部分，中文前後不算英文詞界。 */
export function findTermOccurrences(text: string, term: string): number[] {
  const characters = Array.from(text);
  const termCharacters = Array.from(term);
  const positions: number[] = [];
  for (let start = 0; start <= characters.length - termCharacters.length; start++) {
    if (characters.slice(start, start + termCharacters.length).join("").toLowerCase() !== term.toLowerCase()) continue;
    if (LATIN_WORD_CHARACTER.test(termCharacters[0]) && LATIN_WORD_CHARACTER.test(characters[start - 1] ?? "")) continue;
    if (LATIN_WORD_CHARACTER.test(term) && LATIN_WORD_CHARACTER.test(characters[start + termCharacters.length] ?? "")) continue;
    positions.push(start);
  }
  return positions;
}
