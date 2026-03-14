---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
workflowStatus: complete
completedAt: 2026-03-01
inputDocuments:
  - prd.md
  - architecture.md
  - product-brief-SayIt-2026-02-28.md
  - voice-transcription-poc-spec.md
---

# SayIt - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for SayIt, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**語音觸發與錄音**
- FR1: 使用者可透過全域快捷鍵觸發錄音，不需切換至 App 視窗
- FR2: 使用者可自選觸發用的修飾鍵（macOS: Fn/Option/Ctrl/Cmd/Shift；Windows: 右Alt/左Alt/Ctrl/Shift）
- FR3: 使用者可選擇 Hold 模式（按住錄音，放開停止）或 Toggle 模式（按一下開始，再按一下停止）
- FR4: 系統在使用者觸發錄音時透過麥克風擷取音訊
- FR5: 系統在錄音結束後將音訊封裝為 API 可接受的格式

**語音轉文字**
- FR6: 系統可將錄音音訊送至 Groq Whisper API 取得繁體中文轉錄結果
- FR7: 系統可將自訂詞彙清單注入 Whisper API prompt 參數以提升專有名詞辨識率

**AI 文字整理**
- FR8: 系統可將轉錄結果送至 Groq LLM 進行口語→書面語整理（去贅詞、重組句構、修正標點、適當分段）
- FR9: 系統在轉錄字數低於門檻（約 10 字）時跳過 AI 整理，直接輸出原始轉錄
- FR10: 使用者可編輯 AI 整理使用的 prompt
- FR11: 使用者可將 prompt 重置為預設值
- FR12: 系統可將剪貼簿內容與自訂詞彙清單作為上下文注入 AI 整理請求

**文字輸出**
- FR13: 系統可將最終文字（轉錄或 AI 整理後）自動貼入當前游標所在的任何應用程式
- FR14: 系統透過剪貼簿寫入 + 模擬鍵盤貼上實現全域文字輸出
- FR15: 系統可在貼上後監控使用者鍵盤輸入行為，判斷輸出是否被修改以衡量品質

**自訂詞彙字典**
- FR16: 使用者可新增自訂詞彙（專案名、人名、技術術語）
- FR17: 使用者可刪除已建立的自訂詞彙
- FR18: 使用者可瀏覽完整的自訂詞彙清單
- FR19: 系統可將詞彙清單同時注入 Whisper API 與 AI 整理上下文

**歷史記錄與統計**
- FR20: 系統在每次成功轉錄後自動記錄完整資料（原始文字、整理後文字、錄音時長、API 回應時長、字數、觸發模式、是否經 AI 整理）
- FR21: 使用者可瀏覽歷史轉錄記錄列表
- FR22: 使用者可搜尋歷史記錄（全文搜尋）
- FR23: 使用者可複製歷史記錄中的文字
- FR24: 使用者可在 Dashboard 查看統計指標（總口述時間、口述字數、平均口述速度、節省時間、使用次數、AI 整理使用率）
- FR25: 使用者可在 Dashboard 查看最近轉錄摘要列表

**狀態回饋（HUD）**
- FR26: 系統在各階段透過 Notch-style HUD 顯示目前狀態（idle → recording → transcribing → enhancing → success/error → idle）
- FR27: 系統在 success 狀態短暫顯示後自動收起 HUD
- FR28: 系統在 API 請求失敗時透過 HUD 顯示清晰的錯誤訊息
- FR29: 系統在 Groq API 逾時時直接貼上原始轉錄文字跳過 AI 整理

**應用程式管理**
- FR30: 使用者可在設定頁面配置快捷鍵（觸發鍵選擇 + 觸發模式）
- FR31: 使用者可在設定頁面輸入/修改 Groq API Key
- FR32: 系統常駐 System Tray，使用者可從 Tray 開啟主視窗
- FR33: 系統支援開機自啟動，使用者可在設定中關閉
- FR34: 系統支援自動更新，啟動時檢查並背景下載更新
- FR35: 系統在 macOS 首次啟動時引導使用者授權 Accessibility 權限
- FR36: 系統在首次錄音時觸發麥克風權限請求

### NonFunctional Requirements

**效能**
- NFR1: 端到端延遲（含 AI 整理）< 3 秒（從放開按鍵到文字出現在游標位置）
- NFR2: 端到端延遲（跳過 AI）< 1.5 秒（短文直接貼上場景）
- NFR3: Groq API timeout 5 秒，超時 fallback 至原始轉錄文字
- NFR4: 常駐記憶體佔用 < 100 MB（idle 狀態下）
- NFR5: HUD 狀態轉換 < 100 ms（動畫流暢，無視覺延遲）
- NFR6: App 啟動時間 < 3 秒（從開機自啟動到 System Tray 就緒）
- NFR7: SQLite 查詢回應 < 200 ms（歷史搜尋、Dashboard 統計計算）

**安全**
- NFR8: API Key 使用 tauri-plugin-store 儲存於 App Data 目錄（明文 JSON），不暴露於日誌或網路，安全依賴 OS 檔案系統權限
- NFR9: 轉錄資料僅存於本地 SQLite，不上傳至任何第三方服務
- NFR10: 所有 Groq API 請求透過 HTTPS
- NFR11: 剪貼簿內容作為 AI 上下文注入時，僅傳送至使用者自行配置的 Groq API

**整合**
- NFR12: Groq Whisper API 依賴網路，無離線替代，失敗時 HUD 顯示錯誤，使用者可重試
- NFR13: Groq LLM API 依賴網路，有 timeout 降級，5 秒逾時則跳過 AI 整理，直接貼上原始轉錄
- NFR14: 作業系統剪貼簿系統層級高可靠，失敗視為系統錯誤
- NFR15: 作業系統鍵盤模擬需權限，macOS 需 Accessibility 授權，未授權時引導

**可靠性**
- NFR16: 系統可用率 > 99%（排除網路問題），App 本身不 crash、不凍結
- NFR17: 歷史記錄零遺失，SQLite WAL 模式確保寫入安全
- NFR18: API 失敗不影響 App 穩定性，回到 idle 狀態，可立即重試
- NFR19: 自動更新失敗不影響現有功能，背景下載，使用者確認後安裝

### Additional Requirements

**來自架構文件：**
- Brownfield 專案：基於已完成 POC 擴展，不需專案初始化。第一個實作 Story 應新增 SQLite 基礎架構 + 擴展 OS-native 熱鍵監聽
- 雙視窗架構：HUD Window（App.vue）+ Main Window（MainApp.vue），需在 tauri.conf.json 定義
- Tauri Events 跨視窗同步：使用 `emitTo(windowLabel, event, payload)` 跨視窗廣播關鍵狀態變更
- 前端直接 SQL：tauri-plugin-sql 前端直接執行 SQL，資料存取邏輯集中在 Pinia stores 的 actions 中
- API Key 儲存：tauri-plugin-store 本地儲存（明文 JSON），不整合 OS 原生 Keychain，安全依賴 OS 檔案系統權限
- 前端直接呼叫 Groq API：transcriber.ts + enhancer.ts 直接呼叫，CSP 限制 connect-src 至 self + https://api.groq.com
- 錯誤處理模式：Service 層拋出有意義錯誤 → Store 層 catch + 降級 + 使用者提示
- SQLite Schema：transcriptions / vocabulary / schema_version 三張表，WAL 模式
- 自動更新：tauri-plugin-updater + 自訂 endpoint（靜態 JSON + 檔案託管）
- V2 新依賴（Rust）：tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.x（rdev 已取消，改用 OS-native API；enigo 已移除）
- V2 新依賴（JS）：vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store
- 命名規範：Rust snake_case / TS camelCase / Vue PascalCase / SQLite snake_case / Tauri Events {domain}:{action} kebab-case
- 專案結構：lib/（純邏輯）→ stores/（狀態管理）→ composables/（Vue 邏輯）→ views/（頁面）→ components/（元件），依賴方向單向
- 實作順序建議：SQLite 初始化 → Pinia stores → 雙視窗架構 → Tauri Events → API Key 儲存 → Groq LLM → 自動更新

**來自 POC 規格書：**
- 現有 POC 元件可沿用：recorder.ts、transcriber.ts、clipboard_paste.rs、NotchHud.vue、useHudState.ts、useVoiceFlow.ts
- 現有 POC 元件需擴展重寫：fn_key_listener.rs → hotkey_listener.rs（CGEventTap 擴展多鍵 + Windows SetWindowsHookExW）
- 現有 POC 元件需擴展：NotchHud.vue（3態→6態）、useVoiceFlow.ts（新增 AI 整理步驟）、transcriber.ts（詞彙注入）

### FR Coverage Map

- FR1: Epic 1 — 全域快捷鍵觸發錄音
- FR2: Epic 1 — 自選修飾鍵（macOS/Windows）
- FR3: Epic 1 — Hold/Toggle 雙觸發模式
- FR4: Epic 1 — 麥克風音訊擷取
- FR5: Epic 1 — 音訊封裝為 API 格式
- FR6: Epic 1 — Groq Whisper API 轉錄
- FR7: Epic 3 — 詞彙注入 Whisper prompt
- FR8: Epic 2 — Groq LLM 口語→書面語整理
- FR9: Epic 2 — 字數門檻跳過 AI 整理
- FR10: Epic 2 — 編輯 AI 整理 prompt
- FR11: Epic 2 — 重置 prompt 為預設值
- FR12: Epic 2 — 剪貼簿+詞彙上下文注入 AI
- FR13: Epic 1 — 文字自動貼入任何應用程式
- FR14: Epic 1 — 剪貼簿寫入+模擬貼上
- FR15: Epic 2 — 貼上後鍵盤監控（品質衡量）
- FR16: Epic 3 — 新增自訂詞彙
- FR17: Epic 3 — 刪除自訂詞彙
- FR18: Epic 3 — 瀏覽詞彙清單
- FR19: Epic 3 — 詞彙注入 Whisper+AI 上下文
- FR20: Epic 4 — 自動記錄轉錄完整資料
- FR21: Epic 4 — 瀏覽歷史記錄列表
- FR22: Epic 4 — 搜尋歷史記錄
- FR23: Epic 4 — 複製歷史記錄文字
- FR24: Epic 4 — Dashboard 統計指標
- FR25: Epic 4 — Dashboard 最近轉錄摘要
- FR26: Epic 1 — HUD 狀態顯示（基本 4 態：recording/transcribing/success/error）
- FR27: Epic 1 — success 狀態自動收起 HUD
- FR28: Epic 1 — API 失敗 HUD 錯誤訊息
- FR29: Epic 2 — Groq API 逾時 fallback 原始文字
- FR30: Epic 5 — 設定頁面配置快捷鍵
- FR31: Epic 1 — 設定頁面輸入/修改 API Key
- FR32: Epic 1 — System Tray 常駐 + 開啟主視窗
- FR33: Epic 5 — 開機自啟動
- FR34: Epic 5 — 自動更新
- FR35: Epic 1 — macOS Accessibility 權限引導
- FR36: Epic 1 — 首次錄音麥克風權限
- FR37: Epic 4 — 錄音永久儲存與播放
- FR38: Epic 2 — Whisper 幻覺偵測與自動學習
- FR39: Epic 5 — 幻覺詞庫管理 UI + 錄音清理設定

## Epic List

### Epic 1: 跨平台語音輸入基礎
使用者在 macOS 和 Windows 上按住可配置的熱鍵，說話後文字自動貼入游標位置，HUD 顯示即時狀態回饋。包含 V2 基礎架構建設（OS-native 熱鍵、SQLite、Pinia、雙視窗、tauri-plugin-store）及 Onboarding 體驗（API Key 輸入、權限引導）。
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR13, FR14, FR26, FR27, FR28, FR31, FR32, FR35, FR36

### Epic 2: AI 文字智慧整理
轉錄結果自動經 Groq LLM 從口語轉為通順的書面語，短文智慧跳過，逾時優雅降級至原始文字。使用者可自訂 prompt 控制整理行為，系統注入剪貼簿與詞彙作為上下文。HUD 新增 enhancing 狀態。貼上後鍵盤監控衡量輸出品質。系統自動偵測並攔截 Whisper 幻覺文字，透過語速異常偵測、noSpeechProbability 門檻與幻覺詞庫三層架構判定，支援自動學習。Whisper prompt 加入雙語提示以改善中英混講辨識品質，AI 整理 prompt 增加語言混淆修正指令。
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR15, FR29, FR38

### Epic 3: 自訂詞彙字典
使用者維護個人詞彙庫（專案名、人名、技術術語），詞彙同時注入 Whisper API prompt 提升辨識率，以及 AI 整理上下文確保正確用詞。提供 CRUD UI 管理詞彙。
**FRs covered:** FR7, FR16, FR17, FR18, FR19

### Epic 4: 歷史記錄與 Dashboard
系統自動記錄每次成功轉錄的完整資料，使用者可瀏覽、搜尋、複製歷史記錄。Dashboard 顯示使用統計（總口述時間、字數、速度、節省時間、使用次數、AI 使用率）與最近轉錄摘要。每次錄音 WAV 檔案永久儲存至本地磁碟，使用者可在歷史記錄中播放錄音。轉錄失敗時可一鍵重送錄音給 Whisper（限一次）。失敗的轉錄也記錄至歷史。
**FRs covered:** FR20, FR21, FR22, FR23, FR24, FR25, FR37

### Epic 5: 應用程式設定與生命週期管理
使用者可在完整設定頁面配置快捷鍵（觸發鍵選擇+觸發模式），應用程式支援開機自啟動（可關閉）和自動更新（背景下載+提示安裝）。設定頁面新增幻覺詞庫管理區塊與錄音檔清理設定。
**FRs covered:** FR30, FR33, FR34, FR39

**Infrastructure Notes (from Story 1.1 code review):**

- **必須加入 `autostart:default` 和 `updater:default` 權限至 capabilities** — Story 1.1 已在 lib.rs 註冊 plugin，但 capabilities/default.json 尚未包含前端權限，需在對應 Story 中補上
- **考慮拆分 capability 檔案** — 目前 HUD Window 和 Main Window 共用同一份 capabilities（包含 sql:default、store:default），但 HUD 不應有 DB 權限。建議建立 `hud.json` 和 `dashboard.json` 分別授權，符合最小權限原則

---

## Epic 1: 跨平台語音輸入基礎

使用者在 macOS 和 Windows 上按住可配置的熱鍵，說話後文字自動貼入游標位置，HUD 顯示即時狀態回饋。包含 V2 基礎架構建設（OS-native 熱鍵、SQLite、Pinia、雙視窗、tauri-plugin-store）及 Onboarding 體驗（API Key 輸入、權限引導）。

### Story 1.1: V2 基礎架構與雙視窗設置

As a 開發者,
I want V2 所需的基礎架構（依賴、資料庫、狀態管理、雙視窗、路由）全部就緒,
So that 後續所有功能開發都能在穩定的架構基礎上進行。

**Acceptance Criteria:**

**Given** 現有 POC 專案結構
**When** 安裝所有 V2 新增的 Rust 依賴（tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.x）
**Then** Cargo.toml 包含所有新依賴且 `cargo check` 通過
**And** tauri.conf.json 中的 plugins 區塊正確註冊所有新 plugin

**Given** 現有 POC 專案結構
**When** 安裝所有 V2 新增的 JS 依賴（vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store）
**Then** package.json 包含所有新依賴且 `pnpm install` 無錯誤

**Given** V2 依賴已安裝
**When** App 啟動時執行 database.ts 的初始化邏輯
**Then** SQLite 資料庫在 App Data 目錄建立，包含 transcriptions、vocabulary、schema_version 三張表
**And** SQLite 使用 WAL 模式
**And** schema_version 表記錄當前版本號

**Given** V2 依賴已安裝
**When** 建立 Pinia stores 骨架（useSettingsStore, useHistoryStore, useVocabularyStore, useVoiceFlowStore）
**Then** 每個 store 檔案存在於 src/stores/ 目錄
**And** 每個 store 使用 defineStore 正確定義
**And** Pinia 在 main.ts 和 main-window.ts 中正確初始化

**Given** V2 依賴已安裝
**When** 配置 tauri.conf.json 支援雙視窗（HUD Window + Main Window）
**Then** HUD Window 維持現有配置（置頂、透明、不可互動）
**And** Main Window 配置為標準視窗，從 main-window.html 載入
**And** Vite 配置新增 main-window.html 作為額外入口點

**Given** 雙視窗配置完成
**When** 建立 Main Window 相關檔案（MainApp.vue, main-window.ts, router.ts）
**Then** MainApp.vue 包含左側 Sidebar 導航（Dashboard / 歷史 / 字典 / 設定）與右側內容區域
**And** Vue Router 使用 hash mode 配置四個路由（/dashboard, /history, /dictionary, /settings）
**And** 每個路由對應的 View 元件存在（DashboardView, HistoryView, DictionaryView, SettingsView）作為空白佔位

**Given** 雙視窗配置完成
**When** 建立 Tauri Events 跨視窗通訊封裝（useTauriEvents.ts）
**Then** Re-export Tauri `emitTo` 為 `emitToWindow`，保留原始 Tauri API 簽名
**And** Re-export Tauri `listen` 為 `listenToEvent`，保留原始 Tauri API 簽名
**And** 定義事件常數，命名遵循 {domain}:{action} kebab-case 規範

### Story 1.2: 跨平台全域熱鍵系統（OS-native）

As a 使用者,
I want 透過可配置的全域熱鍵觸發語音錄音，在 macOS 和 Windows 上都能使用,
So that 我不需要切換到 App 視窗就能隨時啟動語音輸入。

**Acceptance Criteria:**

**Given** OS 原生 API 可用（macOS CGEventTap / Windows SetWindowsHookExW）
**When** 重寫 hotkey_listener.rs 使用 OS 原生 API（擴展現有 CGEventTap + 新增 Windows WH_KEYBOARD_LL）
**Then** 在 macOS 上可監聽 Fn、Option、Control、Command、Shift 鍵事件
**And** 在 Windows 上可監聽右 Alt、左 Alt、Control、Shift 鍵事件
**And** 預設觸發鍵：macOS 為 Fn，Windows 為右 Alt

**Given** hotkey_listener.rs 使用 OS 原生 API 實作
**When** 使用者在 Hold 模式下按住觸發鍵
**Then** 系統發送 `hotkey:pressed` Tauri Event 至 WebView
**And** 使用者放開觸發鍵時發送 `hotkey:released` Tauri Event
**And** 事件 payload 包含 `{ mode: 'hold', action: 'start' | 'stop' }`

**Given** hotkey_listener.rs 使用 OS 原生 API 實作
**When** 使用者在 Toggle 模式下按一下觸發鍵
**Then** 系統發送 `hotkey:toggled` Tauri Event，payload 為 `{ mode: 'toggle', action: 'start' }`
**And** 再次按一下觸發鍵時發送 `{ mode: 'toggle', action: 'stop' }`

**Given** 熱鍵系統運作中
**When** 使用者透過 useSettingsStore 變更觸發鍵或觸發模式
**Then** hotkey_listener 即時切換為新的觸發鍵和模式
**And** 無需重啟 App

**Given** 熱鍵系統運作中
**When** App 在背景執行（非前景視窗）
**Then** 全域熱鍵仍可正常觸發
**And** 不干擾其他應用程式的正常鍵盤操作

**Given** 自訂模式的按鍵錄製
**When** 使用者按住 modifier(s) + 按一個普通鍵
**Then** 系統記錄 `{ modifiers: [...], keycode }` 組合
**And** 設定 UI 顯示組合鍵名稱（如「Ctrl + Space」）

**Given** 組合鍵已設定
**When** 使用者在任何應用程式按下相同組合
**Then** macOS 透過 CGEventFlags 驗證 modifier 狀態 + keycode 匹配
**And** Windows 透過 GetKeyState() 驗證 modifier 狀態 + VK code 匹配
**And** Hold/Toggle 模式正常運作

**Given** 舊版本使用者升級
**When** 載入舊的 `Custom { keycode }` 設定
**Then** 自動解析為 `{ modifiers: [], keycode }`（向後相容）

### Story 1.3: API Key 安全儲存與 System Tray 整合

As a 使用者,
I want 安全地儲存我的 Groq API Key 並從 System Tray 開啟主視窗,
So that 我的 API Key 不會外洩，且能方便地存取 App 設定。

**Acceptance Criteria:**

**Given** tauri-plugin-store 已安裝
**When** 使用者在 SettingsView 的 API Key 輸入框中輸入 API Key 並儲存
**Then** API Key 透過 tauri-plugin-store 儲存於本地 App Data 目錄
**And** API Key 不存入 SQLite 資料庫
**And** 輸入框以密碼模式顯示（遮罩）
**And** useSettingsStore 更新 hasApiKey 狀態

**Given** API Key 已儲存
**When** App 啟動或其他模組需要 API Key
**Then** 可從 tauri-plugin-store 讀取已儲存的 API Key
**And** API Key 僅在記憶體中供 transcriber.ts 和 enhancer.ts 使用

**Given** App 正在執行
**When** 使用者透過 System Tray 右鍵選單選擇「開啟 Dashboard」
**Then** Main Window 開啟並顯示 Dashboard 頁面
**And** 若 Main Window 已開啟，則將其帶至前景

**Given** App 首次啟動且無 API Key
**When** App 啟動完成
**Then** 自動開啟 Main Window 並導向 Settings 頁面的 API Key 區塊
**And** 顯示提示訊息引導使用者輸入 API Key

**Given** System Tray 選單
**When** 使用者右鍵點擊 System Tray 圖示
**Then** 顯示選單項目：「開啟 Dashboard」、「結束」
**And** 選擇「開啟 Dashboard」開啟 Main Window
**And** 選擇「結束」關閉 App

### Story 1.4: 語音錄音→轉錄→貼上完整流程

As a 使用者,
I want 按住熱鍵說話後，語音自動轉為文字並貼入游標位置,
So that 我能在任何應用程式中用語音取代打字。

**Acceptance Criteria:**

**Given** API Key 已設定且熱鍵系統運作中
**When** 使用者按住觸發鍵（Hold 模式）
**Then** 系統透過 `navigator.mediaDevices.getUserMedia()` 開始麥克風錄音
**And** useVoiceFlowStore 狀態更新為 'recording'
**And** 發送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`

**Given** 錄音進行中
**When** 使用者放開觸發鍵
**Then** MediaRecorder 停止錄音並產生音訊 blob
**And** 音訊封裝為 Groq Whisper API 可接受的格式（multipart/form-data）
**And** useVoiceFlowStore 狀態更新為 'transcribing'
**And** 發送 `voice-flow:state-changed` 事件 `{ status: 'transcribing' }`

**Given** 音訊已錄製完成
**When** 系統將音訊送至 Groq Whisper API（model: whisper-large-v3, language: zh）
**Then** 取得繁體中文轉錄結果
**And** API 請求透過 HTTPS 傳送
**And** API Key 從 useSettingsStore 取得

**Given** 轉錄結果已取得
**When** 系統呼叫 `invoke('paste_text', { text })` 將文字貼入
**Then** clipboard_paste.rs 將文字寫入系統剪貼簿
**And** 模擬 Cmd+V（macOS）或 Ctrl+V（Windows）執行貼上
**And** 文字出現在當前游標所在的應用程式中
**And** useVoiceFlowStore 狀態更新為 'success'

**Given** Toggle 模式啟用
**When** 使用者按一下觸發鍵開始錄音，再按一下停止
**Then** 錄音→轉錄→貼上流程與 Hold 模式相同
**And** 流程正確完成

**Given** Groq Whisper API 請求失敗（網路斷線、API 錯誤等）
**When** API 回應非 200 或網路超時
**Then** useVoiceFlowStore 狀態更新為 'error'
**And** 發送 `voice-flow:state-changed` 事件 `{ status: 'error', message: '人類可讀錯誤訊息' }`
**And** 不執行貼上動作
**And** App 回到 idle 狀態，可立即重試

**Migration Notes (from Story 1.1 implementation):**

- **必須遷移 `useVoiceFlow.ts` → `useVoiceFlowStore`** — 現有 composable 直接管理 HUD 狀態，1.4 需將錄音/轉錄/貼上流程改為透過 Pinia store 驅動
- **必須遷移 `useHudState.ts` auto-hide timer 邏輯至 store 或保留為 HUD-only composable** — `useHudState.transitionTo` 含 success/error 自動收起計時器和 showHud/hideHud 副作用，需決定這些邏輯歸 store 還是留在 HUD Window 的 composable
- **必須統一 `TranscriptionResult` → `TranscriptionRecord`** — POC 的 `TranscriptionResult`（text + duration）應被 V2 的 `TranscriptionRecord` 取代，`transcriber.ts` 回傳型別需同步更新
- **清理舊 composables** — 遷移完成後移除或重構 `useVoiceFlow.ts`、`useHudState.ts` 中被 store 取代的邏輯

### Story 1.5: HUD 狀態顯示與權限引導

As a 使用者,
I want 在語音輸入過程中看到清晰的狀態回饋，並在首次使用時順利完成權限設定,
So that 我隨時知道系統在做什麼，且不會因權限問題卡住。

**Acceptance Criteria:**

**Given** 使用者觸發錄音
**When** useVoiceFlowStore 狀態為 'recording'
**Then** NotchHud.vue 顯示錄音狀態（紅點脈衝動畫 + 「錄音中...」文字）
**And** HUD 從 idle 展開至錄音狀態的動畫 < 100ms

**Given** 錄音結束，開始轉錄
**When** useVoiceFlowStore 狀態為 'transcribing'
**Then** NotchHud.vue 顯示轉錄狀態（loading spinner + 「轉錄中...」文字）
**And** 狀態轉換動畫流暢

**Given** 轉錄（或未來 AI 整理）完成
**When** useVoiceFlowStore 狀態為 'success'
**Then** NotchHud.vue 顯示成功狀態（「已貼上 ✓」）
**And** 約 0.8~1.2 秒後自動收起回 idle
**And** 收起動畫流暢

**Given** API 請求失敗
**When** useVoiceFlowStore 狀態為 'error'
**Then** NotchHud.vue 顯示錯誤狀態（錯誤訊息文字）
**And** 錯誤訊息為人類可讀格式（如「網路連線中斷」「API 請求失敗」）
**And** 約 2~3 秒後自動收起回 idle

**Given** macOS 平台首次啟動 App
**When** App 偵測到尚未取得 Accessibility 權限
**Then** 顯示引導畫面說明為何需要此權限
**And** 提供按鈕開啟系統偏好設定的 Accessibility 面板
**And** 使用者授權後可正常使用熱鍵

**Given** 任何平台首次觸發錄音
**When** 系統呼叫 `getUserMedia()` 請求麥克風權限
**Then** 作業系統顯示麥克風權限請求對話框
**And** 使用者允許後開始錄音
**And** 使用者拒絕後 HUD 顯示錯誤訊息提示需要麥克風權限

---

## Epic 2: AI 文字智慧整理

轉錄結果自動經 Groq LLM 從口語轉為通順的書面語，短文智慧跳過，逾時優雅降級至原始文字。使用者可自訂 prompt 控制整理行為，系統注入剪貼簿與詞彙作為上下文。HUD 新增 enhancing 狀態。貼上後鍵盤監控衡量輸出品質。系統自動偵測並攔截 Whisper 幻覺文字，透過語速異常偵測、noSpeechProbability 門檻與幻覺詞庫三層架構判定，支援自動學習。Whisper prompt 加入雙語提示以改善中英混講辨識品質，AI 整理 prompt 增加語言混淆修正指令。

### Story 2.1: Groq LLM AI 文字整理核心流程

As a 使用者,
I want 語音轉錄結果自動經 AI 整理為通順的書面語,
So that 我的語音輸出可以直接使用，不需手動編輯口語贅詞和標點。

**Acceptance Criteria:**

**Given** Epic 1 的語音轉錄流程已就緒
**When** 建立 enhancer.ts 模組
**Then** 模組可呼叫 Groq LLM API（chat/completions endpoint）
**And** 使用預設 system prompt 進行口語→書面語整理
**And** API Key 從 useSettingsStore 取得
**And** API 請求透過 HTTPS 傳送

**Given** 轉錄結果文字長度 >= 10 字
**When** 轉錄完成後進入 AI 整理流程
**Then** useVoiceFlowStore 狀態更新為 'enhancing'
**And** 發送 `voice-flow:state-changed` 事件 `{ status: 'enhancing' }`
**And** NotchHud.vue 顯示「整理中...」狀態（loading spinner）
**And** AI 整理完成後將整理後的文字貼入游標位置

**Given** 轉錄結果文字長度 < 10 字
**When** 轉錄完成
**Then** 跳過 AI 整理步驟
**And** 直接將原始轉錄文字貼入游標位置
**And** useVoiceFlowStore 狀態直接從 'transcribing' 跳至 'success'

**Given** AI 整理 API 請求進行中
**When** 請求超過 5 秒未回應
**Then** 自動取消請求（timeout）
**And** 將原始轉錄文字貼入游標位置作為 fallback
**And** useVoiceFlowStore 狀態更新為 'success'
**And** HUD 顯示「已貼上（未整理）」

**Given** AI 整理 API 請求失敗（非 timeout）
**When** API 回應非 200
**Then** 將原始轉錄文字貼入游標位置作為 fallback
**And** useVoiceFlowStore 狀態更新為 'success'
**And** HUD 顯示「已貼上（未整理）」

**Given** AI 整理完成
**When** 文字成功貼入
**Then** 端到端延遲（含 AI 整理）< 3 秒
**And** HUD 狀態完整流程：idle → recording → transcribing → enhancing → success → idle

### Story 2.2: AI Prompt 自訂與上下文注入

As a 使用者,
I want 自訂 AI 整理的 prompt 並注入上下文資訊,
So that 我能控制 AI 的整理風格，且 AI 能根據當前情境做更好的整理。

**Acceptance Criteria:**

**Given** SettingsView 的 AI 區塊
**When** 使用者開啟設定頁面
**Then** 顯示 AI 整理 Prompt 多行文字編輯區域
**And** 預設填入預設 prompt（去口語、修標點、適當分段、保持原意）
**And** 使用者可自由編輯 prompt 內容

**Given** 使用者修改了 prompt
**When** 使用者儲存變更
**Then** 新 prompt 透過 useSettingsStore 持久化至 tauri-plugin-store
**And** 後續的 AI 整理請求使用新 prompt

**Given** 使用者想恢復預設
**When** 點擊「重置為預設」按鈕
**Then** prompt 編輯區域恢復為預設 prompt 內容
**And** 自動儲存至 tauri-plugin-store

**Given** AI 整理請求即將發送
**When** enhancer.ts 組裝 API 請求
**Then** 將使用者當前剪貼簿內容作為 `<clipboard>` 標籤注入 system prompt
**And** 若有自訂詞彙，將詞彙清單作為 `<vocabulary>` 標籤注入 system prompt
**And** 使用者自訂的 prompt 作為主要 system prompt

**Given** 剪貼簿為空或詞彙清單為空
**When** AI 整理請求發送
**Then** 對應的上下文標籤不注入（不傳空標籤）
**And** AI 整理仍正常運作

**Given** Whisper API 請求即將發送
**When** `format_whisper_prompt()` 組裝 prompt
**Then** 除字典詞外，根據 `selectedTranscriptionLocale` 加入語言混合範例
**And** `zh` → 注入中英混合範例（如「部署 deploy, 測試 test, main.py」）
**And** `en` → 注入英中混合範例（如「deploy 部署, API endpoint」）
**And** `auto` → 注入最廣泛的多語混合範例

**Given** AI 整理請求即將發送
**When** enhancer 組裝 system prompt
**Then** 包含「修正語音辨識中明顯的語言混淆，例如英文術語被轉為中文諧音」指令

### Story 2.3: 貼上後品質監控

As a 使用者,
I want 系統追蹤我是否修改了貼上的文字,
So that 我能透過統計數據了解 AI 整理的輸出品質趨勢。

**Acceptance Criteria:**

**Given** 文字已成功貼入游標位置
**When** 新增 keyboard_monitor.rs 模組（使用 OS-native API）
**Then** 模組在貼上完成後開始監聽鍵盤事件
**And** 監聽時間窗口為 5 秒

**Given** 貼上後監聽期間
**When** 使用者在 5 秒內按下 Backspace 或 Delete 鍵
**Then** 判定此次輸出「被修改」（wasModified = true）
**And** 透過 Tauri Event 將結果回傳前端

**Given** 貼上後監聽期間
**When** 5 秒內未偵測到 Backspace 或 Delete 鍵
**Then** 判定此次輸出「未修改」（wasModified = false）
**And** 透過 Tauri Event 將結果回傳前端

**Given** 品質監控結果回傳
**When** useVoiceFlowStore 收到 wasModified 結果
**Then** 將結果附加至當前轉錄記錄
**And** 供後續歷史記錄儲存使用（Epic 4）

**Given** 使用者在其他應用程式中操作（非修改貼上的文字）
**When** 按下的 Backspace/Delete 與貼上目標不在同一焦點窗口
**Then** 仍記錄為 wasModified = true（簡單版不做焦點判斷，接受誤判）

### Story 2.4: Whisper 幻覺偵測與自動學習

As a 使用者,
I want 系統自動偵測並攔截 Whisper 幻覺文字,
So that 沒講話或很短停頓時不會有亂碼被貼入編輯器。

**Acceptance Criteria:**

**Given** 轉錄結果回傳
**When** 錄音時長 < 1 秒且文字 > 10 字（語速異常）
**Then** 判定為幻覺，不貼上，HUD 顯示「未偵測到語音」
**And** 該文字自動加入 `hallucination_terms` 表
**And** HUD 短暫通知「已學習幻覺詞：{text}」

**Given** 轉錄結果回傳
**When** noSpeechProbability > 0.9 且文字命中幻覺詞庫
**Then** 判定為幻覺，不貼上

**Given** 轉錄結果回傳
**When** 兩層弱可疑指標同時成立（noSpeechProb > 0.7 且語速偏高）
**Then** 判定為幻覺，不貼上

**Given** 轉錄結果回傳
**When** 只有一層弱可疑
**Then** 放行，正常貼上

**Given** 轉錄語言設定為不同語言
**When** 幻覺偵測 Layer 3 載入內建詞庫
**Then** 根據 `selectedTranscriptionLocale` 載入對應語言的幻覺詞庫
**And** `zh` 載入中文幻覺詞（「謝謝收看」「字幕組」等）
**And** `en` 載入英文幻覺詞（「Thank you for watching」「Subscribe」等）
**And** `auto` 載入所有語言的幻覺詞庫

**Given** 幻覺詞庫頁面（HallucinationView.vue）
**When** 使用者從側邊欄開啟幻覺詞庫頁面
**Then** 顯示所有幻覺詞（內建 + 自動學習 + 手動新增）
**And** 使用者可手動新增/刪除幻覺詞

---

## Epic 3: 自訂詞彙字典

使用者維護個人詞彙庫（專案名、人名、技術術語），詞彙同時注入 Whisper API prompt 提升辨識率，以及 AI 整理上下文確保正確用詞。提供 CRUD UI 管理詞彙。

### Story 3.1: 詞彙字典 CRUD 介面

As a 使用者,
I want 管理我的個人詞彙字典（新增、刪除、瀏覽）,
So that 我能將常用的專有名詞加入系統以提升辨識準確度。

**Acceptance Criteria:**

**Given** Main Window 的字典頁面（DictionaryView.vue）
**When** 使用者開啟字典頁面
**Then** 顯示完整的自訂詞彙清單（表格形式）
**And** 頁面頂部顯示詞彙總數統計
**And** 清單為空時顯示空狀態提示（如「尚無自訂詞彙，新增常用術語以提升辨識率」）

**Given** 字典頁面已開啟
**When** 使用者在新增輸入框中輸入詞彙並按下新增按鈕（或 Enter）
**Then** useVocabularyStore 呼叫 addTerm() 將詞彙寫入 SQLite vocabulary 表
**And** 詞彙清單即時更新顯示新詞彙
**And** 輸入框清空，準備下一次輸入
**And** 發送 `vocabulary:changed` Tauri Event `{ action: 'add', term: '詞彙' }`

**Given** 使用者嘗試新增詞彙
**When** 輸入的詞彙已存在於字典中
**Then** 顯示提示「此詞彙已存在」
**And** 不重複新增

**Given** 使用者嘗試新增詞彙
**When** 輸入框為空白
**Then** 新增按鈕為 disabled 狀態
**And** 不執行新增操作

**Given** 詞彙清單中有既有詞彙
**When** 使用者點擊某詞彙旁的刪除按鈕
**Then** useVocabularyStore 呼叫 removeTerm() 從 SQLite 刪除該詞彙
**And** 詞彙清單即時更新
**And** 發送 `vocabulary:changed` Tauri Event `{ action: 'remove', term: '詞彙' }`

**Given** useVocabularyStore 已實作
**When** App 啟動或字典頁面載入
**Then** fetchTermList() 從 SQLite 讀取所有詞彙
**And** SQLite column snake_case 正確映射為 TypeScript camelCase

### Story 3.2: 詞彙注入 Whisper 與 AI 上下文

As a 使用者,
I want 我的自訂詞彙自動提升語音辨識和 AI 整理的準確度,
So that 專業術語不再被錯誤辨識或轉換。

**Acceptance Criteria:**

**Given** 使用者已建立自訂詞彙清單
**When** transcriber.ts 呼叫 Groq Whisper API
**Then** 將詞彙清單格式化為 `"Important Vocabulary: 詞彙1, 詞彙2, 詞彙3"` 字串
**And** 作為 Whisper API 的 `prompt` 參數傳入
**And** Whisper 辨識結果中的專有名詞準確度提升

**Given** 使用者已建立自訂詞彙清單且 AI 整理啟用
**When** enhancer.ts 呼叫 Groq LLM API
**Then** 將詞彙清單作為 `<vocabulary>詞彙1, 詞彙2, 詞彙3</vocabulary>` 注入 system prompt
**And** AI 整理結果中正確保留專有名詞原文

**Given** 詞彙清單為空
**When** 執行轉錄或 AI 整理
**Then** Whisper API 不帶 prompt 參數（或帶空字串）
**And** AI 整理的 system prompt 不包含 `<vocabulary>` 標籤
**And** 流程正常運作不報錯

**Given** 使用者在字典中新增或刪除詞彙
**When** 下一次觸發語音輸入
**Then** transcriber.ts 和 enhancer.ts 自動使用最新的詞彙清單
**And** 不需重啟 App 即時生效

**Given** 詞彙清單包含大量詞彙（100+）
**When** 注入 Whisper prompt 或 AI 上下文
**Then** 系統正常運作不超出 API 限制
**And** 若詞彙過多導致 prompt 超長，截取最近新增的詞彙優先注入

---

## Epic 4: 歷史記錄與 Dashboard

系統自動記錄每次成功轉錄的完整資料，使用者可瀏覽、搜尋、複製歷史記錄。Dashboard 顯示使用統計（總口述時間、字數、速度、節省時間、使用次數、AI 使用率）與最近轉錄摘要。每次錄音 WAV 檔案永久儲存至本地磁碟，使用者可在歷史記錄中播放錄音。轉錄失敗時可一鍵重送錄音給 Whisper（限一次）。失敗的轉錄也記錄至歷史。

### Story 4.1: 轉錄記錄自動儲存

As a 使用者,
I want 每次語音輸入的完整資料自動被記錄下來,
So that 我能回顧歷史並追蹤使用統計。

**Acceptance Criteria:**

**Given** 一次成功的語音轉錄流程完成（含或不含 AI 整理）
**When** useVoiceFlowStore 狀態轉為 'success' 且文字已貼入
**Then** useHistoryStore.addTranscription() 將完整記錄寫入 SQLite transcriptions 表
**And** 記錄包含：id（UUID）、timestamp、rawText、processedText（若有）、recordingDurationMs、transcriptionDurationMs、enhancementDurationMs（若有）、charCount、triggerMode、wasEnhanced、wasModified（若已取得）
**And** created_at 由 SQLite datetime('now') 自動產生

**Given** 轉錄記錄已寫入 SQLite
**When** 儲存成功
**Then** 發送 `transcription:completed` Tauri Event 至 Main Window
**And** payload 包含新記錄的摘要資訊 `{ id, rawText, processedText, charCount, wasEnhanced }`
**And** Main Window 的 Dashboard 若已開啟，即時更新

**Given** 轉錄流程失敗（API 錯誤、網路斷線）
**When** useVoiceFlowStore 狀態為 'error'
**Then** 不寫入歷史記錄
**And** 不發送 `transcription:completed` 事件

**Given** useHistoryStore 的 addTranscription()
**When** 從 TypeScript camelCase 資料寫入 SQLite
**Then** 正確映射為 SQLite snake_case 欄位名
**And** SQLite WAL 模式確保寫入安全
**And** 寫入操作 < 200ms

**Given** AI 整理被跳過（字數 < 10 或 timeout fallback）
**When** 記錄寫入
**Then** processedText 為 null
**And** wasEnhanced 為 false
**And** enhancementDurationMs 為 null

### Story 4.2: 歷史記錄瀏覽、搜尋與複製

As a 使用者,
I want 瀏覽、搜尋和複製我的歷史轉錄記錄,
So that 我能找回之前說過的內容並重新使用。

**Acceptance Criteria:**

**Given** Main Window 的歷史頁面（HistoryView.vue）
**When** 使用者開啟歷史頁面
**Then** 顯示轉錄記錄列表，按時間倒序排列（最新在上）
**And** 每筆記錄顯示：時間戳、文字預覽（前 50 字截斷）、錄音時長、是否經 AI 整理標記
**And** 記錄列表支援無限捲動或分頁載入

**Given** 歷史記錄列表
**When** 使用者點擊某筆記錄
**Then** 展開顯示完整文字內容
**And** 若有 AI 整理，同時顯示原始文字和整理後文字
**And** 顯示詳細資訊（錄音時長、轉錄耗時、AI 整理耗時、字數、觸發模式）

**Given** 歷史頁面頂部搜尋框
**When** 使用者輸入搜尋關鍵字
**Then** 對 rawText 和 processedText 欄位執行全文搜尋
**And** 即時過濾顯示符合的記錄
**And** 搜尋回應 < 200ms
**And** 搜尋框為空時顯示全部記錄

**Given** 歷史記錄展開狀態
**When** 使用者點擊複製按鈕
**Then** 將整理後文字（processedText）複製到剪貼簿
**And** 若無整理後文字，複製原始文字（rawText）
**And** 顯示短暫的「已複製」回饋提示

**Given** 歷史記錄為空
**When** 使用者開啟歷史頁面
**Then** 顯示空狀態提示（如「尚無轉錄記錄，開始使用語音輸入吧！」）

### Story 4.3: Dashboard 統計與最近轉錄摘要

As a 使用者,
I want 在 Dashboard 看到使用統計和最近的轉錄摘要,
So that 我能量化語音輸入帶來的效率增益並快速回顧最近的使用。

**Acceptance Criteria:**

**Given** Main Window 的 Dashboard 頁面（DashboardView.vue）
**When** 使用者開啟 Dashboard
**Then** 顯示 6 張統計卡片，資料從 useHistoryStore.calculateDashboardStats() 計算
**And** 所有統計查詢回應 < 200ms

**Given** Dashboard 統計卡片
**When** 計算統計數據
**Then** 「總口述時間」= sum(recordingDurationMs) 轉為小時/分鐘顯示
**And** 「口述字數」= sum(charCount)
**And** 「平均口述速度」= total_chars / total_recording_duration（字/分鐘）
**And** 「節省時間」= total_chars / 40（假設平均打字速度 40 字/分鐘）轉為小時/分鐘
**And** 「總使用次數」= count(records)
**And** 「AI 整理使用率」= count(wasEnhanced=true) / count(total) 顯示為百分比

**Given** Dashboard 頁面
**When** 統計卡片下方
**Then** 顯示最近 10 筆轉錄摘要列表
**And** 每筆顯示：時間戳、文字前 50 字截斷、是否經 AI 整理
**And** 點擊可跳轉至歷史頁面對應記錄

**Given** 無任何歷史記錄
**When** Dashboard 頁面載入
**Then** 統計卡片顯示初始值（0 小時、0 字、0 次等）
**And** 最近轉錄列表顯示空狀態提示

**Given** 新的轉錄記錄完成
**When** Main Window 收到 `transcription:completed` Tauri Event
**Then** Dashboard 統計數據自動重新計算並更新
**And** 最近轉錄列表自動新增該筆記錄至頂部
**And** 無需手動重新整理頁面

### Story 4.4: 錄音永久儲存與歷史播放

As a 使用者,
I want 每次錄音檔案永久儲存，並可在歷史記錄中播放,
So that 我能回聽自己說了什麼，也能在辨識失敗時重送。

**Acceptance Criteria:**

**Given** 錄音結束
**When** `stop_recording()` 完成 WAV 編碼
**Then** WAV 檔案寫入 `{APP_DATA}/recordings/{transcription_id}.wav`
**And** `transcriptions` 表的 `audio_file_path` 欄位記錄檔案路徑

**Given** 轉錄失敗（Whisper 回傳空字串或幻覺攔截）
**When** 失敗流程觸發
**Then** 仍然寫入 `transcriptions` 表，`status` 為 `failed`
**And** 錄音檔案仍然保存

**Given** HistoryView 顯示歷史記錄
**When** 該記錄有對應的錄音檔案
**Then** 顯示播放按鈕（▶）
**And** 點擊後透過 `convertFileSrc()` + HTML5 `<audio>` 播放

**Given** HistoryView 顯示歷史記錄
**When** 錄音檔案已被清理不存在
**Then** 播放按鈕灰顯 disabled

**Given** 設定頁面
**When** 使用者查看錄音儲存設定
**Then** 顯示「刪除所有錄音檔」按鈕
**And** 顯示「自動清理」開關 + 天數設定（預設 7 天）

### Story 4.5: 轉錄失敗一鍵重送

As a 使用者,
I want 轉錄失敗時可以一鍵重送錄音給 Whisper,
So that 我不需要崩潰重講。

**Acceptance Criteria:**

**Given** HUD 顯示 error 狀態
**When** 使用者點擊重送按鈕
**Then** 從磁碟讀取上一次錄音的 WAV 檔案
**And** HUD 切換為「轉錄中...」（復用 transcribing 狀態）
**And** 重新呼叫 `transcribe_audio()`

**Given** 重送成功
**When** Whisper 回傳有效文字
**Then** 進入正常的 AI 整理 → 貼上流程
**And** 更新 `transcriptions` 表的 `status` 為 `success`

**Given** 重送也失敗
**When** Whisper 再次回傳空字串
**Then** HUD 顯示「辨識失敗，請重新錄音」
**And** 不再提供重送按鈕

**Given** HUD error 狀態
**When** 重送按鈕顯示條件
**Then** 一律顯示（不區分是否確定有說話）

---

## Epic 5: 應用程式設定與生命週期管理

使用者可在完整設定頁面配置快捷鍵（觸發鍵選擇+觸發模式），應用程式支援開機自啟動（可關閉）和自動更新（背景下載+提示安裝）。設定頁面新增幻覺詞庫管理區塊與錄音檔清理設定。

### Story 5.1: 快捷鍵設定介面

As a 使用者,
I want 在設定頁面自訂觸發鍵和觸發模式,
So that 我能選擇最順手的按鍵組合來觸發語音輸入。

**Acceptance Criteria:**

**Given** SettingsView.vue 的快捷鍵設定區塊
**When** 使用者開啟設定頁面
**Then** 顯示「觸發鍵」下拉選單，依當前平台顯示可選項
**And** macOS 可選：Fn、Option、Control、Command、Shift
**And** Windows 可選：右 Alt（預設）、左 Alt、Control、Shift
**And** 當前已選的觸發鍵為預設選中狀態

**Given** 快捷鍵設定區塊
**When** 使用者開啟設定頁面
**Then** 顯示「觸發模式」切換控制項（Hold / Toggle）
**And** 當前模式為預設選中狀態
**And** 附帶簡短說明：Hold =「按住錄音，放開停止」/ Toggle =「按一下開始，再按停止」

**Given** 使用者變更觸發鍵
**When** 從下拉選單選擇新的觸發鍵
**Then** useSettingsStore 更新 hotkeyConfig 並持久化至 tauri-plugin-store
**And** 發送 `settings:updated` Tauri Event `{ key: 'hotkey', value: newConfig }`
**And** hotkey_listener.rs 接收事件後即時切換為新觸發鍵
**And** 無需重啟 App

**Given** 使用者變更觸發模式
**When** 切換 Hold / Toggle
**Then** useSettingsStore 更新 triggerMode 並持久化至 tauri-plugin-store
**And** 發送 `settings:updated` Tauri Event `{ key: 'triggerMode', value: 'hold' | 'toggle' }`
**And** hotkey_listener.rs 即時切換模式
**And** 無需重啟 App

**Given** App 重新啟動
**When** hotkey_listener.rs 初始化
**Then** 從 tauri-plugin-store 讀取已儲存的觸發鍵和觸發模式
**And** 使用使用者上次設定的配置啟動
**And** 若無儲存設定，使用平台預設值（macOS: Fn + Hold / Windows: 右Alt + Hold）

### Story 5.2: 開機自啟動與自動更新

As a 使用者,
I want App 開機自動啟動並自動保持最新版本,
So that 我不需要每天手動開啟 App，也不需要擔心錯過更新。

**Acceptance Criteria:**

**Given** tauri-plugin-autostart 已整合
**When** App 首次安裝完成
**Then** 預設啟用開機自啟動
**And** macOS 和 Windows 各自使用原生開機啟動機制

**Given** SettingsView.vue 的設定區塊
**When** 使用者查看設定頁面
**Then** 顯示「開機自啟動」開關
**And** 開關狀態反映當前自啟動設定

**Given** 使用者切換開機自啟動開關
**When** 開關從啟用切為關閉（或反之）
**Then** tauri-plugin-autostart 更新系統層級的自啟動設定
**And** 變更立即生效
**And** useSettingsStore 同步更新狀態

**Given** tauri-plugin-updater 已整合
**When** App 啟動完成
**Then** 背景呼叫自訂更新 endpoint（GET latest.json）檢查是否有新版本
**And** 檢查過程不阻塞 App 正常使用
**And** 若 endpoint 無法存取，靜默失敗不影響 App

**Given** 偵測到新版本可用
**When** 更新檔案背景下載完成
**Then** 顯示非阻塞式通知提示使用者「有新版本可用，重啟以安裝更新」
**And** 使用者可選擇立即重啟或稍後
**And** 選擇立即重啟後自動安裝更新並重新啟動 App

**Given** 自動更新過程中發生錯誤
**When** 下載失敗或簽名驗證失敗
**Then** 靜默失敗，不影響 App 現有功能
**And** 下次啟動時重新嘗試檢查更新
**And** 不向使用者顯示錯誤訊息（避免困擾）
