---
paths:
  - .github/**
  - scripts/**
  - CHANGELOG.md
  - package.json
  - src-tauri/tauri.conf.json
  - src-tauri/Cargo.toml
  - src/lib/autoUpdater.ts
---

# CI／發版／自動更新規則

> 2026-09-11 自 `CLAUDE.md` 搬入，內容未改；發版步驟見 `docs/development-process.md`「發版」段。

## CI/CD Pipeline

```
 push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────┐
 │  ci.yml  │         │  release.yml    │
 │ vue-tsc  │         │ 3 matrix jobs:  │
 │ vitest   │         │  macOS ARM      │
 │ rust-    │         │  macOS Intel    │
 │  check   │         │  Windows x64    │
 │ (mac+win)│         │                 │
 └──────────┘         │ + Apple Signing │
                      │ + Notarization  │
                      │ + Updater .sig  │
                      │ + Sentry upload │
                      └────────┬────────┘
                               │
                          Draft Release
                               │
                               ▼
                       publish-release job
                               │
                               ▼
                          Public Release
```

- CI 的 `rust-check` 跑 `cargo clippy --workspace --all-targets -- -D warnings`，toolchain 是 `dtolnay/rust-toolchain@stable`，**會隨 stable 升級帶進新 lint**（2026-09-10 clippy 1.98 的 `chunks_exact_to_as_chunks` 擋過一次）；本機 clippy 綠不代表 CI 綠，push 後要看
- windows runner 是 `#[cfg(target_os = "windows")]` 區塊唯一的編譯驗證

## 發版硬規則

- 發版版本號必須在 `git tag`、`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 四處保持一致（`scripts/release.sh` 負責同步，並要求 `CHANGELOG.md` 已有 `## [X.Y.Z]` 區塊、工作樹乾淨）
- 正式版 Sentry release 一律由 `.github/workflows/release.yml` 產生，格式固定為 `sayit@<version>`
- 前端與 Rust 不可各自手動指定不同的 Sentry release 名稱
- 正式版 telemetry 與 sourcemap upload 只能走 `release.yml`，不得繞過 workflow 手動上傳
- 發版前必須確認 GitHub Secrets 與 Sentry Secrets 齊全
- `git tag`、`git push` 由使用者授權後才執行（全域 git 規約）

## GitHub Secrets（13 個）

| Secret | 用途 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Updater 簽署私鑰 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私鑰密碼 |
| `APPLE_CERTIFICATE` | Developer ID .p12 (Base64) |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 密碼 |
| `APPLE_SIGNING_IDENTITY` | Developer ID signing identity（見 GitHub Secrets） |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-Specific Password |
| `APPLE_TEAM_ID` | Apple Developer Team ID（見 GitHub Secrets） |
| `SENTRY_DSN` | Rust 正式版 Sentry DSN |
| `VITE_SENTRY_DSN` | Frontend 正式版 Sentry DSN |
| `SENTRY_AUTH_TOKEN` | Sentry sourcemap upload token |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |

## 固定下載連結（官網用）

| 平台 | URL |
|------|-----|
| macOS ARM | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-arm64.dmg` |
| macOS Intel | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-x64.dmg` |
| Windows | `https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-windows-x64.exe` |

## Claude Code Review Workflow

- **Workflows** — `.github/workflows/claude.yml`（`@claude` comment 觸發）+ `.github/workflows/claude-code-review.yml`（PR 自動 review）
- **必要設定** — 安裝 [Claude Code GitHub App](https://github.com/apps/claude) 到 repo + 設定 `CLAUDE_CODE_OAUTH_TOKEN` secret（不是 `ANTHROPIC_API_KEY`）
- **Fork PR 限制（硬規則）** — `claude-code-review.yml` 的 job 必須保留 `if: github.event.pull_request.head.repo.full_name == github.repository` guard，**禁止移除**。理由：GitHub 不會授予 fork PR `id-token: write`，OIDC token 兌換永遠失敗，此 guard 讓 fork PR 顯示「skipped」（灰色）而非紅色 ❌。詳見 [`docs/adr-claude-code-review-fork-pr.md`](../../docs/adr-claude-code-review-fork-pr.md)
- **`@claude` comment 不受 fork 限制** — `claude.yml` 由 issue_comment 事件觸發，可正常用於任何 PR / issue
- **Fork PR 第一次跑需手動 approve** — GitHub 安全機制；可用 `gh api -X POST /repos/{owner}/{repo}/actions/runs/{id}/approve`

## 自動更新機制

- **定時檢查** — `main-window.ts`：啟動 5 秒後首次檢查，之後每 4 小時（`setInterval`）
- **手動檢查** — `MainApp.vue` Sidebar Footer「檢查更新」按鈕，結果用 `useFeedbackMessage` 顯示
- **回傳型別** — `checkForAppUpdate()` → `Promise<UpdateCheckResult>`（`up-to-date` | `update-available` | `error`）
- **已知限制** — `autoUpdater.ts` 中 `window.confirm` 在 Tauri WKWebView 會被靜默忽略，未來需改用 in-app UI
- 更新後首次開 Dashboard 會彈「更新摘要」（`upgradeNotice`，五語系），發版時要換內容（見 `.claude/rules/i18n.md`）
