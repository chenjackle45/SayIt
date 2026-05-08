# Development Guide

> 本機開發、測試、除錯、常見任務
> 掃描日期：2026-05-08 · 版本：0.9.5

---

## 一、Prerequisites

| 項目        | 版本 / 說明                                          |
| ----------- | ---------------------------------------------------- |
| **Node.js** | **24**（鎖定於 `.nvmrc`）— 用 `nvm use` 自動切換     |
| **pnpm**    | **10.28.2**（鎖定於 `package.json#packageManager`）— 啟用方式：`corepack enable && corepack prepare` |
| **Rust**    | **stable** — `rustup default stable`                 |
| **Xcode CLT** | macOS only — `xcode-select --install`              |
| **MSVC** + Build Tools | Windows only — Visual Studio Installer 安裝 C++ build tools |

> 不可用 `npm` / `yarn` 安裝；CI 嚴格使用 pnpm `--frozen-lockfile`。

---

## 二、初次設置

```bash
# 1. clone repo
git clone https://github.com/chenjackle45/SayIt.git
cd SayIt

# 2. 切到正確 Node 版本
nvm use            # → Node 24

# 3. 啟用 pnpm（如果還沒）
corepack enable
corepack prepare

# 4. 安裝依賴（嚴格依照 lockfile）
pnpm install --frozen-lockfile

# 5. 確認 Rust toolchain
rustup default stable
```

---

## 三、開發指令

### 3.1 啟動開發環境

```bash
# 同時啟動 Vite dev server (1420) + Tauri runtime
pnpm tauri dev
```

啟動流程：
1. Vite dev server 在 `http://localhost:1420` 跑兩個 entry（HUD + Dashboard）
2. Tauri 編譯 Rust runtime（首次約 1-2 分鐘）
3. 開啟兩個視窗（HUD 預設不可見、Dashboard 可見）

### 3.2 純 frontend 開發（不啟動 Tauri runtime）

```bash
pnpm dev
# 只啟 Vite dev server 在 1420，Tauri Command 都會 timeout
```

> 適合單純改 UI / 純前端邏輯。但任何 Tauri Command 呼叫會卡住，最好還是用 `pnpm tauri dev`。

### 3.3 型別檢查

```bash
npx vue-tsc --noEmit          # 一次性
```

> hook 設定：`.claude/settings.json` 的 `typecheck.sh` 會在每次編輯 `.ts` / `.vue` 後自動跑（**非阻斷**，僅報告）。

### 3.4 測試

```bash
pnpm test                     # Vitest unit + component
pnpm test:watch               # watch mode
pnpm test:coverage            # 覆蓋率報告（@vitest/coverage-v8）
pnpm test:e2e                 # Playwright E2E
pnpm test:e2e:ui              # Playwright UI mode
```

Rust 測試：
```bash
cd src-tauri
cargo test --workspace        # 全部 Rust tests
cargo test find_monitor       # 跑特定函式測試
```

### 3.5 Lint / Format

```bash
pnpm exec eslint src --fix    # ESLint（hook 自動跑於編輯後，跳過 components/ui/）
cd src-tauri && cargo fmt     # rustfmt（hook 自動跑）
```

> 目前 Rust 沒設 `cargo clippy` 在 CI / hook，建議手動 `cargo clippy --workspace -- -D warnings`。

### 3.6 Build（不打 binary）

```bash
pnpm build                    # vue-tsc --noEmit && vite build → dist/
```

### 3.7 Build 桌面 binary

```bash
pnpm tauri build              # release 模式，產出 macOS .dmg / Windows .exe
pnpm tauri build --debug      # debug 模式（保留 symbols，產出較大但可 debug）
```

> ⚠️ 安全相關功能（CSP、AX 權限、自動更新）必須用 `--debug` 模式測，因為 dev mode 不受 CSP 影響。

---

## 四、常見開發任務

### 4.1 加一個設定欄位

```
1. src/types/settings.ts          ── 加欄位型別
2. src/stores/useSettingsStore.ts ── 加 state、loadSettings、saveSettings 路徑
3. src/views/SettingsView.vue     ── 加 UI（用 shadcn-vue 元件）
4. （若需通知）emit 'settings:updated'
```

### 4.2 加一個 Tauri Command

詳見 `api-contracts-backend.md` §七的 checklist。摘要：

```
1. src-tauri/src/plugins/<module>.rs ── 寫 #[command] fn
2. src-tauri/src/lib.rs               ── 在 invoke_handler! 註冊
3. （若有 event）模組頂部加 pub const NAME = "..."
4. src/types/events.ts                ── 加 *Payload 介面
5. src/composables/useTauriEvents.ts  ── 加 event 常數
6. 用 tauri-reviewer subagent 審查
```

### 4.3 加一個 SQLite 欄位

```
1. src/lib/database.ts ── 在 v8 之後追加 v9 migration block
   - DDL（ADD COLUMN）放 transaction 外
   - 用 addColumnIfNotExists() 確保冪等
   - 包 BEGIN/COMMIT 跑 INSERT OR REPLACE schema_version
2. src/types/transcription.ts（或對應檔）── 加欄位型別
3. mapRowToRecord 加映射（snake → camel + boolean conversion）
4. 對應 store 寫入 / 讀取邏輯加上新欄位
```

> ❌ **絕對不要**改舊 migration（v1～v8）— 已部署的使用者那邊已經跑過。

### 4.4 加一個 LLM Provider

```
1. src/lib/llmProvider.ts:
   - 在 LlmProviderId 型別加新值
   - 實作 buildFetchParams 對應 case
   - 實作 parseProviderResponse 對應 case
2. src/lib/modelRegistry.ts:
   - 在 LLM_MODEL_LIST 加新模型
   - 設定 providerId 欄位
   - 確認 getDefaultModelIdForProvider 有對應
3. src-tauri/capabilities/default.json ── http:default 加新 URL
4. src-tauri/tauri.conf.json ── connect-src CSP 加新 host（很容易漏！）
```

### 4.5 加一個自訂 i18n 字串

```
1. src/i18n/locales/{zh-TW,zh-CN,en,ja,ko}.json ── 五個語系都要加
2. 元件內：const { t } = useI18n(); t('your.key')
3. 全域場景（如 prompt）：i18n.global.t('your.key')
```

---

## 五、Debugging

### 5.1 Webview DevTools

- macOS：右鍵點 webview → Inspect Element（dev mode 預設啟用）
- Windows：相同操作
- Production：DevTools 預設關閉

### 5.2 Rust Console

`pnpm tauri dev` 終端會顯示 Rust 端 `println!` / `eprintln!` 輸出。

Webview 端可用 `invoke('debug_log', { level: 'info', message: '...' })` 把 log 導向 Rust 終端（適合 production 用 Console.app 抓）。

### 5.3 Sentry

production / staging 環境自動上報；dev 模式不上報（`get_sentry_environment()` 檢查）。

### 5.4 Database 查看

```bash
# macOS
sqlite3 ~/Library/Application\ Support/com.sayit.app/app.db

# Windows
sqlite3 %APPDATA%\com.sayit.app\app.db

# 範例查詢
> .tables
> SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT 10;
> SELECT version FROM schema_version;
```

⚠️ 開發 dev 模式時 SQLite 仍會用同一個 OS 路徑，**dev 與 production data 共用** — 測試破壞性 migration 前先備份 `app.db`。

### 5.5 Tauri Log

`tauri-plugin-log` 沒裝，所以沒有結構化日誌；目前靠 `println!` + `eprintln!` + `debug_log` command。

---

## 六、Hooks（自動化）

`.claude/settings.json` 設定四個 PostToolUse / PreToolUse hooks（觸發 Edit/Write 工具）：

| Hook                    | 行為                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `protect-config.sh`     | 🔴 阻擋 `Cargo.lock` / `pnpm-lock.yaml` 修改；🟡 警告 `tauri.conf.json` / `Cargo.toml` |
| `typecheck.sh`          | `.ts` / `.vue` 編輯後跑 `vue-tsc --noEmit`（非阻斷）                       |
| `rustfmt.sh`            | `.rs` 編輯後跑 `rustfmt`                                                   |
| `eslint.sh`             | `.ts` / `.vue` 編輯後 `eslint --fix`（跳過 `components/ui/`）              |

---

## 七、Code Style

### 7.1 命名

| 類型              | 慣例                       |
| ----------------- | -------------------------- |
| 變數 / 函式       | `camelCase`                |
| Vue 元件 / class  | `PascalCase`               |
| 不可變常數        | `UPPER_SNAKE_CASE`         |
| 資料夾            | `kebab-case`               |
| 型別介面後綴      | `*Props` / `*Dto` / `*Model` / `*Record` / `*Payload` / `*Config` / `*Entry` / `*Handle` |

### 7.2 函式語意

- 4-6 字、動詞 + 受詞（`generateMonthlySalesReport()` 而非 `genReport()`）
- Boolean 用 `is/has/can/should` 前綴
- 責任後綴：`*Service` / `*Repository` / `*Adapter` / `*Util` / `*Helper`

### 7.3 註解

- 預設不寫 — 只在「為什麼非顯而易見」時加（隱性限制、邊界 case、特殊解法）
- 不寫「做什麼」（識別字已說明）
- 不寫「current task / fix / callers」（屬於 PR description）

### 7.4 Vue 規範

- `<script setup lang="ts">` only
- 不用 Options API
- 不用 `defineComponent`（改用 setup syntax）

### 7.5 Rust 規範

- 沿用 `rustfmt` 預設 + `cargo clippy` 建議
- macOS / Windows 平台特化用 `#[cfg(target_os = "...")]`
- 不要 panic — 用 `Result<T, E>` 或 `Result<T, String>`

---

## 八、Pre-commit Checklist

```
□ pnpm test                  全部單元測試通過
□ npx vue-tsc --noEmit       無型別錯誤
□ cargo check (src-tauri)    Rust 編譯通過
□ pnpm exec eslint src       ESLint 無錯（hook 已自動跑）
□ 若改 IPC：用 tauri-reviewer subagent 雙端對齊審查
□ 若改 UI：先在 design.pen 完成設計稿
□ 若改 SQL schema：寫 v(N+1) migration 不改舊 migration
```

---

## 九、Subagents（Claude Code）

| Subagent           | 用途                                                            |
| ------------------ | --------------------------------------------------------------- |
| `tauri-reviewer`   | 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別） |

---

## 十、Common Pitfalls

| 陷阱                                                                  | 解法                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 用 `fetch()` 直接呼叫 API → CORS 錯誤                                 | 改用 `import { fetch } from "@tauri-apps/plugin-http"`                              |
| `views/` 直接 `import` lib → 違反依賴規則                              | 改用 Pinia store 包裝                                                               |
| dev 模式測 CSP 沒問題、prod build 出錯                                 | 用 `pnpm tauri build --debug` 測                                                    |
| 改了 `tauri.conf.json` CSP 但忘了改 `capabilities/default.json`        | 兩處要同步                                                                          |
| 改了 SQLite migration 寫到 v9，但漏了 schema_version INSERT           | 下次啟動會重跑（無害但日誌會抱怨）                                                  |
| 加 Rust Command 忘記在 `invoke_handler!` 註冊                          | Rust 編譯通過但前端 `invoke()` 會 timeout 或回 "command not found"                  |
| Cmd+V 在 Fn 按住期間執行 → 輸入 "c" 字元                                | 已知 issue #25，避開即可                                                            |
| 開兩個 dev session（兩個 .app） → 全域熱鍵廣播                          | v0.9.5 已導入 `tauri-plugin-single-instance` 防止                                   |
