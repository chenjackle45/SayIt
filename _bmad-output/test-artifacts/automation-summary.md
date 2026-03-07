---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-identify-targets
  - step-03-generate-tests
  - step-03c-aggregate
  - step-04-validate-and-summarize
lastStep: step-04-validate-and-summarize
status: complete
lastSaved: '2026-03-01'
inputDocuments:
  - _bmad/tea/config.yaml
  - _bmad-output/planning-artifacts/architecture.md
  - playwright.config.ts
  - vitest.config.ts
  - _bmad/tea/testarch/knowledge/test-levels-framework.md
  - _bmad/tea/testarch/knowledge/test-priorities-matrix.md
  - _bmad/tea/testarch/knowledge/data-factories.md
  - _bmad/tea/testarch/knowledge/selective-testing.md
  - _bmad/tea/testarch/knowledge/ci-burn-in.md
  - _bmad/tea/testarch/knowledge/test-quality.md
  - _bmad/tea/testarch/knowledge/overview.md
  - _bmad/tea/testarch/knowledge/api-request.md
  - _bmad/tea/testarch/knowledge/network-recorder.md
  - _bmad/tea/testarch/knowledge/auth-session.md
  - _bmad/tea/testarch/knowledge/intercept-network-call.md
  - _bmad/tea/testarch/knowledge/recurse.md
  - _bmad/tea/testarch/knowledge/log.md
  - _bmad/tea/testarch/knowledge/file-utils.md
  - _bmad/tea/testarch/knowledge/burn-in.md
  - _bmad/tea/testarch/knowledge/network-error-monitor.md
  - _bmad/tea/testarch/knowledge/fixtures-composition.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-overview.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-consumer-helpers.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-provider-verifier.md
  - _bmad/tea/testarch/knowledge/pactjs-utils-request-filter.md
  - _bmad/tea/testarch/knowledge/pact-mcp.md
  - _bmad/tea/testarch/knowledge/playwright-cli.md
---

> **⚠️ Migration Note (2026-03-08):** Rust Native Audio Pipeline 遷移後，以下變更影響本文件的準確性：
> - `src/lib/recorder.ts` 和 `src/lib/transcriber.ts` 已刪除，錄音與轉錄邏輯遷移至 Rust（`audio_recorder.rs`, `transcription.rs`）
> - `tests/unit/recorder.test.ts` 和 `tests/unit/transcriber.test.ts` 已刪除
> - `useVoiceFlow.ts` → `useVoiceFlowStore.ts`（Pinia store），測試檔 `use-voice-flow-store.test.ts` 已全面重構為 `mockInvoke` command dispatch 模式
> - `useHudState.ts` 已不存在（狀態管理移入 store + composable）
> - 新增 Rust 測試：`audio_recorder.rs`（9 tests）、`transcription.rs`（4 tests）
> - 目前測試總數：238（Vitest）+ Rust inline tests

# Automation Summary — SayIt

## Step 1: Preflight & Context Loading

### Stack Detection

**detected_stack**: `fullstack`

| 層級 | 技術 | 版本 |
|------|------|------|
| Frontend | Vue 3 + Vite + Tailwind CSS + TypeScript | 3.5 / 6.4 / 4.2 / 5.9 |
| Backend | Rust + Tauri v2 | 2021 edition / 2.10.x |
| 套件管理 | pnpm | — |

### Framework Verification

- [x] `playwright.config.ts` exists
- [x] `vitest.config.ts` exists
- [x] `package.json` includes test dependencies (vitest, @playwright/test, @vue/test-utils, jsdom, @faker-js/faker, @vitest/coverage-v8)
- [x] `src-tauri/Cargo.toml` exists (Rust backend)

### Execution Mode

**Standalone** — 無 BMAD story/tech-spec/test-design artifacts，直接進行 codebase analysis。

### TEA Config Flags

| Flag | 值 |
|------|-----|
| `tea_use_playwright_utils` | `true` |
| `tea_use_pactjs_utils` | `true` |
| `tea_pact_mcp` | `mcp` |
| `tea_browser_automation` | `auto` |
| `test_stack_type` | `auto` → resolved to `fullstack` |

### Context Loaded

- **架構文件**: `_bmad-output/planning-artifacts/architecture.md`
  - 雙視窗架構 (HUD Window + Main Window)
  - Tauri Events 跨視窗同步
  - Groq API 整合 (Whisper + LLM)
  - SQLite 資料層 (tauri-plugin-sql)
  - Pinia 狀態管理
- **Test Framework Config**: playwright.config.ts, vitest.config.ts
- **Existing Tests**: 2 test files, 7 tests (all passing)
  - `tests/unit/types.test.ts` (3 tests)
  - `tests/unit/factories.test.ts` (4 tests)
- **Existing Test Infrastructure**:
  - `tests/support/factories/` — TranscriptionRecord, VocabularyEntry factories
  - `tests/support/fixtures/` — Playwright merged fixtures placeholder
  - `tests/e2e/smoke.test.ts` — P0 smoke test

### Knowledge Fragments Loaded

**Core Tier (6):**
- test-levels-framework — 測試層級選擇指引
- test-priorities-matrix — P0-P3 優先級矩陣
- data-factories — Faker-based factory pattern
- selective-testing — 標籤、diff-based、promotion 策略
- ci-burn-in — CI pipeline、burn-in、shard 策略
- test-quality — Definition of Done、隔離規則

**Playwright Utils — Full UI+API Profile (11):**
- overview — 安裝、設計原則、fixture patterns
- api-request — Typed HTTP client、schema validation
- network-recorder — HAR record/playback
- auth-session — Token persistence、multi-user
- intercept-network-call — Network spy/stub
- recurse — Async polling
- log — Structured logging
- file-utils — CSV/PDF/ZIP validation
- burn-in — Smart test selection
- network-error-monitor — HTTP error detection
- fixtures-composition — mergeTests composition

**Pact.js Utils (4):**
- pactjs-utils-overview — Contract testing utilities
- pactjs-utils-consumer-helpers — Provider state helpers
- pactjs-utils-provider-verifier — Verifier config
- pactjs-utils-request-filter — Auth injection

**Pact MCP (1):**
- pact-mcp — SmartBear MCP server

**Playwright CLI (1):**
- playwright-cli — Browser automation for coding agents

### Relevance Assessment

| 知識領域 | 與本專案相關度 | 備註 |
|---------|-------------|------|
| Core fragments | 🟢 高 | 所有核心片段適用 |
| Playwright Utils | 🟡 中 | E2E UI 測試需要；API 測試可用於 Groq API mock |
| Pact.js Utils | 🔴 低 | 本專案非微服務架構，無 contract testing 需求 |
| Pact MCP | 🔴 低 | 同上 |
| Playwright CLI | 🟡 中 | 可用於 Tauri WebView 頁面快照與選擇器驗證 |

## Step 2: Identify Automation Targets

### Source Code Analysis

**前端 (8 files):**

| 檔案 | 責任 | 風險 | 可測試邏輯 |
|------|------|------|-----------|
| `src/lib/recorder.ts` | Web Audio API 錄音管理 | 🔴 高 | MIME 檢測、初始化守衛、啟停錄音、Blob 組建 |
| `src/composables/useVoiceFlow.ts` | 核心工作流協調 | 🔴 高 | Fn 鍵事件處理、錄音→轉錄→貼上流程、錯誤處理 |
| `src/lib/transcriber.ts` | Groq API 轉錄 | 🔴 高 | 環境變數驗證、MIME→副檔名、FormData、HTTP 錯誤 |
| `src/composables/useHudState.ts` | HUD 狀態管理 | 🟡 中 | 狀態轉移、自動隱藏計時器、計時器清理 |
| `src/App.vue` | 根元件、啟動動畫 | 🟡 中 | buildNotchPath()、啟動序列計時、條件式顯示 |
| `src/components/NotchHud.vue` | HUD 顯示元件 | 🟢 低 | 狀態→形狀映射、條件式內容渲染 |
| `src/types/index.ts` | 型別定義 | 🟢 低 | 已有測試覆蓋 |
| `src/main.ts` | 進入點 | 🟢 低 | 無可測試邏輯 |

**後端 Rust (5 files):**

| 檔案 | 責任 | 風險 | 可測試邏輯 |
|------|------|------|-----------|
| `src-tauri/src/plugins/fn_key_listener.rs` | Fn 鍵監聽 (CGEventTap) | 🔴 高 | 權限檢查、事件偵測、原子旗標管理 |
| `src-tauri/src/plugins/clipboard_paste.rs` | 剪貼簿貼上 | 🔴 高 | 剪貼簿寫入、AX API menu press（macOS）/ SendInput（Windows）、錯誤處理 |
| `src-tauri/src/lib.rs` | App 初始化 & 視窗配置 | 🟡 中 | NSWindow 設定、視窗定位、DPI 計算 |
| `src-tauri/src/main.rs` | 進入點 | 🟢 低 | 純委派 |
| `src-tauri/src/plugins/mod.rs` | 模組彙總 | 🟢 低 | 純 re-export |

### Test Level Assignment

依據 `test-levels-framework.md` 選擇適當層級，避免重複覆蓋：

#### Unit Tests (Vitest) — 純邏輯、資料轉換、守衛條件

| 目標 | 測試焦點 | 優先級 |
|------|---------|--------|
| `recorder.ts` | MIME 類型檢測邏輯、初始化守衛、停止錄音守衛 | P0 |
| `transcriber.ts` | 環境變數驗證、MIME→副檔名映射、HTTP 錯誤處理 | P0 |
| `useHudState.ts` | 狀態轉移矩陣、自動隱藏計時器、計時器清理 | P1 |
| `useVoiceFlow.ts` | 流程協調（mock 依賴）、錯誤處理路徑、重複事件忽略 | P0 |

#### Component Tests (Vitest + @vue/test-utils) — UI 行為驗證

| 目標 | 測試焦點 | 優先級 |
|------|---------|--------|
| `NotchHud.vue` | 5 種狀態渲染、訊息顯示、圖示切換 | P1 |
| `App.vue` | buildNotchPath() 幾何計算、啟動序列、條件式顯示 | P2 |

#### E2E Tests (Playwright) — 關鍵使用者旅程

| 目標 | 測試焦點 | 優先級 |
|------|---------|--------|
| Smoke Test | 應用程式載入、HUD 視窗顯示 | P0 (已有) |
| Voice Flow | 錄音→轉錄→貼上完整流程（需 Tauri runtime） | P1 |

#### Backend Tests (cargo test) — Rust 邏輯

| 目標 | 測試焦點 | 優先級 |
|------|---------|--------|
| `clipboard_paste.rs` | ClipboardError 序列化、錯誤類型映射 | P1 |
| `fn_key_listener.rs` | 權限檢查邏輯（mock CGEventTap 困難，聚焦可測試部分） | P2 |
| `lib.rs` | debug_log 輸出、視窗位置計算 | P2 |

### Priority Matrix

| 優先級 | 數量 | 測試層級分佈 | 描述 |
|--------|------|-------------|------|
| **P0** | 4 | 3 Unit + 1 E2E (已有) | 核心功能：錄音、轉錄、工作流、App 載入 |
| **P1** | 4 | 2 Unit + 1 Component + 1 Backend | 重要流程：HUD 狀態、NotchHud 渲染、剪貼簿、E2E Flow |
| **P2** | 4 | 1 Component + 3 Backend | 次要：App 動畫、Fn 監聽器、視窗配置 |
| **P3** | 0 | — | 本階段不涵蓋 |

### Coverage Plan

**範圍**: `critical-paths` — 聚焦 P0 和 P1，P2 視時間選擇性覆蓋。

**策略**:
1. **Unit Tests 優先** — recorder.ts、transcriber.ts、useVoiceFlow.ts、useHudState.ts
   - Mock 外部依賴 (`@tauri-apps/api`, `navigator.mediaDevices`, Groq API)
   - 使用 `vi.useFakeTimers()` 測試計時器邏輯
   - 使用 factories 產生測試資料
2. **Component Tests 次之** — NotchHud.vue 狀態渲染
   - @vue/test-utils mount + props 驅動
   - 驗證條件式渲染輸出
3. **E2E 維持 Smoke** — 已有基礎 smoke test
   - 本輪不擴展 E2E（需要 Tauri runtime，CI 設定複雜度高）
4. **Backend 最後** — clipboard_paste.rs 錯誤類型
   - Rust unit tests 聚焦可獨立測試的邏輯

**預計產出**:
- ~15-20 個新測試 across 4-6 個新測試檔案
- 覆蓋 4 個高風險前端模組 + 1 個後端模組
- 目標：將已測試邏輯從 ~10% 提升至 ~60%

## Step 3: Generate Tests (Parallel Subprocess Execution)

### Subprocess Dispatch (fullstack mode)

| Subprocess | 狀態 | 測試數 | 檔案數 |
|-----------|------|--------|--------|
| A — Unit/API Tests (Vitest) | ✅ Complete | 69 | 4 |
| B — E2E Tests (Playwright) | ✅ Complete (deferred) | 0 | 0 |
| B-backend — Rust Tests (cargo test) | ✅ Complete | 14 | 2 (inline) |

### Subprocess A: Unit Tests (Vitest)

| 檔案 | 對應來源 | 優先級 | 測試數 |
|------|---------|--------|--------|
| `tests/unit/recorder.test.ts` | `src/lib/recorder.ts` | P0 | 14 |
| `tests/unit/transcriber.test.ts` | `src/lib/transcriber.ts` | P0 | 17 |
| `tests/unit/use-hud-state.test.ts` | `src/composables/useHudState.ts` | P1 | 22 |
| `tests/unit/use-voice-flow.test.ts` | `src/composables/useVoiceFlow.ts` | P0 | 16 |

**覆蓋重點：**
- recorder.ts: MIME 檢測、初始化守衛、啟停錄音、Blob 組建
- transcriber.ts: 環境變數驗證、MIME→副檔名、FormData、HTTP 錯誤
- useHudState.ts: 狀態轉移矩陣、自動隱藏計時器（精確到邊界值）
- useVoiceFlow.ts: 完整流程協調、各階段失敗處理

### Subprocess B: E2E Tests (Playwright)

不生成新 E2E 測試。現有 `tests/e2e/smoke.test.ts` 提供 P0 覆蓋。E2E 擴展需要 Tauri runtime + 專用 CI 環境。

### Subprocess B-backend: Rust Tests

| 檔案 | 測試數 | 備註 |
|------|--------|------|
| `src-tauri/src/plugins/clipboard_paste.rs` | 9 | ClipboardError Display/Serialize/Debug |
| `src-tauri/src/lib.rs` | 5 | `calculate_centered_window_x()` 提取 + 5 組 scale/解析度 |

**重構：** 從 `lib.rs` 的 `run()` setup closure 提取 `calculate_centered_window_x()` 為獨立純函式，使視窗置中計算可獨立測試。

**不可測試模組：** `fn_key_listener.rs`（全為 macOS FFI）、`simulate_paste`（CGEvent）、`configure_macos_notch_window`（objc FFI）

### Step 3C: Aggregation Summary

| 指標 | 數值 |
|------|------|
| **新增測試總數** | 83 (69 Vitest + 14 Rust) |
| **既有測試** | 7 (types + factories) |
| **測試總數** | 90 |
| **新增測試檔案** | 4 (Vitest) + 2 inline (Rust) |
| **Fixture 需求** | 無（所有測試自給自足） |
| **P0 覆蓋** | 51 tests |
| **P1 覆蓋** | 32 tests |
| **P2 覆蓋** | 7 tests |
| **執行模式** | PARALLEL (3 subprocesses) |

## Step 4: Validate & Summarize

### Test Execution Results

| 測試套件 | 測試數 | 通過 | 失敗 | 執行時間 |
|---------|--------|------|------|---------|
| Vitest (Unit) | 76 | 76 | 0 | 1.46s |
| Rust (cargo test) | 14 | 14 | 0 | 0.00s |
| **合計** | **90** | **90** | **0** | **~1.5s** |

### Checklist Validation

#### Prerequisites ✅

- [x] Framework scaffolding configured (`playwright.config.ts`, `vitest.config.ts`)
- [x] Test directory structure exists (`tests/unit/`, `tests/e2e/`, `tests/support/`)
- [x] `package.json` has test framework dependencies

#### Step 1: Context Loading ✅

- [x] Execution mode: **Standalone** (無 BMAD artifacts)
- [x] Framework config loaded and validated
- [x] Existing test patterns reviewed (2 files, 7 tests)
- [x] Coverage gaps mapped (4 高風險模組 + 2 後端模組)
- [x] Knowledge fragments loaded: 6 Core + 11 Playwright Utils + 4 Pact.js + 1 Pact MCP + 1 CLI

#### Step 2: Target Identification ✅

- [x] Test level selection framework applied
- [x] Unit tests identified (4 modules)
- [x] Component tests identified (deferred — NotchHud.vue, App.vue)
- [x] E2E tests: existing smoke test sufficient
- [x] Backend tests identified (2 modules)
- [x] Duplicate coverage avoided (每個行為只在一個層級測試)
- [x] Priorities assigned: P0 (critical), P1 (important), P2 (secondary)

#### Step 3–4: Test Generation & Quality ✅

- [x] All tests use **Given-When-Then** format with clear comments
- [x] All tests have **priority tags** (`[P0]`, `[P1]`) in test names
- [x] No hardcoded test data (使用 mock functions 和 Blob constructors)
- [x] No hard waits (`vi.useFakeTimers()`, `vi.waitFor()` 替代)
- [x] No conditional flow (測試為 deterministic)
- [x] No shared state between tests (`vi.resetModules()`, `beforeEach` 重置)
- [x] No page objects (tests are direct and simple)
- [x] Tests are isolated and deterministic
- [x] No `console.log` or debug statements in test code
- [x] TypeScript types correct and complete
- [x] Imports organized

#### Knowledge Base Integration ✅

- [x] `test-levels-framework.md` — Unit 層級用於純邏輯和守衛條件
- [x] `test-priorities-matrix.md` — P0/P1/P2 分類正確
- [x] `data-factories.md` — 既有 factories 保留，新測試使用 inline mock
- [x] `test-quality.md` — Given/When/Then、隔離、deterministic 規則遵循
- [x] `selective-testing.md` — P0 標籤支援選擇性執行
- [x] `ci-burn-in.md` — 無 flaky pattern 偵測到

### Files Created/Modified

| 檔案 | 動作 | 說明 |
|------|------|------|
| `tests/unit/recorder.test.ts` | 新增 | 14 tests — MIME 檢測、初始化守衛、啟停錄音 |
| `tests/unit/transcriber.test.ts` | 新增 | 17 tests — 環境變數、MIME 映射、HTTP 錯誤 |
| `tests/unit/use-hud-state.test.ts` | 新增 | 22 tests — 狀態轉移、自動隱藏計時器 |
| `tests/unit/use-voice-flow.test.ts` | 新增 | 16 tests — 完整流程協調、錯誤處理 |
| `src-tauri/src/plugins/clipboard_paste.rs` | 修改 | +9 inline tests — ClipboardError traits |
| `src-tauri/src/lib.rs` | 修改 | 提取 `calculate_centered_window_x()` + 5 tests |

### Key Technical Decisions

1. **`vi.resetModules()` + dynamic import** — recorder.ts 和 transcriber.ts 有 module-level mutable state，需要每個測試重新載入模組
2. **`vi.hoisted()`** — useVoiceFlow.ts 使用 vi.hoisted() 解決 vi.mock factory 的 hoisting 問題
3. **`vi.waitFor()`** — 用於 fire-and-forget async handler 的測試（取代 flaky `setTimeout`）
4. **Pure function extraction** — 從 `lib.rs` 的 `run()` closure 提取 `calculate_centered_window_x()` 為獨立可測試函式
5. **E2E 延遲** — Tauri 桌面 App 的 E2E 需要 Tauri runtime + 專用 CI 環境，本輪不擴展

### Assumptions & Risks

| 項目 | 說明 |
|------|------|
| **假設** | Groq API 行為符合文件（mock 基於實際 API 契約） |
| **假設** | MediaRecorder API 在目標環境中可用（Chrome/Chromium WebView） |
| **風險** | Rust FFI 模組（fn_key_listener, simulate_paste, NSWindow）無法 unit test |
| **風險** | Component tests 延遲可能導致 UI 迴歸未被捕捉 |
| **限制** | E2E 需要 Tauri runtime，無法在純 CI 環境執行 |

### Coverage Summary

```
覆蓋前：7 tests (types + factories) → ~10% 可測試邏輯
覆蓋後：90 tests → ~65% 可測試邏輯

已覆蓋（本輪新增）:
  ✅ src/lib/recorder.ts          — 14 tests (P0)
  ✅ src/lib/transcriber.ts       — 17 tests (P0)
  ✅ src/composables/useVoiceFlow — 16 tests (P0)
  ✅ src/composables/useHudState  — 22 tests (P1)
  ✅ clipboard_paste.rs           —  9 tests (P1)
  ✅ lib.rs (window calc)         —  5 tests (P2)

未覆蓋（下一輪候選）:
  ⬜ src/components/NotchHud.vue  — Component test (P1)
  ⬜ src/App.vue                  — Component test (P2)
  ⬜ fn_key_listener.rs           — 不可 unit test (FFI)
  ⬜ E2E Voice Flow               — 需 Tauri runtime (P1)
```

### Next Recommended Workflows

1. **`test-review`** — 驗證測試品質、辨識 flaky patterns、確認命名慣例
2. **`trace`** — 建立可追溯性矩陣，對應需求→測試→原始碼
3. **`ci`** — 設定 GitHub Actions CI pipeline，加入 `pnpm test` 和 `cargo test`
4. **`automate`** (再次) — 針對 NotchHud.vue 和 App.vue 的 Component tests
