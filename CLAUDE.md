# SayIt — Claude Code 專案記憶檔

> Tauri v2 + Vue 3 + Rust 語音轉文字桌面應用
> 完整規則請讀：`_bmad-output/project-context.md`（99 條）

## Quick Reference

| 文件 | 路徑 | 用途 |
|------|------|------|
| 完整規則 | `_bmad-output/project-context.md` | 所有 AI Agent 實作規則（必讀） |
| UX/UI 規範 | `_bmad-output/planning-artifacts/ux-ui-design-spec.md` | UI 設計、色彩、元件規範 |
| 架構設計 | `_bmad-output/planning-artifacts/architecture.md` | 架構決策文件 |
| 設計稿 | `design.pen` | Pencil MCP 設計稿（UI 實作前必須先完成） |

## 雙視窗架構

```
 ┌─────────────────────────────────────────────────┐
 │                  Tauri Backend (Rust)            │
 │  lib.rs ─ plugins/ ─ clipboard_paste.rs         │
 │                      hotkey_listener.rs          │
 │                      keyboard_monitor.rs         │
 │                                                  │
 │  ┌─── invoke() ──┐     ┌─── emit() ────┐        │
 │  │               │     │               │        │
 │  ▼               ▼     ▼               ▼        │
 │ ┌──────────┐  ┌──────────────────────────┐      │
 │ │   HUD    │  │      Dashboard           │      │
 │ │ index.   │  │   main-window.html       │      │
 │ │ html     │  │   MainApp.vue + Router   │      │
 │ │ App.vue  │  │   4 views + DB + Store   │      │
 │ │ NotchHud │  │   shadcn-vue UI          │      │
 │ └──────────┘  └──────────────────────────┘      │
 │  label:main    label:main-window                │
 │  400x100       960x680 (min 720x480)            │
 │  transparent   decorations, resizable           │
 │  alwaysOnTop   預設隱藏                          │
 └─────────────────────────────────────────────────┘
```

## IPC 契約表

### Tauri Commands（Frontend → Rust）

| Command | Rust 位置 | 前端呼叫點 | 參數 | 回傳 |
|---------|-----------|-----------|------|------|
| `debug_log` | `lib.rs` | stores, main-window.ts | `level: String, message: String` | `()` |
| `update_hotkey_config` | `lib.rs` | useSettingsStore | `trigger_key: TriggerKey, trigger_mode: TriggerMode` | `Result<(), String>` |
| `get_hud_target_position` | `lib.rs` | — | `app: AppHandle` | `Result<HudTargetPosition, String>` |
| `paste_text` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | `text: String` | `Result<(), ClipboardError>` |
| `check_accessibility_permission_command` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `bool` |
| `open_accessibility_settings` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `Result<(), String>` |
| `reinitialize_hotkey_listener` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | `app: AppHandle` | `Result<(), String>` |
| `start_quality_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `mute_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `restore_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |

### Rust → Frontend Events

| Event | Rust 發送點 | 常量 | Payload |
|-------|------------|------|---------|
| `hotkey:pressed` | hotkey_listener.rs | `HOTKEY_PRESSED` | — |
| `hotkey:released` | hotkey_listener.rs | `HOTKEY_RELEASED` | — |
| `hotkey:toggled` | hotkey_listener.rs | `HOTKEY_TOGGLED` | `HotkeyEventPayload` |
| `hotkey:error` | hotkey_listener.rs | `HOTKEY_ERROR` | `HotkeyErrorPayload` |
| `quality-monitor:result` | keyboard_monitor.rs | `QUALITY_MONITOR_RESULT` | `QualityMonitorResultPayload` |

### Frontend-only Events（不經 Rust）

| Event | 常量 | 發送方 | 接收方 |
|-------|------|--------|--------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD VoiceFlow | Dashboard |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | VoiceFlow | Main Window |
| `settings:updated` | `SETTINGS_UPDATED` | SettingsStore | All Windows |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | VocabularyStore | All Windows |

## 自動更新機制

- **定時檢查** — `main-window.ts`：啟動 5 秒後首次檢查，之後每 4 小時（`setInterval`）
- **手動檢查** — `MainApp.vue` Sidebar Footer「檢查更新」按鈕，結果用 `useFeedbackMessage` 顯示
- **回傳型別** — `checkForAppUpdate()` → `Promise<UpdateCheckResult>`（`up-to-date` | `update-available` | `error`）
- **已知限制** — `autoUpdater.ts` 中 `window.confirm` 在 Tauri WKWebView 會被靜默忽略，未來需改用 in-app UI

## 依賴方向規則

```
  views/ ──→ components/ + stores/ + composables/
  stores/ ──→ lib/
  lib/ ──→ External APIs (Groq)

  ❌ views/ 不可直接 import lib/
  ❌ 元件不可直接執行 SQL
```

## 關鍵禁忌（最常違反的 8 條）

1. **❌ 瀏覽器原生 `fetch`** → 用 `@tauri-apps/plugin-http` 的 `fetch`
2. **❌ Options API** → 僅 `<script setup lang="ts">`
3. **❌ views 直接呼叫 lib** → 必須透過 Pinia store
4. **❌ SQLite 存 API Key** → 只存 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩** → 用語意變數（`bg-primary`, `text-foreground`）
6. **❌ `@tabler/icons-vue`** → 只用 `lucide-vue-next`
7. **❌ 手寫 UI 元件** → 用 shadcn-vue（new-york style），詳見下方「shadcn-vue 元件使用規則」
8. **❌ 直接 import Tauri event API** → 用 `useTauriEvents.ts` 封裝

## shadcn-vue 元件使用規則

### 禁止手寫替代品

| 需求 | ❌ 禁止 | ✅ 必須使用 |
|------|--------|-----------|
| 側邊欄 | 手寫 `<nav>` | `SidebarProvider` + `Sidebar` + `SidebarMenu` 等 |
| 側邊欄切換 | 自訂 emit + ref | `SidebarTrigger`（內建 `toggleSidebar()`） |
| 可點擊元素 | 原生 `<button>` + 手寫樣式 | `<Button>` + variant prop |
| 表單輸入 | 原生 `<input>` / `<select>` / `<textarea>` | `Input` / `Select` / `Textarea` |
| 表格 | 原生 `<table>` | `Table` + `TableHeader` + `TableBody` 等 |
| 開關 | 原生 checkbox | `Switch` |

### 元件 API 規範

- **variant 優先**：用 `variant="destructive"` 而非 `class="text-destructive border-destructive"`
- **Switch 綁定**：`:model-value` + `@update:model-value`（不是 `:checked`）
- **Select 綁定**：`:model-value` + `@update:model-value`
- **Label 無障礙**：Label 必須加 `for` 屬性，對應控制項加 `id`
- **Badge variant**：用 `variant="secondary"` 等 prop，不用 class 覆蓋整套樣式
- **RouterLink 在 Menu 中**：`<SidebarMenuButton as-child>` 包裹 `<RouterLink>`

### 樣式規則

- 語意色彩優先：`bg-card` / `text-foreground` / `border-border`
- 禁止硬編碼：`bg-zinc-900` / `text-white` / `border-zinc-700`
- 覆蓋元件樣式時只微調（如 padding、size），不覆蓋核心色彩

## 型別命名慣例

| 後綴 | 用途 | 範例 |
|------|------|------|
| `*Payload` | Tauri Event payload | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite 資料行 | `TranscriptionRecord` |
| `*Config` | 設定物件 | `HotkeyConfig` |
| `*Entry` | 字典/列表項目 | `VocabularyEntry` |
| `*Dto` | Store 間傳遞 | `SettingsDto` |
| `*Handle` | 資源控制 | `AudioAnalyserHandle` |

## SQLite 映射規則

- 表名：複數 snake_case（`transcriptions`）
- 欄位：snake_case（`raw_text`）→ TS camelCase（`rawText`）via `mapRowToRecord()`
- 布林：`INTEGER` → `row.was_enhanced === 1`
- null 布林：`INTEGER | null` → `row.was_modified === null ? null : row.was_modified === 1`
- 主鍵：`TEXT`（UUID，前端 `crypto.randomUUID()`）
- 參數語法：`$1, $2`（tauri-plugin-sql）

## 保護檔案（Hooks 自動攔截）

| 檔案 | 保護等級 |
|------|---------|
| `Cargo.lock`, `pnpm-lock.yaml` | 🔴 Hard block（禁止修改） |
| `tauri.conf.json`, `Cargo.toml` | 🟡 警告（需確認必要性） |

## 常用指令

| 指令 | 用途 |
|------|------|
| `pnpm tauri dev` | 開發模式 |
| `pnpm build` | 完整建構（含 vue-tsc） |
| `pnpm test` | 跑 Vitest |
| `pnpm test:coverage` | 覆蓋率報告 |
| `npx vue-tsc --noEmit` | 型別檢查 |
| `./scripts/release.sh X.Y.Z` | 發版（更新版本號 + tag + push） |

## CI/CD Pipeline

```
 push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────┐
 │  ci.yml  │         │  release.yml    │
 │ vue-tsc  │         │ 3 matrix jobs:  │
 │ vitest   │         │  macOS ARM      │
 └──────────┘         │  macOS Intel    │
                      │  Windows x64    │
                      │                 │
                      │ + Apple Signing │
                      │ + Notarization  │
                      │ + Updater .sig  │
                      └────────┬────────┘
                               │
                          Draft Release
                         （手動 Publish）
```

### GitHub Secrets（8 個）

| Secret | 用途 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater 簽署私鑰 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私鑰密碼 |
| `APPLE_CERTIFICATE` | Developer ID .p12 (Base64) |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 密碼 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Tai-Cheng Chen (G9J8D2T6DV)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-Specific Password |
| `APPLE_TEAM_ID` | `G9J8D2T6DV` |

### 固定下載連結（官網用）

| 平台 | URL |
|------|-----|
| macOS ARM | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-arm64.dmg` |
| macOS Intel | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-x64.dmg` |
| Windows | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-windows-x64.exe` |

## Subagent

- **tauri-reviewer** — 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別）
