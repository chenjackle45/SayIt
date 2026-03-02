# Story 1.5: HUD 狀態顯示與權限引導

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 在語音輸入過程中看到清晰的狀態回饋，並在首次使用時順利完成權限設定,
So that 我隨時知道系統在做什麼，且不會因權限問題卡住。

## Acceptance Criteria

1. **錄音狀態 HUD 顯示** — 使用者觸發錄音，useVoiceFlowStore 狀態為 `'recording'`。NotchHud.vue 顯示錄音狀態（紅點脈衝動畫 + 「錄音中...」文字）。HUD 從 idle 展開至錄音狀態的動畫 < 100ms。

2. **轉錄狀態 HUD 顯示** — 錄音結束開始轉錄，useVoiceFlowStore 狀態為 `'transcribing'`。NotchHud.vue 顯示轉錄狀態（loading spinner + 「轉錄中...」文字）。狀態轉換動畫流暢。

3. **成功狀態自動收起** — 轉錄完成，useVoiceFlowStore 狀態為 `'success'`。NotchHud.vue 顯示「已貼上 ✓」。約 0.8~1.2 秒後自動收起回 idle。收起動畫流暢。

4. **錯誤狀態顯示與自動收起** — API 請求失敗，useVoiceFlowStore 狀態為 `'error'`。NotchHud.vue 顯示人類可讀的錯誤訊息（如「網路連線中斷」「API 請求失敗」）。約 2~3 秒後自動收起回 idle。

5. **macOS Accessibility 權限引導** — macOS 平台首次啟動 App 偵測到尚未取得 Accessibility 權限時，自動開啟 Main Window 顯示引導畫面說明為何需要此權限，提供按鈕開啟系統偏好設定的 Accessibility 面板。使用者授權後可正常使用熱鍵。

6. **麥克風權限請求與錯誤處理** — 任何平台首次觸發錄音時，系統呼叫 `getUserMedia()` 請求麥克風權限。使用者允許後開始錄音。使用者拒絕後 HUD 顯示錯誤訊息提示需要麥克風權限。

## Tasks / Subtasks

- [x] Task 1: NotchHud.vue 中文化 — 僅修改 template（store 已送中文 message）(AC: #1, #2, #3, #4)
  - [x] 1.1 **僅改 template**：將 recording 狀態中的硬編碼 `<span>Recording...</span>` 改為 `<span>{{ message }}</span>`（store 已透過 `transitionTo("recording", "錄音中...")` 傳入中文）
  - [x] 1.2 **僅改 template**：將 transcribing 狀態中的硬編碼 `<span>Transcribing...</span>` 改為 `<span>{{ message }}</span>`（store 已傳入「轉錄中...」）
  - [x] 1.3 **僅改 template**：將 success 狀態中的硬編碼 `<span>Pasted!</span>` 改為 `<span>{{ message }}</span>`（store 已傳入「已貼上 ✓」）
  - [x] 1.4 error 狀態已使用 `{{ message }}` — 確認不需變更。**注意：** error 的 message 放在 `notch-right`，與其他狀態文字放在 `notch-left` 不一致，本 Story 不處理此 layout 差異
  - [x] 1.5 保留各狀態的圖示與動畫（紅點脈衝、spinner、✓ 符號、⚠ 符號）不變
  - [x] 1.6 驗證 HUD 狀態轉換動畫效能 — 確認 `transition: width 0.35s, height 0.35s` 加上 `animation: notchEnter 0.25s` 的視覺表現流暢
  - [x] 1.7 **不修改 useVoiceFlowStore** — store 已有中文常數 `RECORDING_MESSAGE`、`TRANSCRIBING_MESSAGE`、`PASTE_SUCCESS_MESSAGE`，且已透過 `transitionTo()` 傳入 `message.value`，App.vue 已透過 `:message="voiceFlowStore.message"` 傳遞至 NotchHud

- [x] Task 2: 新增 Accessibility 權限檢查 Tauri Command (AC: #5)
  - [x] 2.1 在 `src-tauri/src/plugins/hotkey_listener.rs` 新增公開函式 `check_accessibility_permission_command`：
    - `#[tauri::command]` 標記
    - macOS：呼叫現有的 `check_accessibility_permission()` 返回 `bool`
    - Windows：直接返回 `true`（Windows 不需 Accessibility 權限）
  - [x] 2.2 在 `src-tauri/src/plugins/hotkey_listener.rs` 新增公開函式 `open_accessibility_settings`：
    - `#[tauri::command]` 標記
    - macOS：執行 `std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")`
    - Windows：no-op（返回 Ok）
  - [x] 2.3 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 註冊兩個新 command
  - [x] 2.4 確保 `plugins/mod.rs` 正確 export 新函式

- [x] Task 3: 新增 Accessibility 權限引導元件 (AC: #5)
  - [x] 3.1 建立 `src/components/AccessibilityGuide.vue`：
    - 全螢幕半透明 overlay 容器（Tailwind: `fixed inset-0 z-50 bg-black/50 flex items-center justify-center`）
    - 居中白色卡片，包含：
      - 標題：「需要輔助使用權限」
      - 說明文字：解釋 SayIt 需要 Accessibility 權限以監聽全域快捷鍵
      - 步驟指引：1) 點擊下方按鈕 → 2) 在系統設定中勾選 SayIt → 3) 返回 App
      - 主按鈕：「開啟系統設定」→ 呼叫 `invoke('open_accessibility_settings')`
      - 副按鈕：「稍後設定」→ 關閉 overlay（但熱鍵功能不可用）
    - Props: `visible: boolean`
    - Emits: `close`
  - [x] 3.2 此元件僅在 macOS 平台顯示（使用 `@tauri-apps/api/core` 的 `type()` 取得平台類型，`navigator.platform` 已 deprecated 不可使用）

- [x] Task 4: 整合 Accessibility 權限檢查至 Main Window (AC: #5)
  - [x] 4.1 **主要機制 — MainApp.vue 啟動時獨立檢查**：
    - 在 `src/MainApp.vue` 的 `onMounted` 中，使用 `type()` from `@tauri-apps/api/core` 判斷平台為 macOS 時
    - 呼叫 `invoke('check_accessibility_permission_command')` 檢查權限
    - 若返回 `false`，設置本地 `ref<boolean>` 狀態 `showAccessibilityGuide = true`
    - **不在 useVoiceFlowStore 新增任何權限狀態** — Main Window 自行管理，不跨視窗耦合
  - [x] 4.2 在 `MainApp.vue` template 中掛載 AccessibilityGuide 元件：
    - `<AccessibilityGuide :visible="showAccessibilityGuide" @close="showAccessibilityGuide = false" />`
    - 放在 template 最外層（overlay 覆蓋整個 Main Window）
  - [x] 4.3 **Fallback 機制 — 修改 HOTKEY_ERROR listener 開啟 Main Window**：
    - 在 `useVoiceFlowStore` 的 HOTKEY_ERROR listener 中，**新增** 檢查 `event.payload.error` 欄位
    - 若 `event.payload.error === 'accessibility_permission'`，使用 `WebviewWindow.getByLabel('main-window')` 取得 Main Window 實例並呼叫 `.show()` + `.setFocus()`
    - Main Window 開啟後會自行執行 4.1 的檢查邏輯 → 自動顯示引導
    - **注意 window label**：Main Window 的 label 是 `"main-window"`（非 `"main"`，`"main"` 是 HUD Window）
  - [x] 4.4 使用者授權後的行為：
    - AccessibilityGuide 的「開啟系統設定」按鈕 → `invoke('open_accessibility_settings')`
    - 「稍後設定」按鈕 → 關閉 overlay（熱鍵功能不可用直到下次啟動 App 並授權）
    - 熱鍵功能在下次 App 重啟後生效（CGEventTap 在 plugin init 時建立，需重啟才能重新建立）

- [x] Task 5: 麥克風權限錯誤訊息中文化 (AC: #6)
  - [x] 5.1 在 `src/lib/errorUtils.ts` 新增 `getMicrophoneErrorMessage(error: unknown): string` helper：
    - 使用 `error instanceof DOMException` 判斷，依 `error.name` 區分：
    - `NotAllowedError` → 「需要麥克風權限才能錄音」
    - `NotFoundError` → 「未偵測到麥克風裝置」
    - `NotReadableError` → 「麥克風被其他程式佔用」
    - 其他 DOMException 或非 DOMException → 「麥克風初始化失敗」
  - [x] 5.2 在 `useVoiceFlowStore.ts` 的 `handleStartRecording()` catch 區塊中：
    - 將 `extractErrorMessage(error)` 替換為 `getMicrophoneErrorMessage(error)`
    - 確保 `failRecordingFlow()` 傳入的是中文 user-facing 訊息
    - log message 仍保留英文技術細節（給開發者看）
  - [x] 5.3 驗證 HUD 正確顯示中文錯誤訊息

- [ ] Task 6: 整合驗證 (AC: #1-6)
  - [x] 6.1 `cargo check` 通過 — zero errors（既存 warnings 可接受：objc macro cfg, dead_code）
  - [x] 6.2 `vue-tsc --noEmit` 通過
  - [x] 6.3 `pnpm test` 現有測試通過（確認不 break 既有邏輯）
  - [ ] 6.4 手動測試：HUD 錄音狀態 — 紅點脈衝 + 「錄音中...」中文文字
  - [ ] 6.5 手動測試：HUD 轉錄狀態 — spinner + 「轉錄中...」中文文字
  - [ ] 6.6 手動測試：HUD 成功狀態 — 「已貼上 ✓」→ ~1 秒後自動收起
  - [ ] 6.7 手動測試：HUD 錯誤狀態 — 中文錯誤訊息 → ~2 秒後自動收起
  - [ ] 6.8 手動測試：macOS Accessibility 權限未授權 → Main Window 顯示引導畫面
  - [ ] 6.9 手動測試：macOS Accessibility 引導畫面按鈕 → 開啟系統偏好設定
  - [ ] 6.10 手動測試：麥克風權限被拒 → HUD 顯示「需要麥克風權限才能錄音」
  - [ ] 6.11 手動測試：所有 HUD 動畫流暢、無閃爍

## Dev Notes

### 架構模式與約束

**Brownfield 專案** — 基於 Story 1.1-1.4 繼續擴展。本 Story 不新增核心邏輯，主要是 UI 完善與權限引導。

**本 Story 的核心工作：**
1. NotchHud.vue 中文化（**僅改 template** — store 已送中文 message，只需把硬編碼英文換成 `{{ message }}`）
2. macOS Accessibility 權限引導（Tauri Command + Vue 引導元件，**在 Main Window 顯示，不動 HUD Window**）
3. 麥克風權限錯誤處理中文化（新增 `getMicrophoneErrorMessage()` helper）

**依賴方向規則（嚴格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/
- ❌ Store 中引入 Vue lifecycle hooks（onMounted 等）
- ❌ 在元件中直接執行 SQL

### NotchHud.vue 當前實作分析

**目前 5 態視覺表現（需中文化）：**

| 狀態 | 動畫 | 當前文字（英文） | 改為 |
|------|------|-----------------|------|
| recording | 紅點 pulse 1s infinite | "Recording..." | 使用 `message` prop（store 傳「錄音中...」） |
| transcribing | 白色 spinner spin 0.6s | "Transcribing..." | 使用 `message` prop（store 傳「轉錄中...」） |
| success | 綠色 ✓ 符號 | "Pasted!" | 使用 `message` prop（store 傳「已貼上 ✓」） |
| error | 橘色 ⚠ 符號 | `message` prop ✓ | 已使用 prop，不需改 |
| idle | 隱藏（v-if） | — | — |

**修改策略：** 將 recording、transcribing、success 三個狀態中的硬編碼英文 `<span>` 改為 `{{ message }}`。保留各狀態的圖示（紅點、spinner、✓）和動畫不變。**Store 不需修改** — `useVoiceFlowStore.ts` 已有中文常數（`RECORDING_MESSAGE = "錄音中..."`、`TRANSCRIBING_MESSAGE = "轉錄中..."`、`PASTE_SUCCESS_MESSAGE = "已貼上 ✓"`），且已透過 `transitionTo()` 設入 `message.value`，App.vue 已透過 `:message` prop 傳遞。

**動畫效能：**
- 進入動畫：`notchEnter` 0.25s cubic-bezier（縮放+透明度）
- 狀態轉換：width/height/clip-path 各 0.35s cubic-bezier transition
- Notch 形狀：使用 `clip-path` + SVG path 繪製蘋果 Notch 外觀
- 每個狀態有不同尺寸：recording=360×42, transcribing=360×42, success=320×40, error=380×44

**Auto-hide 計時（已在 store 實作，不需修改）：**
```typescript
const SUCCESS_DISPLAY_DURATION_MS = 1000;  // 1 秒，符合 AC3「0.8~1.2 秒」
const ERROR_DISPLAY_DURATION_MS = 2000;    // 2 秒，符合 AC4「2~3 秒」
```

### Accessibility 權限現有 Rust 實作

**hotkey_listener.rs 中已有的函式（非 Tauri Command，需封裝）：**

```rust
// 檢查 Accessibility 權限（macOS only）
#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> bool {
    extern "C" { fn AXIsProcessTrusted() -> bool; }
    unsafe { AXIsProcessTrusted() }
}

// 觸發系統權限對話框（macOS only）
fn prompt_accessibility_permission() {
    // AXIsProcessTrustedWithOptions + AXTrustedCheckOptionPrompt
}
```

**plugin init 中的現有流程：**
```rust
// App 啟動時自動檢查 + prompt
if !check_accessibility_permission() {
    prompt_accessibility_permission();
    std::thread::sleep(Duration::from_secs(1));
    // 若仍無權限，start_event_tap 會失敗並 emit hotkey:error
}
```

**hotkey:error 事件 payload（已有）：**
```json
{
  "error": "accessibility_permission",
  "message": "CGEventTap creation failed. Grant Accessibility permission."
}
```

**需新增的 Tauri Commands：**
1. `check_accessibility_permission_command` — 封裝 `check_accessibility_permission()` 為 Tauri Command
2. `open_accessibility_settings` — macOS: `open x-apple.systempreferences:...`

**Command 簽名規範（遵循現有模式）：**
```rust
#[tauri::command]
pub fn check_accessibility_permission_command() -> bool {
    #[cfg(target_os = "macos")]
    { check_accessibility_permission() }
    #[cfg(not(target_os = "macos"))]
    { true }
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

**注意：** Tauri Command 泛型 `<R: Runtime>` 在不需要 `AppHandle` 參數時可省略。但若需要 `AppHandle` 則必須加上。本專案現有 commands（`debug_log`、`update_hotkey_config`）均未使用 `<R: Runtime>` 泛型，新 commands 遵循現有模式。（project-context.md 的泛型必須規則與實際程式碼不一致，以實際程式碼為準。）

### Accessibility 引導架構設計（Code Review 修正版）

**決策：Main Window 獨立檢查 + HOTKEY_ERROR fallback**

設計原則：
- HUD Window（App.vue）**僅負責狀態顯示**，不做使用者互動（architecture.md 規範）
- HUD 和 Main Window 的 Pinia store 是**獨立實例**，不共享狀態
- 因此**不在 useVoiceFlowStore 新增任何權限狀態**，避免跨視窗耦合

**主要機制 — Main Window 自行檢查：**
```
Main Window 啟動（手動開啟 / Tray 點擊 / HOTKEY_ERROR fallback 觸發）
  ↓
MainApp.vue onMounted
  ├─ type() === 'macos' ?
  │   ├─ invoke('check_accessibility_permission_command')
  │   │   ├─ true → 不顯示引導
  │   │   └─ false → showAccessibilityGuide = true → 顯示 overlay
  │   └─ 非 macOS → 跳過
  └─ 繼續正常載入 Sidebar + RouterView
```

**Fallback 機制 — HOTKEY_ERROR 觸發開啟 Main Window：**
```
HUD Window（App.vue）
  ↓
useVoiceFlowStore HOTKEY_ERROR listener
  ├─ event.payload.error === 'accessibility_permission' ?
  │   ├─ YES → WebviewWindow.getByLabel('main-window').show() + setFocus()
  │   │        （Main Window 開啟後自行執行上方檢查流程）
  │   └─ NO → 照舊顯示 HUD error 訊息
  └─ transitionTo('error', event.payload.message) // 照舊
```

**Window Labels 對照（避免混淆）：**
| Label | 用途 | tauri.conf.json |
|-------|------|----------------|
| `"main"` | HUD Window（透明 overlay） | windows[0] |
| `"main-window"` | Main Window（Dashboard） | windows[1] |

**AccessibilityGuide.vue 元件規格：**
```
<template>
  <div v-if="visible" class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
    <div class="bg-white rounded-2xl p-8 max-w-md mx-4 shadow-2xl">
      <h2>需要輔助使用權限</h2>
      <p>SayIt 需要「輔助使用」權限來監聽全域快捷鍵。</p>
      <p>不授予此權限，快捷鍵功能將無法使用。</p>
      <ol>
        <li>點擊下方按鈕開啟系統設定</li>
        <li>在列表中找到 SayIt 並勾選</li>
        <li>返回此視窗</li>
      </ol>
      <button @click="openSettings">開啟系統設定</button>
      <button @click="$emit('close')">稍後設定</button>
    </div>
  </div>
</template>
```

**使用者授權後限制：** 授權後需重啟 App 才能使用熱鍵（CGEventTap 在 plugin init 時建立，非動態重建）。

### 麥克風權限錯誤處理

**現有 Store 錯誤處理（useVoiceFlowStore.ts handleStartRecording）：**
```typescript
try {
  await initializeMicrophone();
  // ... start recording
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  failRecordingFlow(errorMessage, `initializeMicrophone failed: ${errorMessage}`);
}
```

**需改進：** 目前 `errorMessage` 直接使用 JavaScript 原生錯誤訊息（英文）。需要根據錯誤類型映射為中文：

```typescript
function getMicrophoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "需要麥克風權限才能錄音";
      case "NotFoundError":
        return "未偵測到麥克風裝置";
      case "NotReadableError":
        return "麥克風被其他程式佔用";
      default:
        return "麥克風初始化失敗";
    }
  }
  return "麥克風初始化失敗";
}
```

### 前一個 Story (1.4) 關鍵學習

- **useVoiceFlowStore 是 HUD 核心引擎** — 所有狀態管理和 HUD 視窗控制都在此 store
- **transitionTo() 已整合 showHud/hideHud** — 每次狀態變更自動管理 HUD 視窗
- **Race condition 防護** — `isRecording` 作為流程鎖已建立
- **錯誤處理模式已確立** — `err instanceof Error ? err.message : String(err)`
- **getCurrentWindow() 改為 lazy 初始化** — Code Review 修復：`getAppWindow()` helper function
- **showHud/hideHud 錯誤改為 `.catch(writeErrorLog)`** — 不再靜默吞掉錯誤
- **Pinia store 不可用 Vue lifecycle hooks** — 使用 `initialize()`/`cleanup()` 模式
- **cargo check 有既存 warnings** — objc macro cfg, dead_code — 不影響功能

### Git 歷史分析

**最近 commit 模式：**
- `feat:` 功能實作（Story 1.1-1.4）
- `fix:` code review 修復
- Conventional Commits 格式

**最近改動的關鍵檔案（與本 Story 直接相關）：**
- `src/components/NotchHud.vue` — Story 1.1 建立，包含 Notch 形狀 + 5 態動畫
- `src/stores/useVoiceFlowStore.ts` — Story 1.4 擴展為完整流程引擎
- `src/App.vue` — Story 1.4 改用 useVoiceFlowStore
- `src-tauri/src/plugins/hotkey_listener.rs` — Story 1.2 建立 OS-native 熱鍵 + Accessibility 檢查
- `src-tauri/src/lib.rs` — Story 1.3 擴展 Tray + commands

### 技術版本確認（2026-03-02）

| 技術 | 版本 | 備註 |
|------|------|------|
| Tauri | v2.10.x | `invoke()`, `getCurrentWindow()`, `WebviewWindow` |
| Vue 3 | 3.5.29 | Composition API, `<script setup>` |
| Tailwind CSS | 4.2.1 | `@import "tailwindcss"` 語法 |
| Pinia | 3.x | `defineStore("voice-flow", () => { ... })` |
| macOS Accessibility | AXIsProcessTrusted | Core Foundation API |
| MediaRecorder | Web Standard | getUserMedia + NotAllowedError |

### 不需要的 Cargo/NPM 依賴變更

本 Story **不需要安裝任何新依賴**。所有需要的技術已在 Story 1.1-1.4 安裝完畢。

### 現有檔案改動點

**修改檔案：**
```
src/components/NotchHud.vue             — 硬編碼英文文字改為 {{ message }}（僅改 template 3 處）
src/stores/useVoiceFlowStore.ts         — HOTKEY_ERROR listener 新增 accessibility_permission 偵測 + 開啟 Main Window
src/MainApp.vue                          — onMounted 新增 Accessibility 權限檢查 + AccessibilityGuide 掛載
src/lib/errorUtils.ts                    — 新增 getMicrophoneErrorMessage() helper
src-tauri/src/plugins/hotkey_listener.rs — 新增 check/open Tauri Commands（pub fn）
src-tauri/src/lib.rs                     — invoke_handler 註冊兩個新 command
```

**新增檔案：**
```
src/components/AccessibilityGuide.vue — macOS Accessibility 權限引導元件
```

**不修改的檔案（明確排除）：**
- `src/App.vue` — HUD Window 入口不變（權限引導在 Main Window 處理，不在 HUD）
- `src/lib/recorder.ts` — 錄音 API 不變
- `src/lib/transcriber.ts` — 轉錄 API 不變
- `src-tauri/src/plugins/clipboard_paste.rs` — 貼上邏輯不變
- `src-tauri/src/plugins/mod.rs` — 不需額外 export（新 commands 已是 pub fn）
- `src/composables/useTauriEvents.ts` — 事件工具不變
- `src/views/*.vue` — Main Window 頁面不變
- `Cargo.toml` / `package.json` — 不需新增依賴
- `capabilities/default.json` — 權限不變

### 安全規則提醒

- API Key 不在此 Story 涉及，但確保新增的 Tauri Commands 不暴露敏感資訊
- `check_accessibility_permission_command` 只回傳 boolean，無安全風險
- `open_accessibility_settings` 只開啟系統設定，無安全風險

### 效能注意事項

- **HUD 動畫不阻塞主流程** — CSS transition + animation 由 GPU 處理
- **HUD 狀態轉換目標 < 100ms** — 實際由 Tauri Events 驅動（< 10ms），視覺 transition 0.25-0.35s 是動畫時長而非延遲
- **Accessibility 檢查** — `AXIsProcessTrusted()` 是同步系統呼叫，< 1ms
- **權限引導不影響正常流程** — 僅在無權限時顯示，有權限時完全跳過

### 跨 Story 注意事項

- **Story 2.1** 會在 useVoiceFlowStore 中新增 `'enhancing'` 狀態流程，並在 NotchHud.vue 新增 `enhancing` 視覺表現。本 Story 不處理 `enhancing` 狀態的 HUD 顯示（HudStatus 型別已包含 `'enhancing'`，但 NotchHud.vue 目前無對應分支）
- **Story 5.1** 會建立完整的快捷鍵設定介面。本 Story 只處理 Accessibility 權限引導，不做快捷鍵設定 UI
- **本 Story 完成後**，Epic 1 的所有 Story (1.1-1.5) 完成，Epic 1 可標記為 `done`

### Project Structure Notes

- 新增 `AccessibilityGuide.vue` 放在 `src/components/`（共用 UI 元件目錄）
- 新增 Tauri Commands 放在 `hotkey_listener.rs`（同一 plugin 模組內，職責內聚），通過 `lib.rs` invoke_handler 註冊（遵循現有 `paste_text` 的模式）
- NotchHud.vue 修改僅在 template — 符合「資料由 store 驅動，元件只負責顯示」的模式
- AccessibilityGuide 整合在 `MainApp.vue`（非 App.vue）— 遵循「HUD 不做互動」的架構規則
- `getMicrophoneErrorMessage()` 放在 `errorUtils.ts`（與現有 `extractErrorMessage` 同檔，職責內聚）

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.5]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — NotchHud.vue]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Naming Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — Component Boundaries]
- [Source: _bmad-output/planning-artifacts/prd.md#狀態回饋 HUD FR26-FR28, FR35-FR36]
- [Source: _bmad-output/implementation-artifacts/1-4-voice-record-transcribe-paste.md — Dev Notes, 遷移策略]
- [Source: _bmad-output/project-context.md — Critical Implementation Rules, Framework-Specific Rules]
- [Source: Codebase — src/components/NotchHud.vue（中文化目標）]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（權限狀態擴展）]
- [Source: Codebase — src-tauri/src/plugins/hotkey_listener.rs（Accessibility 權限檢查）]
- [Source: Codebase — src/lib/recorder.ts（麥克風權限流程）]
- [Source: Codebase — src/App.vue（HUD Window 入口）]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (CLI)

### Debug Log References

- 2026-03-02 13:28 紅燈測試：`pnpm test -- tests/component/NotchHud.test.ts tests/unit/error-utils.test.ts tests/unit/use-voice-flow-store.test.ts`（預期失敗）
- 2026-03-02 13:29 綠燈測試：同指令通過，`Tests 58 passed`
- 2026-03-02 13:29 `cd src-tauri && cargo check` 通過
- 2026-03-02 13:29 `pnpm exec vue-tsc --noEmit` 通過
- 2026-03-02 13:29 `pnpm test` 通過，`Tests 58 passed`

### Completion Notes List

- ✅ 完成 NotchHud template 中文化（recording/transcribing/success 皆改為 `{{ message }}`）
- ✅ 完成 Rust Accessibility commands：`check_accessibility_permission_command`、`open_accessibility_settings`
- ✅ 完成 Main Window 權限引導元件 `AccessibilityGuide.vue` 與 `MainApp.vue` 掛載流程
- ✅ 完成 HOTKEY_ERROR fallback：偵測 `accessibility_permission` 後開啟並聚焦 `main-window`
- ✅ 完成麥克風錯誤中文化 helper 並整合至 `handleStartRecording()`，保留英文技術 log
- ✅ 新增/更新測試：NotchHud 文案、麥克風錯誤映射、accessibility fallback
- ⚠️ 尚未執行 GUI 手動驗證：Task 6.4 ~ 6.11（需在實機互動測試）
- ✅ [Code Review] 新增 `getTranscriptionErrorMessage()` 完整中文化轉錄錯誤路徑（AC #4）
- ✅ [Code Review] MainApp.vue 加 `navigator.userAgent` macOS 平台檢查，避免非 macOS 浪費 IPC
- ✅ [Code Review] NotchHud.vue `v-if` → `v-else-if` 鏈
- ✅ [Code Review] AccessibilityGuide.vue 加 `role="dialog"` `aria-modal` focus trap Escape 鍵
- ✅ [Code Review] 補 `src/types/events.ts` 至 File List、新增 AccessibilityGuide 測試、補 DOMException default 測試
- ✅ [Code Review] Tests 58 → 72 passed

### File List

- src/components/NotchHud.vue (modified)
- src/components/AccessibilityGuide.vue (added)
- src/MainApp.vue (modified)
- src/lib/errorUtils.ts (modified)
- src/stores/useVoiceFlowStore.ts (modified)
- src/types/events.ts (modified)
- src-tauri/src/plugins/hotkey_listener.rs (modified)
- src-tauri/src/lib.rs (modified)
- tests/component/NotchHud.test.ts (added)
- tests/component/AccessibilityGuide.test.ts (added)
- tests/unit/error-utils.test.ts (added)
- tests/unit/use-voice-flow-store.test.ts (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/1-5-hud-status-permission-guide.md (modified)

### Change Log

- 2026-03-02: 完成 Story 1.5 程式實作與自動化驗證（Task 1~5、Task 6.1~6.3），狀態維持 `in-progress`，待執行手動驗證 6.4~6.11。
- 2026-03-02: Code Review 修復 — 轉錄錯誤中文化（getTranscriptionErrorMessage）、MainApp 加 macOS 平台檢查、NotchHud v-else-if 鏈、AccessibilityGuide aria-modal + focus trap、補測試。Tests 72 passed。
