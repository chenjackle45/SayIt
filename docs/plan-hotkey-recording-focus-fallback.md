# 計畫：錄製自訂鍵時 SayIt 視窗有焦點 → 前端鍵盤事件當第二來源（#78、#70，v0.14.1）

> 建立：2026-09-12 · 狀態：codex 計劃閘一輪（2 HIGH、4 MED、1 LOW：HIGH 全收、MED 3 收 1 明示跳過、LOW 收）＋二輪（1 HIGH、4 MED、1 LOW：HIGH 收、MED 2 收 1 明示跳過 1 因 HIGH 處置消失、LOW 收）＋三輪（1 HIGH、3 MED、1 LOW，全收）＋四輪（0 HIGH、2 MED，全收）→ 實作完成 → 實作閘一輪（1 HIGH、2 MED，全收）＋二輪（0 HIGH、0 MED，可建議 commit）→ **macOS dev 驗證通過（2026-09-12，強開兩源：去重、單鍵、和弦、ESC、失焦交回 hook、連錄兩次皆正常；日誌每輪皆 hook 先到、無 dom captured）** → 等 commit 授權；Windows 實測待發版後 · 排程：v0.14.1（patch）
> 使用者 2026-09-12 拍板：直接修、不先在 issue 留言；發版後一次回串 #78 與 #70。

## 計劃閘結果（2026-09-12，codex 唯讀審查，一輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | macOS 兩源並發時 DOM 看不到 Fn：`Fn↓ Control↓ Control↑ … Fn↑`，DOM 在 Control↑ 就完成「單 Control」並取消 Rust，存錯鍵；去重救不了「DOM 少看一顆鍵卻有權完成」 | **收，範圍改**：DOM 來源**只在 Windows 啟用**（沿用 SettingsView 既有 `isMac` 判斷）。macOS 的 tap 不受焦點影響、沒有 #78 的病，不需要第二來源 |
| HIGH | 失焦殘留寫反：`Ctrl↓ → 切走 → Ctrl↑（DOM 漏收）→ 切回 → K↓` 會存成 Ctrl+K | **收**：`window` `blur` 時清掉 DOM 的 held 與 snapshot（Rust 錄製不動），切回後 DOM 從空開始；補這條序列與「切回才放 Ctrl 不產生 captured」測試。頁內欄位切換不觸發 window blur，不誤清 |
| MED | 「WebView 一定收到、preventDefault 能擋快捷鍵」不是全鍵保證（Win 鍵、單 Alt、Alt+F4、F-keys、PrintScreen 各有 OS／WebView 路徑） | **收，措辭縮**：承諾改為「補上能送達 DOM 的鍵」；核心驗收 Alt+Z、右 Alt＋右 Ctrl；特殊鍵列為邊界、由發版後 Windows 實測 |
| MED | `isRecording` 布林守衛擋得住同輪雙存，擋不住跨輪：舊 callback 在新一輪到達、舊 start 的 timeout 取消新輪、雙 ESC 重複拒絕 | **收一半**：captured／rejected／timeout 三處都改用既有 `recordingRequestSeq` 判終態（捕捉當輪 requestId，不符即丟）。**接線測試明示跳過（P2）**：SettingsView 掛載需 mock 十餘個 store，成本超出本 patch；改由 macOS dev 手動驗證（本機暫時把平台判斷改成 true，不入 commit）與 Windows 實測承接 |
| MED | DOM code→VK 固定表不是所有鍵盤配置的 hook 鏡像（AZERTY `KeyQ` 存 VK_Q、hook 收 VK_A）；NumpadEnter 表中缺席 | **明示跳過（P2，pre-existing）**：這張表既有、已用於顯示與預設鍵判斷，非本卡新增；非 QWERTY 配置在 Windows 使用者中尚無回報。列為邊界，不改映射 |
| MED | preventDefault 不隔離其他 listener（側欄 ⌘/Ctrl+B 快捷鍵仍會觸發）；「錄製中點欄位」行為未定 | **收**：capture 階段掛 `window` 並同時 `stopPropagation()`，錄製 10 秒內頁面其他鍵盤 listener 不收事件；驗收加「錄製中按 Ctrl+B 側欄不動、取消後恢復」 |
| MED（消融） | `snapshot 非空` 額外守衛可刪：已追蹤鍵放到 held 空時必已有 snapshot | **收**：刪 |
| MED（消融） | macOS 正式啟用可刪 | **收**：同 HIGH 1 |
| LOW | `acceptCapture` 未定義；i18n key 是 `mainApp.upgradeNotice`；`PRESET_DOM_CODES` 未 export 但有 `isPresetEquivalentKey`；F23 禁錄 | **收**：直接接既有 handler；key 名修正；修飾鍵判斷用 `isPresetEquivalentKey`；F23 不在表中 → 查無鍵碼即忽略（與 Rust 明文禁錄一致），補測試 |

codex 另確認：更簡替代（自動 blur 視窗、Rust 接 WebView2 `AcceleratorKeyPressed`）都不比限 Windows 的 DOM 補救簡單；Tauri 事件維持經 `useTauriEvents`，DOM 直接 callback 合規；鍵碼處理留在 composable，不增加 view→lib 依賴。

## 計劃閘結果（2026-09-12，codex 唯讀審查，二輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 限 Windows＋blur 清空仍沒關掉「少看一顆鍵卻先完成」：開始錄製 → 切走 → 在外面 Ctrl↓ → 按住切回 → K↓，DOM 只看到 K、先存單 K；hook 看到 Ctrl+K 卻晚到 | **收，設計改**：window blur 時 DOM 來源**本輪直接停用**（卸監聽、清狀態），不自動恢復；hook 繼續。下一次按「錄製」才重新啟用 DOM。只看過半段手勢的來源不再競逐終態 |
| MED | requestId 守衛漏了 `start_hotkey_recording` 的 catch（A 的 start 尚未返回 → DOM 完成 A → 開始 B → A 的 start reject 會取消 B）；不接受跳過接線測試，交錯序列 macOS 手動連按排不出來 | **收，結構改**：把錄製流程（`isRecording`、requestSeq、timeout、Tauri listener、DOM 來源、start／stop）從 SettingsView 抽成 `useHotkeyRecordingSession` composable，契約＝**每輪最多一個終態回呼**（captured／rejected／timeout／startFailed），晚到與舊輪一律丟。catch 也驗當輪身分。接線測試改測這個 composable：mock `invoke` 與 `listenToEvent`（可控 Promise）＋ fake timers，不掛載 SettingsView |
| MED | DOM code→VK 固定表在 AZERTY 會存錯鍵（`KeyQ`→VK_Q，hook 收 VK_A）；這是本卡**新增**的「成功但存錯」路徑，不能用 pre-existing 關閉；NumpadEnter 可延期 | **收，最小修**：Windows 字母／數字鍵的 VK 直接由 `e.key` 推（VK_A..Z＝'A'..'Z' 字元碼、VK_0..9＝'0'..'9'），天然跟鍵盤配置走；其他鍵沿用 code 表。標點符號（VK_OEM_*）與 NumpadEnter 列邊界 |
| MED | 錄製中用滑鼠開對話框：第一下 ESC 只取消錄製、Tab 會被錄成鍵而非導覽 | **明示跳過（P2）**：只在使用者自己 10 秒錄製中又去點對話框才發生；Tab 被錄成鍵與 hook 路徑（視窗沒焦點時）行為相同，ESC 第二下即關對話框，不是新的失敗類型。措辭縮：只保證側欄 Ctrl+B 這類 bubble 階段 listener 不收，其他 capture listener 不在保證內 |
| MED（消融） | blur 清 snapshot 可刪（清 held 即足） | **因 HIGH 處置消失**：blur 改為整個停用來源（等同 `stop()`），沒有單獨的清 snapshot 動作 |
| LOW | 「鏡像 Rust」不精確：Rust 一般鍵路徑沒排除 autorepeat；`stop()` 卸監聽不能靠純狀態機測試證明 | **收**：`repeat` 規則整條刪掉——修飾鍵 repeat 已被「已在 held 則忽略」吃掉，一般鍵第一下 down 就結束錄製，repeat 到不了。stop／事件隔離測試歸掛載層（jsdom 對 window 派發事件） |

codex 另確認：Windows 八顆左右修飾鍵兩端都有對應，沒有等同 macOS Fn 的必然不可見修飾鍵；真實 keyup 先到、blur 後到不是錯誤；WebView2 失焦前是否補送非實體 keyup 未證實，不據猜測加守衛，列 Windows 實測項。

## 計劃閘結果（2026-09-12，codex 唯讀審查，三輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | DOM 在 Tauri listener 註冊完（非同步）才掛，等待期間切走→外面 Ctrl↓→按住點回→K↓，DOM 沒看到 blur 也沒看到 Ctrl↓，仍先完成單 K | **收，設計改**：DOM 來源在 `start()` **第一行同步掛上**（它不依賴 Tauri listener），blur 從按下「錄製」那一刻就在監聽；起始 `document.hasFocus()` 為 false 也不掛。DOM 若在 Rust 尚未 start 前就完成，終態流程照走（`cancel_hotkey_recording` 對未錄製的 Rust 是 no-op），晚到的 listener 註冊由 requestId 自卸 |
| MED | `e.key` 推 VK 沒定義 AltGr／IME 退路：`code=KeyQ, key="Process"` 退回 code 表又存錯；只忽略該 down 也不對（稍後放修飾鍵會錄成單修飾鍵） | **收**：字母／數字位置（`Key[A-Z]`／`Digit[0-9]`）但 `key` 不是單一 ASCII 字母／數字（`Process`、`Dead`、AltGr 字元、非拉丁字元）→ **本輪停用 DOM、交回 hook**，不猜表。Shift 大寫已由轉大寫處理；Ctrl+字母的 `key` 依 W3C 仍是字母。其他位置（F-keys、方向鍵、標點）沿用 code 表。補大小寫、Ctrl+字母、AltGr、`Process` 四條測試；邊界表「與 hook 一致」縮成「字母／數字一致」 |
| MED | 終態順序可接受，但要明訂：本地終止（`isRecording=false`、卸監聽、清 timer）**同步完成再回呼**；stop 當下尚未取得的 unlisten 不能靠清單卸，晚到的註冊必自卸且不啟動 DOM／Rust；取消 IPC 的完成不改新輪狀態 | **收**：寫進 B 契約；驗收 2 加三條：「註冊未完成便 stop／start B，A 註冊才完成→自卸、不啟動」、「captured 與 rejected／timeout／startFailed 交錯→只一個」、「終態回呼內立刻 start B→B 正常一輪」 |
| MED（消融） | `timeoutMs` 對外參數可刪（只有固定 10 秒） | **收**：模組內常數 |
| LOW | macOS 強開 DOM 手測會混用兩套鍵碼（字母分支固定產 Windows VK） | **收**：該手測只驗事件隔離與回呼次數；payload 正確性由單測（固定 Windows user agent）與 Windows 實測承接 |

codex 另確認：二輪 MED 3 延期可接受（「第二下 ESC 必關對話框」不當保證）；session 抽取可保留、維持單一用途；其餘新機制皆有具體 AC 對應，不列可刪。

## 計劃閘結果（2026-09-12，codex 唯讀審查，四輪）

| 級別 | finding | 處置 |
|---|---|---|
| MED | 停用規則也涵蓋美式鍵盤的 Shift＋數字（`Digit2` 的 `key="@"`），不只 AltGr／IME；不會存錯鍵，但邊界比描述廣 | **收，邊界明列**：QWERTY 的 Shift＋數字位置也不支援 DOM 補錄（交回 hook）；補 `ShiftLeft↓ Digit2↓（key="@"）` → 停用、之後 `ShiftLeft↑` 無輸出的測試。不退回位置表猜 VK |
| MED | 驗收 2「Rust start 不被呼叫**或**其結果被忽略」容許違反契約 | **收**：拆成兩條時序——① DOM 在 listener 註冊完成前終結 → 註冊回來自卸、Rust start **零次**；② Rust start 已發出後 DOM 才終結 → 同步本地清理、發 cancel、晚到 resolve／reject 不影響新輪 |

## 實作閘結果（2026-09-12，codex 唯讀審查 working-tree，一輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | `Promise.all` 兩個 listener 註冊一成一敗：成功者沒進清理清單、不呼 `onStartFailed`、沒 timeout，`isRecording` 卡 true；手動 stop 或開 B 也回收不到 | **已改**：每個註冊 `.then(adopt)` 各自歸屬當輪（仍當輪→進清單，否則自卸）；改 `Promise.allSettled`，任一 rejected → 走同一終態 `onStartFailed`。補測試：一成一敗兩種順序、A 註冊失敗後開 B 而 A 的成功註冊才回來 |
| MED | 測試缺口：listen mock 不能 reject；測試結束 B 仍在錄製、teardown 沒 stop；缺 captured／rejected 互競與對活動中 session 再 start；`Digit1 key="&"` 只測映射 | **已補**：mock 加 reject 控制；teardown 停掉所有 session；補互競兩種順序、活動中再 start、終態回呼入口斷言本地狀態／listener／timer 已清、`Digit1 "&"` 完整序列 |
| MED（消融） | `keycodes.length === 0` 守衛不可達（snapshot 只來自修飾鍵 down，八顆都有 VK） | **已刪** |

codex 另確認：正常路徑 finish→terminate→callback 順序正確；狀態機與掛載層符合計畫；SettingsView 兩處既有 stop、模板綁定保留、無孤兒 import；日誌前綴符合診斷白名單、不含輸入內容。

## 要解決什麼

**症狀**：Windows 使用者按「錄製」後，若 SayIt 設定視窗仍是前景視窗，按任何鍵都錄不到，10 秒後逾時；要先點到別的視窗再按才錄得到（#70 cruelforever 9/11 留言；#78 AmberCTW 一鍵回報日誌）。

**證據（#78 日誌，兩輪）**：只有 `recording: started` → `timeout fired`，中間**沒有任何** `recording: vk=…` 行、也沒有 lock busy。也就是全域鍵盤 hook 在 SayIt 視窗有焦點時**完全沒收到事件**。這與 #30（收到但判錯，v0.14.0 已修）是兩個不同的病。

**本卡不追 hook 為何收不到**（WebView2 焦點下 LL hook 的行為、hook 執行緒訊息泵等）。理由：無論根因為何，SayIt 視窗有焦點時一般按鍵（字母、數字、修飾鍵）會以 `keydown`／`keyup` 進到 WebView，這是最短的路；有 OS／WebView 預設動作的特殊鍵不在承諾內（見邊界）。hook 路徑維持不動，仍服務「視窗沒焦點」的錄製與所有觸發。

## 三問

1. **生產者**：每一位在設定頁按「錄製」後直接按鍵的 Windows 使用者（最自然的操作），每次必現；已有兩位回報者＋同事。
2. **會 fire 嗎**：#78 的情境是「視窗有焦點、按 Alt+Z／右 Alt＋右 Ctrl」→ 這些鍵會進 DOM → 本卡的監聽器就在那時掛著。
3. **砍什麼**：不砍。hook 路徑保留（無焦點時仍是唯一來源）。

## 方案

### 一句話

**Windows 上**錄製期間，設定頁同時聽 DOM `keydown`／`keyup`；用與 Rust `RecordingState` **同一套規則**把鍵序變成 `RecordingCapturedPayload`，餵進既有的 `handleRecordingCaptured`。hook 與 DOM 誰先抓到誰算，另一個丟掉。

### 為什麼放前端、不放 Rust

- Rust 端沒有「視窗有焦點時的鍵盤事件」可用（那正是壞掉的來源）；Tauri 在 WebView 有焦點時鍵盤事件本來就進 DOM。
- 不需要新 IPC：payload 形狀沿用 `RecordingCapturedPayload`（`keycode`、`modifiers`、`chordKeycodes`），保存邏輯沿用 `saveComboTriggerKey`／`saveCustomTriggerKey`。
- **只在 Windows 啟用**（計劃閘 HIGH 1）：macOS 的 CGEvent tap 不受焦點影響、沒有這個病；且 DOM 看不到 Fn，兩源並發時 DOM 會搶先存錯鍵。SettingsView 已有 `isMac` 判斷，多一個條件即可。

### A. 新 composable `src/composables/useDomHotkeyRecorder.ts`

純前端、無 Tauri 依賴。分兩層：

**A1. 純函式狀態機（可測）** — 鏡像 Rust `RecordingState`：

```
state = { held: string[] (DOM code，左右分開), snapshot: string[] }

onKeyDown(code, key):
  code === "Escape"          → 回 { kind: "rejected", reason: "esc_reserved" }
  code 是修飾鍵 且 已在 held → 忽略（autorepeat 的 down 自然落在這裡）
  code 是修飾鍵              → held.push(code); snapshot = [...held]
  code 是一般鍵              → 回 { kind: "captured", payload: {
                                  keycode: windowsVk(code, key),
                                  modifiers: flagsFromCodes(held)  // 左右去重成家族旗標
                                  chordKeycodes: [] } }
                               （windowsVk 查無 → 忽略，繼續錄）

windowsVk(code, key) → number | null | "unresolvable":
  code 是 Key[A-Z]／Digit[0-9]（字母／數字位置）：
      key 是單一 ASCII 字母    → 'A'..'Z' 的字元碼（VK_A..VK_Z；大小寫都轉大寫，Ctrl+字母的 key 仍是字母）
      key 是單一 ASCII 數字    → '0'..'9' 的字元碼（VK_0..VK_9）
      其他（"Process"、"Dead"、AltGr 字元、非拉丁字元）→ "unresolvable"：本輪停用 DOM、交回 hook
  其他位置（F-keys、方向鍵、標點、Space…）→ getPlatformKeycode(code)（既有 code 表；查無 → null → 忽略）
onKeyUp(code):
  code 不在 held             → 忽略（錄製前就按住的鍵不算；失焦期間漏掉 down 的鍵也不算）
  從 held 移除；若 held 變空 →
      snapshot.length ≥ 2   → captured { keycode: 最後一顆, modifiers: [], chordKeycodes: snapshot 映射平台鍵碼 }
      snapshot.length == 1  → captured { keycode: 那一顆, modifiers: [], chordKeycodes: [] }
onBlur():                    → 本輪停用 DOM 來源（等同 stop()：卸監聽、清 held／snapshot），不自動恢復
```

修飾鍵判斷用既有 `isPresetEquivalentKey(code)`（`ShiftLeft/Right`、`ControlLeft/Right`、`AltLeft/Right`、`MetaLeft/Right`；不含 CapsLock）。家族旗標映射：Shift→`shift`、Control→`control`、Alt→`option`、Meta→`command`（Win 鍵歸 `command`，與 Rust `modifier_family_windows` 一致）。查無平台鍵碼的 code（含 F21+、F23 Copilot 鍵）一律忽略，與 Rust 明文禁錄 F23 一致。

**A2. 掛載層** — `start(callbacks)`／`stop()`：`start()` 先檢查 `document.hasFocus()`，沒焦點就不掛、直接回 false；有焦點才在 `window` 掛 `keydown`／`keyup`（capture 階段）與 `blur`。鍵盤事件一律 `preventDefault()` ＋ `stopPropagation()`（錄製期間按鍵不打進頁面；bubble 階段的鍵盤 listener 如側欄 Ctrl+B 不收到；其他 capture listener 不在保證內），把 A1 的結果丟給 `onCaptured`／`onRejected` 回呼。`blur` 與 A1 回 `"unresolvable"` 時直接呼叫 `stop()`（本輪停用、不恢復）。`stop()` 卸三個監聽並清狀態，可重複呼叫。

### B. 錄製流程抽成 `useHotkeyRecordingSession`（計劃閘二輪 MED 1）

新 composable `src/composables/useHotkeyRecordingSession.ts`，把 SettingsView 今天的 `isRecording`／`recordingRequestSeq`／timeout／Tauri listener／start／stop 搬進來，並接上 A 的 DOM 來源：

```
useHotkeyRecordingSession({
  enableDomSource: boolean,          // SettingsView 傳 !isMac；10 秒逾時為模組常數
  onCaptured(payload), onRejected(payload), onTimeout(), onStartFailed(err),
}) → { isRecording: Ref<boolean>, start(): Promise<void>, stop(): void }
```

契約：**每輪最多一個終態回呼**。`start()` 同步做：取新 requestId、`isRecording=true`、若 `enableDomSource` 則**立刻** `domRecorder.start()`（三輪 HIGH：blur 從這一刻就在聽；沒焦點則不掛）；然後才 `await` 掛 Tauri listener（既有 `listenToEvent`）→ 回來若已不是當輪則自卸、不啟動 Rust → `invoke("start_hotkey_recording")` → 成功且仍當輪才掛 timeout；catch 也只在仍當輪時才終止並回 `onStartFailed`。四種終態進入前都先檢查 `isRecording && requestId === seq`，通過即**同步**完成本地終止（`isRecording=false`、卸已取得的 Tauri listener、`domRecorder.stop()`、清 timeout、發出 `invoke("cancel_hotkey_recording")` 不等待），再呼回呼；回呼內可立刻 `start()` 開新輪。晚到的（另一來源、舊輪 callback、舊 timeout、舊 start 的 resolve／reject、舊 listener 註冊完成）全部被擋或自卸；取消 IPC 的完成不改任何狀態。

SettingsView 只剩：`const session = useHotkeyRecordingSession({... onCaptured: handleRecordingCaptured, onRejected: handleRecordingRejected, onTimeout: 既有逾時提示, onStartFailed: 既有錯誤提示 })`；`handleRecordingCaptured`／`handleRecordingRejected` 的保存與提示邏輯不動（開頭的 `stopKeyRecording()` 呼叫改為不需要，session 已先停）。模板的 `isRecording`／`startRecording`／`stopKeyRecording` 改指 session。

DOM 的 ESC 走 `onRejected({ reason: "esc_reserved" })`，訊息與 Rust 一致。錄製中既有的「請放開所有鍵」提示不變。

### C. 不動的部分

Rust 全部不動；IPC 契約不動；設定持久化不動；一般鍵（非錄製）路徑不動。

## 邊界（明列、不擴）

| 情境 | 行為 | 理由 |
|---|---|---|
| macOS（任何情境） | DOM 來源不啟用，全由 hook | tap 不受焦點影響；DOM 看不到 Fn，並發會搶先存錯鍵 |
| Windows 上按 Fn | 本來就不是 VK，兩邊都抓不到 | 既有行為 |
| Win 鍵、單 Alt、Alt+F4、PrintScreen、F-keys 等有 OS／WebView 預設動作的鍵 | 只承諾「能送達 DOM 的鍵補得上」；這些鍵能否完整收到 down/up 由 Windows 實測決定 | 計劃閘 MED 1：DOM 取消事件不等於攔截 OS |
| 錄製中切走視窗（window blur） | DOM 來源本輪停用；hook 接手到逾時或錄到為止。切回後在視窗內按鍵不會被 DOM 錄（要重按「錄製」） | 只看過半段手勢的來源不能競逐終態（計劃閘二輪 HIGH） |
| 非 QWERTY 配置在視窗內錄字母／數字 | 由 `e.key` 推 VK，字母／數字與 hook 一致；`key` 不是 ASCII 字母／數字（IME、AltGr、Dead）→ 本輪停用 DOM、交回 hook | 計劃閘二輪 MED 2、三輪 MED 1 |
| 錄製開始時視窗已沒焦點 | DOM 不掛，全由 hook | 三輪 HIGH |
| 非 QWERTY 配置在視窗內錄標點（VK_OEM_*） | 沿用 code 表，可能與 hook 不同 | 邊界；尚無回報 |
| Shift＋數字位置（QWERTY `Shift+2` 的 key="@"） | 數字位置但 key 非數字 → 本輪停用 DOM、交回 hook；不存錯鍵 | 四輪 MED 1 |
| NumpadEnter | 表中缺席 → DOM 忽略；點到別的視窗仍可由 hook 錄 | 延期（codex 同意） |
| 錄製中點頁內其他欄位 | 仍在錄製、下一鍵照錄（頁內焦點切換不是 window blur） | 10 秒明確錄製模式，可接受 |
| 錄製中用滑鼠開對話框 | 第一下 ESC 取消錄製、第二下關對話框；Tab 會被錄成鍵 | 明示跳過：與 hook 路徑行為相同，非新失敗類型 |
| 錄製前已按住 Ctrl、開始錄製後放開 | keyup 不在 held → 忽略 | 與 Rust 一致 |
| Escape | 拒絕、訊息 esc_reserved | 與 Rust 一致 |

## 改動清單

| 檔案 | 改什麼 |
|---|---|
| `src/composables/useDomHotkeyRecorder.ts`（新） | A1 純函式（`createDomRecordingState`）＋ A2 掛載層 |
| `src/composables/useHotkeyRecordingSession.ts`（新） | B：錄製流程與終態契約（從 SettingsView 搬出） |
| `src/views/SettingsView.vue` | 換用 session；刪搬走的 ref／seq／timeout／listener 碼 |
| `tests/unit/dom-hotkey-recorder.test.ts`（新） | 純函式＋掛載層測試（驗收 1） |
| `tests/unit/hotkey-recording-session.test.ts`（新） | 終態契約測試（驗收 2） |
| `docs/community-commitments.md` | 發版時：#78 新行、#70 更新 |
| `CHANGELOG.md`、五語系 `mainApp.upgradeNotice` | 發版時 |

預估 diff：兩個 composable ~200 行、SettingsView −90／+25 行、測試 ~200 行。

## 驗收

1. **純函式測試（Vitest）**，鍵序與 Rust 測試同組，斷言 payload：
   - `ControlLeft↓ KeyC↓` → keycode=C、modifiers=[control]、chord=[]
   - `ControlRight↓ ControlRight↑` → 單鍵 ControlRight、modifiers=[]
   - `AltRight↓ ControlRight↓ AltRight↑ ControlRight↑`（及反序放開）→ chord=[AltRight, ControlRight] 平台鍵碼
   - `ControlLeft↓ AltLeft↓ ControlLeft↑ KeyK↓` → K、modifiers=[option]（先放的不算）
   - `ControlLeft↓ AltLeft↓ ControlLeft↑ AltLeft↑` → chord 兩顆（snapshot 取自最後一次 down）
   - 錄製前按住：`ControlLeft↑`（未 down）→ 無輸出
   - 修飾鍵 autorepeat（同 code 連續 down）→ snapshot 不變、和弦成員不增
   - AZERTY 反例：`code=KeyQ, key="a"` → VK_A（0x41）；`code=KeyQ, key="A"`（Shift）→ 0x41；`code=Digit1, key="1"` → 0x31
   - 無法定 VK：`code=KeyQ, key="Process"`（IME）／`key="@"`（AltGr）／`key="Dead"` → 本輪停用 DOM（之後放修飾鍵無輸出）
   - `code=Digit1, key="&"`（AZERTY 數字列未 Shift）→ 停用 DOM（數字位置但 key 非數字）
   - `ShiftLeft↓ Digit2↓（key="@"）` → 停用 DOM；之後 `ShiftLeft↑` 無輸出
   - `ControlLeft↓ ControlLeft↑ ShiftLeft↓ ShiftLeft↑` → 兩次各自單鍵（放 Ctrl 後加 Shift，snapshot 重取）
   - `Escape↓` → rejected esc_reserved
   - 查無平台鍵碼的 code（`F23`、`NumpadEnter`）→ 忽略、狀態不變
   - 掛載層（jsdom 對 window 派發事件）：`document.hasFocus()` 為 false 時 `start()` 不掛監聽；`ControlLeft↓ blur KeyK↓` → 無輸出（blur 後本輪停用）；`ControlLeft↓ blur ControlLeft↑` → 無輸出；`stop()` 後再送 keydown → 無輸出；keydown 的 `defaultPrevented` 為 true、bubble 階段 listener 收不到
2. **終態契約測試（`useHotkeyRecordingSession`，mock `invoke`／`listenToEvent`、fake timers）**：
   - Tauri captured 與 DOM captured 兩種先後順序 → `onCaptured` 各只呼叫一次
   - 雙來源 ESC → `onRejected` 一次
   - A 完成後立刻 start B，A 的 start 才 resolve → B 不被掛上 A 的 timeout；A 的 start 才 reject → B 不被取消、`onStartFailed` 不呼叫
   - 舊輪 Tauri callback 在 B 開始後到達 → 丟棄
   - timeout → `onTimeout` 一次且 `cancel_hotkey_recording` 被呼叫
   - `enableDomSource=false` → 不掛 window 監聽
   - `start()` 呼叫當下（尚未 await）DOM 監聽已掛上
   - ① DOM 在 listener 註冊完成前終結 → `onCaptured` 一次；註冊回來自卸；`start_hotkey_recording` **零次**
   - ② Rust start 已發出、DOM 才終結 → 同步本地清理、`cancel_hotkey_recording` 一次；A 的 start 晚到 resolve／reject 不影響新輪 B
   - 註冊未完成便 stop／start B，A 的註冊才完成 → A 的 listener 自卸、不啟動 Rust、B 正常
   - captured 與 rejected／timeout／startFailed 任一交錯 → 只一個終態回呼
   - 終態回呼內立刻 `start()` → B 正常完成一輪
   另加 macOS dev 手動（本機暫時把 `enableDomSource` 改為 true，**不入 commit**）：只驗事件隔離（錄製中按鍵不打字、⌘+B 側欄不動）與「已設定」提示只出現一次；鍵碼正確性不在此驗（字母分支固定產 Windows VK）。
3. **dev 實機**（同上暫時啟用）：視窗有焦點錄單鍵／Combo／和弦／ESC 各一次；錄製中按鍵不打字進頁面；錄製中按 ⌘/Ctrl+B 側欄不動、取消錄製後恢復。
4. **Windows 實測（發版後，AmberCTW／同事）**：在 SayIt 視窗內直接按 Alt+Z、右 Alt＋右 Ctrl 能錄到；點到別的視窗再按也仍能錄到（hook 路徑未壞）。
5. `pnpm test`、`npx vue-tsc --noEmit`、`eslint` 全綠；Rust 無改動。
