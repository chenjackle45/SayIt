# 計畫：整理結果統一轉繁體，避免語意守衛誤擋（#83 續，跨平台）（v0.14.2）

> 建立：2026-10-20 · 狀態：計劃閘有條件 GO（1 HIGH、2 MED、5 LOW 全收）→ **已實作，實作閘 GO（3 LOW：收 1、不修 2），見文末**（雲端 session，codex 不可用；使用者指定由獨立 Claude 子代理唯讀審查）
> 來源：#83（ian90041）。10/15 回報：被擋時「幾乎都是中文」、模型 GPT OSS 120B、中文介面、辨識語言自動，訊息為「整理結果與原文差異過大，已保留原結果」，重試永遠一樣。拍板：2026-10-20 使用者「按照建議修」，排進 v0.14.2。

## 要解決什麼

| | 已查證的事實（讀碼／實算） | 推論（待驗） |
|---|---|---|
| 原文 | 有效辨識語言（自動時＝介面語言）為 zh-TW／yue 時，原文落地前轉繁體（`useVoiceFlowStore.ts:1268`、`:1710`；`useHistoryStore.ts:755`） | — |
| 整理結果 | **不轉**。只靠提示詞要求「使用繁體中文」 | GPT OSS 120B 不一定照做、輸出簡體 |
| 語意守衛 | `detectSemanticDrift` 正規化只做小寫、去標點，**不統一繁簡**；enhanced 的 bigram 落在 raw 的比例 < 0.2 判飄移 | — |
| 實算 | 4 句繁體中文，**只做繁→簡、內容不動**，重疊率 0.19／0.23／0.38／0.40 | 模型再順句、刪贅字就會跌破 0.2；同一段原文＋同一模型輸出穩定 → 重試永遠失敗 |
| 守衛呼叫點 | 即時（`useVoiceFlowStore.ts:1446`，被擋默默退回原文）、重送（`:1774`）、歷史重新整理（`enhancer.ts:247` → `useHistoryStore.ts:888` 顯示「差異過大」） | 回報者看到的是歷史重新整理那條 |
| 附帶問題 | 模型沒照做又沒被擋時，貼出去的是簡體 | 違反 #39「選繁中就給繁體」的期待 |

## 方案

整理結果用**與原文相同的規則**轉換：`enhanceText` 新增選項 `transcriptLocale?: string`（有效辨識語言），有值時在回傳前對整理結果套用 `applyTranscriptTextTransforms(enhancedContent, transcriptLocale)`（zh-TW／yue → 簡轉繁；其他語言原樣）。

- 轉換在 `enhanceText` 內、回傳前做 → 長度守衛、語意守衛、貼上、寫 DB 全部看到繁體；三條路徑都不用各自記得補
- 傳值的只有三條「整理」路徑：即時（`useVoiceFlowStore.ts:1405` 的 `enhanceOptions`，含重試迴圈）、重送（`:1760`）、歷史重新整理（`useHistoryStore.ts:857`，經 `enhanceWithAnomalyGuard` 透傳 options）
- **編輯模式（`useVoiceFlowStore.ts:1607`）不傳**：使用者可能明講「翻成簡體」，不可強轉
- 有效語言的解析：`useVoiceFlowStore` 把既有 `applyTranscriptTextTransforms(rawText)` 內的解析抽成 `getEffectiveTranscriptLocale()` 共用；`useHistoryStore` 同樣把 755 行附近的解析抽成區域 helper 供重新辨識與重新整理共用（不跨 store 新增依賴）
- 空回應退回原文（`isRawFallback`）路徑不轉（原文已是轉換後的）
- 非中文輸出：opencc cn→tw 對英文／日文假名等不改字；日文漢字可能被轉成繁體字形——只在有效語言是 zh-TW／yue 時才轉，與原文規則一致，可接受
- 自訂提示詞：zh-TW／yue 下即使自訂提示詞要求簡體，整理結果也會被轉繁體（原文本來就強制繁體，可接受）
- 其他 `enhanceText` 呼叫點：`connectionTest.ts:28`（連線測試）不傳

**守衛兩側字形統一（計劃閘 H1 追加）**：`detectSemanticDrift` 的 `normalizeForOverlap` 對 raw 與 enhanced **兩側**都先做 `convertSimplifiedToTraditional`（lib→lib）。兩側同一個確定性轉換，只修正「字形不同」造成的低重疊，不放寬對真正答非所問的攔截。涵蓋：
- 歷史舊紀錄 raw_text 為簡體（v0.12.0 `96a6826` 之前，或當時有效語言非 zh-TW／yue），重新整理時模型照提示詞輸出繁體 → 現況就會被擋，只做輸出轉繁體反而必定被擋
- zh-CN 介面＋自動：Whisper 出繁體、模型照提示詞轉簡體的反向情況

## 不做

- 不改 0.2 門檻
- 不動提示詞
- 不處理已知殘餘限制（中文介面＋自動＋講英文被譯成中文）——10/10 已對外說明照現狀出貨

## 改動檔案

- `src/lib/hallucinationDetector.ts`：`normalizeForOverlap` 兩側簡轉繁
- `src/lib/enhancer.ts`：`EnhanceOptions.transcriptLocale`；`enhanceText` 回傳前套用轉換
- `src/stores/useVoiceFlowStore.ts`：抽 `getEffectiveTranscriptLocale()`；即時與重送兩處 options 傳 `transcriptLocale`
- `src/stores/useHistoryStore.ts`：抽有效語言 helper；重新整理 options 傳 `transcriptLocale`
- 測試（用真的 opencc，不 mock）：
  - `tests/unit/hallucination-detector.test.ts`：繁體 raw＋同內容簡體 enhanced 不判 drift；簡體 raw（舊紀錄）＋繁體 enhanced 不判 drift；真正不相干內容仍判 drift
  - `tests/unit/enhancer.test.ts`：transcriptLocale＝zh-TW／yue 時簡體輸出被轉繁、未傳／en 時不轉；fetch 回簡體經 `enhanceWithAnomalyGuard` 得 wasDrift=false
  - `tests/unit/use-history-retry.test.ts`：重新整理把有效語言傳進去
  - `tests/unit/use-voice-flow-store.test.ts`：settings stub 補 `selectedTranscriptionLocale`／`selectedLocale`；auto＋zh-TW 傳 `"zh-TW"`、明確 en 傳 `"en"`；編輯模式 options 沒有 `transcriptLocale` key

## 驗收

1. `pnpm test`、`npx vue-tsc --noEmit`、改動檔 `npx eslint` 全綠；新測試逐一消融（拿掉轉換 → 變紅）
2. （可選，使用者本機）Groq＋GPT OSS 120B、中文介面、自動：講一段中文，日誌不再出現 `drift=true`，貼出為繁體；歷史紀錄「重新整理」不再顯示「差異過大」

## 計劃閘紀錄（2026-10-20，獨立 Claude 子代理唯讀審查）

**有條件 GO**，全收：

| 等級 | 內容 | 處理 |
|---|---|---|
| HIGH | 歷史舊紀錄 raw_text 為簡體（v0.12.0 前／當時非繁中），只轉輸出會讓重新整理必定被擋 | 收：守衛兩側簡轉繁（已驗 `96a6826` 2026-09-10 才加 s2t） |
| MED | voiceFlow 測試 settings stub 缺語言欄位，斷言會假綠 | 收：補 getter、測兩組、編輯模式斷言沒有 key |
| MED | 歷史測試 mock 掉 enhancer，抓不到端到端 | 收：端到端消融落在 enhancer／detector 測試、用真轉換器 |
| LOW | 轉換位置、isRawFallback、長度守衛無副作用 | 確認 |
| LOW | 自訂提示詞也被轉繁 | 收：寫進方案 |
| LOW | connectionTest 不傳 | 收：寫進方案 |
| LOW | 有效語言 helper 與現況一致 | 確認 |
| LOW | zh-CN 反向情況 | 收：守衛兩側統一一併解決 |

## 實作閘紀錄（2026-10-20，獨立 Claude 子代理唯讀審查）

**GO**（0 HIGH、0 MED、3 LOW）。消融 7 項皆變紅（守衛不轉、輸出不轉、即時／重送／歷史不傳、auto 不解析、編輯模式誤傳）。

| 等級 | 內容 | 處理 |
|---|---|---|
| LOW | 非繁中使用者首次整理多一次 converter 建立（約 200ms，之後有快取） | 不修：量級可接受 |
| LOW | 缺「空回應＋transcriptLocale → 不轉」測試 | 收：補測試並消融 |
| LOW | 整理選項取有效語言的時點晚於原文轉換，期間改語言兩邊可能不一致 | 不修：機率極低 |
