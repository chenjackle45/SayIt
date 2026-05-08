# SayIt — Documentation Index

> 專案文件總入口 · 由 BMad Document Project 工作流自動產生
> 掃描層級：**Exhaustive** · 掃描日期：**2026-05-08** · 專案版本：**0.9.5**

> 👋 這個 index 是 **AI 助手與新成員的主要檢索入口**。如果你不確定該看哪個檔，從這裡開始。

---

## 一、Project Overview

| 項目              | 內容                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| **產品定位**      | 跨平台桌面語音轉書面語工具（macOS / Windows）                                       |
| **核心流程**      | 按住熱鍵 → 錄音 → Groq Whisper 轉錄 → LLM 整理 → 自動貼上                          |
| **Repository**    | multi-part desktop monorepo（2 parts）                                              |
| **Primary Tech**  | Tauri v2.10 + Vue 3.5 + Rust 2021                                                   |
| **架構模式**      | 雙視窗 SPA（HUD + Dashboard）+ Rust Plugin Bus + 共用 SQLite Pool                   |

完整介紹見 [`project-overview.md`](./project-overview.md)

---

## 二、Quick Reference by Part

### Part 1：Frontend（`src/`）

```
類型：    web project (Vue 3 SPA)
入口：    src/main.ts (HUD) + src/main-window.ts (Dashboard)
規模：    11,503 LOC · 4 stores · 5 views · 11 components · 21 shadcn-vue UI
框架：    Vue 3.5 + TypeScript 5.7 + Pinia 3 + vue-router 5 + shadcn-vue + Tailwind 4
測試：    Vitest + Playwright + @vitest/coverage-v8
入口點配對：
  - HUD：index.html → main.ts → App.vue → NotchHud.vue
  - Dashboard：main-window.html → main-window.ts → MainApp.vue → router(5 views)
```

詳細：[`architecture-frontend.md`](./architecture-frontend.md)

### Part 2：Backend（`src-tauri/`）

```
類型：    desktop project (Tauri v2 Rust runtime)
入口：    src-tauri/src/main.rs → sayit_lib::run()
規模：    6,006 LOC Rust · 8 plugin modules · 7 managed states
框架：    Tauri v2 + sentry 0.46 + cpal 0.15 + reqwest 0.12 + arboard 3
平台特化：
  - macOS：core-graphics, core-foundation, objc, CoreAudio FFI
  - Windows：windows 0.61（KeyboardAndMouse, Audio_Endpoints, ...）
測試：    內嵌 #[cfg(test)] mod tests（17+ 純函式測試於 lib.rs）
```

詳細：[`architecture-backend.md`](./architecture-backend.md)

---

## 三、Generated Documentation（本次掃描產出）

### 3.1 結構與導引

- [Project Overview](./project-overview.md) — 產品定位、技術棧、文件導引、Quick Start
- [Source Tree Analysis](./source-tree-analysis.md) — 全專案註解過的目錄樹
- [project-parts.json](./project-parts.json) — Multi-part metadata（給工具讀取）

### 3.2 各 Part 架構

- [Architecture — Frontend](./architecture-frontend.md) — Vue 3 SPA 架構、依賴規則、Hard Rules
- [Architecture — Backend](./architecture-backend.md) — Tauri Rust runtime、plugin module、生命週期

### 3.3 整合與契約

- [Integration Architecture](./integration-architecture.md) — 兩 part 間的 IPC 整合 + 啟動 / 結束順序 + 新功能決策樹
- [API Contracts — Backend](./api-contracts-backend.md) — 34 Tauri Commands + 15 Rust→FE Events + 5 FE-only Events
- [Data Models](./data-models.md) — SQLite Schema + 8 個 Migration + Store 結構 + 型別命名

### 3.4 元件與開發

- [Component Inventory — Frontend](./component-inventory-frontend.md) — 11 自製元件 + 21 shadcn-vue 元件
- [Development Guide](./development-guide.md) — 環境、指令、常見任務、Hooks、Pitfalls
- [Deployment Guide](./deployment-guide.md) — CI/CD、Apple Notarize、發版流程、回滾

### 3.5 Scan State

- [project-scan-report.json](./project-scan-report.json) — 掃描狀態檔（resume / re-scan 用）

---

## 四、Existing Documentation（既有文件，本次未取代）

### 4.1 規範性文件（authoritative · 必讀）

- [`_bmad-output/project-context.md`](../_bmad-output/project-context.md) — **AI Agent 必讀規則 · 323 條**（最高優先）
- [`CLAUDE.md`](../CLAUDE.md) — Claude Code 專案記憶、IPC 契約表、Hooks 設定
- [`_bmad-output/planning-artifacts/architecture.md`](../_bmad-output/planning-artifacts/architecture.md) — 架構決策（ADR）
- [`_bmad-output/planning-artifacts/ux-ui-design-spec.md`](../_bmad-output/planning-artifacts/ux-ui-design-spec.md) — UI 設計規範
- [`design.pen`](../design.pen) — Pencil MCP 設計稿（UI 實作前必讀）

### 4.2 規劃 / 故事文件（`_bmad-output/`）

- `planning-artifacts/prd.md` — 產品需求文件
- `planning-artifacts/epics.md` — Epic 拆分
- `planning-artifacts/product-brief-sayit-2026-02-28.md` — 產品 brief
- `planning-artifacts/sprint-change-proposal-2026-03-15.md` — 變更提案
- `planning-artifacts/implementation-readiness-report-2026-03-01.md` — Implementation readiness
- `implementation-artifacts/{n}-{m}-{slug}.md` — 17 個 story 完成紀錄
- `implementation-artifacts/tech-spec-*.md` — 14 份功能 tech spec
- `implementation-artifacts/sprint-status.yaml` — Sprint 狀態
- `test-artifacts/automation-summary.md` — 自動化測試摘要
- `test-artifacts/framework-setup-progress.md` — 測試框架設置進度

### 4.3 README / 變更紀錄

- [`README.md`](../README.md) — 對外用使用者文件
- [`CHANGELOG.md`](../CHANGELOG.md) — 版本變更紀錄
- [`tests/README.md`](../tests/README.md) — 測試結構說明

---

## 五、I want to… (Decision Tree)

| 情境                              | 看哪個檔                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| 第一次接觸這專案                  | `project-overview.md` → `index.md`（這個）→ `source-tree-analysis.md` |
| 寫 brownfield PRD                 | `project-overview.md` + `integration-architecture.md` + `architecture-{frontend,backend}.md` |
| 加 IPC 契約                       | `api-contracts-backend.md` §七 checklist + `integration-architecture.md` §九 |
| 改 UI                             | `_bmad-output/planning-artifacts/ux-ui-design-spec.md` + `design.pen`（先設計）+ `component-inventory-frontend.md` |
| 改 SQLite                         | `data-models.md` §三 Migration                                        |
| 加 LLM Provider                   | `architecture-frontend.md` §4.4 + `development-guide.md` §4.4         |
| 改 hotkey / paste 機制            | `architecture-backend.md` §4.1 / §4.4 + `_bmad-output/project-context.md` |
| 發版                              | `deployment-guide.md` §四 + `scripts/release.sh`                      |
| 看實作規則（323 條）              | `_bmad-output/project-context.md`                                     |
| 看 IPC 契約表                     | `CLAUDE.md` §IPC 契約表（authoritative）                              |

---

## 六、Hard Rules（最常違反的，必看）

> 完整列表見 `_bmad-output/project-context.md`。本節只列「最容易踩」。

1. **❌ 瀏覽器原生 `fetch`** → ✅ `@tauri-apps/plugin-http`
2. **❌ Options API** → ✅ `<script setup lang="ts">`
3. **❌ views/ 直接 import lib/** → ✅ 透過 Pinia store
4. **❌ SQLite 存 API Key** → ✅ 只能用 `tauri-plugin-store`
5. **❌ Tailwind 原生色彩**（`bg-zinc-900`） → ✅ 語意變數（`bg-primary`）
6. **❌ `@tabler/icons-vue`** → ✅ 只用 `lucide-vue-next`
7. **❌ 手寫 UI 元件** → ✅ shadcn-vue（new-york style）
8. **❌ 直接 import Tauri event API** → ✅ 透過 `composables/useTauriEvents.ts`
9. **❌ 未經 Pencil 設計直接寫 UI** → ✅ 先在 `design.pen` 完成設計
10. **❌ 改舊 SQL migration**（v1～v8） → ✅ 追加 v9 等新版本
11. **❌ 改 `Cargo.lock` / `pnpm-lock.yaml`** → ✅ 受 `protect-config.sh` 阻擋

---

## 七、已知一致性問題（需 follow-up）

| 問題                                                                | 建議                                              |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `tauri.conf.json` CSP `connect-src` 缺 OpenAI / Anthropic           | 加入 `https://api.openai.com` + `https://api.anthropic.com` |
| CI 沒跑 `cargo test`、`cargo clippy`、`eslint`                       | 加進 `ci.yml`                                     |
| `CLAUDE.md` 開頭聲稱「261 條」，但 `project-context.md` 實為 323 條   | 同步數字                                          |
| `addApiUsage` FK 失敗（787）偶發                                     | 調查 `transcriptions` 與 `api_usage` 寫入 race    |
| autoUpdater 用 `window.confirm` 在 Tauri WKWebView 靜默忽略           | 改 in-app UI                                      |
| `text_field_reader::read_selected_text` Fn-c 字元穿透（issue #25）   | 待修                                              |

---

## 八、Getting Started（30 秒）

```bash
nvm use && corepack enable && corepack prepare
pnpm install --frozen-lockfile
pnpm tauri dev
```

完整環境設置：[`development-guide.md`](./development-guide.md) §一 + §二

---

## 九、Repository Stats

| 項目                    | 數值                |
| ----------------------- | ------------------- |
| Frontend LOC            | 11,503              |
| Backend LOC (Rust)      | 6,006               |
| **Total LOC**           | **~17.5 K**         |
| Pinia stores            | 4                   |
| Vue views               | 5                   |
| 自製元件                | 11                  |
| shadcn-vue 元件         | 21                  |
| Composables             | 4                   |
| Lib utility 模組        | 13                  |
| i18n 語系               | 5（zh-TW, zh-CN, en, ja, ko） |
| Rust plugins            | 8                   |
| Managed states          | 7                   |
| Tauri Commands          | 34                  |
| Tauri Events (Rust→FE)  | 15                  |
| Frontend-only Events    | 5                   |
| SQLite tables           | 4（v8）             |
| LLM Providers           | 4（Groq / OpenAI / Anthropic / Gemini） |
| External APIs           | 5（含 Whisper）     |
| GitHub Workflows        | 4（ci, release, claude, claude-code-review） |
| GitHub Secrets          | 13                  |

---

## 十、Documentation Workflow Metadata

| 欄位             | 值                                              |
| ---------------- | ----------------------------------------------- |
| 工作流           | `bmad-document-project`（v1.2.0）               |
| 模式             | `initial_scan`                                  |
| Scan level       | `exhaustive`                                    |
| 開始時間         | 2026-05-08 14:14:11 +08:00                      |
| 完成時間         | 2026-05-08（見 `project-scan-report.json`）     |
| 輸出語言         | 繁體中文                                        |
| 文件總數         | 11 個（含此 index）                              |
| State file       | [`project-scan-report.json`](./project-scan-report.json) |
