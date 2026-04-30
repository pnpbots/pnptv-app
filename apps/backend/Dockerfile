# ===========================================================
# PNPtv Backend - Multi-stage Docker Build
# ===========================================================

# Stage 1: Install dependencies
FROM node:20-slim AS deps

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY apps/backend/package.json ./apps/backend/
COPY package.json package-lock.json ./

# This is an npm-workspaces monorepo: the only authoritative lockfile lives at
# the repo root. The root `npm ci` installs deps for every workspace including
# apps/backend (it hoists into root node_modules + creates the symlinked
# apps/backend/node_modules pointing at hoisted packages). No backend-local
# lockfile or backend-local `npm ci` is needed.
WORKDIR /app
RUN npm ci --omit=dev --ignore-scripts

# Stage 2: Production runtime
FROM node:20-slim

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
