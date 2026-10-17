# Образ Playwright уже содержит Chromium нужной версии (та же версия, что в e2e).
FROM mcr.microsoft.com/playwright:v1.64.1-noble
# ghostscript — перевод PDF в CMYK (по флагу PDF_CMYK); poppler-utils — проверка
# PDF: pdfinfo (страницы, размер), pdffonts (шрифты встроены), pdfimages (цвет фото);
# qpdf — склейка постраничных PDF блока без пересжатия.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghostscript poppler-utils qpdf \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs ./
USER pwuser
EXPOSE 3000
CMD ["node", "server.mjs"]
