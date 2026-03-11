# PNPTV Project Memory

## Language Rules (CRITICAL)
- ALL documentation files (.md) must be BILINGUAL: Spanish first, then English, clearly separated with `---` and headers.
- ALL code (variables, comments, filenames in compose, scripts) must be in ENGLISH.
- Claude's own instructions and reasoning: ENGLISH always (saves tokens).
- This applies to every file generated in the project.

## Master Architecture (PNPTVAPP v4)

### Stack: 20 Containers / 10 Blocks / 1 Network
- A: NPM (proxy, ports 80/443/81)
- B: Authentik (server + worker + PG + Redis — Redis IS required even for latest)
- C: Directus (app + PG isolated)
- D: Ampache (app + MariaDB 10.11)
- E: Cal.com (app + PG + Redis for API v2)
- F: Bluesky PDS (internal SQLite)
- G: Matrix Synapse + Element Web (+ PG)
- H: Restreamer (port 1935 RTMP exposed)
- I: pnptv-web (nginx:alpine serving React SPA)
- J: pnptv-bot (node:18-slim + pg-pnptv + redis-pnptv) — **REPLACES PM2**

### Core Directives
- Zero Placeholders, Zero-Trust Network, SSO via Authentik only
- Only npm-proxy exposes HTTP/S; restreamer exposes 1935 (RTMP)
- Design System: Tailwind @pnptv/ui-kit; bg #1C1C1E, accent #FFB454

### Agent Personas
- [Infra], [DB], [Backend], [UI/UX], [QA]

## Project State — DEPLOYED
- VPS 1: 148.230.80.210 (KVM 4, 16GB RAM, 4 CPU)
- All 18 containers running on VPS (17 backend + 1 frontend)
- All 9 subdomains with Let's Encrypt SSL (HTTPS/HTTP2)
- NPM admin: admin@pnptv.app / Pnptv2026Adm1n (port 81)
- Host nginx: stopped + masked (conflicts with npm-proxy on port 80)
- DNS: 9 A records + wildcard via Hostinger API
- Frontend: https://app.pnptv.app (React SPA, Vite build, NPM proxy host ID 9, SSL cert ID 25)

## Key Technical Decisions
- **Project name: pnptvapp** (NOT easybots)
- Network name: pnptvapp_net (172.20.0.0/16)
- **Authentik: REQUIRES Redis** (redis-authentik) + env `AUTHENTIK_REDIS__HOST`
- Cal.com: YES Redis (dedicated redis-calcom for API v2)
- Bluesky PDS: SQLite internal, email vars COMMENTED OUT (partial config error)
- Element Web: mount config to `/usr/share/nginx/html/config.json` (NOT `/app/config.json`)
- Synapse PG: needs POSTGRES_INITDB_ARGS=--encoding=UTF-8 --lc-collate=C --lc-ctype=C
- Synapse first run: `docker compose run --rm synapse generate` then edit homeserver.yaml for PG
- 4 separate PostgreSQL instances + 2 Redis instances
- MariaDB version: `mariadb:10.11` (NOT 11)
- Volume base path: `./infrastructure/data/` (NOT `./volumes/`)
- Authentik media dir: `chown -R 1000:1000` required
- Authentik templates dir: `custom-templates` (maps to /templates)
- Authentik OIDC: provider pk=1, app slug=`pnptv-web`, client_id=`pnptv-web` (public), signing key RS256
- Authentik API token (akadmin): `gIiaKZ30Pht...` (identifier: pnptv-api-token, non-expiring)
- Authentik `create_token` CLI doesn't exist; use Django ORM via `docker exec python -c`

## Subdomain Routing (all verified HTTPS)
- app.pnptv.app -> pnptv-web:80 (React frontend)
- auth.pnptv.app -> authentik-server:9000
- cms.pnptv.app -> directus:8055
- media.pnptv.app -> ampache:80
- booking.pnptv.app -> calcom:3000
- social.pnptv.app -> bluesky-pds:3000
- chat.pnptv.app -> element-web:80
- matrix.pnptv.app -> synapse:8008
- live.pnptv.app -> restreamer:8080

## Environment
- VPS: Hostinger Ubuntu (148.230.80.210)
- Domain: pnptv.app
- Hostinger API: Available (key in conversation history — DO NOT store in files)
- DNS API: `PUT /api/dns/v1/zones/pnptv.app` with Bearer token

## Backend API Proxies (Deployed)
- `/api/proxy/media/tracks` — Ampache songs via AmpacheService (needs content in Ampache)
- `/api/proxy/media/search?q=` — Ampache search
- `/api/proxy/media/stream/:songId` — Stream URL
- `/api/proxy/live/streams` — Restreamer process list (auth disabled, JWT ready)
- `/api/proxy/social/feed` — Bluesky PDS posts via `com.atproto.repo.listRecords` (NOT getAuthorFeed — needs AppView)
- `/api/verify-age-self` — Self-declaration age verification

## Bluesky PDS Account
- Handle: `pnptv.social.pnptv.app`
- DID: `did:plc:rftqwgopzjd3jekibox3wdci`
- Account password: PnptvBluesky2026 (`PDS_ACCOUNT_PASSWORD` in .env)
- PDS admin password (Docker): `PDS_ADMIN_PASSWORD` (different from account password!)
- PDS admin password inside container differs from .env (79f1... vs dd44...)
- Admin API auth: Basic auth from INSIDE container only (external calls fail)
- Profile created with displayName "PNPTV"
- 5 posts created on PDS
- Self-hosted PDS: use `listRecords`/`getRecord` (not AppView-dependent endpoints like `getAuthorFeed`)
- Social proxy requires: `PDS_ADMIN_HANDLE` + `BLUESKY_PDS_URL` env vars

## Directus CMS Schema (Deployed)
- Version: 11.15.4
- 5 collections: performers, shows, content, announcements, pages
- Relations: shows→performers (M2O), content→performers (M2O)
- Public Read policy: `2284c552-55e9-48ac-92d6-1966afcd2189`
- Public read access for all 5 collections + directus_files (published items only)
- Admin: admin@pnptv.app

## Frontend Features (Deployed)
- VerificationGate component: age + terms gate wrapping content routes
- Media/Live/Social pages use backend proxy endpoints (not direct service calls)
- Home page integrates Directus announcements + featured performers
- React Router wraps media/live/booking/chat/social/profile with VerificationGate

## Container IPs (Docker inspect, may change on restart)
- ampache: 172.20.0.16
- restreamer: 172.20.0.7
- bluesky-pds: 172.20.0.9
- directus: 172.20.0.14
- authentik-server: 172.20.0.18

## Ampache Config (Deployed)
- Version: 7.9.0 (API v6.9.1)
- Admin: admin / PnptvAmpache2026 (admin@pnptv.app)
- Config: /var/www/config/ampache.cfg.php (copied from .dist)
- DB password in container differs from .env (use `docker inspect` values)
- MariaDB actual root pw: `226ff13faedb46b...` (from container env, NOT .env)
- MariaDB actual user pw: `6a0ba57c202acbb...` (from container env)
- Catalog: "PNPTV-Media" → /media (mounted ro from /var/www/pnptvbot-sandbox/public/media)
- Media: 5 sample MP3 tracks (fire-flow, luna-rising, night-vibes, tropical-heat, welcome-to-pnptv)
- API endpoint: http://172.20.0.16:80/server/json.server.php
- AMPACHE_URL in ecosystem.config.js: http://172.20.0.16:80 (was 127.0.0.1:32768, fixed)

## Directus Admin (Deployed)
- Actual admin password: `3ad6cb4006510c26e776e583ed99d13f` (from container env, differs from .env)
- DB password also differs from .env (use `docker inspect` values)

## Authentik SSO Providers (Deployed)
- API Token: `gIiaKZ30PhtPLvhfKnGjde8kFEsy07cFQ08kw3ojNegGRfvQJfVohSqmQcyY`
- Signing key: `ae973ec3-2862-4696-ba0a-bbb69a215c22`
- Auth flow: `c4941ebb-c809-40e5-836f-1e4963bf8c11` (default-provider-authorization-explicit-consent)
- Provider 1: pnptv-web (public, pk=1) → App: pnptv-web
- Provider 2: directus (confidential, pk=2) → App: directus
- Provider 3: calcom (confidential, pk=3) → App: calcom
- OIDC discovery: https://auth.pnptv.app/application/o/{slug}/.well-known/openid-configuration

## Restreamer Ingest (Deployed)
- Process: restreamer-ui:ingest:pnptv-main
- RTMP URL: rtmp://148.230.80.210:1935/live/pnptv
- HLS URL: https://live.pnptv.app/memfs/pnptv-main.m3u8
- State: "failed" when no stream is pushing (expected)

## Restreamer Config
- Auth disabled (API open)
- Memory storage creds: admin / FEY9IIRqm953Zz1yOu
- RTMP enabled on port 1935

## NPM Custom Locations (app.pnptv.app, ID 9)
- `/api/` → host.docker.internal:3001 (PM2 backend)
- `/webhook/` → host.docker.internal:3001 (PM2 backend)
- Without these, the SPA catch-all serves index.html for /api/* routes

## Matrix Synapse (Deployed)
- Switched from SQLite to PostgreSQL (pg-synapse)
- Admin: @admin:matrix.pnptv.app / PnptvMatrix2026
- Public room: #pnptv-general:matrix.pnptv.app
- Registration: disabled (invite-only via shared secret)
- Element Web: https://chat.pnptv.app (loads OK, dark theme)
- homeserver.yaml: /opt/pnptvapp/infrastructure/data/synapse/data/homeserver.yaml

## Telegram Bot (Deployed)
- Bot: @PNPLatinoTV_bot ("PNPtv App!")
- Webhook: https://pnptv.app/webhook/telegram (set, 0 pending)
- IP: 148.230.80.210 (verified by Telegram)

## Authentik Test User
- Username: testuser / TestPnptv2026! (pk=7)
- For testing SSO flows

## Production Hardening (Deployed)
- DB backups: daily at 3 AM UTC → /opt/pnptvapp/backups/ (7-day retention)
- Health check: every 15 min → /opt/pnptvapp/logs/health.log
- Log rotation: /etc/logrotate.d/pnptvapp (14 days, compress, 100M max)
- All 18 containers: restart policy = unless-stopped
- PM2: startup systemd + saved
- UFW: active (22, 80, 443, 1935 + Docker subnets for 3001)
- Disk: 60% used, RAM: 49% (7.8GB / 16GB)
- Scripts: backup-databases.sh, health-check.sh in /opt/pnptvapp/scripts/

## Env File Architecture
- `.env` — Docker Compose vars + fallback for Node.js (dotenv override:false)
- `.env.production` — Primary Node.js secrets (dotenv loads first)
- `ecosystem.config.js` — PM2 config, AMPACHE_URL=http://172.20.0.16:80
- Bot entry: `apps/backend/bot/core/bot.js` (loads dotenv from .env.production then .env)

## Cal.com Booking (Deployed)
- Admin: admin@pnptv.app / PnptvCalcom2026 (ADMIN role, user id=2)
- Team: "PNPTV" (id=1), admin is OWNER
- Profile: id=2, organizationId=1, username=admin
- Schedule: "Working Hours" (id=3), Mon-Fri 9-17 America/Mexico_City
- Event type: "Private Session" (30 min, slug: private-session)
- ALLOWED_HOSTNAMES: `["booking.pnptv.app"]` (added to docker-compose)
- Cal.com CSRF: uses `__Secure-` cookie prefix → must use HTTPS for API login
- Cal.com Profile: requires organizationId FK to Team table (NOT NULL)
- Cal.com OIDC: NOT available in open-source edition (Enterprise only)
- Authentik provider pk=3 configured but Cal.com NextAuth only shows credentials provider

## Directus Fix
- Uploads dir must be owned by uid 1000 (node user): `chown 1000:1000` from host
- /server/health needs write to /directus/uploads/directus-health-file

## Directus Content (Seeded)
- 2 announcements: "Welcome to PNPTV!" (news, pinned) + "New Features Available" (update)
- 6 performers: DJ Tropicana, Luna Estrella, MC Fuego, Valentina Rose, Carlos Vega, Aria Nova
- 4 shows: Tropical Nights Live, Latin Beats Live, Acoustic Evening, Luna Talk Show
- 2 pages: Terms of Service, Privacy Policy
- announcements.published_at must be set (was null initially → public filter failed)

## Element Web Mobile Fix
- Element bundle.js checks cookie `element_mobile_redirect_to_guide=false`
- Mount custom nginx template to `/etc/nginx/templates/default.conf.template` (NOT `/etc/nginx/conf.d/default.conf`)
- Set cookie via `add_header Set-Cookie "element_mobile_redirect_to_guide=false; Path=/; SameSite=Lax" always;`

## Hangout Groups (Deployed, Wired)
- 9 API routes at `/api/webapp/hangouts/groups/*` (lines 1743-1752 of routes.js)
- Controller: `hangoutGroupController.js` (408 lines, 9 endpoints)
- DB: `hangout_groups` + `hangout_group_members` tables, messages in `chat_messages` room=`hangout:{groupId}`
- Main group: "PNPTV Community" (id=1), 21+ real members
- **User ID architecture**: Session stores UUID as `user.id`, Telegram ID as `user.telegramId`
- **Auth-status returns BOTH**: `id` (UUID) + `telegram_id` (Telegram number)
- **Frontend PnptvUser**: `id` = Telegram ID, `dbId` = UUID (for backend comparisons)
- **isMe detection**: `msg.user_id === user?.dbId` (both UUIDs)
- **Bot token env var**: `BOT_TOKEN` (NOT `TELEGRAM_BOT_TOKEN`)
- **pnptv-web volume**: Bind mount `apps/web/dist` → `/usr/share/nginx/html` (NOT infrastructure/data/pnptv-web)
- **Frontend deploy**: Build on VPS (`cd apps/web && npx vite build`), then `docker restart pnptv-web`

## Deployment Lessons → see deployment-lessons.md
