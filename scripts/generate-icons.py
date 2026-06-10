#!/usr/bin/env python3
"""从 icons/clownfish-source.png 生成透明底小丑鱼 PWA 图标。"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "clownfish-source.png"
OUT = ROOT / "icons"
TRANSPARENT = (0, 0, 0, 0)


def is_background(r, g, b, a):
    if a < 16:
        return True
    # 棋盘格灰白底
    if r > 215 and g > 215 and b > 215:
        return True
    return False


def remove_background(img):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    visited = set()
    stack = []

    for x in range(w):
        for y in (0, h - 1):
            c = px[x, y]
            if is_background(*c):
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            c = px[x, y]
            if is_background(*c) and (x, y) not in visited:
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        if (x, y) in visited:
            continue
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        c = px[x, y]
        if not is_background(*c):
            continue
        visited.add((x, y))
        px[x, y] = TRANSPARENT
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    return img


def snap_colors(img):
    """压缩为干净的像素色板。"""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 32:
                px[x, y] = TRANSPARENT
                continue
            if r < 40 and g < 40 and b < 40:
                px[x, y] = (0, 0, 0, 255)
            elif r > 240 and g > 240 and b > 240:
                px[x, y] = (255, 255, 255, 255)
            elif b > 200 and g > 160 and r < 180:
                px[x, y] = (134, 210, 252, 255)
            elif b > 120 and g > 80 and r < 80:
                px[x, y] = (37, 99, 168, 255)
            else:
                px[x, y] = (134, 210, 252, 255)
    return img


def fit_to_square(img, side, padding_ratio=0.04):
    pad = max(2, int(side * padding_ratio))
    inner = side - pad * 2
    w, h = img.size
    scale = min(inner / w, inner / h)
    nw = max(1, int(w * scale))
    nh = max(1, int(h * scale))
    resized = img.resize((nw, nh), Image.Resampling.NEAREST)
    square = Image.new("RGBA", (side, side), TRANSPARENT)
    square.paste(resized, ((side - nw) // 2, (side - nh) // 2), resized)
    return square


def main():
    if not SRC.exists():
        raise SystemExit(f"缺少源图：{SRC}")

    img = Image.open(SRC)
    img = remove_background(img)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # 先缩小再放大，去除 AI 图边缘噪点
    short = min(img.size)
    pixel_size = max(24, min(48, short // 8))
    small = img.resize((pixel_size, int(pixel_size * img.size[1] / img.size[0])), Image.Resampling.NEAREST)
    small = snap_colors(small)

    master = fit_to_square(small, 512, padding_ratio=0.04)
    master.save(OUT / "fish-source.png")

    for size in (192, 512):
        out = master.resize((size, size), Image.Resampling.NEAREST)
        path = OUT / f"icon-{size}.png"
        out.save(path)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
