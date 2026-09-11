# 計畫：自訂鍵錄製失敗一鍵回報（#30 配套，v0.13.1）

> 建立：2026-09-11 · 狀態：codex 計劃閘一輪（0 HIGH、6 MED，全收）＋實作閘一輪（0 HIGH、3 MED、2 LOW，全收）→ 待 commit（macOS dev 驗收見實作紀錄）· 排程：v0.13.1（與 `docs/plan-windows-hotkey-recording-diagnostics.md` 同版出）
> 使用者 2026-09-11 拍板：走 GitHub 預填 issue（不走 Sentry）、先只做錄製入口（通用版排 v0.14）、v0.13.1 等這個做完再發。

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| MED | 白名單擋得掉逐字稿來源，但錄製期間的鍵碼、修飾鍵仍是可辨識的按鍵內容；不能宣稱「無可推回輸入的鍵序」 | 收：診斷文字與畫面說明明講「含錄製期間的按鍵代碼與快捷鍵設定，不含轉錄內容」；驗收改為檢查具體資料來源（完整前綴盤點見 codex 報告，全部為鍵碼／修飾鍵／階段／固定文字） |
| MED | URL 上限要以完整編碼後長度為準；固定 60 行沒有獨立需求（可刪） | 收：8000 定為應用自身預算，計算完整編碼 URL，逐行丟最舊重算；刪 60 行 |
| MED | 緩衝若巢狀在 `LOG_GATE` 內會拉長 hook 等待 | 收：緩衝用獨立 Mutex，在取 `LOG_GATE` 之前完成前綴比對與 push；快照只持緩衝鎖 |
| MED | 回報沒帶失敗種類；start-failed 與 rejected 沒有日誌 | 收：報告帶 `timeout`／`start-failed`／`rejected(reason)`；前端補這兩種日誌行 |
| MED | 驗收偏 macOS 成功路徑 | 收：加 Windows 打包版驗收清單（發版後由同事執行）；Rust 測試用真 `GatedLogger` 餵 webview 形狀的 record |
| MED | design.pen 豁免尚未成立 | 使用者 2026-09-11 本卡明確豁免，並進一步拍板**移除 design.pen 規定**（`ui.md`、CLAUDE.md、流程文件、開發指南同步改） |

codex 另確認：前端 console 轉送到 Rust 後訊息原樣在 `record.args()`（target 是 `webview:<location>`），白名單比訊息不比 target；`<a target=_blank>` 是 shell plugin 的 init 腳本攔截後呼叫 `open`，建議直接 `await open(url)`（views 可 import `@tauri-apps/plugin-shell`，不屬禁止的 lib）；`copy_to_clipboard` 不受貼上還原機制影響；不推薦讀記錄檔尾段。

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| MED | `buildDiagnosticsInput` 在 `await` 後才讀失敗狀態，期間重新錄製會清成 null 而炸 | 已改：await 前先把失敗種類、原因與設定存成區域變數 |
| MED | design.pen 規定在 UX 規範、元件盤點、docs/index 仍有強制條款 | 已改：三處標記「2026-09-11 已移除」 |
| MED | 計畫驗收沒落實 Windows 清單；改動表與實作有落差（issueTitle、hotkeyFeedback、時分秒、持鎖內收集） | 已改：補 Windows 打包版驗收六條、描述同步 |
| LOW | 每筆日誌都先 `to_string()` 再判白名單 | 已改：`args().as_str()` 命中時借用、否則才格式化 |
| LOW | 時間戳起點是第一筆白名單日誌，不是 app 啟動 | 已改註記 |

codex 另確認：push 在 `LOG_GATE` 之前、快照只持緩衝鎖、測試走真 `GatedLogger::log`；URL 迴圈最多「行數＋1」輪、中文與 `&/#/%` 往返正確；WebView2 的 Windows UA 不含 `Mac`；三個失敗入口都設值、重錄清除；Button 與語意色符合規則；五語系 key 一致；每個改動塊追得回計畫或 design.pen 拍板。

## 實作紀錄（2026-09-11）

- `logging.rs`：`HOTKEY_DIAG_BUFFER`（獨立 Mutex、200 行）、`push_hotkey_diagnostic`（在 `LOG_GATE` 之前）、`get_hotkey_recording_diagnostics`；時間戳用「app 啟動後毫秒」避免引 chrono；測試餵真 `GatedLogger`
- `lib.rs` 註冊；`.claude/rules/ipc.md` 加列
- `composables/useHotkeyDiagnostics.ts`：`buildHotkeyDiagnosticsText`、`buildGitHubIssueUrl`（完整編碼 URL 預算 8000、逐行丟最舊）、`issueTitleFor`、`summarizePlatform`；5 條測試
- 五語系 `settings.hotkey.report.{prompt,github,copy,copied,note}`
- 驗證：Rust 102 測試、clippy、vue-tsc、vitest 532 全綠

## 要解決什麼

診斷版要回報者「先開除錯記錄 → 重現 → 找到記錄檔 → 傳給我」，四步每步掉人；#30 從五月拖到現在只有兩位回報過內容。目標：錄製失敗後畫面直接出現「回報這個問題」，一鍵整理好診斷文字、開已填好的 GitHub 新 issue 頁；沒有 GitHub 帳號的人按「複製」貼 LINE。**除錯記錄不用開**。

## 三問

1. **生產者**：錄製逾時／失敗的使用者（四位已知）；每次失敗都會看到按鈕。
2. **會 fire 嗎**：按鈕只在錄製失敗後出現；診斷內容來自記憶體環狀緩衝，不依賴檔案日誌開關。
3. **砍什麼**：不砍；診斷日誌版（前一張卡）原樣保留，本卡只加「取出＋送出」。

## 方案（用類比：行車記錄器永遠錄最近幾分鐘，出事按一下保存）

```
Rust GatedLogger ──(訊息以 "[hotkey-listener]" 或 "[SettingsView] hotkey" 開頭)──► 環狀緩衝（200 行、記憶體）
                                                                                         │
錄製逾時／失敗 ──► 快捷鍵卡片出現「錄製沒反應？」＋ [回報到 GitHub] [複製診斷資訊]        │
                          │                                                              │
                          └─ invoke get_hotkey_recording_diagnostics() ◄─────────────────┘
                             組成文字：版本、平台、觸發鍵設定、日誌行
                             ├─ GitHub：<a target=_blank href="…/issues/new?title=…&body=…">（既有 shell:allow-open）
                             └─ 複製：invoke copy_to_clipboard（既有）
```

### 改動點

| 檔案 | 改什麼 |
|---|---|
| `src-tauri/src/plugins/logging.rs` | `HOTKEY_DIAG_BUFFER: Mutex<VecDeque<String>>`（上限 200、獨立鎖）；`GatedLogger::log` 在取 `LOG_GATE` **之前**：訊息以 `[hotkey-listener]` 或 `[SettingsView] hotkey` 開頭才 push（`+毫秒 LEVEL 訊息`，毫秒自第一筆白名單日誌起算），白名單約束的是資料來源（鍵碼、修飾鍵、階段、固定文字），不是內容消毒；新 command `get_hotkey_recording_diagnostics() -> Vec<String>` 回傳快照 |
| `src-tauri/src/lib.rs` | 註冊 command |
| `src/composables/useHotkeyDiagnostics.ts`（新） | 純函式 `buildHotkeyDiagnosticsText(input)`（含失敗種類）與 `buildGitHubIssueUrl(input)`：完整編碼後 URL 以 8000 字元為應用預算，超過就從最舊日誌行丟、重新編碼；複製版帶全部 |
| `src/views/SettingsView.vue` | 逾時、invoke 失敗、rejected 後記錄失敗種類並顯示回報列（成功或重新錄製時清掉）；start-failed 與 rejected 補 `[SettingsView] hotkey recording: …` 日誌；錄製按鈕下方加一列：說明文字＋兩顆 `Button`（`variant="outline" size="sm"`）＋隱私註記；「回報到 GitHub」用 `@tauri-apps/plugin-shell` 的 `open`；「複製」用既有 `copy_to_clipboard` 並用 `hotkeyFeedback` 回饋 |
| 五語系 | `settings.hotkey.report.prompt`／`github`／`copy`／`copied`／`note`（issue 標題由程式依平台組，不進語系檔） |
| `.claude/rules/ipc.md` | 加 command 一列 |

### 診斷文字格式（回報者看得到自己送什麼）

```
SayIt v0.13.1 · Windows (userAgent 摘要) · 介面 zh-TW
觸發鍵：自訂 · 模式：Toggle · 目前設定：右 Alt
--- 錄製日誌（最近 200 行，只含快捷鍵相關） ---
+203ms INFO [hotkey-listener] Recording mode started
+210ms INFO [SettingsView] hotkey recording: listeners ready
+10215ms INFO [SettingsView] hotkey recording: timeout fired
```

issue 標題固定：`自訂觸發鍵錄製沒反應（Windows）`／依平台；body 開頭一句請回報者補「按了哪顆鍵、有沒有先切到別的視窗」。

### 不做

- 不走 Sentry（使用者看不到內容、無法對話、且 Sentry 刻意不收逐字稿相關內容）
- 不做通用「回報問題」（v0.14）
- 不用 GitHub API 自動建 issue（要 token）
- 不把一般模式的鍵盤事件放進緩衝（前綴白名單只收錄製與 hook 階段日誌；一般模式下 `[hotkey-listener]` 只在雙擊／長按／鎖失敗時記，不含鍵值）
- 設計稿：只加一列說明＋兩顆既有樣式的 Button，與同卡「錄製」按鈕同語言；使用者已豁免並移除該規定，做完以 `pnpm tauri dev` 截圖驗收

## 驗收

1. macOS `pnpm tauri dev`：錄製後不按鍵等 10 秒 → 出現「錄製沒反應？」列；按「複製診斷資訊」→ 剪貼簿內容含版本、觸發鍵設定、`Recording mode started`、`listeners ready`、`timeout fired` 三行；按「回報到 GitHub」→ 瀏覽器開 issue 新頁、標題與內容已填
2. 錄製成功後該列消失
3. 緩衝內容不含任何轉錄文字：錄一段語音、再看診斷文字（只有 `[hotkey-listener]`／`[SettingsView] hotkey` 行）
4. 除錯記錄關閉時 1 仍成立（緩衝與檔案開關無關）
5. CI 三 job 綠
6. **Windows 打包版**（發版後由同事執行，除錯記錄關閉）：
   - 錄製後不按鍵等 10 秒 → 出現回報列；按「複製診斷資訊」→ 貼到記事本，含版本、`Windows`、觸發鍵設定、`Failure: timeout`、三行 `listeners ready`／`Recording mode started`／`timeout fired`
   - 按「回報到 GitHub」→ 預設瀏覽器開 issue 新頁、標題與內容已填；未登入時登入後內容仍在
   - 錄製時按 ESC → 回報列出現、`Failure: rejected (esc_reserved)`
   - 重新按「錄製」→ 回報列消失
   - 在 SayIt 視窗有焦點時直接按 K（原問題）→ 逾時後用回報列送出，issue 內容就是本卡要的診斷

## 測試

- Rust：緩衝 push 的前綴白名單（`[transcription] …` 不進、`[hotkey-listener] …` 進）、上限 200 淘汰最舊、快照不清空
- 前端：`buildHotkeyDiagnosticsText` 內容與行數截斷、`buildGitHubIssueUrl` 的 encode 與長度上限（超過 8000 字元時只留尾段）
- 既有 settings／i18n 測試不動；五語系 key 集合一致

## 閘門

小卡節流：計劃閘最多兩輪。實作閘重點：白名單收集在 `LOG_GATE` 之外、只持緩衝鎖；URL 長度；失敗路徑三處都會顯示按鈕、重新錄製清掉。
