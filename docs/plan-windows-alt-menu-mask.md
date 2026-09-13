# 計畫：Windows 單顆 Alt 觸發鍵放開後啟動選單列、貼上失焦（v0.14.2）

> 建立：2026-09-13 · 狀態：codex 計劃閘三輪（R1：2 HIGH 5 MED；R2：1 HIGH 3 MED；R3：1 HIGH 1 MED，設計面已收斂、剩驗收寫法；全收，見文末）→ **計劃閘通過，動工前提＝#70 回音符合通過判準** · 排程：v0.14.2（小卡批，#24 另卡）
> 來源：#70 cruelforever 2026-09-11 留言「在其他程式上使用右 Alt 會跳出，辨識完不會貼到應該在的對話框，手動 Ctrl+V 可以」；2026-09-13 已回問「放開右 Alt 後選單列是否反白」（issuecomment-5652908237），等回音。

## 要解決什麼

Windows 上觸發鍵是**單顆 Alt**（預設右 Alt）時，一次「按下到放開之間沒有其他鍵」的 Alt 會讓 Windows 把該視窗的鍵盤焦點交給選單列（`WM_SYSKEYUP` 的預設處理）。之後 SayIt 送出的 Ctrl+V 落在選單列，文字沒貼進輸入框。

哪些操作會產生「單獨的 Alt」（程式碼查證）：

| 情境 | 為什麼是單獨的 Alt |
|---|---|
| Toggle 模式的開始與停止 | `handle_key_event` 在按下時只啟動長按計時，放開時才切換；按放之間沒有任何鍵 |
| Hold 模式的雙擊切模式 | 第一次按下仍發 Start（探測可能來得及注入）；命中雙擊的**第二次**按下直接 return、不發 Start，第二次按放之間沒有其他鍵 |
| Hold 模式一般錄音，但探測還沒注入就放開 | 探測經非同步 IPC 才呼叫 `read_selection_state`，Ctrl+C 不保證落在 Alt↑ 之前；剪貼簿建立／清空失敗也會在 Ctrl+C 前返回 |

Hold 模式一般錄音在探測成功時，Alt 按住期間已有注入的 Ctrl+C，Windows 不視為單獨的 Alt——這是「Hold 多半沒事」的原因，但不是保證。

**成因狀態：可信候選，未證明完整因果鏈**（兩次 Alt → 最後仍在選單 → 貼上落空）。回報者回音要涵蓋：程式與 SayIt 版本、Hold／Toggle、鍵盤配置與 IME、**開始與停止各次放開後**選單列是否反白、手動 Ctrl+V 之前有沒有先點輸入框或按 Esc。

**通過判準（同環境對照）**：同一程式、同一段語音，兩組都**先等 SayIt 的自動流程完全跑完**（HUD 顯示完成或失敗、不要在轉錄中按任何鍵——錄音後按 Esc 會被當成中止訊號，打斷整條流程），並確認剪貼簿裡已是辨識文字；然後 (a) **不點輸入框、不按 Esc**，直接手動 Ctrl+V → 沒貼進；(b) 只按一次 Esc 退出選單再手動 Ctrl+V → 貼進。(a) 失敗且 (b) 成功＝支持選單／焦點因素；其他組合＝不支持，維持候選、另找成因。這組對照只證明成因，修復是否有效仍看驗收 1 的修前修後對照。「選單有反白」單獨不足；「回報者是 Hold」不排除本成因（見上表）。

## 三問

1. **生產者**：單顆 Alt 家族觸發鍵（右 Alt、左 Alt、自訂鍵碼 0xA4／0xA5）在上表三種情境下的每一次按放。Windows 預設觸發鍵就是右 Alt。真人回報一位（#70），前提待驗。
2. **機制會 fire 嗎**：Windows 只在「Alt 按下到放開之間沒有其他鍵」才啟動選單。**在 Alt↑ 進 hook、放行之前**用 `keybd_event` 送一顆無作用鍵（`0xE8`↓↑），這正是 AutoHotkey `A_MenuMaskKey` 的 hook 路徑（hook.cpp 在放開事件放行前遮罩、keyboard_mouse.cpp 以 `keybd_event` 發送；其註解證實遮罩呼叫會重入 hook、此時系統仍視 Alt 為按下）。**只借用時點與 API，效果仍待驗**：目標程式是否真的收到 Alt↓ … E8↓ E8↑ Alt↑，由驗收 6 在目標視窗層級確認；不用 `SendInput`，因為它與先例不同 API、順序沒有一手證據。注入事件帶 `SAYIT_INJECTED_EXTRA_INFO`，重入的 hook 在任何狀態處理之前放行（守衛在 F23 之後、共享鎖之前；呼叫點已離開共享鎖作用域）。
3. **砍什麼**：不砍。探測時序、焦點還原、Hold／Toggle 語意都不動。

## 方案

| | 做法 | 為什麼選／不選 |
|---|---|---|
| **A（採用）** | `hook_proc` 單鍵分支：既有 `matches` 成立、事件是 **key up**、`vkCode` 是 `VK_LMENU`／`VK_RMENU` 時，先以 `keybd_event` 送 `0xE8`↓、`0xE8`↑（各帶記號），再交給 `key_handler` 並放行。Hold／Toggle 都做 | 對齊 AutoHotkey 的時點與 API；改動集中在既有分支幾行＋一個小函式；跨模式做是因為上表三種情境橫跨兩種模式。**效果待驗**（驗收 6） |
| B | 在 Alt↓ 的 hook 內注入 | 第一輪原案；快速按放時沒有證據遮罩會落在 Alt↑ 之前 |
| C | 只在 Toggle 送 | 漏掉 Hold 雙擊切模式與探測未注入即放開兩種情境 |
| D | 吞掉 Alt 事件不放行 | 改變所有 Alt 組合操作，不是更小的改動 |
| F | 用 `SendInput` 批次送兩個 INPUT | 與先例不同 API；SendInput 只保證同批不被穿插，沒有文件保證先於回呼中的 Alt↑ 送達 |
| E | 遮罩鍵用 Ctrl（AutoHotkey 預設） | Ctrl 是常見快捷鍵成員，也會命中自家左 Ctrl 分支（雖有記號守衛）。`0xE8` 目前 Microsoft 列為 Unassigned、AutoHotkey 推薦為通常無作用的候選；不宣稱絕對安全，IME／AltGr 配置列入實測 |

## 改動點（只有 Rust、只有 Windows 分支）

| 檔案 | 改什麼 |
|---|---|
| `src-tauri/src/plugins/clipboard_paste.rs` | 新增 `pub fn send_alt_menu_mask_key()`：兩次 `keybd_event(ALT_MENU_MASK_VK, 0, flags, SAYIT_INJECTED_EXTRA_INFO)`，第二次帶 `KEYEVENTF_KEYUP`；常數 `ALT_MENU_MASK_VK: u8 = 0xE8`。參數組裝抽成 `build_alt_menu_mask_calls() -> [(u8, u32, usize); 2]` 純資料供測試 |
| `src-tauri/src/plugins/hotkey_listener.rs` | `hook_proc` 單鍵分支 `if matches { … }` 內：`is_key_up && (vk == VK_LMENU || vk == VK_RMENU)` 就先呼叫上面的函式再 `key_handler`。**不抽純判斷函式**（第一輪消融裁決：既有分支已完成匹配，重述分類沒有新增行為保證） |
| `.claude/rules/windows.md` | 貼上段補一句：單顆 Alt 觸發鍵放開前以 `keybd_event` 注入 0xE8 遮罩，時點與 API 都照 AutoHotkey 先例、不要改成按下時送或 SendInput |

**邊界**：本卡只修單鍵 Alt 家族。Chord（例如右 Alt＋右 Ctrl）與 Combo（Alt＋K）通常因第二顆鍵而不觸發選單，但 **Shift↓→Alt↓→Alt↑→Shift↑ 這類順序仍可能開選單**，列為未涵蓋、不宣稱不需要。

## 不動

- 探測時序（v0.12.0 修法）、`capture_target_window`／`restore_target_window`（只記 HWND、同視窗直接返回，不還原控制項焦點——本卡不擴）、Toggle 長按切模式（計時執行緒發出，與放開無關）、macOS 全部。
- 不過濾 `LLKHF_INJECTED`（`.claude/rules/windows.md` 既有規則）。

## 驗收

發版前只有 4、5 在 CI（windows runner `cargo test`）能跑；1～3、6～8 是**發版後實機驗收**（同事或回報者），CI 綠不記為已修。

1. **Toggle＋右 Alt**：記事本與回報者原本出問題的程式。按放開始、講話、按放停止 → 文字貼進輸入框；**兩次放開後**選單列都沒有反白。加測快速雙擊（兩次按放間隔很短）。
2. **Hold＋右 Alt**：一般錄音行為不變；**雙擊切模式**後，第一次與第二次放開分別觀察，選單列都不反白；「按下後立刻放開」用驗收 6 的訊息工具確認至少一輪 Ctrl+C 未在 Alt↑ 之前出現，做不到就標未覆蓋。
3. **左 Alt、自訂鍵 0xA4／0xA5**：同 1 的 Toggle 流程。
4. 單元測試（Windows cfg）：`build_alt_menu_mask_calls()` 兩筆 vk 都是 `0xE8`、第一筆旗標無 `KEYEVENTF_KEYUP`、第二筆有、兩筆都帶記號。
5. 單元測試：`SAYIT_INJECTED_EXTRA_INFO` 非零（既有）。hook 內「只在 key up 送、key down 不送、非 Alt 家族單鍵不送」無法在單元測試層驗（hook 不可測），由 6 與 9 覆蓋。
6. **事件追蹤（目標視窗層級）**：在目標程式本身觀察收件順序——用會列出 `WM_SYSKEYDOWN／WM_SYSKEYUP／WM_KEYDOWN／WM_KEYUP` 四種訊息的視窗訊息工具（Spy++ 或等效）看回報者原程式或記事本；若改用自製接收視窗，它必須有選單列、保留系統預設鍵盤處理，並**先在未修版確認裸 Alt 會讓它開選單**，否則「選單未開」形同虛設；自製視窗的結果只證明該視窗，不取代驗收 1。**不接受鍵盤 hook 紀錄**。記錄 Windows 版本、SayIt 版本；快速按放與長按各一次；通過＝順序為 `Alt↓ … E8↓ E8↑ Alt↑` 且選單未開；Alt↓ 時沒有 E8。順序不符＝本卡失敗，回退遮罩並改列未解。
9. **非 Alt 觸發鍵零 E8**：觸發鍵改右 Ctrl、F 鍵，同一訊息工具確認整輪沒有 0xE8。
10. **單鍵 Alt 設定下的系統快捷鍵不退化**：Alt+Tab、Alt+F4、Alt+空白鍵、瀏覽器 Alt+← 各操作一次，行為與 v0.14.1 相同（遮罩在這些序列的 Alt↑ 也會送出，本項驗它無害）。
7. **Toggle＋右 Alt＋右 Ctrl 和弦、Alt＋K 組合**：行為不變；和弦另測「右 Ctrl 先放／右 Alt 先放」兩種順序，記錄選單列是否反白（未涵蓋項的基線）。
8. IME 開啟、組字中、AltGr 配置各試一次 Toggle 流程：通過＝沒有多出字元、組字沒有被中斷、IME 快捷鍵沒有失效；沒有設備就標「未驗」，不記通過。

## 消融審查（給 codex）
每個新機制問：拿掉它，哪條驗收或測試會壞？答不出具體那條的列「可刪」finding（MED）。
- `build_alt_menu_mask_calls` 抽出：拿掉 → 驗收 4 無法寫。
- hook 內的發送呼叫：拿掉 → 驗收 1、2、6 壞（發版後實機才有證據，發版前為靜態推導）。
- Hold 也送：拿掉（只 Toggle）→ 驗收 2 的雙擊與「立刻放開」兩項壞。

## 計劃閘第一輪結果（2026-09-13，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | Alt↓ 的 hook 內送鍵，不等於遮罩落在 Alt↓／Alt↑ 之間；AutoHotkey 是在 Alt↑ 放行前遮罩 | 收：注入時點改為 Alt↑ 進 hook、放行前（方案 A）；補驗收 6 事件追蹤 |
| HIGH | 「有反白＝成立、Hold＝不成立」不成立：雙擊分支不發開始、探測非同步、剪貼簿失敗提前返回；反白也不證明造成貼上失敗 | 收：成因改為「可信候選」，回音需含程式版本／模式／IME／兩次放開狀態／手動貼上前是否點擊；刪「他已點回輸入框」「舊回報者都是 Hold」「Edge 工具列仍接收貼上」三句未證實敘述 |
| MED | Chord 全部免遮罩理由過廣（Shift↓ Alt↓ Alt↑ Shift↑ 可能開選單） | 收：改寫為「未涵蓋」，驗收 7 補兩種放開順序基線 |
| MED | 0xE8 不能說「沒有任何程式會綁」 | 收：改措辭；驗收 8 補 IME／組字／AltGr |
| MED | AC 不足以驗核心：刪掉 hook 發送仍可全綠；AC6 引用的 v0.12.1 AC2 尚未實測 | 收：驗收重寫，明列 CI 可跑與發版後實機；AC4 補型別與旗標；事件追蹤取代引用 |
| MED | 消融①純判斷函式可刪 | 收：不抽函式，inline 在既有分支 |
| MED | 消融③Hold 也送按原 AC 可刪；但雙擊與探測延遲是具體動機 | 收：驗收 2 補雙擊切模式與立刻放開兩項，保留跨模式 |

codex 另查證：Toggle 長按由計時執行緒發出、非靠放開判定；焦點還原只記 HWND、同視窗直接返回；記號守衛在共享狀態處理之前、擬議呼叫點已離開共享鎖作用域，不需新增重入鎖；builder 保留。

## 計劃閘第二輪結果（2026-09-13）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 時序未收斂：AutoHotkey 用 `keybd_event` 不是 `SendInput`；AC6 未指定觀察層級 | 收：改用 `keybd_event` 對齊先例 API；方案 F 記為不採；AC6 改目標視窗訊息層級、拒收 hook 紀錄、寫明失敗處置；三問 2 改「效果待驗」 |
| MED | 成因確認缺通過判準 | 收：加同環境對照 (a)/(b) |
| MED | Hold 雙擊描述有誤（第一次按下仍發 Start）；AC2 探測延遲不確定 | 收：改正表格；AC2 分兩次放開觀察、訊息工具確認 |
| MED | AC 缺：非 Alt 零 E8、單鍵 Alt 下系統快捷鍵不退化、AC8 無失敗判準 | 收：新增 9、10；AC8 補判準與「未驗」 |

## 計劃閘第三輪結果（2026-09-13）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | Esc 對照組會誤判：錄音後的 Esc 在轉錄中被前端當中止訊號，(b) 失敗不代表排除選單假說 | 收：兩組都先等自動流程跑完、確認剪貼簿，再比「直接手動貼上」vs「Esc 後手動貼上」；不改 Esc 行為 |
| MED | AC6 訊息清單少 `WM_KEYUP`；自製接收視窗若沒選單或沒預設處理，「選單沒開」形同虛設 | 收：四種訊息都列；自製視窗須先在未修版確認裸 Alt 會開選單、且只證明該視窗 |

codex 裁決：前兩輪七項中五項完全收斂、兩項因本輪 HIGH 部分收斂（本輪已收）；三項消融全部保留；設計面（時點、API、邊界、inline）已收斂，剩驗收執行細節，改完可視為計劃閘通過。

## 閘門
codex 計劃閘三輪（已通過，見上）→ 等 #70 回音確認前提 → 實作 → 雙向追溯閘 → codex 實作閘 → 列檔案等 commit 授權 → 與 #24 卡合併出 v0.14.2。
