#!/usr/bin/env python3
"""从 icons/fish-source.png 生成 PWA 图标（192 / 512），白色背景。"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "fish-source.png"
OUT = ROOT / "icons"
WHITE = (255, 255, 255, 255)


def replace_edge_black_with_white(img):
    """将连通到边缘的黑色像素换为白色，保留鱼眼等内部黑色。"""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    visited = set()
    stack = []

    for x in range(w):
        for y in (0, h - 1):
            if px[x, y][:3] == (0, 0, 0):
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y][:3] == (0, 0, 0) and (x, y) not in visited:
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        if (x, y) in visited:
            continue
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        if px[x, y][:3] != (0, 0, 0):
            continue
        visited.add((x, y))
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    for x, y in visited:
        px[x, y] = WHITE

    return img


def main():
    img = replace_edge_black_with_white(Image.open(SRC))
    w, h = img.size
    side = max(w, h)
    square = Image.new("RGBA", (side, side), WHITE)
    square.paste(img, ((side - w) // 2, (side - h) // 2), img)

    # 更新源图（白底版本）
    square.save(SRC)

    for size in (192, 512):
        out = square.resize((size, size), Image.Resampling.NEAREST)
        path = OUT / f"icon-{size}.png"
        out.save(path)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
