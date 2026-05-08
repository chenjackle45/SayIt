# ADR: Claude Code Review workflow 對 fork PR 的處理

| 項目 | 內容 |
|------|------|
| 狀態 | Accepted |
| 決議日期 | 2026-05-08 |
| 引入版本 | v0.9.5 之後（commit `01e1f06`） |
| 影響範圍 | GitHub Actions workflow |
| 程式碼位置 | `.github/workflows/claude-code-review.yml` |

## Context

SayIt 啟用了 [Claude Code GitHub App](https://github.com/apps/claude) 與兩支 workflow：

1. `claude.yml` — 由 `@claude` comment 觸發，回覆 issue/PR 評論
2. `claude-code-review.yml` — 由 `pull_request` 事件觸發，自動 review PR 變更

兩支 workflow 都依賴 `anthropics/claude-code-action@v1`，該 action 透過 GitHub OIDC token 與 Anthropic 端點兌換 GitHub App installation token，再代表 App 操作 PR / issue。

實測發現：當 PR 來自 **fork repository**（外部貢獻者，例如社群成員的 PR），`claude-code-review.yml` 永遠失敗。失敗訊息：

```
error: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable
Could not fetch an OIDC token. Did you remember to add `id-token: write`
to your workflow permissions?
```

`claude-code-review.yml` 的 `permissions` 區塊明確寫了 `id-token: write`，但仍失敗。

## Root Cause

GitHub 對 fork PR 採取**雙層保護**，兩層都針對 OIDC：

1. **第一層 — Workflow 不自動執行**：對外部 contributor 的 fork PR，第一次 workflow run 必須由 maintainer 手動 approve（透過 GitHub UI 或 `gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`）
2. **第二層 — Token 強制 read-only**：即使 approve 跑起來，**fork PR 拿到的 GITHUB_TOKEN 永遠是 read-only**，workflow 裡寫的 `permissions:` 區塊（包括 `id-token: write`）**被 GitHub 強制忽略**

第二層是 GitHub 為了保護 base repo secrets 而設的硬性限制：若 fork PR 能拿到完整權限，惡意 PR 就能透過 workflow 變更竊取 secrets / 簽署假 release。

結論：任何依賴 OIDC 的 action（`anthropics/claude-code-action@v1`、`aws-actions/configure-aws-credentials@v4` OIDC mode、其他 cloud provider 的 OIDC 整合）對 fork PR 都會失敗。這不是 SayIt workflow 設定錯誤，是 GitHub 設計上的安全護欄。

## Decision

在 `claude-code-review.yml` 的 `claude-review` job 加入 `if` guard：

```yaml
jobs:
  claude-review:
    # Skip fork PRs: forks cannot be granted id-token: write permission,
    # so anthropics/claude-code-action@v1 cannot mint an OIDC token and
    # the job would always fail. Same-repo branch PRs continue to run.
    if: github.event.pull_request.head.repo.full_name == github.repository

    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    # ...
```

判斷依據：`github.event.pull_request.head.repo.full_name == github.repository` — 比較 PR 來源 repo 與 base repo，相同代表是同 repo branch PR（不是 fork）。

`claude.yml`（`@claude` comment）**不需要此 guard**，因為 `issue_comment` / `pull_request_review_comment` 事件由 base repo 觸發，不受 fork PR 權限限制。

## Consequences

### 正面

- **Fork PR check 列表保持乾淨**：fork PR 的 `claude-review` 顯示「skipped」（灰色），而非永久紅色 ❌
- **無雜訊誤導**：之後 contributor / maintainer 在 PR 介面看到的紅色 check 都是真實問題，不會與「不能避免的雜訊」混淆
- **節省 Actions minutes**：fork PR 不會啟動已知必失敗的 job

### 負面

- **Fork PR 不會被自動 review**（不可避免的限制）：外部 contributor 的 PR 必須由 maintainer 手動觸發 review，例如：
  - 在 PR 留言 `@claude review this PR`（觸發 `claude.yml`，不受限）
  - Maintainer 把 PR rebase 進自己 branch 重新開 PR
  - 直接由 maintainer 人工 review

### 未來注意

- 此 guard 是**硬規則**，CLAUDE.md 與 `_bmad-output/project-context.md` 都已記載「禁止移除」
- 若 GitHub 未來放寬 OIDC 對 fork PR 的限制，可重新評估是否解除 guard

## Alternatives Considered

| 方案 | 結論 |
|------|------|
| 不加 guard，接受 fork PR 永遠紅色 ❌ | ❌ 雜訊大、誤導 contributor |
| 改用 `pull_request_target` 事件 | ❌ 此事件以 base repo 身份執行、可拿到 secrets，但同時會 checkout fork code，安全風險極高（fork code 可在 base repo 環境執行任意動作）— 業界一致不推薦 |
| 完全移除 `claude-code-review.yml` | ❌ 同 repo branch PR（maintainer 自己 push）就拿不到 auto review 了，浪費已設定好的 App + secret |
| 加更精細的 `if` 條件（例如僅 trusted contributor） | ❌ `author_association` 判斷複雜且 GitHub 對 first-time contributor 標記不穩定；單純比較 head repo 即可、最不容易出錯 |

## References

- [GitHub Docs — Approving workflow runs from public forks](https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks)
- [GitHub Docs — Events that trigger workflows: `pull_request_target`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request_target)
- Commit `01e1f06` — `ci(claude-review): skip fork PRs to avoid permanent OIDC failure`
- Memory: `cicd-patterns.md` — Fork PR 拿不到 id-token write 權限段
