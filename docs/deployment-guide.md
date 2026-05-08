# Deployment Guide

> CI/CD pipeline、Apple Code Signing、Notarization、發版流程
> 掃描日期：2026-05-08 · 版本：0.9.5

---

## 一、CI/CD 概覽

```
push/PR to main           push tag v*
       │                        │
       ▼                        ▼
 ┌──────────┐         ┌─────────────────────────────────┐
 │  ci.yml  │         │       release.yml               │
 │  ──────  │         │  ────────────────────────────   │
 │ vue-tsc  │         │  Job: build (matrix · 3)        │
 │ vitest   │         │   ├── macOS aarch64-apple-darwin│
 │ cargo    │         │   ├── macOS x86_64-apple-darwin │
 │  check   │         │   └── Windows x64               │
 │ (mac+win)│         │                                 │
 └──────────┘         │  + tauri-action                 │
                      │   - Apple Code Sign             │
                      │   - Notarization                │
                      │   - Updater .sig                │
                      │  + Sentry sourcemap upload      │
                      │     (mac arm64 only)            │
                      │  + 上傳穩定檔名（gh release）   │
                      │                                 │
                      │  Job: publish-release           │
                      │   gh release edit --draft=false │
                      └─────────────────────────────────┘
```

---

## 二、ci.yml（每次 push / PR）

### 2.1 Frontend job (`check`, ubuntu-latest)
```
1. checkout
2. setup-node (從 .nvmrc → 24)
3. pnpm setup
4. pnpm install --frozen-lockfile
5. npx vue-tsc --noEmit       ← 型別檢查
6. pnpm test                  ← Vitest unit + component
```

### 2.2 Rust job (`rust-check`, matrix)
```
matrix:
  - macos-latest
  - windows-latest

steps:
  1. checkout
  2. dtolnay/rust-toolchain@stable
  3. swatinem/rust-cache@v2 (workspaces: src-tauri)
  4. cargo check (working-directory: src-tauri)
```

### 2.3 ⚠️ CI 缺漏

| 項目                       | 影響                                              |
| -------------------------- | ------------------------------------------------- |
| 沒跑 `cargo test`          | 17+ 個 Rust 純函式測試沒 CI 守門                  |
| 沒跑 `cargo clippy`        | Rust lint 規則沒 enforce                          |
| 沒跑 ESLint                | 雖然 PostToolUse hook 自動跑，但 PR 仍可能漏掉    |
| 沒跑 Playwright E2E        | E2E 仍是本機跑，沒整合 CI                         |

---

## 三、release.yml（tag push v*）

### 3.1 觸發

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag: { description: 'Tag to build (e.g. v0.2.0)', required: true }
```

### 3.2 Build matrix（3 個平台）

| Platform        | Args                              | Stable Name                  | Sourcemaps |
| --------------- | --------------------------------- | ---------------------------- | ---------- |
| macos-latest    | `--target aarch64-apple-darwin`   | `SayIt-mac-arm64.dmg`        | **true**（唯一上傳） |
| macos-latest    | `--target x86_64-apple-darwin`    | `SayIt-mac-x64.dmg`          | false      |
| windows-latest  | （空）                             | `SayIt-windows-x64.exe`      | false      |

### 3.3 Release metadata 解析

```bash
# 從 tag 或 workflow_dispatch input 取
RAW_TAG="${tag#refs/tags/}"
RELEASE_VERSION="${RAW_TAG#v}"

# 推到 GITHUB_ENV：
RELEASE_TAG=v0.9.5
RELEASE_VERSION=0.9.5
SENTRY_RELEASE=sayit@0.9.5
VITE_SENTRY_RELEASE=sayit@0.9.5
```

### 3.4 主要 step：`tauri-apps/tauri-action@v0`

注入下列 env：

```
TAURI_SIGNING_PRIVATE_KEY              ← Updater 簽署私鑰
TAURI_SIGNING_PRIVATE_KEY_PASSWORD     ← 私鑰密碼

# Apple Code Signing + Notarization (macOS only)
APPLE_CERTIFICATE                      ← Developer ID .p12 (Base64)
APPLE_CERTIFICATE_PASSWORD             ← .p12 密碼
APPLE_SIGNING_IDENTITY                 ← Developer ID Application: ...
APPLE_ID                               ← Apple ID email
APPLE_PASSWORD                         ← App-Specific Password
APPLE_TEAM_ID                          ← Apple Developer Team ID

# Sentry
SENTRY_DSN, VITE_SENTRY_DSN
SENTRY_ENVIRONMENT=production
VITE_SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=sayit@<version>
VITE_SENTRY_RELEASE=sayit@<version>
VITE_SENTRY_SOURCEMAPS_ENABLED=<matrix.upload_sourcemaps>
```

with：

```yaml
tagName: ${{ env.RELEASE_TAG }}
releaseName: "SayIt v${{ env.RELEASE_VERSION }}"
releaseBody: "See the assets to download and install this version."
releaseDraft: true              ← 先建 Draft，最後一個 job 才 publish
prerelease: false
args: ${{ matrix.args }}
```

### 3.5 Sourcemap upload（mac arm64 only）

```bash
npx @sentry/cli releases new "$SENTRY_RELEASE" || true
npx @sentry/cli sourcemaps upload dist/assets \
  --release "$SENTRY_RELEASE" \
  --url-prefix "~/assets" \
  --validate \
  --wait
npx @sentry/cli releases finalize "$SENTRY_RELEASE" || true
```

> 為什麼只在 mac arm64 跑？避免重複上傳同份 sourcemap（兩個 mac build 與 Windows build 共用同一份前端 bundle）。

### 3.6 上傳穩定檔名

GitHub Release 的 default asset 命名為 `SayIt_0.9.5_aarch64.dmg` 等版本號內嵌格式 — 這對「永遠最新版」連結（`releases/latest/download/...`）不友善。

額外步驟把 dmg / exe 重新命名後上傳：

```bash
# macOS
DMG=$(find src-tauri/target -path "*/bundle/dmg/*.dmg" | head -1)
cp "$DMG" "${{ matrix.stable_name }}"
gh release upload "$RELEASE_TAG" "${{ matrix.stable_name }}" --clobber

# Windows (PowerShell)
$exe = Get-ChildItem ... -Filter "*-setup.exe" | Select -First 1
Copy-Item $exe.FullName "${{ matrix.stable_name }}"
gh release upload "$env:RELEASE_TAG" "${{ matrix.stable_name }}" --clobber
```

### 3.7 Job 2：`publish-release`

```bash
gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false
```

> 等 build job 全跑完再 publish — 確保不會出現「半完成」release。

---

## 四、發版流程（人工 + 自動）

### 4.1 前置作業

```
1. 確認 main 上的所有 PR 都已合併
2. 更新 CHANGELOG.md：
   ## [0.9.5] - 2026-05-01
   ### Added
   ### Fixed
   ### Changed
3. git add CHANGELOG.md && git commit -m "docs: changelog v0.9.5"
4. git push
```

### 4.2 執行 release 腳本

```bash
./scripts/release.sh 0.9.5
```

腳本會：
1. 驗證版本號格式 `^[0-9]+\.[0-9]+\.[0-9]+$`
2. 確認 CHANGELOG.md 包含 `## [0.9.5]` 區塊
3. 確認 working tree 乾淨
4. 確認 tag `v0.9.5` 不存在
5. 確認在 git branch 上（非 detached HEAD）
6. **同步更新四個檔案**的版本號：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`（搜 `name = "sayit"\nversion = "..."`）
7. `git commit -m "chore: bump version to 0.9.5"`
8. `git tag v0.9.5`
9. `git push origin <branch>` + `git push origin v0.9.5`（**分開 push**，避免 GitHub Actions tag 事件遺失）

### 4.3 自動建構（GitHub Actions）

tag push 後自動觸發 `release.yml`：
- 三個 build job 平行跑（mac arm64 / mac x64 / windows）
- 完成後 `publish-release` job 把 Draft Release 改為 Published

時間：~ 15-25 分鐘（含 Apple notarize 等待）

### 4.4 驗證 Release

```
1. GitHub Releases 頁面確認 v0.9.5 已 Published
2. 檢查附件：
   - SayIt-mac-arm64.dmg（穩定檔名）
   - SayIt-mac-x64.dmg
   - SayIt-windows-x64.exe
   - 自動命名版（SayIt_0.9.5_*.dmg / .exe）
   - latest.json（updater）
   - 對應的 .sig 檔（updater 簽名）
3. 下載 .dmg → 開啟 → 確認 Notarization 通過（不會跳「未驗證」警告）
4. 檢查 Sentry：
   - Releases 頁面看到 sayit@0.9.5
   - Sourcemaps 已上傳（前端 stack trace 應該有原始檔名）
5. 啟動 app → 設定頁面確認版本號顯示 0.9.5
```

---

## 五、Apple Code Signing & Notarization

### 5.1 Developer ID

- Team：Tai-Cheng Chen (G9J8D2T6DV)
- Apple ID：chenjackle45@gmail.com
- Signing Identity：`Developer ID Application: Tai-Cheng Chen (G9J8D2T6DV)`

### 5.2 簽署流程（tauri-action 自動處理）

```
1. 從 APPLE_CERTIFICATE secret 解 .p12 並 import 到 keychain
2. tauri-action 用 APPLE_SIGNING_IDENTITY 簽 .app bundle
3. 用 APPLE_ID + APPLE_PASSWORD 提交 notarization
4. notarize ticket 回來後 staple 到 .dmg
```

### 5.3 必要 entitlements（`src-tauri/Entitlements.plist`）

要的權限（節錄）：
- `com.apple.security.cs.disable-library-validation`（cpal 動態載入 audio framework）
- `com.apple.security.device.audio-input`（麥克風）
- `com.apple.security.cs.allow-jit`（WebView）
- `com.apple.security.cs.allow-unsigned-executable-memory`（WebView）

### 5.4 自動更新簽名

`tauri-plugin-updater` 用 minisign 簽名：

- 私鑰：`~/.tauri/sayit.key`，密碼：`sayit-updater-2026`
- 公鑰：嵌入 `tauri.conf.json` 的 `plugins.updater.pubkey`
- Updater endpoint：`https://github.com/chenjackle45/SayIt/releases/latest/download/latest.json`

每次 release.yml 跑時：
- tauri-action 用 `TAURI_SIGNING_PRIVATE_KEY` + 密碼產 `latest.json` + 各平台 `.sig` 檔
- 上傳到 GitHub Release

---

## 六、GitHub Secrets（13 個）

| Secret                                  | 用途                                            |
| --------------------------------------- | ----------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`             | Updater 簽署私鑰                                |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`    | 私鑰密碼                                        |
| `APPLE_CERTIFICATE`                     | Developer ID .p12（Base64）                     |
| `APPLE_CERTIFICATE_PASSWORD`            | .p12 密碼                                       |
| `APPLE_SIGNING_IDENTITY`                | Developer ID signing identity                   |
| `APPLE_ID`                              | Apple ID email                                  |
| `APPLE_PASSWORD`                        | App-Specific Password                           |
| `APPLE_TEAM_ID`                         | Apple Developer Team ID                         |
| `SENTRY_DSN`                            | Rust 正式版 Sentry DSN                          |
| `VITE_SENTRY_DSN`                       | Frontend 正式版 Sentry DSN                      |
| `SENTRY_AUTH_TOKEN`                     | Sentry sourcemap upload token                   |
| `SENTRY_ORG`                            | Sentry organization slug                        |
| `SENTRY_PROJECT`                        | Sentry project slug                             |

> dev / staging 環境用本機 `.env`（不入版本）；secrets 只在 release.yml 注入。

---

## 七、Sentry Release 規則（硬規則）

1. **Release 名稱固定**：`sayit@<version>`（前端 + 後端必須相同）
2. **正式版 Sentry release 一律由 release.yml 產生**，前端與 Rust **不可** 各自手動指定不同名稱
3. **Sourcemap upload 只能走 release.yml 的 mac arm64 job**，不可繞過 workflow 手動上傳
4. **dev / staging 不上報**：Rust 端 `is_sentry_enabled()` 檢查 `production`；前端 `initSentryFor*()` 檢查 DSN

---

## 八、固定下載 URL（官網連結）

```
macOS ARM:
  https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-arm64.dmg

macOS Intel:
  https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-mac-x64.dmg

Windows:
  https://github.com/chenjackle45/SayIt/releases/latest/download/SayIt-windows-x64.exe

Updater latest.json:
  https://github.com/chenjackle45/SayIt/releases/latest/download/latest.json
```

---

## 九、回滾 / 撤回 release

```bash
# 1. 標記為 prerelease（不在 latest 連結）
gh release edit v0.9.5 --prerelease

# 2. 完全刪除（極端情況，會破壞 updater）
gh release delete v0.9.5
git push --delete origin v0.9.5
```

> ⚠️ 不要直接刪除 release — `tauri-plugin-updater` 已下載這個版本的使用者下次檢查更新會 404，而非降級。優先做法是發 v0.9.6 修復後通知使用者更新。

---

## 十、發版前的硬性檢查

```
□ git tag v<version> 不存在
□ package.json / tauri.conf.json / Cargo.toml / Cargo.lock 版本號一致
□ CHANGELOG.md 有 [<version>] 區塊
□ working tree 乾淨
□ CI 全綠（main 分支）
□ GitHub Secrets 13 個齊全
□ ./scripts/release.sh 執行成功
□ release.yml 三個 build job 全跑完
□ publish-release job 完成（Draft → Published）
□ 下載 .dmg / .exe 實機測試
□ Sentry sourcemap 已上傳（mac arm64）
```
