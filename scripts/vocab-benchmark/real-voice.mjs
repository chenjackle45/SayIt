// 真人關（驗收 3）：使用者本人 15 句錄音 × ｛有詞庫、無詞庫｝× ｛舊精簡、新精簡｝。
// 用法：BENCH_AUDIO_DIR=tests/eval/vocab/real-voice node --import ./scripts/vocab-benchmark/ts-resolve.mjs scripts/vocab-benchmark/real-voice.mjs
// 結果存 tests/eval/vocab/results/real-voice.json；盲測頁由 real-voice-sheet 產生。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcribe, chat, LANG_META } from "./run.mjs";
import { formatNewWhisperPrompt } from "./arms-new.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(ROOT, "tests/eval/vocab/results/real-voice.json");

const SENTENCES = [
  "明天下午三點跟阿欽開會，不對，改成四點",
  "這個功能用 Tauri 跟 Vue 寫的，打包後放到 GitHub",
  "請不要把這份報價單寄給客戶",
  "總共是一千兩百五十元，含稅",
  "我要的是 iPhone 不是 iPad",
  "幫我查一下 Kubernetes 的 Pod 為什麼一直重啟",
  "嗯那個就是我覺得這個方案其實還不錯",
  "會議改到下週五，喔不是，下週四早上十點",
  "你可以幫我看一下這個 bug 嗎",
  "寄給陳泰呈和林佳穎兩個人",
  "庫存還剩百分之十五，先不要再下單",
  "用 Supabase 存資料，前端部署在 Vercel",
  "第一點先修登入，第二點加測試，第三點更新文件",
  "這次先不改，等使用者回報再說",
  "把連線逾時從三十秒改成六十秒",
];
const DICTIONARY = ["阿欽", "陳泰呈", "林佳穎", "Tauri", "Vue", "Kubernetes", "Supabase", "Vercel"];
const NOW = new Date().toISOString();

async function main() {
  const prompts = await import(path.join(ROOT, "src/i18n/prompts.ts"));
  const baseline = await import(path.join(HERE, "baseline/prompts-v016.ts"));
  const { buildEnhanceMessages, stripTranscriptTags } = await import(path.join(ROOT, "src/lib/enhanceMessages.ts"));
  const { selectWhisperVocabulary, selectAiVocabulary } = await import(path.join(ROOT, "src/lib/vocabularySelection.ts"));
  const { applyTranscriptTextTransforms } = await import(path.join(ROOT, "src/lib/transcriptTextTransforms.ts"));

  // 使用者手動加的詞（手動詞永遠進 Whisper 清單）
  const entries = DICTIONARY.map((term, i) => ({
    id: `rv-${i}`, term, source: "manual", correctionCount: 0, lastCorrectedAt: null, createdAt: NOW,
  }));
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

  for (let i = 0; i < SENTENCES.length; i += 1) {
    const id = String(i + 1).padStart(2, "0");
    const c = { id, lang: "zh-TW", spoken: SENTENCES[i] };
    for (const vocab of ["with", "none"]) {
      const key = `${id}:${vocab}`;
      if (results[key]?.old?.status === 200 && results[key]?.new?.status === 200) continue;
      const whisperTerms = vocab === "with" ? selectWhisperVocabulary(entries, [], true, Date.now()) : [];
      const whisperPrompt = whisperTerms.length ? formatNewWhisperPrompt(whisperTerms) : null;
      const transcript = await transcribe(c, whisperPrompt);
      if (transcript.status !== 200) throw new Error(`${key} 辨識失敗 ${transcript.status}`);
      const raw = applyTranscriptTextTransforms(transcript.text, "zh-TW");
      const aiTerms = vocab === "with" ? selectAiVocabulary(entries, [], raw).map((x) => x.term) : [];

      // 舊精簡：v0.16 指示＋舊說明句、不包標籤
      const oldBase = baseline.getPromptForModeAndLocale("minimal", "zh-TW");
      const oldSystem = aiTerms.length
        ? `${oldBase}\n\n${baseline.getVocabularyNoteForLocale("zh-TW")}\n<vocabulary>\n${aiTerms.join(", ")}\n</vocabulary>`
        : oldBase;
      const oldResult = await chat(oldSystem, raw);
      // 新精簡：App 實際組裝
      const [system, user] = buildEnhanceMessages(raw, {
        systemPrompt: prompts.getPromptForModeAndLocale("minimal", "zh-TW"),
        vocabularyTermList: aiTerms.length ? aiTerms : undefined,
        promptLocale: "zh-TW",
        isRevisedBuiltinPrompt: true,
      });
      const newResult = await chat(system.content, user.content);
      const post = (text, wrapped) =>
        applyTranscriptTextTransforms(wrapped ? stripTranscriptTags(text) : text, "zh-TW");
      results[key] = {
        spoken: c.spoken,
        raw,
        aiTerms,
        old: { status: oldResult.status, text: oldResult.text ? post(oldResult.text, false) : "" },
        new: { status: newResult.status, text: newResult.text ? post(newResult.text, true) : "" },
      };
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
      process.stdout.write(`${key} ok\n`);
    }
  }
  process.stdout.write(`完成 ${Object.keys(results).length} 組 → ${OUT}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
void LANG_META;
