# 計畫：ElevenLabs 轉錄服務 ＋ 設定頁重排（v0.13）

> 建立：2026-09-10 · 狀態：**codex 計劃閘 NO-GO（2026-09-10 晚）—— 三項 HIGH 收斂後才動工** · 排程：**v0.14**（2026-09-11 改排：v0.13.0 先出已過閘的三張，設定頁兩卡骨架已在 243ee6b 交付、#74 廣東話已與本卡脫鉤）
> 拍板 demo（規格的一部分，與文字衝突時以 demo 為準）：`docs/demos/elevenlabs-settings/settings-redesign.html`（設計 A 互動版）、`docs/demos/elevenlabs-settings/elevenlabs-first-demo.html`（第一版，僅供脈絡）

## 已拍板

| 題 | 定案 |
|---|---|
| 版型 | **A 金鑰跟著服務走**：設定頁收成「語音轉錄」「文字整理」兩張對稱功能卡（服務 → 金鑰 → 模型），頁首獨立 Groq 金鑰卡拿掉 |
| 做不做 | 做，排 v0.13 |
| 預設服務 | Groq（現有使用者升級後零變動） |
| 隱私與標示 | **（2026-09-10 晚改拍）**「不在 ElevenLabs 保存錄音」預設**關**、開關旁註明「需 Enterprise 方案」；選服務那行的說明明講「一般方案下 ElevenLabs 會保存你的錄音與轉錄文字」；使用者手動開啟後若被拒絕，顯示原因、開關不自動彈回；ElevenLabs 選項標「付費」 |

## 計劃閘結果（2026-09-10，codex 唯讀審查；報告：`~/.claude/jobs/9e6a2854/tmp/codex-report-elevenlabs-plan.md`）

判定：方向可維持（Rust 固定兩家分支＋前端小型資料 registry），但整合面估得太薄。**動工前必補：**

| 等級 | 缺口 | 要補的事 |
|---|---|---|
| HIGH → 已收斂 | **零留存是 Enterprise 限定**（`enable_logging` 為 query 參數、預設 true） | 使用者改拍：預設關＋文案揭露＋被拒不自動彈回（見上表）。連線測試帶同一隱私設定。動工前用真金鑰送 1 秒靜音實測拒絕的錯誤碼與訊息，接進 `errorUtils` 錯誤轉譯。 |
| HIGH | nullable NSP 漏掉消費端 | `types/audio.ts` 型別、`useVoiceFlowStore` 兩處 `toFixed()` 日誌、三條偵測路徑一併改；驗收含 `null＋空文字`、`null＋正常文字`。 |
| HIGH | 服務選擇未覆蓋完整呼叫鏈 | 即時轉錄、HUD 重送、歷史重新辨識、跨視窗設定刷新都要看「目前選中 STT 的金鑰」，否則會把 Groq 金鑰打到 ElevenLabs。 |
| MED | keyterms 契約 | 官方 SDK 是重複送 `keyterms` 欄位（非 JSON 陣列）；詞條有長度、最多五詞、禁用字元限制，本機字典沒有——不合格詞條略過並提示，不改壞本機字典。費率官方口徑不一（+20% vs $0.05/hr），不寫死。 |
| MED | `tag_audio_events` 預設 true | 固定 false，否則笑聲等標記會被當成轉錄內容貼上。`no_verbatim` 維持 false。 |
| MED | 用量分帳 | 儀表板目前把 STT 一律當免費 Groq；以請求開始時的模型計費、歷史紀錄不套用當下服務；ElevenLabs 只顯示本機用量與估算，不做推測的剩餘額度條。「免費 12 分鐘」是 Scribe UI 表、非 API 額度。連線測試（1 秒）標示會計費。 |
| MED | 粵語不只是加選項 | 轉錄語言同時影響 LLM prompt 語系與簡繁轉換；Groq 收不收 `yue` **已查證（2026-09-11）：接受，回報 Yue Chinese、用字更準**——「廣東話」選項改為與 ElevenLabs 脫鉤、獨立成 `docs/plan-cantonese-option.md`；ElevenLabs 進來時服務對照表多一行 `yue` 即可，不需要「切回 Groq 改自動」的規則。 |
| MED 可刪 | 依服務放大檔案上限 | 沒有需求；維持共同 25 MB。 |
| 另 | 錯誤轉譯 | `errorUtils` 的 Groq 專用錯誤對應要補 ElevenLabs 的額度不足／權限不足。 |

上層判斷：不是「功能本身過度」，是整合估太薄。**建議動工前先用同一批中文／粵語短句實測 Scribe vs Whisper 的修正量與延遲**；若沒有實際優勢、也沒有備援需求，延後整個 provider 是合理候選，設定頁兩張卡重排可獨立先做。

## 要解決什麼

轉錄線目前只有 Groq 一家，網址／認證／表單／回應解析全寫死在後端；加 ElevenLabs Scribe v2 是替轉錄線第一次引入服務維度。順帶修設定頁的結構問題：Groq 金鑰被當成全站金鑰放在頁首，切換轉錄服務後仍留在眼前。

## 範圍（方案 A：最小分支）

### 後端（Rust，約 150 行）
- 轉錄服務枚舉 `groq | elevenlabs`；同一條請求函式依服務分支：網址、認證 header（Bearer vs `xi-api-key`）、表單欄位（`model`/`language`/`prompt` vs `model_id`/`language_code`/`keyterms[]`）、回應解析。
- ElevenLabs 回應無「無語音機率」→ 回傳 `None`，前端幻覺偵測第 2b 層對它跳過（不用其他欄位硬湊）。
- 檔案上限維持共同 25 MB（計劃閘：依服務放大無需求，刪）。
- 連線測試指令多帶服務參數，仍送 1 秒靜音。
- 重試包裝不動（與服務無關）。
- 零留存：開關開啟時 ElevenLabs 請求帶 query `enable_logging=false`（Enterprise 限定）；預設關、不帶參數。被拒時把原因回給前端，開關不自動彈回。

### 前端（TS/Vue，約 200 行 ＋ 五語系文案）
- 轉錄服務 registry（複製 LLM 那套）：`SttProviderId`、模型帶 `providerId`，清單依服務過濾；預設 Groq / Whisper Large V3。
- settings store：`selectedSttProviderId`、`elevenlabsApiKey`（只進 tauri-plugin-store）、`elevenlabsZeroRetention`（預設 **false**）、跨驗證（模型必須屬於選中的服務）。
- 設定頁重排（設計 A）：
  - 「語音轉錄」卡：服務單選（ElevenLabs 標付費）→ 對應金鑰欄（只顯示選中那家）→ 模型＋語言並排 → 測試連線 → ElevenLabs 時多「不在 ElevenLabs 保存錄音」開關（預設關、旁註「需 Enterprise 方案」）與服務說明「一般方案下 ElevenLabs 會保存你的錄音與轉錄文字」；卡角狀態徽章「已就緒／需要金鑰」。
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
1. ~~Groq 是否接受粵語代碼 `yue`~~ 已驗（2026-09-11，見 `docs/plan-cantonese-option.md` 探針段）。
2. ElevenLabs 零留存是否限特定方案；被拒時開關要顯示原因、不靜默失敗。
3. Scribe 對純靜音回什麼（決定幻覺偵測第 2a 層行為）。
4. 費率 $0.22 與 $0.40 哪個適用 API 直呼。

## 閘門
codex 計劃閘（唯讀、附消融審查）→ 實作 → codex 實作閘 → 列檔案等 commit 授權。
