"""Рисует иллюстрации-«фото» для витрины сайта (главная, каталог, страница шаблона).

Это не фото клиентов и не чужие снимки: простые плоские сцены, нарисованные кодом,
свои права. Ими заполняются рамки шаблонов на витрине, чтобы было видно, как
книга выглядит с фотографиями. В книги клиентов и в печать они не попадают.

Сцены квадратные, главное — в центре: рамки бывают и вытянутые (1:2, 2:1),
фото в них обрезается по центру, как настоящее.

Запуск из корня репозитория:
    python3 tools/demo/generate.py
Пишет frontend/public/demo/<имя>.svg. Список сцен и какие из них к какому поводу —
в frontend/src/landing/demo.ts. Заменить на настоящие фото: положить JPEG
в frontend/public/demo/ и поменять имена файлов там же.
"""
import math
import os
import random

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "frontend", "public", "demo")
S = 800  # сторона сцены


def svg(defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">\n'
            f'<defs>{"".join(defs)}</defs>\n' + "\n".join(body) + "\n</svg>\n")


def lin(gid, stops, x1=0, y1=0, x2=0, y2=1):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>'


def rad(gid, stops, cx=0.5, cy=0.5, r=0.7):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}">{s}</radialGradient>'


def rect(fill, x=0, y=0, w=S, h=S, extra=""):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" {extra}/>'


def poly(points, fill, extra=""):
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    return f'<polygon points="{pts}" fill="{fill}" {extra}/>'


def ridge(peaks, fill, base=S, snow=None):
    """Горный хребет: ломаная по вершинам до низа сцены; snow — цвет снежных шапок."""
    pts = [(-10, base)] + peaks + [(S + 10, base)]
    out = [poly(pts, fill)]
    if snow:
        for i in range(1, len(peaks) - 1):
            (x0, y0), (x, y), (x1, y1) = peaks[i - 1], peaks[i], peaks[i + 1]
            if y < y0 and y < y1:  # вершина
                d = min(y0, y1) - y
                k = 0.32
                lx, ly = x + (x0 - x) * k * d / (y0 - y), y + d * k
                rx, ry = x + (x1 - x) * k * d / (y1 - y), y + d * k
                cap = [(x, y), (rx, ry), ((x + rx) / 2, ry - d * 0.08), (x, ry + d * 0.02), ((x + lx) / 2, ly - d * 0.06), (lx, ly)]
                out.append(poly(cap, snow))
    return out


def fir(x, y, h, color, snow=None):
    """Ель: три яруса треугольников, основание в (x, y)."""
    w = h * 0.42
    out = [f'<rect x="{x - h * 0.03:.1f}" y="{y - h * 0.12:.1f}" width="{h * 0.06:.1f}" height="{h * 0.12:.1f}" fill="#4a3528"/>']
    for i, (top, bot, ww) in enumerate([(0.0, 0.42, 0.55), (0.22, 0.68, 0.78), (0.45, 0.9, 1.0)]):
        out.append(poly([(x, y - h + h * top), (x + w * ww, y - h + h * bot), (x - w * ww, y - h + h * bot)], color))
        if snow:
            out.append(poly([(x, y - h + h * top), (x + w * ww * 0.45, y - h + h * (top + (bot - top) * 0.45)),
                             (x, y - h + h * (top + (bot - top) * 0.3)), (x - w * ww * 0.45, y - h + h * (top + (bot - top) * 0.45))], snow))
    return out


def cloud(cx, cy, k, fill="#ffffff", opacity=0.9):
    parts = [(0, 0, 60), (-55, 15, 42), (55, 12, 46), (-100, 30, 28), (100, 30, 30)]
    circles = "".join(f'<circle cx="{cx + dx * k:.1f}" cy="{cy + dy * k:.1f}" r="{r * k:.1f}"/>' for dx, dy, r in parts)
    return f'<g fill="{fill}" opacity="{opacity}">{circles}<rect x="{cx - 100 * k:.1f}" y="{cy + 20 * k:.1f}" width="{200 * k:.1f}" height="{40 * k:.1f}" rx="{20 * k:.1f}"/></g>'


SCENES = {}


def scene(fn):
    SCENES[fn.__name__] = fn
    return fn


# ---------- Сцены ----------

@scene
def alatau():
    """Горы Алатау на рассвете."""
    defs = [lin("sky", [(0, "#8fb4e2"), (0.55, "#f2d3cf"), (1, "#fbe6c6")]), lin("near", [(0, "#3d5a86"), (1, "#2a4268")])]
    b = [rect("url(#sky)"), '<circle cx="560" cy="330" r="74" fill="#fff4d8" opacity=".95"/>']
    b += ridge([(0, 420), (120, 300), (210, 360), (330, 230), (450, 340), (560, 270), (680, 350), (800, 290)], "#a7b8d8", snow="#ffffff")
    b += ridge([(0, 500), (140, 400), (260, 470), (400, 380), (520, 470), (650, 410), (800, 480)], "#6f87b2", snow="#eef3fa")
    b += ridge([(0, 600), (180, 520), (360, 590), (520, 530), (700, 600), (800, 560)], "url(#near)")
    b.append(poly([(-10, 800), (-10, 660), (200, 640), (420, 680), (620, 650), (810, 690), (810, 800)], "#24453b"))
    for x, y, h in [(70, 700, 150), (150, 715, 120), (650, 705, 140), (735, 720, 160), (560, 740, 100)]:
        b += fir(x, y, h, "#1c3a30")
    return svg(defs, b)


@scene
def lake():
    """Горное озеро."""
    defs = [lin("sky", [(0, "#a9cdeb"), (1, "#eaf4f9")]), lin("water", [(0, "#78d3d4"), (1, "#2f8fa3")]),
            '<clipPath id="w"><rect x="0" y="520" width="800" height="180"/></clipPath>']
    b = [rect("url(#sky)"), cloud(180, 160, 0.9), cloud(620, 110, 0.7)]
    far = [(0, 440), (150, 300), (260, 380), (400, 250), (530, 370), (660, 290), (800, 400)]
    b += ridge(far, "#7c95c0", base=530, snow="#ffffff")
    b += ridge([(0, 500), (120, 430), (300, 500), (480, 440), (640, 495), (800, 450)], "#4f6f8f", base=530)
    b.append(rect("url(#water)", 0, 520, 800, 180))
    mirror = " ".join(f"{x},{1040 - y}" for x, y in [(-10, 520)] + far + [(810, 520)])
    b.append(f'<polygon points="{mirror}" fill="#ffffff" opacity=".18" clip-path="url(#w)"/>')
    for y in (560, 600, 640, 675):
        b.append(f'<rect x="{random.randint(80, 400)}" y="{y}" width="{random.randint(120, 260)}" height="3" rx="1.5" fill="#ffffff" opacity=".35"/>')
    b.append(poly([(-10, 800), (-10, 690), (260, 700), (520, 690), (810, 705), (810, 800)], "#5e8f5a"))
    for cx, cy, rx in [(200, 730, 60), (300, 750, 40), (560, 740, 70), (680, 760, 45)]:
        b.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{rx * 0.55:.0f}" fill="#c9c2b4"/>')
    for x, y, h in [(40, 700, 190), (110, 710, 140), (720, 700, 200), (780, 715, 150)]:
        b += fir(x, y, h, "#22433a")
    return svg(defs, b)


@scene
def apples():
    """Яблоки на ветке — Алматы, город яблок."""
    defs = [rad("bg", [(0, "#f1f6e3"), (1, "#c9ddb0")], 0.5, 0.45, 0.75), rad("apple", [(0, "#f06a5c"), (0.6, "#d4313a"), (1, "#9c1d27")], 0.38, 0.35, 0.75)]
    b = [rect("url(#bg)")]
    b.append('<path d="M-20 210 C 180 170 320 260 460 230 S 700 150 830 190" fill="none" stroke="#6b4a32" stroke-width="26" stroke-linecap="round"/>')
    b.append('<path d="M330 245 C 360 300 380 330 400 380" fill="none" stroke="#6b4a32" stroke-width="10" stroke-linecap="round"/>')
    b.append('<path d="M560 205 C 560 260 545 300 520 350" fill="none" stroke="#6b4a32" stroke-width="10" stroke-linecap="round"/>')
    for x, y, a, c in [(120, 170, -30, "#5b9a4f"), (250, 240, 40, "#4b8442"), (430, 185, -20, "#5b9a4f"), (640, 150, 25, "#4b8442"),
                       (720, 230, 60, "#5b9a4f"), (300, 300, 70, "#5b9a4f"), (600, 290, -50, "#4b8442")]:
        b.append(f'<ellipse cx="{x}" cy="{y}" rx="70" ry="30" transform="rotate({a} {x} {y})" fill="{c}"/>')
    for cx, cy, r in [(400, 470, 110), (520, 450, 95), (255, 520, 80)]:
        b.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#apple)"/>')
        b.append(f'<ellipse cx="{cx - r * 0.35:.0f}" cy="{cy - r * 0.4:.0f}" rx="{r * 0.22:.0f}" ry="{r * 0.13:.0f}" transform="rotate(-30 {cx - r * 0.35:.0f} {cy - r * 0.4:.0f})" fill="#ffffff" opacity=".45"/>')
        b.append(f'<path d="M{cx} {cy - r * 0.92:.0f} q 5 -30 18 -48" fill="none" stroke="#5a3b26" stroke-width="7" stroke-linecap="round"/>')
    return svg(defs, b)


@scene
def tulips():
    """Поле тюльпанов — дикие тюльпаны цветут весной под Алматы."""
    random.seed(4)
    defs = [lin("sky", [(0, "#bfe0f4"), (1, "#f4f1e4")]), lin("field", [(0, "#a9cc85"), (1, "#5f9a4c")])]
    b = [rect("url(#sky)"), cloud(600, 150, 0.8)]
    b += ridge([(0, 400), (200, 340), (420, 390), (640, 330), (800, 380)], "#9db7cf", base=460)
    b.append(rect("url(#field)", 0, 440, 800, 360))
    colors = ["#e0393e", "#f0623a", "#e0393e", "#f2a23a", "#d92f4a"]
    rows = [(470, 0.35, 34), (520, 0.5, 26), (590, 0.7, 20), (680, 0.95, 16), (790, 1.25, 13)]
    for y, k, n in rows:
        for i in range(n):
            x = (i + random.random() * 0.6) * (S + 60) / n - 30
            yy = y + random.randint(-8, 8)
            c = random.choice(colors)
            h = 70 * k
            b.append(f'<path d="M{x:.0f} {yy:.0f} q {3 * k:.1f} {-h / 2:.1f} 0 {-h:.1f}" fill="none" stroke="#3f7a3a" stroke-width="{4 * k:.1f}"/>')
            b.append(f'<ellipse cx="{x - 9 * k:.1f}" cy="{yy - h * 0.3:.1f}" rx="{7 * k:.1f}" ry="{22 * k:.1f}" transform="rotate(-25 {x - 9 * k:.1f} {yy - h * 0.3:.1f})" fill="#4f8f43"/>')
            fx, fy = x, yy - h
            b.append(f'<path d="M{fx - 15 * k:.1f} {fy:.1f} Q {fx - 17 * k:.1f} {fy - 34 * k:.1f} {fx:.1f} {fy - 38 * k:.1f} Q {fx + 17 * k:.1f} {fy - 34 * k:.1f} {fx + 15 * k:.1f} {fy:.1f} Q {fx:.1f} {fy + 10 * k:.1f} {fx - 15 * k:.1f} {fy:.1f} Z" fill="{c}"/>')
            b.append(f'<path d="M{fx:.1f} {fy - 36 * k:.1f} L {fx:.1f} {fy + 2 * k:.1f}" stroke="#ffffff" stroke-opacity=".25" stroke-width="{2 * k:.1f}"/>')
    return svg(defs, b)


@scene
def city():
    """Вечерний город под горами, телебашня на холме."""
    random.seed(7)
    defs = [lin("sky", [(0, "#24325e"), (0.55, "#6a5a8e"), (1, "#f0a46e")])]
    b = [rect("url(#sky)")]
    for _ in range(40):
        b.append(f'<circle cx="{random.randint(0, 800)}" cy="{random.randint(0, 300)}" r="{random.choice([1.2, 1.6, 2])}" fill="#ffffff" opacity="{random.choice([.5, .7, .9])}"/>')
    b += ridge([(0, 470), (160, 380), (300, 440), (470, 350), (620, 430), (800, 390)], "#3c4a78", base=640, snow="#c7cfe6")
    b.append('<path d="M-10 640 Q 160 520 360 600 L 360 800 L -10 800 Z" fill="#2b3557"/>')
    b.append(poly([(190, 560), (204, 560), (200, 300), (194, 300)], "#c9cfe0"))
    b.append(f'<rect x="185" y="420" width="24" height="10" fill="#c9cfe0"/><rect x="189" y="360" width="16" height="8" fill="#c9cfe0"/>')
    b.append('<line x1="197" y1="300" x2="197" y2="240" stroke="#c9cfe0" stroke-width="3"/><circle cx="197" cy="238" r="5" fill="#ff5a5a"/>')
    x = 330
    while x < 820:
        w = random.randint(50, 90)
        h = random.randint(120, 260)
        b.append(rect("#1f2746", x, 800 - h, w, h))
        for wy in range(800 - h + 16, 790, 22):
            for wx in range(x + 8, x + w - 10, 16):
                if random.random() < 0.45:
                    b.append(rect("#ffd98a", wx, wy, 8, 10, 'opacity=".9"'))
        x += w + random.randint(4, 14)
    return svg(defs, b)


@scene
def sea():
    """Море на закате."""
    defs = [lin("sky", [(0, "#f2a07f"), (0.6, "#ffd6a3"), (1, "#ffe9c4")]), lin("sea", [(0, "#3b84ad"), (1, "#173f63")]), lin("sand", [(0, "#f3dcae"), (1, "#e2c084")])]
    b = [rect("url(#sky)"), '<circle cx="400" cy="470" r="110" fill="#fff2cc"/>', rect("url(#sea)", 0, 470, 800, 330)]
    for i, y in enumerate(range(490, 680, 26)):
        w = 200 - i * 18
        b.append(f'<rect x="{400 - w / 2:.0f}" y="{y}" width="{w}" height="6" rx="3" fill="#ffe7b0" opacity="{0.8 - i * 0.08:.2f}"/>')
    b.append('<path d="M-10 800 L -10 690 Q 250 640 520 700 Q 680 735 810 700 L 810 800 Z" fill="url(#sand)"/>')
    b.append('<path d="M640 760 C 650 650 690 560 700 470" fill="none" stroke="#3b2a20" stroke-width="16" stroke-linecap="round"/>')
    for a in (-160, -125, -90, -55, -20, 10):
        r = math.radians(a)
        x2, y2 = 700 + 150 * math.cos(r), 470 + 150 * math.sin(r) + 40
        b.append(f'<path d="M700 470 Q {700 + 80 * math.cos(r):.0f} {470 + 80 * math.sin(r) - 30:.0f} {x2:.0f} {y2:.0f}" fill="none" stroke="#24331f" stroke-width="18" stroke-linecap="round"/>')
    return svg(defs, b)


@scene
def road():
    """Дорога через степь к горам."""
    defs = [lin("sky", [(0, "#7fb8e6"), (1, "#e8f3fa")]), lin("steppe", [(0, "#e6cb7d"), (1, "#c49d4e")])]
    b = [rect("url(#sky)"), cloud(170, 170, 1.0), cloud(560, 230, 0.75), cloud(690, 120, 0.55)]
    b += ridge([(0, 470), (180, 410), (330, 450), (520, 390), (680, 445), (800, 420)], "#8ea3c6", base=500, snow="#f4f7fb")
    b.append(rect("url(#steppe)", 0, 490, 800, 310))
    b.append(poly([(385, 490), (415, 490), (640, 800), (160, 800)], "#4a4a52"))
    for i in range(8):
        t0, t1 = (i / 8) ** 1.6, ((i + 0.5) / 8) ** 1.6
        y0, y1 = 490 + 310 * t0, 490 + 310 * t1
        w0, w1 = 2 + 10 * t0, 2 + 10 * t1
        b.append(poly([(400 - w0 / 2, y0), (400 + w0 / 2, y0), (400 + w1 / 2, y1), (400 - w1 / 2, y1)], "#f5f0e0"))
    for x, y in [(90, 600), (700, 640), (240, 720), (600, 560)]:
        b.append(f'<path d="M{x} {y} l -8 -26 M{x} {y} l 0 -30 M{x} {y} l 9 -24" stroke="#a9853f" stroke-width="3" stroke-linecap="round"/>')
    return svg(defs, b)


@scene
def cake():
    """Праздничный торт со свечами."""
    defs = [lin("bg", [(0, "#fbe3dc"), (1, "#f7d0c6")]), lin("table", [(0, "#e9c7a3"), (1, "#d6ac80")])]
    b = [rect("url(#bg)")]
    b.append('<path d="M-10 120 Q 400 230 810 120" fill="none" stroke="#a9746a" stroke-width="3"/>')
    for i, c in enumerate(["#e24b4b", "#f5b83d", "#5aa9e6", "#6cc59a", "#f49ab0", "#e24b4b", "#f5b83d", "#5aa9e6"]):
        x = 60 + i * 95
        y = 120 + 110 * math.sin(math.pi * (x / 800)) * 0.95
        b.append(poly([(x - 30, y - 6), (x + 30, y - 6), (x, y + 50)], c))
    b.append(rect("url(#table)", 0, 620, 800, 180))
    b.append('<ellipse cx="400" cy="640" rx="250" ry="34" fill="#ffffff"/>')
    b.append('<rect x="210" y="470" width="380" height="160" rx="24" fill="#f49ab0"/>')
    b.append('<path d="M210 500 q 32 40 63 0 q 32 40 63 0 q 32 40 63 0 q 32 40 63 0 q 32 40 63 0 q 32 40 63 0 L 590 480 Q 590 470 570 470 L 230 470 Q 210 470 210 480 Z" fill="#ffffff"/>')
    b.append('<rect x="270" y="380" width="260" height="100" rx="18" fill="#fff4e6"/>')
    b.append('<path d="M270 400 q 26 30 52 0 q 26 30 52 0 q 26 30 52 0 q 26 30 52 0 q 26 30 52 0 L 530 392 Q 530 380 515 380 L 285 380 Q 270 380 270 392 Z" fill="#e24b4b"/>')
    for x, c in [(330, "#5aa9e6"), (400, "#f5b83d"), (470, "#6cc59a")]:
        b.append(f'<rect x="{x - 8}" y="300" width="16" height="82" rx="5" fill="{c}"/>')
        b.append(f'<path d="M{x} 250 C {x + 18} 272 {x + 14} 292 {x} 296 C {x - 14} 292 {x - 18} 272 {x} 250 Z" fill="#ffb02e"/>')
        b.append(f'<path d="M{x} 266 C {x + 8} 278 {x + 6} 288 {x} 290 C {x - 6} 288 {x - 8} 278 {x} 266 Z" fill="#fff2b3"/>')
    return svg(defs, b)


@scene
def balloons():
    """Воздушные шары в небе."""
    defs = [lin("sky", [(0, "#a8d8f2"), (1, "#eef8fd")])]
    b = [rect("url(#sky)"), cloud(150, 620, 1.1), cloud(650, 680, 0.9), cloud(620, 140, 0.6)]
    for cx, cy, c in [(300, 300, "#e24b4b"), (430, 250, "#f5b83d"), (540, 330, "#5aa9e6"), (370, 420, "#6cc59a"), (480, 440, "#f49ab0")]:
        b.append(f'<path d="M{cx} {cy + 82} C {cx - 10} {cy + 200} {410} {640} {405} {720}" fill="none" stroke="#7a8796" stroke-width="2.5"/>')
        b.append(f'<ellipse cx="{cx}" cy="{cy}" rx="66" ry="80" fill="{c}"/>')
        b.append(poly([(cx - 9, cy + 88), (cx + 9, cy + 88), (cx, cy + 76)], c))
        b.append(f'<ellipse cx="{cx - 22}" cy="{cy - 28}" rx="13" ry="24" transform="rotate(-25 {cx - 22} {cy - 28})" fill="#ffffff" opacity=".45"/>')
    return svg(defs, b)


@scene
def picnic():
    """Пикник под деревом."""
    defs = [lin("sky", [(0, "#c3e3f4"), (1, "#eef6e8")]), lin("grass", [(0, "#a3d07e"), (1, "#5f9b4d")]),
            '<pattern id="check" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#ffffff"/>'
            '<rect width="20" height="20" fill="#d63c46"/><rect x="20" y="20" width="20" height="20" fill="#d63c46"/>'
            '<rect x="20" width="20" height="20" fill="#ec9aa0"/><rect y="20" width="20" height="20" fill="#ec9aa0"/></pattern>']
    b = [rect("url(#sky)"), cloud(220, 150, 0.8)]
    b.append(rect("url(#grass)", 0, 430, 800, 370))
    b.append('<rect x="600" y="250" width="34" height="230" fill="#6b4a32"/>')
    for cx, cy, r, c in [(560, 230, 110, "#4f8a57"), (690, 220, 120, "#5f9b6e"), (620, 140, 120, "#6aa877"), (520, 300, 80, "#5f9b6e"), (720, 320, 85, "#4f8a57")]:
        b.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{c}"/>')
    b.append('<ellipse cx="560" cy="480" rx="200" ry="26" fill="#3f7a3a" opacity=".35"/>')
    b.append('<polygon points="130,560 520,540 620,700 170,730" fill="url(#check)"/>')
    b.append('<rect x="300" y="530" width="140" height="90" rx="14" fill="#b07a45"/>')
    b.append('<path d="M320 535 Q 370 450 420 535" fill="none" stroke="#8a5a30" stroke-width="10"/>')
    for x in range(310, 440, 22):
        b.append(f'<line x1="{x}" y1="535" x2="{x}" y2="615" stroke="#8a5a30" stroke-width="3" opacity=".6"/>')
    for cx, cy in [(480, 620), (515, 640)]:
        b.append(f'<circle cx="{cx}" cy="{cy}" r="22" fill="#d4313a"/><ellipse cx="{cx - 7}" cy="{cy - 8}" rx="5" ry="8" fill="#ffffff" opacity=".45"/>')
    return svg(defs, b)


@scene
def rings():
    """Обручальные кольца и лепестки."""
    random.seed(11)
    defs = [rad("bg", [(0, "#fcefeb"), (1, "#efcfcb")], 0.5, 0.5, 0.75), lin("gold", [(0, "#f6dc8c"), (0.5, "#d6a845"), (1, "#a57a27")], 0, 0, 1, 1)]
    b = [rect("url(#bg)")]
    for _ in range(18):
        x, y, a = random.randint(40, 760), random.randint(40, 760), random.randint(0, 180)
        if 220 < x < 580 and 250 < y < 560:
            continue
        b.append(f'<ellipse cx="{x}" cy="{y}" rx="26" ry="14" transform="rotate({a} {x} {y})" fill="{random.choice(["#f2a7b4", "#ea8fa1", "#f7c3cc"])}"/>')
    b.append('<ellipse cx="400" cy="560" rx="230" ry="26" fill="#c99a96" opacity=".35"/>')
    b.append('<circle cx="330" cy="400" r="120" fill="none" stroke="url(#gold)" stroke-width="30"/>')
    b.append('<circle cx="470" cy="400" r="120" fill="none" stroke="url(#gold)" stroke-width="30"/>')
    # Сцепка: верх левого кольца поверх правого.
    b.append('<path d="M 418 312 A 120 120 0 0 1 450 400" fill="none" stroke="url(#gold)" stroke-width="30"/>')
    b.append('<path d="M 300 300 A 120 120 0 0 1 380 288" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".6"/>')
    b.append('<path d="M 450 290 A 120 120 0 0 1 520 300" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity=".6"/>')
    return svg(defs, b)


@scene
def bouquet():
    """Букет в крафтовой бумаге."""
    defs = [lin("bg", [(0, "#efe4f1"), (1, "#e3d3e8")]), lin("paper", [(0, "#e8d6b8"), (1, "#cdb48e")])]
    b = [rect("url(#bg)")]
    for x, y, a in [(260, 300, -40), (560, 290, 40), (230, 420, -70), (580, 430, 70), (400, 210, 0)]:
        b.append(f'<ellipse cx="{x}" cy="{y}" rx="34" ry="90" transform="rotate({a} {x} {y})" fill="#5f9b6e"/>')
    for cx, cy, r, c1, c2 in [(400, 320, 95, "#f4a3b5", "#e2768f"), (290, 360, 78, "#ffffff", "#f1dfe3"), (515, 360, 80, "#f7c3cc", "#ea8fa1"),
                              (350, 230, 66, "#e9798f", "#c95a72"), (460, 240, 70, "#ffffff", "#efdfe4")]:
        for k, c in [(1, c1), (0.72, c2), (0.45, c1), (0.2, c2)]:
            b.append(f'<circle cx="{cx}" cy="{cy}" r="{r * k:.0f}" fill="{c}"/>')
    b.append('<path d="M240 400 L 560 400 L 430 760 L 370 760 Z" fill="url(#paper)"/>')
    b.append('<path d="M240 400 L 400 470 L 560 400" fill="none" stroke="#b89a70" stroke-width="4"/>')
    b.append('<path d="M360 560 Q 330 520 300 560 Q 330 600 360 570 M440 560 Q 470 520 500 560 Q 470 600 440 570" fill="#c8283c"/>')
    b.append('<rect x="352" y="548" width="96" height="30" rx="8" fill="#c8283c"/>')
    return svg(defs, b)


@scene
def teddy():
    """Плюшевый мишка."""
    random.seed(3)
    defs = [lin("bg", [(0, "#e4eef8"), (1, "#d3e2f1")])]
    b = [rect("url(#bg)")]
    for _ in range(26):
        b.append(f'<circle cx="{random.randint(0, 800)}" cy="{random.randint(0, 800)}" r="6" fill="#ffffff" opacity=".6"/>')
    b.append('<ellipse cx="400" cy="700" rx="230" ry="30" fill="#9fb3c9" opacity=".45"/>')
    fur, light = "#b9814f", "#e3bf93"
    b.append(f'<ellipse cx="400" cy="560" rx="150" ry="150" fill="{fur}"/>')
    b.append(f'<ellipse cx="400" cy="590" rx="90" ry="95" fill="{light}"/>')
    for x in (300, 500):
        b.append(f'<ellipse cx="{x}" cy="680" rx="62" ry="45" fill="{fur}"/><ellipse cx="{x}" cy="684" rx="34" ry="24" fill="{light}"/>')
    for x, a in ((260, 30), (540, -30)):
        b.append(f'<ellipse cx="{x}" cy="520" rx="44" ry="90" transform="rotate({a} {x} 520)" fill="{fur}"/>')
    for x in (300, 500):
        b.append(f'<circle cx="{x}" cy="230" r="55" fill="{fur}"/><circle cx="{x}" cy="232" r="30" fill="{light}"/>')
    b.append(f'<circle cx="400" cy="330" r="135" fill="{fur}"/>')
    b.append(f'<ellipse cx="400" cy="380" rx="62" ry="48" fill="{light}"/>')
    b.append('<ellipse cx="400" cy="362" rx="22" ry="15" fill="#3a2518"/><path d="M400 377 L 400 398 M 380 405 Q 400 420 420 405" fill="none" stroke="#3a2518" stroke-width="6" stroke-linecap="round"/>')
    b.append('<circle cx="350" cy="310" r="13" fill="#2a1a10"/><circle cx="450" cy="310" r="13" fill="#2a1a10"/>')
    b.append('<circle cx="354" cy="305" r="4" fill="#ffffff"/><circle cx="454" cy="305" r="4" fill="#ffffff"/>')
    b.append(poly([(400, 462), (330, 430), (330, 494)], "#c8283c") + poly([(400, 462), (470, 430), (470, 494)], "#c8283c"))
    b.append('<circle cx="400" cy="462" r="16" fill="#a51f31"/>')
    return svg(defs, b)


@scene
def snow():
    """Зимний лес в горах."""
    random.seed(5)
    defs = [lin("sky", [(0, "#c9dcee"), (1, "#f3f7fb")])]
    b = [rect("url(#sky)")]
    b += ridge([(0, 380), (170, 270), (330, 340), (480, 240), (640, 330), (800, 280)], "#b9cbe1", base=520, snow="#ffffff")
    b.append('<path d="M-10 520 Q 200 450 420 520 T 810 500 L 810 800 L -10 800 Z" fill="#ffffff"/>')
    b.append('<path d="M-10 640 Q 260 560 520 640 T 810 620 L 810 800 L -10 800 Z" fill="#e8f0f8"/>')
    for x, y, h in [(90, 560, 190), (190, 590, 150), (600, 560, 210), (700, 590, 170), (420, 660, 130), (300, 700, 160)]:
        b += fir(x, y, h, "#2c5a4a", snow="#ffffff")
    for _ in range(60):
        b.append(f'<circle cx="{random.randint(0, 800)}" cy="{random.randint(0, 800)}" r="{random.choice([2, 3, 4])}" fill="#ffffff" opacity=".9"/>')
    return svg(defs, b)


random.seed(1)
os.makedirs(OUT, exist_ok=True)
for name, fn in SCENES.items():
    with open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8") as f:
        f.write(fn())
print(len(SCENES), "scenes written to", os.path.relpath(OUT, ROOT))
