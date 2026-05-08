# Changelog

SayIt 版本更新紀錄。

## [0.10.0] - 2026-05-08

### Added

- 設定中的「測試連線」按鈕：可即時驗證當前 LLM Provider / Whisper 模型的 API key 與連線是否正常，失敗時顯示具體原因（API key 無效 / 額度不足 / 服務端問題 / 網路問題），讓使用者能自助 debug 設定問題（#34）
- 設定可選擇「自動貼上後還原原本剪貼簿內容」：之前 SayIt 把轉錄文字寫進剪貼簿後就留在那裡，使用者原本複製的東西被覆蓋。新增「將轉錄文字複製到剪貼簿」toggle（設定 → 一般），預設 ON 保留現行行為（避免回歸），關閉時 SayIt 會在貼上後 200ms 還原使用者原本的剪貼簿（純文字場景；圖片/檔案因 arboard 無法無損 snapshot 而保持不動）（#35）

### Fixed

- Gemini 2.5 系列做 AI 整理時長轉錄文字被截斷的問題（#23、#34）：根因是 Gemini 把 thinking tokens 計入 `maxOutputTokens` 配額，原本對所有 provider 統一給 2048 token 預算被 thinking 吃掉一部分後不夠用。改為 per-provider 預設：Gemini / OpenAI 16384、Anthropic / Groq 8192（後者模型上限 8192，給 16384 會被 API reject）
- 使用 OpenAI 或 Anthropic 整理時被 Content Security Policy 阻擋的問題：`connect-src` 加入 `api.openai.com` 與 `api.anthropic.com`
- 轉錄失敗 catch path 沒寫入 `rmsEnergyLevel` 的問題：補上 assignment，避免幻覺偵測 fallback 邏輯收到 undefined

### Improved

- LlmProviderId switch 加上 exhaustiveness assertion：未來新增 provider 時編譯期會抓到漏處理的 case
- 錯誤傳遞鏈保留 `cause`：debug 時能看到完整堆疊
- CI 升級：push/PR 觸發 ESLint + cargo clippy + cargo test，避免 lint/test 倒退被 merge

## [0.9.5] - 2026-05-01

### Fixed

- 同時啟動多個 SayIt 實例造成熱鍵觸發後重複錄音、重複貼上的問題（Windows 受影響，macOS 因 Launch Services 預設單例較少觸發）：導入 `tauri-plugin-single-instance`，第二個實例啟動時立即退出，並把現有實例的 Dashboard 視窗叫到前景

## [0.9.4] - 2026-04-07

### Fixed

- 自訂字典在某些 Windows 環境下新增詞彙時報「table vocabulary has no column named source」的問題（#27）：在 DB 初始化的關鍵表驗證階段新增冪等的 vocabulary column 自我修復邏輯，無論 schema_version 為何都會檢查並補上缺失的 weight/source 欄位

## [0.9.3] - 2026-03-28

### Fixed

- 簡易模式 Fn 快捷鍵在 Globe 鍵 MacBook 上一觸發就馬上送出的問題：FlagsChanged handler 從 toggle-based 改為 flag-based 偵測，只回應 keycode 63 事件

## [0.9.2] - 2026-03-28

### Added

- Google Gemini LLM Provider：支援 Gemini 2.5 Flash 和 Flash-Lite（有免費額度），新增 API Key 管理、request/response 格式轉換
- Gemini SAFETY block 偵測：`finishReason` 非 STOP 時拋出有意義的錯誤，不再靜默 fallback
- Gemini 單元測試：buildFetchParams + parseProviderResponse + helpers（6 個測試）
- Tauri HTTP scope + CSP 加入 `generativelanguage.googleapis.com`
- 升級通知合併 LLM provider 項目，新增 Gemini 說明
- OpenAI 標示「推薦」（5 語系）

### Changed

- Provider 排序：Groq → Gemini → OpenAI → Anthropic（免費的在前面）
- Provider RadioGroup 從 3 欄改 2 欄（4 個 provider 排 2×2）
- 5 語系 provider description 加入 Gemini 有免費額度

## [0.9.1] - 2026-03-28

### Fixed

- HUD notch 寬度加寬（350→420px），避免錄音中模式標籤被 MacBook camera 區域遮擋
- mode-switch notch 寬度加寬（200→350px），確保切換模式標籤完整顯示
- mode-switch 消失時新增 collapsing 縮小動畫（原為直接淡出）
- Tauri HUD 視窗與 Rust 定位常數同步更新（400→470px）

## [0.9.0] - 2026-03-28

### Added

- 編輯選取文字功能：選取文字後觸發 SayIt，語音變成 AI 指令（翻譯、改寫、摘要等），處理結果直接取代原文
- Rust `read_selected_text` command：macOS AXSelectedText 讀取選取文字，共用 `FocusedElementContext` AX 走訪結構
- 功能介紹頁面：側邊欄新增「功能介紹」（Lightbulb icon），展示 8 個操作功能卡片
- Edit mode prompt 模板：五語系編輯模式專用 prompt（`EDIT_MODE_PROMPTS`）
- `EnhanceOptions.maxTokens`：edit mode 使用 4096（既有增強為 2048）
- DB migration v7→v8：`is_edit_mode`、`edit_source_text` 欄位
- HUD 琥珀色「編輯」badge + `HudStatus: "editing"` 狀態
- 升級通知新增 item9（編輯選取文字）並依亮點重新排序

### Improved

- Rust `text_field_reader.rs` 重構：提取 `FocusedElementContext` struct 消除 ~50 行重複 AX 走訪邏輯
- `isEditMode` 改為 computed（從 `editSourceText` 推導），消除冗餘 state
- `read_selected_text` 非阻塞偵測（`.then()`），不延遲開始音效
- HUD badge CSS 提取 `.hud-badge` 共用 base class
- `useHistoryStore` SQL SELECT 欄位提取 `TRANSCRIPTION_SELECT_COLUMNS` 常數
- 功能介紹文案改為生活化口吻（五語系）

## [0.8.9] - 2026-03-19

### Fixed

- 修正 macOS 上選擇特定麥克風後停止錄音，麥克風指示燈（橘色圓點）不消失的安全問題：cpal 0.15.3 CoreAudio backend 對非預設裝置建立 disconnect listener 造成 Arc 循環引用，AudioUnit 永不釋放。修正方式為優先使用 default_input_device() 避免循環引用，並在停止時顯式呼叫 stream.pause() 作為兜底防禦

## [0.8.8] - 2026-03-18

### Added

- 麥克風選擇功能：設定中可指定錄音使用的輸入裝置（Rust `list_audio_input_devices` + `start_recording` 接受 `device_name`）
- Enhancement anomaly 偵測：LLM 輸出異常時自動重試（最多 3 次），仍異常則 fallback 到原始文字

### Improved

- Layer 2b peak energy escape hatch：peak >= 0.03 時跳過 RMS+NSP 檢查，減少小聲說話「未偵測到語音」誤報
- Enhancer temperature 從 0.3 降至 0.1，輸出更穩定
- Active prompt 規則：合併重複表達時保留語氣（問句仍是問句），新增禁止將問句改寫為肯定句

### Fixed

- `getMicrophoneErrorMessage` 支援 Rust AudioRecorderError 字串匹配（No input device / Failed to build audio stream / Failed to get input config）

## [0.8.7](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.7) - 2026-03-17

### Changed

- AI 整理預設模型切換為 Kimi K2（既有使用者首次更新自動遷移，可在設定中改回）
- 重寫積極模式 prompt（五語言）：修正 AI 整理會回答逐字稿中的問題而非整理文字

### Improved

- 簡化幻覺偵測系統：移除幻覺字典和自動學習機制，改為純物理信號二層偵測（語速異常 + 無人聲），不再誤判正常語句
- 移除 RMS 單獨判斷，所有 RMS 偵測需搭配 Whisper NSP 聯合確認，避免小聲說話被誤判

### Removed

- 移除幻覺字典功能（DB table、Store、管理頁面、Sidebar 導航、自動學習、HUD 通知）

## [0.8.6](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.6) - 2026-03-16

### Fixed

- 修正歷史紀錄播放錄音在正式版（production build）無聲的問題：macOS 上 convertFileSrc 產生的 asset:// URL 被 CSP 阻擋，改用 Rust IPC 讀取位元組 + Blob URL 播放，dev/production 行為一致
- 修正快速連點不同紀錄時播放與 UI 狀態不同步的 race condition
- 播放失敗時新增 Sentry 錯誤回報（原本靜默吞錯）
- 修正 read_recording_file command 的安全性：改為接受 id 參數，Rust 端組合路徑，避免任意檔案讀取風險

## [0.8.5](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.5) - 2026-03-16

### Fixed

- 徹底修正版本升級後資料庫初始化失敗（database is locked / no such table）：HUD 視窗不再呼叫 Database.load()，改用 connectToDatabase() 等待 Dashboard 建好連線池後複用，從架構層面消除連線池覆蓋的競態條件
- 自動恢復先前版本損壞導致遺失的 api_usage 表
- 升級提示彈窗新增資料庫修復說明

## [0.8.4](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.4) - 2026-03-16

### Fixed

- 修正版本升級後「no such table: api_usage」錯誤：HUD 視窗的 Database.load() 覆蓋 Dashboard 的連線池，導致 migration 中的 DROP TABLE 失去 transaction 保護
- 防止連線池覆蓋：第二個視窗改用 Database.get() 複用既有連線池
- 自動恢復遺失的 api_usage 表：migration 結束後驗證關鍵表是否存在，不存在則重建

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
