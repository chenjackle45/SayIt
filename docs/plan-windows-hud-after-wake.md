# 計畫：Windows 休眠喚醒後錄音框框（HUD）不再出現（#70 衍生，Windows）（v0.15）

> 建立：2026-10-21 · 狀態：**骨架**（只有現象、讀碼事實與成因假說；尚未定修法、未過計劃閘）
> 來源：#70 cruelforever。10/12：框框有時出現有時不出現，猜與休眠喚醒有關、重裝後正常。10/20（issuecomment-6283868703）：框框沒出現時**錄音、啟動音效、貼上都正常**，只是沒有框框；只想到休眠喚醒後發生；**一旦發生只有重啟 SayIt 才回來**。10/20 已回覆記下、排之後版本（issuecomment-6298811057）。

## 現象

| | 回報 |
|---|---|
| 平台 | Windows（版本未問；用 test.2，觸發鍵右 Alt／右 Alt＋.） |
| 正常的部分 | 觸發、錄音、啟動音效、辨識、貼上 |
| 壞掉的部分 | HUD 視窗看不到 |
| 觸發條件 | 疑似休眠喚醒後（回報者自稱不確定還有沒有其他情況） |
| 恢復方式 | 只有重啟 SayIt |

## 已查證的事實（讀碼，2026-10-21）

- HUD 是 `label: main` 視窗：`transparent`、`alwaysOnTop`、`skipTaskbar`、預設隱藏（`tauri.conf.json:17-32`）
- Windows 置頂：`configure_windows_topmost_window` **只在啟動時**做一次：加 `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`、`SetWindowPos(HWND_TOPMOST)`（`lib.rs:51-84`、`:640-641`）。之後每次顯示 HUD 都不再重設
- 顯示流程 `showHud()`（`useVoiceFlowStore.ts:271`）：先重設 `lastMonitorKey`、呼叫 `get_hud_target_position` 定位，再 `show()`、`setIgnoreCursorEvents(true)`，錄音期間每 250ms 輪詢換螢幕；收起是 `hide()`
- **定位失敗不留紀錄**：`repositionHudToCurrentMonitor` 的 `catch` 是空的（`:247-249`，註解「不 log 避免洗版」）。如果定位失敗，HUD 會停在舊座標
- 錄音流程的狀態機就跑在 HUD 這個 webview 裡；貼上照常 ⇒ **HUD 的 JS 還活著**，壞的是「看得到」這一段
- 專案內**沒有任何電源／休眠喚醒的處理**（找不到 `WM_POWERBROADCAST`／resume 類程式碼）

## 成因假說（未驗證，依可能性排序）

| # | 假說 | 對得上的地方 | 對不上／待查 |
|---|---|---|---|
| H1 | **WebView2 喚醒後不再繪製**：喚醒時 GPU／合成器重建，透明 webview 的畫面沒恢復（或 WebView2 控制器一直認為自己不可見），JS 照跑但畫面一直是空的 | 「JS 活著、只有畫面不見、只有重啟能恢復」最吻合；透明視窗畫面空白時看起來就像沒出現 | Dashboard 視窗（另一個 WebView2）喚醒後畫得出來嗎？ |
| H2 | **置頂層級喚醒後掉了**：DWM／Explorer 重建後 `HWND_TOPMOST` 沒了，HUD 被壓在其他視窗下面；SayIt 只在啟動時設定一次 | 重啟才恢復＝重啟才會再設一次 | 一般來說 `WS_EX_TOPMOST` 喚醒後會保留；被蓋住時，在桌面空白處應該看得到 |
| H3 | **定位到看不見的位置**：喚醒時螢幕拓樸／DPI 變了，`get_hud_target_position` 失敗（錯誤被吞掉）或算出螢幕外的座標 | 每次 show 都會重新定位，照理會自己好 | 要「每次都失敗」才吻合「只有重啟能恢復」；需要日誌確認 |

## 待驗證（需要 Windows 實機，或請回報者協助）

1. 發生時打開 SayIt 主視窗（Dashboard）：畫面正常還是一片空白？（區分 H1 與 H2／H3）
2. 發生時把所有視窗縮到最小、看桌面頂端中央：框框是不是被壓在下面？（H2）
3. 開「除錯記錄」後重現，看日誌：`showHud` 有沒有錯誤、定位前後的座標（H3 需要先把空的 catch 改成會留紀錄）
4. 本機重現：Windows 電腦休眠（或「睡眠」）→ 喚醒 → 觸發錄音

## 修法方向（待驗證後才定，下列都只是候選）

- H1：監聽喚醒（`WM_POWERBROADCAST`／`PBT_APMRESUMEAUTOMATIC`）後重建或重新載入 HUD webview；或偵測到畫面空白時自我修復
- H2：每次 `showHud` 在 Windows 重新套用 `HWND_TOPMOST`（便宜，副作用小）
- H3：定位失敗要留紀錄；失敗時退回主螢幕預設座標

## 不做

- 不在 v0.14.2 處理（已對外說「排在之後的版本」）
- 驗證前不動程式
