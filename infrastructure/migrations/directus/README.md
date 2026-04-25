# Directus DB migrations

Schema changes that target the **Directus** Postgres database (`directus_db`),
separate from the main `pnptvbot` migrations under `apps/backend/migrations/`.

## Why a separate folder

Directus owns its own schema (collections, fields, relations, flows). Most
Directus changes are made through the Studio UI and persisted in
`directus_collections` / `directus_fields` / `directus_relations`. When we
need a Postgres-level change that the Studio can't make on its own — or when
a Studio-managed change has to be replayed against a fresh DB volume — it
goes here as a numbered SQL file.

## How to run

```bash
# Apply a single migration
docker exec -i pg-directus psql -U directus_user -d directus_db \
  < infrastructure/migrations/directus/001_prime_videos_thumbnails.sql

# After schema changes, restart Directus so it reloads field metadata
docker compose restart directus
```

All migrations are written to be idempotent (`IF NOT EXISTS`,
`ON CONFLICT DO NOTHING`) — re-running them on a DB that already has the
schema is a no-op.

## When to add one

- A new column on a Directus-managed table that the bot or webapp needs to
  read/write directly.
- Registering field metadata in `directus_fields` so REST PATCH accepts a
  field (Directus silently drops unknown fields otherwise).
- Backfilling Directus rows that need to exist before the corresponding
  Studio operation can be performed.

## When NOT to add one

- Standard collection/field creation — do it in Studio, it's tracked in DB.
- Directus Flows + operations — Studio + API only; flows live in
  `directus_flows` / `directus_operations` and are restored from the DB
  volume backup.
