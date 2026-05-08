# Deferred Work

從 spec / code review 中蒐集到、確認過但選擇不在當下處理的事項。每筆需含：來源、發現、為何延後、後續再處理時的切入點。

## 來自 spec-gh-35-preserve-clipboard.md（2026-05-08）

### 1. 還原視窗 200ms 內的併發競爭

- **發現**：OFF 模式下，`paste_text` 會在貼上後等 200ms 再還原快照。這 200ms 內若使用者按 Cmd+C 或 clipboard manager（Maccy / 1Password / Ditto / Paste 等）寫入，新內容會被快照覆蓋。
- **延後理由**：spec 討論時已認為這是已知 trade-off；實務上 200ms 視窗極短、發生機率低；解決需要「比對寫入時間戳」的邏輯，跨平台複雜度高。
- **後續切入點**：若有使用者實際回報，`clipboard_paste.rs` 的還原邏輯可在 set_text 前先讀目前內容，比對是不是我們寫入的轉錄文字才動手；只是「讀取剪貼簿」本身也是非原子的，仍有 TOCTOU 視窗。

### 2. `set_text(&text)` 寫入失敗時 `?`-propagate 跳過 restore

- **發現**：步驟 2 的 `clipboard.set_text(&text)?` 若失敗會直接返回，跳過後續 step 5 的還原。理論上若是「部分寫入」，使用者的原始剪貼簿就遺失。
- **延後理由**：arboard 在 macOS（NSPasteboard）和 Windows（OpenClipboard / SetClipboardData）的寫入是原子的，部分寫入是理論風險；實作 fallback restore 路徑會增加程式碼複雜度但收益極低。
- **後續切入點**：若未來換掉 arboard 或加入第三平台支援，重新評估這個 path。

### 3. 並發 `paste_text` 呼叫互相干擾

- **發現**：兩個 `paste_text` 重疊執行時（toggle 模式下快速連發、或 paste-during-correction-flow），call A 的 snapshot 可能撈到 call B 寫入的轉錄文字當「原內容」，最終剪貼簿落在錯的內容。
- **延後理由**：現行設計對單次熱鍵觸發是安全的，並發場景需要全域 mutex 才能解；spec 沒有列為硬性需求。
- **後續切入點**：在 `FocusState` 旁邊加一個 `Arc<Mutex<()>>` paste guard，paste_text 入口先 lock；或在前端 store 層做去重。

### 4. clipboard handle 跨長 sleep 的安全性

- **發現**：`paste_text` 拿一次 `Clipboard::new()` handle 跨 50ms + paste + 200ms 共約 250ms+ 才用來還原。arboard 在 macOS 偶有 pasteboard handle 失效跨長間隔的個案。
- **延後理由**：實測尚未觀察到失效；分配新 handle 的成本不高但增加幾行程式碼，效益尚不確定。
- **後續切入點**：若還原 log 出現「Failed to restore clipboard」高頻率錯誤，把還原段改為 `Clipboard::new()` 重新拿 handle。

### 5. Boolean toggle 設定的 `saveXxx` 函式與 load/refresh blocks 高度重複

- **發現**：`useSettingsStore.ts` 已累積 4+ 個結構相同的 boolean toggle 儲存函式（`saveMuteOnRecording` / `saveSoundEffectsEnabled` / `saveSmartDictionaryEnabled` / 本次新增的 `saveCopyTranscriptionToClipboard`）。每個都是 `load → set → save → ref.value = val → emit SETTINGS_UPDATED → catch+captureError+throw`，約 25 行。對應的 load 與 refresh blocks 也成對重複。
- **延後理由**：抽 `createBooleanSettingSaver(key, ref, step)` factory 屬於跨 setting 的廣泛重構，已超出 issue #35 範圍；此 PR 加 1 個 toggle 的成本可接受。
- **後續切入點**：未來再加第 5 個 boolean toggle 時是抽出 factory 的最佳時機。

### 6. SettingsView 的 Switch + 雙描述 + feedback transition 已是可抽元件的模板

- **發現**：`mute-on-recording`、`sound-feedback`、本次新增的 `copy-transcription-to-clipboard` 三個區段是 35–40 行的逐行同形複製（差別只在某個用 `descriptionOn/Off`，其他用單一 description key）。
- **延後理由**：抽 `<SettingsToggleRow>` 元件需設計合理的 props 接口，且影響其他既有區段的測試；不在 #35 的範圍。
- **後續切入點**：抽元件時把雙描述當預設能力（吃 `descriptionOn/Off`），單一描述當降級用法。

### 7. IPC 參數的反向布林命名 `restoreClipboard: !isCopyTranscriptionToClipboardEnabled`

- **發現**：`useVoiceFlowStore.ts` 第 759 行需要做 negation 把 store 的「複製到剪貼簿」翻譯成 Rust 的「還原剪貼簿」；20+ 個 vitest 期望變成 `restoreClipboard: false`，閱讀時得做心智反轉。
- **延後理由**：把 store 欄位重新命名（例如改成 `isPreserveClipboardEnabled`）會擴散到整個 Settings UI、i18n 文案、5 個語系字串，且使用者已經拍板過「將轉錄文字複製到剪貼簿」這個 UI 文案，store 欄位名與其同義是合理的；現行翻譯成本是單點。
- **後續切入點**：若這個翻譯點未來成為 bug 來源，考慮改 Rust 的 IPC 參數名為 `keepInClipboard`（語意正向），這樣兩端都不需 negation。

### 8. 既有 `🔴🔴🔴 paste_text CALLED` debug println 在 release build 持續輸出

- **發現**：`clipboard_paste.rs` 的 `paste_text` 入口有一行非 `cfg(debug_assertions)` 包覆的 println，會在 release build 持續打到 stdout。
- **延後理由**：此 println 是 baseline 既有程式碼，非本 story 引入；且在 Tauri app 中 stdout 通常被 OS 吞掉。屬於既有 tech-debt。
- **後續切入點**：未來做 logging 統一改造時一併處理（`tracing` crate 整合）。
