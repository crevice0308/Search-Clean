#!/usr/bin/env python3
"""Development only: regenerate local PNG icons with Pillow; no network."""
from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parents[1] / "extension" / "icons"
output.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 511, 511), radius=112, fill="#175c45")
draw.ellipse((108, 100, 324, 316), outline="white", width=36)
draw.line((296, 296, 404, 404), fill="white", width=36)
draw.line((168, 208, 204, 244, 272, 164), fill="white", width=34, joint="curve")
for size in (16, 32, 48, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(output / f"icon{size}.png", optimize=True)
