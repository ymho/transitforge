"""Regenerate the Managed Login wordmark using the app's bundled OFL font.

Run from the repository root with fontTools installed:
  python3 infra/terraform/environments/dev/branding/generate-wordmark.py
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

directory = Path(__file__).resolve().parent
root = directory.parents[4]
font = TTFont(root / "frontend/public/fonts/zen-kaku-gothic-kaiho-500.ttf")
glyphs = font.getGlyphSet()
mapping = font.getBestCmap()
units = font["head"].unitsPerEm
size = 56
small = size * .86
baseline = 54
padding = small * .12
x = 12
parts = []

def letters(text, scale, x, y, color):
    for letter in text:
        name = mapping[ord(letter)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale / units, 0, 0, -scale / units, x, y)))
        parts.append(f'<path fill="{color}" d="{pen.getCommands()}"/>')
        x += font["hmtx"][name][0] * scale / units
    return x

x = letters("K", size, x, baseline, "#68716e")
width = sum(font["hmtx"][mapping[ord(c)]][0] for c in "AI") * small / units + 2 * padding
height = size * .76
# Both the AI rectangle and the smaller glyphs share the surrounding capitals' center.
center = baseline - size * .35
parts.append(f'<rect x="{x}" y="{center - height / 2}" width="{width}" height="{height}" rx="3" fill="#68716e"/>')
letters("AI", small, x + padding, center + small * .35, "#ffffff")
x = letters("HO", size, x + width, baseline, "#68716e")
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x + 12} 68">' + "".join(parts) + "</svg>\n"
(directory / "kaiho-wordmark.svg").write_text(svg)
