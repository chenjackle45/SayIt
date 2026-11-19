# 計畫：Windows 錄音框每次顯示都重新拉到最上層（#88＋#70，Windows）（v0.15）

> 建立：2026-11-18 · 狀態：**已實作、實作閘 R2 可提交**（計劃閘 R1 GO 附條件）；待 Windows CI 編譯＋回報者實機驗收
> 來源：#88（chenjhchi）11/17 回覆：檔案總管、Chrome、任何程式都會蓋住錄音框；與最大化／全螢幕無關；「重開 SayIt 後短暫在最上面，過一段時間就跑到最底層」。#70（cruelforever）10/20：休眠喚醒後錄音框不見、錄音與貼上照常、只有重開 SayIt 才回來。拍板：2026-11-16 盤點 Q2＝A（兩串併一張卡進 v0.15、各自判定成因）；2026-11-18 使用者同意開工。

## 要解決什麼

| | 已查證的事實（讀碼） | 推論（待驗） |
|---|---|---|
| 最上層設定 | `configure_windows_topmost_window`（`src-tauri/src/lib.rs`）只在 app 啟動 setup 時呼叫一次：加 `WS_EX_TOOLWINDOW｜WS_EX_NOACTIVATE`，`SetWindowPos(HWND_TOPMOST, NOMOVE｜NOSIZE｜NOACTIVATE｜FRAMECHANGED)` | Windows 上最上層狀態可能被其他程式或系統事件打亂，之後不會被補回 → 吻合「重開時正常、一陣子後沉下去」 |
| 顯示路徑 | 錄音框每次顯示都走前端 `showHud()`（`useVoiceFlowStore.ts`：重新定位到目前螢幕 → `show()` → 忽略滑鼠），另有「學到新詞」通知的一處 `show()`；兩處都沒有重設最上層 | — |
| 我方條件 | 沒有 Windows 機器；Windows 程式只能靠 CI 編譯與「只產安裝檔、不發布」測試流程交回報者試 | — |
| #70 喚醒後消失 | 回報者：錄音音效與貼上照常、框不見、重開才回來 | 可能同源（喚醒後 z-order 重排、最上層遺失被蓋住），也可能是位置跑到螢幕外；本卡只處理最上層，驗收時請 #70 回報者一起測喚醒情境，各自判定 |

## 方案

新增一個 Windows 專用的 Rust 指令（暫名 `reassert_hud_topmost`），內容只有啟動時那一次 `SetWindowPos(HWND_TOPMOST, NOMOVE｜NOSIZE｜NOACTIVATE)`（不重設 extended style、不搶焦點）；非 Windows 平台不做事、回 Ok。前端在 `showHud()` 與「學到新詞」顯示處，`show()` 之後呼叫一次（只在 Windows 呼叫；失敗只記錄、不擋錄音）。

選這個而不用前端現成的 `setAlwaysOnTop(true)`：tao 0.34.5 的實作帶 `SWP_NOACTIVATE`、不會搶焦點，但**狀態快取判定已是最上層時直接返回、不重排**；切成 false 再 true 會多一次降層。自訂指令保證每次都真的執行重排。App 啟動顯示沿用 setup 那次，不另加呼叫。

## 不做

- 不加定時器反覆拉到最上層：本機制只在**下一次顯示／狀態切換**時補救，錄音進行中途被蓋不會立即補回；這是已知未涵蓋，實測若顯示中途被蓋是常態再另議（沒有頻率證據，不預設少見或常見）
- 不處理位置跑到螢幕外的可能（等 #70 測試結果判定）
- macOS 不動（macOS 用 window level 27，未有回報）

## 改動檔案（預估）

- `src-tauri/src/lib.rs`：抽出 SetWindowPos 部分、新增指令並註冊
- `src/stores/useVoiceFlowStore.ts`：兩處顯示後呼叫
- `.claude/rules/ipc.md`：IPC 表新增一列
- 測試：前端兩處顯示路徑在 Windows 會呼叫、在 macOS 不呼叫、呼叫失敗不擋錄音

## 驗收

| # | 內容 | 方式 |
|---|---|---|
| 1 | Windows 平台：`showHud()` 與學到新詞顯示都在 `show()` 之後呼叫一次指令；非 Windows 不呼叫；指令失敗時錄音流程照常 | 單元測試 |
| 2 | 消融：拿掉任一呼叫點 → 對應測試紅 | 單元測試 |
| 3 | Rust：clippy `-D warnings`、Windows CI 編譯通過 | CI |
| 4 | Windows 實機（測試版交 chenjhchi＋cruelforever），分開記錄：①**閒置一段時間後開始錄音**，錄音框在 Chrome／檔案總管之上 ②**錄音進行中切換程式**，錄音框是否被蓋（失敗＝已知未涵蓋，記錄不擋） ③錄音框出現前後**輸入游標仍在原本的輸入框**（不只看最後貼上成功：貼上流程本身會把焦點還原） ④#70 休眠喚醒後錄音框是否出現（與 #88 分開判定，不預設同源） | 回報者實測 |
| 5 | `pnpm test`、`vue-tsc`、eslint 全綠 | 本地 |

## 計劃閘 R1（2026-11-18，codex gpt-6.1-sol xhigh 唯讀、審查暫存區）

判定 **GO 附條件、0 HIGH**。查證：最上層初始化只在 setup 一次；`show()` 經 tao 會重寫樣式但不會無條件 `SetWindowPos(HWND_TOPMOST)` 重排；`HWND_TOPMOST＋NOMOVE｜NOSIZE｜NOACTIVATE` 適合單次重排、不需 `FRAMECHANGED`；TOPMOST 高於非 TOPMOST，但其他 TOPMOST 視窗仍可蓋過。

| 等級 | 問題 | 處置 |
|---|---|---|
| MED | 「現成 API 是否帶 NOACTIVATE 不明」不成立（tao 0.34.5 有帶；相同旗標直接返回） | 收：理由改為「強制執行、避免快取略過」 |
| MED | 啟動時的 `WS_EX_NOACTIVATE` 不是永久保證（tao 顯示／穿透切換時會重建 extended style；既有行為，非本卡新增） | 收：驗收 4③ 直接看輸入游標，不只看貼上成功；不擴張成樣式修復 |
| MED | 「錄音中途被蓋少見」無頻率證據；驗收分不出遮蓋時點 | 收：刪「少見」；驗收 4 分①閒置後錄音 ②錄音中切程式，②失敗明記未涵蓋 |

接受的邊界：本修正是低成本試修、非已證實根因；無 Windows 機器只能交付測試版、不能宣告修復；#70 可能是位置或顯示問題，分開判定。

## 實作閘（2026-11-19，codex gpt-6.1-sol xhigh、審查暫存區）

**R1 修後可提交、0 HIGH**。查證：windows 0.61.3 的 `SetWindowPos` 簽名、`Some(HWND_TOPMOST)`、`hwnd()` 型別、`Manager` 作用域都對；IPC 註冊、名稱、型別兩端一致；呼叫時點為 show → 重設 → 忽略滑鼠；沒帶 `SWP_SHOWWINDOW`，HUD 已隱藏時呼叫也不會被重新顯示。

| 等級 | 問題 | 處置 |
|---|---|---|
| MED | 順序測試的 show 立即完成，移除 `await show()` 或重設兩次測試仍綠 | 收：兩個顯示點改用「卡住 show 直到放行」，完成前斷言 0 次、完成後斷言完整順序（恰好一次）；四種變異皆紅 |

**R2 窄審可提交、無新 finding**：修正完整回應 R1、無不穩定風險、產品碼無夾帶。

本機：vitest 645 綠、vue-tsc、eslint 0 錯、macOS clippy `-D warnings` 與 `cargo test` 131 綠。Windows cfg 區塊待 CI windows runner 編譯。tauri-reviewer 子代理本環境不可用，IPC 一致性改由 codex 實作閘 R1 一併審查。
