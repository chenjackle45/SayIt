// 評估計分（純函式，供 report.mjs 與單元測試共用）

// 數字格式不計入字元錯誤率（另列「數字格式」），避免「用阿拉伯數字」的規則左右字元錯誤率
const NUMERAL_CHARS = /[0-9一二三四五六七八九十百千萬万两兩零〇]/g;
const LATIN_WORD = /^[\p{Script=Latin}0-9][\p{Script=Latin}0-9\s.'+#&-]*$/u;

export function normalize(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

export function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[y.length];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 詞在文字中出現幾次：拉丁詞看詞界、不分大小寫（Ann 不算 Anna）；中日韓直接比子字串 */
export function countTerm(text, term) {
  const haystack = text.normalize("NFKC");
  const needle = term.normalize("NFKC").trim();
  if (!needle) return 0;
  if (LATIN_WORD.test(needle)) {
    const pattern = needle
      .split(/[\s-]+/)
      .map(escapeRegExp)
      .join("[\\s-]*");
    const matches = haystack.match(
      new RegExp(`(?<![\\p{Script=Latin}0-9])${pattern}(?![\\p{Script=Latin}0-9])`, "giu"),
    );
    return matches ? matches.length : 0;
  }
  const flatHaystack = normalize(haystack);
  const flatNeedle = normalize(needle);
  if (!flatNeedle) return 0;
  let count = 0;
  let index = flatHaystack.indexOf(flatNeedle);
  while (index !== -1) {
    count += 1;
    index = flatHaystack.indexOf(flatNeedle, index + flatNeedle.length);
  }
  return count;
}

const isNumericKeep = (term) => /[0-9]/.test(term);

/** 單句指標；reference＝辨識階段用 spoken、整理階段用 expected。判定只用命中與誤改，其餘只印 */
export function scoreCase(testCase, output, reference, dictionaryTerms) {
  const entityHits = testCase.entities.filter((e) => countTerm(output, e) > 0).length;
  const falseTerms = dictionaryTerms.filter(
    (t) => countTerm(output, t) > countTerm(reference, t),
  );
  const keepMissing = testCase.keep.filter((k) => countTerm(output, k) < countTerm(reference, k)).length;
  const numericKeep = testCase.keep.filter(isNumericKeep);
  const numericHits = numericKeep.filter((k) => countTerm(output, k) > 0).length;
  const stripNumerals = (s) => normalize(s).replace(NUMERAL_CHARS, "");
  const refNorm = stripNumerals(reference);
  const cer = refNorm.length ? editDistance(stripNumerals(output), refNorm) / refNorm.length : 0;
  return {
    entityTotal: testCase.entities.length,
    entityHits,
    hasFalseReplacement: falseTerms.length > 0 ? 1 : 0,
    keepTotal: testCase.keep.length,
    keepMissing,
    numericTotal: numericKeep.length,
    numericHits,
    cer,
    selfCorrection: testCase.selfCorrection ? 1 : 0,
    id: testCase.id,
  };
}

export function aggregate(rows) {
  const sum = (key) => rows.reduce((acc, r) => acc + r[key], 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const avgPct = (list) =>
    list.length ? Math.round((list.reduce((a, r) => a + r.cer, 0) / list.length) * 1000) / 10 : null;
  return {
    n: rows.length,
    entityHitRate: pct(sum("entityHits"), sum("entityTotal")),
    falseReplacementRate: pct(sum("hasFalseReplacement"), rows.length),
    keepDeletionRate: pct(sum("keepMissing"), sum("keepTotal")),
    numericFormatRate: pct(sum("numericHits"), sum("numericTotal")),
    entityHitCount: sum("entityHits"),
    falseReplacementCount: sum("hasFalseReplacement"),
    ids: rows.map((r) => r.id).filter(Boolean).sort(),
    cer: avgPct(rows),
    selfCorrectionCer: avgPct(rows.filter((r) => r.selfCorrection)),
  };
}

/**
 * 換指示的機械判定（驗收 2，2026-11-27 三方定案）：只看整體、用原始計數。
 * 兩邊「all」的題目 ID 都要與凍結題單一致；專有名詞命中數新 ≥ 舊 + 3（多 1–2 個視為雜訊，使用者 2026-11-27 拍板）；誤改題數新 ≤ 舊。
 * 數值、否定、改口、刪內容由盲測語義檢視承擔，不在這裡判。
 */
export const MIN_HIT_GAIN = 3;

export function decidePromotion(baseline, candidate, expectedIds) {
  const reasons = [];
  const expected = [...(expectedIds ?? [])].sort().join(",");
  const base = baseline.all;
  const next = candidate.all;
  if (!expected) reasons.push("沒有凍結題單");
  if (!base || !next) {
    reasons.push("缺成績");
    return { promote: false, reasons };
  }
  if (base.ids.join(",") !== expected || next.ids.join(",") !== expected) reasons.push("題目不完整或不一致");
  if (next.entityHitCount - base.entityHitCount < MIN_HIT_GAIN) reasons.push(`專有名詞命中數未多 ${MIN_HIT_GAIN} 個以上（${base.entityHitCount} → ${next.entityHitCount}）`);
  if (next.falseReplacementCount > base.falseReplacementCount) reasons.push(`誤改題數上升（${base.falseReplacementCount} → ${next.falseReplacementCount}）`);
  return { promote: reasons.length === 0, reasons };
}
