"""Готовит шрифты для self-host: проверка кириллицы/казахского, woff2, конфиг.

Так получен текущий набор в frontend/public/fonts и frontend/src/book/fonts.json.
Исходники — из https://github.com/google/fonts (папка ofl/<имя>/: .ttf и OFL.txt).

Запуск (нужны пакеты fonttools и brotli):
    python3 process_fonts.py <папка исходников> <папка вывода файлов> <путь к fonts.json>

Новый шрифт — строка в FONTS. rfn=True, если в OFL.txt есть «Reserved Font Name»:
такие файлы кладём без изменений (OFL запрещает изменённым версиям носить это имя),
остальные облегчаем (только 400/700, латиница + кириллица) и сохраняем в woff2.
См. также скилл .claude/skills/add-font.
"""
import json
import os
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC, OUT, CONFIG = sys.argv[1:4]

# rfn=True — у шрифта есть Reserved Font Name: распространяем исходные файлы
# без изменений (OFL запрещает изменённым версиям носить это имя).
FONTS = [
    ("caveat", "Caveat", "handwritten", False, ["caveat/Caveat[wght].ttf"]),
    ("marck-script", "Marck Script", "handwritten", True, ["marckscript/MarckScript-Regular.ttf"]),
    ("pacifico", "Pacifico", "handwritten", False, ["pacifico/Pacifico-Regular.ttf"]),
    ("lobster", "Lobster", "handwritten", True, ["lobster/Lobster-Regular.ttf"]),
    ("playfair-display", "Playfair Display", "serif", True, ["playfairdisplay/PlayfairDisplay[wght].ttf"]),
    ("lora", "Lora", "serif", True, ["lora/Lora[wght].ttf"]),
    ("pt-serif", "PT Serif", "serif", True, ["ptserif/PT_Serif-Web-Regular.ttf", "ptserif/PT_Serif-Web-Bold.ttf"]),
    ("montserrat", "Montserrat", "sans", False, ["montserrat/Montserrat[wght].ttf"]),
    ("raleway", "Raleway", "sans", True, ["raleway/Raleway[wght].ttf"]),
    ("nunito", "Nunito", "sans", False, ["nunito/Nunito[wght].ttf"]),
]

RU = list(range(0x0410, 0x0450)) + [0x0401, 0x0451]
KK = [0x04D8, 0x04D9, 0x0492, 0x0493, 0x049A, 0x049B, 0x04A2, 0x04A3,
      0x04E8, 0x04E9, 0x04B0, 0x04B1, 0x04AE, 0x04AF, 0x04BA, 0x04BB, 0x0406, 0x0456]
PUNCT = [ord(c) for c in "«»—–…№„“”’!?.,:;-()\"'"]
# Что оставляем при облегчении: латиница, Latin-1, весь блок кириллицы
# (с казахскими буквами), типографские знаки, № и знак тенге.
KEEP = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + list(range(0x400, 0x500))
        + list(range(0x2010, 0x2028)) + list(range(0x2030, 0x203B)) + [0x2116, 0x20B8])


def coverage(font):
    cmap = font.getBestCmap()
    missing = [chr(c) for c in RU + PUNCT if c not in cmap]
    return missing, all(c in cmap for c in KK)


def wght_range(font):
    if "fvar" not in font:
        return None
    for a in font["fvar"].axes:
        if a.axisTag == "wght":
            return int(a.minValue), int(a.maxValue)
    return None


def static_weight(font):
    return font["OS/2"].usWeightClass


def covers700(weight):
    """Жирное есть, если файл покрывает вес 700 ("700" или диапазон "400 900")."""
    parts = [int(p) for p in weight.split()]
    return parts[0] <= 700 <= parts[-1]


def save_light(font, path):
    opts = subset.Options()
    opts.layout_features = ["*"]  # лигатуры, кернинг — как в оригинале
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.flavor = "woff2"
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=KEEP)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(path)


os.makedirs(os.path.join(OUT, "licenses"), exist_ok=True)
config = []
for fid, name, category, rfn, files in FONTS:
    entry = {"id": fid, "name": name, "category": category, "license": "OFL-1.1", "modified": not rfn, "files": []}
    kk_all = True
    for rel in files:
        src = os.path.join(SRC, rel)
        font = TTFont(src)
        missing, kk = coverage(font)
        if missing:
            sys.exit(f"{fid}: нет символов {''.join(missing)} — не добавляем")
        kk_all = kk_all and kk
        wr = wght_range(font)
        if rfn:
            # Без изменений: исходный файл как есть.
            if wr is None:
                out_name = f"{fid}-{'bold' if static_weight(font) >= 700 else 'regular'}.ttf"
            else:
                out_name = f"{fid}-variable.ttf"
            shutil.copyfile(src, os.path.join(OUT, out_name))
            weight = f"{wr[0]} {wr[1]}" if wr else str(static_weight(font))
            entry["files"].append({"file": out_name, "weight": weight})
        else:
            weights = [400, 700] if wr and wr[0] <= 400 and wr[1] >= 700 else [static_weight(font)]
            for w in weights:
                f = TTFont(src)
                if wr:
                    # updateFontNames: внутренние имена станут «Montserrat Regular/Bold»,
                    # а не имя начертания по умолчанию (иначе в PDF будет «Montserrat Thin»).
                    f = instancer.instantiateVariableFont(
                        f, {a.axisTag: (w if a.axisTag == "wght" else a.defaultValue) for a in f["fvar"].axes},
                        updateFontNames=True)
                out_name = f"{fid}-{'bold' if w >= 700 else 'regular'}.woff2"
                save_light(f, os.path.join(OUT, out_name))
                entry["files"].append({"file": out_name, "weight": str(w)})
    entry["bold"] = any(covers700(f["weight"]) for f in entry["files"])
    entry["kk"] = kk_all
    shutil.copyfile(os.path.join(SRC, os.path.dirname(files[0]), "OFL.txt"), os.path.join(OUT, "licenses", f"{fid}-OFL.txt"))
    config.append(entry)

# Проверка результата: в каждом выходном файле есть вся русская кириллица.
for e in config:
    for f in e["files"]:
        missing, _ = coverage(TTFont(os.path.join(OUT, f["file"])))
        assert not missing, (f["file"], missing)
        f_size = os.path.getsize(os.path.join(OUT, f["file"]))
        print(f'{e["id"]:18} {f["file"]:30} weight {f["weight"]:9} {f_size // 1024:5} KB  kk={e["kk"]} bold={e["bold"]} modified={e["modified"]}')

with open(CONFIG, "w", encoding="utf-8") as fh:
    json.dump({"fonts": config}, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
