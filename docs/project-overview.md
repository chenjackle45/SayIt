# Project Overview — SayIt

> 「按住說話，放開貼上」— 跨平台桌面語音轉書面語工具
> 掃描日期：2026-05-08 · 版本：0.9.5

---

## 一、產品定位

SayIt 是一款 **macOS / Windows 跨平台桌面語音輸入工具**，核心價值主張是「**口語到書面語**」：

1. 在任何 App 中按住熱鍵（預設 Fn）說話
2. 放開後語音經 **Groq Whisper** 轉錄為文字
3. 再經 **LLM**（Groq / OpenAI / Anthropic / Gemini 任選）將口語自動整理為通順的書面語
4. 整理後文字直接貼入游標位置

端到端延遲 < 3 秒，適合會議筆記、郵件起草、聊天訊息、技術文件等場景。

---

## 二、Tech Stack 總覽

| 層級       | 主要技術                                                      |
| ---------- | ------------------------------------------------------------- |
| Desktop    | **Tauri v2.10+**（含 macOS Private API、System Tray）         |
| Frontend   | **Vue 3.5 + TypeScript 5.7** + shadcn-vue (new-york) + Tailwind 4 |
| Backend    | **Rust 2021 edition**（cpal、reqwest、arboard、rustfft）      |
| State      | Pinia 3                                                       |
| Storage    | SQLite（tauri-plugin-sql，WAL mode）+ tauri-plugin-store      |
| AI         | Groq Whisper + 4 家 LLM（Groq / OpenAI / Anthropic / Gemini）|
| Build      | Vite 6（多入口）+ Rust release LTO                            |
| Test       | Vitest + Playwright + 內嵌 Rust unit tests                    |
| Telemetry  | Sentry（Vue + Rust，僅 production）                           |

---

## 三、Repository 結構分類

**Type**：multi-part desktop monorepo

```
say-it/
├── src/         ← Frontend part（Vue 3 SPA · 雙視窗）
└── src-tauri/   ← Backend part（Tauri Rust runtime · 8 plugins）
```

兩個 part 透過 Tauri IPC（34 Commands + 15 Rust→FE Events + 5 FE-only Events）通訊，沒有外部 message broker。

---

## 四、雙視窗架構

| 視窗            | 大小（最小）         | 用途                                         | 顯示策略                                  |
| --------------- | -------------------- | -------------------------------------------- | ----------------------------------------- |
| **HUD**         | 470×100              | 狀態浮窗（錄音/轉錄/整理/完成）              | 透明、無裝飾、永遠最上層、預設不顯示       |
| **Dashboard**   | 960×680（720×480）   | 設定 / 歷史 / 字典 / 統計 / 功能導覽         | 標準視窗、預設隱藏、缺 API Key 才強制顯示 |

兩個視窗共用同一 SQLite 連線池，但獨立 mount 兩棵 Vue 樹（Vite 多入口）。

---

## 五、文件導引

### 5.1 規範性文件（authoritative，必讀）

| 文件                                                     | 用途                                         |
| -------------------------------------------------------- | -------------------------------------------- |
| `_bmad-output/project-context.md`                        | 全部 AI Agent 實作規則（323 條）             |
| `CLAUDE.md`                                              | Claude Code 專案記憶 + IPC 契約表 + Hook 設定 |
| `_bmad-output/planning-artifacts/architecture.md`        | 架構決策（ADR）                              |
| `_bmad-output/planning-artifacts/ux-ui-design-spec.md`   | UI 設計、色彩、元件規範                      |
| `design.pen`                                             | Pencil MCP 設計稿（UI 實作前必讀）           |

### 5.2 本次掃描產出（docs/）

| 文件                                                     | 用途                                          |
| -------------------------------------------------------- | --------------------------------------------- |
| [index.md](./index.md)                                   | 主索引（從這裡開始）                          |
| [source-tree-analysis.md](./source-tree-analysis.md)     | 全專案註解過的目錄樹                          |
| [architecture-frontend.md](./architecture-frontend.md)   | Frontend part 架構                            |
| [architecture-backend.md](./architecture-backend.md)     | Backend part 架構                             |
| [integration-architecture.md](./integration-architecture.md) | IPC 整合契約 + 生命週期                   |
| [api-contracts-backend.md](./api-contracts-backend.md)   | Tauri Commands + Events 完整 API              |
| [data-models.md](./data-models.md)                       | SQLite Schema + Store 結構                    |
| [component-inventory-frontend.md](./component-inventory-frontend.md) | UI 元件清單                       |
| [development-guide.md](./development-guide.md)           | 開發環境、指令、常見任務                      |
| [deployment-guide.md](./deployment-guide.md)             | CI/CD、Apple notarize、發版流程               |

### 5.3 計畫 / 故事 / 規格（_bmad-output/）

- `planning-artifacts/prd.md` — 產品需求文件
- `planning-artifacts/epics.md` — Epic 拆分
- `implementation-artifacts/{n}-{m}-{slug}.md` — 各 story 完成紀錄（共 17 個 story）
- `implementation-artifacts/tech-spec-*.md` — 各功能 tech spec（共 14 份）

---

## 六、Quick Reference

| 我想…                              | 看哪個檔案                                                        |
| ---------------------------------- | ----------------------------------------------------------------- |
| 改錄音流程                         | `src/stores/useVoiceFlowStore.ts`（核心狀態機）                   |
| 改設定欄位                         | `src/stores/useSettingsStore.ts` + `src/views/SettingsView.vue`   |
| 加 LLM Provider                    | `src/lib/llmProvider.ts` + `src/lib/modelRegistry.ts`             |
| 加 SQLite 欄位                     | `src/lib/database.ts`（追加 v9 migration，不改舊版）              |
| 加 Tauri Command                   | `src-tauri/src/plugins/*.rs` + `src-tauri/src/lib.rs` invoke_handler! |
| 加 cross-window event              | `src/composables/useTauriEvents.ts` 加常數                        |
| 改視窗大小 / CSP / 權限            | `src-tauri/tauri.conf.json` + `src-tauri/capabilities/default.json` |
| 改 hotkey 邏輯                     | `src-tauri/src/plugins/hotkey_listener.rs`                        |
| 改貼上機制                         | `src-tauri/src/plugins/clipboard_paste.rs`                        |

---

## 七、版本歷程（CHANGELOG 摘要）

| 版本    | 重點                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------- |
| 0.9.5   | tauri-plugin-single-instance 跨平台、Windows VK_F23 修復、Sentry sourcemap upload                     |
| 0.9.x   | Multi-provider LLM、Smart Dictionary、Hallucination Detector v3、Edit Mode、i18n、Sound Feedback     |

完整紀錄見 [`CHANGELOG.md`](../CHANGELOG.md)。

---

## 八、Getting Started（30 秒）

```bash
# 1. 環境準備
nvm use                                 # Node 24
corepack enable && corepack prepare     # pnpm 10.28.2
rustup default stable

# 2. 安裝
pnpm install

# 3. 開發
pnpm tauri dev                           # 同時啟動 Vite dev server + Tauri runtime

# 4. 測試
pnpm test                                # Vitest unit + component
npx vue-tsc --noEmit                     # TS 型別檢查

# 5. 建構
pnpm build                               # vue-tsc + vite build（不打包成桌面 binary）
pnpm tauri build                         # 打包成 macOS .dmg / Windows .exe
```

更多細節見 [development-guide.md](./development-guide.md)。
