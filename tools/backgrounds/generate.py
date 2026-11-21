"""Рисует узоры фона страниц (SVG) и их список frontend/src/book/backgrounds.json.

Узоры — наши рисунки (полоски, горошек, плитка, кружево), без чужих картинок.
Узор ложится на весь лист страницы вместе с вылетом (PageView, background-size:
cover), поэтому рисуем квадрат 206×206 «мм» — страница 200 мм + вылет 3 мм
с каждой стороны. В PDF остаётся вектором. Без фильтров (тени и блики —
полупрозрачными фигурами): так Chromium не растрирует узор при печати.

Запуск из корня репозитория:
    python3 tools/backgrounds/generate.py
"""
import json
import math
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "frontend", "public", "backgrounds")
CONFIG = os.path.join(ROOT, "frontend", "src", "book", "backgrounds.json")
S = 206  # лист с вылетом, «мм»

BACKGROUNDS = []


def add(bg_id, name, body):
    BACKGROUNDS.append((bg_id, name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" '
                                     f'preserveAspectRatio="xMidYMid slice">\n{body}\n</svg>\n'))


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


# Полоски: винно-красный фон, тонкая светлая полоса и тень рядом — как у
# полосатой бумаги (≈ 5 мм шаг).
lines = [f'<rect width="{S}" height="{S}" fill="#8b2c2a"/>']
x = 1.5
while x < S:
    lines.append(f'<rect x="{f(x)}" width=".8" height="{S}" fill="#f3e6dc" opacity=".85"/>')
    lines.append(f'<rect x="{f(x + .8)}" width=".6" height="{S}" fill="#5e1817" opacity=".55"/>')
    x += 5.1
add("stripes-wine", "Винные полоски", "\n".join(lines))

# Тонкая полоска на тёмном шоколаде — едва заметная, как у бумаги для писем.
lines = [f'<rect width="{S}" height="{S}" fill="#2b1614"/>']
x = 1.2
while x < S:
    lines.append(f'<rect x="{f(x)}" width=".35" height="{S}" fill="#4a2b27" opacity=".7"/>')
    x += 2.4
add("pinstripe-cocoa", "Шоколад в тонкую полоску", "\n".join(lines))

# Крупный горошек на шоколадной ткани.
lines = [f'<rect width="{S}" height="{S}" fill="#33201b"/>']
for row in range(-1, 6):
    for col in range(-1, 6):
        cx = col * 46 + (23 if row % 2 else 0) + 10
        cy = row * 44 + 16
        lines.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="10.5" fill="#e3cfae"/>')
        lines.append(f'<circle cx="{f(cx + 1.5)}" cy="{f(cy + 1.5)}" r="10.5" fill="#000" opacity=".12"/>')
add("dots-cocoa", "Крупный горошек", "\n".join(lines))

# Мелкий чёрный горошек на белом.
lines = [f'<rect width="{S}" height="{S}" fill="#ffffff"/>']
for row in range(0, 16):
    for col in range(0, 16):
        cx = col * 14 + (7 if row % 2 else 0) + 3
        cy = row * 13.5 + 4
        lines.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="2.6" fill="#141414"/>')
add("dots-white", "Мелкий горошек", "\n".join(lines))

# Глянцевая плитка: прямоугольники с бликом и светлыми швами.
lines = [
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#7b3a3d"/><stop offset=".45" stop-color="#4e2124"/>'
    '<stop offset="1" stop-color="#6a2f32"/></linearGradient></defs>',
    f'<rect width="{S}" height="{S}" fill="#b98880"/>',
]
tw, th, gap = 23, 32, 1.4
for row in range(-1, 8):
    for col in range(-1, 10):
        x0 = col * (tw + gap) - 6
        y0 = row * (th + gap) - 10
        lines.append(f'<rect x="{f(x0)}" y="{f(y0)}" width="{tw}" height="{th}" rx="1.6" fill="url(#g)"/>')
        # блик на глазури — косая светлая полоса
        lines.append(f'<path d="M{f(x0 + 3)} {f(y0 + th - 4)} Q {f(x0 + tw * .4)} {f(y0 + th * .35)} {f(x0 + tw - 4)} {f(y0 + 3)}" '
                     f'fill="none" stroke="#f2c9c4" stroke-width="1.6" stroke-linecap="round" opacity=".35"/>')
        lines.append(f'<rect x="{f(x0 + 1)}" y="{f(y0 + 1)}" width="{tw - 2}" height="2" rx="1" fill="#fff" opacity=".12"/>')
add("tiles-rose", "Глянцевая плитка", "\n".join(lines))


def lace_band(y_edge, down):
    """Полоса кружева: сплошная часть у края листа, фестоны и «цветочки» с дырочками."""
    out = []
    d = 1 if down else -1
    depth = 30  # высота кружева от края, «мм»
    base = y_edge + d * depth
    # сплошная часть
    top = min(y_edge, base)
    out.append(f'<rect x="0" y="{f(top)}" width="{S}" height="{depth}" fill="#f7f4ef"/>')
    # фестоны по нижнему краю кружева
    r = 8.6
    cx = 0
    while cx < S + r:
        out.append(f'<circle cx="{f(cx)}" cy="{f(base)}" r="{r}" fill="#f7f4ef"/>')
        out.append(f'<circle cx="{f(cx)}" cy="{f(base + d * 3)}" r="1.4" fill="#2b1614"/>')
        cx += 2 * r
    # ряд «цветочков» из дырочек и сетка точек
    cx = r
    while cx < S:
        cy = y_edge + d * (depth - 9)
        for k in range(6):
            a = math.radians(k * 60)
            out.append(f'<ellipse cx="{f(cx + math.cos(a) * 3.2)}" cy="{f(cy + math.sin(a) * 3.2)}" rx="1.5" ry="2.4" '
                       f'transform="rotate({k * 60 + 90} {f(cx + math.cos(a) * 3.2)} {f(cy + math.sin(a) * 3.2)})" fill="#2b1614"/>')
        out.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="1" fill="#2b1614"/>')
        cx += 2 * r
    for row in range(3):
        yy = y_edge + d * (6 + row * 3)
        xx = 2 + row * 1.5
        while xx < S:
            out.append(f'<circle cx="{f(xx)}" cy="{f(yy)}" r=".7" fill="#2b1614"/>')
            xx += 3
    return out


lines = [f'<rect width="{S}" height="{S}" fill="#2b1614"/>']
x = 1.2
while x < S:
    lines.append(f'<rect x="{f(x)}" width=".35" height="{S}" fill="#4a2b27" opacity=".7"/>')
    x += 2.4
lines += lace_band(0, True) + lace_band(S, False)
add("lace-cocoa", "Кружево на шоколаде", "\n".join(lines))


os.makedirs(OUT, exist_ok=True)
config = {"backgrounds": []}
for bg_id, name, content in BACKGROUNDS:
    with open(os.path.join(OUT, f"{bg_id}.svg"), "w", encoding="utf-8") as fh:
        fh.write(content)
    config["backgrounds"].append({"id": bg_id, "name": name, "file": f"{bg_id}.svg"})
with open(CONFIG, "w", encoding="utf-8") as fh:
    json.dump(config, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print(len(BACKGROUNDS), "backgrounds written")
