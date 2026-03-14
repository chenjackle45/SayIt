---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
workflowStatus: complete
completedAt: 2026-02-28
inputDocuments:
  - product-brief-sayit-2026-02-28.md
  - voice-transcription-poc-spec.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 0
  projectDocs: 1
classification:
  projectType: desktop_app
  domain: general
  complexity: low
  projectContext: brownfield
workflowType: 'prd'
---

# Product Requirements Document - SayIt

**Author:** Jackle
**Date:** 2026-02-28

## Executive Summary

SayIt 是一款跨平台桌面語音輸入工具，解決知識工作者「思考速度遠超打字速度」的核心瓶頸。使用者在任何應用程式中按住快捷鍵說話，放開後語音經 Groq Whisper API 轉錄，再由 Groq LLM 自動將口語轉為通順的繁體中文書面語（去除贅詞、重組句構、修正標點），直接貼入游標位置。

現有方案要麼輸出品質不足以直接使用（macOS 內建聽寫無 AI 後處理），要麼設定繁複（VoiceInk 需管理 12+ AI 提供商與本地模型），要麼需付費訂閱（Typeless）。SayIt 的目標是提供一個安裝後只需設定 API Key 即可使用的工具，讓語音輸入成為文字輸入的自然延伸。

本專案基於已完成的 POC（Fn 鍵監聽 → 錄音 → Whisper 轉錄 → 剪貼簿貼上）進行功能擴展，新增 AI 文字整理、跨平台熱鍵系統、自訂詞彙字典、歷史記錄與 Dashboard UI。主要使用者為開發者與知識工作者，中期目標推廣至公司內部非技術角色。

### What Makes This Special

1. **口語到書面語的無感橋接** — 過去語音輸入的瓶頸不在辨識準確度，而在輸出無法直接作為書面文字使用。Groq LLM 的低延遲讓 AI 後處理能在使用者無感的情況下完成口語→書面語轉換，首次實現「說完即可用」的體驗。

2. **刻意的極簡** — 設定只有三項（快捷鍵、API Key、AI Prompt），刻意排除多提供商、多語言、Per-App 設定等功能。一段 prompt 控制所有文字處理行為，降低認知負擔至零。

3. **即時感依賴低延遲基礎設施** — 選擇 Groq 作為唯一提供商不是偷懶，而是產品決策：端到端延遲 < 3 秒（含 AI 整理）是體驗的底線，Groq 的推論速度是讓這個體驗成立的技術前提。

## Project Classification

| 項目 | 值 |
|------|-----|
| **專案類型** | Desktop App（Tauri v2 跨平台桌面應用） |
| **領域** | General（生產力 / 效率工具） |
| **複雜度** | Low — 標準軟體需求，無法規限制 |
| **專案脈絡** | Brownfield — 基於已完成 POC 擴展功能 |

## Success Criteria

### User Success

| 指標 | 目標 | 衡量方式 |
|------|------|---------|
| **輸出可用率** | > 90% 轉錄結果不需手動修改 | 貼上後監控使用者鍵盤輸入行為（刪除、修改），若無修改視為可用 |
| **端到端延遲** | < 3 秒（放開按鍵到文字出現，含 AI 整理） | 歷史記錄中 `transcriptionDurationMs + enhancementDurationMs` |
| **首次使用時間** | 安裝到第一次成功語音輸入 < 2 分鐘 | Onboarding 流程觀察 |
| **日均使用次數** | >= 10 次/人 | Dashboard 歷史記錄統計 |

### Business Success

| 指標 | 目標 | 時間框架 |
|------|------|---------|
| **團隊採用率** | > 80% 日活 | 部署後 2 週 |
| **持續使用** | 部署後使用者未主動停用 | 持續追蹤 |
| **累計效率增益** | Dashboard 可見節省時間統計 | 持續累計 |

核心商業目標：內部效率工具，不涉及營收。成功 = 團隊成員自然地用語音取代大部分文字輸入場景。

### Technical Success

| 指標 | 目標 |
|------|------|
| **跨平台運作** | macOS 和 Windows 雙平台功能一致且穩定 |
| **系統可用率** | > 99%（排除網路問題） |
| **AI 整理使用率** | `count(wasEnhanced=true) / count(total)` 可追蹤 |
| **品質回饋機制** | 貼上後鍵盤監控能正確偵測使用者修改行為 |

### Measurable Outcomes

- 使用者每日文字輸入效率體感提升，「想到但懶得打」的情況減少
- AI 整理輸出品質隨 prompt 調校持續改善，可用率趨勢向上
- 非技術角色能零學習成本上手，無需 IT 支援

## Product Scope & Development Roadmap

### MVP — 已完成

POC 已實作的核心流程：Fn 鍵監聽 → 麥克風錄音 → Groq Whisper API 轉錄 → 剪貼簿貼上 → Notch-style HUD 狀態顯示。已驗證技術可行性與基礎體驗。

### V2 Phase 1 — 完整功能版（本次開發範圍）

**策略：** 體驗完整化 — 在已驗證的技術基礎上，補齊讓產品「可日常使用」和「可推廣給他人」所需的全部能力。

| # | 功能 | 說明 |
|---|------|------|
| 1 | 跨平台熱鍵系統 | `rdev` crate 統一監聽，macOS 預設 Fn、Windows 預設右 Alt，可自選修飾鍵，Hold + Toggle 雙模式 |
| 2 | AI 文字整理 | Groq LLM + 可編輯 prompt，一次完成去口語、重組句構、標點修正。字數 < 10 字跳過 AI |
| 3 | 自訂詞彙字典 | CRUD 管理，注入 Whisper API prompt + AI 上下文 |
| 4 | 歷史記錄 | SQLite 持久化，供 Dashboard 統計與回顧 |
| 5 | App UI — Dashboard | 統計卡片 + 最近轉錄列表 |
| 6 | App UI — 歷史 / 字典 / 設定 | 歷史搜尋複製、詞彙 CRUD、快捷鍵 / API Key / Prompt 設定 |
| 7 | HUD 狀態擴展 | 新增 `enhancing` 狀態，完整狀態機 |

#### 依賴分析與建議開發順序

```
Layer 0 — 基礎架構（無依賴，其他功能的前提）
├── [1] 跨平台熱鍵系統（rdev 取代 CGEventTap）
└── [4] 歷史記錄（SQLite schema + tauri-plugin-sql 初始化）

Layer 1 — 核心功能（依賴 Layer 0）
├── [2] AI 文字整理（依賴 [1] 熱鍵觸發流程重構）
├── [3] 自訂詞彙字典（依賴 [4] SQLite 資料庫）
└── [7] HUD 狀態擴展（依賴 [2] 新增 enhancing 狀態）

Layer 2 — UI 層（依賴 Layer 0 + 1）
├── [5] Dashboard（依賴 [4] 歷史記錄有資料）
└── [6] 歷史/字典/設定頁面（依賴 [3][4] 資料層）
```

| 順序 | 功能 | 原因 |
|------|------|------|
| 1st | 跨平台熱鍵系統 | 基礎設施，rdev 替換影響整個觸發流程 |
| 2nd | 歷史記錄（SQLite） | 資料層基礎，Dashboard 和統計都依賴它 |
| 3rd | AI 文字整理 | 核心體驗升級，產品最大差異化來源 |
| 4th | HUD 狀態擴展 | 跟隨 AI 整理，新增 enhancing 狀態 |
| 5th | 自訂詞彙字典 | 依賴 SQLite，提升辨識品質 |
| 6th | App UI（設定/歷史/字典） | 資料層就緒後建構 UI |
| 7th | Dashboard | 最後做，需要足夠歷史資料才有意義 |

### Phase 2 — 體驗優化

| 功能 | 說明 |
|------|------|
| VAD 靜音偵測 | Web Audio API，搭配 Toggle 模式自動停止 |
| 串流轉錄 | WebSocket 即時字幕 |
| Mini HUD | 適配無瀏海外接螢幕 |
| 剪貼簿還原 | 貼上後延遲還原原始剪貼簿 |

### Vision — 長期方向

| 功能 | 說明 |
|------|------|
| Per-App 設定 | 依前景 App 自動切換 prompt |
| 多語言支援 | 英文、日文等 |
| IT 集中管理 | API Key 統一配置、使用量監控 |

## User Journeys

### Journey 1：Jackle — 全端工程師的日常（Success Path）

**Opening Scene：** 週三下午，Jackle 剛完成一個功能的 code review，需要在 GitHub PR 上留下一段詳細的 review comment。腦中有很多想法要表達，但一想到要把這些組織成書面文字就覺得煩。

**Rising Action：** 他把游標放在 GitHub comment 輸入框，按住 Fn 鍵開始說話：「這邊的 error handling 我覺得可以改一下，目前是直接 throw，但其實 caller 那邊沒有 catch，所以會變成 unhandled rejection，建議改成 return Result type 讓 caller 決定怎麼處理。」放開 Fn，HUD 顯示「轉錄中...」→「整理中...」→「已貼上 ✓」。

**Climax：** 文字出現在 comment 框中：已去除「我覺得」「其實」等口語贅詞，標點修正，句構重組為清晰的書面語。Jackle 掃一眼，不需修改，直接送出。

**Resolution：** 整個過程不到 5 秒。Jackle 繼續下一個 PR，這已經是今天第 15 次使用語音輸入。他甚至不再意識到自己在「用工具」— 按 Fn 說話已經跟按鍵打字一樣自然。

**揭示的需求：** 全域貼上（任何 App）、AI 整理品質、低延遲、Hold 模式觸發

---

### Journey 2：Mia — 產品經理的會議筆記（Success Path）

**Opening Scene：** 週一早上 standup 剛結束，Mia 需要在 Slack 上同步幾個決定給沒參加的同事。會議中討論了三個議題，她記得大致內容但懶得一個一個打。

**Rising Action：** 她打開 Slack 對話框，按住 Fn：「剛才 standup 有三個決定，第一是 API 的 deadline 延到下週五，因為後端還在等第三方的文件。第二是 UX 的 prototype 已經確認，可以開始切版。第三是下週三要做一次 demo 給老闆看，需要準備投影片。」

**Climax：** AI 整理後的輸出自動分成三個清晰的要點，去除了「剛才」「因為」等口語連接詞，每點精簡到一句話。Mia 看了覺得比自己打的還好。

**Resolution：** 原本需要 5 分鐘打字整理的訊息，20 秒就完成了。Mia 開始養成「會議結束立刻語音同步」的習慣，團隊資訊同步效率明顯提升。

**揭示的需求：** AI 整理的分段能力、長文處理品質、使用統計（Dashboard 看到累計節省時間的成就感）

---

### Journey 3：David — 業務的第一次使用（Onboarding Journey）

**Opening Scene：** David 收到同事分享的安裝包，對「對電腦說話」這件事半信半疑。他用的是 Windows 筆電。

**Rising Action：** 安裝完成後，App 開啟設定頁面，只有一個輸入框要他填 Groq API Key。同事已經把 Key 傳給他了，貼上，完成。App 提示他試試按住右 Alt 說話。他有點彆扭地按住右 Alt，小聲說了一句：「嗯，測試一下，這個東西真的能用嗎？」

**Climax：** HUD 顯示狀態轉換，兩秒後文字出現在游標位置：「測試一下，這個東西真的能用嗎？」— 「嗯」被去掉了，標點正確。David 愣了一下，然後笑了。

**Resolution：** 他開始在 Email 回覆中使用，發現回覆客戶的速度變快了。一週後他已經不再覺得對電腦說話奇怪，反而覺得打字太慢。

**揭示的需求：** Windows 平台支援（右 Alt 預設）、極簡 Onboarding（只需 API Key）、短文也能處理、首次體驗的「Aha moment」

---

### Journey 4：Jackle — 錯誤恢復場景（Edge Case）

**Opening Scene：** Jackle 正在寫一份技術文件，按住 Fn 說了一長段話。放開後 HUD 顯示「轉錄中...」但卡了超過 5 秒。

**Rising Action：** HUD 顯示錯誤：「API 請求失敗 — 網路連線中斷」。Jackle 檢查網路，發現 Wi-Fi 斷了。他重新連上網路，再次按住 Fn 重新說一次。

**Climax：** 這次正常完成，文字貼入。但他想到剛才那段話其實說得更好，可惜沒有留下來。

**Resolution：** 他打開 Dashboard 的歷史記錄，發現失敗的那次沒有記錄（因為 API 沒回應）。他心想：如果錄音檔能暫存就好了，至少可以重新送出。但目前這不在功能範圍內，他接受了這個限制。

**揭示的需求：** 錯誤狀態 HUD 顯示、錯誤訊息清晰、網路斷線優雅處理、歷史記錄僅記錄成功項（目前設計）、未來可考慮錄音暫存重送

---

### Journey 5：Mia — AI 整理品質不佳時（Edge Case）

**Opening Scene：** Mia 在描述一個涉及專有名詞的需求，按住 Fn 說：「我們的 CRM 系統 Fortuna 需要跟 NoWayLM 的 API 做整合，用 OAuth 2.0 做認證。」

**Rising Action：** AI 整理後輸出把「Fortuna」辨識成「福圖納」，把「OAuth」變成「歐奧斯」。Mia 需要手動修改這幾個詞。

**Climax：** 她打開字典頁面，把「Fortuna」「NoWayLM」「OAuth」加入自訂詞彙。下次再說同樣的內容，這些專有名詞都正確辨識了。

**Resolution：** 隨著詞彙字典的累積，Mia 的辨識準確率越來越高，修改頻率持續下降。

**揭示的需求：** 自訂詞彙字典的 CRUD、詞彙注入 Whisper prompt、詞彙注入 AI 上下文、品質隨使用時間改善的正向循環

---

### Journey Requirements Summary

| Journey | 揭示的核心能力需求 |
|---------|-------------------|
| Jackle Success | 全域貼上、AI 整理、低延遲、Hold 模式 |
| Mia Success | AI 分段能力、長文處理、Dashboard 統計 |
| David Onboarding | Windows 支援、極簡設定、首次體驗品質 |
| Jackle Error | 錯誤 HUD、網路斷線處理、歷史記錄 |
| Mia Quality | 自訂詞彙 CRUD、Whisper/AI prompt 注入 |

**能力交叉覆蓋：**
- **跨平台熱鍵**：Journey 1, 3, 4
- **AI 文字整理**：Journey 1, 2, 5
- **自訂詞彙字典**：Journey 5
- **歷史記錄 + Dashboard**：Journey 2, 4
- **HUD 狀態機**：Journey 1, 2, 3, 4
- **設定頁面**：Journey 3

## Desktop App Specific Requirements

### Project-Type Overview

SayIt 是一款常駐 System Tray 的跨平台桌面應用，使用 Tauri v2 框架。應用程式需要深度整合作業系統層功能（全域熱鍵、剪貼簿、鍵盤模擬），同時維持輕量的資源佔用。雙視窗架構：HUD Overlay（狀態顯示）+ Main Window（Dashboard / 設定）。

### Technical Architecture Considerations

**跨平台策略：**

| 項目 | macOS | Windows |
|------|-------|---------|
| 框架 | Tauri v2 | Tauri v2 |
| 前端 | Vue 3 + TypeScript + Tailwind | 同左 |
| 全域熱鍵 | `rdev` crate（預設 Fn） | `rdev` crate（預設右 Alt） |
| 剪貼簿 | `arboard` crate | `arboard` crate |
| 自動貼上 | AX API menu press（Cmd+V） | SendInput（Ctrl+V） |
| 資料庫 | `tauri-plugin-sql`（SQLite） | 同左 |
| 狀態管理 | Pinia | 同左 |

**雙視窗架構：**

| 視窗 | 用途 | 特性 |
|------|------|------|
| HUD Overlay | Notch-style 狀態顯示 | 始終置頂、不可互動、透明背景 |
| Main Window | Dashboard / 歷史 / 字典 / 設定 | 標準視窗，從 System Tray 開啟 |

### Platform Support

| 平台 | 支援等級 | 備註 |
|------|---------|------|
| macOS（Apple Silicon + Intel） | 完整支援 | 需 Accessibility 權限 |
| Windows 10/11 | 完整支援 | 無特殊權限需求 |
| Linux | 不支援 | 不在範圍內 |

### System Integration

| 整合項目 | 技術方案 | 備註 |
|----------|---------|------|
| 全域熱鍵監聽 | `rdev` crate | 跨平台統一，支援多種修飾鍵 |
| 剪貼簿操作 | `arboard` crate | 備份→寫入→模擬貼上 |
| 自動貼上 | AX API menu press / SendInput | macOS: AXPress Paste menu / Windows: Ctrl+V |
| System Tray | Tauri 內建 | 常駐、右鍵選單、開啟 Main Window |
| Accessibility 權限 | macOS CGEventTap | 首次啟動引導授權 |
| 麥克風權限 | WebView `getUserMedia` | 首次錄音時系統提示 |
| 開機自啟動 | `tauri-plugin-autostart` | 預設啟用，設定可關閉 |
| 貼上後鍵盤監控 | `rdev` crate | 偵測使用者是否修改貼上內容，用於品質衡量 |

### Update Strategy

| 項目 | 方案 |
|------|------|
| 更新機制 | `tauri-plugin-updater`（自動更新） |
| 更新頻率 | 手動觸發檢查 + 啟動時自動檢查 |
| 更新來源 | GitHub Releases 或自建更新伺服器 |
| 使用者體驗 | 背景下載，提示重啟安裝 |

### Offline Capabilities

本產品依賴 Groq Cloud API（Whisper + LLM），**無離線能力**。網路斷線時：
- 錄音可正常進行
- 轉錄/AI 整理會失敗，HUD 顯示錯誤訊息
- 不提供離線 fallback（如本地模型），這是刻意的產品決策以維持極簡架構

### Implementation Considerations

- **資源佔用**：常駐應用應維持低記憶體佔用（< 100MB），CPU 僅在錄音/API 呼叫時有負載
- **安裝包格式**：macOS `.dmg` / Windows `.msi` 或 `.exe`
- **程式碼簽署**：macOS 需 Apple Developer 簽署避免 Gatekeeper 攔截；Windows 需考慮 SmartScreen 信任
- **資料儲存位置**：SQLite 資料庫存放於各平台標準 App Data 目錄

## Risk Mitigation Strategy

**Technical Risks：**

| 風險 | 嚴重度 | 緩解策略 |
|------|--------|---------|
| `rdev` crate 跨平台一致性 | 高 | 最先開發，及早驗證 macOS/Windows 行為差異。若 rdev 不穩定，macOS 可退回 CGEventTap，Windows 用 rdev |
| 貼上後鍵盤監控的準確度 | 中 | 需定義「修改」的判定邏輯（多久內、哪些按鍵算修改）。先做簡單版（貼上後 5 秒內有 Backspace/Delete 視為修改），再迭代 |
| Groq API 穩定性與延遲波動 | 中 | 加入 timeout 機制（5 秒），超時直接貼上原始轉錄文字跳過 AI 整理 |
| 雙視窗架構（HUD + Main Window）的 Tauri 行為 | 低 | POC 已驗證 HUD 視窗，Main Window 是標準 Tauri 視窗，風險低 |

**Market Risks：**

| 風險 | 緩解策略 |
|------|---------|
| 同事不願對電腦說話 | 首次體驗設計要讓 Aha moment 來得快（David Journey），用輸出品質說服而非功能說服 |
| AI 整理品質不符預期 | Prompt 可編輯 + 詞彙字典雙重調校機制，使用者有控制權 |

**Resource Risks：** 無。時間充足，單人全端開發，無外部依賴。

## Functional Requirements

### 語音觸發與錄音

- FR1: 使用者可透過全域快捷鍵觸發錄音，不需切換至 App 視窗
- FR2: 使用者可自選觸發用的修飾鍵（macOS: Fn/Option/Ctrl/Cmd/Shift；Windows: 右Alt/左Alt/Ctrl/Shift）
- FR3: 使用者可選擇 Hold 模式（按住錄音，放開停止）或 Toggle 模式（按一下開始，再按一下停止）
- FR4: 系統在使用者觸發錄音時透過麥克風擷取音訊
- FR5: 系統在錄音結束後將音訊封裝為 API 可接受的格式

### 語音轉文字

- FR6: 系統可將錄音音訊送至 Groq Whisper API 取得轉錄結果；轉錄失敗時可從暫存錄音重送一次
- FR7: 系統可將自訂詞彙清單注入 Whisper API prompt 參數以提升專有名詞辨識率

### AI 文字整理

- FR8: 系統可將轉錄結果送至 Groq LLM 進行口語→書面語整理（去贅詞、重組句構、修正標點、適當分段）
- FR9: 系統在轉錄字數低於門檻（約 10 字）時跳過 AI 整理，直接輸出原始轉錄
- FR10: 使用者可編輯 AI 整理使用的 prompt
- FR11: 使用者可將 prompt 重置為預設值
- FR12: 系統可將剪貼簿內容與自訂詞彙清單作為上下文注入 AI 整理請求

### 文字輸出

- FR13: 系統可將最終文字（轉錄或 AI 整理後）自動貼入當前游標所在的任何應用程式
- FR14: 系統透過剪貼簿寫入 + 模擬鍵盤貼上實現全域文字輸出
- FR15: 系統可在貼上後監控使用者鍵盤輸入行為，判斷輸出是否被修改以衡量品質

### 自訂詞彙字典

- FR16: 使用者可新增自訂詞彙（專案名、人名、技術術語）
- FR17: 使用者可刪除已建立的自訂詞彙
- FR18: 使用者可瀏覽完整的自訂詞彙清單
- FR19: 系統可將詞彙清單同時注入 Whisper API 與 AI 整理上下文

### 歷史記錄與統計

- FR20: 系統在每次成功轉錄後自動記錄完整資料（原始文字、整理後文字、錄音時長、API 回應時長、字數、觸發模式、是否經 AI 整理）
- FR21: 使用者可瀏覽歷史轉錄記錄列表
- FR22: 使用者可搜尋歷史記錄（全文搜尋）
- FR23: 使用者可複製歷史記錄中的文字
- FR24: 使用者可在 Dashboard 查看統計指標（總口述時間、口述字數、平均口述速度、節省時間、使用次數、AI 整理使用率）
- FR25: 使用者可在 Dashboard 查看最近轉錄摘要列表

### 狀態回饋（HUD）

- FR26: 系統在各階段透過 Notch-style HUD 顯示目前狀態（idle → recording → transcribing → enhancing → success/error → idle），error 狀態提供一鍵重送按鈕
- FR27: 系統在 success 狀態短暫顯示後自動收起 HUD
- FR28: 系統在 API 請求失敗時透過 HUD 顯示清晰的錯誤訊息，並提供重送按鈕（限一次）供使用者重新送出同一段錄音
- FR29: 系統在 Groq API 逾時時直接貼上原始轉錄文字跳過 AI 整理

### 應用程式管理

- FR30: 使用者可在設定頁面配置快捷鍵（預設觸發鍵選擇、自訂組合鍵（0~N 個 modifier + 1 個普通鍵）、觸發模式）
- FR31: 使用者可在設定頁面輸入/修改 Groq API Key
- FR32: 系統常駐 System Tray，使用者可從 Tray 開啟主視窗
- FR33: 系統支援開機自啟動，使用者可在設定中關閉
- FR34: 系統支援自動更新，啟動時檢查並背景下載更新
- FR35: 系統在 macOS 首次啟動時引導使用者授權 Accessibility 權限
- FR36: 系統在首次錄音時觸發麥克風權限請求

### 錄音檔管理

- FR37: 系統在每次錄音結束後將 WAV 檔案永久儲存至本地磁碟（{APP_DATA}/recordings/），使用者可在歷史記錄中播放錄音
- FR38: 系統自動偵測 Whisper 幻覺文字（三層偵測：語速異常、noSpeechProbability 門檻、幻覺詞庫比對），判定為幻覺時不貼上並自動學習至幻覺詞庫
- FR39: 使用者可在獨立的幻覺詞庫頁面管理幻覺詞（瀏覽、新增、刪除），側邊欄提供導航入口；設定頁面提供錄音檔自動清理策略（手動刪除全部 + 自動清理天數）

## Non-Functional Requirements

### Performance

| 指標 | 目標值 | 備註 |
|------|--------|------|
| 端到端延遲（含 AI 整理） | < 3 秒 | 從放開按鍵到文字出現在游標位置 |
| 端到端延遲（跳過 AI） | < 1.5 秒 | 短文直接貼上場景 |
| Groq API timeout | 5 秒 | 超時 fallback 至原始轉錄文字 |
| 常駐記憶體佔用 | < 100 MB | idle 狀態下 |
| HUD 狀態轉換 | < 100 ms | 動畫流暢，無視覺延遲 |
| App 啟動時間 | < 3 秒 | 從開機自啟動到 System Tray 就緒 |
| SQLite 查詢回應 | < 200 ms | 歷史搜尋、Dashboard 統計計算 |

### Security

| 需求 | 說明 |
|------|------|
| API Key 儲存 | 使用作業系統原生安全儲存（macOS Keychain / Windows Credential Manager）或加密存放，不得明文儲存 |
| 轉錄資料 | 歷史記錄僅存於本地 SQLite，不上傳至任何第三方服務 |
| API 通訊 | 所有 Groq API 請求透過 HTTPS |
| 敏感資料傳輸 | 剪貼簿內容作為 AI 上下文注入時，僅傳送至使用者自行配置的 Groq API |

### Integration

| 整合對象 | 可靠性需求 | 降級策略 |
|----------|----------|---------|
| Groq Whisper API | 依賴網路，無離線替代 | 失敗時 HUD 顯示錯誤並提供一鍵重送按鈕（從暫存錄音重送，限一次） |
| Groq LLM API | 依賴網路，有 timeout 降級 | 5 秒逾時則跳過 AI 整理，直接貼上原始轉錄 |
| 作業系統剪貼簿 | 系統層級，高可靠 | 無降級，失敗視為系統錯誤 |
| 作業系統鍵盤模擬 | 系統層級，需權限 | macOS 需 Accessibility 授權，未授權時引導 |

### Reliability

| 指標 | 目標值 | 備註 |
|------|--------|------|
| 系統可用率 | > 99%（排除網路問題） | App 本身不 crash、不凍結 |
| 資料持久性 | 歷史記錄零遺失 | SQLite WAL 模式確保寫入安全 |
| 錯誤恢復 | API 失敗不影響 App 穩定性 | 回到 idle 狀態，可立即重試 |
| 自動更新 | 更新失敗不影響現有功能 | 背景下載，使用者確認後安裝 |
