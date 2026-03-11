# Deployment Lessons

## Termux / Local Dev
- `/tmp` ENOENT error on Termux: use `nohup` background commands as workaround
- npm workspaces require symlinks: Android /storage/emulated doesn't support them; must build from ~/pnptvapp-build (Termux home) then copy dist
- Build from Termux: use `--install-strategy=hoisted` to avoid missing transitive deps (tailwindcss)
- File upload to VPS: use `ssh root@IP "cat > /path" < local_file` (scp has /tmp issues)
- dist file permissions: must `chmod -R o+rX dist/` after upload (Android FS copies as 660)

## VPS / Docker
- Host nginx auto-restarts: must `systemctl mask nginx` not just disable
- NPM port conflict: always verify with `ss -tlnp | grep :80`
- NPM initial setup: use `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD` env vars
- NPM SSL API: meta only allows `dns_challenge`, NOT `letsencrypt_email`/`letsencrypt_agree`
- VPS project path: `/opt/pnptvapp/` (NOT /root/pnptvapp)

## DNS
- Hostinger DNS API: `PUT https://developers.hostinger.com/api/dns/v1/zones/pnptv.app` body: `{"overwrite":false,"zone":[...]}`

## Services
- Directus 11.15+: permissions require a `policy` + `access` entry (not just role+collection)
- Directus uploads dir: must be owned by uid 1000 (node user), chown from host side
- Directus /server/health: needs write access to /directus/uploads/directus-health-file
- PM2 env vars come from dotenv in bot.js, NOT from `pm2 restart --update-env`
- Self-hosted Bluesky PDS: `getAuthorFeed` needs AppView relay → use `listRecords` instead
- PDS account creation: requires invite code, then `createSession` to get JWT, then `putRecord` for profile
- Cal.com setup API: POST /api/auth/setup creates user + password (check "No setup needed" = user exists)
- Cal.com CSRF: uses `__Secure-` cookie prefix → must use HTTPS endpoint for login
- Cal.com Profile table: requires organizationId (FK to Team), create a Team first
- Cal.com tRPC endpoints return HTML when path is wrong → batch format: /api/trpc/viewer.me.update?batch=1
- Cal.com ALLOWED_HOSTNAMES: set as JSON array env var to suppress orgDomains warning
