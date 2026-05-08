---
title: 'gh-35 — 可選擇貼上後不要佔用剪貼簿'
type: 'feature'
created: '2026-05-08'
status: 'done'
baseline_commit: '5ebc4c0e9f68d6ec32959780b7c85cc7485410fc'
context:
  - '{project-root}/src-tauri/src/plugins/clipboard_paste.rs'
  - '{project-root}/src/stores/useSettingsStore.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** SayIt 自動貼上轉錄文字後，會覆蓋使用者原本的剪貼簿內容。常見工作流（先複製 prompt → 講話貼上 → 想再貼回原內容）會被破壞。對應 GitHub issue #35。

**Approach:** Settings 新增 toggle「將轉錄文字複製到剪貼簿」，預設開啟以保留現況。關閉時 `paste_text` 走「快照原剪貼簿 → 寫入轉錄 → 模擬 Cmd+V/Ctrl+V → 等 200ms → 還原快照」流程，沿用 `capture_selected_text_via_clipboard` 已驗證的 snapshot 模式。

## Boundaries & Constraints

**Always:**
- 預設值為 `true`（保留現況），舊使用者升級後行為不變
- 跨 macOS 與 Windows 一致實作
- 設定改動必須透過 `SETTINGS_UPDATED` event 跨視窗同步
- 還原延遲抽為 const，方便日後調整
- 還原失敗時記錄 log，不阻斷貼上流程

**Ask First:**
- 實測若 200ms 還原延遲不足
- Settings 文案最終定稿

**Never:**
- 不支援多型別剪貼簿（圖片／檔案／RTF）。原內容非文字時，OFF 模式保留轉錄文字、不做 best-effort 還原
- 不引入新的剪貼簿管理 crate，沿用 arboard
- 不改變 ON 模式現有行為，零回歸風險為硬指標

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default ON | `toggle=true`, 剪貼簿="原文字" | 貼上轉錄文字，剪貼簿停留為「轉錄文字」 | N/A |
| OFF + 文字剪貼簿 | `toggle=false`, 剪貼簿="原文字" | 貼上轉錄文字後，剪貼簿恢復為「原文字」 | 還原失敗：log warn，不阻斷 |
| OFF + 空剪貼簿 | `toggle=false`, 剪貼簿空 | 貼上轉錄文字後，剪貼簿留下轉錄文字（與非文字情境一致；2026-05-08 使用者拍板放寬） | N/A |
| OFF + 非文字剪貼簿 | `toggle=false`, 剪貼簿=圖片/檔案 | 貼上轉錄文字後，剪貼簿留下轉錄文字 | 不嘗試還原（已知 trade-off） |
| OFF + 貼上失敗 | `toggle=false`, CGEvent/SendInput 失敗 | 仍還原快照，再向前端拋錯 | 錯誤透過 ClipboardError 回傳 |

</frozen-after-approval>

## Code Map

- `src-tauri/src/plugins/clipboard_paste.rs` -- `paste_text` command 主流程；新增 `restore_clipboard: bool` 參數與 snapshot／還原邏輯，已有 `capture_selected_text_via_clipboard` 可參考
- `src/stores/useVoiceFlowStore.ts` -- 第 756 行 `invoke("paste_text", ...)` 為唯一前端呼叫點；需傳入新參數
- `src/stores/useSettingsStore.ts` -- 新增欄位 `copyTranscriptionToClipboard`（const + ref + load + save + refresh + return），對齊既有 `isMuteOnRecordingEnabled` 結構
- `src/views/SettingsView.vue` -- 在「應用程式」區段（與 `muteOnRecording` 同層）新增 Switch 與雙情境說明，模板參考第 1826 行
- `src/i18n/locales/{zh-TW,zh-CN,en,ja,ko}.json` -- 五語系新增 `settings.app.copyTranscriptionToClipboard.{label,descriptionOn,descriptionOff}` 三個 key

## Tasks & Acceptance

**Execution:**
- [x] `src-tauri/src/plugins/clipboard_paste.rs` -- 抽 `RESTORE_DELAY_MS: u64 = 200` const，並在 `paste_text` 新增 `restore_clipboard` 參數；OFF 路徑：讀原剪貼簿文字 → 寫入轉錄 → 觸發 paste → sleep `RESTORE_DELAY_MS` → 還原快照（失敗時 log 不 throw）-- 核心行為改變
- [x] `src-tauri/src/plugins/clipboard_paste.rs` -- 新增 unit test：(1) `restore_clipboard=false` 路徑下參數傳遞與 const 值 (2) ON 路徑無 snapshot 邏輯（行為不變）-- regression 保護
- [x] `src/stores/useSettingsStore.ts` -- 新增 `DEFAULT_COPY_TRANSCRIPTION_TO_CLIPBOARD = true` 與 `copyTranscriptionToClipboard` ref；補 `loadSettings` 讀取、`saveCopyTranscriptionToClipboard` 寫入 + emit `SETTINGS_UPDATED`、`refreshCrossWindowSettings` 同步、return 暴露 -- 設定持久化
- [x] `src/stores/useVoiceFlowStore.ts` -- 第 756 行 `invoke("paste_text", ...)` 改傳 `{ text, restoreClipboard: !settingsStore.copyTranscriptionToClipboard }` -- 接通 toggle
- [x] `src/views/SettingsView.vue` -- 在 `muteOnRecording` Switch 同區段新增 Switch（綁 `:model-value` + `@update:model-value` + Label `for`），雙情境說明用 `descriptionOn` / `descriptionOff` 條件渲染 -- UI 入口
- [x] `src/i18n/locales/zh-TW.json` -- 新增 `settings.app.copyTranscriptionToClipboard.{label,descriptionOn,descriptionOff}`，文案：label「將轉錄文字複製到剪貼簿」；descriptionOn「⋯⋯會留在剪貼簿，可再用 Cmd+V 重複貼出，但會覆蓋原本複製的內容。」；descriptionOff「⋯⋯剪貼簿維持原本內容，方便接續使用。」-- 主語系
- [x] `src/i18n/locales/{zh-CN,en,ja,ko}.json` -- 對應翻譯（與既有 muteOnRecording 風格一致）-- 其他語系

**Acceptance Criteria:**
- Given 全新安裝啟動，when 讀取 settings store，then `copyTranscriptionToClipboard === true`（保留現況）
- Given toggle = OFF 且剪貼簿是純文字，when 觸發完整錄音 → 自動貼上流程，then 貼上完成後剪貼簿仍為原文字（macOS + Windows 各驗）
- Given toggle = OFF 且剪貼簿為圖片或檔案，when 觸發貼上，then 貼上成功，剪貼簿停留為轉錄文字，圖片不會被「還原成空」（已知 trade-off）
- Given Settings UI 切換 toggle，when 在另一個視窗讀 store，then 透過 `SETTINGS_UPDATED` event 即時同步
- Given Settings UI，when 使用者看到 toggle，then 文案不出現工程術語（「還原 / 快照 / restore / snapshot」），用「保留 / 留在剪貼簿」描述行為

## Spec Change Log

### 2026-05-08 — Codex review 後使用者放寬 spec（frozen 區人類重新談判）

- **Trigger**：Codex `/codex:review` 指出 OFF + 空剪貼簿情境下，實作（保留轉錄文字）與 spec I/O Matrix（剪貼簿維持空）不一致
- **使用者決策**：選 B「把 spec 改寬鬆」— 因為使用者幾乎不會察覺空剪貼簿狀態，多寫 `clipboard.set_text("")` 來精確還原成本不值得
- **Spec 變更**：I/O Matrix 第 3 列「OFF + 空剪貼簿」期望從「剪貼簿維持空」改為「剪貼簿留下轉錄文字（與非文字情境一致）」。frozen 區依規則只有人類能改，使用者已明示授權
- **附帶處理**：`.claude/*.lock` 加入 `.gitignore`，確保 `scheduled_tasks.lock` 等 Claude Code 本機 runtime 檔不會被誤 commit
- **無程式碼改動**：實作早就走「None → 不還原」路徑，原本就是這個行為；本次只是讓 spec 對齊現況

### 2026-05-08 — Simplify pass（patch only，無 spec 變動）

- **Trigger**：`/simplify` 命令跑三方審查（reuse / quality / efficiency）
- **Patches applied**：
  1. **重用 `restore_clipboard` helper**：把 paste_text 內聯的 snapshot 還原 match block 改為呼叫既有 helper；同步把 helper 重新命名為 `restore_clipboard_text` 以避開與新增 `restore_clipboard: bool` 參數的 shadow 風險（兩個既有呼叫點同步更新）
  2. **刪除 `test_restore_delay_ms_locked_to_200`**：跟自身常數比對的儀式型測試，改由 `test_restore_delay_ms_within_sane_range` 50–1000ms 區間守門，留下實質意義且不阻擋未來微調
  3. **清掉 WHAT-style 編號註解**：`// 1) Snapshot...` 到 `// 6) 還原跑完...` 等只重述程式碼動作的註解全刪；保留含 WHY 的註解（如為何 capture error 而非 ?-propagate、為何即使 paste 失敗也要還原）
  4. **簡化 snapshot 三態註解**：原本三行解釋 (a)(b)(c)，改為一句「Err 涵蓋非文字內容／暫時鎖等情況，視為『無可還原』」；match arm 本身已是文件
- **Defers**（已記入 deferred-work.md）：第 5 條 boolean setting saver factory、第 6 條 `<SettingsToggleRow>` 元件、第 7 條反向布林命名 — 這三項屬於跨 setting / 跨元件的廣泛重構，超出 issue #35 範圍

### 2026-05-08 — Review iteration 1（patch only，無 spec 變動）

- **Trigger**：三方 review（blind hunter / edge case hunter / acceptance auditor）共找到 10 條發現
- **Patches applied**：
  1. **`clipboard_paste.rs` snapshot 路徑**：把 `clipboard.get_text().ok()` 改為 `match` 三態（Ok-non-empty / Ok-empty / Err），讓 logging 區分「空剪貼簿」與「讀取失敗」，未來 debug 報告直接看 log 就能定位
  2. **`clipboard_paste.rs` 測試**：新增 `test_restore_delay_ms_within_sane_range` 守門 50–1000ms 範圍；補註解說明為何完整行為測試走手動 + 前端 vitest 而非 Rust unit test
- **Defers** 移到 `deferred-work.md`：A 還原視窗併發、E set_text 早退、F 並發 paste_text、H clipboard handle 重用、J 既有 release println
- **Rejects**（合 spec、噪音）：B 圖片被覆蓋（spec I/O Matrix 已標 trade-off）、C 反向布林風格疑慮、G 還原失敗不通知（spec 明寫只 log）

## Verification

**Commands:**
- `cd src-tauri && cargo test --lib clipboard_paste` -- expected: 新增測試與既有測試全部通過
- `cd src-tauri && cargo clippy --all-targets -- -D warnings` -- expected: 零警告
- `pnpm test` -- expected: vitest 既有套件全綠
- `npx vue-tsc --noEmit` -- expected: 型別檢查零錯
- `pnpm tauri dev` -- expected: 手動驗證 ON/OFF 兩種模式各跑一次完整流程

**Manual checks:**
- macOS：複製一段文字 → 觸發 SayIt 講話 → 完成貼上 → 再 Cmd+V，OFF 應貼出原文字、ON 應貼出轉錄文字
- Windows（CI 或實機）：同上邏輯；焦點還原（`restore_target_window`）仍正常
- 切換 UI 語言到 zh-CN / en / ja / ko，確認 Switch 文案無 fallback 顯示英文 key

## Suggested Review Order

**剪貼簿核心流程（Rust）**

- 入口：`paste_text` 命令簽名加上 `restore_clipboard` 布林，貫穿後續六步驟邏輯
  [`clipboard_paste.rs:333`](../../src-tauri/src/plugins/clipboard_paste.rs#L333)

- 還原延遲常數：抽出 200ms 為 const，附 trade-off 註解（太短/太長的危害）
  [`clipboard_paste.rs:9`](../../src-tauri/src/plugins/clipboard_paste.rs#L9)

- Snapshot 三態：Ok-非空 / Ok-空 / Err，分別 log 不同訊息方便事後 debug
  [`clipboard_paste.rs:363`](../../src-tauri/src/plugins/clipboard_paste.rs#L363)

- 還原段：等 `RESTORE_DELAY_MS` 後 set_text(original)，失敗只 log 不阻斷貼上
  [`clipboard_paste.rs:436`](../../src-tauri/src/plugins/clipboard_paste.rs#L436)

**設定持久化（Pinia + tauri-plugin-store）**

- 預設值 `true` — 升級舊使用者行為不變的硬指標
  [`useSettingsStore.ts:74`](../../src/stores/useSettingsStore.ts#L74)

- save 函式 + `SETTINGS_UPDATED` event broadcast 給所有視窗
  [`useSettingsStore.ts:1193`](../../src/stores/useSettingsStore.ts#L1193)

- `SettingsKey` union 增加新成員，跨視窗事件型別安全
  [`events.ts:36`](../../src/types/events.ts#L36)

**觸發點：把 toggle 反向接到 IPC**

- 唯一前端呼叫點：`!isCopyTranscriptionToClipboardEnabled` → `restoreClipboard`
  [`useVoiceFlowStore.ts:759`](../../src/stores/useVoiceFlowStore.ts#L759)

**Settings UI**

- Switch + 雙情境動態說明（ON/OFF 切換顯示不同描述）
  [`SettingsView.vue:1876`](../../src/views/SettingsView.vue#L1876)

- Toggle handler：呼叫 store + 顯示 success/error feedback
  [`SettingsView.vue:660`](../../src/views/SettingsView.vue#L660)

**文案（i18n）**

- 主語系字串組（label / descriptionOn / descriptionOff / enabled / disabled）
  [`zh-TW.json:139`](../../src/i18n/locales/zh-TW.json#L139)

**守門（測試）**

- 200ms 鎖定測試 + 50–1000ms 區間 sanity check
  [`clipboard_paste.rs:561`](../../src-tauri/src/plugins/clipboard_paste.rs#L561)
