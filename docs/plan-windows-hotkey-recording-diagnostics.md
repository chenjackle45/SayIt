# 計畫：Windows 自訂觸發鍵錄製 — 日誌診斷 ＋ 修飾鍵自追蹤（#30，v0.13.1）

> 建立：2026-09-11 · 狀態：codex 計劃閘一輪（1 HIGH、7 MED）→ **範圍收成 A（診斷）＋前端監聽順序修正，B 延後到有實機資料** ＋實作閘一輪（0 HIGH、2 MED、1 LOW，全收）→ **已交付 v0.13.1（2026-09-11 公開；f084463）**，等實機日誌 · 排程：v0.13.1（小版；插在 v0.14 ElevenLabs 之前）

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | B 把 `active_modifiers` 當實體按鍵狀態的唯一來源，但取消語音錄音、更新設定都會 `reset()` 清掉它：按住 Ctrl → 取消錄音 → 不放 Ctrl 再按 K，集合已空、Ctrl+K 不匹配。既有操作就會踩到 | **B 整段延後**：等 A 的日誌拿到實機鍵序再決定做法（自追蹤要和 reset 生命週期分開、左右鍵分開追蹤）。本版只做 A |
| MED | 左右 Ctrl 共用一個旗標，放開一邊就當全放開；macOS 版讀的是每個事件的完整 flags、不是累積差量 | 隨 B 延後；B 的計畫改寫時左右八鍵分開追蹤 |
| MED | A 的日誌不足以三分診斷；且**前端先 `invoke("start_hotkey_recording")` 才註冊 listener**，期間的 captured 事件會漏（Tauri 不補播）；captured 前的日誌不等於 emit 成功；錄製處理器另有四處 `try_lock` | 收：前端改成**先註冊 listener 再叫 Rust 開始**；前端加「listener 就緒／收到 captured／逾時」三行日誌；Rust 記 emit 失敗；所有 `try_lock` 失敗處各記一行（只記階段）；驗收加「立即按／保持焦點等一秒再按／切窗再按」三組 |
| MED | hook 內同步 `log::info!` 會等 `LOG_GATE` 鎖與檔案寫入，hook 逾時會被系統靜默移除 | 部分收：hook 路徑本來就有日誌（雙擊、長按），本版不新增類別；新增行數限制在錄製期間（最多每鍵兩行）與鎖失敗（罕見）。不做日誌外送執行緒（超出小版範圍），記為已知取捨 |
| MED | lock-busy 日誌帶 vk，一般模式也會記到按鍵；`FILE_LOG_ENABLED` 只擋檔案、stdout 不受控 | 收：鎖失敗只記階段不記鍵值；鍵值只在錄製中記 |
| MED | `GetKeyState` 在 hook 執行緒「永遠不更新」是推論不是查證事實；cruelforever 能錄組合鍵與此敘述衝突 | 收：計畫措辭降為推論；B 延後正是為了拿資料 |
| MED | 純函式測試不足以覆蓋 B；不 cfg 閘會有 macOS unused 警告 | 隨 B 延後 |
| MED／可刪 | 回傳 bool 與印 thread id 沒有驗收用途 | 刪 |

codex 另確認：焦點問題在程式碼與 Win32 規則裡找不到「自家前景就跳過 hook」的分支；Tauri 從 hook 執行緒派送到 UI 執行緒的分支看執行緒身分不看焦點；`GetAsyncKeyState` 不能直接替換（hook 早於當次鍵的非同步狀態更新）。

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| MED | listener 註冊是非同步的，期間取消或重開，舊請求仍會存 listener 並啟動 Rust 錄製 | 已改：請求序號＋`isRecording` 雙檢查，失效就只 unlisten 不啟動 |
| MED | 判讀表兩個結論寫太滿：`recording-check` 取鎖失敗時 hook 有收到但不印 `recording: vk`；三組成功也不等於證明監聽順序是唯一成因 | 已改判讀表 |
| LOW | 計畫寫經 store `writeInfoLog`，實作用既有 console 轉送；B 段仍是確定性口吻 | 已同步 |

codex 另確認：六處鎖失敗只記階段；鍵碼只在錄製路徑；日誌都在 guard 釋放後；format 型別成立（Windows 編譯仍待 CI）；invoke 失敗路徑清理完整；沒有偷做 B；每個改動塊追得回計畫。

## 要解決什麼

#30（2026-05 起、AmberCTW 與 cruelforever）、#70 串 2026-09-11 cruelforever 留言、以及 2026-09-11 使用者在同事的 Windows 11 實機：設定頁按「錄製」後，**SayIt 視窗有焦點時按任何鍵都沒反應**，10 秒後跳「未偵測到按鍵」；先點一下別的視窗再按才錄得到。v0.10 時只能錄單鍵，v0.12.1 已可錄兩鍵以上。

兩個獨立的事：

| | 現況 | 本卡做什麼 |
|---|---|---|
| A. 視窗有焦點就沒反應 | 讀完 `hotkey_listener.rs` Windows 路徑找不到分支能解釋；hook 執行緒收到什麼、`try_lock` 有沒有失敗、事件有沒有發出去，**一概沒有日誌** | 加日誌（只在除錯記錄開啟時寫），讓回報者傳 `sayit.log` 就能定位。**不猜修** |
| B. 修飾鍵狀態來源可疑（**推論，未經實機驗證；本版不做**） | `get_active_modifiers_windows()` 用 `GetKeyState`，文件說它反映呼叫執行緒取訊息時同步的狀態；hook 執行緒不取鍵盤訊息，因此**不能當可靠的當次快照**。但 cruelforever 在 v0.12.1 能錄組合鍵，「永遠不更新」並未證實。錄製時「只按 Ctrl」要靠 `all_released`、組合鍵要靠 accumulated modifiers、觸發時組合鍵放開判定也靠它 | hook 自己追蹤四類修飾鍵的按下／放開，存進既有的 `shared.active_modifiers`，三個讀取點改讀它；刪掉 `GetKeyState` 兩個函式 |

沒有 Windows 開發機（實機是同事的），A 只能靠發版帶日誌。B 是讀碼即可確認的缺陷，且是 v0.12.1 計劃閘 codex 留下的殘留風險（記號只隔離事件、`GetKeyState` 仍被注入汙染）。

## 三問

1. **生產者**：A 有四位使用者實測；B 的讀取點每次錄製與每次組合鍵按放都會跑。
2. **會 fire 嗎**：A 的日誌在 hook 入口與錄製處理器各一行，任何路徑都會留下痕跡（含 `try_lock` 失敗）；B 的追蹤在 hook 入口對每個修飾鍵事件更新，自家注入事件已在前一步被記號放行、不會汙染。
3. **砍什麼**：`get_active_modifiers_windows`／`is_vk_pressed` 整段刪除。

## 方案

### A. 診斷日誌＋前端監聽順序（本版）

| 位置 | 內容 |
|---|---|
| `hook_proc` 讀到 `is_recording == true` 時 | `[hotkey-listener] recording: vk=0x{:02X} down={}`（只在錄製中） |
| `hook_proc` 兩處 `try_lock` 失敗、`handle_recording_event_windows` 四處 `try_lock` 失敗 | `[hotkey-listener] shared lock busy at <stage>`，不記鍵值 |
| `handle_recording_event_windows` 發 captured／rejected | `[hotkey-listener] recording captured keycode=0x{:02X} mods={:?}`／`recording rejected reason=…` |
| `install()` 的 captured／rejected handler | emit 失敗時 `log::error!` |
| 前端 `SettingsView.startRecording` | **順序改為先註冊兩個 listener、再 `invoke("start_hotkey_recording")`**，並以請求序號防註冊期間取消；用既有的 console 轉送（`installConsoleForwarding` → plugin-log）記「listeners ready」「captured received keycode=…」「timeout fired」 |

不加節流：鍵值只在錄製中記，最多每鍵兩行；鎖失敗罕見。

### B. 修飾鍵自追蹤（**延後**，等 A 的實機日誌）

- （原設計，保留供下一版參考；計劃閘指出需與 reset 生命週期分開、左右八鍵分開追蹤）新增純函式：
  `fn apply_windows_modifier_transition(mods: &mut HashSet<ModifierFlag>, vk: u32, is_key_down: bool) -> bool`——vk 是左右 Ctrl／Alt／Shift／Win 之一就 insert／remove 對應 flag 並回 true，否則回 false。VK 常數搬到同一處。
- `hook_proc`：在記號放行之後、`is_recording` 判斷之前，對每個 key down／up 先呼叫它更新 `shared.active_modifiers`（需要拿鎖；拿不到就照 A 記一行並放行）。
- 三個讀取點改讀 `shared.active_modifiers`：錄製時修飾鍵按下的 accumulate、錄製時 `all_released`、一般模式 Combo 分支（原本每個事件重算一次的那行刪掉）。
- `start_hotkey_recording`／`reset_key_states` 已會 `clear()`，開始錄製時從乾淨狀態起算。
- 已知取捨：若某次放開事件沒進 hook（hook 逾時被系統跳過、或按鍵在 hook 安裝前就按住），追蹤會殘留「按住」直到下次同鍵事件；`reset_key_states` 可清。這與 macOS 版一致（macOS 也是從事件 flags 推）。

### 不動

- 記號放行（v0.12.1）、F23 放行、ESC 處理、雙擊／長按邏輯
- `keyboard_monitor.rs`
- 前端錄製流程（除了 listener 與 invoke 的先後順序、請求序號）與 10 秒逾時
- macOS 任何路徑

## 驗收

1. CI 三 job 綠
2. 發版後 Windows 實機（同事＋#30 回報者，開除錯記錄），每組看 `sayit.log`：
   - 視窗有焦點、按錄製後**立即**按 K
   - 視窗有焦點、按錄製後**等一秒**再按 K
   - 按錄製後**切到別的視窗**再按 K
   - 只按左 Ctrl 放開；Ctrl+K
   判讀：先看有沒有 `shared lock busy at recording-check`（有＝hook 收到但拿不到鎖，歸鎖競爭）；沒有它且只有「Recording mode started」＋「listeners ready」而無 `recording: vk` → hook 層沒收到，列待查；有 `recording: vk` 無 captured → 錄製處理器內（看其他 lock busy）；有 captured 無「captured received」→ emit／前端接收；三組都成功 → 本輪未重現，與監聽順序修正有效相容，但不能證明它是唯一成因
3. 監聽順序修正後，錄製流程在 macOS 上行為不變（本機 `pnpm tauri dev` 錄一次）

## 測試

- 沒有可在 macOS 跑的 Rust 單元測試（改動全是 cfg(windows) 內的日誌行）
- 前端：`SettingsView` 沒有 mount harness，監聽順序由 codex 實作閘逐行對照＋macOS 手動錄一次

## 發版（v0.13.1）

- 只修 bug 升 patch；changelog「Fixed」一條（錄製事件監聽順序）＋「Changed」一條（錄製診斷日誌）
- 更新摘要彈窗：一條，「Windows 自訂觸發鍵錄製：修了一個事件漏接的問題；若錄製仍沒反應，請開『除錯記錄』重現一次並把記錄檔傳到 issue #30」
- 對外：#30 串一則（請兩位回報者更新後開除錯記錄重現、傳 log；順帶回 chenjhchi 右 Alt＋右 Ctrl 等同批），#70 串不另發（cruelforever 在 #30 也在）

## 閘門

小卡節流：計劃閘最多兩輪（本輪為第一輪；範圍縮小後不另跑第二輪，理由：剩下的改動是日誌與兩行順序調換，實作閘足以覆蓋）。實作閘重點：鍵值只在錄製中記、鎖失敗不記鍵值、監聽順序與 unlisten 清理在失敗路徑仍正確、macOS 路徑零改動。
