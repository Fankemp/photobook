# Тестовые HEIC для e2e/tray.mjs (как фото с iPhone). Пересоздать:
#   docker run --rm -v $PWD:/w -w /w python:3.13-slim sh -c 'pip install -q pillow pillow-heif && python make_heic.py'
# portrait.heic — 900×1200 с датой съёмки в EXIF;
# lying.heic — 1200×900 «лёжа» с пометкой EXIF «повернуть на 90°» (Orientation 6).
from PIL import Image, ImageDraw
import pillow_heif

pillow_heif.register_heif_opener()


def photo(w, h):
    im = Image.new("RGB", (w, h), (40, 90, 160))
    d = ImageDraw.Draw(im)
    for i in range(0, w, 60):
        d.rectangle([i, 0, i + 30, h], fill=(200, 120 + (i // 60) % 100, 60))
    d.rectangle([0, 0, w // 3, h // 3], fill=(250, 250, 250))  # белый угол — по нему видно поворот
    return im


exif = Image.Exif()
exif[0x8769] = {0x9003: "2021:06:01 09:30:00"}
photo(900, 1200).save("portrait.heic", quality=60, exif=exif.tobytes())

exif = Image.Exif()
exif[0x0112] = 6
exif[0x8769] = {0x9003: "2020:03:03 12:00:00"}
photo(1200, 900).save("lying.heic", quality=60, exif=exif.tobytes())
