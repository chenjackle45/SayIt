# Data Models

> SQLite Schema（tauri-plugin-sql · WAL mode）+ tauri-plugin-store 鍵值
> 掃描日期：2026-05-08 · 當前 schema_version：**8**

---

## 一、儲存分層

```
┌─────────────────────────────────────────────────────────┐
│                  Frontend Storage Layer                 │
│                                                         │
│  tauri-plugin-store                                     │
│  └── SettingsStore：API Key、provider、model、hotkey... │
│       （JSON KV，存放於 OS app data 目錄）              │
│                                                         │
│  tauri-plugin-sql (sqlite:app.db)                       │
│  ├── transcriptions      ← 轉錄歷史 + 統計              │
│  ├── api_usage           ← API 用量（whisper / chat / vocab） │
│  ├── vocabulary          ← 字典 + 智慧學習權重          │
│  └── schema_version      ← migration 控制              │
│                                                         │
│  WAL mode + busy_timeout 5000 + synchronous NORMAL     │
└─────────────────────────────────────────────────────────┘
```

**為什麼 API Key 不放 SQLite**？因為 SQLite DB 檔案是普通檔案系統檔，沒有額外加密；`tauri-plugin-store` 的 KV store 在某些平台（macOS Keychain integration）有更好的安全保護。**這是硬規則**。

---

## 二、SQLite Schema

### 2.1 `transcriptions`

每筆完成的轉錄都會插入一列。

| 欄位                          | 型別                | 約束                                       | 用途                                              |
| ----------------------------- | ------------------- | ------------------------------------------ | ------------------------------------------------- |
| `id`                          | TEXT                | PRIMARY KEY                                | 前端 `crypto.randomUUID()`                        |
| `timestamp`                   | INTEGER             | NOT NULL                                   | epoch ms                                          |
| `raw_text`                    | TEXT                | NOT NULL                                   | Whisper 原始輸出                                  |
| `processed_text`              | TEXT                | NULL                                       | LLM 整理後（NULL = 未啟用整理）                   |
| `recording_duration_ms`       | INTEGER             | NOT NULL                                   | 錄音長度                                          |
| `transcription_duration_ms`   | INTEGER             | NOT NULL                                   | Whisper 耗時                                      |
| `enhancement_duration_ms`     | INTEGER             | NULL                                       | LLM 整理耗時                                      |
| `char_count`                  | INTEGER             | NOT NULL                                   | `raw_text` 字元數（v6 修正後一致）                |
| `trigger_mode`                | TEXT                | CHECK IN ('hold', 'toggle')                | 觸發模式                                          |
| `was_enhanced`                | INTEGER             | DEFAULT 0                                  | 0/1 boolean                                       |
| `was_modified`                | INTEGER             | NULL                                       | quality monitor 結果（NULL=未測量）               |
| `created_at`                  | TEXT                | DEFAULT (datetime('now'))                  | ISO timestamp                                     |
| `audio_file_path`             | TEXT                | NULL                                       | 本機 .wav 路徑（v4+，可重新轉錄用）               |
| `status`                      | TEXT                | NOT NULL DEFAULT 'success'                 | success / error / partial（v4+）                  |
| `is_edit_mode`                | INTEGER             | NOT NULL DEFAULT 0                         | Edit Mode 旗標（v8+）                             |
| `edit_source_text`            | TEXT                | NULL                                       | Edit Mode 的來源文字（v8+）                       |

**Indexes**：
- `idx_transcriptions_timestamp` ON `timestamp DESC`
- `idx_transcriptions_created_at` ON `created_at`
- `idx_transcriptions_status` ON `status`（v4+）

### 2.2 `api_usage`

每筆轉錄 / 整理 / 字典分析都會記錄 API 用量。

| 欄位                          | 型別                | 約束                                                          |
| ----------------------------- | ------------------- | ------------------------------------------------------------- |
| `id`                          | TEXT                | PRIMARY KEY                                                   |
| `transcription_id`            | TEXT                | NOT NULL, FK→transcriptions(id)                               |
| `api_type`                    | TEXT                | CHECK IN ('whisper', 'chat', 'vocabulary_analysis')           |
| `model`                       | TEXT                | NOT NULL                                                      |
| `prompt_tokens`               | INTEGER             | NULL                                                          |
| `completion_tokens`           | INTEGER             | NULL                                                          |
| `total_tokens`                | INTEGER             | NULL                                                          |
| `prompt_time_ms`              | REAL                | NULL                                                          |
| `completion_time_ms`          | REAL                | NULL                                                          |
| `total_time_ms`               | REAL                | NULL                                                          |
| `audio_duration_ms`           | INTEGER             | NULL（whisper only）                                          |
| `estimated_cost_ceiling`      | REAL                | NULL                                                          |
| `created_at`                  | TEXT                | DEFAULT (datetime('now'))                                     |

**Index**：`idx_api_usage_transcription_id` ON `transcription_id`

⚠️ **已知 issue**：`addApiUsage(whisper/chat)` 偶發 `FOREIGN KEY constraint failed` (787)，可能是 `transcriptions` 與 `api_usage` 寫入 race。

### 2.3 `vocabulary`

| 欄位          | 型別     | 約束                                       |
| ------------- | -------- | ------------------------------------------ |
| `id`          | TEXT     | PRIMARY KEY                                |
| `term`        | TEXT     | NOT NULL UNIQUE                            |
| `created_at`  | TEXT     | DEFAULT (datetime('now'))                  |
| `weight`      | INTEGER  | NOT NULL DEFAULT 1（v3+，智慧學習權重）    |
| `source`      | TEXT     | NOT NULL DEFAULT 'manual'（v3+，'manual'/'auto'） |

**Index**：`idx_vocabulary_weight` ON `weight DESC`

### 2.4 `schema_version`

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);
```

只存最新版本一列；migration 用 `INSERT OR REPLACE` 更新。

---

## 三、Migration 鏈（v1 → v8）

| Version | 變更                                                                                                        | 檔案位置                          |
| ------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **v1**  | 建立 `transcriptions` + `vocabulary` + `schema_version`                                                     | `database.ts:113-156`             |
| **v2**  | 新增 `api_usage` 表                                                                                         | `database.ts:158-194`             |
| **v3**  | `vocabulary` 加 `weight` / `source`；`api_usage.api_type` CHECK 擴充 `vocabulary_analysis`（重建表）        | `database.ts:196-273`             |
| **v4**  | `transcriptions` 加 `audio_file_path` / `status`                                                            | `database.ts:275-310`             |
| **v5**  | 新增 `hallucination_terms` 表                                                                               | `database.ts:312-343`             |
| **v6**  | 重算 `char_count = LENGTH(raw_text)`（修正既有資料）                                                        | `database.ts:345-371`             |
| **v7**  | DROP `hallucination_terms`（改為純前端記憶體實作）                                                          | `database.ts:373-394`             |
| **v8**  | `transcriptions` 加 `is_edit_mode` / `edit_source_text`                                                     | `database.ts:396-420`             |

### 3.1 Migration 寫法準則

1. **DDL 在 transaction 外**：`tauri-plugin-sql` 驅動下，`ALTER TABLE ADD COLUMN` 在顯式 transaction 內對後續語句不可見 → 用 `addColumnIfNotExists()` helper（冪等）
2. **CHECK 修改要重建表**：SQLite 不支援 ALTER CONSTRAINT
3. **DROP TABLE 前先清殘留**：用 `DROP TABLE IF EXISTS xxx_new` 防上次失敗殘留
4. **transaction 包 schema_version 更新**：跟其他 DDL 一起 commit / rollback
5. **加新 migration 不要改舊 migration**：使用者已執行的 migration 不可變更

### 3.2 連線恢復邏輯（防失敗 migration 後永久壞）

`doInitializeDatabase` 在所有 migration 之後做「關鍵表驗證與恢復」（`database.ts:422-476`）：

- `vocabulary` column 恢復：無條件重跑 `addColumnIfNotExists` 補 `weight`/`source`（issue #27 — Windows 環境下 v3 推進但 column 未落地）
- `api_usage` 表恢復：若不存在但 `api_usage_new` 存在（上次 migration 沒 RENAME 成功），直接 RENAME；否則重建空表（資料遺失但 app 可用）

---

## 四、Frontend Store 結構（記憶體狀態）

不入庫、僅 runtime 存在：

### 4.1 `useVoiceFlowStore`（核心狀態機）

```
HudStatus = 'idle' | 'recording' | 'transcribing' | 'enhancing'
          | 'editing' | 'success' | 'error' | 'cancelled'

State：
  hudState: { status, message }
  recordingSession: { startedAt, audioBufferId? }
  currentTranscription?: TranscriptionRecord
  triggerMode: 'hold' | 'toggle'
  qualityMonitor: { isActive, transcriptionId }
  correctionMonitor: { isActive }
  editMode: { isActive, sourceText, fieldRef? }
  smartDictionary: { learnedTerms[] }
```

### 4.2 `useSettingsStore`

```
State：
  apiKey: string
  provider: 'groq' | 'gemini' | 'openai' | 'anthropic'
  llmModelId: LlmModelId
  whisperModelId: WhisperModelId
  hotkeyConfig: { triggerKey, triggerMode }
  audioInputDeviceName?: string
  language: 'auto' | 'zh-TW' | 'zh-CN' | 'en' | 'ja' | 'ko'
  enhancementEnabled: boolean
  enhancementThreshold: number
  audioMuteSystemDuringRecord: boolean
  recordingAutoCleanupEnabled: boolean
  recordingAutoCleanupDays: number
  customPromptList: PromptConfig[]
  promptModeId: string
  ... (約 30+ 個設定項)
```

> 全部設定變更會 emit `settings:updated` → 跨視窗同步。

### 4.3 `useHistoryStore`

```
State：
  transcriptions: TranscriptionRecord[]
  searchQuery: string
  filteredTranscriptions: computed
  paginationCursor?: number
```

### 4.4 `useVocabularyStore`

```
State：
  vocabulary: VocabularyEntry[]
```

---

## 五、型別命名慣例

| 後綴            | 用途                              | 範例                                  |
| --------------- | --------------------------------- | ------------------------------------- |
| `*Record`       | SQLite 一列                       | `TranscriptionRecord`、`VocabularyEntry` |
| `*Payload`      | Tauri Event payload               | `WaveformPayload`、`HotkeyEventPayload` |
| `*Config`       | 設定物件                          | `HotkeyConfig`、`PromptConfig`        |
| `*Entry`        | 字典 / 列表項                     | `VocabularyEntry`                     |
| `*Dto`          | Store 間傳遞                      | —                                     |
| `*Handle`       | 資源控制                          | `AudioAnalyserHandle`                 |

---

## 六、SQLite 映射規則（mapRowToRecord）

- 表名：複數 snake_case（`transcriptions`、`api_usage`）
- 欄位：snake_case（`raw_text`） → TS camelCase（`rawText`） via `mapRowToRecord()`
- Boolean：`INTEGER` → `row.was_enhanced === 1`
- Nullable boolean：`INTEGER | null` → `row.was_modified === null ? null : row.was_modified === 1`
- 主鍵：`TEXT` UUID（前端 `crypto.randomUUID()`）
- 參數語法：`$1, $2`（tauri-plugin-sql 風格，不是 `?`）

---

## 七、Recording File Storage

`save_recording_file(id)` Command 會將 cpal 緩衝寫成 WAV，路徑模式：

```
$APPDATA/recordings/<id>.wav
```

`tauri.conf.json` 的 `assetProtocol.scope` 開放 `$APPDATA/recordings/**`，前端可透過 `convertFileSrc()` 取得 `asset://localhost/...` URL 播放。

> ⚠️ **macOS production CSP 限制**：`media-src` 必須含 `http://asset.localhost`（已設定）。Dev mode 不受 CSP 影響，安全功能必須用 `pnpm tauri build --debug` 測試。

`cleanup_old_recordings(days)` 啟動時依設定（預設 30 天）刪除過期錄音。

---

## 八、Storage Locations（OS）

| 平台    | App data 路徑                                                    |
| ------- | ---------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.sayit.app/`                   |
| Windows | `%APPDATA%\com.sayit.app\`                                       |

子目錄：
- `app.db`（SQLite + WAL `app.db-wal` + shared memory `app.db-shm`）
- `recordings/<id>.wav`
- `store.json`（tauri-plugin-store）

---

## 九、Open Issues / Tech Debt

| 議題                                                                | 影響範圍                          |
| ------------------------------------------------------------------- | --------------------------------- |
| `addApiUsage` 偶發 FK 失敗（787）                                    | 統計資料不齊                      |
| 沒有資料備份 / 匯出功能                                              | 換機器 / 重灌會丟歷史             |
| `transcriptions.audio_file_path` 與實體檔案可能不一致（手動刪檔）    | HistoryView 播放 fallback         |
| Migration v6 用 `LENGTH(raw_text)` 計算字元數對非 ASCII 不精確       | 字數統計可能略偏                  |
