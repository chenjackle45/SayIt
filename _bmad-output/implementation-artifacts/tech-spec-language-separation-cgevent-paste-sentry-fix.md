---
title: '語言設定分離、macOS CGEvent 貼上、Sentry 錯誤回報修補'
slug: 'language-separation-cgevent-paste-sentry-fix'
created: '2026-03-08'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['vue-i18n ^11', 'vue ^3.5', 'tauri-plugin-store ^2.4.2', 'Rust core-graphics 0.24', 'Rust core-foundation 0.10', 'Rust objc 0.2', '@sentry/vue ^10.42.0', 'sentry 0.46']
files_to_modify:
  - 'src/stores/useSettingsStore.ts'
  - 'src/views/SettingsView.vue'
  - 'src/types/events.ts'
  - 'src/i18n/languageConfig.ts'
  - 'src/i18n/prompts.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ko.json'
  - 'src-tauri/src/plugins/clipboard_paste.rs'
  - 'src-tauri/src/plugins/transcription.rs'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/lib/sentry.ts'
  - 'src-tauri/src/lib.rs'
  - 'src/stores/useVocabularyStore.ts'
  - 'src/stores/useHistoryStore.ts'
  - 'src/components/AccessibilityGuide.vue'
  - 'src/MainApp.vue'
  - 'src/main.ts'
  - 'src/main-window.ts'
  - 'tests/unit/i18n-settings.test.ts'
  - 'tests/unit/use-settings-store.test.ts'
code_patterns:
  - 'Settings Store: load() -> get() -> set() -> save() -> emitEvent()'
  - 'Cross-window sync: refreshCrossWindowSettings() reads store and updates ref'
  - 'Sentry: captureError(err, { source, ...context }) from lib/sentry.ts'
  - 'HUD event: emitEvent(EVENT_NAME, payload) from composables/useTauriEvents'
  - 'Rust command: #[command] pub fn -> Result<T, E> via ? operator'
  - 'CGEvent in hotkey_listener.rs: CGEventTap::new + CFRunLoop（監聽用，非模擬）'
  - 'CGEvent keyboard sim: CGEventCreateKeyboardEvent(source, keycode, keydown) + set_flags'
  - 'macOS keycodes: Command=55, V=9; CGEventFlags::CGEventFlagMaskCommand'
  - 'completePasteFlow: invoke("paste_text") → catch → failRecordingFlow → captureError'
  - 'HudStatus: "idle"|"recording"|"transcribing"|"enhancing"|"success"|"error"'
test_patterns:
  - 'Vitest + jsdom, vi.mock @tauri-apps series'
  - 'Store test: import -> useStore() -> call method -> expect mockStoreSet'
  - 'i18n-settings.test.ts: saveLocale 持久化、getWhisperLanguageCode 映射、detectSystemLocale'
  - 'use-settings-store.test.ts: 501 行，mock store get/set/delete/save'
  - 'Rust: #[cfg(test)] mod tests + assert_eq!'
---

# Tech-Spec: 語言設定分離、macOS CGEvent 貼上、Sentry 錯誤回報修補

**Created:** 2026-03-08

## Overview

### Problem Statement

1. **語言耦合**：APP 介面語言和 Whisper 轉錄語言強耦合。切換 UI 語言會自動改變轉錄語言，但許多使用者用英文 UI 卻講中文。需要兩者獨立設定。

2. **貼上失效**：macOS AX Menu Press 貼上機制在 LINE 等無標準 Edit > Paste 選單的 app 中失效（搜尋不到 `AXMenuItemCmdChar="v"` 的 menu item）。且錯誤被靜默吞掉——`paste_text()` 回傳 `Ok(())` 即使貼上實際失敗。

3. **Sentry 缺口**：使用者遇到錯誤但 Sentry 沒收到回報。盤點發現 6 個根本原因，包含大量 catch 只做 console.error 沒有 captureError、HUD 視窗 Sentry integrations 為空、paste 失敗被吞掉、缺少全域錯誤處理器等。

### Solution

1. **語言分離**：新增獨立的 `selectedTranscriptionLocale` 設定（含「自動偵測」選項），Whisper `language` 參數和 AI prompt 改跟轉錄語言走。

2. **CGEvent 貼上**：macOS 改用 CGEvent Cmd+V 模擬鍵盤貼上，移除 AX Menu Press。失敗時回傳 `Err` 給前端。

3. **Sentry 修補**：補齊前端 captureError 調用、修復 HUD Sentry 初始化、加入 Vue errorHandler + unhandledrejection 全域處理、Rust 加 panic handler。Paste 失敗時 HUD 顯示提示 + Sentry 回報。

### Scope

**In Scope:**

- Feature A（語言分離）：
  - 新增 `selectedTranscriptionLocale` ref 和 `saveTranscriptionLocale()` 在 useSettingsStore
  - 新增「自動偵測」選項（不傳 language 參數給 Whisper）
  - `getWhisperLanguageCode()` 改讀新 ref
  - `resetAiPrompt()` 改用轉錄語言
  - AI prompt 自動切換邏輯從 `saveLocale` 移到 `saveTranscriptionLocale`
  - SettingsView 新增轉錄語言下拉選單
  - 5 個 i18n 檔案更新
  - 跨視窗同步
  - 遷移：舊版預設轉錄語言 = 當前 UI 語言

- Feature B（CGEvent 貼上）：
  - macOS：移除 `trigger_paste_via_menu()` + `find_and_press_paste_menu_item()`
  - macOS：新增 CGEvent Cmd+V 模擬（Cmd↓ V↓ V↑ Cmd↑）
  - `paste_text()` 失敗時回傳 `Err(ClipboardError::KeyboardSimulation(...))`
  - 前端：paste 失敗時 HUD 顯示「已複製，請手動 ⌘V」提示

- Feature C（Sentry 修補）：
  - `lib/sentry.ts`：HUD 初始化加回必要 integrations
  - `main.ts` / `main-window.ts`：加入 Vue errorHandler + unhandledrejection 全域處理
  - stores 補齊 captureError：useVoiceFlowStore、useSettingsStore、useVocabularyStore、useHistoryStore
  - 元件補齊：AccessibilityGuide.vue、MainApp.vue
  - Rust lib.rs：加入 sentry panic handler integration
  - paste 失敗時 Sentry captureError

**Out of Scope:**

- Windows 貼上機制（SendInput 不動，但也要改為回傳 Err）
- Whisper 語言列表擴充超過現有 5 種 + auto
- 翻譯模式功能
- Rust 各插件的 eprintln 全面改為 Sentry 上報（僅處理影響使用者體驗的關鍵路徑）
- Sentry performance tracing 調整

## Context for Development

### Codebase Patterns

- **Settings Store 模式**：`load()` → `store.get()` → `ref.value =` → `store.set()` → `store.save()` → `emitEvent(SETTINGS_UPDATED, { key, value })`
- **跨視窗同步**：`refreshCrossWindowSettings()` 全量重讀 store 並更新所有 ref
- **Sentry 上報**：`captureError(err, { source: "xxx", ...context })` 來自 `src/lib/sentry.ts`
- **Rust command 錯誤**：用 `Result<T, CustomError>` + `?` operator，前端收到 rejected Promise
- **HUD 狀態機**：`transitionTo(status, message)` 改變 HUD 狀態，`failRecordingFlow()` 統一處理錯誤流程
- **CGEvent 現有用法**：`hotkey_listener.rs` 和 `keyboard_monitor.rs` 用 `CGEventTap::new()` 監聽鍵盤事件（讀取用），clipboard 需要用 `CGEventCreateKeyboardEvent` 模擬鍵盤事件（寫入用）
- **Paste 前端流程**：`completePasteFlow()` → `invoke("paste_text")` → 成功走 `transitionTo("success")` / 失敗走 `failRecordingFlow()` → `captureError()`

### Files to Reference

| File | Purpose | 關鍵行號 |
| ---- | ------- | ------- |
| `src/stores/useSettingsStore.ts` | 語言設定核心，新增 transcriptionLocale | L69-90: refs, L110-180: loadSettings, L517-554: saveLocale+getWhisperLanguageCode, L578-641: refreshCrossWindowSettings |
| `src/i18n/languageConfig.ts` | 語言選項、Whisper code 映射 | L1: SupportedLocale type, L13-49: LANGUAGE_OPTIONS, L101-104: getWhisperCodeForLocale |
| `src/i18n/prompts.ts` | AI prompt 預設值查表 | DEFAULT_PROMPTS record, getDefaultPromptForLocale() |
| `src/views/SettingsView.vue` | 設定頁 UI | L950-970: 介面語言下拉 |
| `src/types/events.ts` | SettingsKey 聯合型別 | L21-29: SettingsKey |
| `src-tauri/src/plugins/clipboard_paste.rs` | 貼上機制 | L29-83: trigger_paste_via_menu（要移除）, L234-267: Windows SendInput, L279-327: paste_text（吞掉錯誤） |
| `src-tauri/src/plugins/transcription.rs` | Whisper API 呼叫 | L10: TRANSCRIPTION_LANGUAGE="zh", L142: language field 構建 |
| `src/stores/useVoiceFlowStore.ts` | 轉錄+貼上流程 | L98-116: isSilenceOrHallucination CJK 檢測, L393-414: completePasteFlow, L254-286: 靜音/監控等只 log 無 Sentry |
| `src/lib/sentry.ts` | Sentry 初始化 | initSentryForHud（integrations:[] 空）, initSentryForDashboard, captureError helper |
| `src/main.ts` | HUD 入口 | 缺 Vue errorHandler + unhandledrejection |
| `src/main-window.ts` | Dashboard 入口 | 有 bootstrap captureError，缺 errorHandler |
| `src/stores/useHistoryStore.ts` | 歷史記錄 DB 操作 | 0 個 try-catch 有 captureError |
| `src/stores/useVocabularyStore.ts` | 詞彙 DB 操作 | 所有 catch 只 console.error |
| `src-tauri/src/lib.rs` | Rust Sentry 初始化 | L342-387: sentry::init，缺 panic handler |
| `docs/adr-paste-mechanism.md` | ADR 決策文件 | CGEvent 改回決議 |

### Technical Decisions

1. **轉錄語言型別**：新增 `TranscriptionLocale = SupportedLocale | "auto"` type alias。不擴充 `SupportedLocale` 本身，保持 UI locale 型別乾淨。`"auto"` 時前端傳 `null` 給 Rust，Rust 不加 language field 到 Groq API form。

2. **AI prompt 與 auto**：選擇「自動偵測」時，`resetAiPrompt()` 使用 **UI 語言**的預設 prompt（因為無法預知使用者會說什麼語言，但使用者的 UI 語言通常反映偏好的輸出語言）。`getDefaultPromptForLocale()` 接收 auto 時 fallback 到 `selectedLocale.value`。

3. **CJK 幻覺檢測與 auto**：auto 模式下**跳過 CJK 幻覺檢測**（`getWhisperLanguageCode() !== "zh"` 的分支），因為無法預知 Whisper 會偵測到什麼語言。

4. **Rust transcription.rs 修改**：`language` 參數為 `None` 時，**不加入** `language` field 到 multipart form（而非 fallback 到 `"zh"`）。移除 `TRANSCRIPTION_LANGUAGE` 常數。

5. **CGEvent 實作**：用 `CGEventCreateKeyboardEvent(source, keycode, keydown)` + `CGEventPost` 送出 4 事件。macOS keycodes: Command=55, V=9。設定 `CGEventFlags::CGEventFlagMaskCommand` 修飾鍵。事件源使用 `CGEventSourceStateID::Private`（隔離狀態，不繼承物理鍵盤的 modifier flag），投遞位置使用 `CGEventTapLocation::Session`。⚠️ 禁止使用 `HIDSystemState`/`CombinedSessionState`（Toggle 模式 + modifier trigger key 會殘留 flag 導致重複貼上）。

6. **paste_text 失敗處理**：macOS 和 Windows 都改為回傳 `Err(ClipboardError::KeyboardSimulation(msg))`。前端 `completePasteFlow()` 的 catch 已有 `failRecordingFlow()` + `captureError()`，Rust 改回傳 Err 後前端自動生效。HUD 顯示 `t("voiceFlow.pasteFailed")` 訊息。

7. **HUD Sentry integrations**：保持 `integrations: []`（HUD 刻意不做 browser tracing）。`captureError()` / `captureException()` 不依賴 integrations，可正常手動上報。真正的問題是 catch 區塊沒呼叫 `captureError()`。

8. **Sentry 修補範圍**：
   - ✅ 補齊：全域 Vue errorHandler + unhandledrejection（main.ts, main-window.ts）
   - ✅ 補齊：useVoiceFlowStore 非關鍵 catch（mute、monitor、addTranscription、hideHud 等）
   - ✅ 補齊：useVocabularyStore、useHistoryStore 的 catch
   - ✅ 補齊：AccessibilityGuide.vue、MainApp.vue 的 catch
   - ✅ 補齊：useSettingsStore 關鍵操作（saveHotkeyConfig、loadSettings）
   - ❌ 不動：Rust 各插件 eprintln（低優先級，下次迭代）
   - ✅ Rust lib.rs：加入 `sentry::integrations::panic` handler

## Implementation Plan

### Tasks

#### Feature A：語言設定分離（依賴順序：底層型別 → Store → Rust → UI）

- [x] Task 1: 新增 TranscriptionLocale 型別和 auto 語言選項
  - File: `src/i18n/languageConfig.ts`
  - Action:
    - 新增 `export type TranscriptionLocale = SupportedLocale | "auto";`
    - **不動** `LANGUAGE_OPTIONS` 陣列（auto 不進入此陣列，避免污染 `detectSystemLocale()`、`getHtmlLangForLocale()` 等現有函式）
    - 新增 `TRANSCRIPTION_LANGUAGE_OPTIONS` 常數：在開頭放 auto 選項 `{ locale: "auto" as TranscriptionLocale, displayName: "自動偵測", whisperCode: null }`，後接 `LANGUAGE_OPTIONS` 的 5 種語言（可用 spread 或 map 取出 locale + displayName）
    - 新增 `getWhisperCodeForTranscriptionLocale(locale: TranscriptionLocale): string | null` 函式：`"auto"` 回傳 `null`，其餘 delegate 到現有 `getWhisperCodeForLocale()`
    - 保留 `getWhisperCodeForLocale()` 簽名不變（仍接受 `SupportedLocale`，回傳 `string`），避免影響既有呼叫點
  - Notes: `SupportedLocale` 和 `LANGUAGE_OPTIONS` 完全不動。新增的 `TranscriptionLocale` 和 `TRANSCRIPTION_LANGUAGE_OPTIONS` 是獨立的平行結構。（修正 F-04）

- [x] Task 2: 擴充 SettingsKey 和 i18n 翻譯
  - File: `src/types/events.ts`
  - Action: `SettingsKey` 聯合型別新增 `| "transcriptionLocale"`
  - File: `src/i18n/locales/zh-TW.json`
  - Action: 在 `settings.app` 新增：`"transcriptionLanguage": "轉錄語言"`, `"transcriptionLanguageDescription": "語音轉文字時使用的辨識語言"`, `"transcriptionLanguageUpdated": "轉錄語言已更新"`, `"autoDetect": "自動偵測"`
  - File: `src/i18n/locales/en.json`
  - Action: 同上英文版：`"transcriptionLanguage": "Transcription Language"`, `"transcriptionLanguageDescription": "Language used for speech recognition"`, `"transcriptionLanguageUpdated": "Transcription language updated"`, `"autoDetect": "Auto Detect"`
  - File: `src/i18n/locales/ja.json`, `zh-CN.json`, `ko.json`
  - Action: 同上各語言版本

- [x] Task 3: Store 核心邏輯修改
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - import `TranscriptionLocale` from languageConfig
    - 新增 `selectedTranscriptionLocale = ref<TranscriptionLocale>(FALLBACK_LOCALE)`
    - 新增 `saveTranscriptionLocale(locale: TranscriptionLocale)` 函式：
      - 模式同 `saveLocale()`：`store.set("selectedTranscriptionLocale", locale)` → `store.save()` → `emitEvent`
      - **AI prompt 自動切換邏輯移入此處**（從 `saveLocale` 搬來）：比較舊 transcription locale 的預設 prompt，若相同則更新為新 locale 的預設
      - auto 模式的 prompt：用 `getDefaultPromptForLocale(selectedLocale.value)` fallback 到 UI 語言。非 auto 時用 `getDefaultPromptForLocale(locale)`（TS narrowing 自動排除 `"auto"`）（修正 F-03）
    - 修改 `getWhisperLanguageCode()` → `return getWhisperCodeForTranscriptionLocale(selectedTranscriptionLocale.value)`（用 Task 1 新增的函式，回傳 `string | null`）
    - 修改 `resetAiPrompt()` 的 `getDefaultPromptForLocale()` 呼叫：需先 narrow `TranscriptionLocale` 到 `SupportedLocale`：
      ```typescript
      const promptLocale: SupportedLocale =
        selectedTranscriptionLocale.value === "auto"
          ? selectedLocale.value
          : selectedTranscriptionLocale.value; // 這裡 TS 會 narrow 為 SupportedLocale
      const defaultPrompt = getDefaultPromptForLocale(promptLocale);
      ```
      （修正 F-03：三元運算的 false 分支經過 `=== "auto"` 判斷後，TS narrowing 會排除 `"auto"`，型別自動收窄為 `SupportedLocale`）
    - 修改 `loadSettings()`：在 locale 載入後，新增讀取 `"selectedTranscriptionLocale"`。若不存在（遷移），預設為 `selectedLocale.value`，寫回 store
    - 修改 `saveLocale()`：**移除** AI prompt 自動切換邏輯（L527-533）
    - 修改 `refreshCrossWindowSettings()`：新增讀取 `"selectedTranscriptionLocale"` 並同步到 ref
    - 在 return 物件新增：`selectedTranscriptionLocale`, `saveTranscriptionLocale`
  - Notes: `getWhisperLanguageCode()` 回傳 `string | null`，null 表示 auto

- [x] Task 4: Rust 端支援 auto-detect（省略 language field）
  - File: `src-tauri/src/plugins/transcription.rs`
  - Action:
    - 移除 L10 的 `const TRANSCRIPTION_LANGUAGE: &str = "zh";`
    - 修改 L140-143 的 form 構建邏輯：
      ```rust
      let mut form = reqwest::multipart::Form::new()
          .part("file", file_part)
          .text("model", model)
          .text("response_format", "verbose_json");
      // 條件性加入 language
      if let Some(lang) = language {
          form = form.text("language", lang);
      }
      ```
  - Notes: 前端傳 `null`（Rust 收到 `None`）時不加 language field，Groq Whisper 自動偵測。⚠️ 實作前需確認 Tauri v2 的 `invoke("transcribe_audio", { language: null })` 是否正確序列化為 Rust `Option<String>::None`——可在 dev mode 用 `debug_log` 驗證（修正 F-05）

- [x] Task 5: 更新 CJK 幻覺檢測邏輯
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 L109-113 的 CJK 檢測條件：
    ```typescript
    const whisperLang = settingsStore.getWhisperLanguageCode();
    if (
      whisperLang === "zh" &&
      !CJK_REGEX.test(rawText) &&
      hasRepeatedTokens(rawText)
    )
    ```
    當 `whisperLang` 為 `null`（auto 模式）時自然跳過（`null === "zh"` 為 false）
  - Notes: 無需特殊處理 auto，null 自動走 false 分支

- [x] Task 6: SettingsView 新增轉錄語言下拉選單
  - File: `src/views/SettingsView.vue`
  - Action:
    - import `TRANSCRIPTION_LANGUAGE_OPTIONS`, `TranscriptionLocale` from languageConfig
    - 在介面語言下拉（L970）後、`localeFeedback` transition 後，新增分隔線 + 轉錄語言區塊：
      - `<Label>` + `<p class="text-sm text-muted-foreground">` 說明文字
      - `<Select :model-value="settingsStore.selectedTranscriptionLocale" @update:model-value="handleTranscriptionLocaleChange">`
      - 選項用 `TRANSCRIPTION_LANGUAGE_OPTIONS`，auto 選項的 displayName 用 `$t("settings.app.autoDetect")`（其餘用 `opt.displayName`）
    - 新增 `transcriptionLocaleFeedback = useFeedbackMessage()`
    - 新增 `handleTranscriptionLocaleChange(newLocale: TranscriptionLocale)` handler
  - Notes: UI 佈局參考 Typeless 截圖——語言區塊兩個獨立下拉

#### Feature B：macOS CGEvent 貼上（依賴順序：Rust → 前端自動生效）

- [x] Task 7: macOS 改用 CGEvent Cmd+V 模擬貼上
  - File: `src-tauri/src/plugins/clipboard_paste.rs`
  - Action:
    - **移除** `trigger_paste_via_menu()` 函式（L29-83）和 `find_and_press_paste_menu_item()` 函式（L87-229）
    - **新增** `simulate_paste_via_cgevent()` 函式（`#[cfg(target_os = "macos")]`）：
      ```rust
      fn simulate_paste_via_cgevent() -> Result<(), String> {
          // 用 CGEventCreateKeyboardEvent + CGEventPost
          // 事件序列：Cmd↓ → V↓ → V↑ → Cmd↑
          // keycodes: Command_L=55, V=9
          // V↓/V↑ 需設定 CGEventFlags::CGEventFlagMaskCommand
      }
      ```
    - **修改** `paste_text()` 的 `#[cfg(target_os = "macos")]` 區塊：
      - 呼叫 `simulate_paste_via_cgevent()`
      - 失敗時 `return Err(ClipboardError::KeyboardSimulation(e))`（不再吞掉錯誤）
    - **修改** `paste_text()` 的 `#[cfg(target_os = "windows")]` 區塊：
      - 失敗時同樣 `return Err(ClipboardError::KeyboardSimulation(e))`
    - 移除 `ClipboardError::KeyboardSimulation` 上的 `#[allow(dead_code)]` attribute（因為現在 macOS 和 Windows 都會用到）
    - 移除不再需要的 imports（`core_foundation`, `objc` 等 AX API 相關）
  - Notes: CGEvent 需要 Accessibility 權限（已有）。4 事件完整配對，paste 場景下幽靈按鍵風險趨近於零

- [x] Task 8: 更新 Rust 測試
  - File: `src-tauri/src/plugins/clipboard_paste.rs`
  - Action: 現有 `ClipboardError` 測試無需修改（`KeyboardSimulation` variant 測試已存在）。確認編譯通過即可

#### Feature C：Sentry 錯誤回報修補（依賴順序：全域處理 → Store → 元件 → Rust）

- [x] Task 9: 加入全域錯誤處理器
  - File: `src/main.ts`（HUD 入口）
  - Action:
    - **在 `createApp()` 之後、`mount()` 之前**，新增 `unhandledrejection` listener 和 Vue errorHandler：
      ```typescript
      // ⚠️ unhandledrejection 必須在 mount 之前註冊，
      //    確保 mount 期間的 async 錯誤也能被捕獲（修正 F-11）
      window.addEventListener("unhandledrejection", (event) => {
        captureError(event.reason, { source: "hud-unhandled-rejection" });
      });

      app.config.errorHandler = (err, _instance, info) => {
        console.error("[HUD] Vue error:", err);
        captureError(err, { source: "hud-vue-error", info });
      };

      app.use(pinia).use(i18n).mount("#app");
      ```
    - import `captureError` from `./lib/sentry`
  - File: `src/main-window.ts`（Dashboard 入口）
  - Action: 同上，但 source tag 改為 `"dashboard-vue-error"` 和 `"dashboard-unhandled-rejection"`
  - Notes: errorHandler 和 unhandledrejection 都在 Sentry init 之後、mount 之前設定。順序：Sentry init → addEventListener → errorHandler → mount

- [x] Task 10: useVoiceFlowStore 補齊 captureError
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在以下 catch 區塊新增 `captureError(err, { source: "voice-flow", step: "xxx" })`：
    - L254-258: `muteSystemAudio` 失敗 → `step: "mute-audio"`
    - L264-267: `restoreSystemAudio` 失敗 → `step: "restore-audio"`
    - L272-276: `start_quality_monitor` 失敗 → `step: "quality-monitor"`
    - L283-286: `addTranscription` 失敗 → `step: "save-transcription"`
    - L328-332: `hideHud` 失敗 → `step: "hide-hud"`
    - L342-346: `showHud` 失敗 → `step: "show-hud"`
    - L365-370: `showHud/enableCursor` 失敗 → `step: "show-hud-cursor"`
  - Notes: 這些都是非關鍵路徑（不影響主流程），但對診斷問題很重要

- [x] Task 11: useSettingsStore 補齊 captureError
  - File: `src/stores/useSettingsStore.ts`
  - Action: 在以下 catch 區塊新增 `captureError`（import from `../lib/sentry`）：
    - `syncHotkeyConfigToRust` catch (L103-107) → `{ source: "settings", step: "sync-hotkey" }`
    - `loadSettings` catch → `{ source: "settings", step: "load" }`
    - `saveHotkeyConfig` 系列 catch → `{ source: "settings", step: "save-hotkey" }`
    - `saveApiKey` catch → `{ source: "settings", step: "save-api-key" }`
    - `saveLocale` catch → `{ source: "settings", step: "save-locale" }`
    - `saveMuteOnRecording` catch → `{ source: "settings", step: "save-mute" }`
  - Notes: 保留現有 `console.error()` 不動，在其後方追加 `captureError`

- [x] Task 12: useVocabularyStore 補齊 captureError
  - File: `src/stores/useVocabularyStore.ts`
  - Action: 在所有 catch 區塊追加 `captureError(err, { source: "vocabulary", step: "xxx" })`：
    - `fetchTermList` → `step: "fetch"`
    - `addTerm` → `step: "add"`
    - `removeTerm` → `step: "remove"`
  - Notes: import `captureError` from `../lib/sentry`

- [x] Task 13: useHistoryStore 補齊錯誤處理
  - File: `src/stores/useHistoryStore.ts`
  - Action:
    - 在以下已有 try-catch 的函式中追加 `captureError(err, { source: "history", step: "xxx" })`：
      - `fetchTranscriptions()` → `step: "fetch"`
      - `addTranscription()` → `step: "add"`
      - `deleteTranscription()` → `step: "delete"`
      - `updateTranscription()` → `step: "update"`
      - `fetchStats()` → `step: "fetch-stats"`
    - 對沒有 try-catch 的 DB 操作（如果有）：包 try-catch + captureError，但保留 rethrow（`catch (err) { captureError(...); throw err; }`）
    - import `captureError` from `../lib/sentry`
  - Notes: 不要吞掉錯誤（保留 throw），只補 captureError 上報。實作時需 Read 檔案確認實際函式清單（修正 F-10）

- [x] Task 14: 元件補齊 captureError
  - File: `src/components/AccessibilityGuide.vue`
  - Action: 在 catch 區塊追加 captureError：
    - permission check → `{ source: "accessibility", step: "check-permission" }`
    - reinitialize → `{ source: "accessibility", step: "reinitialize" }`
    - open settings → `{ source: "accessibility", step: "open-settings" }`
  - File: `src/MainApp.vue`
  - Action: 在 catch 區塊追加 captureError：
    - autoCheckAndDownload → `{ source: "updater", step: "auto-check" }`
    - manual update check → `{ source: "updater", step: "manual-check" }`

- [x] Task 15: Rust Sentry panic handler（受限於 panic="abort"）
  - File: `src-tauri/src/lib.rs`
  - Action:
    - 確認 `sentry::init(...)` 的 `default_integrations` 包含 panic handler（SDK 0.46 預設啟用）
    - **⚠️ 已知限制**：`Cargo.toml` 的 `[profile.release]` 設定 `panic = "abort"`，panic hook 觸發後程式立即 abort，Sentry SDK 可能來不及 flush 事件。解法：在 `sentry::init` 選項中設定 `auto_session_tracking: true` 和 `session_mode: SessionMode::Application`，讓 crash 至少被記為 abnormal session。完整的 panic event 上報在 `panic = "abort"` 下**不保證可靠**
    - 同時確認 `_exit(0)` 之前有 `sentry::Hub::current().client().map(|c| c.flush(Some(Duration::from_secs(2))))`，確保正常 shutdown 時 Sentry 有機會 flush 佇列中的事件
  - Notes: （修正 F-09）`panic = "abort"` 是效能最佳化（減少 binary size），改為 `panic = "unwind"` 會增加 ~10% binary size，目前不值得。session tracking 是 pragmatic workaround

#### 測試更新

- [x] Task 16: 更新 i18n-settings 測試
  - File: `tests/unit/i18n-settings.test.ts`
  - Action:
    - 新增 `TranscriptionLocale` 型別測試
    - 新增 `getWhisperCodeForLocale("auto")` → `null` 的測試
    - 新增 `TRANSCRIPTION_LANGUAGE_OPTIONS` 包含 auto + 5 語言的測試
    - 新增 `saveTranscriptionLocale()` 持久化和 event emit 測試

- [x] Task 17: 更新 use-settings-store 測試
  - File: `tests/unit/use-settings-store.test.ts`
  - Action:
    - 新增 `selectedTranscriptionLocale` 初始化測試
    - 新增遷移測試：store 無 `selectedTranscriptionLocale` 時預設為 `selectedLocale`
    - 新增 `getWhisperLanguageCode()` 讀取 `selectedTranscriptionLocale`（非 `selectedLocale`）的測試
    - 新增跨視窗同步 `refreshCrossWindowSettings()` 含 transcriptionLocale 的測試

### Acceptance Criteria

#### Feature A：語言設定分離

- [x] AC-A1: Given 使用者在設定頁, when 切換介面語言為 English, then UI 切換為英文且轉錄語言保持不變（如仍為繁體中文）
- [x] AC-A2: Given 使用者在設定頁, when 切換轉錄語言為日本語, then 下次錄音 Whisper 收到 `language="ja"` 參數
- [x] AC-A3: Given 使用者選擇轉錄語言為「自動偵測」, when 執行錄音, then Whisper API 不帶 `language` 參數（Rust 端不加 language field）
- [x] AC-A4: Given 使用者切換轉錄語言且 AI prompt 為舊語言的預設值, when 切換完成, then AI prompt 自動更新為新語言的預設值
- [x] AC-A5: Given 使用者切換轉錄語言為「自動偵測」且 AI prompt 為預設值, when 切換完成, then AI prompt 更新為 UI 語言的預設 prompt
- [x] AC-A6: Given 舊版使用者升級（store 中無 `selectedTranscriptionLocale`）, when app 啟動, then 轉錄語言自動設為當前 UI 語言，行為不變
- [x] AC-A7: Given 使用者在 Dashboard 切換轉錄語言, when HUD 收到 `SETTINGS_UPDATED` event, then HUD 的 `selectedTranscriptionLocale` 經由 `refreshCrossWindowSettings()` 同步更新（修正 F-06：HUD 無設定 UI，語言切換只在 Dashboard 發生）
- [x] AC-A8: Given 轉錄語言設為「自動偵測」, when Whisper 轉錄回中文結果, then CJK 幻覺檢測被跳過（不會誤判為幻覺）

#### Feature B：macOS CGEvent 貼上

- [x] AC-B1: Given macOS 環境, when 轉錄完成後自動貼上, then 使用 CGEvent Cmd+V 模擬鍵盤事件（非 AX Menu Press）
- [x] AC-B2: Given 前景 app 為 LINE（無標準 Paste 選單）, when 轉錄完成, then 文字成功貼上到 LINE 輸入框
- [x] AC-B3: Given macOS 環境且 CGEvent 模擬失敗, when paste_text 被呼叫, then Rust 回傳 `Err(ClipboardError::KeyboardSimulation(...))` 且前端 HUD 顯示錯誤提示
- [x] AC-B4: Given Windows 環境且 SendInput 失敗, when paste_text 被呼叫, then 同樣回傳 `Err`（行為一致）
- [x] AC-B5: Given 任何平台貼上失敗, when 前端收到 Err, then Sentry 收到 captureError 回報且包含 `source: "voice-flow"` 標籤

#### Feature C：Sentry 錯誤回報修補

- [x] AC-C1: Given HUD 視窗中 Vue 元件拋出未捕獲的錯誤, when errorHandler 觸發, then Sentry 收到 exception 且包含 `source: "hud-vue-error"` 標籤
- [x] AC-C2: Given Dashboard 中有未處理的 Promise rejection, when unhandledrejection 觸發, then Sentry 收到 exception
- [x] AC-C3: Given useVocabularyStore.addTerm() DB 操作失敗, when catch 執行, then 同時 console.error 和 captureError 被呼叫
- [x] AC-C4: Given useHistoryStore DB 操作失敗, when 錯誤發生, then Sentry 收到包含 `source: "history"` 的 exception
- [x] AC-C5: Given 開發環境（import.meta.env.PROD = false）, when captureError 被呼叫, then 不會送出到 Sentry（isSentryEnabled 回 false），也不會 crash
- [x] AC-C6: Given Rust 端發生 panic, when sentry panic handler 觸發, then Sentry 收到 panic event

## Additional Context

### Dependencies

- 無新增外部依賴
- Rust `core-graphics` 0.24 已在 Cargo.toml（用於 CGEvent）
- `@sentry/vue` ^10.42.0 已安裝

### Testing Strategy

**Feature A（語言分離）：**
- 更新 `tests/unit/i18n-settings.test.ts`：新增 `TranscriptionLocale` 型別測試、`"auto"` 選項的 `getWhisperCodeForLocale` 映射（回傳 null）、`saveTranscriptionLocale` 持久化
- 更新 `tests/unit/use-settings-store.test.ts`：新增 `selectedTranscriptionLocale` 初始化、遷移邏輯、跨視窗同步

**Feature B（CGEvent 貼上）：**
- `clipboard_paste.rs` 的 Rust unit test 更新（ClipboardError variant 測試）
- `pnpm tauri dev` 手動測試：在 LINE / Notes / Terminal 中測試貼上
- 確認 Windows CI build 通過（SendInput 改回傳 Err）

**Feature C（Sentry 修補）：**
- 手動測試：開發模式下 `captureError` 呼叫不應 crash（isSentryEnabled 回 false）
- `npx vue-tsc --noEmit` 確認型別正確

**整合驗證：**
- `pnpm test` 全部通過
- `npx vue-tsc --noEmit` 型別檢查通過
- `pnpm tauri dev` 手動測試三個 feature 的端對端流程

### Notes

- **Sentry HUD integrations 為空不是 bug** — 是刻意設計（HUD 不需 browser tracing）。真正的問題是 catch 區塊沒呼叫 `captureError()`
- **Windows SendInput** 也要改為回傳 `Err`（目前同樣靜默吞掉），保持雙平台行為一致
- **CGEvent keycodes**：macOS 虛擬鍵碼定義在 `hotkey_listener.rs` 的 `macos_keycodes` module（Command_L=55, V=9）
- **Sentry 修補不包含 Rust 端 eprintln** — 這些是 audio、hotkey 等系統層操作，影響面小，放下次迭代
- **auto 模式的 AI prompt** 用 UI 語言的 prompt，因為 Whisper verbose_json 回應雖然有 detected language，但修改 enhancement 流程來動態選 prompt 太複雜，不在本次範圍
