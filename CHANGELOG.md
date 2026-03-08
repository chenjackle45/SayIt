# Changelog

SayIt 版本更新紀錄。

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
