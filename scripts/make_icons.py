#!/usr/bin/env -S uv run --with pillow --with fonttools --with brotli --script
"""Generates the PWA app icons. Run once; re-run only if the look changes."""

import io
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG_TOP, BG_BOT = (244, 186, 92), (208, 128, 26)
# The first letter of မြန်မာ. Deliberately a bare consonant rather than a word:
# Pillow only does complex-script shaping when libraqm is present, and Burmese
# reorders its vowel signs, so anything with a medial or a vowel attached would
# render as loose pieces in the wrong order on a machine without it.
GLYPH = "မ"
WEB_FONT = ROOT / "web" / "fonts" / "NotoSansMyanmar-subset.woff2"


def font_file() -> io.BytesIO:
    """Pillow cannot open WOFF2, so decompress the font the app already ships
    back to a plain TTF in memory. Using that one rather than whatever Myanmar
    font happens to be installed keeps the icon identical on every machine, and
    identical to the script inside the app."""
    ttf = TTFont(WEB_FONT)
    ttf.flavor = None
    buf = io.BytesIO()
    ttf.save(buf)
    buf.seek(0)
    return buf


def font_at(size: int):
    return ImageFont.truetype(font_file(), size)


def draw_icon(size: int, *, shape: str) -> Image.Image:
    """shape: "rounded" (own corners), "square" (full-bleed), "maskable"
    (full-bleed, content kept inside the inner 80% safe zone)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Vertical gradient background.
    for y in range(size):
        t = y / max(1, size - 1)
        d.line(
            [(0, y), (size, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)) + (255,),
        )

    if shape == "rounded":
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255
        )
        img.putalpha(mask)

    scale = 0.50 if shape == "maskable" else 0.66
    f = font_at(int(size * scale))
    box = ImageDraw.Draw(img).textbbox((0, 0), GLYPH, font=f)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    ImageDraw.Draw(img).text((x, y), GLYPH, font=f, fill=(32, 22, 6, 255))
    return img


for size in (192, 512):
    draw_icon(size, shape="rounded").save(OUT / f"icon-{size}.png")

draw_icon(512, shape="maskable").save(OUT / "icon-maskable-512.png")

# iOS applies its own rounded mask to the home-screen icon and composites the
# result over black. A rounded icon with transparent corners therefore shows
# black wedges inside Apple's mask, so this one must be square and fully
# opaque -- RGB, no alpha channel at all.
draw_icon(180, shape="square").convert("RGB").save(OUT / "apple-touch-icon.png")

print(f"Wrote {len(list(OUT.glob('*.png')))} icons to {OUT.relative_to(ROOT)}")
