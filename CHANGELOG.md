# Changelog

SayIt 版本更新紀錄。

## [0.8.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.3) - 2026-03-16

### Fixed

- 修正版本升級後首次啟動出現「database is locked (code: 5)」錯誤：HUD 與 Dashboard 雙視窗同時初始化資料庫導致競態條件，加入 Promise lock 序列化初始化 + PRAGMA busy_timeout 防護

## [0.8.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.2) - 2026-03-16

### Fixed

- 修正舊版升級（v0.6.0 以前、v0.7.x）資料庫初始化失敗：ALTER TABLE ADD COLUMN 在 transaction 內對後續語句不可見，導致 "no such column: weight" 或 "no such column: status" 錯誤
- 修正儀表板「平均每次字數」偏高：改用原始辨識字數計算，不再受 AI 整理後文字膨脹影響
- 修正儀表板「節省時間」高估：公式改為（打字時間 − 口述時間），而非僅計算打字時間

## [0.8.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.1) - 2026-03-16

### Fixed

- 修正資料庫升級（v2→v3、v3→v4）可能因重複欄位名而失敗，導致歷史記錄無法顯示的問題
- 修正語音辨識幻覺偵測誤判：Whisper noSpeechProbability 聚合策略從 MAX 改為 MIN，避免有說話卻被判定為「未偵測到語音」
- 修正升級後更新摘要未顯示：改為版本號比對機制，所有升級的使用者都能看到更新內容
- 修正自動更新通知彈在隱藏視窗：下載完成後自動顯示 Dashboard 視窗
- 修正自動更新只在啟動時檢查一次：恢復定時檢查機制（每 15 分鐘）

## [0.8.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.0) - 2026-03-16

### AI 整理模式切換

新增三種 AI 整理模式，可在設定頁快速切換：

- **精簡模式**：修錯字、去贅詞、補標點，保持原句結構
- **積極模式**（類似 Typeless）：理解語意後重新排版，以段落和列點呈現
- **自訂模式**：使用自訂 Prompt

舊版使用者升級後，自訂 Prompt 會自動保留；使用預設值的使用者將自動遷移至精簡模式。

### Added

- 錄音檔自動儲存，歷史記錄可播放與重新轉錄
- Whisper 幻覺偵測與自動學習，減少無聲時的錯誤文字
- 按 ESC 可隨時取消錄音、轉錄或 AI 整理
- 音效回饋：錄音開始、結束及錯誤時播放提示音（可在設定中開關）
- 歷史記錄展開後原始文字旁新增複製按鈕
- 升級提示 Dialog：舊版使用者首次開啟時顯示更新摘要

### Changed

- HUD 狀態顯示優化與輔助使用權限引導改善
- 幻覺偵測升級為 RMS 能量 + 4 層偵測機制，移除內建詞庫

## [0.7.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.3) - 2026-03-13

### Fixed

- 修復英文語句含重複冠詞（the、and 等）被誤判為「未偵測到語音」的問題
- 移除 Whisper 幻聽攔截機制，非空轉錄結果一律貼上，讓使用者自行判斷模型輸出品質

## [0.7.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.2) - 2026-03-11

### Added

- 字典分析模型獨立設定：文字整理與字典分析可分別選用最適合的 AI 模型
- 新增 Kimi K2 Instruct 模型選項（文字整理 + 字典分析皆可選）
- 模型下拉選單新增特色標籤（平衡 · 預設 / 穩定可靠 · 成本高 / 最快 · 最便宜 / 最聰明 · 較慢）

### Fixed

- 修復模型下拉選單選中後 Badge 文字與模型名稱黏在一起的問題

## [0.7.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.1) - 2026-03-10

### Fixed

- 移除已下架的 Llama 4 Maverick 17B 模型選項（Groq 已停用），已選用的使用者自動遷移至 Qwen3 32B

## [0.7.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.0) - 2026-03-10

### 智慧字典學習

SayIt 現在會自動從你的修正中學習。每次語音輸入貼上後，如果你修改了文字，系統會偵測修正內容並透過 AI 分析，將專有名詞和術語自動加入字典。字典越豐富，語音辨識就越準確——你用得越多，它就越懂你。

- 貼上後自動偵測修正，AI 篩選出值得學習的詞彙
- 字典權重系統：常用詞優先送入辨識提示，越常被修正的詞權重越高
- 字典頁面改版：AI 推薦與手動新增分區顯示，附權重標示
- HUD 即時通知新學習的詞彙
- 設定中可開關（macOS 預設開啟）

## [0.6.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.6.0) - 2026-03-09

### Added

- 轉錄語言獨立設定：UI 語言與 Whisper 語言可分開選擇，支援「自動偵測」模式
- Sentry 錯誤監控全覆蓋：29 個 captureError 呼叫點 + 全域錯誤處理器（雙視窗）

### Changed

- macOS 貼上機制改為 CGEvent Cmd+V 模擬，修復 LINE 等無標準 Edit 選單的 App 貼上失敗問題

### Fixed

- 修復自動更新後 App 無法重新啟動的問題（_exit(0) 截殺 Tauri restart 邏輯）

## [0.5.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.5.0) - 2026-03-08

### Added

- 錄音開始／結束音效回饋，讓使用者明確感知錄音狀態

## [0.4.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.4.0) - 2026-03-08

### Added

- 多語言（i18n）支援：vue-i18n 基礎建設、所有 Vue 元件與 views 國際化、Stores/Lib/Rust 轉錄層整合

### Fixed

- 強化 Whisper 靜音幻覺偵測，減少無聲片段產生錯誤轉錄

## [0.3.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.3.0) - 2026-03-08

### Added

- 跨平台自動貼上功能（macOS AX API + Windows SendInput）
- 音訊錄製與轉錄遷移至 Rust 原生管線，提升效能與穩定性
- 優雅關機與持久化鍵盤監控機制

### Fixed

- 修正 Sentry sourcemap upload 指令與 release publish 設定

## [0.2.5](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.5) - 2026-03-06

### Added

- Sentry release 自動化整合

### Fixed

- 修復語音 fallback 機制與設定同步更新問題

## [0.2.4](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.4) - 2026-03-06

### Changed

- 優化預設 prompt 防護性，切換預設模型為 Qwen3 32B

## [0.2.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.3) - 2026-03-06

### Fixed

- Dashboard 額度文字修正與短文字門檻預設停用
- 停用 Dashboard 右鍵選單並移除重複的更新檢查

## [0.2.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.2) - 2026-03-06

### Fixed

- 重構自動更新流程，修復檢查更新無回應問題

## [0.2.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.1) - 2026-03-06

### Added

- 設定頁新增「關於 SayIt」區塊與社群連結

### Fixed

- 修正 stable-name asset 上傳路徑以支援 cross-compilation
- 新增 workflow_dispatch 觸發器並分離 tag 推送

## [0.2.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.0) - 2026-03-06

### Added

- 自動更新 UI 與定時檢查機制（啟動 5 秒後首次檢查，每 4 小時定期檢查）
- CI/CD stable-name asset 上傳至 GitHub Release

### Fixed

- 授予輔助使用權限後自動偵測並啟用快捷鍵

## [0.1.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.1.0) - 2026-03-05

### Added

- 語音轉文字核心功能（Groq Whisper API）
- HUD + Dashboard 雙視窗架構
- 全域快捷鍵系統（OS 原生 API，支援自訂錄製）
- API Key 安全儲存（tauri-plugin-store）
- 轉錄歷史記錄與搜尋（SQLite）
- AI 文字強化（Groq LLM）
- API 用量追蹤與每日免費額度
- 多螢幕 HUD 追蹤定位
- 可調整文字強化門檻
- macOS Accessibility 權限導引
- CI/CD pipeline 與 Apple Code Signing
- 錄音自動靜音系統喇叭
