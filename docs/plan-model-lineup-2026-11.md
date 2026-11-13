# 計畫：文字整理模型清單更新（2026-11）

> 建立：2026-11-13。範圍經使用者拍板（三題＋一題改判，見「拍板」）。

## 要解決什麼

設定頁的文字整理模型清單是 2026-07-10 的快照，四個月後三家各有變動：

| 家 | 現況（官方頁，2026-11-13 查） |
|---|---|
| Groq | 預設 `qwen/qwen3.6-27b` 列在棄用頁：free＋developer 層 shutdown 09/14/26，替代 `qwen/qwen3.8-27b`（preview，$0.80/$4.00）；enterprise 不受影響 |
| OpenAI | `gpt-5.4-nano` 已棄用，2027-04-01 下架，替代 `gpt-6-luna`（$0.10/$0.50）；`gpt-5.6-luna` 7/30 降價至 $0.20/$1.20 |
| Anthropic | `claude-haiku-4-5-20251001` 仍 Active，但已過「不早於 2026-10-15」的最早退役日；新出 `claude-haiku-5-5`（$0.10/$0.50，≤100K prompt） |

Gemini 不在本輪範圍（使用者收窄為 OpenAI＋Anthropic＋Groq）；備註：`gemini-3.5-flash` 已被官方自動轉到 `gemini-3.6-flash`。

## 拍板（2026-11-13）

1. OpenAI：`gpt-6-luna`（新預設）＋保留 `gpt-5.6-luna`；`gpt-5.4-nano` 移出、遷移到 `gpt-6-luna`
2. Anthropic：`claude-haiku-5-5`（新預設）＋保留 Haiku 4.5（不遷移既有使用者）
3. Groq：先選 gpt-oss-120b 當預設，實測後**改判**為 `qwen/qwen3.8-27b` 當預設（見證據 C）；`qwen/qwen3.6-27b` 移出、遷移到 qwen3.8

## 動工前已驗（真 key 探針）

- **A. Haiku 5.5**：帶 `temperature: 0.1` → 400「`temperature` is deprecated for this model」；不關 thinking → 200 但**推理文字混進 text 區塊**（先輸出簡體，再寫 "Wait, I should match…"）；`thinking: {type: "disabled"}`＋不送 temperature → 200、繁中正確、約 1.1 秒。Haiku 4.5 現行請求（含 temperature 0.1）→ 200。
- **B. OpenAI**：`GET /v1/models/gpt-6-luna` → 200、`shutdown_date: null`；官方模型頁寫 Chat Completions Supported、`reasoning.effort` 支援 `none`。**整理請求未實測**：帳戶額度用盡（429 `credit_balance_exhausted`），儲值後須重跑探針才可發版。
- **B2. OpenAI 補測（2026-11-13，使用者換另一把 key）**：同 C 的 8 種情境 × 兩模型，16/16 HTTP 200，延遲 0.9–4.9 秒（逾時 30 秒）
  - gpt-6-luna：精簡版問句型改寫成信件口吻（「老闆您好，我明天要請假。請問…」，內容未丟）；積極版中英夾雜漏「deploy 的 pipeline」；其餘 6 筆正常
  - gpt-5.6-luna（舊預設）：精簡版問句型**直接寫出整封信**（含「主旨：」，長度 1.46 倍）；其餘 7 筆正常
  - 判定：6-luna 當預設不劣於現狀（最嚴重的回答行為舊預設更明顯）、價格一半 → 維持拍板，程式不改
- **C. Groq**（App 內建 zh-TW 精簡版／積極版指示 × 短句／問句型／中英夾雜／長文，共 8 筆／模型）：
  - gpt-oss-120b：積極版問句型**拒答**（「抱歉，我只能協助校對…」）；精簡版中英夾雜**漏前半句**；延遲 0.3–1.1 秒
  - qwen3.8-27b：8/8 正常，品質與 qwen3.6 相當，延遲 0.24–0.67 秒（逾時 5 秒）
  - 使用者的 key 呼叫 qwen3.6 仍回 200（非免費層），免費層是否已失效未驗

## 追加：Gemini（2026-11-13 使用者追加範圍）

使用者追加「Gemini 也要更新、顯示的模型名稱也要更新」。

- 官方頁（aistudio.google.com/docs）：`gemini-3.5-flash` 已不在 AI Studio、端點自動轉 `gemini-3.6-flash`；`gemini-3.1-flash-lite` 最早 2027-05-07 退役、替代 `gemini-3.5-flash-lite`；3.6-flash $0.75/$3.75、**2027-01-01 起 $1.50/$7.50**；3.5-flash-lite $0.30/$2.50；四者皆 Stable、有免費層；`gemini-3.8-flash` 不支援 MINIMAL thinking
- 實測（D，同 C 的 8 種情境 × 4 模型，請求照 llmProvider 的 generateContent 格式、逾時 30 秒）：
  - 3.8-flash（LOW）：0/8，全部 503「high demand」
  - 3.6-flash（MINIMAL）：7/8，品質好；延遲不穩，出現 19 秒、28 秒與一筆 30 秒逾時
  - 3.5-flash-lite（MINIMAL）：8/8，0.7–2.1 秒，無回答行為（小瑕疵：一筆留「呃」、一筆未補標點）
  - 3.1-flash-lite（MINIMAL，現有）：8/8，但兩筆問句型直接寫成信件，延遲最慢 13 秒
- 拍板：`gemini-3.5-flash-lite`（預設、full）＋`gemini-3.6-flash`（limited，沿用 3.5-flash 分類）；3.5-flash → 3.6-flash、3.1-flash-lite → 3.5-flash-lite 遷移
- 代決：3.6-flash 價格登錄 2027 起的 $1.50/$7.50（出貨後多數時間在漲價後、費用上限寧可高估）；要改回現價改 registry 兩個數字即可
- 顯示名稱：registry 的 `displayName` 是 App 唯一的模型名稱來源；全部對齊官方寫法（Gemini 官方 models 頁寫「Flash-Lite」、OpenAI「GPT-6 Luna」、Anthropic「Claude Haiku 5.5」、Groq「GPT OSS 120B」；Qwen 保留「Qwen3.8 27B (Preview)」以標示 preview）
- thinking 參數不需改：兩顆都支援 MINIMAL，沿用 `gemini-3` 前綴判斷
- apiPricing fallback 常數 $9/M 仍 ≥ registry 最大值（3.6-flash $7.5），只更正註解

## 改動

1. `src/lib/modelRegistry.ts`
   - Groq：qwen3.6 條目換成 `qwen/qwen3.8-27b`（顯示「Qwen3.8 27B (Preview)」、$0.80/$4.00、保留預設與「平衡 · 預設」徽章；免費額度沿用 1K RPD／200K TPD）
   - OpenAI：新增 `gpt-6-luna`（預設、$0.10/$0.50、「最快 · 最便宜」）；`gpt-5.6-luna` 改非預設、價格改 $0.20/$1.20；移除 `gpt-5.4-nano`
   - Anthropic：新增 `claude-haiku-5-5`（預設、$0.10/$0.50、「最快 · 最便宜」）；Haiku 4.5 改非預設
   - `DEFAULT_LLM_MODEL_ID` → `qwen/qwen3.8-27b`
   - 遷移表：只加 `qwen/qwen3.6-27b → qwen/qwen3.8-27b`、`gpt-5.4-nano → gpt-6-luna`；既有指向 qwen3.6 的舊條目不改（迴圈解析兩跳即到，計劃閘 MED-3 採納）
   - qwen3.8 免費額度依據：Groq rate-limits 頁把 qwen3.8-27b 與 gpt-oss-120b／20b 列為同組數字（30 RPM／1K RPD／8K TPM／200K TPD），與 registry 中 gpt-oss 現值一致（計劃閘 MED-2）
2. `src/lib/llmProvider.ts`：Anthropic 請求遇 `claude-haiku-5` 前綴時不送 temperature、加 `thinking: {type: "disabled"}`；其他 Anthropic 模型照舊（保留 Haiku 4.5 現行行為）。共用組裝器同時涵蓋字典分析（其 messages 以 user 結尾）
3. 測試：更新寫死舊 id 的斷言與預設模型費用斷言（$3 → $4）；新增各 provider 預設 id 表格測試（計劃閘 MED-1）；新增 Haiku 5.5 請求體測試（無 temperature、有 thinking disabled）、Haiku 4.5 仍送 temperature；遷移測試加 qwen3.6、nano

計劃閘（codex gpt-6.1-sol high，2026-11-13）：GO、0 HIGH、3 MED 全採納（如上）。

## 不做

- 不加 refusal 處理、effort 參數（未被實測逼出）
- 不動 Gemini、Whisper
- 不改 `anthropic-version` 標頭（2023-06-01 對兩顆 Haiku 實測皆可）
- 不發版；OpenAI 未實測前不發

## 驗收

- `pnpm test`、`vue-tsc --noEmit`、eslint 全綠
- ~~發版前：OpenAI 儲值後以 `gpt-6-luna` 跑整理探針 → 200 且輸出正確~~ ✅ 2026-11-13 已補測（見 B2）
