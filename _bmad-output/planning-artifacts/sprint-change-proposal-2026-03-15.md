# Sprint Change Proposal — 使用者回饋體驗優化

**日期**：2026-03-15
**觸發來源**：真實使用者回饋（2026-03-14 群組對話）
**回報者**：康富淼、Leo Chen、子超
**變更範圍分類**：Moderate（需要多個 Story 修改/新增，跨 4 個 Epic）

---

## Section 1: 問題摘要

SayIt v0.7.3 的核心語音輸入流程在真實使用場景中暴露 5 個體驗缺口。這些問題的共同影響是降低使用者對工具的信任感，增加「崩潰重講」的心理負擔。

| # | 問題 | 回報者 | 類型 |
|---|------|--------|------|
| 1 | Whisper 幻覺詞直接貼入 | Jackle、康富淼 | 技術限制 |
| 2 | 講完話卻顯示「未偵測到語音」 | 康富淼 | 技術限制 |
| 3 | HUD 重試按鈕只開 Dashboard，沒有重送 | 康富淼 | 未完成需求 |
| 4 | 中英混講辨識品質差 | Leo Chen、康富淼 | 技術限制 |
| 5 | 不支援組合鍵觸發（modifier+key） | 康富淼 | 新需求 |

**證據**：
- 康富淼：「按下去講完會說沒有聲音，就要重新批趴重講一次，發生的時候會小崩潰」
- 康富淼：「壞掉的時候會有 replay icon 那個點了是不是沒有用」
- Leo Chen：「中英混著講會爆掉」
- 康富淼用 BetterTouchTool 自行映射按鍵繞過組合鍵限制
- 康富淼已推薦給公司研究員使用（產品市場契合信號強）

---

## Section 2: 影響分析

### Epic 影響

| Epic | 影響 | 相關問題 |
|------|------|---------|
| Epic 1: 跨平台語音輸入基礎 | 擴展組合鍵 | #5 |
| Epic 2: AI 文字智慧整理 | 幻覺偵測 + 中英混講 prompt | #1, #4 |
| Epic 3: 自訂詞彙字典 | 無影響 | — |
| Epic 4: 歷史記錄與 Dashboard | 錄音儲存 + 播放 + 失敗記錄 + 重送 | #2, #3 |
| Epic 5: 設定與生命週期 | 幻覺詞庫 UI + 錄音清理設定 | #1, #2 |

### 文件影響

| 文件 | 需要更新 |
|------|---------|
| PRD | FR6, FR26-28, FR30 修改；新增 FR37（錄音儲存播放）、FR38（幻覺偵測） |
| Architecture | SQLite Schema、IPC 契約表、hotkey_listener 段落、新增錄音檔管理段落 |
| UX/UI Spec | HUD error 態行為、SettingsView 新區塊、HistoryView 播放按鈕 |
| project-context.md | 新增幻覺偵測、錄音儲存、組合鍵段落 |
| CLAUDE.md | IPC 契約表更新 |
| database.ts | v4 migration |
| i18n 翻譯檔 | 5 個 locale JSON 新增翻譯鍵 |

### 技術影響

| 層面 | 影響 |
|------|------|
| SQLite Schema | 新增 `hallucination_terms` 表；`transcriptions` 新增 `audio_file_path TEXT`, `status TEXT` 欄位 |
| Rust Commands | `StopRecordingResult` 新增 `peakEnergyLevel`；新增錄音檔管理 Commands（清理、讀取） |
| 磁碟儲存 | 新增 `{APP_DATA}/recordings/` 目錄，每次錄音存 WAV（~32KB/秒） |
| 前端型別 | `CustomTriggerKey` 擴展 modifiers 陣列；新增幻覺偵測相關型別 |

---

## Section 3: 推薦方案

### 路徑選擇：直接調整（修改/新增 Story）

**理由**：
1. 所有變更都是增量式，不推翻任何現有架構
2. 每個問題的修改範圍明確，可分批交付
3. 風險可控，最大工作項也不觸及核心管線
4. 5 個問題互相獨立，可各自成為版本發布

### 各問題解決方案

#### 問題 1：三層幻覺偵測架構

```
 Layer 1: 語速異常偵測（物理定律級判斷）
   錄音時長 vs 文字量比例不合理 → 幻覺
   自動將幻覺文字加入幻覺詞庫

 Layer 2: noSpeechProbability 門檻
   Whisper 回傳的無語音機率 > 門檻 → 可疑

 Layer 3: 幻覺詞庫比對
   內建詞庫（多語言）+ 自動學習 + 使用者手動新增

 判定：任一層強判定 → 攔截
       兩層弱可疑 → 組合攔截
       單層弱可疑 → 放行
```

| 決策項 | 結論 |
|--------|------|
| 儲存位置 | SQLite 獨立 `hallucination_terms` 表（與 vocabulary 分開） |
| 自動加入確認 | HUD 通知「已學習幻覺詞：XXX」（類似字典學習音效） |
| 管理 UI | 獨立頁面「幻覺詞庫」（`/hallucinations`）+ 側邊欄導航項，與「自訂字典」平行 |
| 幻覺攔截行為 | 判定為幻覺 → 不貼上，HUD 顯示「未偵測到語音」 |
| 多語言處理 | 根據 selectedTranscriptionLocale 載入對應語言的內建幻覺詞庫 |

**影響範圍**：
- **新增**：`hallucination_terms` SQLite 表、幻覺偵測模組、`HallucinationView.vue`（獨立頁面）、`useHallucinationStore.ts`、router 新增 `/hallucinations` 路由、側邊欄新增導航項
- **修改**：`useVoiceFlowStore.ts`（轉錄結果判定流程）、`database.ts`（schema migration）、`NotchHud.vue`（學習通知）、`router.ts`、`MainApp.vue`（側邊欄導航）
- **Rust 端**：不需修改（錄音時長和 noSpeechProb 已有回傳）

#### 問題 2+3：錄音永久儲存 + 一鍵重送 + 歷史播放

**錄音檔儲存決策**：

| 決策項 | 結論 |
|--------|------|
| 格式 | WAV（16-bit mono 16kHz，Rust 端已編碼） |
| 位置 | Tauri App Data 目錄 `recordings/` 子目錄 |
| 命名 | `{transcription_id}.wav`（UUID 對應 transcriptions 表） |
| DB 關聯 | `transcriptions` 表新增 `audio_file_path TEXT` 欄位 |
| 失敗的錄音 | 也寫入 `transcriptions` 表，新增 `status TEXT`（`success` / `failed`） |
| 清理策略 | 設定頁面提供兩種：手動刪除所有 + 自動清理（預設 7 天，天數可由使用者設定） |

**重送機制**：

```
 Whisper 回傳空字串
       │
       ▼
 HUD 顯示 "辨識失敗" + 重送按鈕（一律顯示，不管是否確定有說話）
       │
  使用者點擊重送
       │
       ▼
 從磁碟讀取 WAV → 重新呼叫 transcribe_audio()
 HUD 切換為 "轉錄中..."（復用 transcribing 狀態）
       │
  ┌────┴────┐
  ▼         ▼
成功       再次失敗
正常貼上    "辨識失敗，請重新錄音"
流程       （不再提供重送按鈕）
```

| 決策項 | 結論 |
|--------|------|
| 重送按鈕顯示條件 | 一律顯示（所有 error 狀態） |
| 重送次數 | 限 1 次 |
| 重送 HUD 狀態 | 復用 `transcribing`（「轉錄中...」） |
| 重送失敗訊息 | 「辨識失敗，請重新錄音」 |

**「確定有說話」內部標記**：
- 判定標準：錄音 ≥ 1 秒 + peak energy ≥ 門檻
- 不影響 UI（重送按鈕一律顯示）
- `StopRecordingResult` 新增 `peakEnergyLevel: f32`，供未來分析使用

**歷史記錄播放**：

| 決策項 | 結論 |
|--------|------|
| 播放技術 | `convertFileSrc()` 轉換本地路徑 → HTML5 `<audio>` 串流播放 |
| UI 位置 | HistoryView 每筆記錄新增播放按鈕（▶） |
| 檔案不存在時 | 播放按鈕灰顯 disabled（使用者可能已手動清理） |

**影響範圍**：
- **新增**：`recordings/` 目錄管理、錄音檔清理 Rust Command、設定頁面清理 UI
- **修改（Rust）**：`audio_recorder.rs`（stop_recording 回傳 peakEnergyLevel + 寫入磁碟）、`transcription.rs`（重送時從磁碟讀取 WAV）
- **修改（前端）**：`useVoiceFlowStore.ts`（重送流程）、`NotchHud.vue` + `App.vue`（重送按鈕行為）、`HistoryView.vue`（播放按鈕）、`useHistoryStore.ts`（失敗記錄寫入）、`database.ts`（schema migration：audio_file_path + status 欄位）
- **修改（設定）**：`SettingsView.vue`（錄音檔清理設定）、`useSettingsStore.ts`（清理天數設定）

#### 問題 4：Whisper prompt 雙語提示 + AI 後處理修正

**B：Whisper prompt 加入雙語提示**
- 在 `format_whisper_prompt()` 中，除字典詞外，自動加入語言混合範例文字
- 根據 `selectedTranscriptionLocale` 動態調整：
  - `zh` → 注入中英混合範例（如「部署 deploy, 測試 test, main.py」）
  - `en` → 注入英中混合範例（如「deploy 部署, API endpoint」）
  - `auto` → 注入最廣泛的多語混合範例

**C：AI 整理 prompt 增加語言混淆修正**
- 在 enhancer system prompt 中加入：「修正語音辨識中明顯的語言混淆，例如英文術語被轉為中文諧音」
- 搭配字典詞上下文，LLM 可根據語意還原正確用詞

| 決策項 | 結論 |
|--------|------|
| 方案 | B + C 組合 |
| 架構改動 | 無（prompt engineering 為主） |
| 長期方向 | 等 Groq 上線支援 code-switching 的新模型 |

**影響範圍**：
- **修改（Rust）**：`transcription.rs` — `format_whisper_prompt()` 增加語言混合範例
- **修改（前端）**：`enhancer.ts` — system prompt 增加語言混淆修正指令
- **修改（前端）**：`prompts.ts` — 各語言預設 prompt 加入語言修正指令
- **修改（i18n）**：5 個 locale JSON 可能需要新增翻譯鍵

#### 問題 5：自訂模式擴展為組合鍵

**組合鍵定義**：`0~N 個 modifier + 1 個普通鍵`

| 使用者按 | 記錄結果 |
|----------|---------|
| `Space` | `{ modifiers: [], key: "Space" }` |
| `Ctrl+Space` | `{ modifiers: ["ctrl"], key: "Space" }` |
| `Cmd+Shift+V` | `{ modifiers: ["cmd", "shift"], key: "KeyV" }` |

**型別系統變更**：

```typescript
// 擴展後
export interface CustomTriggerKey {
  custom: {
    modifiers: Modifier[];  // ["ctrl", "shift", "cmd", "alt"]
    keycode: number;
  };
}
export type Modifier = "ctrl" | "shift" | "cmd" | "alt";
```

```rust
// Rust 端對應
pub struct CustomTriggerKey {
    pub modifiers: Vec<Modifier>,
    pub keycode: u16,
}
pub enum Modifier { Ctrl, Shift, Cmd, Alt }
```

**平台判定**：
- macOS：CGEventFlags 檢查 modifier 狀態 + keycode 匹配
- Windows：GetKeyState() 檢查 modifier 狀態 + VK code 匹配

**Hold/Toggle 模式**：
- Hold：modifier(s) + 普通鍵全部按住 → start，普通鍵放開 → stop
- Toggle：modifier(s) + 普通鍵按下 → toggle start/stop

| 決策項 | 結論 |
|--------|------|
| 組合鍵範圍 | 0~N 個 modifier + 1 個普通鍵 |
| 簡易模式 | 保留不動 |
| 向後相容 | 舊的 `Custom { keycode }` 解析為 `{ modifiers: [], keycode }` |

**影響範圍**：
- **修改（Rust）**：`hotkey_listener.rs`（組合鍵判定邏輯）
- **修改（前端型別）**：`src/types/settings.ts`（CustomTriggerKey 擴展）
- **修改（前端 UI）**：`SettingsView.vue`（錄製流程 + 組合鍵顯示）
- **修改（前端 Store）**：`useSettingsStore.ts`（序列化/反序列化 + 向後相容遷移）
- **修改（前端）**：`keycodeMap.ts`（可能需新增 modifier 映射輔助函式）

---

## Section 4: 詳細變更提案

### 新增 Story

#### Story 2.4: Whisper 幻覺偵測與自動學習

As a 使用者,
I want 系統自動偵測並攔截 Whisper 幻覺文字,
So that 沒講話或很短停頓時不會有亂碼被貼入編輯器。

**Acceptance Criteria:**

**Given** 轉錄結果回傳
**When** 錄音時長 < 1 秒且文字 > 10 字（語速異常）
**Then** 判定為幻覺，不貼上，HUD 顯示「未偵測到語音」
**And** 該文字自動加入 `hallucination_terms` 表
**And** HUD 短暫通知「已學習幻覺詞：{text}」

**Given** 轉錄結果回傳
**When** noSpeechProbability > 0.9 且文字命中幻覺詞庫
**Then** 判定為幻覺，不貼上

**Given** 轉錄結果回傳
**When** 兩層弱可疑指標同時成立（noSpeechProb > 0.7 且語速偏高）
**Then** 判定為幻覺，不貼上

**Given** 轉錄結果回傳
**When** 只有一層弱可疑
**Then** 放行，正常貼上

**Given** 轉錄語言設定為不同語言
**When** 幻覺偵測 Layer 3 載入內建詞庫
**Then** 根據 `selectedTranscriptionLocale` 載入對應語言的幻覺詞庫
**And** `zh` 載入中文幻覺詞（「謝謝收看」「字幕組」等）
**And** `en` 載入英文幻覺詞（「Thank you for watching」「Subscribe」等）
**And** `auto` 載入所有語言的幻覺詞庫

**Given** 幻覺詞庫頁面（HallucinationView.vue）
**When** 使用者從側邊欄開啟幻覺詞庫頁面
**Then** 顯示所有幻覺詞（內建 + 自動學習 + 手動新增）
**And** 使用者可手動新增/刪除幻覺詞

---

#### Story 4.4: 錄音永久儲存與歷史播放

As a 使用者,
I want 每次錄音檔案永久儲存，並可在歷史記錄中播放,
So that 我能回聽自己說了什麼，也能在辨識失敗時重送。

**Acceptance Criteria:**

**Given** 錄音結束
**When** `stop_recording()` 完成 WAV 編碼
**Then** WAV 檔案寫入 `{APP_DATA}/recordings/{transcription_id}.wav`
**And** `transcriptions` 表的 `audio_file_path` 欄位記錄檔案路徑

**Given** 轉錄失敗（Whisper 回傳空字串或幻覺攔截）
**When** 失敗流程觸發
**Then** 仍然寫入 `transcriptions` 表，`status` 為 `failed`
**And** 錄音檔案仍然保存

**Given** HistoryView 顯示歷史記錄
**When** 該記錄有對應的錄音檔案
**Then** 顯示播放按鈕（▶）
**And** 點擊後透過 `convertFileSrc()` + HTML5 `<audio>` 播放

**Given** HistoryView 顯示歷史記錄
**When** 錄音檔案已被清理不存在
**Then** 播放按鈕灰顯 disabled

**Given** 設定頁面
**When** 使用者查看錄音儲存設定
**Then** 顯示「刪除所有錄音檔」按鈕
**And** 顯示「自動清理」開關 + 天數設定（預設 7 天）

---

#### Story 4.5: 轉錄失敗一鍵重送

As a 使用者,
I want 轉錄失敗時可以一鍵重送錄音給 Whisper,
So that 我不需要崩潰重講。

**Acceptance Criteria:**

**Given** HUD 顯示 error 狀態
**When** 使用者點擊重送按鈕
**Then** 從磁碟讀取上一次錄音的 WAV 檔案
**And** HUD 切換為「轉錄中...」（復用 transcribing 狀態）
**And** 重新呼叫 `transcribe_audio()`

**Given** 重送成功
**When** Whisper 回傳有效文字
**Then** 進入正常的 AI 整理 → 貼上流程
**And** 更新 `transcriptions` 表的 `status` 為 `success`

**Given** 重送也失敗
**When** Whisper 再次回傳空字串
**Then** HUD 顯示「辨識失敗，請重新錄音」
**And** 不再提供重送按鈕

**Given** HUD error 狀態
**When** 重送按鈕顯示條件
**Then** 一律顯示（不區分是否確定有說話）

---

### 修改 Story

#### Story 1.2 擴展：組合鍵支援

**新增 AC：**

**Given** 自訂模式的按鍵錄製
**When** 使用者按住 modifier(s) + 按一個普通鍵
**Then** 系統記錄 `{ modifiers: [...], keycode }` 組合
**And** HUD 顯示組合鍵名稱（如「Ctrl + Space」）

**Given** 組合鍵已設定
**When** 使用者在任何應用程式按下相同組合
**Then** macOS 透過 CGEventFlags 驗證 modifier 狀態 + keycode 匹配
**And** Windows 透過 GetKeyState() 驗證 modifier 狀態 + VK code 匹配
**And** Hold/Toggle 模式正常運作

**Given** 舊版本使用者升級
**When** 載入舊的 `Custom { keycode }` 設定
**Then** 自動解析為 `{ modifiers: [], keycode }`（向後相容）

---

#### Story 2.2 擴展：中英混講 prompt 強化

**新增 AC：**

**Given** Whisper API 請求即將發送
**When** `format_whisper_prompt()` 組裝 prompt
**Then** 除字典詞外，根據 `selectedTranscriptionLocale` 加入語言混合範例
**And** `zh` → 注入中英混合範例（如「部署 deploy, 測試 test, main.py」）
**And** `en` → 注入英中混合範例（如「deploy 部署, API endpoint」）
**And** `auto` → 注入最廣泛的多語混合範例

**Given** AI 整理請求即將發送
**When** enhancer 組裝 system prompt
**Then** 包含「修正語音辨識中明顯的語言混淆」指令

---

## Section 5: 實作交接

### 變更範圍分類：Moderate

需要多個 Story 新增/修改，跨 4 個 Epic，但不需要根本性架構重建。

### 建議發版順序

```
 v0.8.0 ── 問題 2+3：錄音儲存 + 重送 + 歷史播放
            Story 4.4 + Story 4.5
            DB migration v4
            最高優先：直接解決「崩潰重講」核心痛點

 v0.9.0 ── 問題 1：幻覺偵測三層架構
            Story 2.4
            DB migration v5（hallucination_terms 表）

 v0.10.0 ─ 問題 5：組合鍵觸發
            Story 1.2 擴展

 隨時穿插 ─ 問題 4：中英混講 prompt
            Story 2.2 擴展（最小改動）
```

### 交接對象

| 角色 | 責任 |
|------|------|
| Dev（Jackle） | 所有 Story 實作 |
| PM（Jackle） | PRD 更新、版本規劃 |
| Design | design.pen 設計稿（SettingsView 新區塊、HistoryView 播放、組合鍵 UI） |

### 成功標準

- 康富淼反饋的「崩潰重講」場景消失（問題 2+3）
- Whisper 幻覺文字不再直接貼入（問題 1）
- 中英混講的辨識品質使用者體感改善（問題 4）
- 使用者可設定 modifier+key 組合觸發（問題 5）
