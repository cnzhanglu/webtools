#!/usr/bin/env bash
# 同步静态资源并编译 webtools 可执行文件。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bash scripts/sync-static.sh

OUTPUT="${1:-webtools}"
VERSION="${VERSION:-dev}"

CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION}" -o "$OUTPUT" ./cmd/webtools
echo "已构建: $ROOT/$OUTPUT"
