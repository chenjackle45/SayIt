// 從快取算指標（不呼叫 API）。用法：node --import ./scripts/vocab-benchmark/ts-resolve.mjs scripts/vocab-benchmark/report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadCases, buildDictionary, isValidResult } from "./run.mjs";
import { scoreCase, aggregate, decidePromotion } from "./scoring.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(HERE, "../../tests/eval/vocab/results/cache");
const SUMMARY_FILE = path.resolve(HERE, "../../tests/eval/vocab/results/summary.json");

function listArms(stage) {
  const dir = path.join(CACHE_DIR, stage);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** 指示比較必須吃同一份輸入：逐題核對兩組快取的辨識原文與詞庫清單（快取命中也要驗） */
function findInputMismatches(cases, baseArm, candidateArm) {
  const reasons = [];
  for (const c of cases) {
    const read = (arm) => {
      const file = path.join(CACHE_DIR, arm, `${c.id}.json`);
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    };
    const base = read(baseArm);
    const next = read(candidateArm);
    if (!base || !next) reasons.push(`${c.id}：缺快取`);
    else if (!Array.isArray(base.termList) || !Array.isArray(next.termList)) reasons.push(`${c.id}：缺明確詞庫清單`);
    else if (base.input !== next.input || JSON.stringify(base.termList) !== JSON.stringify(next.termList)) {
      reasons.push(`${c.id}：兩組輸入不同`);
    }
    else {
      // 兩組一起過期也要擋：輸入必須等於目前上游辨識原文（對照組名稱 llm/<組>@<辨識組>）
      const inputArm = baseArm.split("@")[1];
      const upstream = inputArm ? read(`whisper/${inputArm}`) : null;
      if (inputArm && (!upstream || upstream.raw !== base.input)) reasons.push(`${c.id}：整理快取與目前辨識結果不符`);
    }
  }
  return reasons;
}

/**
 * 盲測語義檢視清單（驗收 2）：全部題目新舊成對，左右順序依 id 雜湊決定、不標哪邊是新版；
 * 對照鍵另存一檔，審查者（乾淨 context、非新指示作者）只拿清單。
 */
function writeBlindReview(cases, baseArm, candidateArm) {
  const read = (arm, id) => {
    const file = path.join(CACHE_DIR, arm, `${id}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  };
  const sheet = ["# 語義檢視清單", "", "每題比較 X 與 Y，只記四類重大錯：數值或單位變了、否定或對象反轉、改口留錯邊、實質內容被刪或被加。", ""];
  const key = {};
  for (const c of cases) {
    const base = read(baseArm, c.id);
    const next = read(candidateArm, c.id);
    const flip = createHash("sha256").update(c.id).digest()[0] % 2 === 1;
    key[c.id] = flip ? { X: candidateArm, Y: baseArm } : { X: baseArm, Y: candidateArm };
    const [x, y] = flip ? [next, base] : [base, next];
    sheet.push(`## ${c.id}`, `- 口語：${c.spoken}`, `- 標準：${c.expected}`, `- X：${x?.text ?? "（缺）"}`, `- Y：${y?.text ?? "（缺）"}`, "");
  }
  const stem = `${baseArm.replace(/\//g, "_")}-vs-${candidateArm.replace(/\//g, "_")}`;
  const dir = path.dirname(SUMMARY_FILE);
  fs.writeFileSync(path.join(dir, `blind-${stem}.md`), sheet.join("\n"));
  fs.writeFileSync(path.join(dir, `blind-key-${stem}.json`), JSON.stringify(key, null, 2));
  process.stdout.write(`語義檢視清單：${cases.length} 題 → ${path.join(dir, `blind-${stem}.md`)}\n`);
}

function main() {
  const cases = loadCases();
  const summary = {};
  for (const stage of ["whisper", "llm"]) {
    for (const arm of listArms(stage)) {
      const byGroup = {};
      for (const c of cases) {
        const file = path.join(CACHE_DIR, stage, arm, `${c.id}.json`);
        if (!fs.existsSync(file)) continue;
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        // 失敗或空輸出不算有效成績（該題 ID 不進分組，完整性檢查就會擋）
        if (!isValidResult(cached)) continue;
        const output = stage === "whisper" ? cached.raw : cached.text;
        const reference = stage === "whisper" ? c.spoken : c.expected;
        const dictionaryTerms = buildDictionary(cases, c.lang).map((d) => d.term);
        const row = scoreCase(c, output ?? "", reference, dictionaryTerms);
        const author = c.id.startsWith("b-") ? "held-out" : "own";
        for (const group of ["all", `lang:${c.lang}`, `author:${author}`, `lang:${c.lang}|author:${author}`]) {
          (byGroup[group] ??= []).push(row);
        }
      }
      for (const [group, rows] of Object.entries(byGroup)) {
        summary[`${stage}/${arm}`] ??= {};
        summary[`${stage}/${arm}`][group] = aggregate(rows);
      }
    }
  }
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
  const blindIndex = process.argv.indexOf("--blind");
  if (blindIndex !== -1) {
    const [baseArm, candidateArm] = process.argv.slice(blindIndex + 1, blindIndex + 3);
    writeBlindReview(cases, baseArm, candidateArm);
    return;
  }
  const compareIndex = process.argv.indexOf("--compare");
  if (compareIndex !== -1) {
    const [baseArm, candidateArm] = process.argv.slice(compareIndex + 1, compareIndex + 3);
    const decision = decidePromotion(summary[baseArm] ?? {}, summary[candidateArm] ?? {}, cases.map((c) => c.id));
    // 同輸入核對預設開啟（辨識階段比的是不同提示，輸入本來就不同，可用 --skip-same-input 跳過）
    if (!process.argv.includes("--skip-same-input")) {
      for (const reason of findInputMismatches(cases, baseArm, candidateArm)) decision.reasons.push(reason);
      decision.promote = decision.reasons.length === 0;
    }
    process.stdout.write(`\n換預設判定 ${baseArm} → ${candidateArm}：${decision.promote ? "可換" : "不換"}\n`);
    for (const reason of decision.reasons) process.stdout.write(`  - ${reason}\n`);
    return;
  }
  for (const [arm, groups] of Object.entries(summary)) {
    process.stdout.write(`\n${arm}\n`);
    for (const [group, m] of Object.entries(groups)) {
      if (group.includes("|")) continue;
      process.stdout.write(
        `  ${group.padEnd(14)} n=${String(m.n).padStart(3)} 命中 ${m.entityHitRate}% 誤改 ${m.falseReplacementRate}% 刪除 ${m.keepDeletionRate}% 字元錯誤 ${m.cer}% 改口字元錯誤 ${m.selfCorrectionCer}% 數字格式 ${m.numericFormatRate}% 命中數 ${m.entityHitCount} 誤改題數 ${m.falseReplacementCount}\n`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
