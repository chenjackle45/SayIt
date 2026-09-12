# 計畫：修飾鍵逐鍵追蹤 ＋ 兩顆修飾鍵組合觸發（#30 根因修復，v0.14.0）

> 建立：2026-09-12 · 狀態：codex 計劃閘一輪（1 HIGH、5 MED、1 LOW）＋二輪（1 HIGH、1 MED、1 LOW），全收、設計改兩次）＋三輪（0 HIGH、2 MED、1 LOW，全收）→ 實作完成 → 實作閘一輪（1 HIGH、3 MED、1 LOW，全收）＋二輪（0 HIGH、2 MED：1 收、1 明示跳過）→ **可建議 commit** · 排程：v0.14.0（功能版；ElevenLabs 順延 v0.15，待使用者確認）
> 使用者 2026-09-12 拍板：**乙、一次到位**——修 Windows 錄製根因，並支援「右 Alt＋右 Ctrl」這類純修飾鍵組合當觸發鍵；不拆成先出 v0.13.2。
> 根因與 codex 覆核結論見 `~/Documents/claude-html/2026-09/sayit-issue-30-root-cause-2026-09-12.html` 與 memory `windows-hotkey-recording-focus-bug`。

## 計劃閘結果（2026-09-12，codex 唯讀審查，一輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | macOS 用切換法推定按放，`reset_key_states`（ESC 取消錄音會呼叫）清空集合後，接下來的 up 被當成 down，狀態顛倒且不自癒；錄製前按住的鍵在錄製中放開也會被算進去 | **收，設計改**：macOS 不用純切換法，改「flag 為真相」三則（見 B）。flag 清＝整個家族全放開，每次全放開都會自癒；清空後的 up 事件因 flag 已清而成為 no-op，不再顛倒。錄製前按住 A → 錄製開始清空 → A↑ 時 flag 清 → no-op，不算進錄製。補 ESC 重設、錄製前按住、漏事件恢復三組測試 |
| MED | 一般 Combo 路徑留著 `GetKeyState` 是已知不可靠來源，「可能晚一個事件」寫得太輕 | **收，範圍擴一行**：Windows 一般路徑的 `active_modifiers` 改由 `held_modifier_keys` 映射；`is_vk_pressed`／`get_active_modifiers_windows` 整個刪除（消融：刪掉後 Ctrl↓ K↓ 觸發與「先放 Ctrl 即結束」兩條驗收會壞）。驗收加「Windows 錄完 Ctrl+C 後真的能觸發、先放 Ctrl 能結束」 |
| MED | 觸發模式整合只測純比對；Windows 打包驗證排在發版後太晚 | **收一半**：補事件層測試（Hold 首鍵放開只停一次、Toggle 短按／長按、Hold 雙擊、按住 A 重按 B、觸發後多按一顆）。Windows 發版前實測**沒有路徑**（v0.12.1 拍板乙：CI 不建安裝包、release 即公開），維持發版後同事＋回報者實測、失敗出 v0.14.1 |
| MED | 序列化只驗升級，沒交代降版 | **收**：明列只保證向後讀取；CHANGELOG 與更新摘要註明「降版前請先切回預設鍵」；不做版本化儲存 |
| MED | `saveChordTriggerKey` 鏡像 `saveComboTriggerKey` 可刪；`held ⊇ chord` 與交集相等是重複條件 | **收**：`saveComboTriggerKey` 參數型別放寬為 `ComboTriggerKey \| ChordTriggerKey`，不新增函式；比對改單一條件 `held == chord`（held 依建構只含修飾鍵碼） |
| MED | 改動清單漏 `types/events.ts` payload 型別、`refreshCrossWindowSettings`、`SettingsView` 只判 Combo 的 `currentCustomKeyDisplay` | **收**：三處補進 E；驗收加「保存後、重啟後、切預設再切回」顯示 |
| LOW | Caps Lock、Fn／Globe、雙鍵盤同鍵碼的邊界要寫準 | **收**：承諾改為「依平台鍵碼區分左右，不區分鍵盤裝置」；Caps Lock 不在修飾鍵白名單、不擴；Fn 併通則保留，macOS 實機測 Fn＋Control 和弦與單 Fn |

codex 另確認：左右模型、修飾主鍵比對、放開覆寫最後鍵、held／snapshot 分離、左右同名、重按去重六條前輪 finding 已回應；四種實機鍵序純規則重播正確；**重複 down 必須整筆忽略、不得覆寫 snapshot**（Windows 自動重複會連發 down）——已寫進 C。

## 計劃閘結果（2026-09-12，codex 唯讀審查，二輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | 「flag 為真相」三則對連續事件正確，但**清空集合**後仍無法判斷：左右同家族都按著、清空、放左邊 → flag 仍設、左鍵不在集合 → 誤判為按下；漏 up 後下一次 down 也被第三則誤判。錄製局部也會被假 down 污染（Option＋K 誤錄）。消融：「reset 清空實體集合」沒有獨立必要性、正是 HIGH 成因 | **收，設計改**：`held_modifier_keys` **永不清空**（`reset_key_states`、`start_hotkey_recording` 都不碰）；reset 只清觸發狀態，錄製只清自己的局部資料。「錄製前已按住不算」改由錄製局部承擔：錄製只消費**轉移**（本事件新增／移除了哪些鍵），移除不在局部集合的鍵是 no-op。三則保留、只面對漏事件失同步，家族全放開即校正 |
| MED | 一輪承諾的觸發模式事件層驗收（Toggle 短按／長按、Hold 雙擊、按住 A 重按 B）只在處置表，驗收清單沒落實 | **收**：驗收 1 加「事件層序列」小節，逐序列列開始／停止次數 |
| LOW | Windows 漏 up 後「下次同鍵事件恢復」不精確：重複 down 整筆忽略，所以只有收到 up 或明確 reset 才清 | **收**：措辭改「收到該鍵 up 才清」；補漏 up 重播測試；不加 Alt context 局部校正 |

codex 另確認：Windows 一般 Combo 改由集合映射成立，五條既有測試語意不變；映射須把左右去重為同一家族、在比對前完成 insert／remove；另一側同家族鍵仍按住時不應結束。

## 計劃閘結果（2026-09-12，codex 唯讀審查，三輪）

| 級別 | finding | 處置 |
|---|---|---|
| MED | 錄製端「`added` 已在局部則整筆忽略」是重複守衛：上游已只輸出實際新增、Windows 重複 down 已在上游忽略（可刪） | **收**：刪下游守衛；重複 down 驗收改從原始事件餵入、驗 snapshot 不變 |
| MED | 「按住 A 重按 B＝開始 2、停止 2」缺時間條件：快速重按會走既有雙擊分支 | **收**：該案例明定兩次間隔 > 350ms；快速重按另驗雙擊結果 |
| LOW | `removed` 契約要精確：只含原先存在且本事件移除的鍵；「reset 後 up 為 no-op」限定為觸發輸出，集合仍要更新 | **收**：B、驗收措辭修正 |

codex 另確認：五組鍵序（不同家族 reset、同家族 reset 放左、錄製前按住含同家族版本、漏 up 下一輪、Fn＋Control）在新規則下結果正確；轉移介面無「同一事件同時 added 與 removed」反例；macOS 第 1 則整家族移除時以 `removed ∩ chord ≠ ∅` 判結束、不能只看事件鍵碼；漏 up 取捨維持計畫所列。

## 實作閘結果（2026-09-12，codex 唯讀審查 working-tree diff，一輪）

| 級別 | finding | 處置 |
|---|---|---|
| HIGH | `modifier_family_macos`／`apply_macos_flags_changed` 無條件編譯，Windows 非測試目標無人使用 → `-D warnings` 紅 | **已改**：兩支加 `cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))`，與 Windows helpers 對稱；`macos_keycodes` 模組同時解除 cfg 閘（無條件函式與測試引用它）並 `allow(dead_code)`。Windows 探針 crate（切片 hook 模組＋stub）在 `x86_64-pc-windows-msvc` 目標 clippy 已不再列這三項 |
| MED | Windows 兩把鎖：第一把更新實體集合、錄製處理器第二把 `try_lock` 失敗會丟掉轉移 → 實體集合與錄製局部失同步 | **已改**：兩平台都在第一把鎖內同時更新集合並消費錄製轉移，取得 payload 後釋鎖再 emit；錄製處理器只剩一般鍵／ESC 路徑 |
| MED | 計畫承諾的事件層驗收未交付（同家族 reset 放左序列、漏 up 同鍵再 down、Fn＋Control、重複 down 不改 snapshot、Hold 開始／停止計數、按住 A 重按 B、Combo 先放 Ctrl 結束、store 載入／刷新／儲存） | **已補**：Rust 8 條（`drive_chord` 以轉移驅動計數：A↓B↓A↑B↑＝1/1、按住 A 重按 B＝2/2、多按一顆＝1/1；raw 重複 down 餵狀態機 snapshot 不變；Fn＋Control 錄製與觸發；macOS 同鍵漏 up 下一輪；reset 後同家族放左無假 down；Combo 先放 Ctrl 缺 Control）＋前端 `settings-store-chord.test.ts` 3 條（loadSettings／refreshCrossWindowSettings／saveComboTriggerKey 同步 Rust）。Hold 雙擊 350ms 與 Toggle 長按屬 `handle_key_event` 既有計時邏輯，需 AppHandle，列 macOS 實機驗收 |
| MED | 錄製端 `!held.contains` 下游去重守衛可刪（三輪處置未落實） | **已改**：直接 `extend`，去重留在上游 `apply_*` |
| LOW | CHANGELOG／更新摘要「降版前先切回預設鍵」尚未交付 | **發版前待辦**（發版準備時同步五語系） |

codex 另確認：B／C／D 純轉移邏輯與計畫一致；Windows 新簽名、呼叫與刪除項無殘留引用；Chord JSON、payload、保存／重啟／切預設再切回的顯示接線一致；五語系 key 一致；無計畫外擴張。既有取捨維持：`is_recording` 快照解鎖後仍可能過期（既有競態，非本卡新增）、首鎖失敗降級為「非錄製」與原行為相同、Windows 漏 up 殘留到該鍵 up。

## 實作閘結果（2026-09-12，codex 唯讀審查，二輪）

| 級別 | finding | 處置 |
|---|---|---|
| MED | 事件層測試沒有穿過正式分派路徑（macOS closure 的 `handle_key_event`、Windows `key_handler`、兩平台首鎖內的錄製消費）；拿掉那些接線測試仍綠 | **明示跳過（P2）**：要讓測試穿過 closure／hook 需 tauri mock runtime（`tauri` 的 `test` feature、Cargo.toml 改動）與 hook 注入重構，超出本卡範圍；接線由驗收 3（macOS 實機：錄製、和弦觸發 Hold／Toggle、ESC 後再觸發）與驗收 4（Windows 發版後實測）承接。純函式與狀態機測試保留，計畫不宣稱它們是接線驗收 |
| MED | Windows 首鎖的 `modifier_family_windows(vk).is_some()` 與 `!t.is_empty()` 重複（上游已保證非修飾鍵回空轉移），可刪 | **已改**：只留「錄製中且有轉移」 |

codex 另確認：`cfg_attr` 位置正確；兩平台皆先更新集合、同鎖消費、釋鎖後 emit，未見二次消費；`held_snapshot` 取於集合更新後、錄製消費前，錄製消費只改局部，不影響 Chord；同家族 reset、漏 up、Fn＋Control、raw 重複 down、store 載入／刷新／同步 Rust 已補。

## 要解決什麼

1. **Windows 錄製失敗（#30，chenjhchi 一鍵回報實證）**：錄製時修飾鍵的按下／放開靠 `GetKeyState` 讀「現在按著哪些」，在 hook 執行緒上讀到的是與紀錄相容的「事件前狀態」（Microsoft 文件：LL hook 回呼發生在該鍵 async 狀態更新之前；`GetKeyState` 隨呼叫執行緒讀取鍵盤訊息更新，hook 執行緒不讀鍵盤訊息）。結果：Ctrl＋C 錄成 `Custom{67}`，純修飾鍵永遠逾時。措辭依 codex：這是**與紀錄相容的模型**，不是 OS 保證；修法不依賴它——改用事件本身。
2. **「右 Alt＋右 Ctrl」當觸發鍵**：現有 `TriggerKey::Combo { modifiers: Vec<ModifierFlag>, keycode }` 的 `ModifierFlag` 不分左右，型別層就存不下；比對又要求「按著的修飾鍵集合 == 設定」，主鍵若是修飾鍵會把自己算進去。macOS 錄製用合併 flag 判斷，放開事件會覆寫「最後按下鍵」。三個 HIGH（codex 2026-09-12）。

## 三問

1. **生產者**：四位 Windows 使用者（#30 兩位、#70、同事）錄製失敗，每次錄製必現；#30 回報者明確要「右 Alt＋右 Ctrl」。
2. **會 fire 嗎**：錄製改讀事件流後，紀錄中的四種鍵序（右 Alt↓ 右 Ctrl↓ 右 Alt↑ 右 Ctrl↑／左 Ctrl↓ C↓／單右 Ctrl↓↑／單右 Alt↓↑）逐一走過狀態機都得到正確結果（見「錄製規則」表）。
3. **要砍什麼**：`GetKeyState` 兩支函式整個砍掉（錄製與一般路徑都改讀事件集合），理由是它本身就是錯的來源，不是「被新集合取代所以多餘」。計劃閘一輪把一般路徑從「列觀察」改為一併處理：多一行映射、少兩支函式。

## 方案

### 一句話

兩平台各自從**事件**維護一個「目前按著的實體修飾鍵」集合（鍵碼、左右分開）；錄製與和弦觸發都只看這個集合，不再問系統。

### A. 資料模型：新增 `TriggerKey::Chord`

```rust
// 純修飾鍵組合：≥2 顆實體修飾鍵同時按下即觸發；鍵碼為平台鍵碼（macOS CGEvent keycode／Windows VK）
Chord { keycodes: Vec<u16> },   // serde → { "chord": { "keycodes": [165, 163] } }
```

- 不改 `Combo`（修飾鍵＋一顆一般鍵）與 `Custom`：已持久化在使用者設定裡，形狀不動。
- 前端 `ChordTriggerKey { chord: { keycodes: number[] } }`、`isChordTriggerKey`；顯示名＝每顆鍵碼經既有 `getKeyDisplayNameByKeycode` 後以「+」串（右 Alt、右 Ctrl 兩平台鍵碼表都已有名稱，不加 i18n）。
- 儲存沿用 `customTriggerKey` 槽（與 Custom／Combo 同槽、互斥）；載入驗證接受 chord；儲存走既有 `saveComboTriggerKey`（參數型別放寬）。

### B. 共用狀態：`HotkeySharedState.held_modifier_keys: HashSet<u16>`

- **Windows**：`hook_proc` 在記號放行、F23 放行之後、進錄製／觸發分支之前，對 `is_modifier_vk` 的鍵依 down／up insert／remove。自動重複的 down（已在集合）整筆忽略。
- **macOS**（計劃閘 HIGH 後改為「flag 為真相」）：`FlagsChanged` 且 `is_modifier_keycode_macos(keycode)` 時，查該鍵所屬家族的 flag（Option→Alternate、Control→Control、Command→Command、Shift→Shift、Fn→SecondaryFn）：
  1. flag **清** → 該家族全部鍵碼移出集合（不只事件那顆）。每次家族全放開都以系統狀態校正，失同步自癒。
  2. flag 設且鍵碼**不在**集合 → 加入（按下）。
  3. flag 設且鍵碼**已在**集合 → 移除（左右同家族兩顆都按著、放開其中一顆；唯一需要靠集合推定的情況，下一次家族全放開即校正）。
- **永不清空**（計劃閘二輪 HIGH）：`reset_key_states()` 與 `start_hotkey_recording` 都不碰它。清空後系統的合併 flag 分不出「左鍵新按下」與「右鍵仍按住、左鍵剛放開」，清空本身就是失同步來源。唯一的失同步是漏事件：macOS 家族全放開即校正；Windows 收到該鍵 up 才清。
- **轉移輸出**：更新函式回傳本事件 `added: Vec<u16>`／`removed: Vec<u16>`，**只含實際變動的鍵**（原先不在而加入、原先在而移除；macOS 第 1 則可能一次移除多顆），錄製與和弦觸發都消費這個轉移，不各自解讀原始事件。同一事件不會同時有非空 added 與 removed。
- **Windows 一般 Combo 路徑改讀它**：`active_modifiers = flags_from(held_modifier_keys)`；`is_vk_pressed`／`get_active_modifiers_windows` 刪除。macOS 一般路徑的 `active_modifiers` 仍由 `extract_active_modifiers_macos(flags)` 取（flag 本來就是系統真相）。
- 已知取捨：Windows 漏掉 up 事件會殘留到**收到該鍵 up** 為止（重複 down 整筆忽略、不能當校正；無系統快照可用；不加 Alt context 局部校正）。殘留期間一般鍵可能誤觸 Combo，列驗收「漏 up 重播」測試記錄此行為。承諾寫法：**依平台鍵碼區分左右，不區分鍵盤裝置**；Caps Lock 不在修飾鍵白名單。

### C. 錄製規則（兩平台共用，純函式，可在 macOS CI 跑測試）

`RecordingState` 改為：`held: Vec<u16>`（按下順序、無重複）、`snapshot: Vec<u16>`（**最近一次修飾鍵按下當下**同時按著的集合）。錄製**只消費 B 的轉移**（`added`／`removed`），不讀共用集合本身：`removed` 裡不在局部 `held` 的鍵是 no-op——這就是「錄製前已按住的鍵不算」的實作。事件 → 結果：

| 事件 | 動作 | 結果 |
|---|---|---|
| 轉移 `added`（修飾鍵按下） | 加入 `held` 並 `snapshot = held`（重複 down 由 B 在上游忽略，這裡不再守衛） | 無 |
| 一般鍵 down | 非 ESC → captured `Combo{ mods = held 映射為 flag（去重）, keycode }`；`held` 空 → `Custom`；reset | captured |
| ESC down | reset | rejected(esc_reserved) |
| 轉移 `removed`（修飾鍵放開，macOS 可能多顆） | 逐顆從 `held` 移除（不在則 no-op）；若移除後 `held` 空且原本非空：`snapshot.len() ≥ 2` → captured **Chord(snapshot)**；`== 1` → captured 單鍵（既有 payload：`keycode`、`modifiers=[]`）；reset | captured |
| 一般鍵 up | 忽略 | 無 |

codex 列的邊界逐一走：Ctrl↓ Alt↓ Ctrl↑ Shift↓ 全↑ → snapshot 在 Shift↓ 時＝{Alt, Shift}，不會錄出三鍵；Ctrl↓ Alt↓ Ctrl↑ K↓ → held＝{Alt} → Alt＋K；左 Ctrl↓ 右 Ctrl↓ 左 Ctrl↑ → held 仍含右 Ctrl，不完成；同一顆重按不算兩顆；**錄製前已按住的鍵不算**：錄製局部從空起算，那顆鍵的放開在 `removed` 裡但不在局部 `held`，no-op；共用集合不清空所以和弦追蹤不受影響。畫面另提示「先放開所有鍵再按錄製」；不做快照方案。

macOS 的 Fn：keycode 63 走 B 的同一套 flag 三則（家族 flag＝SecondaryFn），不再有獨立 Fn 分支（既有「Fn 放開且無主鍵 → 單 Fn」＝通則的 `snapshot.len()==1` 情況）。

payload：`RecordingCapturedPayload` 加 `chord_keycodes: Vec<u16>`（非和弦時為空）；前端 `chordKeycodes.length ≥ 2` → 存 Chord。`.claude/rules/ipc.md` 同步。

### D. 和弦觸發比對（兩平台）

- 進入條件（轉移 `added` 含和弦鍵之後）：`held == chord`（集合相等；held 依建構只含修飾鍵碼，多按一顆修飾鍵即不等；一般鍵不管）→ `handle_key_event(true)`。Hold／Toggle／雙擊都走既有 `handle_key_event`，不另寫。
- 結束條件：轉移 `removed` 含任一和弦鍵且 `is_pressed` → `handle_key_event(false)`（另一側同家族鍵仍按住時，macOS 第 3 則只移除放開那顆；若那顆屬於和弦即結束——和弦以實體鍵碼定義，這是預期）。
- Windows：在 `hook_proc` 的 Combo 分支之前加 Chord 分支；macOS：`FlagsChanged` 分支加 Chord 判斷（現有 Combo 在 FlagsChanged 只處理結束，Chord 的開始也在這裡）。
- 純函式 `chord_transition(chord, held_after, added, removed, is_pressed) -> Option<bool>`（Some(true)＝按下、Some(false)＝放開、None＝不動），含「多按一顆不觸發」「反向順序觸發」「首鍵放開只停一次」「觸發後再多按一顆不重複觸發」測試；Hold／Toggle／雙擊沿既有 `handle_key_event`。

### E. 前端

- `types/settings.ts`：`ChordTriggerKey`、`isChordTriggerKey`、`TriggerKey` 聯集加入。
- `types/events.ts`：`RecordingCapturedPayload` 加 `chordKeycodes: number[]`。
- `lib/keycodeMap.ts`：`getChordTriggerKeyDisplayName`。
- `stores/useSettingsStore.ts`：`saveComboTriggerKey` 參數放寬為 `ComboTriggerKey | ChordTriggerKey`（不新增函式）；`customTriggerKey` ref 型別加 chord；`loadSettings` 與 `refreshCrossWindowSettings` 的驗證接受 chord；`getTriggerKeyDisplayName` 分支。
- `views/SettingsView.vue`：`handleRecordingCaptured` 先判 `chordKeycodes.length ≥ 2`；`currentCustomKeyDisplay`（只判 Combo 那支）加 chord；`currentPresetKey`、`hasCustomKey` 相關的 `isCustom || isCombo` 判斷加 chord；錄製提示補「先放開所有鍵」（五語系一條 `settings.hotkey.releaseAllHint`）。
- 降版說明：Chord 只保證新版讀舊設定；舊版 Rust 拒收新 variant、前端只記錄不回復。CHANGELOG 與更新摘要註明「降版前先切回預設鍵」。

### 不動

- macOS 一般 Combo 路徑（flag 為真相，本來就對）
- 記號放行、F23 放行、ESC、雙擊／長按、Toggle 邏輯
- `keyboard_monitor.rs`、HUD
- `Combo`／`Custom` 的序列化形狀

## 驗收

1. Rust 純函式測試（macOS CI 與 Windows CI 都跑）：
   - 錄製狀態機：紀錄中四種鍵序、codex 四種邊界、ESC、重複 down 整筆忽略、錄製前按住再放開不算
   - `held_modifier_keys` 更新：Windows down／up、重複 down 不產生 added；macOS flag 三則（左右同家族只放一顆、家族全放開校正、漏一個 up 後家族全放開即恢復）；`removed` 只含實際移除的鍵
   - `chord_transition`：齊按觸發、少一顆不觸發、多按一顆不觸發、反向順序觸發、首鍵放開只停一次、觸發後再多按一顆不重複觸發
   - Windows 一般 Combo：由集合映射後 Ctrl↓ K↓ 觸發、先放 Ctrl 即結束
   - serde：`Chord` 往返、舊 `Combo`／`Custom` JSON 仍可解
   - **事件層序列**（以轉移餵 `chord_transition` 並串 `handle_key_event` 的狀態；逐序列列開始／停止次數）：
     - Hold：A↓ B↓ A↑ B↑ → 開始 1、停止 1（B↑ 不再停止）
     - Hold 雙擊：和弦兩次快速按放 → 依既有雙擊邏輯（第二次按下提前返回）不多開一次
     - Toggle 短按：A↓ B↓ A↑ B↑ → 切換 1 次；長按超過閾值 → 依既有長按邏輯
     - 按住 A 重按 B（兩次間隔 > 350ms）：A↓ B↓ B↑ B↓ B↑ → 開始 2、停止 2；快速重按（< 350ms）→ 走既有雙擊分支，另驗
     - 觸發後再多按一顆 C：不重複開始；C↑ 不停止
     - 左右同家族（macOS）：左 Option↓ 右 Option↓ 左 Option↑ → 集合 `{右 Option}`；右 Option↑ → 空
     - 漏 up：A↓ (漏 A↑) A↓ A↑ → macOS 第二個 A↓ 被第 3 則當放開、A↑ 家族清校正為空（記錄此行為）；Windows 殘留到 A↑
     - `reset_key_states` 中途呼叫：A↓ B↓ reset A↑ B↑ → 集合照常更新回到空；觸發端因已 reset 不再輸出停止、也無假開始
     - 錄製前按住：左 Control↓ 開始錄製 左 Control↑ K↓ → 錄成 Custom(K)；同家族版本：左 Option↓ 開始錄製 右 Option↓ 左 Option↑ 右 Option↑ → 錄成單右 Option
2. 前端 vitest：`getChordTriggerKeyDisplayName`（兩平台鍵碼）、store 載入與跨視窗刷新接受 chord、`handleRecordingCaptured` 分流
3. macOS 實機（本機 `pnpm tauri dev`）：錄右 Option＋右 Control → 顯示「Right Option+Right Control」；按齊觸發（Hold／Toggle 各一次）、放一顆結束；Fn 單鍵、Fn＋Control 和弦、Fn＋K、⌘＋J 行為不變；保存後重啟、切預設再切回顯示正確；錄音中按 ESC 取消後再按和弦仍能觸發
4. Windows 打包版（v0.14.0 發版後，同事＋#30 回報者；發版前無安裝包路徑，沿 v0.12.1 拍板）：Ctrl＋C 錄成 Ctrl+C **且能觸發、先放 Ctrl 能結束**；單右 Ctrl 錄得到；右 Alt＋右 Ctrl 錄成和弦且能觸發錄音；失敗仍可一鍵回報。失敗 → v0.14.1
5. CI 三 job 綠

## 閘門

- codex 計劃閘（本檔）→ 實作 → 雙向追溯閘 → codex 實作閘 → 測試全綠 → 列檔案等 commit 授權 → 發版授權
