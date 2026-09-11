# 計畫：轉錄語言加「廣東話」（#74）

> 建立：2026-09-11 · 狀態：codex 計劃閘一輪（1 HIGH、8 MED、1 LOW；HIGH 以補探針消解、其餘全收）＋實作閘一輪（0 HIGH、2 MED、1 LOW，全收）→ **已交付 v0.13.0（2026-09-11 公開；f2eab44）** · 排程：v0.13 第三張（**與 ElevenLabs 脫鉤**，在 Groq 上就能做；ElevenLabs 進來時只需在服務對照表多一行 `yue`）

## 探針結果（2026-09-11，真金鑰、Groq 正式端點）

### 轉錄：Groq `whisper-large-v3` 吃 `yue`

樣本：macOS `say -v Sinji` 產的粵語句「今日我哋去茶餐廳食嘢，你想飲奶茶定係鴛鴦？聽日仲要返工，唔好玩到咁夜。」，16 kHz 單聲道 WAV，與 app 送出的格式相同。

| `language` | HTTP | 回報語言 | 輸出 |
|---|---|---|---|
| `yue` | 200 | Yue Chinese | 今日我**哋**去茶餐廳食嘢，你想飲奶茶定係鴛鴦，明日仲要返工，唔好玩到咁夜。 |
| `zh` | 200 | Chinese | 今日我**地**去茶餐廳食嘢，…（同上） |
| 不帶（自動） | 200 | Chinese | 同 `zh` |

本樣本觀察（各 1 次）：`yue` 被接受、回傳語言標籤正確，粵語用字更準（「哋」對，「地」錯）。輸出是繁體，照 zh-TW 慣例套簡→繁轉換（粵語專用字不在轉換表）。「聽日」三次都成「明日」，三種語言碼一致，較可能是 TTS 發音而非語言碼造成，未另驗。

### AI 整理：問題出在 prompt，不在轉錄

輸入同一段粵語逐字稿（含「呢個 project 嘅 deadline 係下星期三」），用 app 實際的 Groq 參數（qwen `reasoning_effort: none`、gpt-oss `include_reasoning: false`）：

| 模型 | 模式 | 現行 zh-TW prompt | 加一句粵語指示後 |
|---|---|---|---|
| qwen3.6-27b（預設） | 精簡 | ❌ 改成普通話：「我們去茶餐廳吃飯…還是鴛鴦…聽**天**還要返工…我們現在是不是…的 deadline 是」 | ✅ 逐字保留 |
| qwen3.6-27b | 積極 | ✅ 保留（只加標點） | ✅ 保留（分段） |
| gpt-oss-120b | 精簡 | ⚠️ 大致保留，「嘅」→「的」 | ✅ 逐字保留 |
| gpt-oss-120b | 積極 | ✅ 保留 | ✅ 保留 |

加的那句（取代 prompt 末尾的「繁體中文 zh-TW。」）：
「繁體中文。輸入是廣東話口語，保留粵語用字與句式（我哋、嘅、唔、係、喺、咗、嘢、點解等），不要改寫成書面語或普通話說法。」

本樣本觀察（各 1 次）：預設模型＋精簡模式那格會改寫成普通話，與 #74 描述相符（回報者實際設定未知）。把指示放進內建 prompt 的語言句，四種組合都保留。

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 編輯模式取 prompt 只看介面語言（`useVoiceFlowStore` 約 1557 行），新增的 yue 編輯 prompt 永遠選不到，型別檢查抓不到 | **以補探針消解**：編輯模式用現行 zh-TW prompt 對粵語文字「幫我加標點」逐字保留、「翻譯成英文」正常翻譯（qwen，各 1 次）。既然現行 prompt 已保留粵語，**不加 yue 編輯 prompt、也不改編輯模式接線**（消融：拿掉它沒有驗收會壞）。驗收 4 改為用現行 prompt 實測 |
| MED | 編輯版不能無條件禁改書面語，會和「翻譯成英文」衝突 | 隨上條一起不做 |
| MED | 三款 prompt 沒有共同的末尾語言句可替換 | 收：精簡版換末句「繁體中文 zh-TW。」；積極版改第 4 行「直接輸出處理後的文字，使用繁體中文」；兩款各自測 |
| MED | `isKnownDefaultPrompt` 本來就不掃 edit，「自動涵蓋三款」不成立 | 收：測試只要求認得 yue 的精簡／積極；不加 legacy yue |
| LOW | 「自動偵測」其實走 i18n key，其他語言用母語名 | 收：「廣東話」用母語名寫死，與五種語言同款，不加 key |
| MED | 簡繁「無害」講太滿：OpenCC cn→tw 會把 `裏→裡`、`着→著`（香港常用字形） | 收：承諾收窄為「輸出繁體、粵語專用字不動」；加一條不 mock 的 OpenCC 回歸測試（粵語句含 咁嘅哋啲唔係喺咗嘢 原樣） |
| MED | 測試清單不夠：既有測試固定六個選項；`PROMPT_MAP` 型別也要放寬 | 收：選項數改七；`PROMPT_MAP` 一併改 `PromptLocale`；補 settings store 的 yue 兩條（whisper code、預設 prompt）；歷史重試與跨視窗走既有透傳路徑、codex 逐點核對無 cast，不另加 |
| MED | Whisper 探針只測預設模型，app 也可選 `whisper-large-v3-turbo` | 收：已補測。turbo＋`yue` 回 200、語言標籤 Yue Chinese，但**本樣本輸出簡體且偏普通話**（「我们去茶餐厅…还要上班」）。不加模型限制；**只在 #74 回覆提醒用預設模型**，不改選項說明（實作閘 MED 後改拍：單樣本觀察、turbo 非預設，為此加五語系文案不划算） |
| MED | 探針記錄把單樣本觀察寫成原因判定 | 收：措辭改「本樣本觀察」，標註次數 |
| MED | 回報者若在自訂 prompt 模式，選廣東話後不會換 prompt | 收：不覆寫自訂內容；驗收與回覆明講「用內建精簡／積極模式」 |

codex 另確認：`getEffectivePromptLocale` 執行邏輯已透傳非 auto、只需改型別；即時轉換、歷史重新辨識／重新整理、跨視窗刷新都無 SupportedLocale cast；沒有「切 yue 讓舊 zh-TW 預設被判成自訂」的遷移機制；推薦「選項＋內建 prompt」方案、不加偵測／守衛／遷移。

### 補探針（2026-09-11，各 1 次）

| 項目 | 結果 |
|---|---|
| `whisper-large-v3-turbo` + `yue` | 200、Yue Chinese；輸出「今日我们去茶餐厅食夜,你想饮奶茶定是鸐鸯?明日还要上班…」——簡體、偏普通話。預設 large-v3 沒這問題 |
| 編輯模式 zh-TW prompt、「幫我加標點」 | 「今日我哋去茶餐廳食嘢。你想飲奶茶定係鴛鴦？聽日仲要返工，唔好玩到咁夜。」逐字保留 |
| 編輯模式 zh-TW prompt、「翻譯成英文」 | 正常英譯 |

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| MED | prompt 測試只比前綴／後綴，改壞積極版開頭或刪掉粵語句仍會綠 | 已改：以 zh-TW 原文替換指定語言句後做全文相等斷言（兩款） |
| MED | 計畫寫「選項說明提醒用預設模型」但沒落地 | 改拍：只在 #74 回覆提醒，不改選項說明；計畫已修正 |
| LOW | OpenCC 回歸句缺「嘅、啲、咗」 | 已補 |

codex 另確認：兩款 yue prompt 以 unified diff 比對只換語言句；`auto → yue → 查表` 分支順序正確；下拉自動出第七項；跨視窗原樣讀回 yue；`getEffectivePromptLocale` 四個呼叫點都在 store 內、yue 行為正確；OpenCC 回歸沒被 mock；無範圍外改動；每個改動塊追得回計畫。

## 要解決什麼

kennyhlk（#74）：用廣東話講、想要輸出廣東話文字，但 AI 整理會改成書面語；已對外承諾「轉錄語言選項加『廣東話』，輸出保留粵語用字、AI 整理不硬改書面語」。

## 方案

「廣東話」是**轉錄語言**的選項，不是介面語言。改動集中在語言設定與 prompt 兩處，Rust 不動。

| 檔案 | 改什麼 |
|---|---|
| `src/i18n/languageConfig.ts` | `TranscriptionLocale` 加 `"yue"`；`TRANSCRIPTION_LANGUAGE_OPTIONS` 在「自動偵測」與五個介面語言之後加 `{ locale: "yue", displayName: "廣東話", whisperCode: "yue" }`；`getWhisperCodeForTranscriptionLocale("yue")` 回 `"yue"` |
| `src/i18n/prompts.ts` | `MINIMAL_PROMPTS`／`ACTIVE_PROMPTS` 各加 `yue` 一筆：內容＝zh-TW 版，精簡版換末句、積極版改第 4 行的語言句；`PROMPT_MAP` 與 `getMinimalPromptForLocale`／`getPromptForModeAndLocale` 型別放寬成 `PromptLocale = SupportedLocale \| "yue"`；`isKnownDefaultPrompt` 掃同一批 map、自動認得 yue 兩款。**編輯模式 prompt 不加 yue 版**（見計劃閘 HIGH 處置） |
| `src/stores/useSettingsStore.ts` | `getEffectivePromptLocale()` 回傳型別改 `PromptLocale`（`"yue"` 直接透傳，不再收斂成 SupportedLocale）；其他呼叫點跟著型別走 |
| `src/lib/transcriptTextTransforms.ts` | 簡→繁轉換條件從 `=== "zh-TW"` 改為 `zh-TW` 或 `yue`（OpenCC cn→tw：粵語專用字不在轉換表、原樣；`裏`／`着` 會轉成台灣字形，屬已知取捨） |
| `useHistoryStore`／`useVoiceFlowStore` 的 effectiveLocale 解析 | 只要型別過就不動（`auto` 仍回退介面語言） |

### 不做

- 不加「粵語」介面語言（五語系不動、不新增 locale JSON）
- 不改 Rust `transcription.rs`（`language` 本來就是透傳字串）
- 不動自訂 prompt 模式：使用者自訂的內容照舊；他要粵語可自己抄內建那句（回覆時明講要用內建模式）
- 不加 yue 編輯模式 prompt：補探針顯示現行 prompt 已保留粵語且翻譯正常
- 不做「自動偵測到粵語就切」：Whisper 自動偵測回的是 Chinese，偵測不出粵語

### 三問

1. 生產者：#74 回報者，且探針在預設模型上 100% 重現。
2. 機制會 fire：`yue` 透傳到 Groq 已驗；prompt 語言句已驗四組合。
3. 不砍東西。

## 驗收

1. 設定「語音轉錄」卡的語言下拉多一項「廣東話」，存檔後跨視窗同步（沿用既有 `transcriptionLocale` 事件）
2. 選廣東話錄一句粵語：逐字稿保留粵語用字（哋、嘅、唔、係），簡體不出現
3. 內建精簡模式、預設模型 qwen：整理後仍是粵語（探針那格由 ❌ 變 ✅）；積極模式同。自訂 prompt 模式不在此列（不覆寫使用者內容）
4. 編輯模式（現行 prompt，不改）：選取一段粵語文字、說「幫我加標點」，結果仍是粵語；說「翻譯成英文」正常翻譯
5. 選回「繁體中文」或「自動」：行為與 v0.12.1 相同
6. `vue-tsc`、eslint、`pnpm test` 綠

## 測試

- `languageConfig`：選項清單含 `yue` 且 whisper code 為 `"yue"`；`auto` 仍回 null
- `prompts`：`getPromptForModeAndLocale("minimal"|"active","yue")` 都含「保留粵語用字」，精簡版不含「zh-TW」；`isKnownDefaultPrompt` 認得 yue 兩款
- `transcriptTextTransforms`：`yue` 也委派轉換（既有 mock 測試）；`simplifiedToTraditional` 加一條不 mock 的 OpenCC 回歸：粵語句「今日我哋去茶餐廳食嘢，你想飲奶茶定係鴛鴦，唔好玩到咁夜，佢哋喺邊度」原樣不變，簡體「我们」→「我們」
- `i18n-settings`：選項數 6 → 7、`yue` whisper code 為 `"yue"`
- settings store：存 `yue` 後 `getWhisperLanguageCode()` 回 `"yue"`、預設 prompt 換成 yue 版

## 對外

做好後回 #74：「v0.13 加了『廣東話』轉錄語言，選了之後逐字稿和 AI 整理（內建精簡／積極模式）都會保留粵語用字；轉錄模型請用預設的 whisper-large-v3，turbo 對粵語會偏普通話。請更新後試試」。不承諾日期。

## 閘門

小卡節流：計劃閘最多兩輪。實作閘重點：`PromptLocale` 放寬有沒有漏掉呼叫點、`auto` 回退路徑沒被改到、五語系檔零改動。
