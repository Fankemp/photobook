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

# ===================== Второй выпуск (2026-10-18) =====================
# Новые стикеры только добавляются: старые id и рисунки не меняются —
# на них ссылаются книги.

# --- Любовь ---
add("love", "rose", "Роза", [
    '<path d="M60 112 C 58 92 62 80 60 64" fill="none" stroke="#4f9d69" stroke-width="6" stroke-linecap="round"/>',
    leaf(60, 96, 30, 9, -150, GREEN), leaf(60, 86, 28, 9, -30, MINT),
    '<circle cx="60" cy="40" r="30" fill="#d93a4f"/>',
    '<path d="M60 20 C 76 22 82 40 70 49 C 61 56 48 49 50 40 C 52 32 62 32 63 39" fill="none" stroke="#a51f31" stroke-width="4" stroke-linecap="round"/>',
    '<path d="M36 34 C 34 52 46 66 62 66 C 74 66 84 58 86 46" fill="none" stroke="#a51f31" stroke-width="4" stroke-linecap="round"/>',
])
add("love", "lips", "Поцелуй", [
    '<path d="M12 58 C 28 34 46 32 60 46 C 74 32 92 34 108 58 C 90 66 76 68 60 68 C 44 68 30 66 12 58 Z" fill="#d93a4f"/>',
    '<path d="M12 58 C 30 94 90 94 108 58 C 90 66 76 68 60 68 C 44 68 30 66 12 58 Z" fill="#e2525c"/>',
    '<path d="M20 60 C 40 64 80 64 100 60" fill="none" stroke="#a51f31" stroke-width="3" stroke-linecap="round"/>',
    '<ellipse cx="74" cy="80" rx="10" ry="4" fill="#fff" opacity=".45"/>',
])
add("love", "heart-arrow", "Сердце со стрелой", [
    '<path d="M14 90 L 106 32" fill="none" stroke="#8a5a3c" stroke-width="5" stroke-linecap="round"/>',
    '<path d="M114 26 L 107 37.5 L 100.6 27.3 Z" fill="#8a5a3c"/>',
    '<path d="M8 86 L 20 84 L 16 96 Z" fill="#f49ab0"/>',
    heart(RED, 23, 23, 0.62),
])
add("love", "coffee", "Кофе", [
    '<path d="M86 64 C 106 62 106 90 84 92" fill="none" stroke="#5bbfa0" stroke-width="8" stroke-linecap="round"/>',
    '<path d="M24 54 L 88 54 L 82 104 Q 80 110 74 110 L 38 110 Q 32 110 30 104 Z" fill="#5bbfa0"/>',
    '<ellipse cx="56" cy="55" rx="32" ry="7" fill="#7a4a2e"/>',
    heart("#f49ab0", 44, 8, 0.25),
])

# --- Праздник ---
add("party", "hat", "Колпак", [
    '<path d="M60 14 L 96 104 Q 60 116 24 104 Z" fill="#5aa9e6"/>',
    '<path d="M45 52 Q 60 58 75 52 L 80 64 Q 60 72 40 64 Z" fill="#f6c344"/>',
    '<path d="M34 80 Q 60 90 86 80 L 91 92 Q 60 104 29 92 Z" fill="#f6c344"/>',
    '<circle cx="60" cy="14" r="10" fill="#e2525c"/>',
])
add("party", "crown", "Корона", [
    '<path d="M16 92 L 12 36 L 38 60 L 60 22 L 82 60 L 108 36 L 104 92 Z" fill="#f6c344"/>',
    '<rect x="14" y="88" width="92" height="16" rx="4" fill="#f2a33a"/>',
    '<circle cx="12" cy="34" r="7" fill="#e2525c"/>', '<circle cx="60" cy="20" r="8" fill="#5aa9e6"/>', '<circle cx="108" cy="34" r="7" fill="#e2525c"/>',
    '<circle cx="40" cy="96" r="4" fill="#ffffff"/>', '<circle cx="60" cy="96" r="4" fill="#ffffff"/>', '<circle cx="80" cy="96" r="4" fill="#ffffff"/>',
])
burst = []
for cx, cy, r, color, n in [(48, 48, 36, RED, 12), (88, 82, 24, YELLOW, 10)]:
    for i in range(n):
        a = 2 * math.pi * i / n
        x1, y1 = cx + r * 0.38 * math.cos(a), cy + r * 0.38 * math.sin(a)
        x2, y2 = cx + r * math.cos(a), cy + r * math.sin(a)
        burst.append(f'<path d="M{x1:.1f} {y1:.1f} L {x2:.1f} {y2:.1f}" fill="none" stroke="{color}" stroke-width="4" stroke-linecap="round"/>')
burst.append(f'<path d="{sparkle(22, 96, 10)}" fill="{SKY}"/>')
add("party", "fireworks", "Салют", burst)
flags = ['<path d="M6 18 Q 120 70 234 18" fill="none" stroke="#8a5a3c" stroke-width="3"/>']
for i, c in enumerate([RED, YELLOW, SKY, MINT, PINK, ORANGE, RED]):
    t = (i + 0.5) / 7
    x = 6 + 228 * t
    y = 18 * (1 - t) ** 2 + 140 * t * (1 - t) + 18 * t ** 2
    flags.append(f'<path d="M{x - 13:.1f} {y - 2:.1f} L {x + 13:.1f} {y - 2:.1f} L {x:.1f} {y + 30:.1f} Z" fill="{c}"/>')
add("party", "garland", "Флажки", flags, w=240, h=100)


def flute(cx, angle):
    """Бокал шампанского; angle — наклон вокруг основания."""
    parts = [
        f'<path d="M{cx - 12} 16 L {cx + 12} 16 L {cx + 9} 58 Q {cx} 68 {cx - 9} 58 Z" fill="#dbe7f3"/>',
        f'<path d="M{cx - 11} 30 L {cx + 11} 30 L {cx + 9} 58 Q {cx} 68 {cx - 9} 58 Z" fill="#f6c344"/>',
        f'<path d="M{cx} 64 L {cx} 98" fill="none" stroke="#b9c7d8" stroke-width="4"/>',
        f'<ellipse cx="{cx}" cy="100" rx="14" ry="4" fill="#b9c7d8"/>',
    ]
    return [p.replace("/>", f' transform="rotate({angle} {cx} 100)"/>', 1) for p in parts]


add("party", "cheers", "Бокалы", flute(44, 12) + flute(76, -12) + [f'<path d="{sparkle(60, 12, 10)}" fill="{YELLOW}"/>'])

# --- Путешествие ---
add("travel", "tent", "Палатка", [
    '<rect x="6" y="98" width="108" height="6" rx="3" fill="#4f9d69"/>',
    '<path d="M60 18 L 108 100 L 12 100 Z" fill="#f2a33a"/>',
    '<path d="M60 18 L 84 100 L 36 100 Z" fill="#f47c5a"/>',
    '<path d="M60 52 L 74 100 L 46 100 Z" fill="#2d3a5a"/>',
    '<path d="M60 18 L 60 6" fill="none" stroke="#8a5a3c" stroke-width="4" stroke-linecap="round"/>',
    '<path d="M60 6 L 74 10 L 60 15 Z" fill="#e2525c"/>',
])
add("travel", "compass", "Компас", [
    '<circle cx="60" cy="12" r="7" fill="none" stroke="#2d3a5a" stroke-width="4"/>',
    '<circle cx="60" cy="64" r="48" fill="#2d3a5a"/>',
    '<circle cx="60" cy="64" r="38" fill="#fff1d6"/>',
    '<path d="M60 30 L 68 64 L 60 98 L 52 64 Z" fill="#b9c7d8"/>',
    '<path d="M60 30 L 68 64 L 52 64 Z" fill="#e2525c"/>',
    '<circle cx="60" cy="64" r="5" fill="#2d3a5a"/>',
    '<circle cx="30" cy="64" r="3" fill="#2d3a5a"/>', '<circle cx="90" cy="64" r="3" fill="#2d3a5a"/>',
])
add("travel", "car", "Машина", [
    '<path d="M14 70 L 14 56 Q 16 48 26 46 L 46 44 L 62 26 Q 66 22 74 22 L 108 22 Q 116 22 120 28 L 132 44 L 142 46 Q 150 48 150 58 L 150 70 Q 150 76 144 76 L 20 76 Q 14 76 14 70 Z" fill="#5aa9e6"/>',
    '<path d="M68 30 L 92 30 L 92 44 L 56 44 Z" fill="#dff1fb"/>',
    '<path d="M98 30 L 114 30 Q 118 30 120 34 L 126 44 L 98 44 Z" fill="#dff1fb"/>',
    '<rect x="20" y="58" width="124" height="4" fill="#ffffff" opacity=".5"/>',
    '<rect x="140" y="52" width="10" height="6" rx="2" fill="#f6c344"/>',
    '<circle cx="46" cy="78" r="15" fill="#2d3a5a"/>', '<circle cx="46" cy="78" r="6" fill="#cfd8e3"/>',
    '<circle cx="120" cy="78" r="15" fill="#2d3a5a"/>', '<circle cx="120" cy="78" r="6" fill="#cfd8e3"/>',
], w=164, h=100)
add("travel", "air-balloon", "Воздушный шар", [
    '<path d="M53 88 L 50 100 M 67 88 L 70 100" fill="none" stroke="#8a5a3c" stroke-width="3"/>',
    '<path d="M60 8 C 98 8 108 40 96 62 C 88 76 72 82 68 88 L 52 88 C 48 82 32 76 24 62 C 12 40 22 8 60 8 Z" fill="#e2525c"/>',
    '<path d="M60 8 C 74 8 80 40 72 62 C 70 74 68 80 66 88 L 54 88 C 52 80 50 74 48 62 C 40 40 46 8 60 8 Z" fill="#f6c344"/>',
    '<rect x="46" y="98" width="28" height="16" rx="3" fill="#8a5a3c"/>',
])
add("travel", "ticket", "Билет", [
    '<path d="M10 20 L 190 20 L 190 42 A 8 8 0 0 0 190 58 L 190 80 L 10 80 L 10 58 A 8 8 0 0 0 10 42 Z" fill="#fff1d6"/>',
    '<path d="M140 24 L 140 76" fill="none" stroke="#e2bfa4" stroke-width="3" stroke-dasharray="5 5"/>',
    '<rect x="34" y="46" width="64" height="9" rx="4.5" fill="#2d3a5a"/>',
    '<path d="M58 50 L 50 70 L 60 70 L 74 50 Z" fill="#2d3a5a"/>',
    '<path d="M58 50 L 52 32 L 60 32 L 72 50 Z" fill="#2d3a5a"/>',
    '<path d="M38 50 L 32 40 L 38 40 L 46 50 Z" fill="#2d3a5a"/>',
    '<rect x="150" y="34" width="28" height="6" rx="3" fill="#e2525c"/>',
    '<rect x="150" y="47" width="22" height="6" rx="3" fill="#cfd8e3"/>',
    '<rect x="150" y="60" width="26" height="6" rx="3" fill="#cfd8e3"/>',
], w=200, h=100)

# --- Природа ---
arcs = [f'<path d="M{100 - r} 96 A {r} {r} 0 0 1 {100 + r} 96" fill="none" stroke="{c}" stroke-width="12"/>'
        for r, c in [(84, RED), (72, ORANGE), (60, YELLOW), (48, MINT), (36, SKY)]]
arcs += ['<ellipse cx="20" cy="94" rx="18" ry="12" fill="#e9f1fa"/>', '<ellipse cx="34" cy="98" rx="16" ry="9" fill="#e9f1fa"/>',
         '<ellipse cx="180" cy="94" rx="18" ry="12" fill="#e9f1fa"/>', '<ellipse cx="166" cy="98" rx="16" ry="9" fill="#e9f1fa"/>']
add("nature", "rainbow", "Радуга", arcs, w=200, h=110)
add("nature", "cloud", "Облако", [
    '<circle cx="44" cy="62" r="24" fill="#cfe1f5"/>', '<circle cx="72" cy="52" r="30" fill="#cfe1f5"/>',
    '<circle cx="96" cy="68" r="18" fill="#cfe1f5"/>', '<rect x="22" y="64" width="86" height="24" rx="12" fill="#cfe1f5"/>',
    '<path d="M30 80 L 100 80" fill="none" stroke="#a9c4e4" stroke-width="5" stroke-linecap="round"/>',
])
add("nature", "butterfly", "Бабочка", [
    '<ellipse cx="38" cy="44" rx="28" ry="24" transform="rotate(-20 38 44)" fill="#f49ab0"/>',
    '<ellipse cx="82" cy="44" rx="28" ry="24" transform="rotate(20 82 44)" fill="#f49ab0"/>',
    '<ellipse cx="42" cy="80" rx="20" ry="16" transform="rotate(20 42 80)" fill="#f2a33a"/>',
    '<ellipse cx="78" cy="80" rx="20" ry="16" transform="rotate(-20 78 80)" fill="#f2a33a"/>',
    '<circle cx="36" cy="42" r="8" fill="#ffffff" opacity=".6"/>', '<circle cx="84" cy="42" r="8" fill="#ffffff" opacity=".6"/>',
    '<path d="M58 36 C 54 24 48 20 42 16 M 62 36 C 66 24 72 20 78 16" fill="none" stroke="#2d3a5a" stroke-width="3" stroke-linecap="round"/>',
    '<rect x="55" y="34" width="10" height="60" rx="5" fill="#2d3a5a"/>',
])
add("nature", "moon", "Луна", [
    '<path d="M74 14 A 46 46 0 1 0 108 84 A 36 36 0 0 1 74 14 Z" fill="#f6c344"/>',
    f'<path d="{star_path(32, 28, 12, 5)}" fill="{YELLOW}"/>',
    f'<path d="{star_path(100, 30, 8, 3.5)}" fill="{YELLOW}"/>',
])
flake = [f'<path d="M60 60 L 60 14 M 60 30 L 50 20 M 60 30 L 70 20 M 60 44 L 52 36 M 60 44 L 68 36" fill="none" stroke="{SKY}" stroke-width="6" stroke-linecap="round" transform="rotate({k * 60} 60 60)"/>'
         for k in range(6)]
add("nature", "snowflake", "Снежинка", flake + ['<circle cx="60" cy="60" r="8" fill="#5aa9e6"/>'])
maple = []
for i in range(60):
    th = -math.pi / 2 + 2 * math.pi * i / 60
    r = 46 * (0.55 + 0.45 * abs(math.cos(2.5 * (th + math.pi / 2)))) * (0.45 if math.sin(th) > 0.9 else 1)
    maple.append((60 + r * math.cos(th), 58 + r * math.sin(th)))
add("nature", "maple", "Кленовый лист", [
    '<path d="M60 92 L 60 116" fill="none" stroke="#a34b22" stroke-width="5" stroke-linecap="round"/>',
    '<path d="M' + " L ".join(f"{x:.1f} {y:.1f}" for x, y in maple) + ' Z" fill="#e8743b"/>',
    '<path d="M60 96 L 60 22 M 60 62 L 26 40 M 60 62 L 94 40 M 60 76 L 32 74 M 60 76 L 88 74" fill="none" stroke="#c4552a" stroke-width="2.5" stroke-linecap="round"/>',
])

# --- Малыш ---
add("baby", "bottle", "Бутылочка", [
    '<path d="M52 8 Q 60 2 68 8 L 70 22 L 50 22 Z" fill="#f49ab0"/>',
    '<rect x="40" y="20" width="40" height="12" rx="4" fill="#5aa9e6"/>',
    '<rect x="36" y="30" width="48" height="80" rx="16" fill="#e3f1fb"/>',
    '<path d="M36 64 L 84 64 L 84 94 Q 84 110 68 110 L 52 110 Q 36 110 36 94 Z" fill="#fffaf0"/>',
    '<rect x="64" y="42" width="14" height="3" rx="1.5" fill="#5aa9e6"/>', '<rect x="68" y="52" width="10" height="3" rx="1.5" fill="#5aa9e6"/>',
    '<rect x="64" y="62" width="14" height="3" rx="1.5" fill="#5aa9e6"/>',
])
add("baby", "pacifier", "Соска", [
    '<circle cx="60" cy="26" r="16" fill="none" stroke="#5bbfa0" stroke-width="7"/>',
    '<ellipse cx="60" cy="96" rx="14" ry="18" fill="#f6c344"/>',
    '<ellipse cx="60" cy="64" rx="44" ry="22" fill="#5bbfa0"/>',
    '<circle cx="60" cy="64" r="12" fill="#ffffff"/>',
])
add("baby", "rattle", "Погремушка", [
    '<path d="M70 70 L 102 102" fill="none" stroke="#f2a33a" stroke-width="12" stroke-linecap="round"/>',
    '<circle cx="104" cy="104" r="10" fill="#f2a33a"/>',
    '<circle cx="50" cy="50" r="36" fill="#e2525c"/>',
    '<circle cx="50" cy="50" r="24" fill="#f6c344"/>',
    '<circle cx="50" cy="50" r="9" fill="#e2525c"/>',
])


def foot(cx, cy, mirror):
    """След ножки: подошва и пять пальчиков (mirror — левая)."""
    k = -1 if mirror else 1
    out = [f'<ellipse cx="{cx}" cy="{cy}" rx="14" ry="22" fill="#f49ab0"/>']
    for dx, dy, r in [(-8, -29, 5.5), (0, -32, 4.5), (7, -31, 4), (12, -27, 3.5), (16, -22, 3)]:
        out.append(f'<circle cx="{cx + k * dx}" cy="{cy + dy}" r="{r}" fill="#f49ab0"/>')
    return out


add("baby", "footprints", "Следы", foot(40, 80, True) + foot(80, 62, False))
add("baby", "duck", "Уточка", [
    '<path d="M18 74 Q 18 104 54 106 L 84 106 Q 108 104 108 80 Q 108 70 98 72 Q 86 76 72 74 Q 60 72 52 66 Z" fill="#f6c344"/>',
    '<circle cx="48" cy="44" r="24" fill="#f6c344"/>',
    '<path d="M24 46 Q 10 48 8 54 Q 16 60 28 55 Z" fill="#f2a33a"/>',
    '<circle cx="42" cy="38" r="4" fill="#2d3a5a"/>',
    '<path d="M64 86 Q 80 76 94 88" fill="none" stroke="#f2a33a" stroke-width="4" stroke-linecap="round"/>',
])
add("baby", "onesie", "Боди", [
    '<path d="M38 14 Q 60 30 82 14 L 104 26 L 96 50 L 84 46 L 84 92 Q 84 100 76 102 L 70 112 L 50 112 L 44 102 Q 36 100 36 92 L 36 46 L 24 50 L 16 26 Z" fill="#9fd4f2"/>',
    heart(RED, 42, 50, 0.3),
    '<circle cx="54" cy="106" r="2.5" fill="#ffffff"/>', '<circle cx="60" cy="106" r="2.5" fill="#ffffff"/>', '<circle cx="66" cy="106" r="2.5" fill="#ffffff"/>',
])

# --- Алматы ---
add("almaty", "apple", "Яблоко", [
    '<path d="M60 34 Q 60 18 70 8" fill="none" stroke="#6b4a32" stroke-width="5" stroke-linecap="round"/>',
    '<path d="M60 34 C 40 20 12 30 14 62 C 16 96 40 112 60 102 C 80 112 104 96 106 62 C 108 30 80 20 60 34 Z" fill="#d93a3f"/>',
    leaf(64, 22, 34, 11, -30, GREEN),
    '<ellipse cx="36" cy="56" rx="8" ry="14" transform="rotate(20 36 56)" fill="#ffffff" opacity=".4"/>',
])
add("almaty", "yurt", "Юрта", [
    '<path d="M12 64 Q 60 8 108 64 Z" fill="#f5efe6"/>',
    '<rect x="14" y="62" width="92" height="44" fill="#f5efe6"/>',
    '<path d="M20 74 L 40 102 M 40 74 L 20 102 M 80 74 L 100 102 M 100 74 L 80 102" fill="none" stroke="#d9c7ae" stroke-width="2.5"/>',
    '<rect x="14" y="60" width="92" height="8" fill="#c8283c"/>',
    '<path d="M28 50 Q 60 26 92 50" fill="none" stroke="#c8283c" stroke-width="5"/>',
    '<ellipse cx="60" cy="36" rx="12" ry="4" fill="#8a5a3c"/>',
    '<path d="M48 106 L 48 80 Q 60 72 72 80 L 72 106 Z" fill="#8a5a3c"/>',
])
dombra = [
    '<rect x="56" y="6" width="8" height="58" rx="3" fill="#8a5a3c"/>',
    '<path d="M60 54 C 84 56 88 96 78 108 Q 60 118 42 108 C 32 96 36 56 60 54 Z" fill="#c07a40"/>',
    '<circle cx="54" cy="84" r="3" fill="#6b4a32"/>', '<circle cx="66" cy="84" r="3" fill="#6b4a32"/>', '<circle cx="60" cy="92" r="3" fill="#6b4a32"/>',
    '<rect x="50" y="102" width="20" height="4" rx="2" fill="#6b4a32"/>',
    '<path d="M58 8 L 58 104 M 62 8 L 62 104" fill="none" stroke="#f5efe6" stroke-width="1.5"/>',
]
add("almaty", "dombra", "Домбра", [d.replace("/>", ' transform="rotate(-35 60 60)"/>', 1) for d in dombra])
curl = "M60 60 C 60 40 44 26 30 32 C 18 38 22 54 34 52 C 42 51 42 42 36 42"
ornament = [f'<path d="{curl}" fill="none" stroke="#c8283c" stroke-width="7" stroke-linecap="round" transform="rotate({a} 60 60)"/>' for a in (0, 90, 180, 270)]
ornament.append('<path d="M60 48 L 72 60 L 60 72 L 48 60 Z" fill="#f6c344"/>')
add("almaty", "ornament", "Орнамент «Қошқар мүйіз»", ornament)
add("almaty", "peaks", "Горы", [
    '<circle cx="60" cy="60" r="50" fill="#2d3a5a"/>',
    '<circle cx="84" cy="36" r="8" fill="#f6c344"/>',
    '<path d="M18 82 L 44 50 L 56 64 L 74 38 L 102 82 Z" fill="#9fb7d9"/>',
    '<path d="M74 38 L 82 50 L 76 48 L 71 53 L 66 50 Z" fill="#ffffff"/>',
    '<path d="M44 50 L 50 57 L 45 56 L 40 59 L 38 57 Z" fill="#ffffff"/>',
])
add("almaty", "tulip", "Тюльпан", [
    '<path d="M60 112 C 58 92 62 76 60 60" fill="none" stroke="#4f9d69" stroke-width="6" stroke-linecap="round"/>',
    '<path d="M60 106 C 30 98 20 72 30 58 C 44 76 52 90 60 106 Z" fill="#5f9b6e"/>',
    '<path d="M60 106 C 90 98 100 72 90 58 C 76 76 68 90 60 106 Z" fill="#4f8a57"/>',
    '<path d="M38 24 Q 36 56 60 62 Q 84 56 82 24 Q 72 34 66 20 Q 60 32 54 20 Q 48 34 38 24 Z" fill="#d93a3f"/>',
    '<path d="M46 52 Q 60 64 74 52 Q 66 60 60 60 Q 54 60 46 52 Z" fill="#f6c344"/>',
])

# --- Декор: washi-скотч, уголок, кнопка, скрепка, рисунки от руки ---


def tape_svg(color, kind):
    """Полоска washi-скотча с рваными краями, чуть прозрачная, как настоящая."""
    w, h = 200, 56
    right = " ".join(f"L {w - (4 if i % 2 else 0)} {i * 7}" for i in range(1, 9))
    left = " ".join(f"L {4 if i % 2 else 0} {h - i * 7}" for i in range(1, 9))
    d = f"M 0 0 L {w} 0 {right} L 0 {h} {left} Z"
    pattern = ""
    if kind == "stripes":
        pattern = "".join(f'<path d="M{x} -10 L {x + 40} {h + 10}" stroke="#ffffff" stroke-width="7" opacity=".5"/>' for x in range(-40, w + 40, 18))
    elif kind == "dots":
        pattern = "".join(f'<circle cx="{x + (10 if row % 2 else 0)}" cy="{10 + row * 12}" r="3.5" fill="#ffffff" opacity=".75"/>'
                          for row in range(4) for x in range(8, w, 20))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">\n'
            f'  <defs><clipPath id="t"><path d="{d}"/></clipPath></defs>\n'
            f'  <g opacity=".9"><path d="{d}" fill="{color}"/><g clip-path="url(#t)">{pattern}</g></g>\n</svg>\n')


for name, title, color, kind in [("tape-pink", "Скотч розовый", "#f4a6b8", "dots"), ("tape-mint", "Скотч мятный", "#8fd3bf", "stripes"),
                                 ("tape-yellow", "Скотч жёлтый", "#f6d36b", ""), ("tape-blue", "Скотч голубой", "#9cc7ec", "stripes")]:
    add("decor", name, title, raw=tape_svg(color, kind), w=200, h=56)
add("decor", "corner", "Фотоуголок", [
    '<path d="M8 8 L 112 8 L 8 112 Z" fill="#2d3a5a"/>',
    '<path d="M22 22 L 76 22 L 22 76 Z" fill="#3c4b70"/>',
])
add("decor", "pushpin", "Кнопка", [
    '<path d="M60 74 L 60 112" fill="none" stroke="#9aa3b5" stroke-width="5" stroke-linecap="round"/>',
    '<ellipse cx="60" cy="72" rx="22" ry="8" fill="#c63f49"/>',
    '<circle cx="60" cy="42" r="30" fill="#e2525c"/>',
    '<ellipse cx="50" cy="32" rx="8" ry="12" transform="rotate(-30 50 32)" fill="#ffffff" opacity=".45"/>',
])
add("decor", "clip", "Скрепка", [
    '<path d="M48 104 L 48 32 Q 48 16 62 16 Q 76 16 76 32 L 76 92 Q 76 104 66 104 Q 58 104 58 92 L 58 38" fill="none" stroke="#9aa3b5" stroke-width="6" stroke-linecap="round" transform="rotate(-20 60 60)"/>',
])
add("decor", "arrow", "Стрелка", [
    '<path d="M14 92 C 26 44 66 30 100 40" fill="none" stroke="#2d3a5a" stroke-width="5" stroke-linecap="round"/>',
    '<path d="M84 26 L 102 40 L 84 52" fill="none" stroke="#2d3a5a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
])
add("decor", "doodle-heart", "Сердечко от руки", [
    f'<path transform="translate(14 14) rotate(-8 46 46) scale(.78)" d="{HEART}" fill="none" stroke="#e2525c" stroke-width="7" stroke-linejoin="round"/>',
])

SET_NAMES = {"love": "Любовь", "party": "Праздник", "travel": "Путешествие", "nature": "Природа",
             "baby": "Малыш", "almaty": "Алматы", "decor": "Декор"}

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
