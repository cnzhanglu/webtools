#!/usr/bin/env python3
"""从 icons/fish-source.png 生成 PWA 图标（192 / 512）。"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "fish-source.png"
OUT = ROOT / "icons"

def main():
    img = Image.open(SRC).convert("RGBA")
    w, h = img.size
    side = max(w, h)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 255))
    square.paste(img, ((side - w) // 2, (side - h) // 2), img)

    for size in (192, 512):
        out = square.resize((size, size), Image.Resampling.NEAREST)
        path = OUT / f"icon-{size}.png"
        out.save(path)
        print(f"wrote {path.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
