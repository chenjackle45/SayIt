# 計畫：字典手動詞優先送出（#84，跨平台）（v0.14.2）

> 建立：2026-10-10 · 狀態：**計劃閘 GO（附條件，2 MED＋4 LOW 全收，見文末）**（雲端 session，codex 不可用；使用者指定由獨立 Claude 子代理唯讀審查）
> 來源：#84（ian90041，2026-09-24；10/1 回覆字典 137 個詞：AI 101、手動 26）。拍板：2026-10-10 決策頁「#84 修法排進 v0.14.2」。

## 要解決什麼

| | 已查證的事實（讀碼） | 推論（待驗） |
|---|---|---|
| 使用者看到的 | 字典加了「未來誌」，三筆短句仍辨識成「未來志」「未來制」「未來的字」（皆有 AI 整理）；截圖中該詞權重 2 | — |
| 名額 | 語音辨識與 AI 整理都只用 `getTopTermListByWeight(50)` 的結果（`useVoiceFlowStore.ts` 四處、`useHistoryStore.ts` 重試兩處），後端與 `enhancer.ts` 另各有 50 的截斷 | 137 個詞約 87 個每次都不會送出 |
| 排序 | `ORDER BY weight DESC, created_at DESC`；`source` 不參與排序 | 回報者的「未來誌」在 50 名外（無法驗證，資料在他機器上） |
| 權重 | 新增詞權重 1；詞**出現在最終貼上文字**時 +1（`updateVocabularyWeightsAfterPaste`），AI 糾錯分析提到已存在的詞時也 +1（`useVoiceFlowStore.ts` 約 693–703 行） | 一直被聽錯的詞很難累積權重，形成「排不進 → 聽錯 → 升不了」的循環；AI 自動學到的詞多且持續新增，同權重時 `created_at DESC` 讓新詞排更前 |

## 方案

`getTopTermListByWeight` 的排序改為**手動詞先、AI 詞後**，同類內維持原排序：

```sql
SELECT term FROM vocabulary
ORDER BY CASE WHEN source = 'manual' THEN 0 ELSE 1 END, weight DESC, created_at DESC
LIMIT $1
```

- **Whisper 提示改成優先度高的詞放在尾端**：OpenAI 文件寫明 Whisper 的 prompt 只看**最後 224 個 token**、前段捨棄。50 個中文詞加分隔與前綴很可能超過，現況其實是權重最高的詞先被截掉；手動詞排最前會讓它們最先被截。做法：`format_whisper_prompt` 取前 50 個後**反轉順序**（輸入仍是「優先度由高到低」的同一份清單，只有 Whisper 這條路反轉），LLM 提示維持優先度高的在前。Groq 是否與 OpenAI 同樣保留尾端未經文件或實測證實；反轉在「保留尾端」時明顯較好，在「保留前端或全收」時不比現況差太多（只影響被截的是哪些詞），故採用
- 名額 50 不變（不動 Whisper 提示長度與 LLM 提示長度，避免新的辨識副作用）
- 手動詞超過 50 個時，手動詞之間仍照權重取前 50，AI 詞全部讓位
- 字典頁的顯示排序（`fetchTermList`）、匯出排序、權重 +1 規則都不動
- 舊資料：v3 migration 把當時既有詞的 `source` 預設成 `'manual'`，這些舊詞也會被當成手動詞優先。計劃閘核對：v3 migration、AI 自動加詞（`vocabularyAnalyzer.ts`、`addAiSuggestedTerm`）是同一個 commit `bfd70f1` 加入，v3 之前沒有自動加詞路徑，推定成立

## 不做

- 不調高 50 的名額、不做語言或內容相關的挑詞
- 不改權重 +1 規則（例如「被聽錯也算」）——需要判斷「哪個詞本該出現」，複雜度高
- 不加 `source` 索引：字典規模在數百筆內，排序成本可忽略

## 改動檔案

- `src/stores/useVocabularyStore.ts`：`getTopTermListByWeight` 的 SQL 抽成匯出常數，排序改為手動優先
- `src-tauri/src/plugins/transcription.rs`：`format_whisper_prompt` 取前 50 後反轉；既有 `basic`、`exceeds_max`（100 個輸入）兩個測試的期望值改成反轉後的順序，`exceeds_max` 即涵蓋「只取前 50 個並反轉」
- `tests/unit/use-vocabulary-store.test.ts`：既有測試名稱與 SQL 斷言更新
- 新增 `tests/unit/vocabulary-priority-sql.test.ts`（含驗收 2 的兩個情境＋同權重新舊順序）：用 `node:sqlite` 記憶體資料庫直接跑該 SQL 常數（驗收 2 轉成正式回歸測試）
- `docs/community-commitments.md`：#84 列（已更新）；`CHANGELOG.md` 於發版時寫「手動加的詞（含匯入的詞）優先送出」

## 驗收

| # | 內容 | 方式 |
|---|---|---|
| 1 | store 送出的 SQL 就是匯出的常數；`LIMIT $1` 與參數不變 | 單元測試（mock DB） |
| 2 | 以 `node:sqlite` 記憶體資料庫跑該常數：60 個 AI 詞權重 5＋1 個手動詞權重 1，取 50 → 手動詞在第 1 位；60 個手動詞＋10 個高權重 AI 詞 → 只回手動詞且權重遞減；同類內同權重較新的在前 | 單元測試（真 SQLite） |
| 3 | 消融：①拿掉 `CASE`、②把 0／1 對調，驗收 2 都要變紅 | 單元測試 |
| 3b | Whisper：輸入 [A,B,C] → `Important Vocabulary: C, B, A`；100 個輸入 → 只含前 50 個、且最後一個是第 1 個輸入；消融：拿掉反轉要變紅 | Rust 單元測試 |
| 4 | `pnpm test`、`npx vue-tsc --noEmit` 全綠 | 本地 |

### 驗收 2 預跑（2026-10-10，Python sqlite3 記憶體庫，動工前先驗 SQL 本身）

| 情境 | 舊排序 | 新排序 |
|---|---|---|
| 60 個 AI 詞權重 5＋手動「未來誌」權重 1，取 50 | 「未來誌」不在結果內 | 「未來誌」排第 1，共 50 筆 |
| 60 個手動詞（權重 0–6）＋10 個 AI 詞權重 99，取 50 | — | 50 筆全為手動詞，權重遞減 |

## 風險

- **匯入的詞算手動**：純文字／CSV 匯入一律存成 `manual`，JSON 匯入 `source` 缺漏或無效也當 `manual`（`vocabularyTransfer.ts`）。一次匯入大量詞時會整批擠掉 AI 詞；手動詞超過 50 個時 AI 詞完全送不出去。不改程式，CHANGELOG 寫明

- 手動詞很多、其中有不常用的詞時，會擠掉常被用到的 AI 詞。回報者手動 26 個，在名額內；屬可接受取捨，CHANGELOG 寫明「手動加的詞優先」讓使用者知道怎麼控制

## 計劃閘（2026-10-10，獨立 Claude 子代理唯讀審查）

結論 **GO（附條件）**。查證：改這一條 SQL 涵蓋全部六個送出點（VoiceFlow 四處、History 兩處），編輯模式與字典學習不另取字典；後端與 `enhancer.ts` 只截斷不排序。

| 嚴重度 | 問題 | 處置 |
|---|---|---|
| MED | Whisper prompt 只看尾端 224 token，手動詞排最前反而最先被截 | 收：Whisper 提示反轉順序（方案、驗收 3b） |
| MED | 驗收只比對 SQL 文字，0／1 寫反也會綠；驗收 2 是一次性腳本 | 收：改成 `node:sqlite` 真 SQLite 單元測試，消融兩種變體 |
| LOW | 權重 +1 敘述漏了 AI 糾錯分析 | 收：已改敘述 |
| LOW | 匯入的詞算手動，大量匯入會擠掉 AI 詞 | 收：寫進風險、CHANGELOG 說明 |
| LOW | 文件追蹤（承諾表、回覆）沒列 | 收：列進改動檔案；回覆已於 10/10 經使用者過目後發出 |
| LOW | 既有測試名稱與斷言會變紅 | 收：一併更新 |

## 實作閘（2026-10-10，獨立 Claude 子代理唯讀審查）

結論 **可提交（0 HIGH／0 MED）**。`pnpm test` 41 檔 620 條全過、`vue-tsc`／`eslint` 通過；抽出的 Rust 片段 `clippy-driver -D warnings` 無警告。完整 `cargo test`／`clippy` 因容器缺 GTK 無法跑，交給 CI。

| 消融變體 | 變紅的測試 |
|---|---|
| 拿掉 CASE／0、1 對調 | 手動詞在前、只回手動詞 |
| 拿掉或反轉 `created_at DESC` | 同權重新的在前 |
| 拿掉或反轉 `weight DESC` | 只回手動詞（權重遞減） |
| Rust 拿掉 `.rev()`／先 rev 再 take | basic、exceeds_max／exceeds_max |

| 嚴重度 | 問題 | 處置 |
|---|---|---|
| LOW | 計畫寫「新增測試、改三個測試、60 個輸入」與實作不符 | 收：改計畫文字 |
| LOW | 新舊順序測試只有兩筆，消融靠 SQLite 回傳插入順序 | 收：改成三筆、最新的插在中間 |
| LOW | 測試建表語句手抄 | 收：註解寫明對應 `database.ts` v3 欄位 |
| LOW | `node:sqlite` 會印 ExperimentalWarning | 不處理：不影響結束碼 |
