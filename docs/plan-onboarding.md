# 計畫：v0.17 卡 4 首次啟動引導＋刪功能介紹頁

> 建立：2026-11-28 · 狀態：R1 退回（1H6M）→ R2 退回（1H3M，同一 HIGH）→ R3 改刪延後摘要機制待審
> 依據：`docs/plan-ui-redesign-v2.md` 契約 C2（流程以契約為準，demo 只管視覺）、v0.17 第 11 項；原型 `docs/demos/ui-redesign-v2/prototype.html`「第一次啟動引導」段。

## 要解決什麼
新使用者裝好後，要自己找到三件事才講得出第一句：輔助使用權限、Groq 金鑰、觸發鍵。現在沒有金鑰時會被丟進設定頁，自己摸索；功能介紹頁是 8 張文字卡，沒人看。改成第一次啟動時，用一個四步引導帶使用者講出第一句；功能介紹頁刪掉。

## 角色／資料／流程／規則

| 面向 | 內容 |
|---|---|
| 角色 | 新安裝的使用者；升級使用者不受影響 |
| 資料 | 新增一個設定旗標 `onboardingCompleted`（tauri-plugin-store，不進 SQLite） |
| 流程 | 啟動 → 判斷要不要顯示 → ①權限（僅 macOS）→ ②金鑰 → ③觸發鍵 → ④試講 → 完成 |
| 規則 | 每一步都能略過；略過或完成都寫旗標；新安裝不顯示更新摘要 |

## 觸發判斷（照 C2）

```
 讀 onboardingCompleted
   ├─ 已完成 → 不顯示
   └─ 未完成 → 在 consumeUpgradeNotice「寫 lastSeenVersion 之前」先讀到它
        ├─ lastSeenVersion 存在／有歷史記錄／已有金鑰（任一）→ 升級使用者：直接寫旗標、不顯示
        └─ 全無 → 新安裝：顯示引導
```
- **R2 改法（取代 R1 H1 的延後摘要；R1、R2 兩輪同一 HIGH，改刪機制）**：新安裝的人沒用過舊版，「這版更新了什麼」對他沒有意義，現有程式本來也不對沒金鑰的新安裝顯示摘要。所以：啟動流程先用唯讀函式讀 `lastSeenVersion`、金鑰、歷史筆數判斷；**要顯示引導 → 直接把 `lastSeenVersion` 寫成目前版本、不設摘要旗標**（本版視為已讀，之後升級才彈下一版的摘要）；不顯示 → 照舊呼叫 consume。代決：C2「延後到下次啟動」改為「新安裝不顯示」，與現有新安裝行為一致；要改回延後，需要一個能區分「略過且沒存金鑰」的持久狀態（R2 已證明只靠 lastSeenVersion 不夠）。
- 「有歷史記錄」讀資料庫筆數；資料庫初始化失敗時視為「不確定」→ 不顯示引導（寧可漏顯示，不對老使用者彈引導）。
- 取代 v0.16 過渡：`main-window.ts` 的「沒金鑰 → `/settings/ai`」改成：要顯示引導就走引導；不顯示引導但沒金鑰（例如升級使用者自己刪了金鑰）→ 維持導向 `/settings/ai`。

## 四步（照 C2，沿用既有元件）

| 步 | 內容 | 沿用 |
|---|---|---|
| ① 權限（僅 macOS） | 「打開系統設定」＋權限輪詢；授權後 reinitialize listener；Windows 跳過此步 | `AccessibilityGuide` 的輪詢與 `reinitialize_hotkey_listener`：抽成 composable 共用，不複製一份 |
| ② 金鑰 | 輸入 Groq 金鑰＋測試連線；成功才能按「下一步」（也可略過）。**R1 M4**：引導自己記「本次受測的金鑰＋結果」，只有結果對應目前輸入值、且儲存成功才放行；改了金鑰或舊結果晚回來都不放行 | 既有金鑰儲存 API＋`ConnectionTestButton`（不改它的 API，用 onTest 回呼） |
| ③ 觸發鍵 | 顯示目前實際設定的觸發鍵，可改 | 既有錄鍵 session（與卡 3 共用的全域錄鍵狀態） |
| ④ 試講 | 一個真實輸入框，提示「按住〈觸發鍵〉說一句話」；走既有錄音→貼上流程，貼進這個框就算成功 | 不畫假進度、不另寫錄音邏輯 |

- 權限已授權時 ① 自動顯示完成；已有金鑰時 ② 顯示完成。
- **R1 M3（一次只有一個模態）**：一個明確的引導狀態 `pending → showing → done`。在 `pending` 與 `showing` 期間：不開 `AccessibilityGuide`（權限由 ① 處理）、⌘K／⌘, 與原生選單導頁事件暫緩、更新安裝提示暫緩；進入 `showing` 時關掉已開的面板。
- **R1 M5（試講先做探針）**：實作前先在 Mac 與 Windows 各跑一次最小探針：主視窗裡一個自動聚焦的空輸入框，按真實觸發鍵，看「觸發 → 錄音 → HUD → 貼上 → 輸入框收到」整條鏈是否成立（Windows 另用外部記事本對照）。不成立就把 ④ 改成「到任何 App 試講，回來按完成」，不硬做。提示文字依實際觸發模式（按住／切換）顯示。
- **R2 M（暫緩後的恢復）**：引導進入 `done` 後，重新跑一次權限檢查（未授權才開 `AccessibilityGuide`），暫緩的更新安裝提示再顯示；被暫緩的 ⌘K／⌘, 不補執行。
- **R2 M（錄鍵收尾）**：離開 ③ 或關閉引導時，若錄鍵 session 進行中就呼叫它的 stop，不留懸空的錄鍵狀態。
- **R2 M（探針失敗的處理）**：M5 探針任一平台不成立 → 停下回報使用者，不自行改成「到外部 App 試講」（那是 C2 規格變更）。
- 偏好設定「關於」分頁加「重新顯示引導」：只打開引導，不清除完成旗標（R1 M2 代決：少一筆持久寫入；取消後狀態不變）。

## 刪功能介紹頁
- 刪 `FeatureGuideView.vue`、路由 `/guide`、`PreferencesView` 裡的入口連結、`MainApp` 的標題對照、i18n 相關 key（五語系同步刪）。
- 不留 `/guide` 轉址（R1 M1 代決：查無系統匣、選單、deep-link 會帶到它；未知路由本來就由全域守衛處理）。

## 不做
- 不做功能導覽、逐步提示泡泡、教學影片。
- 不另寫錄音或貼上邏輯；試講就是正式流程。
- 不在 Windows 做權限步驟（Windows 不需要）。

## 驗收
1. 觸發判斷單元測試五種入口：新安裝顯示；有 lastSeenVersion／有歷史／有金鑰各自不顯示且寫旗標；已完成不顯示；資料庫失敗不顯示。
2. **R2 兩次啟動測試**（真實 settings store＋記憶體 plugin-store、兩個獨立 Pinia）：新安裝 → 顯示引導（存金鑰完成／略過不存金鑰兩條）→ 第二輪啟動，兩條都 `showPromptUpgradeNotice === false` 且 lastSeenVersion＝目前版本；把版本改成下一版再啟動 → `true`（之後的升級照常彈）。升級使用者路徑不變。
3. **R1 M3**：慢載入、權限 false 先回、引導中按 ⌘K／⌘,、收到原生導頁事件、更新下載完成——任一時刻只有一個模態。
4. 元件測試：四步前進與略過、macOS 才有權限步；**R1 M4** 三案：A 測成功後改成 B 不放行、A 晚回來時已改 B 不放行、儲存失敗不放行；重新顯示引導不改完成旗標。
5. 五語系 key 對齊，刪掉的 key 與 `/guide` 沒有殘留引用。
6. 實機（**R1 M6**：用 `tauri dev --config` 覆寫成測試專用 identifier，啟動前先印出解析後的 appData／appConfig 路徑確認不是 `com.sayit.app`；權限屬 macOS TCC、不隨資料清空，無權限情境另用測試身分驗）：Mac 從零走完四步並講出第一句；M5 探針結果記入本檔；Windows 實機待驗。

## 改動檔案（預估）
`src/components/OnboardingDialog.vue`（新）、`src/composables/useAccessibilityPermission.ts`（自 AccessibilityGuide 抽出）、`src/components/AccessibilityGuide.vue`、`src/stores/useSettingsStore.ts`、`src/main-window.ts`、`src/MainApp.vue`、`src/router.ts`、`src/views/PreferencesView.vue`、刪 `src/views/FeatureGuideView.vue`、`src/i18n/locales/*.json`、對應 tests。
