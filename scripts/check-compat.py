#!/usr/bin/env python3
"""
浏览器 / WebView 兼容性静态检查（纯 Python 标准库，无 npm 依赖）

扫描仓库内 JS / CSS / HTML，对照预设基线报告不兼容或高风险的语法与特性。
适合在合并 dev、发布 main 前本地或 CI 执行。

用法：
  python3 scripts/check-compat.py
  python3 scripts/check-compat.py --baseline chrome86
  python3 scripts/check-compat.py --baseline chrome80,go-webview-linux --fail-on warn

退出码：0 = 通过；1 = 存在达到 --fail-on 级别的问题。
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator, Literal

ROOT = Path(__file__).resolve().parent.parent

Severity = Literal["error", "warn", "info"]

# 扫描范围（排除生成脚本等非运行时文件）
SCAN_DIRS = ("shared", "tools")
SCAN_ROOT_FILES = ("index.html", "sw.js")
SKIP_JS = {"scripts/generate-icons.js"}

# ---------------------------------------------------------------------------
# 基线定义：各目标环境不支持的特性
# ---------------------------------------------------------------------------

@dataclass
class Baseline:
    """一条兼容性基线及其规则。"""

    id: str
    title: str
    description: str
    # JS：命中即 error（破坏脚本执行）
    js_error_patterns: list[tuple[str, re.Pattern[str]]] = field(default_factory=list)
    # CSS：命中即 error
    css_error_props: set[str] = field(default_factory=set)
    # CSS：flex 容器内 gap 视为 warn（布局降级，功能仍可用）
    flex_gap_severity: Severity = "warn"
    # CSS：下列属性仅 warn（装饰性）
    css_warn_props: set[str] = field(default_factory=set)
    # 项目硬性依赖、无法在旧 WebView 去掉的特性（仅 info 提示）
    required_features: set[str] = field(default_factory=set)


def _js_patterns(items: list[tuple[str, str]]) -> list[tuple[str, re.Pattern[str]]]:
    return [(name, re.compile(pat, re.MULTILINE)) for name, pat in items]


# 各 Chrome 世代不应出现的 JS 语法（本项目约定也不使用）
MODERN_JS_ERRORS = _js_patterns([
    ("optional_chaining", r"\?\.(?!\d)"),  # 排除三元里的 ?.数字
    ("nullish_coalescing", r"\?\?"),
    ("logical_assignment", r"\?\?=|&&=|\|\|="),
    ("private_fields", r"(?:this\.|(?<=[\s{]))#(?=[A-Za-z0-9_]*[g-zG-Z_])[A-Za-z_]\w*"),
    ("top_level_await", r"(?:^|\n)\s*await\s+"),
    ("dynamic_import", r"\bimport\s*\("),
])

BASELINES: dict[str, Baseline] = {
    "chrome80": Baseline(
        id="chrome80",
        title="Chrome 80",
        description="Chromium 80（2020-02）；Flex gap 需 Chrome 84+",
        js_error_patterns=MODERN_JS_ERRORS,
        css_warn_props={"accent-color"},
        flex_gap_severity="warn",
        required_features={"bigint"},
    ),
    "chrome86": Baseline(
        id="chrome86",
        title="Chrome 86",
        description="Chromium 86（2020-10）；Flex gap 已支持，accent-color 需 93+",
        js_error_patterns=MODERN_JS_ERRORS,
        css_warn_props={"accent-color"},
        flex_gap_severity="info",  # 86 已支持 flex gap
        required_features={"bigint"},
    ),
    "go-webview-win": Baseline(
        id="go-webview-win",
        title="Go WebView · Windows (WebView2)",
        description="Wails / webview_go 在 Windows 使用 Evergreen WebView2（Chromium），通常 ≥ Chrome 90",
        js_error_patterns=MODERN_JS_ERRORS,
        css_warn_props={"accent-color"},
        flex_gap_severity="info",
        required_features={"bigint"},
    ),
    "go-webview-mac": Baseline(
        id="go-webview-mac",
        title="Go WebView · macOS (WKWebView)",
        description="绑定系统 WebKit；建议目标 macOS 11+ / Safari 14+（BigInt、Flex gap 14.1+）",
        js_error_patterns=MODERN_JS_ERRORS,
        css_warn_props={"accent-color"},
        flex_gap_severity="warn",  # Safari < 14.1
        required_features={"bigint"},
    ),
    "go-webview-linux": Baseline(
        id="go-webview-linux",
        title="Go WebView · Linux (WebKitGTK)",
        description="WebKitGTK 2.30+（Flex gap）、2.32+（BigInt）；Ubuntu 18.04 等旧环境可能不满足",
        js_error_patterns=MODERN_JS_ERRORS,
        css_warn_props={"accent-color"},
        flex_gap_severity="warn",
        required_features={"bigint"},
    ),
}

SEVERITY_ORDER = {"info": 0, "warn": 1, "error": 2}

# HTML / 全文件检查
CDN_PATTERNS = [
    re.compile(p, re.I)
    for p in [
        r"https?://[^\s\"']+(?:googleapis|gstatic|cdnjs|jsdelivr|unpkg|bootcdn|bootstrapcdn)\.",
        r"https?://[^\s\"']+cloudflare\.com/.+/(?:css|js)/",
    ]
]
ES_MODULE_RE = re.compile(r"""<script[^>]+type\s*=\s*['"]module['"]""", re.I)
EXPORT_MODULE_RE = re.compile(r"(?:^|\n)\s*export\s+(?:default\s+)?(?:class|function|const|let|var)\b")

BIGINT_RE = re.compile(r"\bBigInt\b|\d+n\b|0n\b|1n\b|16n\b|32n\b|64n\b|128n\b")

# CSS 属性检测
CSS_PROP_RE = re.compile(
    r"(?<![\w-])(accent-color|aspect-ratio|container-type|color-mix)\s*:",
    re.I,
)
CSS_HAS_RE = re.compile(r":has\s*\(")
CSS_IS_WHERE_RE = re.compile(r":(?:is|where)\s*\(")

FLEX_DISPLAY_RE = re.compile(
    r"display\s*:\s*(?:inline-)?flex\b",
    re.I,
)
GAP_RE = re.compile(r"(?<![\w-])(?:gap|row-gap|column-gap)\s*:", re.I)


@dataclass
class Issue:
  baseline: str
  severity: Severity
  category: str
  path: str
  line: int
  message: str
  snippet: str = ""


# ---------------------------------------------------------------------------
# 扫描实现
# ---------------------------------------------------------------------------

def iter_source_files() -> Iterator[Path]:
    for name in SCAN_ROOT_FILES:
        p = ROOT / name
        if p.is_file():
            yield p
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT).as_posix()
            if path.suffix.lower() in (".js", ".css", ".html"):
                if rel in SKIP_JS:
                    continue
                yield path


def line_number(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def snippet_at(text: str, index: int, width: int = 72) -> str:
    start = max(0, index - 10)
    end = min(len(text), index + width)
    s = text[start:end].replace("\n", " ").strip()
    return s[:width]


def scan_js(path: Path, text: str, baselines: Iterable[Baseline]) -> list[Issue]:
    rel = path.relative_to(ROOT).as_posix()
    issues: list[Issue] = []

    if EXPORT_MODULE_RE.search(text):
        for bl in baselines:
            issues.append(Issue(
                bl.id, "error", "js", rel, 1,
                "检测到 export 语句；项目约定禁止使用 ES Module",
            ))

    for bl in baselines:
        for name, pat in bl.js_error_patterns:
            for m in pat.finditer(text):
                issues.append(Issue(
                    bl.id, "error", "js", rel, line_number(text, m.start()),
                    f"不兼容语法：{name}",
                    snippet_at(text, m.start()),
                ))

        if "bigint" in bl.required_features and BIGINT_RE.search(text):
            issues.append(Issue(
                bl.id, "info", "js", rel, 1,
                "使用 BigInt；旧版 WebKitGTK < 2.32 将无法运行网络类工具",
            ))

    return issues


def split_css_blocks(text: str) -> list[tuple[int, str]]:
    """粗粒度拆分 CSS 规则块（含 @media 内），返回 (起始行, 块文本)。"""
    blocks: list[tuple[int, str]] = []
    i = 0
    n = len(text)
    line = 1
    while i < n:
        if text[i] == "{":
            # 回溯找选择器起点
            sel_start = text.rfind("}", 0, i)
            sel_start = 0 if sel_start < 0 else sel_start + 1
            # 跳过 @规则 prelude
            prelude = text[sel_start:i]
            depth = 1
            j = i + 1
            while j < n and depth:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                j += 1
            block = text[sel_start:j]
            blocks.append((line, block))
            i = j
        else:
            if text[i] == "\n":
                line += 1
            i += 1
    return blocks


def scan_css(path: Path, text: str, baselines: Iterable[Baseline]) -> list[Issue]:
    rel = path.relative_to(ROOT).as_posix()
    issues: list[Issue] = []

    for bl in baselines:
        for m in CSS_PROP_RE.finditer(text):
            prop = m.group(1).lower()
            sev: Severity = "warn" if prop in bl.css_warn_props else "error"
            if prop in bl.css_warn_props or prop in bl.css_error_props:
                issues.append(Issue(
                    bl.id, sev, "css", rel, line_number(text, m.start()),
                    f"CSS 属性可能不兼容：{prop}",
                    snippet_at(text, m.start()),
                ))

        for m in CSS_HAS_RE.finditer(text):
            issues.append(Issue(
                bl.id, "warn", "css", rel, line_number(text, m.start()),
                "CSS :has() 在旧 WebKit / Chrome < 105 不可用",
                snippet_at(text, m.start()),
            ))

        for m in CSS_IS_WHERE_RE.finditer(text):
            issues.append(Issue(
                bl.id, "warn", "css", rel, line_number(text, m.start()),
                "CSS :is() / :where() 在 Chrome < 88 不可用",
                snippet_at(text, m.start()),
            ))

        for start_line, block in split_css_blocks(text):
            if not GAP_RE.search(block):
                continue
            if not FLEX_DISPLAY_RE.search(block):
                continue
            sev = bl.flex_gap_severity
            if sev == "info":
                continue
            issues.append(Issue(
                bl.id, sev, "css", rel, start_line,
                "Flex 容器使用 gap；Chrome < 84 / Safari < 14.1 / 旧 WebKitGTK 间距失效",
                snippet_at(block, GAP_RE.search(block).start() if GAP_RE.search(block) else 0),
            ))

    return issues


def scan_html(path: Path, text: str, baselines: Iterable[Baseline]) -> list[Issue]:
    rel = path.relative_to(ROOT).as_posix()
    issues: list[Issue] = []

    for pat in CDN_PATTERNS:
        for m in pat.finditer(text):
            for bl in baselines:
                issues.append(Issue(
                    bl.id, "error", "policy", rel, line_number(text, m.start()),
                    "禁止引用外部 CDN（框架约束）",
                    snippet_at(text, m.start()),
                ))

    if ES_MODULE_RE.search(text):
        for bl in baselines:
            issues.append(Issue(
                bl.id, "error", "policy", rel, 1,
                "禁止使用 type=\"module\" 脚本（file:// 兼容性）",
            ))

    # HTML 内联 <style> 按 CSS 规则再扫一遍
    for m in re.finditer(r"<style[^>]*>([\s\S]*?)</style>", text, re.I):
        inner = m.group(1)
        pseudo = path.with_suffix(".inline.css")
        issues.extend(scan_css(pseudo, inner, baselines))

    return issues


def dedupe_issues(issues: list[Issue]) -> list[Issue]:
    seen: set[tuple] = set()
    out: list[Issue] = []
    for it in issues:
        key = (it.baseline, it.severity, it.category, it.path, it.line, it.message)
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return sorted(out, key=lambda x: (x.baseline, SEVERITY_ORDER[x.severity], x.path, x.line))


def format_report(issues: list[Issue], fail_on: Severity) -> str:
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("工具箱 · 浏览器 / WebView 兼容性检查")
    lines.append("=" * 60)

    if not issues:
        lines.append("\n✓ 未发现问题")
        return "\n".join(lines)

    by_baseline: dict[str, list[Issue]] = {}
    for it in issues:
        by_baseline.setdefault(it.baseline, []).append(it)

    fail_count = sum(1 for it in issues if SEVERITY_ORDER[it.severity] >= SEVERITY_ORDER[fail_on])

    for bid, items in sorted(by_baseline.items()):
        bl = BASELINES[bid]
        lines.append(f"\n## 基线：{bl.title} ({bid})")
        lines.append(f"   {bl.description}")
        for sev in ("error", "warn", "info"):
            group = [it for it in items if it.severity == sev]
            if not group:
                continue
            label = {"error": "错误", "warn": "警告", "info": "提示"}[sev]
            lines.append(f"\n  [{label}] {len(group)} 项")
            for it in group:
                loc = f"{it.path}:{it.line}"
                lines.append(f"    - {loc}  {it.message}")
                if it.snippet:
                    lines.append(f"      → {it.snippet}")

    lines.append("\n" + "-" * 60)
    lines.append(f"合计 {len(issues)} 项；达到 --fail-on={fail_on} 的 {fail_count} 项")
    if fail_count:
        lines.append("结果：未通过 ✗")
    else:
        lines.append("结果：通过 ✓（存在未达失败级别的提示/警告）")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    default_baselines = "chrome86,go-webview-linux"
    p = argparse.ArgumentParser(description="静态检查 JS/CSS/HTML 浏览器兼容性")
    p.add_argument(
        "--baseline",
        default=default_baselines,
        help=f"逗号分隔基线 ID（可选：{', '.join(BASELINES)}），默认 {default_baselines}",
    )
    p.add_argument(
        "--fail-on",
        choices=("error", "warn", "info"),
        default="error",
        help="达到该级别及以上时退出码为 1（默认 error，仅阻断破坏性语法）",
    )
    p.add_argument(
        "--list-baselines",
        action="store_true",
        help="列出所有基线说明后退出",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.list_baselines:
        for bl in BASELINES.values():
            print(f"{bl.id:20} {bl.title}")
            print(f"{'':20} {bl.description}\n")
        return 0

    ids = [s.strip() for s in args.baseline.split(",") if s.strip()]
    unknown = [i for i in ids if i not in BASELINES]
    if unknown:
        print(f"未知基线：{', '.join(unknown)}", file=sys.stderr)
        print(f"可用：{', '.join(BASELINES)}", file=sys.stderr)
        return 2

    baselines = [BASELINES[i] for i in ids]
    all_issues: list[Issue] = []

    for path in iter_source_files():
        text = path.read_text(encoding="utf-8")
        suffix = path.suffix.lower()
        if suffix == ".js":
            all_issues.extend(scan_js(path, text, baselines))
        elif suffix == ".css":
            all_issues.extend(scan_css(path, text, baselines))
        elif suffix == ".html":
            all_issues.extend(scan_html(path, text, baselines))
            for script in re.finditer(r"<script[^>]*>([\s\S]*?)</script>", text, re.I):
                if re.search(r"""type\s*=\s*['"]module['"]""", script.group(0), re.I):
                    continue
                all_issues.extend(scan_js(path, script.group(1), baselines))

    issues = dedupe_issues(all_issues)
    print(format_report(issues, args.fail_on))

    fail_on = args.fail_on
    for it in issues:
        if SEVERITY_ORDER[it.severity] >= SEVERITY_ORDER[fail_on]:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
