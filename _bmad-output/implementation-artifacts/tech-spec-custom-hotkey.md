---
title: '自訂快捷鍵支援（Custom Hotkey）'
slug: 'custom-hotkey'
created: '2026-03-05'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 Composition API', 'Rust', 'CGEventTap (macOS)', 'SetWindowsHookExW (Windows)', 'tauri-plugin-store', 'shadcn-vue', 'Pinia']
files_to_modify: ['src/types/settings.ts', 'src/stores/useSettingsStore.ts', 'src/views/SettingsView.vue', 'src-tauri/src/plugins/hotkey_listener.rs', 'src-tauri/src/lib.rs', 'src/lib/errorUtils.ts', 'src/lib/keycodeMap.ts']
code_patterns: ['TriggerKey closed enum → open enum with Custom variant', 'serde tagged enum for Rust↔JSON', 'DOM keydown for recording → platform keycode mapping', 'two-tier UI: preset Select + custom Record']
test_patterns: ['Vitest unit tests in tests/unit/', 'Rust #[cfg(test)] mod tests in same file']
reviewed: true
review_findings_addressed: 15
---

# Tech-Spec: 自訂快捷鍵支援（Custom Hotkey）

**Created:** 2026-03-05

## Overview

### Problem Statement

目前使用者只能從固定的 9 個修飾鍵（Fn、Option、Control、Command、Shift 等）中選擇觸發鍵，無法使用其他按鍵（如 F5、CapsLock、~ 等非修飾鍵）。這限制了使用者根據自身習慣配置最順手的快捷鍵。

### Solution

採用兩層設計：
- **簡易模式**（現狀保留）：Select 下拉選單，提供平台推薦的修飾鍵快速選擇
- **進階模式**（新增）：按鍵錄製（Record）UI，使用者點擊錄製按鈕後按下任意單鍵，系統自動捕捉為觸發鍵

包含衝突偵測機制——若使用者選擇的按鍵為常見系統快捷鍵，顯示警告但仍允許設定。

自訂鍵設定獨立持久化——切換模式不會遺失設定。

### Scope

**In Scope:**
- 前端：簡易模式 / 進階模式切換 UI
- 前端：按鍵錄製 UI（點擊「錄製」→ 按任意鍵 → 捕捉並顯示按鍵名稱）
- 前端：衝突偵測警告（危險鍵 + 已有 preset 的鍵）
- 前端：DOM keydown 盲區說明（Fn、媒體鍵等系統鍵無法錄製）
- Rust (macOS)：擴充 CGEventTap 回呼支援任意 keycode 比對（FlagsChanged + KeyDown/KeyUp）
- Rust (Windows)：擴充 SetWindowsHookExW 回呼支援任意 VK code 比對
- Rust：`TriggerKey` 型別擴充 + serde 序列化測試驗證
- Store：獨立持久化 custom key（`customTriggerKey` 欄位），切模式不遺失
- IPC：`update_hotkey_config` command 擴充支援 custom keycode

**Out of Scope:**
- 複合組合鍵（Cmd+Shift+X 等多鍵同時按下）
- 修改 HUD 動畫或錄音流程
- 觸發模式變更（Hold/Toggle 維持現狀，與本功能正交）

## Context for Development

### Codebase Patterns

1. **TriggerKey 封閉 enum 鏡像模式**：Rust `TriggerKey` enum 與 TS `TriggerKey` 字串聯合型別完全鏡像，透過 `#[serde(rename_all = "camelCase")]` 序列化為 JSON。前端用字串字面型別（`"fn" | "option" | ...`），Rust 用 enum variant。
2. **設定持久化鏈路**：UI → `useSettingsStore.saveHotkeyConfig()` → `tauri-plugin-store` 寫入 `settings.json` → `invoke("update_hotkey_config")` 同步 Rust state → `emitEvent(SETTINGS_UPDATED)` 廣播所有視窗。
3. **Rust 鍵碼比對模式**：macOS 透過 `matches_trigger_key_macos(keycode, &trigger)` 比對 CGEventTap 回傳的 keycode；Windows 在 `hook_proc` 中用 `match trigger { ... kbd.vkCode == VK_XXX }` 比對。兩者都是封閉 match，新增 `Custom` variant 需在兩處加入分支。
4. **修飾鍵 vs 一般鍵的事件差異**：macOS CGEventTap 中，修飾鍵只觸發 `FlagsChanged` 事件（flag-based 檢測），一般鍵觸發 `KeyDown`/`KeyUp`。目前只監聽 `FlagsChanged`+Fn fallback，支援一般鍵需要**擴充 `KeyDown`/`KeyUp` 處理分支**。
5. **DOM keyCode vs 平台 keycode 差異**：WebView `KeyboardEvent.code` 是 Web 標準（如 `"F5"`、`"KeyA"`），需映射到 macOS keycode（如 F5=96）和 Windows VK code（如 F5=0x74）。
6. **DOM keydown 盲區**：Fn 鍵不觸發 DOM keydown 事件（無 `"Fn"` code）、Media keys 被系統攔截、CapsLock 在 WKWebView 中 keyup 行為不一致。錄製 UI 必須處理「按了但收不到事件」的情況。
7. **平台偵測**：現有程式碼用 `navigator.userAgent.includes("Mac")`（`useSettingsStore.ts:26`、`SettingsView.vue:44`），新模組應統一使用同一偵測方式。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/types/settings.ts:4-18` | `TriggerKey` 型別定義、`HotkeyConfig` 介面 |
| `src/stores/useSettingsStore.ts:25-28` | `getDefaultTriggerKey()` 平台預設 |
| `src/stores/useSettingsStore.ts:53-65` | `syncHotkeyConfigToRust()` — invoke IPC |
| `src/stores/useSettingsStore.ts:129-158` | `saveHotkeyConfig()` — 持久化 + 同步 + 廣播 |
| `src/views/SettingsView.vue:43-88` | 快捷鍵 UI 區塊（Select + mode toggle） |
| `src/views/SettingsView.vue:309-389` | 快捷鍵 template |
| `src-tauri/src/plugins/hotkey_listener.rs:12-27` | Rust `TriggerKey` enum |
| `src-tauri/src/plugins/hotkey_listener.rs:49-74` | `HotkeyListenerState` + `update_config()` |
| `src-tauri/src/plugins/hotkey_listener.rs:78-129` | `handle_key_event()` — Hold/Toggle 邏輯（不需修改） |
| `src-tauri/src/plugins/hotkey_listener.rs:142-150` | macOS keycode 常數 |
| `src-tauri/src/plugins/hotkey_listener.rs:213-224` | `matches_trigger_key_macos()` — 鍵碼比對 |
| `src-tauri/src/plugins/hotkey_listener.rs:228-241` | `is_modifier_pressed()` — flag 檢測 |
| `src-tauri/src/plugins/hotkey_listener.rs:260-334` | CGEventTap 回呼（FlagsChanged/KeyDown/KeyUp） |
| `src-tauri/src/plugins/hotkey_listener.rs:379-389` | Windows VK code 常數 |
| `src-tauri/src/plugins/hotkey_listener.rs:441-477` | Windows `hook_proc` — VK code 比對 |
| `src-tauri/src/lib.rs:87-99` | `update_hotkey_config` Tauri command |
| `src/lib/errorUtils.ts` | 錯誤訊息本地化 |

### Technical Decisions

**TD-1: TriggerKey 擴充為 tagged union**

Rust:
```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerKey {
    Fn, Option, RightOption, Command,
    RightAlt, LeftAlt,
    Control, RightControl, Shift,
    Custom { keycode: u16 },
}
```

TypeScript:
```typescript
export type PresetTriggerKey =
  | "fn" | "option" | "rightOption" | "command"
  | "rightAlt" | "leftAlt"
  | "control" | "rightControl" | "shift";

export interface CustomTriggerKey {
  custom: { keycode: number };
}

export type TriggerKey = PresetTriggerKey | CustomTriggerKey;
```

Serde externally tagged 表示法將 `Custom { keycode: 96 }` 序列化為 `{ "custom": { "keycode": 96 } }`。**此假設必須用 Rust 單元測試 `assert_eq!(serde_json::to_string(...), ...)` 驗證，不可僅靠口頭斷言**。（Review F1）

**keycode 語意**：`keycode: u16` 的值在 macOS 是 CGEvent keycode，在 Windows 是 VK code。兩者數值體系完全不同（如 F5: macOS=96, Windows=0x74）。此欄位為平台相依值，不可跨平台使用。（Review F5）

**TD-2: 按鍵錄製使用前端 DOM `keydown` + 映射表**

新增 `src/lib/keycodeMap.ts`，匯出：
- `domCodeToMacKeycode: Record<string, number>` — DOM `event.code` → macOS keycode
- `domCodeToWindowsVkCode: Record<string, number>` — DOM `event.code` → Windows VK code
- `KEY_DISPLAY_NAMES: Record<string, string>` — `event.code` → 顯示名稱
- `getPlatformKeycode(domCode: string): number | null` — 取得當前平台的原生 keycode
- `getKeyDisplayName(domCode: string): string` — 取得按鍵顯示名稱
- `DANGEROUS_KEYS: Set<string>` — 衝突偵測用的危險鍵清單
- `PRESET_DOM_CODES: Set<string>` — 對應現有 preset 修飾鍵的 DOM code 集合（用於提示使用者切回簡易模式）
- `isDangerousKey(domCode: string): boolean`
- `isPresetEquivalentKey(domCode: string): boolean` — 檢查是否為已有 preset 的修飾鍵

平台偵測使用與現有程式碼一致的 `navigator.userAgent.includes("Mac")` 方式。（Review F6：統一現有做法而非引入新依賴）

**已知 DOM keydown 盲區**（Review F3）：
- **Fn 鍵**：不觸發 DOM keydown（無 `"Fn"` code），完全無法錄製
- **Media keys**（播放/暫停/音量）：被 macOS 系統攔截，WebView 收不到
- **Power / Eject / Touch Bar 專用鍵**：不產生 DOM 事件
- CapsLock 的 keyup 在某些 WebView 中不觸發

→ 錄製 UI 超時訊息改為「未偵測到按鍵，部分系統鍵（Fn、媒體鍵）無法錄製，請使用簡易模式」

**TD-3: CGEventTap 回呼擴充 KeyDown/KeyUp 處理**

Custom key 若為非修飾鍵，不會觸發 `FlagsChanged`，需在 `KeyDown`/`KeyUp` 分支加入：
```rust
CGEventType::KeyDown => {
    if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
        if keycode == *custom_kc {
            handle_key_event(&app_handle, true, &state);
        }
    }
    // existing Fn fallback...
}
```

若 Custom key 恰好是修飾鍵，`FlagsChanged` 分支也需處理（toggle-based 檢測）：
```rust
CGEventType::FlagsChanged => {
    // ...existing modifier logic...
    if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
        if keycode == *custom_kc {
            let was_pressed = state.is_pressed.load(Ordering::SeqCst);
            handle_key_event(&app_handle, !was_pressed, &state);
        }
    }
}
```

**CapsLock 注意**（Review F4）：CapsLock（keycode 57）在 macOS 的 `FlagsChanged` 行為特殊——按住不放時只觸發一次事件，且 macOS 有系統層級延遲（長按切換輸入法）。toggle-based 檢測在 Hold 模式下可能不可靠。已將 CapsLock 加入 `DANGEROUS_KEYS` 並標註警告。

**TD-4: Windows hook_proc 擴充**

```rust
let matches = match trigger {
    TriggerKey::RightAlt => kbd.vkCode == VK_RMENU,
    // ...existing...
    TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32,
};
```

`u16 as u32` 零擴展安全，Windows VK code 實際範圍 0-254 不會超過 u16 上限。

**TD-5: 衝突偵測清單**

`DANGEROUS_KEYS` 包含（Review F9 擴充）：
- **通用危險鍵**：`Escape`, `Enter`, `Space`, `Tab`, `Backspace`, `Delete`
- **系統鍵**：`MetaLeft`, `MetaRight`（Win/Cmd）
- **CapsLock**（macOS 行為不可靠，額外警告標註）
- **功能鍵風險**：`F1`（Help）, `F11`（全螢幕）, `PrintScreen`, `NumLock`, `ScrollLock`, `Insert`, `Pause`

**TD-6: 按鍵顯示名稱**

映射表同時提供 displayName，UI 顯示人類可讀名稱。持久化存 keycode 數字，顯示時查表。

**TD-7: 自訂鍵獨立持久化**（Review F7）

`settings.json` 結構：
```json
{
  "hotkeyTriggerKey": "fn",
  "hotkeyTriggerMode": "hold",
  "customTriggerKey": { "custom": { "keycode": 96 } },
  "customTriggerKeyDomCode": "F5"
}
```

- `hotkeyTriggerKey`：當前 active 的觸發鍵（preset 或 custom 值）
- `customTriggerKey`：獨立保存的自訂鍵設定（切到簡易模式時保留，不清除）
- `customTriggerKeyDomCode`：保存 DOM code 字串，用於反查顯示名稱（避免 keycode → display name 的反向映射）

切到簡易模式 → `hotkeyTriggerKey` 改為 preset 值，`customTriggerKey` 不動
切回自訂模式 → `hotkeyTriggerKey` 改為 `customTriggerKey` 的值

**TD-8: 錄到已有 preset 鍵的處理**（Review F12）

當錄製的 `event.code` 在 `PRESET_DOM_CODES` 中（如 `"ShiftLeft"` → 對應 preset `Shift`），顯示提示：「此按鍵已在簡易模式中可用，建議切換至簡易模式」。不阻擋，使用者可忽略繼續存為 Custom。

## Implementation Plan

### Task 依賴（Review F8）

```
Task 1 (keycodeMap) ──→ Task 2 (TS 型別) ──→ Task 5 (Store) ──→ Task 6 (UI)
                                            ↗                       ↑
                        Task 3 (Rust macOS) ─┘                      │
                        Task 4 (Rust Windows)─┘                     │
                        Task 7 (errorUtils) ────────────────────────┘
```

建議執行順序：`1 → 2 → [3, 4 平行] → 5 → 7 → 6`

### Tasks

- [x] **Task 1: 新增按鍵映射模組 `src/lib/keycodeMap.ts`**
  - File: `src/lib/keycodeMap.ts`（新建）
  - Action: 建立 DOM `event.code` → 平台原生 keycode 映射表
  - 內容：
    - `domCodeToMacKeycode` 映射（覆蓋 F1-F12、字母鍵 A-Z、數字鍵 0-9、符號鍵、CapsLock、功能鍵等約 80-100 鍵）
    - `domCodeToWindowsVkCode` 映射（同上範圍）
    - `KEY_DISPLAY_NAMES: Record<string, string>` — `event.code` → 顯示名稱（如 `"F5"`, `"CapsLock"`, `"A"`）
    - `getPlatformKeycode(domCode: string): number | null` — 平台偵測用 `navigator.userAgent.includes("Mac")`，與現有程式碼一致
    - `getKeyDisplayName(domCode: string): string` — 返回顯示名稱，fallback 為 `domCode` 本身
    - `DANGEROUS_KEYS: Set<string>` — 完整清單：`Escape, Enter, Space, Tab, Backspace, Delete, MetaLeft, MetaRight, CapsLock, F1, F11, PrintScreen, NumLock, ScrollLock, Insert, Pause`
    - `isDangerousKey(domCode: string): boolean`
    - `PRESET_DOM_CODES: Set<string>` — `ShiftLeft, ShiftRight, ControlLeft, ControlRight, AltLeft, AltRight, MetaLeft, MetaRight` 等對應現有 preset 的 DOM code
    - `isPresetEquivalentKey(domCode: string): boolean`
    - `getDangerousKeyWarning(domCode: string): string | null` — CapsLock 回傳額外警告「macOS 上 CapsLock 在 Hold 模式下可能不穩定」，其他危險鍵回傳通用警告
  - Notes: 純函式模組，無 Vue/Tauri 依賴。平台偵測函式接受可選參數方便測試。

- [x] **Task 2: 擴充 TypeScript 型別定義**
  - File: `src/types/settings.ts`
  - Action: 將 `TriggerKey` 從字串聯合型別擴充為支援 custom variant
  - 具體變更：
    ```typescript
    export type PresetTriggerKey =
      | "fn" | "option" | "rightOption" | "command"
      | "rightAlt" | "leftAlt"
      | "control" | "rightControl" | "shift";

    export interface CustomTriggerKey {
      custom: { keycode: number };
    }

    export type TriggerKey = PresetTriggerKey | CustomTriggerKey;

    export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
      return typeof key === "string";
    }

    export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
      return typeof key === "object" && "custom" in key;
    }
    ```
  - Notes: `HotkeyConfig` 介面不變。型別守衛供 UI 和 Store 判斷使用。

- [x] **Task 3: 擴充 Rust `TriggerKey` enum + serde 測試**
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `TriggerKey` enum 新增 `Custom` variant + 擴充 macOS 處理
  - 具體變更：
    - 在 enum 末尾新增 `Custom { keycode: u16 }`
    - 在 `matches_trigger_key_macos()` 新增：`TriggerKey::Custom { keycode: custom_kc } => keycode == *custom_kc`
    - 在 `is_modifier_pressed()` 新增：`TriggerKey::Custom { .. } => None`
    - 擴充 CGEventTap 回呼 `FlagsChanged`：Custom + keycode 匹配 → toggle-based 檢測
    - 擴充 CGEventTap 回呼 `KeyDown`：Custom + keycode 匹配 → `handle_key_event(true)`
    - 擴充 CGEventTap 回呼 `KeyUp`：Custom + keycode 匹配 → `handle_key_event(false)`
    - **新增 `#[cfg(test)]` 測試**（Review F1）：
      - `test_custom_trigger_key_serde_serialize`：`assert_eq!(serde_json::to_value(TriggerKey::Custom { keycode: 96 }).unwrap(), json!({"custom": {"keycode": 96}}))`
      - `test_custom_trigger_key_serde_deserialize`：從 `json!({"custom": {"keycode": 96}})` 反序列化
      - `test_preset_trigger_key_serde_roundtrip`：驗證 `"fn"` 字串序列化/反序列化不受 Custom variant 影響
      - `test_matches_trigger_key_macos_custom`：驗證 Custom variant 的比對
  - Notes: `handle_key_event()` 不需修改

- [x] **Task 4: 擴充 Windows hook_proc**
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 在 `windows_hook` 模組的 `hook_proc` match 分支加入 Custom
  - 具體變更：`TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32`
  - Notes: Windows hook 已統一處理 KeyDown/KeyUp，不需額外分支。可與 Task 3 平行。

- [x] **Task 5: 擴充 Pinia Store（獨立持久化）**
  - File: `src/stores/useSettingsStore.ts`
  - Action: 支援 `CustomTriggerKey` + 獨立持久化自訂鍵設定
  - 具體變更：
    - 新增 state：`customTriggerKey: ref<CustomTriggerKey | null>(null)` 和 `customTriggerKeyDomCode: ref<string>("")`
    - `saveHotkeyConfig(key: TriggerKey, mode: TriggerMode)`：若 key 為 custom，同時寫入 `hotkeyTriggerKey` 和 `customTriggerKey` + `customTriggerKeyDomCode`
    - `saveCustomTriggerKey(keycode: number, domCode: string, mode: TriggerMode)`：新增專用函式，同時更新 active key 和 custom key 儲存
    - `switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode)`：切到簡易模式，只更新 `hotkeyTriggerKey`，不清除 `customTriggerKey`
    - `switchToCustomMode(mode: TriggerMode)`：切到自訂模式，從 `customTriggerKey` 還原 active key
    - `loadSettings()`：額外讀取 `customTriggerKey` 和 `customTriggerKeyDomCode`
    - 新增 helper：`getTriggerKeyDisplayName(key: TriggerKey): string`
    - **修正 log 格式**（Review F13）：`console.log(\`[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}\`)`
    - **向後相容驗證**（Review F2）：`loadSettings()` 中加入防禦：若 `store.get("hotkeyTriggerKey")` 回傳字串，直接當 PresetTriggerKey 使用；若回傳物件，當 CustomTriggerKey 使用
  - Notes: `syncHotkeyConfigToRust()` 簽名不變，Rust serde 自動處理

- [x] **Task 6: 實作按鍵錄製 UI + 兩層切換**
  - File: `src/views/SettingsView.vue`
  - Action: 在快捷鍵設定 Card 中新增兩層 UI
  - 具體變更：
    - **模式切換**：在觸發鍵 Select 上方新增「簡易 / 自訂」切換（用兩個按鈕，類似現有 Hold/Toggle 切換樣式）
    - **簡易模式**（`isCustomMode = false`）：保持現有 Select 下拉邏輯不變
    - **自訂模式**（`isCustomMode = true`）：
      - 顯示當前自訂鍵名稱（從 `customTriggerKeyDomCode` 查表）或「未設定」
      - 一個「錄製」Button，點擊後進入錄製狀態
      - 錄製狀態：Button 文字變為「請按下按鍵...」，脈動動畫（`animate-pulse`）
      - **動態註冊 keydown listener**（Review F11）：僅在 `isRecording = true` 時 `addEventListener`，錄製結束時 `removeEventListener`。不要掛整個元件生命週期。
      - 錄製 keydown handler：
        - `event.preventDefault()` + `event.stopPropagation()`
        - Escape → 取消錄製
        - 捕捉 `event.code` → `getPlatformKeycode()` 取得 keycode
        - keycode 為 null → 顯示「不支援此按鍵」錯誤
        - `isDangerousKey()` → 顯示黃色警告（`getDangerousKeyWarning()` 取得訊息），仍儲存
        - `isPresetEquivalentKey()` → 顯示提示「此按鍵已在簡易模式中可用，建議切換至簡易模式」（Review F12），仍儲存
        - 正常 → `settingsStore.saveCustomTriggerKey(keycode, domCode, currentMode)`
      - 錄製超時 10 秒，超時訊息：「未偵測到按鍵。部分系統鍵（Fn、媒體鍵）無法錄製，請使用簡易模式。」（Review F3）
      - 錄製按鈕下方小字：「Fn、媒體鍵等系統鍵請使用簡易模式」（Review F3）
    - **模式切換聯動**（Review F7）：
      - 從簡易切到自訂：若有保存的 `customTriggerKey`，自動還原為 active key；否則顯示「未設定」等待錄製
      - 從自訂切到簡易：active key 切回平台預設 preset key，**但 `customTriggerKey` 保留不清除**
    - **初始化**：`onMounted` 時根據 `settingsStore.hotkeyConfig?.triggerKey` 判斷是 preset 還是 custom，設定 `isCustomMode` 初始值
    - **系統級快捷鍵限制說明**（Review F10）：`event.preventDefault()` 無法攔截系統級快捷鍵（Cmd+Q、Win+L 等），在錄製 UI 不需額外處理，但超時提示已覆蓋此情境
  - Notes: 使用 shadcn-vue `Button` 元件。警告用黃色（`text-yellow-400` 或語意色彩），提示用藍色（`text-blue-400`）。

- [x] **Task 7: 新增衝突警告錯誤訊息**
  - File: `src/lib/errorUtils.ts`
  - Action: 新增快捷鍵相關警告/提示訊息函式
  - 具體變更：
    - `getHotkeyConflictWarning(domCode: string): string` — 通用：「此按鍵（{displayName}）可能與系統快捷鍵衝突，建議選擇其他按鍵」
    - `getHotkeyCapslockWarning(): string` — CapsLock 專用：「CapsLock 在 macOS 的 Hold 模式下可能不穩定，建議使用 Toggle 模式或選擇其他按鍵」
    - `getHotkeyPresetHint(domCode: string): string` — preset 提示：「此按鍵已在簡易模式中可用，建議切換至簡易模式」
    - `getHotkeyRecordingTimeoutMessage(): string` — 超時：「未偵測到按鍵。部分系統鍵（Fn、媒體鍵）無法錄製，請使用簡易模式。」
    - `getHotkeyUnsupportedKeyMessage(): string` — 不支援：「不支援此按鍵」
  - Notes: 所有訊息繁體中文。警告為黃色（非錯誤），提示為藍色。

### Acceptance Criteria

- [x] **AC 1**: Given 使用者在簡易模式下, when 從 Select 選擇 "Fn" 觸發鍵, then 行為與現有功能完全相同（向後相容）
- [x] **AC 2**: Given 使用者切換到自訂模式, when 點擊「錄製」按鈕並按下 F5 鍵, then 系統捕捉 F5 並顯示「F5」作為當前觸發鍵
- [x] **AC 3**: Given 使用者已錄製 F5 為觸發鍵, when 在任意應用程式中按下 F5, then SayIt 觸發錄音（Hold 模式：按住開始、放開停止）
- [x] **AC 4**: Given 使用者已錄製 F5 為觸發鍵（Toggle 模式）, when 按下 F5, then SayIt 開始錄音；再按 F5 則停止錄音
- [x] **AC 5**: Given 使用者在錄製狀態中, when 按下 Escape, then 取消錄製（不設定觸發鍵），回到非錄製狀態
- [x] **AC 6**: Given 使用者在錄製狀態中, when 等待超過 10 秒未按鍵, then 自動取消錄製，顯示「未偵測到按鍵。部分系統鍵（Fn、媒體鍵）無法錄製，請使用簡易模式。」
- [x] **AC 7**: Given 使用者在錄製狀態中, when 按下 Enter 鍵, then 顯示黃色警告「此按鍵可能與系統快捷鍵衝突」，但仍成功設定為觸發鍵
- [x] **AC 8**: Given 使用者在錄製狀態中, when 按下 WebView 無法映射的按鍵, then 顯示「不支援此按鍵」錯誤，不設定觸發鍵
- [x] **AC 9**: Given 使用者設定自訂鍵後關閉並重啟 App, when App 啟動載入 settings.json, then 自訂鍵正確還原，Rust 端正確監聽
- [x] **AC 10**: Given 使用者設定自訂鍵後, when 切回簡易模式再切回自訂模式, then 自訂鍵設定仍保留（不需重新錄製）
- [x] **AC 11**: Given 舊版 settings.json 存有 `"hotkeyTriggerKey": "fn"`, when 新版 App 啟動, then 正確讀取為 preset 觸發鍵（向後相容）
- [x] **AC 12（macOS）**: Given 使用者錄製 CapsLock 為觸發鍵, when 按下 CapsLock, then CGEventTap 的 FlagsChanged 正確觸發 handle_key_event，且顯示 CapsLock 專用警告
- [x] **AC 13（Windows）**: Given 使用者錄製 F5 為觸發鍵, when 按下 F5, then Windows keyboard hook 正確觸發 handle_key_event
- [x] **AC 14**: Given 使用者在自訂模式錄製了 Left Shift（已有 preset）, when 錄製完成, then 顯示藍色提示「此按鍵已在簡易模式中可用」，仍儲存為 custom key
- [x] **AC 15**: Given Rust 端 `TriggerKey::Custom { keycode: 96 }`, when serde 序列化, then 輸出為 `{"custom":{"keycode":96}}`（有 Rust 單元測試驗證）
- [x] **AC 16**: Given 使用者在非錄製狀態, when 在設定頁面輸入 API Key 或 Prompt 文字, then keydown listener 不會被觸發（動態註冊）

## Additional Context

### Dependencies

- 無新外部依賴——僅新增一個 `src/lib/keycodeMap.ts` 內部映射模組
- Rust 端無新 crate 依賴——`Custom { keycode: u16 }` 直接用現有 serde 序列化
- 依賴現有模組：`useFeedbackMessage` composable（顯示警告/成功訊息）、shadcn-vue `Button` 元件

### Testing Strategy

**單元測試（Vitest）：**
- `tests/unit/keycode-map.test.ts`：
  - `getPlatformKeycode()` 對常見鍵的映射正確性（F1-F12, A-Z, 0-9, CapsLock）
  - `isDangerousKey()` 偵測完整清單
  - `isPresetEquivalentKey()` 偵測
  - `getKeyDisplayName()` 回傳值
  - `getDangerousKeyWarning()` 對 CapsLock 回傳專用警告
- `tests/unit/types.test.ts`：擴充現有測試，驗證 `isPresetTriggerKey()` / `isCustomTriggerKey()` 型別守衛

**Rust 測試：**
- 在 `hotkey_listener.rs` 的 `#[cfg(test)]` 中新增：
  - `test_custom_trigger_key_serde_serialize`：精確驗證 JSON 輸出
  - `test_custom_trigger_key_serde_deserialize`：驗證反序列化
  - `test_preset_trigger_key_backward_compat`：驗證 `"fn"` 字串不受新 variant 影響
  - `test_matches_trigger_key_macos_custom`：驗證 Custom variant 的比對

**手動測試：**
- macOS: 錄製 F5 → 按 F5 觸發錄音 → 放開停止
- macOS: 錄製 CapsLock → 測試 FlagsChanged 路徑 + 警告顯示
- Windows: 錄製 F5 → 按 F5 觸發錄音
- 兩平台：簡易↔自訂模式切換（自訂鍵保留驗證）、App 重啟還原、Escape 取消、10 秒超時訊息
- 向後相容：用舊版 settings.json 啟動新版 App

### Notes

- **高風險項：DOM keyCode → macOS keycode 映射表準確性**。映射表需手動維護，若有遺漏會導致「不支援此按鍵」。建議先覆蓋最常見的 80 個鍵，後續根據使用者回報補充。
- **CapsLock 在 macOS 的特殊行為**：CapsLock 觸發 `FlagsChanged` 事件（keycode 57），有系統層級延遲（長按切換輸入法），且 Hold 模式下可能不可靠。已加入 `DANGEROUS_KEYS` + 專用警告。
- **Hold 模式 + 一般鍵的語意**：一般鍵（如 F5）有明確的 KeyDown/KeyUp，Hold 模式語意清晰。修飾鍵和 CapsLock 走 FlagsChanged toggle-based 路徑。
- **DOM keydown 盲區**：Fn、Media keys、Power 等完全不觸發 DOM 事件，錄製 UI 已加入超時提示和說明文字。
- **系統級快捷鍵**：`event.preventDefault()` 無法攔截 Cmd+Q、Win+L 等。錄製中按這些鍵可能導致 App 退出或系統鎖定，此為 OS 層級限制，不做額外處理。
- 觸發模式（Hold / Toggle）與本功能正交，`handle_key_event()` 不需修改。
- 向後相容：serde externally tagged enum 對舊格式字串（如 `"fn"`）反序列化為 unit variant，Custom variant 不影響。Rust 測試驗證此假設。
