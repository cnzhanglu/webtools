#!/usr/bin/env python3
"""
校验 sw.js 的 PRECACHE_URLS 与 tools-registry.js 注册表是否一致。

规则：
  - 每个已注册工具须有 ./tools/<id>/ 目录 URL（尾斜杠）
  - 注册表中引用的每个静态 JS/CSS 文件须在 PRECACHE_URLS 中（或可由目录页间接加载——本检查要求显式列出工具目录）

退出码：0 = 通过；1 = 存在缺失项。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_precache_urls(sw_text: str) -> set[str]:
    block = re.search(r"var PRECACHE_URLS = \[(.*?)\];", sw_text, re.S)
    if not block:
        raise RuntimeError("无法在 sw.js 中找到 PRECACHE_URLS")
    return set(re.findall(r"'(\./[^']*)'", block.group(1)))


def parse_tool_ids(registry_text: str) -> list[str]:
    ids: list[str] = []
    for m in re.finditer(r"id:\s*'([^']+)'", registry_text):
        ids.append(m.group(1))
    return ids


def main() -> int:
    sw_urls = parse_precache_urls(read(ROOT / "sw.js"))
    registry = read(ROOT / "shared/js/tools-registry.js")
    tool_ids = parse_tool_ids(registry)

    errors: list[str] = []
    for tid in tool_ids:
        dir_url = f"./tools/{tid}/"
        if dir_url not in sw_urls:
            errors.append(f"缺少工具目录预缓存：{dir_url}（工具 id={tid}）")

    # sw.js 自身应在 Cloudflare _headers 设 no-cache；不在 PRECACHE 列表属正常
    if "./" not in sw_urls:
        errors.append("缺少站点根目录预缓存：./")

    shared_required = (
        "./shared/css/common.css",
        "./shared/js/utils.js",
        "./shared/js/tools-registry.js",
        "./shared/js/pwa.js",
        "./shared/js/ipcidr.js",
    )
    for url in shared_required:
        if url not in sw_urls:
            errors.append(f"缺少共享资源预缓存：{url}")

    if errors:
        print("SW 预缓存与注册表校验未通过：\n")
        for e in errors:
            print("  -", e)
        return 1

    print(f"通过：{len(tool_ids)} 个工具均在 PRECACHE_URLS 中，共享资源齐全。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
