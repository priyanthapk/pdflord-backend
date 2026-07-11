# PDFLord conversion backend
# Node.js + headless LibreOffice in one container

FROM node:20-slim

# Install LibreOffice (headless-capable) and fonts so documents using
# common fonts (Calibri-alikes, Arial-alikes, etc.) render correctly.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-liberation \
    fonts-dejavu \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
