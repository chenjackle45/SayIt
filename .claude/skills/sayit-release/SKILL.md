---
name: sayit-release
description: SayIt 發版流程編排 — 起草 CHANGELOG、同步 5 語系升級彈窗、對齊 upgradeNoticeItemCount、最後呼叫 ./scripts/release.sh。當使用者說「準備發新版」「要 release vX.Y.Z」「準備 release v0.10.0」「要發版了」「更新 CHANGELOG」「要更新升級彈窗」「同步多語系升級提示」之類的話時必須觸發；即使對方沒講「sayit-release」這幾個字、只說「我們來發 v0.11.0」也要觸發。負責 release.sh 之前的所有準備工作，呼叫 release.sh 前一定要先取得使用者明確同意。
---

# SayIt 發版流程

這個 skill 編排 SayIt 從「準備發新版」到「呼叫 release.sh」之間的所有準備工作。release.sh 自身負責 4 點版本號 bump、commit、tag、push；這個 skill 負責把 release.sh 需要的前置條件全部準備好，並產生使用者體感得到的 release notes（CHANGELOG）和升級彈窗（5 語系 upgradeNotice）。

## 為什麼分成 skill + release.sh 兩段

release.sh 的 guard 設計（working tree 乾淨、CHANGELOG 含目標版本區塊、tag 不存在、不在 detached HEAD）讓它一定能 idempotent 地完成或乾淨地失敗。skill 不繞過這些 guard、也不重做 release.sh 已經會做的事，只負責生產 release.sh 需要的「材料」。這個分工讓兩邊各自單純：skill 出錯不會誤觸 push；release.sh 改邏輯不會牽連到內容生成。

## 整體流程

```
 使用者：「準備發 v0.11.0」
     │
     ▼
 ① 對齊版本號參數（X.Y.Z 是什麼？建議下一版）
     │
     ▼
 ② 蒐集材料（git log 上一個 tag..HEAD、git status）
     │
     ▼
 ③ 起草 CHANGELOG（分類 → 寫入頂部 → 等使用者遷訂）
     │
     ▼
 ④ 起草 upgradeNotice（詢問亮點 → zh-TW → 翻譯 4 語 → 同步 itemCount）
     │
     ▼
 ⑤ Sanity check（5 語系 key 對齊、itemCount 對得上、CHANGELOG 含目標版本區塊）
     │
     ▼
 ⑥ 詢問使用者「要跑 release.sh 嗎？」
     │
     │ 使用者明確同意（「跑」「部署」「go」「發吧」之類）
     ▼
 ⑦ 跑 ./scripts/release.sh X.Y.Z（只在使用者明確同意時跑）
```

## 步驟 ① 對齊版本號

在做任何事情之前先確定目標版本號 X.Y.Z。

讀取當前版本：
```bash
jq -r .version /Users/jackle/workspace/say-it/src-tauri/tauri.conf.json
```

如果使用者已經在指令裡明說（「發 v0.11.0」），直接用。如果沒明說，用 semver 規則推薦：
- 只有 bug fix → patch（0.10.0 → 0.10.1）
- 有新功能但不破壞相容性 → minor（0.10.0 → 0.11.0）
- 破壞相容性 → major（0.10.0 → 1.0.0）

把推薦版本號告訴使用者，等他確認或修改。**版本號未確認前不要往下走**。

## 步驟 ② 蒐集材料

兩件事並行做：

```bash
# 上一個 tag 到目前的 commit
git -C /Users/jackle/workspace/say-it log "$(git -C /Users/jackle/workspace/say-it describe --tags --abbrev=0)..HEAD" --no-merges --pretty='%h %s'

# 確認 working tree 狀態
git -C /Users/jackle/workspace/say-it status --short
```

如果 working tree 不乾淨，先告知使用者「目前有 N 個未 commit 變更，release.sh 會擋下來，要先處理」。讓他決定是先 commit 那些變更、還是先繼續 skill 流程（變更可能會被一起包進這次 release）。

## 步驟 ③ 起草 CHANGELOG

CHANGELOG.md 在專案根目錄，格式固定。

### 標題格式

```markdown
## [X.Y.Z] - YYYY-MM-DD
```

日期用今天的日期（執行時取 `date +%Y-%m-%d`，不要寫死）。

### 子分類

只用三個分類：

| 分類 | 何時放這裡 |
|------|-----------|
| `### Added` | 新功能、新介面、新檔案、新支援 |
| `### Fixed` | bug fix、錯誤行為修正 |
| `### Improved` | 效能優化、重構、開發體驗（DX）改進、CI/CD 升級 |

不用 `### Changed` / `### Deprecated` / `### Removed` 這些 keep-a-changelog 的其他分類，SayIt 的 CHANGELOG 慣例只用上面三個。

### 從 commit 推斷分類

| commit prefix | 分類 |
|---------------|------|
| `feat:` `feat(*):` | Added |
| `fix:` `fix(*):` | Fixed |
| `refactor:` `perf:` `chore(ci):` `chore(deps):` | Improved |
| `docs:` `chore:` `test:` | 不寫進 CHANGELOG（內部變更，使用者無感） |

例外：如果 `chore` 的內容其實使用者有感（例如「同步多語系」「修預設值」），仍要寫進 CHANGELOG，分類取決於影響面。

### 條目寫法

每條 bullet 的結構：

```
- [簡述使用者感受到的事]：[為什麼出現問題或為什麼這樣設計]，[實際做的事和取捨]（#issue）
```

**範例**：

```markdown
- Gemini 2.5 系列做 AI 整理時長轉錄文字被截斷的問題（#23、#34）：根因是 Gemini 把 thinking tokens 計入 `maxOutputTokens` 配額，原本對所有 provider 統一給 2048 token 預算被 thinking 吃掉一部分後不夠用。改為 per-provider 預設：Gemini / OpenAI 16384、Anthropic / Groq 8192（後者模型上限 8192，給 16384 會被 API reject）
```

注意三件事：
1. **使用者語言而非開發者語言**：寫「長轉錄文字被截斷」不寫「response.choices[0].message.content 不完整」
2. **解釋 why**：不只說「修了 X」，要說「為什麼 X 會壞」、「為什麼選這個解法」
3. **保留技術細節**：API 名稱、token 數字、檔案行為、CSP 規則這些技術細節要留著（讀者裡有開發者）

### 寫入位置

寫在 CHANGELOG.md 的 `# Changelog` 標題之下，緊接著現有最新版本之前。

```markdown
# Changelog

SayIt 版本更新紀錄。

## [X.Y.Z] - YYYY-MM-DD     ← 寫在這裡

### Added
- ...

### Fixed
- ...

### Improved
- ...

## [上一個版本] - ...        ← 已存在
```

### 起草後的檢查

寫完先把草稿展示給使用者，**不要直接寫進檔案**。等使用者說「OK」或「改 X」再實際 Edit 寫入。

理由：CHANGELOG 是面向使用者的文案，每個發版的人對「什麼算亮點、用什麼語氣、要不要提技術細節」都有不同直覺，先給使用者看草稿可以避免一改再改。

## 步驟 ④ 起草 upgradeNotice

### 機制背景

升級彈窗由 Dashboard 啟動時 `consumeUpgradeNotice()` 觸發，比對 `lastSeenVersion`（存在 tauri-plugin-store）和 `__APP_VERSION__`（build-time 從 package.json 注入）。不相等就顯示。

需要動 7 個檔案：
1. `src/MainApp.vue`：`upgradeNoticeItemCount` 常數（控制顯示幾個 item）
2. `src/i18n/locales/zh-TW.json`：`mainView.upgradeNotice` 區塊
3. `src/i18n/locales/zh-CN.json`：同上
4. `src/i18n/locales/en.json`：同上
5. `src/i18n/locales/ja.json`：同上
6. `src/i18n/locales/ko.json`：同上

### 內容策略

每次發版只展示 1-3 個本版**最有感**的亮點。亮點要從 CHANGELOG 篩選，不是把 CHANGELOG 全貼進來。判準：

- **使用者每天都會用到、能被立刻感受到** → 優先放（例：新功能、UI 改善）
- **修一個過去常被回報的痛點** → 優先放（例：常見 bug fix）
- **內部優化、CI/CD、refactor** → 不放
- **超技術的根因說明** → 放但要轉成白話

每個 item 的寫法：

```
[亮點主題冒號]：[使用者場景 + 之前的問題 + 現在的體驗]
```

### 翻譯流程

使用者只寫 zh-TW，skill 自動翻 4 種。**不要叫使用者寫 5 種**。

#### 翻譯時的 5 語系語感

| 語系 | 語感方向 | 注意 |
|------|---------|------|
| zh-TW | 口語、用日常詞，如「剪貼簿」「貼上」「設定」 | 標點全形 |
| zh-CN | 簡體 + 中國大陸用語：「设置」（不是「設定」）、「粘贴」（不是「貼上」）、「连接」（不是「連線」） | 全形標點 |
| en | plain English、技術細節保留，避免 marketing 腔 | 用 em-dash `—` 連接補述 |
| ja | 丁寧体（です・ます調）、技術文書風 | 全形標點，専門用語保留英文 |
| ko | `-합니다` 体、技術用語自然 | 半形標點 + 空格 |

#### 翻譯品質檢查清單

- [ ] 5 語系都涵蓋了同一組「主題 + why + how」三要素
- [ ] zh-CN 沒有殘留 zh-TW 的繁體字或台灣用語
- [ ] en 不是 zh-TW 直譯（直譯常見特徵：句末加 the issue / the problem，過度被動語態）
- [ ] ja 用丁寧体一致
- [ ] ko 收尾是 `-니다`/`-습니다` 結構

### 寫入步驟

```
① 詢問使用者本版 1-3 個亮點主題
② 使用者用 zh-TW 描述（一兩句話即可）
③ skill 把 zh-TW 整理成「主題冒號 + 使用者場景 + why + how」格式
④ skill 翻譯 4 語系（zh-CN / en / ja / ko）
⑤ 把整組 upgradeNotice（5 語系 × N 個 item）展示給使用者遷訂
⑥ 使用者 OK 後實際 Edit 6 個檔案：
   - 5 個 .json 的 mainView.upgradeNotice 區塊
   - MainApp.vue 的 upgradeNoticeItemCount
```

### 重要：itemN 處理策略

每次發版**只保留新版本的 item**，不要累積上一版的。理由：

1. 升級彈窗的目的是讓使用者快速知道「這次升級多了什麼」，過往版本的 item 已經沒價值
2. 累積會讓彈窗越來越長，最終沒人讀
3. 保留舊 i18n key（item3, item4...）會讓 grep / refactor 出現假陽性

所以 Edit 時：

- 新版有 N 個 item → 5 個 .json 都只留 `title` + `item1..itemN` + `dismiss`
- 舊版的 `item3..item10` 整批刪掉
- `MainApp.vue` 的 `upgradeNoticeItemCount` 改成 N

## 步驟 ⑤ Sanity check

實際呼叫 release.sh 之前確認三件事，不對就回頭修：

```bash
# 1. 5 個 .json 的 upgradeNotice 區塊都對齊到 N 個 item + title + dismiss
rg -n '"upgradeNotice"' /Users/jackle/workspace/say-it/src/i18n/locales/ -A $((N+2))

# 2. MainApp.vue 的 itemCount 等於 N
rg -n 'upgradeNoticeItemCount = ' /Users/jackle/workspace/say-it/src/MainApp.vue

# 3. CHANGELOG.md 含 [X.Y.Z] 區塊
rg -n "^## \[X.Y.Z\]" /Users/jackle/workspace/say-it/CHANGELOG.md
```

任何一項對不上，回去把它修好再走步驟 ⑥。

## 步驟 ⑥ 取得跑 release.sh 的明確同意

不要自動跑 release.sh。用 AskUserQuestion 問使用者：

- **問題**：「要不要現在跑 ./scripts/release.sh X.Y.Z？這會自動 bump 4 處版本號、commit、打 tag、push 到 remote 觸發 CI/CD（不可逆）。」
- **選項**：
  - 「跑 release.sh」
  - 「先看一下 git diff 再決定」
  - 「先別跑，我手動處理」

只有第一個選項才往下跑步驟 ⑦。

## 步驟 ⑦ 跑 release.sh

```bash
cd /Users/jackle/workspace/say-it && ./scripts/release.sh X.Y.Z
```

### release.sh 可能擋下來的情況

| 訊息 | 原因 | 處理方式 |
|------|------|---------|
| `CHANGELOG.md 缺少 vX.Y.Z 的紀錄` | 步驟 ③ 沒寫進去 | 回到步驟 ③ |
| `有未 commit 的變更` | 之前有殘留 | 提示使用者「skill 改的檔案還沒 commit，跑 release 之前要先 commit」並協助 git add + git commit |
| `tag vX.Y.Z 已存在` | 版本號用過了 | 提示使用者要不同版本號 |
| `目前不在 git branch 上` | detached HEAD | 提示 `git switch main` |

注意：**skill 完成步驟 ④ 的 Edit 後，這些變更需要先 commit 才能跑 release.sh**。skill 在步驟 ⑥ 應該主動建議「我已經改了 CHANGELOG.md / 5 個 i18n .json / MainApp.vue 共 7 個檔，要不要我 commit 起來？」，使用者同意後再 commit、再進步驟 ⑦。

### Commit message 範例

```
docs: add CHANGELOG entry for vX.Y.Z

chore: update upgradeNotice for vX.Y.Z highlights
```

或一個合併 commit：

```
docs(release): prepare vX.Y.Z release notes

- CHANGELOG.md: add vX.Y.Z section
- i18n: update upgradeNotice for 5 locales
- MainApp.vue: bump upgradeNoticeItemCount to N
```

## 共通注意事項

### 不要動 Cargo.lock

Cargo.lock 是 release.sh 自動處理的（透過 cargo build 同步 sayit crate 版本）。skill 不要手動編輯 Cargo.lock，那是 hard-block 的保護檔案。

### 分支歸屬

主要發版從 `main` 出。如果使用者在 feature branch 上跑這個 skill，先確認意圖：

- 「PR 已 merge 進 main、我剛切回 main」→ OK
- 「我在 feature branch 上想直接發」→ 提示「release.sh 不擋這個但通常不是你想要的，CI/CD release.yml 也只認 tag 不認 branch」，讓使用者自己決定

### 日期一致性

CHANGELOG 標題的日期應該等於今天日期，不是亮點被開發的日期。執行時取 `date +%Y-%m-%d`，不要寫死字串。

### 跨檔案修改後的交叉驗證

修改完 7 個檔案（CHANGELOG + 5 個 .json + MainApp.vue），用步驟 ⑤ 的 sanity check 命令交叉驗證一次。CLAUDE.md 規定「同時修改多個相關文件時必須交叉驗證」，這一步是硬性的。

### 語音通知

每次觸發此 skill 都遵守 CLAUDE.md 的語音通知規範：開始時 say、執行中 say、完成前 say。內容反映當前任務（「我來起草 CHANGELOG」「翻譯 4 語完成」「等你決定要不要跑 release.sh」），20 字以內。
