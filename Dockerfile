# PDFLord conversion backend
# Node.js + headless LibreOffice in one container

FROM node:20-slim

# Install LibreOffice (headless-capable) and fonts so documents using
# common fonts (Calibri-alikes, Arial-alikes, etc.) AND non-Latin scripts
# like Sinhala render correctly instead of showing tofu boxes / missing glyphs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-liberation \
    fonts-dejavu \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-lklug-sinhala \
    fonts-noto-core \
    fonts-noto-unhinted \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]