# 計畫：隱藏 Dock 圖示後，從應用程式資料夾打開 SayIt 圖示又回來（#82 續，限 macOS）（v0.15）

> 建立：2026-11-20 · 狀態：計劃閘 R1 NO-GO（1 HIGH、2 MED）→ 全收、焦點問題經四輪實測修正 → 實作閘 R1 修後可提交（1 MED 收、1 規格建議不收）→ 使用者真人重測通過 → **R2 窄審可提交**
> 來源：#82（ian90041）11/17 回報 v0.14.2「還是一樣」、11/18 確認沒有釘選 Dock。前一卡：`docs/plan-macos-dock-and-output-language.md`（v0.14.2 改用啟用策略 Accessory）。拍板：2026-11-20 使用者「好 開始修」。

## 要解決什麼

| | 已查證的事實（實測） | 推論 |
|---|---|---|
| 重現 | 正式版 0.14.3、這台 Mac：開隱藏 → 程式類型 UIElement；關主視窗仍 UIElement；**`open -a SayIt`（＝從應用程式資料夾／Spotlight／Launchpad 打開，觸發 `RunEvent::Reopen`）→ 1 秒內轉 Foreground，之後切頁、關視窗都回不去**（`lsappinfo` 每 0.5 秒記錄，2026-11-20 19:00、19:02 兩次一致） | 回報者「重開 SayIt 介面」多半就是這條路 |
| 對照 | 同條件下**第二實例**（單一實例回呼）叫出主視窗 → 維持 UIElement | 轉回 Foreground 的是 Reopen／LaunchServices 打開流程，不是我們的 `show_main_window` |
| 前卡缺口 | v0.14.2 驗收 ④ 只測系統匣＋第二實例，未測 Reopen | — |
| 重套有效 | Foreground 狀態下把開關關→開，會回到 UIElement | 在 Reopen 後重套 Accessory 可收回圖示 |

## 方案

`apply_dock_icon_hidden` 每次套用時記住狀態（`static DOCK_ICON_HIDDEN: AtomicBool`，限 macOS）；`RunEvent::Reopen` 若狀態為隱藏：**先**重套 `apply_dock_icon_hidden(true)`，**200ms 後在主執行緒再 `set_focus` 一次（只聚焦不顯示）**（策略切換由系統稍後完成，立即聚焦會被忽略）；最後照舊 `show_main_window`。只動 `src-tauri/src/lib.rs`，17 行。

選記憶體旗標而不在 Reopen 時讀設定檔：所有套用（啟動、切換開關、跨視窗同步）都經 `apply_dock_icon_hidden`，旗標是「最後一次要求套用的設定」（tao 不回傳 AppKit 切換結果，不是 OS 讀回值），不受存檔時序影響。旗標宣告限 macOS（Windows 會成 dead_code、CI `-D warnings` 擋下）。

## 動工前驗證（2026-11-20，開發版 .app，AppleScript 自動操作）

`tauri build --debug --bundles app` 打包（`tauri dev` 沒有 .app、`open` 觸發不到 Reopen）；先結束正式版（同 identifier、單一實例）。

| 情境 | 結果 |
|---|---|
| 隱藏開著 → 關主視窗 → 從應用程式資料夾打開 | ✅ 0.5／1.5／3／6 秒皆 UIElement，主視窗有出來 |
| 切五個頁面 | ✅ UIElement |
| 連續打開三次 | ✅ UIElement |
| 第二實例 | ✅ UIElement |
| **隱藏關著時打開（不退步）** | ✅ 維持 Foreground |
| 每 0.05 秒快速取樣三輪 | 第 1 輪首個取樣 Foreground、0.05 秒內回 UIElement；第 2、3 輪全程 UIElement |

已知限制：打開瞬間可能短暫轉成前景程式（< 0.1 秒），Dock 圖示可能閃一下；與前卡已接受的「開啟隱藏後重啟會閃一下」同類。

## 不做

- 不追 LaunchServices／tao 為何在 Reopen 時轉 Foreground（重套已解決，追根因成本高）
- 不改系統匣、第二實例路徑（實測不受影響）
- 不處理 Windows（無 Dock）

## 驗收

| # | 內容 | 方式 |
|---|---|---|
| 1 | 上表六項 | 開發版 .app 實測（已做，實作閘後若程式有改需重跑） |
| 2 | 消融：拿掉 Reopen 的重套 → 從應用程式資料夾打開轉 Foreground | 即正式版 0.14.3 行為（上方重現） |
| 3 | macOS clippy `-D warnings`、`cargo test`；Windows CI 編譯 | 本地＋CI |
| 4 | 交付後請回報者更新確認 | 回報者 |

## 計劃閘 R1（2026-11-20，codex gpt-6.1-sol xhigh、審查暫存區）

判定 **NO-GO（實驗 diff）、方向可行**。查證：所有策略切換都經 `apply_dock_icon_hidden`；tao 的 Reopen delegate 只轉交事件、不切 Regular，Tauri 在主執行緒同步執行策略切換；Apple 不保證啟用時序。

| 等級 | 問題 | 處置 |
|---|---|---|
| HIGH | 旗標只在 macOS 使用，Windows `dead_code` 被 CI 擋 | 收：宣告加 `#[cfg(target_os = "macos")]` |
| MED | 「視窗有出來」不證明焦點 | 收：補焦點實測 → **抓到真問題**（見下） |
| MED | 閃現不能沿用前卡接受範圍 | 列為觀察結果（< 0.1 秒、三輪一次），交使用者確認 |

## 焦點實測（2026-11-20 19:24–20:35）

自動量測的前景探針不可靠：`lsappinfo front` 與 System Events `frontmost` 在 Accessory 下互相矛盾（前者 SayIt、後者 Finder），且使用者操作電腦時讀值會被污染，改由**使用者真人測試**判定：另一個 App 在前景 → Finder 雙擊開發版 `SayIt.app` → 不點視窗直接 Cmd+W，看關掉的是誰。

| 版本 | Dock 圖示 | Cmd+W 關掉 |
|---|---|---|
| 0.14.3 正式版（對照，自動量測） | ❌ 回來 | （Foreground，焦點正常） |
| 重套 Accessory（先顯示後重套） | ✅ 不回來 | 自動量測顯示前景讓出 |
| 先重套、再顯示聚焦 | ✅ | ❌ **Finder**（使用者實測） |
| ＋立即呼叫 `NSApp activate` | ✅ | ❌ **Finder**（使用者實測） |
| ＋200ms 後主執行緒再 `show_main_window`（含 activate） | ✅ | ✅ **SayIt**（使用者實測） |
| **只留 200ms 延遲再聚焦（拿掉 activate，最終版）** | ✅ | ✅ **SayIt**（使用者實測，消融） |

自動驗證（最終版）：從應用程式資料夾打開、第二實例，0.3／1／2.5 秒皆 UIElement。

已知限制：①打開瞬間可能短暫轉前景（< 0.1 秒），圖示可能閃一下；②系統匣與第二實例路徑在隱藏模式下的焦點未改（v0.14.2 既有行為，本卡不動）；③200ms 為實測可用值，非系統保證。

## 實作閘 R1（2026-11-20，codex gpt-6.1-sol xhigh、審查暫存區）

判定 **修後可提交、0 HIGH**。查證：clone／move 閉包與 `run_on_main_thread` 契約正確；結束流程不受延遲執行緒影響；新程式全在 macOS cfg 內；隱藏關閉時路徑與改前相同。實跑 macOS clippy、`cargo test` 131 綠。

| 等級 | 問題 | 處置 |
|---|---|---|
| MED | 延遲回呼走 `show_main_window`（含 `show()`），使用者 200ms 內關窗會被叫回來；快速連續打開會留多個回呼 | 收：延遲那次只 `set_focus()`（tao 對隱藏視窗略過）；不加取消／節流 |
| MED（規格建議） | 外層 `run_on_main_thread` 可能多餘（tauri-runtime-wry 已把背景執行緒的視窗呼叫派回主執行緒） | 不收：codex 註明不要求本卡刪；拿掉需再真人重測、收益小 |

**修後真人重測（2026-11-20 20:50，使用者）**：①另一 App 在前景 → Finder 雙擊 → 不點直接 Cmd+W → 關掉 **SayIt** ✅ ②雙擊後立即 Cmd+W → 視窗**沒有自己跳回來** ✅。自動驗證兩條路徑皆 UIElement。

**R2 窄審（2026-11-20）可提交、無新 finding**：tao 0.34.5 macOS `set_focus` 先檢查 `!is_minimized && is_visible`，隱藏視窗直接略過；無夾帶；新程式全在 macOS cfg。實跑 clippy、`cargo test --lib` 131 綠。
