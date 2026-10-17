"""Собирает шаблоны фотокниг (templates/*.json) из готовых раскладок страниц.

Пишет только шаблоны, описанные ниже в TEMPLATES; остальные файлы в templates/
(anniversary-classic, birthday-bright, travel-minimal) не трогает. Шаблон —
обычный JSON, его можно править и руками; скрипт просто избавляет от ручного
набора 22 страниц и держит раскладки одинаковыми.

Запуск из корня репозитория:
    python3 tools/templates/generate.py
Проверка: make test (TestShippedTemplatesAreValid: поля, безопасная зона текста,
наложения, шрифты и стикеры из конфигов) — сервер при старте проверяет так же.

Координаты — проценты страницы формата square-200 (200×200 мм, безопасная зона
5 мм = 2,5%). Текст держим не ближе 8% к краю; фото, прижатое к краю, уходит
в вылет. Высоту стикера считаем по пропорциям рисунка из stickers.json.
"""
import json
import os
from dataclasses import dataclass

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "templates")
STICKERS = {
    s["id"]: s
    for group in json.load(open(os.path.join(ROOT, "frontend", "src", "book", "stickers.json"), encoding="utf-8"))["sets"]
    for s in group["stickers"]
}
FORMAT = {"id": "square-200", "width_mm": 200, "height_mm": 200, "pages": 20}


def num(v):
    """8.0 → 8, 13.333 → 13.33: JSON как у шаблонов, написанных руками."""
    v = round(v, 2)
    return int(v) if v == int(v) else v


@dataclass
class Style:
    bg: str  # фон страниц
    title_font: str  # заголовки и цитаты
    title_color: str
    body_font: str  # подписи
    body_color: str
    quote_size: int = 22
    quote_bg: str | None = None  # фон страниц с цитатой (None — как у остальных)


class Page:
    def __init__(self, page_id, background):
        self.id = page_id
        self.background = background
        self.elements = []
        self.counters = {}

    def _next_id(self, prefix):
        self.counters[prefix] = self.counters.get(prefix, 0) + 1
        return f"{prefix}{self.counters[prefix]}"

    def photo(self, x, y, w, h):
        self.elements.append({
            "type": "photo_slot", "id": self._next_id("s"), "x": num(x), "y": num(y), "w": num(w), "h": num(h),
            "assetId": None, "crop": {"zoom": 1, "offsetX": 0, "offsetY": 0},
        })

    def text(self, x, y, w, h, text, font, size, color, align="center", rotation=0):
        el = {
            "type": "text", "id": self._next_id("t"), "x": num(x), "y": num(y), "w": num(w), "h": num(h),
            "text": text, "font": font, "size": size, "color": color, "align": align,
        }
        if rotation:
            el["rotation"] = rotation
        self.elements.append(el)

    def sticker(self, sticker_id, x, y, w, rotation=0):
        aspect = STICKERS[sticker_id]["aspect"]  # ширина / высота рисунка
        h = w * FORMAT["width_mm"] / FORMAT["height_mm"] / aspect
        el = {"type": "sticker", "id": self._next_id("st"), "x": num(x), "y": num(y), "w": num(w), "h": num(h), "stickerId": sticker_id}
        if rotation:
            el["rotation"] = rotation
        self.elements.append(el)


# ---------- Раскладки страниц ----------
# Каждая — функция (страница, стиль). Пустая подпись (text: "") в редакторе —
# подсказка «Нажмите, чтобы добавить текст», на печать не выходит.

def caption(p, s, x, y, w, h):
    p.text(x, y, w, h, "", s.body_font, 11, s.body_color)


def full(p, s):
    p.photo(0, 0, 100, 100)


def photo_caption(p, s):
    p.photo(8, 8, 84, 70)
    caption(p, s, 8, 81, 84, 11)


def bleed_caption(p, s):
    p.photo(0, 0, 100, 80)
    caption(p, s, 8, 83, 84, 11)


def two_vertical(p, s):
    p.photo(6, 6, 42, 88)
    p.photo(52, 6, 42, 88)


def two_horizontal(p, s):
    p.photo(6, 6, 88, 42)
    p.photo(6, 52, 88, 42)


def grid4(p, s):
    for x, y in [(6, 6), (52, 6), (6, 52), (52, 52)]:
        p.photo(x, y, 42, 42)


def one_two(p, s):
    p.photo(6, 6, 88, 52)
    p.photo(6, 61, 42, 33)
    p.photo(52, 61, 42, 33)


def big_left(p, s):
    """Большое фото слева и два маленьких справа."""
    p.photo(6, 6, 54, 88)
    p.photo(64, 6, 30, 42)
    p.photo(64, 52, 30, 42)


def three_tall(p, s):
    for x in (6, 37, 68):
        p.photo(x, 6, 26, 88)


def side_text(p, s):
    """Фото и место для рассказа сбоку."""
    p.photo(6, 6, 54, 88)
    p.text(64, 30, 30, 40, "", s.body_font, 12, s.body_color, align="left")


def card(p, s):
    """Фото «карточкой» и подпись от руки чуть наискосок."""
    p.photo(12, 8, 76, 64)
    p.text(12, 76, 76, 12, "", s.title_font, 16, s.title_color, rotation=-3)


def with_stickers(layout, *stickers):
    """Раскладка + стикеры поверх: (id, x, y, ширина, поворот)."""
    def f(p, s):
        layout(p, s)
        for st in stickers:
            p.sticker(*st)
    return f


def quote(text, size=None, stickers=()):
    """Страница-пауза: крупная фраза заголовочным шрифтом."""
    def f(p, s):
        if s.quote_bg:
            p.background = s.quote_bg
        p.text(12, 30, 76, 40, text, s.title_font, size or s.quote_size, s.title_color)
        for st in stickers:
            p.sticker(*st)
    return f


def month_label(n):
    if n % 10 == 1 and n % 100 != 11:
        word = "месяц"
    elif n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        word = "месяца"
    else:
        word = "месяцев"
    return f"{n} {word}"


def month(n, double=False, stickers=()):
    """Страница «N месяцев»: подпись наискосок сверху, одно или два фото, подпись снизу."""
    def f(p, s):
        p.text(8, 6, 84, 9, month_label(n), s.title_font, 26, s.title_color, rotation=-3)
        if double:
            p.photo(8, 18, 41, 66)
            p.photo(51, 18, 41, 66)
        else:
            p.photo(8, 18, 84, 66)
        caption(p, s, 8, 87, 84, 8)
        for st in stickers:
            p.sticker(*st)
    return f


# ---------- Шаблоны ----------

@dataclass
class TemplateDef:
    id: str
    name: str
    occasion: str
    style: Style
    cover: object
    pages: list
    back: object


def mom_cover(p, s):
    p.photo(10, 8, 80, 62)
    p.text(8, 73, 84, 13, "Маме с любовью", s.title_font, 34, s.title_color)
    p.text(8, 87, 84, 6, "от твоих детей", s.body_font, 12, s.body_color)
    p.sticker("nature-daisy", 3, 59, 15, -12)
    p.sticker("love-heart", 84, 3, 11, 14)


def mom_back(p, s):
    p.sticker("love-letter", 43, 24, 14, -6)
    p.text(12, 42, 76, 14, "С любовью — навсегда", s.title_font, 22, s.title_color)


def wedding_cover(p, s):
    p.photo(0, 0, 100, 70)
    p.text(8, 73, 84, 12, "Наша свадьба", s.title_font, 30, s.title_color)
    p.text(8, 86, 84, 6, "12 · 08 · 2026", s.body_font, 13, s.body_color)
    # Веточки по бокам даты, верхушками наружу. Сама веточка нарисована
    # снизу-слева вверх-вправо (−55°): поворот −125° — влево, +55° — вправо.
    p.sticker("nature-leaves", 29, 84.5, 9, -125)
    p.sticker("nature-leaves", 62, 84.5, 9, 55)


def wedding_back(p, s):
    p.sticker("love-hearts", 44, 28, 12)
    p.text(12, 44, 76, 12, "Спасибо, что были с нами", s.body_font, 14, s.body_color)


def baby_cover(p, s):
    p.photo(12, 10, 76, 60)
    p.text(8, 73, 84, 13, "Первый год", s.title_font, 32, s.title_color)
    p.text(8, 87, 84, 6, "Имя · 2026", s.body_font, 13, s.body_color)
    p.sticker("party-star", 5, 4, 13, -15)
    p.sticker("party-balloon", 81, 5, 13, 10)


def baby_back(p, s):
    p.sticker("party-star", 44, 28, 12)
    p.text(12, 44, 76, 12, "Расти большим и счастливым", s.title_font, 18, s.title_color)


def family_cover(p, s):
    p.photo(0, 0, 100, 64)
    p.text(8, 68, 84, 13, "Наша семья", s.title_font, 34, s.title_color)
    p.text(8, 82, 84, 7, "Фамилия · 2026", s.body_font, 13, s.body_color)
    p.sticker("love-heart", 83, 56, 10, 12)


def family_back(p, s):
    p.sticker("love-heart", 45, 30, 10)
    p.text(12, 44, 76, 12, "Семья — это главное", s.title_font, 22, s.title_color)


BELOW_QUOTE = 70  # стикер под цитатой: блок цитаты — y 30…70

TEMPLATES = [
    TemplateDef(
        id="mom-tender", name="Маме с любовью", occasion="mom",
        style=Style(bg="#fcf3f1", title_font="marck-script", title_color="#9b4a5a",
                    body_font="lora", body_color="#6b4a4f", quote_size=26, quote_bg="#f8e6e3"),
        cover=mom_cover,
        pages=[
            quote("Мама, это для тебя", stickers=[("love-heart", 44, BELOW_QUOTE, 12)]),
            full,
            card,
            two_vertical,
            with_stickers(grid4, ("nature-daisy", 43, 43, 14, 10)),
            quote("Спасибо за тепло и заботу"),
            bleed_caption,
            one_two,
            big_left,
            full,
            side_text,
            two_horizontal,
            quote("Ты — самая лучшая", stickers=[("nature-leaves", 44, BELOW_QUOTE, 12, 15)]),
            grid4,
            photo_caption,
            two_vertical,
            card,
            full,
            bleed_caption,
            quote("Люблю тебя, мама", stickers=[("love-hearts", 43, BELOW_QUOTE, 14, -8)]),
        ],
        back=mom_back,
    ),
    TemplateDef(
        id="wedding-elegant", name="Наша свадьба", occasion="wedding",
        style=Style(bg="#fbf8f3", title_font="playfair-display", title_color="#7a5c3a",
                    body_font="pt-serif", body_color="#5b4a3a", quote_size=22),
        cover=wedding_cover,
        pages=[
            quote("Начало нашей семьи"),
            full,
            photo_caption,
            two_vertical,
            one_two,
            quote("Да!", size=60, stickers=[("love-hearts", 44, BELOW_QUOTE, 12)]),
            grid4,
            bleed_caption,
            big_left,
            full,
            two_horizontal,
            side_text,
            quote("Танцуем вместе всю жизнь", stickers=[("nature-leaves", 44, BELOW_QUOTE, 12)]),
            grid4,
            card,
            two_vertical,
            three_tall,
            full,
            bleed_caption,
            quote("Долго и счастливо", stickers=[("nature-sparkles", 44, BELOW_QUOTE, 12)]),
        ],
        back=wedding_back,
    ),
    TemplateDef(
        id="baby-first-year", name="Первый год", occasion="baby",
        style=Style(bg="#f2f7fb", title_font="pacifico", title_color="#3b6e8f",
                    body_font="nunito", body_color="#4a5a66", quote_size=24),
        cover=baby_cover,
        pages=[
            quote("Здравствуй, малыш!", stickers=[("nature-sparkles", 44, BELOW_QUOTE, 12)]),
            full,
            *[month(n, double=n % 2 == 0,
                    stickers={1: [("nature-sparkles", 84, 3, 10)],
                              6: [("party-star", 84, 3, 10, 12)],
                              12: [("party-cake", 82, 2, 12)]}.get(n, []))
              for n in range(1, 13)],
            grid4,
            quote("Первые шаги", stickers=[("party-star", 44, BELOW_QUOTE, 12)]),
            one_two,
            bleed_caption,
            full,
            quote("С днём рождения, малыш!", stickers=[("party-cake", 42, BELOW_QUOTE, 16), ("party-balloons", 76, 8, 14, 8)]),
        ],
        back=baby_back,
    ),
    TemplateDef(
        id="family-album", name="Наша семья", occasion="family",
        style=Style(bg="#fffaf2", title_font="lobster", title_color="#2f5d3a",
                    body_font="raleway", body_color="#3f3f3f", quote_size=24),
        cover=family_cover,
        pages=[
            quote("Мы — семья", stickers=[("nature-leaves", 44, BELOW_QUOTE, 12)]),
            full,
            photo_caption,
            grid4,
            two_vertical,
            quote("Дом там, где мы вместе", stickers=[("travel-sun", 44, 14, 12)]),
            one_two,
            card,
            big_left,
            full,
            two_horizontal,
            side_text,
            quote("Наши традиции", stickers=[("party-star", 44, BELOW_QUOTE, 12)]),
            grid4,
            three_tall,
            photo_caption,
            one_two,
            full,
            bleed_caption,
            quote("Продолжение следует…", stickers=[("travel-camera", 44, BELOW_QUOTE, 12, -8)]),
        ],
        back=family_back,
    ),
]


# ---------- Запись ----------

def page_json(p: Page, indent: str) -> str:
    """Страница — одной строкой «заголовка», элементы — по одному на строку."""
    head = json.dumps({"id": p.id, "background": p.background}, ensure_ascii=False)[:-1]
    if not p.elements:
        return f'{indent}{head}, "elements": []}}'
    els = ",\n".join(f"{indent}    {json.dumps(e, ensure_ascii=False)}" for e in p.elements)
    return f'{indent}{head}, "elements": [\n{els}\n{indent}]}}'


def build(t: TemplateDef) -> str:
    s = t.style
    cover = Page("cover", s.bg)
    t.cover(cover, s)
    pages = []
    for i, layout in enumerate(t.pages, start=1):
        p = Page(f"p{i}", s.bg)
        layout(p, s)
        pages.append(p)
    assert len(pages) == FORMAT["pages"], f"{t.id}: {len(pages)} pages, format needs {FORMAT['pages']}"
    back = Page("back", s.bg)
    t.back(back, s)

    meta = {"schemaVersion": 1, "id": t.id, "name": t.name, "occasion": t.occasion, "formatId": FORMAT["id"]}
    lines = ["{"] + [f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}," for k, v in meta.items()]
    lines.append(f'  "cover": {page_json(cover, "  ").lstrip()},')
    lines.append('  "pages": [')
    lines.append(",\n".join(page_json(p, "    ") for p in pages))
    lines.append("  ],")
    lines.append(f'  "backCover": {page_json(back, "  ").lstrip()}')
    lines.append("}")
    return "\n".join(lines) + "\n"


for t in TEMPLATES:
    path = os.path.join(OUT, f"{t.id}.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write(build(t))
    print("written", os.path.relpath(path, ROOT))
