# 計畫：v0.17 卡 2：收件匣（新詞＋錯字配對）

> 建立：2026-11-28 · 狀態：計劃閘 R1 GO（0 HIGH、6 MED，已收進下方）→ 實作
> 依據：`docs/plan-ui-redesign-v2.md` C4（收件匣語意）與 v0.17 第 10 項；`docs/plan-vocab-prompt-optimization.md`（卡 1：配對表與「AI 只送 applied 配對」代決）；使用者 2026-11-27 Q2「配對進 v0.17 收件匣」。
> 前置：卡 1（未 commit，同一工作樹）。

## 要解決什麼
1. 使用者看不到 AI 自己學了哪些詞。學錯的詞（包括卡 1 已知殘留：只是新加的詞也可能被當成改正收進來）一直留在詞庫，只能到列表裡自己找出來刪。
2. 卡 1 學到的「聽錯 → 正確」配對一律存成 suggested，AI 只送 applied。沒有介面讓使用者確認，配對永遠不會生效，卡 1 的改法 2 就等於沒做。

## 角色／資料／流程／規則

| 面向 | 內容 |
|---|---|
| 角色 | 使用者（唯一）；AI 自動學習是寫入者 |
| 資料 | `vocabulary.is_reviewed`（新增，v10）；`vocabulary_replacements.status`（卡 1 已建，suggested／applied／dismissed） |
| 流程 | AI 學到新詞 → `is_reviewed=0`、詞**立即生效**（C4 代決，不改）→ 收件匣顯示 → 保留＝標已檢視／刪除＝刪詞（可復原） |
| 流程 | AI 學到配對 → `suggested`、**不生效** → 收件匣顯示「聽成 X → 改成 Y」→ 套用＝`applied`（之後送 AI）／不要＝`dismissed`（不再提示，同一配對再學到也不復活） |
| 規則 | 提示查詢不看 `is_reviewed`（C4）；配對只送 `applied`（卡 1） |

### 為什麼新詞立即生效、配對要確認才生效（刻意不對稱）
- 新詞只會讓 Whisper 和 AI 多認得一個詞，學錯的後果是提示裡多一個沒用的詞。
- 配對是「看到 X 就改成 Y」的硬規則，學錯就會把所有出現的 X 都改錯。卡 1 的實作閘連兩輪都找到會存錯配對的情況。

## 範圍

### A. 資料（migration v10，只追加，放在 v9 之後）
- `vocabulary` 加 `is_reviewed INTEGER NOT NULL DEFAULT 1`。既有資料預設為 1，升級後收件匣是空的，不會一次湧進全部舊詞。
- 寫入點逐一標明（`useVocabularyStore`）：
  - 手動新增：1
  - 改詞：1
  - AI 自動學習（`recordCorrections`、`addAiSuggestedTerm`）的**新增**：0
  - 既有詞再被學到（加次數）：不動 `is_reviewed`
  - 匯入 UPSERT 的新增、合併、略過三個分支：明寫 1
- 配對：`recordCorrections` 遇到已是 `dismissed` 的同一配對，只加 `hit_count`、狀態不變。這一條要先查卡 1 的實作現況；已經是這樣就只補測試。

### B. Store API（`useVocabularyStore`）
- `inboxTermList`（computed：`source='ai' && !isReviewed`）、`suggestedReplacementList`（含對應詞）、`inboxCount`（兩者合計，給側欄徽章用）
- `markTermReviewed(id)`、`removeTermWithUndo(id)`：回傳復原用的快照，包括主詞 8 欄（id、term、source、weight、created_at、is_reviewed、correction_count、last_corrected_at）與該詞全部配對列的 7 欄。`restoreTerm(snapshot)` 原樣回存，不呼叫 addTerm。
  - **快照一致（R1 F2）**：取快照與刪除要在同一個資料庫操作裡完成，才不會被中途完成的 HUD 學習插進來；不要用跨 execute 的 BEGIN/COMMIT。回存主詞與配對也放在同一個操作裡，失敗就不回報成功。
  - **同名衝突（R1 F1）**：若已經有同名詞（不分大小寫，例如刪除後又被學到、手動加回），保留現有資料、不覆蓋，並顯示「已有同名詞，未復原」。
- `applyReplacement(id)`、`dismissReplacement(id)`。mark、remove、restore、apply、dismiss 成功後，都刷新本地資料並 emit `vocabulary:changed`。
- **徽章資料（R1 F3）**：擴充既有的 `fetchTermList`，讓它把詞與 suggested 配對一起載入。MainApp 掛載時載入一次，讓 App 冷啟動停在記錄頁時也能顯示徽章；收到 `vocabulary:changed` 照舊刷新。不另建同步機制。
- **不再提示的範圍（R1 F5）**：同一詞條還在的期間，dismissed 的配對再學到也不復活（卡 1 已實作，只補測試）。詞被刪掉後重新學到，視為新詞。復原時照快照恢復原本的 suggested、applied 或 dismissed。

### C. 畫面（在現有詞庫頁加收件匣；整頁換版面另開卡 2b）
- **代決（R1 F6）**：本卡只在現有 DictionaryView 頂端加收件匣與側欄徽章。v2 原型的單表、來源篩選、頁首工具選單另開卡 2b，仍屬 v0.17。原因是縮小 #81 的回歸範圍。代價是 v0.17 第 10 項要等 2b 做完才算完成。要合回一張卡，就把 2b 的範圍併進本卡。
- 詞庫頁頂端放收件匣區塊，沒有待處理項目時收合：
  - 新詞列：顯示詞名＋「保留」「刪除」。刪除後出現 toast，附「復原」。
  - 配對列：「聽成『陶里』→ 改成『Tauri』」＋「套用」「不要」。
  - 清空時顯示文案：「收件匣清空了。AI 之後學到的新詞會馬上開始使用，也會出現在這裡讓你檢視。」
- 未檢視的詞本來就算在詞庫列表與總數裡。保留只消掉徽章；刪除會讓詞和總數一起減少；復原時兩者一起回來。
- 側欄「詞庫」旁顯示徽章，數字＝`inboxCount`。
- 保留現有詞庫功能：#81 搜尋、編輯、匯入匯出、手動新增、IME 組字時的 Enter 防護，行為不變。
- 五語系文案同步（`.claude/rules/i18n.md`）。

### D. 不做
- 不改「新詞立即生效」（C4 代決）。
- 不做批次全部保留／全部套用（最小版先觀察使用量）。
- 不在 HUD 顯示配對。
- 匯出不帶配對：卡 1 審查指出這是現行格式的邊界，改格式要另開卡。
- 收件匣「飛向主表」的動畫：prototype 有，最小版不做。

## 驗收
1. migration v10 的四種情境（新庫、v9 升級、缺欄恢復後升級、重跑）都有測試，另加「欄位已加、版本未寫入」的中斷恢復；既有詞升級後 `is_reviewed=1`。順序是 v9 之後才 v10，不能先寫入 version=10，否則 v9 的一次性回填會被跳過。
2. 每個寫入點都有測試對應 `is_reviewed` 的值，包括加權不動它、匯入略過的分支改為寫 1（原本「略過不寫 DB」的兩條測試要定向改寫）。只有 applied 的配對會在 `getAiTermList` 出現箭頭配對；suggested 與 dismissed 都不會（近似詞本身仍可能入選）。同一詞條的 dismissed 配對再學到也不復活。
   - migration 順序：v9 → v10，不得在 v9 之前寫入 version=10。另加「欄位已加、版本未寫入」的中斷恢復測試。
3. 刪除後復原，連同配對列完整回來，其他詞不受影響。
4. 元件測試：收件匣四態（空、只有新詞、只有配對、兩者都有），以及「保留詞之後配對仍在」；徽章數（含冷啟動停在記錄頁）；保留、刪除、復原（含同名衝突）、套用、不要；#81 的既有測試全綠。
5. 五語系 key 對齊（`jq -e`），320px 寬度的溢字檢查。
6. 實機驗收（Mac 開發版）：用測試資料庫複本學一個詞、一個配對，從收件匣處理，再錄一句確認配對生效。

## 改動檔案（預估）
`src/lib/database.ts`、`src/types/vocabulary.ts`、`src/stores/useVocabularyStore.ts`、`src/views/DictionaryView.vue`（＋新元件 `src/components/vocabulary/InboxSection.vue`）、側欄徽章所在元件、`src/i18n/locales/*.json`、對應 tests。

## 實機驗收結果（2026-11-28，Mac 開發版，測試身分 `com.sayit.app.hwtest`，未碰正式資料）
- ✅ 手動加詞（阿欽、Supabase）→ 錄「明天三點跟阿欽開會，不對，改成四點，資料存在 Supabase」→ 貼出「明天四點跟阿欽開會，資料存在 Supabase」（詞庫命中 2、改口只留最終版）。
- ✅ 在「備忘錄」把「陳太誠」改成「陳泰呈」→ AI 判為專有名詞 → HUD 顯示已學習 → 收件匣出現新詞＋配對「陳太誠 → 陳泰呈」。
- ✅ 套用配對、刪除新詞→復原、保留 → 數字遞減、收件匣清空，均如預期。
- ⚠️ 既有限制（非本卡引入，另開項目）：終端機（Claude Code／cmux）讀到的是畫面其他行、ChatGPT 讀不到輸入框 → 這兩類 App 裡改字不會學習。注音選字的 Enter 不是主因（Enter 後仍會重讀輸入框）。
- 未驗：「再錄一句確認配對生效」——配對已套用，但本次未再錄同句。
