#!/usr/bin/env bash
# 将仓库根目录静态资源同步到 embed 目录（构建前必须执行一次）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/server/internal/static/site"

rm -rf "$DEST"
mkdir -p "$DEST"

cd "$ROOT"
tar \
  --exclude='./.git' \
  --exclude='./server' \
  --exclude='./node_modules' \
  --exclude='./.cursor' \
  --exclude='./.wrangler' \
  --exclude='*.xlsx' \
  --exclude='./.DS_Store' \
  -cf - . | tar -xf - -C "$DEST"

echo "已同步静态资源到 $DEST"
