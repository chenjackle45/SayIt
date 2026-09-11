# SayIt — Claude Code 專案記憶檔

> Tauri v2 + Vue 3 + Rust 語音轉文字桌面應用。單人維護、有社群 PR、macOS／Windows 雙平台發版。
> 規則分三層（2026-09-11 起）：本檔只放全 repo 都要知道的；`.claude/rules/*.md` 依檔頭 `paths` 自動載入；流程走 `docs/development-process.md`。`_bmad-output/project-context.md` 降為歷史參考，不再新增。

## 讀什麼

| 想知道 | 讀哪裡 |
|------|------|
| 從需求到發版怎麼走、社群 PR 怎麼接、閘門多重 | `docs/development-process.md` |
| 對外說過要做什麼、交付了沒 | `docs/community-commitments.md`（發版前必對帳） |
| 五種常見改動的食譜、pre-commit 清單 | `docs/development-guide.md` |
| IPC 契約表、Tauri macOS 注意事項 | `.claude/rules/ipc.md`（碰 `src-tauri/**` 自動載入） |
| shadcn-vue、拍板 demo | `.claude/rules/ui.md`（碰 `src/views`／`src/components`） |
| 五語系、更新摘要彈窗 | `.claude/rules/i18n.md` |
| CI、發版硬規則、Secrets、自動更新 | `.claude/rules/release.md`（碰 `.github`／`scripts`／版本檔） |
| Windows 鍵盤 hook、貼上時序 | `.claude/rules/windows.md`（碰四個 Windows 相關 plugin） |
| UX/UI 規範 | `_bmad-output/planning-artifacts/ux-ui-design-spec.md` |
| 架構決策 | `_bmad-output/planning-artifacts/architecture.md` |

Codex 不會依 `paths` 自動載入 rules，派工時把相關那檔路徑寫進任務檔。

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

## 依賴方向規則

```
  views/ ──→ components/ + stores/ + composables/
  stores/ ──→ lib/
  lib/ ──→ External APIs (Groq / OpenAI / Anthropic)

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
7. **❌ 手寫 UI 元件** → 用 shadcn-vue（new-york style），細則見 `.claude/rules/ui.md`
8. **❌ 直接 import Tauri event API** → 用 `useTauriEvents.ts` 封裝

## 型別命名慣例

| 後綴 | 用途 | 範例 |
|------|------|------|
| `*Payload` | Tauri Event payload | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite 資料行 | `TranscriptionRecord` |
| `*Config` | 設定物件 | `HotkeyConfig` |
| `*Entry` | 字典/列表項目 | `VocabularyEntry` |
| `*Dto` | Store 間傳遞 | — |
| `*Handle` | 資源控制 | `AudioAnalyserHandle` |

## SQLite 映射規則

- 表名：複數 snake_case（`transcriptions`）
- 欄位：snake_case（`raw_text`）→ TS camelCase（`rawText`）via `mapRowToRecord()`
- 布林：`INTEGER` → `row.was_enhanced === 1`
- null 布林：`INTEGER | null` → `row.was_modified === null ? null : row.was_modified === 1`
- 主鍵：`TEXT`（UUID，前端 `crypto.randomUUID()`）
- 參數語法：`$1, $2`（tauri-plugin-sql）
- 加欄位只追加新版 migration，**絕不改舊 migration**（食譜見 `docs/development-guide.md` §4.3）

## 自動化 Hooks（`.claude/settings.json`）

| Hook | 觸發時機 | 行為 |
|------|---------|------|
| `protect-config.sh` | PreToolUse（Edit\|Write） | 🔴 攔截 lock 檔修改、🟡 警告 config 檔修改 |
| `typecheck.sh` | PostToolUse（Edit\|Write） | 編輯 .ts/.vue 後自動跑 `vue-tsc --noEmit`（非阻斷，僅報告錯誤） |
| `rustfmt.sh` | PostToolUse（Edit\|Write） | 編輯 .rs 後自動執行 `rustfmt`（非阻斷） |
| `eslint.sh` | PostToolUse（Edit\|Write） | 編輯 .ts/.vue 後自動 `eslint --fix`（跳過 `components/ui/`） |

| 檔案 | 保護等級 |
|------|---------|
| `Cargo.lock`, `pnpm-lock.yaml` | 🔴 Hard block（禁止修改；git merge 帶進來的不在此限） |
| `tauri.conf.json`, `Cargo.toml` | 🟡 警告（需確認必要性） |

## 開發環境與常用指令

- **Node.js 24**（見 `.nvmrc`）、**pnpm 10.28.2**（`corepack enable && corepack prepare`）、**Rust stable**

| 指令 | 用途 |
|------|------|
| `pnpm tauri dev` | 開發模式 |
| `pnpm build` | 完整建構（含 vue-tsc） |
| `pnpm test` | 跑 Vitest |
| `pnpm test:coverage` | 覆蓋率報告 |
| `npx vue-tsc --noEmit` | 型別檢查 |
| `cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings && cargo test` | Rust 檢查（與 CI 同條件） |
| `./scripts/release.sh X.Y.Z` | 發版（bump 四處版本 + commit + tag + push；需使用者授權） |

## 閘門與 git（摘要，細則見流程文件與全域準則）

- 非 trivial 改動：codex 計劃閘（動工前）→ 實作 → 雙向追溯閘（30 秒自檢）→ codex 實作閘 → 測試全綠 → 列檔案等 commit 授權
- 不 push、不 tag、不 rebase、不 reset --hard；社群 PR 不在 GitHub 上直接 merge，接手後 squash 進 local main 並保留 `Co-authored-by`
- 對外留言（issue／PR）先給使用者過目再發；語氣規則見流程文件「社群」段

## Subagent

- **tauri-reviewer** — 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別）
