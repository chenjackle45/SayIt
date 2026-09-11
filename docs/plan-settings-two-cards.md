# 計畫：設定頁兩卡重排 ＋ 模型清單標「需付費」（#71）

> 建立：2026-09-11 · 狀態：計劃閘一輪（0 HIGH、4 MED、1 LOW）＋實作閘一輪（0 HIGH、2 MED、2 LOW），全收 → 待 commit · 排程：v0.13 第二張

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| MED | Groq 金鑰 Label 沒有 `for`、Input 沒有 `id` | 已修：`groq-api-key` |
| MED | 應用程式卡拿掉轉錄語言後，介面語言與靜音之間少一條分隔線 | 已修 |
| LOW | 計畫驗收／測試段仍寫舊的二態方案 | 已修 |
| LOW | 簡中兩句新文案用了「」而非 “ ” | 已修 |

codex 另確認：控制項綁定集合搬前搬後一致、三家金鑰 handler 無交叉、三種回饋各在所屬卡、timer 清理齊、三態分類與徽章符合規則、無超出「不動」段的改動。未做 Tauri 實畫面對照。

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| MED | Gemini 3.5 Flash 標「需付費」沒依據：官方定價頁列 3.5 Flash 與 3.1 Flash-Lite 都有免費層 | 收：欄位改三態 `freeTier: full / limited / none`；3.5 Flash 標 limited（徽章「免費額度少」），OpenAI／Anthropic 標 none（「需付費」），其餘 full 不標 |
| MED | `modelFeedback` 由 Whisper 與 LLM 共用，搬家後 Whisper 回饋會出現在文字整理卡 | 收：拆成 `whisperModelFeedback`／`llmModelFeedback`，各在所屬卡顯示 |
| MED | 測試只驗 true→quota 0，全標 false 仍會綠 | 收：逐模型斷言八個分類；SettingsView 沒有掛載 harness，畫面行為列人工 |
| MED | 兩張卡的 description 沒有用途 | 收：不加，只加 title |
| LOW | Groq 共用提示沒帶「已設定／未設定」 | 收：`hasApiKey` 切換 `groqNote`／`groqNoteNotSet`，未設定時指引到上方卡 |
> 規格：`docs/demos/elevenlabs-settings/settings-redesign.html` 設計 A（2026-09-10 拍板）。本卡做「兩張功能卡」的骨架，**不含 ElevenLabs**；服務單選那格等 ElevenLabs 卡加入時再出現。使用者 2026-09-11 拍板以 repo 內拍板 demo 為規格、不另做 design.pen。

## 要解決什麼

1. 設定頁把 Groq 金鑰當「全站金鑰」放在頁首獨立一張卡，跟它服務的功能分開；「轉錄語言」躲在應用程式卡，跟轉錄模型不在一起。拍板結論是收成「語音轉錄」「文字整理」兩張對稱功能卡：金鑰跟著功能走。
2. #71：免費專案的使用者選到 Gemini 3.5 Flash、GPT-5.6 Luna 一測就「請求過於頻繁」，以為壞了。對外承諾「在模型清單把需付費標得更清楚」。

## 現況（設定頁卡片順序）

```
關於 → 快捷鍵 → [Groq API Key 卡] → [模型選擇卡：Whisper 模型＋測試 | LLM 服務單選＋各家金鑰＋測試 | LLM 模型] → AI 整理 Prompt → 門檻 → 智慧字典 → 輸入裝置 → 錄音 → [應用程式卡：介面語言、轉錄語言、靜音、音效、Dock、自啟動、啟動隱藏] → 除錯記錄
```

## 方案（純前端搬家，store／Rust 不動）

### 卡片結構（改後）

```
關於 → 快捷鍵 →
[語音轉錄卡]
  Groq API Key（狀態徽章、前往 Console 連結、說明改「用於語音轉錄；文字整理也選 Groq 時共用」、首次啟動歡迎提示、輸入／顯示／儲存／刪除）
  ── 分隔 ──
  模型（Whisper 下拉）｜ 語言（轉錄語言下拉，自應用程式卡搬入）  ← 並排
  模型說明（每小時費用）＋ 測試連線
[文字整理卡]
  服務單選（Groq／OpenAI／Anthropic／Gemini，原樣）
  金鑰格：Groq → 提示「使用語音轉錄的 Groq API Key（已設定／未設定）」；其他三家原樣
  測試連線 ＋ 回饋
  ── 分隔 ──
  模型下拉（每個模型多一顆「需付費」徽章，見下）＋ 說明 ＋ 回饋
→ AI 整理 Prompt → … → [應用程式卡：少掉轉錄語言那列] → 除錯記錄
```

### #71 付費標示

`modelRegistry.ts` 的 `LlmModelConfig` 加 `freeTier: "full" | "limited" | "none"`（計劃閘後改為三態）：OpenAI 兩個與 Claude Haiku 為 none（沒有免費層）；`gemini-3.5-flash` 為 limited（官方有免費層但免費專案常直接 429，即 #71 的情境）；Groq 三個與 `gemini-3.1-flash-lite` 為 full。模型下拉在既有徽章旁多一顆：none →「需付費」、limited →「免費額度少」、full 不加；`llmModelDescription` 末尾對 none／limited 各加一句提示。服務單選的標籤文字不動（「OpenAI（推薦）」是先前拍板）。

### i18n（五語系同步）

| 動作 | key |
|---|---|
| 新增 | `settings.stt.title`「語音轉錄」；`settings.llm.title`「文字整理」；`settings.modelBadge.paidOnly`「需付費」、`settings.modelBadge.limitedFree`「免費額度少」；`settings.model.paidOnlyHint`、`settings.model.limitedFreeHint`；`settings.provider.groqNoteNotSet` |
| 改文案 | `settings.apiKey.title` → 「Groq API Key」；`settings.apiKey.instruction` → 「用於語音轉錄。文字整理也選 Groq 時會共用這把金鑰。」；`settings.provider.groqNote` → 「使用語音轉錄的 Groq API Key（已設定）」 |
| 刪除 | `settings.model.title`、`settings.model.description`（模型選擇卡消失） |

### 不動

- store、Rust、事件、`useSettingsStore` 的任何欄位
- 服務單選（轉錄只有 Groq 一家，等 ElevenLabs 卡再加）
- 各家金鑰欄的元件寫法（原樣搬入文字整理卡）
- 應用程式卡其餘各列

## 驗收

1. 頁首不再有獨立 Groq 金鑰卡；「語音轉錄」卡內金鑰輸入、顯示、儲存、刪除、狀態徽章、歡迎提示行為與 v0.12.0 相同
2. 轉錄語言在「語音轉錄」卡與模型並排，切換後回饋文字與跨視窗同步行為不變；應用程式卡不再有它
3. 「文字整理」卡：服務切換、四家金鑰、測試連線、模型下拉行為與 v0.12.0 相同；選 Groq 時提示「使用語音轉錄的 Groq API Key」
4. 模型下拉：三個 none（GPT-5.6 Luna、GPT-5.4 Nano、Claude Haiku 4.5）有「需付費」徽章、一個 limited（Gemini 3.5 Flash）有「免費額度少」徽章，說明句各多一句；四個 full 不加
5. 五語系新舊 key 一致（jq 對照）；`vue-tsc`、`pnpm test`、eslint 全綠
6. 人工：`pnpm tauri dev` 對照 demo 設計 A（去掉服務單選格）

## 測試

- `modelRegistry` 單元測試：逐模型斷言八個 `freeTier` 分類（全標 full 也不會意外變綠）；none 的模型 `freeQuotaRpd` 必為 0；Groq 全部 full
- 既有 i18n／settings store 測試不動

## 閘門

小卡節流：計劃閘最多兩輪。UI 搬家風險在「搬丟綁定」，實作閘請 codex 逐塊對照搬前搬後。
