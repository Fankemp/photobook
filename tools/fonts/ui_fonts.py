"""Шрифт сайта (не книги): Literata — для заголовков и текста на страницах сайта.

Книжные шрифты (fonts.json) выбирает клиент для текста в книге; этот — только
для интерфейса, в выбор шрифтов книги он не попадает. Literata — антиква для
чтения книг с экрана, с полной кириллицей и казахскими буквами (нужны для «Сақта»).

Исходник — https://github.com/google/fonts/tree/main/ofl/literata
(Literata[opsz,wght].ttf и OFL.txt; Reserved Font Name в лицензии нет, поэтому
шрифт можно облегчать). Делаем два статичных начертания:
  text-400     — обычный текст (вес 400, оптический размер 14);
  display-600  — заголовки (вес 600, оптический размер 40: тоньше штрихи, плотнее).
Оставляем латиницу, кириллицу, типографские знаки и знак тенге; формат woff2.

Запуск (нужны fonttools и brotli; исходник — в отдельной папке):
    python3 -I tools/fonts/ui_fonts.py '<папка>/Literata[opsz,wght].ttf' frontend/public/fonts/ui
Лицензия лежит в frontend/public/fonts/licenses/literata-OFL.txt.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC, OUT = sys.argv[1:3]

RU = list(range(0x0410, 0x0450)) + [0x0401, 0x0451]
KK = [0x04D8, 0x04D9, 0x0492, 0x0493, 0x049A, 0x049B, 0x04A2, 0x04A3,
      0x04E8, 0x04E9, 0x04B0, 0x04B1, 0x04AE, 0x04AF, 0x04BA, 0x04BB, 0x0406, 0x0456]
KEEP = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x400, 0x500))
        + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B)) + [0x2116, 0x20B8])

cmap = TTFont(SRC).getBestCmap()
missing = [chr(c) for c in RU + KK if c not in cmap]
if missing:
    sys.exit(f"нет букв: {''.join(missing)}")

for name, wght, opsz in [("text-400", 400, 14), ("display-600", 600, 40)]:
    font = instancer.instantiateVariableFont(TTFont(SRC), {"wght": wght, "opsz": opsz})
    opts = subset.Options()
    opts.layout_features = ["*"]  # кернинг и лигатуры — как в оригинале
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=KEEP)
    sub.subset(font)
    font.flavor = "woff2"
    path = os.path.join(OUT, f"literata-{name}.woff2")
    font.save(path)
    print(path, os.path.getsize(path), "bytes")
