# SayIt 開發流程

> 建立：2026-09-11（參考 NoWayLM 規則體系，依 SayIt 尺度調整：單人維護、有社群 PR、桌面 App 發版、一次一個 session）。
> 這份講「怎麼走」；「怎麼寫」在 `CLAUDE.md` 與 `.claude/rules/`；「改什麼檔」在 `development-guide.md`。

## 主線

```
 1 需求入口 → 2 分流 → 3 計畫 → 4 實作 → 5 閘門 → 6 commit → 7 發版 → 8 回承諾
```

| 站 | 做什麼 | 產物 |
|---|---|---|
| 1 需求入口 | issue、PR、自己的想法 | — |
| 2 分流 | 做不做、排哪版、是不是 trivial；**只要對外說了「會做」就記進 `community-commitments.md`** | 承諾表一行 |
| 3 計畫 | 非 trivial 寫 `docs/plan-<slug>.md`（要解決什麼、範圍、不做、動工前要驗），交 codex 計劃閘；大改版的拍板 demo 複製進 `docs/demos/<主題>/`（小 UI 改動不需設計稿，做完截圖給使用者看） | 計畫檔、demo |
| 4 實作 | 依 rules；hooks 自動跑型別檢查與 lint | diff |
| 5 閘門 | 雙向追溯閘 → codex 實作閘 → `pnpm test`、`vue-tsc`、clippy、`cargo test` 全綠 | 閘門紀錄 |
| 6 commit | 列檔案清單等授權；conventional commit；社群 PR 接手時 squash 並保留 `Co-authored-by` | commit |
| 7 發版 | 見下「發版」 | tag、Release |
| 8 回承諾 | 關 PR、逐串通知、承諾表銷帳 | 留言 |

**trivial 的定義**：純 i18n key、純文件、純設定檔、1 到 2 行錯字。改一行邏輯不是 trivial；判不準就當非 trivial。

## 閘門

### codex 雙閘（既有）

- **計劃閘**：計畫成形、動工前，codex 唯讀複查（挑戰前提、漏洞、更簡解法），high 質疑收斂後才動工。派工方式見全域 `~/.claude/CLAUDE.md`「codex 雙重把關」。
- **實作閘**：建議 commit 前，codex 唯讀對抗複查 working-tree diff；high 以上 correctness 問題必修。修復批的每個改動塊都要追得回某條 finding。

### 雙向追溯閘（2026-09-11 自 NoWayLM 搬入，進實作閘前 30 秒）

實作者附一張「原始需求／症狀 ↔ diff 行」對照：

- (a) 每條需求或症狀都指得到會改變它的 diff 行；指不到 = **漏做**
- (b) 每個 diff 檔都追得回某條需求或已拍板決定；追不回 = **多做**

任一不成立，整批退回範圍重審，不進逐行審查。這關防的是「在不該做的東西上做高品質審查」。

### 小卡節流（2026-09-11 自 NoWayLM 搬入）

- 措辭、格式、命名、AC 對齊這類「規格精度型」finding 嚴重度上限 MED，不能單獨擋卡
- 無安全、金鑰、資料風險的小改動，計劃閘最多兩輪；第三輪不開，改由使用者裁決
- 目的：閘門在小卡上會自己製造 finding，每輪修復又生下一輪

### 加碼條件

碰金鑰儲存、Windows 鍵盤 hook、貼上時序、資料庫 migration 時，實作閘另加一輪 codex 唯讀對抗複查（乾淨 context）。

## 社群 PR

### 三色分流

| 色 | 條件 | 動作 |
|---|---|---|
| 🟢 可併 | CI 綠、不違反 rules、敏感區（金鑰、原生檔案 I/O、migration）無紅旗、可獨立回退、Windows-only 程式碼標「Mac 驗不了」 | 進可併清單，使用者放行才併 |
| 🟡 需拍板 | 產品取捨、安全紅旗、拿不準的 | 做成拍板卡（HTML 決策頁）批次問 |
| 🔴 擋下 | 會破壞、有疑慮 | 留言附問題與修法建議 |

堆疊 PR 讀增量 diff（相對前一個 PR），不讀累積 diff。

### 條件併 vs 接手改

- **條件併**：留言列條件（技術細節可講），請作者改；作者兩週無回音，改為接手
- **接手改**：`git fetch` 該分支到本機 → 補改 → 過雙閘 → squash 進 local main 並加 `Co-authored-by: <作者> <email>` → 使用者 push → CI 綠 → **手動關 PR**（squash 不會自動關）並留一則併入通知（列出接手改了什麼）→ 回原 issue
- fork PR 的 CI 第一次要手動 approve：`gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`
- 不在 GitHub 上按 merge；不改別人的分支

### 留言規則

- 一律第一人稱「我」，白話，不過度客氣
- **沒發 PR 的回報者**：不寫機制、不寫元件名、不寫「原因是…」；只寫確認了什麼、接下來怎麼做、體驗會怎麼變
- **PR 作者**：可以講技術
- 不承諾版本號與日期；例外是「某日無回音就接手」這種對作者的期限
- 所有對外留言先給使用者過目再發；發後立刻更新承諾表

## 發版

1. 承諾表對帳：這版兌現了哪些、留言要回誰
2. push 後等 CI 三個 job 綠（`check`、`rust-check` macOS 與 Windows）；stable clippy 升級帶進的新 lint 在這裡才看得到
3. `CHANGELOG.md` 加 `## [X.Y.Z] - 日期` 區塊（Added / Fixed / Changed，附 issue、PR 與貢獻者）
4. 更新摘要彈窗：五語系 `upgradeNotice.item1`～`item5` 換成本版重點
5. 版號：有新功能升 minor，只修 bug 升 patch
6. commit 上述（純文件與 i18n，不過 codex）→ 使用者授權 → `./scripts/release.sh X.Y.Z`（bump 四處版本、commit、tag、push，需使用者授權）
7. 盯 release workflow 三平台建置到 Release 公開（`draft=false`）
8. 回承諾：關 PR、逐串通知（含「請實測回報」）、承諾表銷帳

## 計畫檔與承諾表規約

- `docs/plan-<slug>.md`：非 trivial 才寫，一頁為限；含拍板結果、計劃閘結論、範圍、不做、動工前要驗。做完後保留，狀態改「已交付 vX.Y.Z」
- `docs/demos/<主題>/`：拍板過的 HTML demo 複製進來；計畫檔引用 repo 內路徑，不引用個人目錄
- `docs/community-commitments.md`：三段（未交付、待發出、已銷帳）；**代發任何含承諾的留言後立刻更新；發版前清一遍未交付段**

## 刻意不做（附理由，防重提）

- **多 session git 協調契約**（CAS、atomic claim、單一 integrator）：SayIt 一次一個 session，沒有雙工
- **三 reviewer `/code-review` 閘**：單人桌面 App、無金流；codex 雙閘加追溯閘與節流已夠，三 reviewer 在這個尺度會製造 finding
- **模型分派表全套**：全域準則已定 codex 派工 SOP
- **QA 落帳追溯閘、排程證據閘**：沒有 staging 站也沒有背景排程；真機驗證靠回報者實測與自己開 App
- **BMad Build 與 sprint-status**：v0.11 起自然停用，一頁計畫檔夠用
- **Snapshot 索引維護規約**：兩百多個檔 Grep 就夠
