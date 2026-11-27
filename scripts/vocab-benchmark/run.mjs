// 詞庫＋AI 整理指示評估（不隨 App 出貨）。用法見 README.md。
// 金鑰從本機 SayIt 設定讀取，不印出、不寫檔；每次 API 呼叫計入 usage.json，總上限 3,000。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DATA_DIR = path.join(ROOT, "tests/eval/vocab");
const RESULT_DIR = path.join(DATA_DIR, "results");
const CACHE_DIR = path.join(RESULT_DIR, "cache");
const USAGE_FILE = path.join(RESULT_DIR, "usage.json");
const AUDIO_DIR =
  process.env.BENCH_AUDIO_DIR ?? path.join(os.homedir(), ".cache/sayit-vocab-bench/audio");
const SETTINGS_FILE = path.join(
  os.homedir(),
  "Library/Application Support/com.sayit.app/settings.json",
);
const CALL_CAP = 3000;
const LLM_MODEL = "qwen/qwen3.8-27b"; // App 預設 AI 整理模型
const WHISPER_MODEL = "whisper-large-v3"; // App 預設轉錄模型
const MAX_PROMPT_TERMS = 50;

export const LANG_META = {
  "zh-TW": { voice: "Flo (中文（台灣）)", whisper: "zh", promptLocale: "zh-TW", transform: "zh-TW" },
  "zh-CN": { voice: "Flo (中文（中國大陸）)", whisper: "zh", promptLocale: "zh-CN", transform: "zh-CN" },
  en: { voice: "Flo (英文（美國）)", whisper: "en", promptLocale: "en", transform: "en" },
  ja: { voice: "Flo (日文（日本）)", whisper: "ja", promptLocale: "ja", transform: "ja" },
  ko: { voice: "Flo (韓文（南韓）)", whisper: "ko", promptLocale: "ko", transform: "ko" },
  yue: { voice: "Sinji (中文（香港）)", whisper: "yue", promptLocale: "yue", transform: "yue" },
};

// 模擬真實詞庫裡「被學進來、權重很高的常用詞」（樣本資料庫觀察到的失效型態），每語言 10 個
export const COMMON_WORDS = {
  "zh-TW": ["會議", "今天", "因為", "問題", "時間", "可以", "然後", "我們", "東西", "應該"],
  "zh-CN": ["会议", "今天", "因为", "问题", "时间", "可以", "然后", "我们", "东西", "应该"],
  en: ["meeting", "today", "because", "problem", "time", "really", "people", "something", "actually", "maybe"],
  ja: ["会議", "今日", "問題", "時間", "大丈夫", "ちょっと", "やっぱり", "みんな", "本当に", "多分"],
  ko: ["회의", "오늘", "문제", "시간", "그래서", "진짜", "사람", "괜찮아요", "아마", "정말"],
  yue: ["會議", "今日", "因為", "問題", "時間", "可以", "跟住", "我哋", "嘢", "應該"],
};

// ---------- 資料 ----------
const REQUIRED_FILES = ["cases-a.jsonl", "cases-b.jsonl"];

/** 必要題單缺檔或內容與 FROZEN.sha256 不符 → 直接中止（R4：不得靜默縮小驗收範圍） */
export function assertFrozenInputs() {
  const frozenFile = path.join(DATA_DIR, "FROZEN.sha256");
  if (!fs.existsSync(frozenFile)) throw new Error("缺 FROZEN.sha256，題單未定稿");
  const frozen = new Map(
    fs
      .readFileSync(frozenFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .map(([hash, file]) => [path.basename(file), hash]),
  );
  for (const name of REQUIRED_FILES) {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`缺必要題單 ${name}`);
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (frozen.get(name) !== hash) throw new Error(`${name} 與定稿雜湊不符`);
  }
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function loadCases() {
  assertFrozenInputs();
  return [
    ...readJsonl(path.join(DATA_DIR, "cases-a.jsonl")),
    ...readJsonl(path.join(DATA_DIR, "cases-b.jsonl")),
  ];
}

/** 每語言一份模擬詞庫：該語言所有題目的專有名詞（權重 1）＋常用詞（權重高，模擬現行權重機制的偏差） */
export function buildDictionary(cases, lang) {
  const entityTerms = [];
  for (const c of cases) {
    if (c.lang !== lang) continue;
    for (const e of c.entities) if (!entityTerms.includes(e)) entityTerms.push(e);
  }
  const entries = [];
  COMMON_WORDS[lang].forEach((term, i) =>
    entries.push({ term, source: "ai", weight: 300 - i * 10, kind: "common", order: i }),
  );
  entityTerms.forEach((term, i) =>
    entries.push({ term, source: "ai", weight: 1, kind: "entity", order: 100 + i }),
  );
  return entries;
}

/** v0.16 的取詞：手動優先 → weight DESC → created_at DESC（模擬：題目越後面越新），取前 50 */
export function selectCurrentTopTerms(dictionary) {
  return [...dictionary]
    .sort((a, b) => {
      const manualA = a.source === "manual" ? 0 : 1;
      const manualB = b.source === "manual" ? 0 : 1;
      if (manualA !== manualB) return manualA - manualB;
      if (a.weight !== b.weight) return b.weight - a.weight;
      return b.order - a.order;
    })
    .slice(0, MAX_PROMPT_TERMS)
    .map((e) => e.term);
}

/** v0.16 Rust format_whisper_prompt：取前 50、反轉 */
export function formatCurrentWhisperPrompt(termList) {
  return `Important Vocabulary: ${termList.slice(0, MAX_PROMPT_TERMS).reverse().join(", ")}`;
}

// ---------- 計數 ----------
function readUsage() {
  if (!fs.existsSync(USAGE_FILE)) return { total: 8, note: "8 = 2026-11-27 Groq 提示長度探測" };
  return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
}
function bumpUsage(kind) {
  const usage = readUsage();
  if (usage.total >= CALL_CAP) throw new Error(`已達 API 呼叫上限 ${CALL_CAP}，停止`);
  usage.total += 1;
  usage[kind] = (usage[kind] ?? 0) + 1;
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

function getGroqKey() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  if (!settings.groqApiKey) throw new Error("本機設定沒有 Groq 金鑰");
  return settings.groqApiKey;
}

// ---------- 快取 ----------
function cachePath(stage, arm, id) {
  return path.join(CACHE_DIR, stage, arm, `${id}.json`);
}
/** 只有成功（200 且有輸出）的快取才算有效；失敗快取保留紀錄、下次重跑 */
export function isValidResult(cached) {
  return Boolean(cached) && cached.status === 200 && typeof (cached.text ?? cached.raw) === "string" && (cached.text ?? cached.raw).trim() !== "";
}
function readCache(stage, arm, id) {
  const file = cachePath(stage, arm, id);
  if (!fs.existsSync(file)) return null;
  const cached = JSON.parse(fs.readFileSync(file, "utf8"));
  return isValidResult(cached) ? cached : null;
}
function writeCache(stage, arm, id, value) {
  const file = cachePath(stage, arm, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ---------- 音檔與 API ----------
function ensureAudio(c) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const file = path.join(AUDIO_DIR, `${c.id}.wav`);
  if (!fs.existsSync(file)) {
    execFileSync("say", ["-v", LANG_META[c.lang].voice, "-o", file, "--data-format=LEI16@16000", c.spoken]);
  }
  return file;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function postWithRetry(url, init, kind) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    bumpUsage(kind);
    const response = await fetch(url, init());
    if (response.status === 429 || response.status >= 500) {
      const wait = Number(response.headers.get("retry-after") ?? 0) * 1000 || 2000 * (attempt + 1);
      await sleep(Math.min(wait, 60000));
      continue;
    }
    const text = await response.text();
    return { status: response.status, text };
  }
  throw new Error("重試次數用完");
}

export async function transcribe(c, prompt) {
  const audioFile = ensureAudio(c);
  const key = getGroqKey();
  const audio = fs.readFileSync(audioFile);
  const result = await postWithRetry(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    () => {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/wav" }), "recording.wav");
      form.append("model", WHISPER_MODEL);
      form.append("response_format", "json");
      form.append("language", LANG_META[c.lang].whisper);
      if (prompt) form.append("prompt", prompt);
      return { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form };
    },
    "whisper",
  );
  if (result.status !== 200) return { status: result.status, error: result.text.slice(0, 300), text: "" };
  return { status: 200, text: JSON.parse(result.text).text.trim() };
}

export async function chat(systemPrompt, userContent) {
  const key = getGroqKey();
  const result = await postWithRetry(
    "https://api.groq.com/openai/v1/chat/completions",
    () => ({
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.1,
        reasoning_effort: "none",
        max_tokens: 8192, // 與 App 的 Groq 預設輸出上限相同（getDefaultMaxTokens）
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    }),
    "chat",
  );
  if (result.status !== 200) return { status: result.status, error: result.text.slice(0, 300), text: "" };
  const content = JSON.parse(result.text).choices?.[0]?.message?.content ?? "";
  return { status: 200, text: content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() };
}

// ---------- 組態（各對照組）----------
async function loadTransform() {
  const mod = await import(path.join(ROOT, "src/lib/transcriptTextTransforms.ts"));
  return mod.applyTranscriptTextTransforms;
}

async function loadBaselinePrompts() {
  return import(path.join(HERE, "baseline/prompts-v016.ts"));
}

/** v0.16 的系統指示：預設模式＋（有詞時）字典說明句與 <vocabulary> 清單 */
function buildBaselineSystemPrompt(prompts, mode, promptLocale, termList) {
  const base = prompts.getPromptForModeAndLocale(mode, promptLocale);
  if (!termList.length) return base;
  return `${base}\n\n${prompts.getVocabularyNoteForLocale(promptLocale)}\n<vocabulary>\n${termList.join(", ")}\n</vocabulary>`;
}

export const WHISPER_ARMS = {
  none: () => null,
  current: ({ dictionary }) => formatCurrentWhisperPrompt(selectCurrentTopTerms(dictionary)),
};

export const LLM_ARMS = {
  "old-minimal": async ({ c, dictionary }) => {
    const prompts = await loadBaselinePrompts();
    return {
      system: buildBaselineSystemPrompt(prompts, "minimal", LANG_META[c.lang].promptLocale, selectCurrentTopTerms(dictionary)),
      termList: selectCurrentTopTerms(dictionary),
      user: (raw) => raw,
    };
  },
  "old-active": async ({ c, dictionary }) => {
    const prompts = await loadBaselinePrompts();
    return {
      system: buildBaselineSystemPrompt(prompts, "active", LANG_META[c.lang].promptLocale, selectCurrentTopTerms(dictionary)),
      termList: selectCurrentTopTerms(dictionary),
      user: (raw) => raw,
    };
  },
};

// 新版對照組由實作後的模組註冊（arms-new.mjs 存在才載入），避免基準期引用尚未存在的程式
async function loadNewArms() {
  const file = path.join(HERE, "arms-new.mjs");
  if (!fs.existsSync(file)) return;
  const mod = await import(file);
  Object.assign(WHISPER_ARMS, mod.WHISPER_ARMS ?? {});
  Object.assign(LLM_ARMS, mod.LLM_ARMS ?? {});
}

// ---------- 執行 ----------
function parseArgs(argv) {
  const args = { stage: null, arms: [], filter: null, input: "current" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--stage") args.stage = argv[++i];
    else if (argv[i] === "--arms") args.arms = argv[++i].split(",");
    else if (argv[i] === "--filter") args.filter = new RegExp(argv[++i]);
    else if (argv[i] === "--input") args.input = argv[++i];
  }
  return args;
}

async function runWhisper(cases, arms, allCases) {
  const transform = await loadTransform();
  for (const arm of arms) {
    if (!WHISPER_ARMS[arm]) throw new Error(`未知的辨識對照組 ${arm}`);
    for (const c of cases) {
      if (readCache("whisper", arm, c.id)) continue;
      const dictionary = buildDictionary(allCases, c.lang);
      const prompt = await WHISPER_ARMS[arm]({ c, dictionary, cases: allCases });
      const result = await transcribe(c, prompt);
      const raw = result.text ? transform(result.text, LANG_META[c.lang].transform) : "";
      writeCache("whisper", arm, c.id, { prompt, promptBytes: prompt ? Buffer.byteLength(prompt) : 0, ...result, raw });
      process.stdout.write(`whisper ${arm} ${c.id} ${result.status}\n`);
    }
  }
}

async function runLlm(cases, arms, inputArm, allCases) {
  const transform = await loadTransform();
  const { stripTranscriptTags } = await import(path.join(ROOT, "src/lib/enhanceMessages.ts"));
  for (const arm of arms) {
    if (!LLM_ARMS[arm]) throw new Error(`未知的整理對照組 ${arm}`);
    const cacheArm = `${arm}@${inputArm}`;
    for (const c of cases) {
      const transcript = readCache("whisper", inputArm, c.id);
      if (!transcript) {
        process.stdout.write(`skip ${c.id}（缺 ${inputArm} 辨識結果）\n`);
        continue;
      }
      // 上游辨識更新過就重跑：快取的輸入必須等於目前的辨識原文
      if (readCache("llm", cacheArm, c.id)?.input === transcript.raw) continue;
      const dictionary = buildDictionary(allCases, c.lang);
      const config = await LLM_ARMS[arm]({ c, dictionary, cases: allCases, raw: transcript.raw });
      if (!Array.isArray(config.termList)) throw new Error(`${arm} 沒有明確的詞庫清單（空清單請給 []）`);
      const result = await chat(config.system, config.user(transcript.raw));
      // 與 App enhanceText 相同的後處理：包過標籤才剝標籤，再套辨識語言的文字轉換（zh-TW／yue 簡轉繁）
      if (result.text) {
        const stripped = config.isRevisedBuiltinPrompt ? stripTranscriptTags(result.text) : result.text;
        result.text = transform(stripped, LANG_META[c.lang].transform);
      }
      writeCache("llm", cacheArm, c.id, { input: transcript.raw, termList: config.termList, ...result });
      process.stdout.write(`llm ${cacheArm} ${c.id} ${result.status}\n`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadNewArms();
  const allCases = loadCases();
  const cases = args.filter ? allCases.filter((c) => args.filter.test(c.id)) : allCases;
  if (args.stage === "whisper") await runWhisper(cases, args.arms, allCases);
  else if (args.stage === "llm") await runLlm(cases, args.arms, args.input, allCases);
  else throw new Error("用 --stage whisper|llm");
  process.stdout.write(`API 呼叫累計：${readUsage().total} / ${CALL_CAP}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
