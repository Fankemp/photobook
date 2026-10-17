"""Рисует начальный набор стикеров (SVG) и их список stickers.json.

Стикеры — наши собственные рисунки (никаких чужих лицензий). Стиль: плоские
формы с белой обводкой, как у наклейки: читаются и на фото, и на белом фоне.
Внутри SVG нет текста — на печати не зависим от шрифтов.

Запуск из корня репозитория:
    python3 tools/stickers/generate.py
Пишет frontend/public/stickers/<набор>/<имя>.svg и frontend/src/book/stickers.json.
Новый стикер можно и нарисовать отдельно: положить SVG и добавить строку в stickers.json.
"""
import json
import math
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "frontend", "public", "stickers")
CONFIG = os.path.join(ROOT, "frontend", "src", "book", "stickers.json")

RED, PINK, CORAL, YELLOW, ORANGE = "#e2525c", "#f49ab0", "#f47c5a", "#f6c344", "#f2a33a"
MINT, GREEN, SKY, NAVY, BROWN, CREAM = "#5bbfa0", "#4f9d69", "#5aa9e6", "#2d3a5a", "#8a5a3c", "#fff1d6"
OUTLINE = 8  # толщина белой обводки «наклейки»


def outline(shapes):
    """Белая подложка под всем рисунком: те же фигуры, белые и толще на OUTLINE."""
    out = []
    for s in shapes:
        if "opacity=" in s:  # блик внутри рисунка — подложка не нужна
            continue
        b = re.sub(r'fill="(?!none)[^"]*"', 'fill="#fff"', s)
        m = re.search(r'stroke-width="([\d.]+)"', b)
        if m:  # линия (верёвочка, стебель) — толще на обводку
            b = b.replace(m.group(0), f'stroke-width="{float(m.group(1)) + OUTLINE}"')
            b = re.sub(r'stroke="(?!none)[^"]*"', 'stroke="#fff"', b)
        else:
            b = b.replace("/>", f' stroke="#fff" stroke-width="{OUTLINE}" stroke-linejoin="round"/>', 1)
        out.append(b)
    return out


def svg(shapes, w=120, h=120, backing=True):
    body = (outline(shapes) if backing else []) + shapes
    inner = "\n  ".join(body)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n  {inner}\n</svg>\n'


HEART = "M60 104 C30 84 12 66 12 44 C12 27 24 15 39 15 C48 15 56 20 60 28 C64 20 72 15 81 15 C96 15 108 27 108 44 C108 66 90 84 60 104 Z"


def heart(fill, tx=0, ty=0, k=1.0):
    return f'<path transform="translate({tx} {ty}) scale({k})" d="{HEART}" fill="{fill}"/>'


def star_path(cx, cy, r_out, r_in, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 180 / n)
        pts.append(f"{cx + r * math.cos(a):.1f} {cy + r * math.sin(a):.1f}")
    return "M" + " L".join(pts) + " Z"


def sparkle(cx, cy, r):
    return (f"M{cx} {cy - r} Q{cx} {cy} {cx + r} {cy} Q{cx} {cy} {cx} {cy + r} "
            f"Q{cx} {cy} {cx - r} {cy} Q{cx} {cy} {cx} {cy - r} Z")


def leaf(x, y, length, width, angle, fill):
    return (f'<path transform="translate({x} {y}) rotate({angle})" '
            f'd="M0 0 Q{length / 2} {-width} {length} 0 Q{length / 2} {width} 0 0 Z" fill="{fill}"/>')


def balloon(cx, cy, rx, ry, fill, tie_to):
    kx, ky = cx, cy + ry
    tx, ty = tie_to
    return [
        f'<path d="M{kx} {ky + 4} C{kx - 6} {(ky + ty) / 2} {tx + 6} {(ky + ty) / 2} {tx} {ty}" fill="none" stroke="#9a9a9a" stroke-width="2.5"/>',
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}"/>',
        f'<path d="M{kx - 5} {ky + 5} L{kx + 5} {ky + 5} L{kx} {ky - 2} Z" fill="{fill}"/>',
        f'<ellipse cx="{cx - rx * 0.35}" cy="{cy - ry * 0.35}" rx="{rx * 0.18}" ry="{ry * 0.3}" transform="rotate(-25 {cx - rx * 0.35} {cy - ry * 0.35})" fill="#fff" opacity=".45"/>',
    ]


STICKERS = {}


def add(set_id, name, title, shapes=None, w=120, h=120, backing=True, raw=None):
    STICKERS.setdefault(set_id, []).append((name, title, raw or svg(shapes, w, h, backing), w / h))


# --- Любовь ---------------------------------------------------------------
add("love", "heart", "Сердце", [heart(RED), '<path d="M30 42 C30 33 36 27 44 27" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".5"/>'])
add("love", "hearts", "Два сердца", [heart(PINK, 2, 6, 0.66), heart(RED, 38, 36, 0.66)])
add("love", "letter", "Письмо", [
    '<rect x="14" y="30" width="92" height="64" rx="8" fill="#fbe7d8"/>',
    '<path d="M14 36 L60 70 L106 36" fill="none" stroke="#e2bfa4" stroke-width="4" stroke-linejoin="round"/>',
    heart(RED, 44, 50, 0.27),
])

# --- Праздник -------------------------------------------------------------
add("party", "balloon", "Шарик", balloon(60, 46, 30, 36, RED, (56, 114)))
add("party", "balloons", "Шарики",
    balloon(60, 32, 20, 25, YELLOW, (60, 112)) + balloon(36, 50, 20, 25, RED, (60, 112)) + balloon(84, 50, 20, 25, SKY, (60, 112)))
add("party", "gift", "Подарок", [
    '<rect x="22" y="54" width="76" height="52" rx="6" fill="#5bbfa0"/>',
    '<rect x="16" y="40" width="88" height="18" rx="5" fill="#4aa98b"/>',
    '<rect x="54" y="40" width="12" height="66" fill="#e2525c"/>',
    '<path d="M60 40 C44 18 26 26 40 40 Z" fill="#e2525c"/>',
    '<path d="M60 40 C76 18 94 26 80 40 Z" fill="#e2525c"/>',
    '<circle cx="60" cy="40" r="6" fill="#c63f49"/>',
])
flames = [f'<path d="M{cx} 14 C{cx + 5.5} 21 {cx + 4.5} 27 {cx} 28 C{cx - 4.5} 27 {cx - 5.5} 21 {cx} 14 Z" fill="{YELLOW}"/>'
          for cx in (46.5, 60.5, 74.5)]  # над серединами свечей
add("party", "cake", "Торт", [
    '<ellipse cx="60" cy="102" rx="46" ry="7" fill="#e9e2d6"/>',
    '<rect x="20" y="66" width="80" height="34" rx="6" fill="#f49ab0"/>',
    '<path d="M20 72 C26 80 32 80 38 72 C44 80 50 80 56 72 C62 80 68 80 74 72 C80 80 86 80 92 72 L100 72 L100 70 Q100 66 94 66 L26 66 Q20 66 20 70 Z" fill="#fff"/>',
    '<rect x="32" y="44" width="56" height="24" rx="5" fill="#fff1d6"/>',
    '<rect x="44" y="28" width="5" height="17" rx="2" fill="#5aa9e6"/>',
    '<rect x="58" y="28" width="5" height="17" rx="2" fill="#f2a33a"/>',
    '<rect x="72" y="28" width="5" height="17" rx="2" fill="#e2525c"/>',
] + flames)
add("party", "star", "Звезда", [f'<path d="{star_path(60, 62, 50, 21)}" fill="{YELLOW}"/>',
                                '<path d="M55 41 L58.5 27" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>'])
conf = []
for i, (x, y, kind, color, rot) in enumerate([
        (18, 22, "rect", RED, 20), (52, 14, "circle", YELLOW, 0), (88, 24, "tri", SKY, 15), (100, 58, "rect", MINT, -30),
        (70, 50, "circle", PINK, 0), (30, 58, "tri", ORANGE, -20), (14, 96, "circle", SKY, 0), (48, 92, "rect", YELLOW, 40),
        (84, 98, "tri", RED, 0), (62, 74, "rect", NAVY, -10), (106, 104, "circle", YELLOW, 0), (36, 32, "squiggle", MINT, 0)]):
    if kind == "rect":
        conf.append(f'<rect x="{x - 6}" y="{y - 3}" width="12" height="6" rx="1.5" transform="rotate({rot} {x} {y})" fill="{color}"/>')
    elif kind == "circle":
        conf.append(f'<circle cx="{x}" cy="{y}" r="5" fill="{color}"/>')
    elif kind == "tri":
        conf.append(f'<path d="M{x} {y - 6} L{x + 6} {y + 5} L{x - 6} {y + 5} Z" transform="rotate({rot} {x} {y})" fill="{color}"/>')
    else:
        conf.append(f'<path d="M{x - 10} {y} q5 -6 10 0 t10 0" fill="none" stroke="{color}" stroke-width="4" stroke-linecap="round"/>')
add("party", "confetti", "Конфетти", conf, backing=False)

# --- Путешествие ----------------------------------------------------------
windows = [f'<circle cx="{x}" cy="61" r="2.4" fill="#fff"/>' for x in range(46, 92, 8)]
add("travel", "plane", "Самолёт", [
    '<path d="M24 56 L14 36 L26 36 L40 56 Z" fill="#2d3a5a"/>',
    '<path d="M18 55 L94 55 C106 55 110 62 110 62 C110 62 106 69 94 69 L18 69 C12 69 12 55 18 55 Z" fill="#5aa9e6"/>',
    '<path d="M54 64 L36 94 L50 94 L74 64 Z" fill="#2d3a5a"/>',
    '<path d="M98 57 C104 58 107 61 108 62 L98 62 Z" fill="#2d3a5a"/>',
] + windows)
rays = [f'<path d="M{60 + 33 * math.cos(math.radians(a)):.1f} {60 + 33 * math.sin(math.radians(a)):.1f} '
        f'L{60 + 47 * math.cos(math.radians(a)):.1f} {60 + 47 * math.sin(math.radians(a)):.1f}" '
        f'fill="none" stroke="{ORANGE}" stroke-width="7" stroke-linecap="round"/>' for a in range(0, 360, 30)]
add("travel", "sun", "Солнце", rays + [f'<circle cx="60" cy="60" r="25" fill="{YELLOW}"/>',
                                        '<path d="M48 52 Q52 46 58 45" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>'])
add("travel", "palm", "Пальма", [
    '<ellipse cx="62" cy="108" rx="34" ry="7" fill="#f2d38b"/>',
    '<path d="M62 108 C58 90 66 70 58 46" fill="none" stroke="#8a5a3c" stroke-width="9" stroke-linecap="round"/>',
    leaf(58, 44, 46, 13, -165, GREEN), leaf(58, 44, 46, 13, -15, GREEN), leaf(58, 44, 40, 12, -120, MINT),
    leaf(58, 44, 40, 12, -60, MINT), leaf(58, 44, 36, 11, -90, GREEN),
    '<circle cx="54" cy="50" r="5" fill="#8a5a3c"/>', '<circle cx="63" cy="52" r="5" fill="#7a4d32"/>',
])
add("travel", "pin", "Метка на карте", [
    '<path d="M60 110 C60 110 24 74 24 46 C24 26 40 10 60 10 C80 10 96 26 96 46 C96 74 60 110 60 110 Z" fill="#e2525c"/>',
    '<circle cx="60" cy="46" r="14" fill="#fff"/>',
])
add("travel", "camera", "Фотоаппарат", [
    '<rect x="34" y="26" width="28" height="16" rx="4" fill="#2d3a5a"/>',
    '<rect x="14" y="36" width="92" height="62" rx="12" fill="#2d3a5a"/>',
    '<circle cx="60" cy="67" r="23" fill="#e9eef5"/>', '<circle cx="60" cy="67" r="15" fill="#5aa9e6"/>',
    '<circle cx="54" cy="61" r="4.5" fill="#fff"/>', '<rect x="84" y="44" width="13" height="8" rx="2" fill="#f6c344"/>',
])
add("travel", "suitcase", "Чемодан", [
    '<path d="M44 34 L44 24 Q44 17 51 17 L69 17 Q76 17 76 24 L76 34" fill="none" stroke="#8a5a3c" stroke-width="7" stroke-linecap="round"/>',
    '<rect x="16" y="32" width="88" height="74" rx="11" fill="#f47c5a"/>',
    '<rect x="36" y="32" width="7" height="74" fill="#d9603f"/>', '<rect x="77" y="32" width="7" height="74" fill="#d9603f"/>',
    '<circle cx="60" cy="62" r="9" fill="#fff1d6"/>',
])

# --- Природа --------------------------------------------------------------
sprig = ['<path d="M28 108 C48 84 70 52 94 14" fill="none" stroke="#4f9d69" stroke-width="4" stroke-linecap="round"/>']
for i, (x, y) in enumerate([(38, 95), (50, 80), (61, 64), (72, 48), (83, 32)]):
    sprig.append(leaf(x, y, 30, 9, -100 if i % 2 == 0 else -10, MINT if i % 2 else GREEN))
add("nature", "leaves", "Веточка", sprig)
petals = [f'<ellipse cx="60" cy="33" rx="10" ry="22" transform="rotate({a} 60 60)" fill="#fffaf0"/>' for a in range(0, 360, 36)]
add("nature", "daisy", "Ромашка", petals + [
    '<g fill="none" stroke="#e7d6b8" stroke-width="1.5">' +
    "".join(f'<ellipse cx="60" cy="33" rx="10" ry="22" transform="rotate({a} 60 60)"/>' for a in range(0, 360, 36)) + '</g>',
    '<circle cx="60" cy="60" r="15" fill="#f6c344"/>', '<circle cx="60" cy="60" r="15" fill="none" stroke="#e0a92e" stroke-width="3"/>',
])
add("nature", "sparkles", "Блёстки", [f'<path d="{sparkle(48, 58, 34)}" fill="{YELLOW}"/>',
                                      f'<path d="{sparkle(92, 26, 16)}" fill="{YELLOW}"/>',
                                      f'<path d="{sparkle(94, 92, 12)}" fill="{ORANGE}"/>'])
add("nature", "banner", "Лента", [
    '<path d="M12 50 L50 50 L50 94 L12 94 L24 72 Z" fill="#d9603f"/>',
    '<path d="M228 50 L190 50 L190 94 L228 94 L216 72 Z" fill="#d9603f"/>',
    '<rect x="38" y="30" width="164" height="50" rx="4" fill="#f47c5a"/>',
    '<path d="M38 80 L50 94 L50 80 Z" fill="#a8452c"/>', '<path d="M202 80 L190 94 L190 80 Z" fill="#a8452c"/>',
], w=240, h=120)

SET_NAMES = {"love": "Любовь", "party": "Праздник", "travel": "Путешествие", "nature": "Природа"}

config = {"sets": []}
for set_id, items in STICKERS.items():
    os.makedirs(os.path.join(OUT, set_id), exist_ok=True)
    entries = []
    for name, title, content, aspect in items:
        path = os.path.join(OUT, set_id, f"{name}.svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        entries.append({"id": f"{set_id}-{name}", "name": title, "file": f"{set_id}/{name}.svg", "aspect": round(aspect, 4)})
    config["sets"].append({"id": set_id, "name": SET_NAMES[set_id], "stickers": entries})

with open(CONFIG, "w", encoding="utf-8") as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(sum(len(s["stickers"]) for s in config["sets"]), "stickers written")
