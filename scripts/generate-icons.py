#!/usr/bin/env python3
"""生成透明底浅蓝小丑鱼 PWA 图标（192 / 512），鱼体尽量占满画面。"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
TRANSPARENT = (0, 0, 0, 0)

# . = 透明  B = 浅蓝  b = 深蓝描边  W = 白色条纹  E = 眼睛(黑)
PALETTE = {
    ".": TRANSPARENT,
    "B": (134, 210, 252, 255),
    "b": (37, 99, 168, 255),
    "W": (255, 255, 255, 255),
    "E": (0, 0, 0, 255),
}

PIXELS = [
    "...........bb...........",
    "..........bBBb..........",
    ".........bBBBBb.........",
    "........bBBBBBBb........",
    ".......bBBWBBBWb.......",
    "......bBBBBWBBBBb......",
    ".....bBBBBBWBBBBBb.....",
    "....bBBBBBBWBBBBBBb....",
    "...bBBBBBBBBWBBBBBBBb...",
    "..bBBBBBBBBBWBBBBBBBBb..",
    ".bBBBBBBBBBBWBBBBBBBBBb.",
    "bBBBBBBBBBBBBWBBBBBBBBBb",
    "bBBBBBEBBBBBBWBBBBBBBBBb",
    ".bBBBBBBBBBBBWWBBBBBBBBb.",
    "..bBBBBBBBBBBBBBBBBBBBb..",
    "...bBBBBBBBBBBBBBBBBBb...",
    "....bBBBBBBBBBBBBBBBb....",
    ".....bBBBBBBBBBBBBb.....",
    "......bbBBBBBBBBbb......",
    "........bbbBBbbb........",
    "..........bbb...........",
]


def render_fish(scale):
    h = len(PIXELS)
    w = len(PIXELS[0])
    img = Image.new("RGBA", (w * scale, h * scale), TRANSPARENT)
    px = img.load()
    for y, row in enumerate(PIXELS):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            color = PALETTE[ch]
            for dy in range(scale):
                for dx in range(scale):
                    px[x * scale + dx, y * scale + dy] = color
    return img


def fit_to_square(img, side, padding_ratio=0.02):
    """缩放并居中，保留极小边距避免贴边裁切。"""
    pad = max(1, int(side * padding_ratio))
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
    OUT.mkdir(parents=True, exist_ok=True)
    fish = render_fish(12)
    bbox = fish.getbbox()
    if bbox:
        fish = fish.crop(bbox)

    master = fit_to_square(fish, 512, padding_ratio=0.01)
    master.save(OUT / "fish-source.png")

    for size in (192, 512):
        out = master.resize((size, size), Image.Resampling.NEAREST)
        path = OUT / f"icon-{size}.png"
        out.save(path)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
