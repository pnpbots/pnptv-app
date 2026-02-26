#!/bin/bash
# ==============================================================================
# Directus CMS Schema Setup / Configuración del esquema CMS de Directus
# Creates 5 collections: performers, shows, content, announcements, pages
# Crea 5 colecciones: performers, shows, content, announcements, pages
# ==============================================================================
#
# Usage / Uso:
#   DIRECTUS_URL=https://cms.pnptv.app DIRECTUS_TOKEN=your_admin_token ./setup-directus-schema.sh
#
# Requirements / Requisitos:
#   - Directus admin token (static token from admin user settings)
#   - curl and jq installed on the machine
# ==============================================================================

set -euo pipefail

DIRECTUS_URL="${DIRECTUS_URL:-https://cms.pnptv.app}"
DIRECTUS_TOKEN="${DIRECTUS_TOKEN:-}"

if [ -z "$DIRECTUS_TOKEN" ]; then
  echo "ERROR: DIRECTUS_TOKEN is required. Set it as environment variable."
  echo "  Get it from Directus Admin → Settings → Your Profile → Token"
  exit 1
fi

AUTH="Authorization: Bearer ${DIRECTUS_TOKEN}"
CT="Content-Type: application/json"

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [ -n "$data" ]; then
    curl -s -X "$method" "${DIRECTUS_URL}${path}" \
      -H "$AUTH" -H "$CT" -d "$data"
  else
    curl -s -X "$method" "${DIRECTUS_URL}${path}" \
      -H "$AUTH" -H "$CT"
  fi
}

echo "=== PNPTV Directus Schema Setup ==="
echo "Target: ${DIRECTUS_URL}"
echo ""

# 1. performers
echo "[1/5] Creating 'performers' collection..."
api POST "/collections" '{
  "collection": "performers",
  "meta": {
    "icon": "person",
    "note": "Public performer profiles / Perfiles públicos de artistas",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  },
  "schema": {},
  "fields": [
    {"field": "id", "type": "integer", "meta": {"hidden": true, "interface": "input", "readonly": true}, "schema": {"is_primary_key": true, "has_auto_increment": true}},
    {"field": "status", "type": "string", "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [{"text": "Published", "value": "published"}, {"text": "Draft", "value": "draft"}, {"text": "Archived", "value": "archived"}]}, "default_value": "draft"}, "schema": {"default_value": "draft"}},
    {"field": "sort", "type": "integer", "meta": {"hidden": true, "interface": "input"}, "schema": {}},
    {"field": "date_created", "type": "timestamp", "meta": {"special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half"}, "schema": {}},
    {"field": "date_updated", "type": "timestamp", "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half"}, "schema": {}},
    {"field": "name", "type": "string", "meta": {"interface": "input", "required": true, "width": "half", "note": "Performer display name"}, "schema": {"is_nullable": false}},
    {"field": "slug", "type": "string", "meta": {"interface": "input", "width": "half", "note": "URL-friendly identifier (unique)"}, "schema": {"is_unique": true}},
    {"field": "bio", "type": "text", "meta": {"interface": "input-rich-text-md", "note": "Performer biography (markdown)"}, "schema": {}},
    {"field": "photo", "type": "uuid", "meta": {"interface": "file-image", "special": ["file"], "note": "Profile photo"}, "schema": {}},
    {"field": "categories", "type": "json", "meta": {"interface": "tags", "note": "e.g. music, talk_show, entertainment", "options": {"presets": ["music", "talk_show", "entertainment", "comedy", "dj"]}}, "schema": {}},
    {"field": "social_links", "type": "json", "meta": {"interface": "input-code", "options": {"language": "json"}, "note": "JSON: {instagram, twitter, tiktok, ...}"}, "schema": {}},
    {"field": "is_featured", "type": "boolean", "meta": {"interface": "boolean", "width": "half", "note": "Show on homepage"}, "schema": {"default_value": false}}
  ]
}'
echo " done"

# 2. shows
echo "[2/5] Creating 'shows' collection..."
api POST "/collections" '{
  "collection": "shows",
  "meta": {
    "icon": "event",
    "note": "Scheduled shows and events / Eventos programados",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  },
  "schema": {},
  "fields": [
    {"field": "id", "type": "integer", "meta": {"hidden": true, "interface": "input", "readonly": true}, "schema": {"is_primary_key": true, "has_auto_increment": true}},
    {"field": "status", "type": "string", "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [{"text": "Published", "value": "published"}, {"text": "Draft", "value": "draft"}]}, "default_value": "draft"}, "schema": {"default_value": "draft"}},
    {"field": "date_created", "type": "timestamp", "meta": {"special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "date_updated", "type": "timestamp", "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "title", "type": "string", "meta": {"interface": "input", "required": true, "width": "full"}, "schema": {"is_nullable": false}},
    {"field": "description", "type": "text", "meta": {"interface": "input-rich-text-md"}, "schema": {}},
    {"field": "performer", "type": "integer", "meta": {"interface": "select-dropdown-m2o", "special": ["m2o"], "note": "Related performer"}, "schema": {}},
    {"field": "cover_image", "type": "uuid", "meta": {"interface": "file-image", "special": ["file"]}, "schema": {}},
    {"field": "scheduled_at", "type": "timestamp", "meta": {"interface": "datetime", "width": "half", "required": true}, "schema": {"is_nullable": false}},
    {"field": "duration_minutes", "type": "integer", "meta": {"interface": "input", "width": "half"}, "schema": {}},
    {"field": "category", "type": "string", "meta": {"interface": "select-dropdown", "width": "half", "options": {"choices": [{"text": "Music", "value": "music"}, {"text": "Talk Show", "value": "talk_show"}, {"text": "Entertainment", "value": "entertainment"}, {"text": "Special Event", "value": "special"}]}}, "schema": {}},
    {"field": "is_premium", "type": "boolean", "meta": {"interface": "boolean", "width": "half"}, "schema": {"default_value": false}}
  ]
}'
echo " done"

# 3. content
echo "[3/5] Creating 'content' collection..."
api POST "/collections" '{
  "collection": "content",
  "meta": {
    "icon": "movie",
    "note": "VOD/audio catalog items / Catálogo de contenido bajo demanda",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  },
  "schema": {},
  "fields": [
    {"field": "id", "type": "integer", "meta": {"hidden": true, "interface": "input", "readonly": true}, "schema": {"is_primary_key": true, "has_auto_increment": true}},
    {"field": "status", "type": "string", "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [{"text": "Published", "value": "published"}, {"text": "Draft", "value": "draft"}]}, "default_value": "draft"}, "schema": {"default_value": "draft"}},
    {"field": "date_created", "type": "timestamp", "meta": {"special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "date_updated", "type": "timestamp", "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "title", "type": "string", "meta": {"interface": "input", "required": true}, "schema": {"is_nullable": false}},
    {"field": "description", "type": "text", "meta": {"interface": "input-rich-text-md"}, "schema": {}},
    {"field": "performer", "type": "integer", "meta": {"interface": "select-dropdown-m2o", "special": ["m2o"]}, "schema": {}},
    {"field": "type", "type": "string", "meta": {"interface": "select-dropdown", "width": "half", "options": {"choices": [{"text": "Video", "value": "video"}, {"text": "Audio", "value": "audio"}, {"text": "Podcast", "value": "podcast"}]}}, "schema": {}},
    {"field": "media_url", "type": "string", "meta": {"interface": "input", "note": "Direct URL or Ampache stream URL"}, "schema": {}},
    {"field": "thumbnail", "type": "uuid", "meta": {"interface": "file-image", "special": ["file"]}, "schema": {}},
    {"field": "duration_seconds", "type": "integer", "meta": {"interface": "input", "width": "half"}, "schema": {}},
    {"field": "is_premium", "type": "boolean", "meta": {"interface": "boolean", "width": "half"}, "schema": {"default_value": false}},
    {"field": "tags", "type": "json", "meta": {"interface": "tags"}, "schema": {}}
  ]
}'
echo " done"

# 4. announcements
echo "[4/5] Creating 'announcements' collection..."
api POST "/collections" '{
  "collection": "announcements",
  "meta": {
    "icon": "campaign",
    "note": "Platform news and updates / Noticias y actualizaciones",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  },
  "schema": {},
  "fields": [
    {"field": "id", "type": "integer", "meta": {"hidden": true, "interface": "input", "readonly": true}, "schema": {"is_primary_key": true, "has_auto_increment": true}},
    {"field": "status", "type": "string", "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [{"text": "Published", "value": "published"}, {"text": "Draft", "value": "draft"}]}, "default_value": "draft"}, "schema": {"default_value": "draft"}},
    {"field": "date_created", "type": "timestamp", "meta": {"special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "title", "type": "string", "meta": {"interface": "input", "required": true}, "schema": {"is_nullable": false}},
    {"field": "body", "type": "text", "meta": {"interface": "input-rich-text-md"}, "schema": {}},
    {"field": "type", "type": "string", "meta": {"interface": "select-dropdown", "width": "half", "options": {"choices": [{"text": "News", "value": "news"}, {"text": "Update", "value": "update"}, {"text": "Alert", "value": "alert"}]}}, "schema": {}},
    {"field": "is_pinned", "type": "boolean", "meta": {"interface": "boolean", "width": "half"}, "schema": {"default_value": false}},
    {"field": "published_at", "type": "timestamp", "meta": {"interface": "datetime", "width": "half"}, "schema": {}}
  ]
}'
echo " done"

# 5. pages
echo "[5/5] Creating 'pages' collection..."
api POST "/collections" '{
  "collection": "pages",
  "meta": {
    "icon": "article",
    "note": "Static pages (terms, privacy, about) / Páginas estáticas",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  },
  "schema": {},
  "fields": [
    {"field": "id", "type": "integer", "meta": {"hidden": true, "interface": "input", "readonly": true}, "schema": {"is_primary_key": true, "has_auto_increment": true}},
    {"field": "status", "type": "string", "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [{"text": "Published", "value": "published"}, {"text": "Draft", "value": "draft"}]}, "default_value": "draft"}, "schema": {"default_value": "draft"}},
    {"field": "date_created", "type": "timestamp", "meta": {"special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "date_updated", "type": "timestamp", "meta": {"special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true}, "schema": {}},
    {"field": "title", "type": "string", "meta": {"interface": "input", "required": true}, "schema": {"is_nullable": false}},
    {"field": "slug", "type": "string", "meta": {"interface": "input", "note": "URL-friendly identifier (unique)"}, "schema": {"is_unique": true}},
    {"field": "content", "type": "text", "meta": {"interface": "input-rich-text-html", "note": "Rich text content"}, "schema": {}}
  ]
}'
echo " done"

# Set up M2O relations
echo ""
echo "Setting up relations..."

# shows.performer → performers
api POST "/relations" '{
  "collection": "shows",
  "field": "performer",
  "related_collection": "performers",
  "meta": {"one_field": "shows", "sort_field": null, "one_deselect_action": "nullify"},
  "schema": {"on_delete": "SET NULL"}
}'
echo "  shows.performer → performers"

# content.performer → performers
api POST "/relations" '{
  "collection": "content",
  "field": "performer",
  "related_collection": "performers",
  "meta": {"one_field": "content_items", "sort_field": null, "one_deselect_action": "nullify"},
  "schema": {"on_delete": "SET NULL"}
}'
echo "  content.performer → performers"

# Set public read access for all collections
echo ""
echo "Setting public read access..."
for coll in performers shows content announcements pages; do
  api POST "/permissions" "{
    \"role\": null,
    \"collection\": \"${coll}\",
    \"action\": \"read\",
    \"fields\": [\"*\"],
    \"permissions\": {\"status\": {\"_eq\": \"published\"}}
  }"
  echo "  public read: ${coll} (published only)"
done

echo ""
echo "=== Schema setup complete! ==="
echo "Visit ${DIRECTUS_URL} to manage content."
