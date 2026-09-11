# 計畫：Windows 自家模擬按鍵打斷 Ctrl 觸發鍵（v0.12.1 修復）

> 建立：2026-09-11 · 狀態：codex 計劃閘一輪（1 HIGH、5 MED、1 LOW；HIGH 由使用者拍板乙案、其餘全收）＋實作閘一輪（0 HIGH、1 MED、1 LOW，全收）→ 待 commit 與發版 · 排程：v0.12.1（插隊在 v0.13 之前）

## 實作閘結果（2026-09-11，codex 唯讀審查 working-tree diff）

| 級別 | finding | 處置 |
|---|---|---|
| MED | 驗收 5 寫成「最後一鍵放開才停」，但既有組合鍵語意是主鍵放開即停；且沒覆蓋計劃閘第 3 條的序列（持續按住、探測後放開其他非組合鍵） | 已改：驗收 5 改為「按住 Ctrl+K、探測後按放其他鍵不停止；放開 K 才停」，不擴改 Combo 邏輯 |
| LOW | 測試註解把漏標 C／V 也寫成 Ctrl 誤觸發；hook 沒有單獨判 0 | 已改註解 |

codex 另確認：四個 INPUT 與原碼逐欄位等價、`cbSize` 正確；守衛位置在 F23 之後、任何共享狀態改動之前；`0x5341_5949` 在 32／64 位元皆可表示；union 寫入與測試的 unsafe 合理；消融：記號測試會在漏填任一項時變紅、builder 有測試用途、無可刪機制；每個改動塊都追得回計畫。

## 實作紀錄（2026-09-11）

- `clipboard_paste.rs`：`SAYIT_INJECTED_EXTRA_INFO = 0x5341_5949`；`build_ctrl_chord_inputs(key)` 組四個 INPUT 並全帶記號，copy／paste 改呼叫它；Windows 專用測試一條（記號非零、C 與 V 各四個 INPUT 都帶）。兩處 `format!` 改內插寫法：該行落在重寫區塊內，Windows clippy 探針以 `-D warnings` 報 `uninlined_format_args`
- `hotkey_listener.rs`：`hook_proc` 在 F23 放行之後加記號放行，五行
- `.claude/rules/windows.md`：加一條「自家 SendInput 一律帶記號、不要改成過濾 LLKHF_INJECTED」
- 驗證：macOS `cargo clippy -D warnings` 與 `cargo test`（101 條）綠；本機沒有 MSVC 標頭、整個 app 交叉編譯在 ring 的 C 程式碼失敗，改把改動的兩段抽進只依賴 `windows` 0.61.3 的探針專案，對 `x86_64-pc-windows-msvc` 跑 `cargo clippy --all-targets -- -D warnings` 綠（型別、union 欄位寫入、`VIRTUAL_KEY` Debug 都確認）。Windows 測試本身要等 CI windows runner 跑

## 計劃閘結果（2026-09-11，codex 唯讀審查）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 驗收要「CI 產物給使用者實測」，但 ci.yml 不建安裝包、release.yml 建完就自動公開，沒有「未公開 Windows 安裝包 → 使用者驗收 → 正式發版」的路徑 | 使用者 2026-09-11 拍板**乙**：不加 workflow，審查＋CI 綠直接發 v0.12.1，發完請使用者驗，不行再出 v0.12.2。驗收 1～7、9 改為發版後實測 |
| MED | 成因對，但範圍寫過寬：注入的 `VK_CONTROL` 到低階 hook 時是 `VK_LCONTROL`（0xA2，Wine Win32 相容測試佐證），直接命中**左 Ctrl 單鍵**分支；右 Ctrl（0xA3）不匹配、Ctrl+K Toggle 不會因注入的 Ctrl↓切換。Toggle 的實際動作是「模擬 Ctrl↓ 重設按下、Ctrl↑ 切成停止」；100ms 是等剪貼簿不是 Ctrl↑ 延遲 | 收：已改寫「要解決什麼」與時序圖；受影響範圍縮為左 Ctrl 單鍵（Hold 與 Toggle）與含 Ctrl 的組合鍵 Hold（走 `GetKeyState` 路徑） |
| MED | 記號只隔離事件；`GetKeyState` 讀到的修飾鍵狀態仍被注入汙染。組合鍵 Hold（Ctrl+K）在探測完成後放開任一非主鍵，可能讀到 Ctrl 已放開而提早停止——未重現，不能斷言 | 收：不改 Combo 邏輯；驗收加「Ctrl+K Hold 探測後先放其他鍵」序列。實測失敗才改成由非自家事件維護修飾鍵狀態；不換 `GetAsyncKeyState`（hook 回呼早於非同步狀態更新） |
| MED | Toggle 驗收寫成「按住講話放開」，長按一秒會切模式；缺可消融守衛的回歸測試；Windows CI 其實有跑 `cargo test` | 收：驗收分 Hold／Toggle 兩套操作。單元測試部分收：補 `SAYIT_INJECTED_EXTRA_INFO` 非零與 copy／paste 四個 INPUT 全帶記號的 Windows 測試（純資料檢查，不需 hook）；「帶記號事件不改 hook 狀態」要把 `hook_proc` 拆成可測函式，超出 hotfix 範圍，改由實機驗收 2 覆蓋 |
| MED | 不改 `keyboard_monitor` 可接受，但理由只適用同一輪：上一輪校正監控可能還沒結束，下一輪探測的 key-down 會被它記到 | 收：「不動」段理由改寫；實體觸發鍵本來也會被記錄，不在本 hotfix 擴改 |
| MED | stash 只寫 stash／pop 不夠：九檔中有一個 untracked 計畫檔，普通 stash 不收、`-u` 又會把本 hotfix 計畫一起收走；五語系檔與 hotfix 更新摘要共用 | 收：改為限定路徑的 `git stash push -u -- <九檔>`，記 stash 名；本計畫檔先 commit；pop 後核對 |
| LOW | #76 隨 patch 版出是事實，但流程規定新功能升 minor | 收：記為版本規則例外；#76 的啟動隱藏／重開視窗列入發版 smoke test |

codex 另確認：`windows` 0.61.3 兩個 `dwExtraInfo` 皆為 `usize`；用此欄位辨識自家事件有 PowerToys Keyboard Manager 的實作佐證；守衛放 F23 判斷之後即可（維持 F23 硬規則在最前）；不推薦方案 B 或搬探測時序。消融：Ctrl 記號＋入口守衛保留；C／V 記號補 AC 6 後保留。

## 要解決什麼

v0.12.0 起，Windows 使用者觸發鍵選**左 Ctrl**（Hold 或 Toggle），每次錄音都立刻失敗：HUD 在錄音／停止之間跳動，最後顯示「未偵測到語音」。改成 Alt 就正常。2026-09-11 一位 Windows 使用者（Toggle 模式、Ctrl 觸發）實測確認。含 Ctrl 的自訂組合鍵 Hold 走另一條路徑（見計劃閘第 3 條），程式推導會受影響、未實測。右 Ctrl 與右 Alt（預設）不受影響。

**成因（左 Ctrl 已由實測對上）**：v0.12.0 為修 #70／#72，把選取文字探測搬回錄音開始的瞬間，做法是 `SendInput` 模擬 Ctrl↓ C↓ C↑ Ctrl↑。注入的 `VK_CONTROL` 到低階鍵盤 hook 時 `vkCode` 是 `VK_LCONTROL`，剛好命中 `TriggerKey::Control` 的匹配。hook 不分「人按的」和「自己送的」：

```
v0.12.0 Windows、觸發鍵 = 左 Ctrl

 Hold：   使用者 Ctrl↓ ──► hook 按下 ──► start_recording ──► SendInput Ctrl↓ C↓ C↑ Ctrl↑
                                                              hook 看到注入的 Ctrl↑ ＝ 放開 ──► stop
 Toggle： 使用者短按放開 ──► 開始 ──► start_recording ──► 注入 Ctrl↓ 重設按下、Ctrl↑ ＝ 切成停止
                                                              ▼
                                            近乎空白的音檔送 Groq ──► 「未偵測到語音」
```

v0.11.0 不受影響，因為那版只在觸發鍵放開後才送 Ctrl+C。

## 三問（配守衛前）

1. **生產者**：`capture_selected_text_via_clipboard()`（每次錄音開始）與 `simulate_paste_via_keyboard()`（每次貼上）。兩者都是 SayIt 自己送的，每次錄音必發生；已有真實使用者踩到。
2. **機制會 fire 嗎**：`KEYBDINPUT.dwExtraInfo` 原樣出現在 `KBDLLHOOKSTRUCT.dwExtraInfo`（PowerToys 同法）；自家事件必帶記號、必被放行。
3. **砍什麼**：不砍。#70／#72 的時序保留。

## 方案：自家注入事件打記號，hook 放行

| | 做法 | 為什麼選／不選 |
|---|---|---|
| **A（採用）** | `SendInput` 的每個 `KEYBDINPUT.dwExtraInfo` 填 SayIt 專屬常數；`hook_proc` 在 VK_F23 判斷之後、任何狀態處理之前，`dwExtraInfo` 等於該常數就直接 `CallNextHookEx` | 只影響 SayIt 自己送的按鍵；AutoHotkey／PowerToys 之類改鍵工具注入的按鍵仍可當觸發鍵 |
| B | hook 一律跳過帶 `LLKHF_INJECTED` 旗標的事件 | 改動更小，但改鍵工具的使用者觸發鍵會失效，等於換一群人壞掉 |
| C | Ctrl+C 搬回觸發鍵放開後 | 重開 #70／#72（`.claude/rules/windows.md` 明文：改這段時序等於重開那兩串） |

### 改動點（只有 Rust、只有 Windows 分支）

| 檔案 | 改什麼 |
|---|---|
| `src-tauri/src/plugins/clipboard_paste.rs` | 新增 `pub const SAYIT_INJECTED_EXTRA_INFO: usize`（非零常數）；`simulate_copy_via_keyboard()` 與 `simulate_paste_via_keyboard()` 的 4 個 `INPUT` 各填 `Anonymous.ki.dwExtraInfo = SAYIT_INJECTED_EXTRA_INFO`。組 INPUT 的部分抽成回傳 `[INPUT; 4]` 的小函式，讓測試能檢查四個都帶記號 |
| `src-tauri/src/plugins/hotkey_listener.rs` | `hook_proc` 在 VK_F23 放行之後加：`if kbd.dwExtraInfo == SAYIT_INJECTED_EXTRA_INFO { return CallNextHookEx(...) }`。錄音模式（自訂觸發鍵擷取）與一般模式共用這個入口，兩邊一起擋 |

### 不動

- `keyboard_monitor.rs` 的 hook：同一輪的順序成立（先 await 貼上，再啟動品質與校正監控；品質監控只認 Backspace／Delete）。跨輪影響（上一輪校正監控未結束時被下一輪探測的 key-down 記到）未驗，但實體觸發鍵本來也會被記錄，不在本 hotfix 擴改
- 組合鍵的 `GetKeyState` 修飾鍵判定：實測驗收 5 失敗才改
- macOS：CGEvent 路徑與 Windows hook 無關
- 探測時序（#70／#72 修法）、前端、任何設定

### 型別對齊

`windows` crate 0.61.3：`KEYBDINPUT.dwExtraInfo: usize`、`KBDLLHOOKSTRUCT.dwExtraInfo: usize`，直接比較。macOS 本機編不到 `#[cfg(target_os = "windows")]` 區塊，型別錯誤只會在 CI 的 windows runner 出現。

## 驗收

| # | 情境 | 操作 | 預期 |
|---|---|---|---|
| 1 | 左 Ctrl、Hold | 按住 Ctrl 講話、放開 | 正常轉錄貼上；HUD 不跳動 |
| 2 | 左 Ctrl、Toggle | 短按放開開始、講話、再短按放開停止 | 正常轉錄貼上；貼上後維持 idle、下一輪正常 |
| 3 | 左 Ctrl、編輯模式 | 先選取文字再錄音 | 改寫結果取代選取（證明 Ctrl+C 探測本身沒被擋，只有 hook 忽略它） |
| 4 | 右 Alt | 同 v0.12.0 操作 | 與 v0.12.0 相同 |
| 5 | 自訂 Ctrl+K、Hold | 按住 Ctrl+K 不放、等探測完成（約 0.5 秒）後，按下並放開一個不在組合裡的鍵（例如空白鍵），再繼續講話；最後放開 K | 中途按其他鍵不停止錄音；放開主鍵 K 才停（既有語意）。這條測的是計劃閘第 3 條「修飾鍵狀態被注入汙染」的殘留風險 |
| 6 | 自訂單鍵 C 或 V、Hold | 按住講話放開 | 自家的 Ctrl+C／Ctrl+V 不會誤觸發（C／V 記號的存在理由） |
| 7 | 瀏覽器自動貼上（#70／#72 場景） | 同該兩串 | 與 v0.12.0 相同 |
| 8 | CI | push 後 | 三個 job 綠（windows runner clippy `-D warnings` 與 `cargo test` 都過） |
| 9 | #76 smoke | 開啟「啟動時隱藏主視窗」、重開 app、從托盤叫出 | 隨版例外功能可用 |

1～7、9 需 Windows 實機：依乙案，v0.12.1 發版後由回報這次問題的使用者實測；同一位使用者順便試自訂觸發鍵（#30 累積的待驗項）。任一失敗 → v0.12.2。

## 測試

- Windows 專用單元測試（CI windows runner 會跑 `cargo test`）：`SAYIT_INJECTED_EXTRA_INFO != 0`；copy 與 paste 的四個 `INPUT` 的 `dwExtraInfo` 都等於它。純資料檢查，不碰 hook、不呼叫 `SendInput`
- 不把 `hook_proc` 拆成可測函式：超出 hotfix 範圍，「帶記號事件不改 hook 狀態」由實機驗收 2 覆蓋
- 不在 macOS 為此另抽純函式

## 發版（v0.12.1）

### 未公開 Windows 安裝包（HIGH，待拍板）

| | 做法 | 代價 | 給的保證 |
|---|---|---|---|
| **甲（推薦）** | 新增 `.github/workflows/windows-test-build.yml`：`workflow_dispatch`、可選 ref，在 windows-latest 跑 `pnpm tauri build`，把 `*-setup.exe` 用 `actions/upload-artifact` 上傳，不建 release、不碰 updater 端點 | 一支約 40 行的 workflow；每次手動跑約 10 分鐘 Windows runner | 固定 commit → 未公開安裝包 → 使用者驗收 → 才跑 release。之後 #30／#73 這類「需 Windows 實機」的卡也有路可走 |
| 乙 | 不加 workflow：靠程式碼審查＋CI 綠直接發 v0.12.1，發完請使用者驗，不行再出 v0.12.2 | 零流程改動 | 沒有發版前實測；Ctrl 使用者現在已經壞，最壞情況是多一版 |

### 其餘

- 工作樹的 v0.13 第二張（設定頁兩卡＋#71）九檔不進 hotfix：本計畫檔先單獨 commit，再 `git stash push -u -m "v0.13 settings two cards" -- <明列九檔>`；v0.12.1 發完 `stash pop`，核對九檔改動完整、v0.12.1 的更新摘要文案仍在（五語系檔兩邊都改，不同區段，預期可自動合併）
- main 已含 #76（12e4147）：**版本規則例外**（新功能本應升 minor，因已合入 main 且與修復不可分，隨 patch 版出）；changelog 與更新摘要彈窗要列它，`community-commitments.md` 的 #76 改「v0.12.1 交付」
- changelog 兩條：Windows 左 Ctrl 觸發鍵修復、#76。更新摘要彈窗五語系照 `.claude/rules/i18n.md`
- 對外：#70／#72 串補一句「v0.12.1 修了 Ctrl 觸發鍵在 v0.12.0 失效」；不承諾日期

## 閘門

小卡節流：計劃閘最多兩輪（本輪為第一輪；HIGH 拍板後不另跑第二輪，理由：HIGH 是流程缺口、與程式碼設計無關，其餘 finding 全收且無設計變更）。實作閘重點：記號是否 4 個 INPUT 都填、hook 判斷位置是否在 F23 之後、所有分支之前、有沒有多做。
