# 計畫：ElevenLabs 轉錄服務 ＋ 設定頁重排（v0.12）

> 建立：2026-09-10 · 狀態：已拍板、待 codex 計劃閘 · 排程：v0.12（返工 PR 併完之後，不插隊 v0.11.1）
> 拍板頁：`~/Documents/claude-html/2026-09/sayit-settings-redesign-2026-09-10.html`

## 已拍板

| 題 | 定案 |
|---|---|
| 版型 | **A 金鑰跟著服務走**：設定頁收成「語音轉錄」「文字整理」兩張對稱功能卡（服務 → 金鑰 → 模型），頁首獨立 Groq 金鑰卡拿掉 |
| 做不做 | 做，排 v0.12 |
| 預設服務 | Groq（現有使用者升級後零變動） |
| 隱私與標示 | 「不在 ElevenLabs 保存錄音」預設開；ElevenLabs 選項標「付費」 |

## 要解決什麼

轉錄線目前只有 Groq 一家，網址／認證／表單／回應解析全寫死在後端；加 ElevenLabs Scribe v2 是替轉錄線第一次引入服務維度。順帶修設定頁的結構問題：Groq 金鑰被當成全站金鑰放在頁首，切換轉錄服務後仍留在眼前。

## 範圍（方案 A：最小分支）

### 後端（Rust，約 150 行）
- 轉錄服務枚舉 `groq | elevenlabs`；同一條請求函式依服務分支：網址、認證 header（Bearer vs `xi-api-key`）、表單欄位（`model`/`language`/`prompt` vs `model_id`/`language_code`/`keyterms[]`）、回應解析。
- ElevenLabs 回應無「無語音機率」→ 回傳 `None`，前端幻覺偵測第 2b 層對它跳過（不用其他欄位硬湊）。
- 檔案上限依服務（Groq 25 MB 不變）。
- 連線測試指令多帶服務參數，仍送 1 秒靜音。
- 重試包裝不動（與服務無關）。
- 零留存：ElevenLabs 請求帶 `enable_logging=false`，依設定開關。

### 前端（TS/Vue，約 200 行 ＋ 五語系文案）
- 轉錄服務 registry（複製 LLM 那套）：`SttProviderId`、模型帶 `providerId`，清單依服務過濾；預設 Groq / Whisper Large V3。
- settings store：`selectedSttProviderId`、`elevenlabsApiKey`（只進 tauri-plugin-store）、`elevenlabsZeroRetention`（預設 true）、跨驗證（模型必須屬於選中的服務）。
- 設定頁重排（設計 A）：
  - 「語音轉錄」卡：服務單選（ElevenLabs 標付費）→ 對應金鑰欄（只顯示選中那家）→ 模型＋語言並排 → 測試連線 → ElevenLabs 時多零留存開關；卡角狀態徽章「已就緒／需要金鑰」。
  - 「文字整理」卡：既有 LLM 服務／金鑰／模型原樣搬入；兩邊都選 Groq 時顯示「使用語音轉錄的 Groq API Key」，轉錄非 Groq 時 Groq 金鑰欄出現在這裡。
  - 頁首 Groq 金鑰卡刪除；首次啟動歡迎提示改顯示在轉錄卡頂部；「轉錄語言」自應用程式卡搬入轉錄卡並加「廣東話」。
- 用量統計加 Scribe 費率；字典送 `keyterms` 時在設定頁註明 +20% 費用。
- 依專案規則：UI 動工前先在 `design.pen` 完成設計稿。

### 測試
- registry fallback、store 跨驗證、Rust 表單組裝與回應解析單元測試。

## 不做
- 後端 trait 抽象（兩家就抽是過度設計）；前端直接打 HTTP（重試／上限要重做）。
- 用 `logprob` 或 `language_probability` 湊替代的無語音機率。
- 設計 B（金鑰集中卡），金鑰家數再增加時再議。

## 動工前要驗（不當事實用）
1. Groq 是否接受粵語代碼 `yue`（送一段粵語實測）。
2. ElevenLabs 零留存是否限特定方案；被拒時開關要顯示原因、不靜默失敗。
3. Scribe 對純靜音回什麼（決定幻覺偵測第 2a 層行為）。
4. 費率 $0.22 與 $0.40 哪個適用 API 直呼。

## 閘門
codex 計劃閘（唯讀、附消融審查）→ 實作 → codex 實作閘 → 列檔案等 commit 授權。
