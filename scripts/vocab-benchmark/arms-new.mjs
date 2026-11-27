// v0.17 新版對照組：新選詞（C）＋ 896 位元組裁切（A0）＋新指示（E）。
// 新指示一律呼叫 App 的組裝函式 buildEnhanceMessages，測的就是出貨的訊息。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMON_WORDS, LANG_META } from "./run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const MAX_WHISPER_PROMPT_BYTES = 896;
const WHISPER_PROMPT_PREFIX = "Important Vocabulary: ";
const MAX_PROMPT_TERMS = 50;
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86400000).toISOString();

/**
 * 模擬詞庫的學習狀態（規格 F「依規則明定」）：全部是 AI 學到的詞、各改正過 1 次、最後改正在 60 天前；
 * 常用詞在最近辨識紀錄裡出現 10 次（≥ 8 → 依排除規則退出 Whisper 清單），專有名詞沒出現過。
 */
function toEntries(dictionary) {
  return dictionary.map((d, i) => ({
    id: `sim-${i}`,
    term: d.term,
    source: d.source,
    correctionCount: 1,
    lastCorrectedAt: SIXTY_DAYS_AGO,
    createdAt: SIXTY_DAYS_AGO,
  }));
}

function simulatedRecentRawTexts(lang) {
  return Array.from({ length: 10 }, () => COMMON_WORDS[lang].join(" "));
}

/** 與 Rust format_whisper_prompt 相同：依優先度收詞、放不下的詞跳過、整段 ≤ 896 位元組、反轉 */
export function formatNewWhisperPrompt(terms) {
  const kept = [];
  let bytes = Buffer.byteLength(WHISPER_PROMPT_PREFIX);
  for (const term of terms) {
    const next = bytes + (kept.length ? 2 : 0) + Buffer.byteLength(term);
    if (next > MAX_WHISPER_PROMPT_BYTES) continue;
    kept.push(term);
    bytes = next;
    if (kept.length === MAX_PROMPT_TERMS) break;
  }
  return `${WHISPER_PROMPT_PREFIX}${kept.reverse().join(", ")}`;
}

async function loadSelection() {
  return import(path.join(ROOT, "src/lib/vocabularySelection.ts"));
}

export const WHISPER_ARMS = {
  new: async ({ c, dictionary }) => {
    const { selectWhisperVocabulary } = await loadSelection();
    const terms = selectWhisperVocabulary(toEntries(dictionary), simulatedRecentRawTexts(c.lang), true, Date.now());
    return formatNewWhisperPrompt(terms);
  },
};

async function newAiTermList(dictionary, raw) {
  const { selectAiVocabulary } = await loadSelection();
  return selectAiVocabulary(toEntries(dictionary), [], raw).map((candidate) => candidate.term);
}

function oldArm(mode) {
  return async ({ c, dictionary, raw }) => {
    const prompts = await import(path.join(HERE, "baseline/prompts-v016.ts"));
    const termList = await newAiTermList(dictionary, raw);
    const locale = LANG_META[c.lang].promptLocale;
    const base = prompts.getPromptForModeAndLocale(mode, locale);
    // v0.16 buildSystemPrompt 的組裝（字典說明句＋<vocabulary>），user message 不包標籤
    const system = termList.length
      ? `${base}\n\n${prompts.getVocabularyNoteForLocale(locale)}\n<vocabulary>\n${termList.join(", ")}\n</vocabulary>`
      : base;
    return { system, termList, user: (text) => text, isRevisedBuiltinPrompt: false };
  };
}

function newArm(mode) {
  return async ({ c, dictionary, raw }) => {
    const prompts = await import(path.join(ROOT, "src/i18n/prompts.ts"));
    const { buildEnhanceMessages } = await import(path.join(ROOT, "src/lib/enhanceMessages.ts"));
    const termList = await newAiTermList(dictionary, raw);
    const locale = LANG_META[c.lang].promptLocale;
    const options = {
      systemPrompt: prompts.getPromptForModeAndLocale(mode, locale),
      vocabularyTermList: termList.length ? termList : undefined,
      promptLocale: locale,
      isRevisedBuiltinPrompt: true,
    };
    const [system, user] = buildEnhanceMessages(raw, options);
    return { system: system.content, termList, user: () => user.content, isRevisedBuiltinPrompt: true };
  };
}

export const LLM_ARMS = {
  "prompt-old-minimal": oldArm("minimal"),
  "prompt-old-active": oldArm("active"),
  "prompt-new-minimal": newArm("minimal"),
  "prompt-new-active": newArm("active"),
};
