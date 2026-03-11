PNPTVAPP - MASTER ARCHITECTURE DOCUMENT v4

1. Tech Stack & Environment

Monorepo: NPM Workspaces (/apps and /packages).
Infrastructure: Hostinger VPS (Ubuntu), Docker Compose (25 containers, 11 blocks), Nginx Reverse Proxy.
Frontend: React 18, Vite, Tailwind CSS, Telegram WebApp SDK.
Backend: Node.js (Express), Telegraf (Telegram Bot).
Self-Hosted Core: Authentik (SSO/Identity), Directus (Headless CMS/CRM), Ampache (VOD/Audio), Restreamer (Live), Element/Matrix (Chat), BTCPay (Bitcoin/Dash payments).

2. Core Directives (CRITICAL)

Zero Placeholders: Never use // implement here. Write the complete code.
SSO Rule: Node.js NEVER stores passwords. It validates Telegram's initData and asks Authentik for an OIDC token.
CLI Autonomy: You have Bash access. Read files, run npm install, mkdir, and docker compose as needed, but ask for permission before destructive actions.
Design System: Only use Tailwind classes from @pnptv/ui-kit. Primary bg: #1C1C1E, Accent: #FFB454.

3. Agent Personas

When I start a prompt with "Act as Agent [X]", assume that persona:
[Agent Infra]: Docker, Nginx, Hostinger VPS optimization.
[Agent DB]: Relational data modeling, Directus schema.
[Agent Backend]: Node.js, Express, Cryptography (Telegram Auth), OIDC.
[Agent UI/UX]: React, Tailwind, Mobile-first Telegram Mini Apps.
[Agent QA]: Security audits, writing Jest/React Testing Library tests.

4. Container Blocks

Block A - npm-proxy (Nginx Proxy Manager)
Block B - authentik-server, authentik-worker, pg-authentik, redis-authentik
Block C - directus, pg-directus
Block D - ampache, mariadb-ampache
Block E - calcom, pg-calcom, redis-calcom
Block F - bluesky-pds
Block G - synapse, element-web, pg-synapse
Block H - restreamer
Block I - pnptv-bot, pg-pnptv, redis-pnptv
Block J - btcpay-server, btcpay-nbxplorer, pg-btcpay, dashd
Block K - pnptv-web
