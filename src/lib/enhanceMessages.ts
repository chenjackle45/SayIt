import { getVocabularyNoteForLocale, type PromptLocale } from "../i18n/prompts";

// 送給 LLM 的訊息組裝：只依賴指示檔，App（enhancer.ts）與評估腳本（scripts/vocab-benchmark）共用，
// 評估測到的就是出貨的訊息。

const MAX_VOCABULARY_TERMS = 50;

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
  promptLocale: PromptLocale = "zh-TW",
  isRevisedBuiltinPrompt = false,
): string {
  let prompt = basePrompt;

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n${getVocabularyNoteForLocale(promptLocale, isRevisedBuiltinPrompt)}\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

export interface EnhanceMessageOptions {
  systemPrompt: string;
  vocabularyTermList?: string[];
  promptLocale?: PromptLocale;
  /**
   * v0.17 改版的內建指示（目前只有精簡模式）＝true：逐字稿包進 <transcript>、用新版字典說明句。
   * 積極模式、自訂指示與編輯模式不傳：訊息與 v0.16 逐字相同。
   */
  isRevisedBuiltinPrompt?: boolean;
}

export function buildEnhanceMessages(
  rawText: string,
  options: EnhanceMessageOptions,
): { role: "system" | "user"; content: string }[] {
  const systemPrompt = buildSystemPrompt(
    options.systemPrompt,
    options.vocabularyTermList,
    options.promptLocale,
    options.isRevisedBuiltinPrompt,
  );
  const userContent = options.isRevisedBuiltinPrompt ? `<transcript>\n${rawText}\n</transcript>` : rawText;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

/** 模型偶爾把 <transcript> 標籤原樣抄回輸出；只在包過標籤的請求剝除 */
export function stripTranscriptTags(text: string): string {
  return text.replace(/<\/?transcript>/g, "").trim();
}
