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
    ffmpeg \
    tini curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp standalone binary (pre-downloaded on host)
COPY apps/backend/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod +x /usr/local/bin/yt-dlp

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN groupadd -r pnptv && useradd -r -g pnptv -d /app -s /sbin/nologin pnptv

WORKDIR /app

COPY --from=deps --chown=pnptv:pnptv /app/node_modules ./node_modules
COPY --from=deps --chown=pnptv:pnptv /app/apps/backend/node_modules ./apps/backend/node_modules

# Rarely-changed layers first (better cache hits)
COPY --chown=pnptv:pnptv packages/ ./packages/
COPY --chown=pnptv:pnptv package.json ./

# Static assets
COPY --chown=pnptv:pnptv apps/public/ ./apps/public/
COPY --chown=pnptv:pnptv public/ ./public/

# Backend code (most frequently changed — last for best cache)
COPY --chown=pnptv:pnptv apps/backend/ ./apps/backend/

RUN mkdir -p /app/logs /app/public/uploads/avatars /app/public/uploads/posts /app/public/uploads/chat \
    && chown pnptv:pnptv /app/logs \
                         /app/public/uploads \
                         /app/public/uploads/avatars \
                         /app/public/uploads/posts \
                         /app/public/uploads/chat \
    && chown pnptv:pnptv /tmp

USER pnptv

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "--dns-result-order=ipv4first", "apps/backend/bot/core/bot.js"]
