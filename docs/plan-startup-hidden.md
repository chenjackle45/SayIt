# 計畫：啟動時隱藏主視窗（#76）

> 建立：2026-09-11 · 狀態：codex 計劃閘一輪（1 HIGH、3 MED，全數收進下方）→ 動工 · 排程：v0.13 第一張

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 自動更新下載完成後 `MainApp.vue` 會 show＋setFocus 主視窗，繞過隱藏設定 | 收：設定開時不主動 show／搶焦點，待安裝對話框留在視窗內，使用者開啟 Dashboard 時仍可安裝 |
| MED | 測試只驗持久化與載入，拿掉 HUD 條件仍會綠 | 部分收：補「未存值預設 false」與 `refreshCrossWindowSettings` 兩條；HUD／MainApp 啟動流程沒有既有測試 harness，列人工驗收 |
| MED | 未明定冷啟動 vs 已執行時再開的差別 | 收：手動冷啟動也隱藏；已在執行時再開一次（single-instance）會顯示，文案直說「手動啟動也適用」 |
| MED | 跳過 design.pen 沒有規則依據 | 待使用者豁免：新列與「隱藏 Dock 圖示」列同款；未豁免則補設計稿再 commit |

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | Dashboard 的自動更新計時器在 mount 時啟動，`loadSettings` 在 mount 之後；理論上設定讀取若晚於「5 秒＋檢查＋下載」完成，會讀到預設 false 而 show | 獨立 triage 降為不修：`loadSettings` 是本機 JSON 讀取（毫秒級），要輸給 5 秒延遲加一次網路下載沒有現實生產者；修法要動 Dashboard 啟動順序，風險大於收益。使用者可推翻 |
| MED | 設計稿豁免仍缺紀錄 | 待使用者豁免（見上表） |
| MED | 消融可刪：App.vue 只印日誌的 `else` 分支、store 的成功日誌 | 已刪 |
| LOW | 回饋文字用 `text-green-400`／`text-red-400` 硬編碼色 | 不修：同檔十幾列回饋全用同一寫法，只改新列會不一致；整檔換語意色另開卡 |

codex 另確認：HUD 時序成立、跨視窗接線完整、未移植 1200ms 鎖、Switch／Label 綁定正確、五語系 4 key × 5 齊全。

codex 計劃閘另確認：載入順序成立（App.vue 等 initialize、initialize 等 loadSettings）；無障礙權限錯誤時 `useVoiceFlowStore` 也會顯示主視窗，屬錯誤處理例外，保留。

## 要解決什麼

#76（obxyann）：開機自動啟動 SayIt 後，Dashboard 主視窗每次都跳出來，想只留系統列圖示。對外已承諾「加一個『啟動時隱藏主視窗』的選項」。

## 現況（誰在啟動時把主視窗叫出來）

```
App.vue（HUD，onMounted）
  appWindow.show()
  voiceFlowStore.initialize()        ← 內含 settingsStore.loadSettings()
  Window.getByLabel("main-window").show() + setFocus()   ← 這一行
  appWindow.hide()

main-window.ts（Dashboard）
  loadSettings → 若沒有 API Key → router.push("/settings") + show()   ← 首次設定，保留
```

`tauri.conf.json` 兩個視窗本來就 `visible: false`；主視窗的顯示完全由 HUD 端那一行決定。Rust 端 `show_main_window` 只在托盤選單、macOS Reopen、single-instance 第二次啟動時呼叫，與本卡無關。

## 方案（最小分支：純前端，約 30 行 ＋ 五語系文案）

| 層 | 改動 |
|---|---|
| store（`useSettingsStore.ts`） | 新增 `isStartHiddenEnabled`（store key `startHidden`，預設 `false`）；`loadSettings` 讀取、`saveStartHidden(enabled)` 寫入並 emit `settings:updated`；`refreshCrossWindowSettings` 同步。完全照 `hideDockIcon` 的樣板 |
| HUD（`App.vue`） | `initialize()` 之後：`if (!settingsStore.isStartHiddenEnabled)` 才 show 主視窗。首次設定（無 API Key）路徑在 `main-window.ts`，不受影響，仍會顯示設定頁 |
| Dashboard（`MainApp.vue`） | 自動更新下載完成後，設定開時不 show／setFocus，只設 `showAutoInstallDialog` |
| 設定頁（`SettingsView.vue`） | 「應用程式」區塊在「開機自動啟動」列之後加一列 Switch，樣式與「隱藏 Dock 圖示」列相同；不分平台（Windows 也適用，系統列圖示兩平台都有） |
| i18n | `settings.app.startHidden` / `startHiddenDescription`，五語系 |
| 測試 | `use-settings-store.test.ts` 四條：持久化＋emit、loadSettings 載入 true、未存值預設 false、refreshCrossWindowSettings 同步 |

文案（zh-TW）：「啟動時隱藏主視窗」／「手動或開機啟動後都不顯示主視窗，只保留選單列（系統列）圖示；從圖示選單或再開一次 SayIt 即可叫出」。

## 為什麼不做「只在開機自啟動時隱藏」

另一條路是讓 autostart 註冊時帶 `--hidden` 參數、Rust 讀參數再告訴前端。多一個 Tauri command、IPC 表要改、既有使用者的自啟動項目要重新註冊才會帶參數。對照三問：想要「手動開啟顯示、自啟動隱藏」兩種行為並存的人，目前沒有任何回報；有這需求時再加分支。開了這個選項的人明知道啟動後要從圖示叫視窗。

## 不做

- 不動 Rust、不加 command
- 不改首次設定路徑（無 API Key 仍彈設定頁）
- 不改 `hideDockIcon`、autostart 邏輯
- 不另做 design.pen：新列與既有「隱藏 Dock 圖示」列完全同款，屬既有樣式的第 N 個實例

## 驗收

1. 設定關（預設）：行為與 v0.12.0 相同，啟動後主視窗出現
2. 設定開：冷啟動（手動或開機）後主視窗不出現、HUD 正常、托盤「開啟 Dashboard」可叫出；macOS 點 Dock 圖示（Reopen）、已執行時再開一次（single-instance）可叫出；有可下載更新時主視窗不會自己跳出來，開啟後看得到待安裝對話框
3. 設定開且沒有 API Key：仍顯示設定頁
4. 切換開關後兩個視窗的 store 值一致（`settings:updated`）
5. `pnpm test`、`vue-tsc`、五語系 jq 全過

## 閘門

小卡節流：計劃閘最多兩輪；措辭類 finding 上限 MED。
