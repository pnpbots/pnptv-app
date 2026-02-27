# ===========================================================
# PNPtv Backend - Multi-stage Docker Build
# ===========================================================

# Stage 1: Install dependencies
FROM node:18-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY apps/backend/package.json apps/backend/package-lock.json ./apps/backend/
COPY package.json package-lock.json ./

WORKDIR /app/apps/backend
RUN npm ci --omit=dev

WORKDIR /app
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || true

# Stage 2: Production runtime
FROM node:18-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libvips42 \
    fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    tini curl \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN groupadd -r pnptv && useradd -r -g pnptv -d /app -s /sbin/nologin pnptv

WORKDIR /app

COPY --from=deps --chown=pnptv:pnptv /app/node_modules ./node_modules
COPY --from=deps --chown=pnptv:pnptv /app/apps/backend/node_modules ./apps/backend/node_modules

COPY --chown=pnptv:pnptv apps/backend/ ./apps/backend/
COPY --chown=pnptv:pnptv apps/public/ ./apps/public/
COPY --chown=pnptv:pnptv scripts/ ./scripts/
COPY --chown=pnptv:pnptv public/ ./public/
COPY --chown=pnptv:pnptv packages/ ./packages/
COPY --chown=pnptv:pnptv package.json ./

RUN mkdir -p /app/logs /app/public/uploads/avatars \
    && chown pnptv:pnptv /app/logs /app/public/uploads /app/public/uploads/avatars \
    && chown pnptv:pnptv /tmp

USER pnptv

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/backend/bot/core/bot.js"]
