#!/bin/bash
set -euo pipefail

# SayIt 發版腳本
# 用法: ./scripts/release.sh 0.2.0

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
  echo "目前版本: $CURRENT"
  echo "用法: ./scripts/release.sh <新版本號>"
  echo "範例: ./scripts/release.sh 0.2.0"
  exit 1
fi

# 驗證版本號格式
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "錯誤: 版本號格式不正確，需要 X.Y.Z 格式"
  exit 1
fi

CURRENT=$(jq -r .version src-tauri/tauri.conf.json)
echo "版本更新: $CURRENT → $VERSION"

# 確認 working tree 乾淨
if [ -n "$(git status --porcelain)" ]; then
  echo "錯誤: 有未 commit 的變更，請先處理"
  git status --short
  exit 1
fi

# 確認 tag 不存在
if git tag -l "v$VERSION" | grep -q "v$VERSION"; then
  echo "錯誤: tag v$VERSION 已存在"
  exit 1
fi

# 更新版本號（兩個檔案）
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > tmp.json && mv tmp.json src-tauri/tauri.conf.json
jq --arg v "$VERSION" '.version = $v' package.json > tmp.json && mv tmp.json package.json

echo "✓ 已更新 tauri.conf.json 和 package.json"

# Commit + Tag + Push
git add src-tauri/tauri.conf.json package.json
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push origin main --tags

echo ""
echo "✓ 已推送 v$VERSION"
echo "→ Release workflow 已觸發，完成後到 GitHub Releases 頁面 Publish"
echo "  https://github.com/chenjackle45/SayIt/releases"
