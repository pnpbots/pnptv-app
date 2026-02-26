#!/usr/bin/env bash
# ============================================
# PNPTVAPP - Secret Generator v3
# Reads .env.example, replaces __GENERATE_ME__
# placeholders with secure random values,
# and writes the result to .env
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"
ENV_FILE="$PROJECT_ROOT/.env"

# Safety check: do not overwrite existing .env
if [ -f "$ENV_FILE" ]; then
  echo "ERROR: .env already exists. Remove it first if you want to regenerate."
  echo "  rm $ENV_FILE"
  exit 1
fi

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "ERROR: .env.example not found at $ENV_EXAMPLE"
  exit 1
fi

# Generate a random hex string of N characters
rand_hex() {
  openssl rand -hex "$1"
}

# Generate a base64 string of N bytes
rand_base64() {
  openssl rand -base64 "$1"
}

# Generate a UUID v4
rand_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen
  elif [ -f /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    openssl rand -hex 16 | sed 's/\(.\{8\}\)\(.\{4\}\)\(.\{4\}\)\(.\{4\}\)\(.\{12\}\)/\1-\2-\3-\4-\5/'
  fi
}

# Generate a secp256k1 private key in hex (for Bluesky PDS)
rand_k256_key() {
  if command -v openssl &> /dev/null; then
    openssl ecparam -name secp256k1 -genkey -noout -outform DER 2>/dev/null | tail -c +8 | head -c 32 | xxd -p -c 32 2>/dev/null || rand_hex 32
  else
    rand_hex 32
  fi
}

echo "Generating secrets for PNPTVAPP (v3 - 16 containers)..."
echo ""

# Start from .env.example
cp "$ENV_EXAMPLE" "$ENV_FILE"

# Map variable names to their generated values
declare -A SECRETS=(
  # Block B - Authentik
  ["PG_AUTH_PASSWORD"]="$(rand_hex 32)"
  ["AUTHENTIK_SECRET_KEY"]="$(rand_hex 64)"
  # Block C - Directus
  ["PG_DIRECTUS_PASSWORD"]="$(rand_hex 32)"
  ["DIRECTUS_KEY"]="$(rand_uuid)"
  ["DIRECTUS_SECRET"]="$(rand_hex 64)"
  ["DIRECTUS_ADMIN_PASS"]="$(rand_hex 16)"
  # Block D - Ampache
  ["MYSQL_AMPACHE_PASSWORD"]="$(rand_hex 32)"
  ["MYSQL_ROOT_PASSWORD"]="$(rand_hex 32)"
  # Block E - Cal.com
  ["PG_CALCOM_PASSWORD"]="$(rand_hex 32)"
  ["CALCOM_NEXTAUTH_SECRET"]="$(rand_base64 32)"
  ["CALCOM_ENCRYPTION_KEY"]="$(rand_base64 24)"
  # Block F - Bluesky PDS
  ["PDS_JWT_SECRET"]="$(rand_hex 32)"
  ["PDS_ADMIN_PASSWORD"]="$(rand_hex 16)"
  ["PDS_PLC_ROTATION_KEY"]="$(rand_k256_key)"
  # Block G - Matrix Synapse
  ["PG_SYNAPSE_PASSWORD"]="$(rand_hex 32)"
  ["SYNAPSE_REGISTRATION_SECRET"]="$(rand_hex 32)"
)

for KEY in "${!SECRETS[@]}"; do
  VALUE="${SECRETS[$KEY]}"
  sed -i "s|^${KEY}=__GENERATE_ME__.*|${KEY}=${VALUE}|" "$ENV_FILE"
done

echo "Secrets generated and written to: $ENV_FILE"
echo ""
echo "Generated values:"
echo "  --- Authentik ---"
echo "  PG_AUTH_PASSWORD           = (32 hex chars)"
echo "  AUTHENTIK_SECRET_KEY       = (64 hex chars)"
echo "  --- Directus ---"
echo "  PG_DIRECTUS_PASSWORD       = (32 hex chars)"
echo "  DIRECTUS_KEY               = (UUID v4)"
echo "  DIRECTUS_SECRET            = (64 hex chars)"
echo "  DIRECTUS_ADMIN_PASS        = (16 hex chars)"
echo "  --- Ampache ---"
echo "  MYSQL_AMPACHE_PASSWORD     = (32 hex chars)"
echo "  MYSQL_ROOT_PASSWORD        = (32 hex chars)"
echo "  --- Cal.com ---"
echo "  PG_CALCOM_PASSWORD         = (32 hex chars)"
echo "  CALCOM_NEXTAUTH_SECRET     = (base64 32 bytes)"
echo "  CALCOM_ENCRYPTION_KEY      = (base64 24 bytes)"
echo "  --- Bluesky PDS ---"
echo "  PDS_JWT_SECRET             = (32 hex chars)"
echo "  PDS_ADMIN_PASSWORD         = (16 hex chars)"
echo "  PDS_PLC_ROTATION_KEY       = (secp256k1 private key)"
echo "  --- Matrix Synapse ---"
echo "  PG_SYNAPSE_PASSWORD        = (32 hex chars)"
echo "  SYNAPSE_REGISTRATION_SECRET= (32 hex chars)"
echo ""
echo "IMPORTANT: Review .env and set these manually:"
echo "  - DOMAIN_ROOT (default: pnptv.app)"
echo "  - DIRECTUS_ADMIN_EMAIL"
echo "  - CALCOM_LICENSE_KEY (optional, for API v2)"
echo "  - PDS_EMAIL_SMTP_URL (for Bluesky email validation)"
echo "  nano $ENV_FILE"
