# 計畫：字典搜尋＋編輯詞（#81，跨平台）（v0.15）

> 建立：2026-11-17 · 狀態：**計劃閘 R1 GO 附條件（0 HIGH、3 MED 全收，見文末）**
> 來源：#81（ian90041，2026-09-22）原話：AI 誤加詞時「需要在裡面找非常久」，並建議可以「編輯」詞彙。拍板：2026-11-17 盤點決策頁 Q4＝A「排進 v0.15：搜尋框＋編輯詞」。畫面示意見 `~/Documents/claude-html/2026-11/sayit-issue-triage-2026-11-16.html` Q4（現況／改後兩張樣張）。

## 要解決什麼

| | 已查證的事實（讀碼） |
|---|---|
| 找詞 | 字典頁一次載入全部詞（`fetchTermList`，無分頁），分「AI 推薦」「手動新增」兩張表，各自照權重排序；沒有任何篩選。回報者 137 個詞（AI 101） |
| 改詞 | 每列只有刪除鈕；要改錯字只能刪掉再手動新增——新詞權重回到 1、來源變成手動、新增時間重置 |
| 資料表 | `vocabulary(id TEXT PK, term TEXT NOT NULL UNIQUE, created_at, weight INTEGER DEFAULT 1, source TEXT DEFAULT 'manual')`；UNIQUE 大小寫敏感；store 的重複判定（`isDuplicateTerm`）是 trim＋小寫比對 |
| 跨視窗同步 | 寫入後送 `vocabulary:changed`；HUD 與主視窗的監聽都**不看 payload**，收到就重抓整份清單 |

## 方案

### 1. 搜尋（純前端）

- 頁首右側「新增」那組的左邊加一個搜尋框（shadcn `Input`，前置 lucide `Search` 圖示，佔位「搜尋詞彙…」）
- 比對：搜尋字串 trim 後小寫，詞條小寫後**包含**即符合；空字串＝不篩選
- 兩張表同時套用；某張表篩完為空時，該卡顯示「沒有符合的詞」（取代原本的空狀態文案，避免誤以為字典是空的）
- 比對函式寫成 store 模組匯出的純函式 `matchesTermQuery(term, query)`，view 用 computed 套用（views 不碰 lib、可單元測試）
- 搜尋字串只存在 view（離開頁面即清空），不進 store、不持久化

### 2. 編輯詞（行內）

- 每列刪除鈕左邊加鉛筆鈕（`Button variant="ghost" size="icon-sm"`、lucide `Pencil`）
- 按下後該列詞彙格變成 `Input`（自動聚焦、預填原詞），操作格換成「確認」「取消」兩個圖示鈕（`Check`／`X`）；Enter＝確認、Esc＝取消（**輸入法組字中不觸發**：判斷 `isComposing`，避免注音／倉頡選字時誤存或誤取消）；同一時間只能編輯一列（開另一列＝放棄前一列）
- 確認時呼叫 store 新增的 `updateTerm(id, newTerm)`：
  - trim 後為空 → 不送出、維持編輯狀態
  - 與原詞完全相同 → 直接結束編輯、不寫 DB
  - 與**其他**詞重複（trim＋小寫，排除自己）→ 丟 `dictionary.duplicateEntry`，維持編輯狀態並顯示錯誤；只改大小寫（「heptabase」→「Heptabase」）因排除自己而允許
  - `UPDATE vocabulary SET term = $1 WHERE id = $2`；DB 回 UNIQUE 錯誤同樣轉成重複訊息
  - 成功 → `fetchTermList()`、送既有的 `vocabulary:changed`（沿用 `emitVocabularyChanged()`，payload 消費端不讀）、回饋訊息「已將「{from}」改為「{to}」」
- **權重、來源、新增時間都保留不變**

> 代決：改 AI 詞時來源要不要變成「手動」／選了**保留原來源**／理由：改字是修正拼法，不代表使用者主動指定這個詞；且來源會影響 #84 的送出優先順序，改了會悄悄改變辨識行為／要改：在 `updateTerm` 的 UPDATE 多設 `source = 'manual'`，一行。

## 不做

- 不做分頁、排序切換、權重手動調整、批次刪除（回報者沒提）
- 不做模糊比對、注音／拼音比對
- 不在搜尋框打字時同時當「新增」輸入（兩個框分開，避免誤新增）
- 不新增事件種類或 payload 欄位（消費端不讀）

## 改動檔案

- `src/stores/useVocabularyStore.ts`：新增 `updateTerm`、匯出純函式 `matchesTermQuery`
- `src/views/DictionaryView.vue`：搜尋框、兩張表改吃篩選後清單、篩選空狀態、每列編輯模式
- `src/i18n/locales/{zh-TW,zh-CN,en,ja,ko}.json`：`dictionary.searchPlaceholder`、`noSearchResults`、`edit`、`save`、`cancel`、`updated`
- `tests/unit/use-vocabulary-store.test.ts`：`updateTerm`、`matchesTermQuery` 測試

## 驗收

| # | 內容 | 方式 |
|---|---|---|
| 1 | `matchesTermQuery`：大小寫不敏感包含；前後空白忽略；空字串全符合；中文子字串（「未來」符合「未來誌」）；**反例**：「未來」不符合「開會紀錄」、「xyz」不符合任何詞 | 單元測試 |
| 2 | `updateTerm` 成功：送出 `UPDATE vocabulary SET term = $1 WHERE id = $2`（參數為 trim 後新詞、id）、之後重抓清單並送 `vocabulary:changed` | 單元測試（mock DB） |
| 3 | `updateTerm` 不寫 DB 的三種：新詞為空、與原詞相同、與其他詞重複（拋 `dictionary.duplicateEntry`） | 單元測試 |
| 4 | 只改大小寫允許寫入（排除自己） | 單元測試 |
| 5 | DB 回 UNIQUE 錯誤 → 轉成重複訊息；其他錯誤原樣拋出 | 單元測試 |
| 6 | 消融：拿掉「排除自己」→ 驗收 4 紅；拿掉重複判定 → 驗收 3 第三種紅；拿掉相同詞短路 → 驗收 3 第二種紅 | 單元測試 |
| 7 | Mac 實機：137 筆規模的字典（用匯入造資料）搜尋即時、兩張表同步篩選、無結果文案、清空後恢復；行內編輯操作清單：鉛筆後自動聚焦、Esc 取消、編輯中點另一列鉛筆＝放棄前一列、重複錯誤後草稿保留、注音組字中按 Enter 不存檔；改詞後權重／來源／日期不變；**改「送出前 50 名」內的詞**，HUD 下一次辨識送出的是新詞（榜外詞本來就不送，不能拿來判同步）；五語系文案顯示正常；`pnpm tauri dev` 截圖對照決策頁 Q4 樣張 | 人工（開發版與正式版共用資料，**跑前先備份設定與資料庫**） |
| 8 | `pnpm test`、`npx vue-tsc --noEmit`、eslint 全綠 | 本地 |

## 計劃閘 R1（2026-11-17，codex gpt-6.1-sol xhigh 唯讀、審查暫存區）

判定 **GO 附條件、0 HIGH**。查證：UNIQUE 大小寫敏感（記憶體 SQLite 實驗）、事件消費端不讀 payload、歷史與匯出不依賴詞條 id。

| 等級 | 問題 | 處置 |
|---|---|---|
| MED | 搜尋驗收只有符合案例，永遠回 true 也會過 | 收：驗收 1 加反例；驗收 7 加兩表同步、無結果、清空恢復 |
| MED | 輸入法組字期間 Enter／Esc 未界定；UI 操作驗收不足 | 收：方案寫明 `isComposing` 不觸發；驗收 7 加最小操作清單 |
| MED | 「下次辨識送新詞」只對前 50 名成立 | 收：驗收 7 指定改榜內詞 |

接受的邊界（不在本卡處理）：AI 之後可能再學回舊拼法（無改名紀錄）；跨視窗同時寫入時大小寫變體可能並存（既有新增流程同風險）；錄音中改詞該次可能少加一次權重。
