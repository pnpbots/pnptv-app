#!/bin/bash
# =============================================================================
# WAL-G Continuous Backup Script for pg-pnptv (postgres:16-alpine)
# =============================================================================
#
# CRON: Run daily at 2 AM:
#   0 2 * * * bash /opt/pnptvapp/scripts/walg-backup.sh >> /opt/pnptvapp/logs/walg-backup.log 2>&1
#
# ARCHITECTURE:
#   pg-pnptv runs postgres:16-alpine (musl libc). WAL-G upstream releases are
#   glibc-linked binaries that won't execute on Alpine without a compatibility
#   shim. This script handles the bootstrap automatically:
#
#   1. On first run: downloads WAL-G pg binary (glibc) to the HOST at
#      /usr/local/bin/wal-g, then installs Alpine's gcompat package into the
#      pg-pnptv container so glibc-linked binaries execute correctly under musl,
#      then copies the binary into the container at /usr/local/bin/wal-g.
#
#   2. On subsequent runs: detects that wal-g is already installed inside the
#      container and skips the bootstrap. Only re-installs if the host binary
#      version differs from the requested version.
#
#   3. Backup storage is a named Docker volume (vol_pg_pnptv_walg_backups)
#      backed by /opt/pnptvapp/infrastructure/data/pnptv/walg-backups on the
#      host. This volume is mounted inside the container at
#      /var/lib/postgresql/walg-backups — WAL-G writes directly to it.
#
#   4. archive_command in docker-compose.yml is set to:
#        test -f /usr/local/bin/wal-g && wal-g wal-push %p || true
#      This gracefully no-ops if wal-g hasn't been bootstrapped yet.
#
# S3 MIGRATION:
#   When ready to switch to S3, replace WALG_FILE_PREFIX with:
#     WALG_S3_PREFIX=s3://your-bucket/pg-pnptv
#     AWS_ACCESS_KEY_ID=...
#     AWS_SECRET_ACCESS_KEY=...
#   All other logic remains identical.
#
# RESTORE / PITR:
#   See the commented-out RESTORE section at the bottom of this file.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WALG_VERSION="v3.0.8"
WALG_ASSET="wal-g-pg-24.04-amd64"
WALG_DOWNLOAD_URL="https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_ASSET}.tar.gz"
WALG_CHECKSUM_URL="https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_ASSET}.tar.gz.sha256"
HOST_WALG_BIN="/usr/local/bin/wal-g"

CONTAINER_NAME="pg-pnptv"
CONTAINER_WALG_BIN="/usr/local/bin/wal-g"
CONTAINER_BACKUP_DIR="/var/lib/postgresql/walg-backups"

# postgres user inside postgres:16-alpine is uid=70 gid=70
POSTGRES_UID=70
POSTGRES_GID=70

# WAL-G environment variables injected for every docker exec call
WALG_ENV=(
    -e "WALG_FILE_PREFIX=${CONTAINER_BACKUP_DIR}"
    -e "PGHOST=/var/run/postgresql"
    -e "PGUSER=pnptvbot"        # must match POSTGRES_USER in .env
    -e "PGDATABASE=pnptvbot"    # must match POSTGRES_DATABASE in .env
    -e "WALG_COMPRESSION_METHOD=brotli"
    -e "WALG_DELTA_MAX_STEPS=7"
    -e "WALG_RETAIN_AFTER_BACKUP=7"
)

# Retention: keep 7 full base backups + all WAL segments needed to restore them
FULL_BACKUP_RETAIN=7

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] [walg-backup]"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log()  { echo "${LOG_PREFIX} $*"; }
fail() { echo "${LOG_PREFIX} ERROR: $*" >&2; exit 1; }

container_running() {
    docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q "^true$"
}

container_exec() {
    # Run a command inside the container as the postgres user with WAL-G env vars
    docker exec "${WALG_ENV[@]}" --user postgres "${CONTAINER_NAME}" "$@"
}

container_exec_root() {
    # Run a command inside the container as root (for package installation)
    docker exec --user root "${CONTAINER_NAME}" "$@"
}

# ---------------------------------------------------------------------------
# Step 1: Verify the container is running
# ---------------------------------------------------------------------------

log "Starting WAL-G backup sequence for ${CONTAINER_NAME}"

if ! container_running; then
    fail "Container ${CONTAINER_NAME} is not running. Aborting."
fi

# ---------------------------------------------------------------------------
# Step 2: Bootstrap WAL-G into the container (idempotent)
#
# Strategy:
#   a) Download the glibc WAL-G binary to the host if not present or stale.
#   b) Install Alpine's 'gcompat' package inside the container — this provides
#      /lib/ld-linux-x86-64.so.2 so glibc-linked binaries execute on musl.
#   c) Copy the binary from host into the container via docker cp.
#
# This runs on every invocation but exits early once already installed.
# ---------------------------------------------------------------------------

install_walg_in_container() {
    log "Bootstrapping WAL-G ${WALG_VERSION} into ${CONTAINER_NAME}..."

    # --- Step 2a: Download WAL-G binary to host if not present or wrong version ---
    local needs_download=false
    if [[ ! -x "${HOST_WALG_BIN}" ]]; then
        log "  wal-g not found on host. Downloading..."
        needs_download=true
    else
        local installed_ver
        installed_ver=$("${HOST_WALG_BIN}" --version 2>/dev/null | grep -oP 'v[\d.]+' | head -1 || echo "unknown")
        if [[ "${installed_ver}" != "${WALG_VERSION}" ]]; then
            log "  Host wal-g version ${installed_ver} differs from target ${WALG_VERSION}. Re-downloading..."
            needs_download=true
        fi
    fi

    if [[ "${needs_download}" == "true" ]]; then
        local tmp_dir
        tmp_dir=$(mktemp -d)
        trap 'rm -rf "${tmp_dir}"' RETURN

        log "  Downloading ${WALG_DOWNLOAD_URL} ..."
        if ! curl -fsSL --retry 3 --retry-delay 5 "${WALG_DOWNLOAD_URL}" -o "${tmp_dir}/walg.tar.gz"; then
            fail "Failed to download WAL-G from GitHub releases."
        fi

        log "  Verifying checksum..."
        local expected_sha
        if curl -fsSL --retry 3 "${WALG_CHECKSUM_URL}" -o "${tmp_dir}/walg.sha256" 2>/dev/null; then
            expected_sha=$(awk '{print $1}' "${tmp_dir}/walg.sha256")
            local actual_sha
            actual_sha=$(sha256sum "${tmp_dir}/walg.tar.gz" | awk '{print $1}')
            if [[ "${expected_sha}" != "${actual_sha}" ]]; then
                fail "Checksum mismatch! Expected ${expected_sha}, got ${actual_sha}. Aborting for security."
            fi
            log "  Checksum OK: ${actual_sha}"
        else
            log "  WARNING: Could not fetch checksum file — skipping verification."
        fi

        log "  Extracting binary..."
        tar -xzf "${tmp_dir}/walg.tar.gz" -C "${tmp_dir}"
        local binary
        binary=$(find "${tmp_dir}" -type f -name "${WALG_ASSET}" | head -1)
        if [[ -z "${binary}" ]]; then
            fail "Could not find extracted binary '${WALG_ASSET}' in tarball."
        fi
        chmod 755 "${binary}"
        mv "${binary}" "${HOST_WALG_BIN}"
        log "  WAL-G ${WALG_VERSION} installed on host at ${HOST_WALG_BIN}"
    fi

    # --- Step 2b: Install gcompat inside the container (Alpine glibc compat shim) ---
    # gcompat provides /lib/ld-linux-x86-64.so.2, allowing glibc-linked binaries
    # to execute on musl-based Alpine.
    #
    # gcompat depends on: libgcc, musl-obstack, libucontext
    # All 4 packages are fetched from the Alpine CDN on the HOST (which has internet
    # access and glibc), then copied into the container and installed with --no-network.
    # This works even when the container has no DNS resolution.
    if ! container_exec_root sh -c "test -f /lib/ld-linux-x86-64.so.2"; then
        log "  Installing Alpine gcompat (glibc compat shim) — fetching packages on host..."

        local gcompat_tmp
        gcompat_tmp=$(mktemp -d)
        # Ensure cleanup even on error
        # shellcheck disable=SC2064
        trap "rm -rf '${gcompat_tmp}'" RETURN

        local alpine_ver
        alpine_ver=$(docker exec "${CONTAINER_NAME}" cat /etc/alpine-release 2>/dev/null | cut -d. -f1,2)
        local apk_base="https://dl-cdn.alpinelinux.org/alpine/v${alpine_ver}/main/x86_64"

        # Fetch APKINDEX on the host to discover current package versions dynamically
        log "    Fetching Alpine v${alpine_ver} APKINDEX..."
        if ! curl -fsSL --retry 3 "${apk_base}/APKINDEX.tar.gz" -o "${gcompat_tmp}/APKINDEX.tar.gz" 2>/dev/null; then
            fail "Cannot fetch Alpine APKINDEX. Host internet access required for first-time gcompat bootstrap."
        fi
        tar -xzf "${gcompat_tmp}/APKINDEX.tar.gz" -C "${gcompat_tmp}" APKINDEX

        # Parse version for a given package name from the APKINDEX file
        get_pkg_ver() {
            local pkg_name="$1"
            awk -v pkg="${pkg_name}" '
                /^P:/ { name = substr($0, 3) }
                /^V:/ && name == pkg { print substr($0, 3); exit }
            ' "${gcompat_tmp}/APKINDEX"
        }

        # gcompat dependency chain (all from main repo):
        #   gcompat -> musl-obstack, libucontext, libgcc
        local failed=false
        for pkg in libgcc musl-obstack libucontext gcompat; do
            local ver
            ver=$(get_pkg_ver "${pkg}")
            if [[ -z "${ver}" ]]; then
                log "    WARNING: Could not find version for ${pkg} in APKINDEX."
                failed=true
                continue
            fi
            local apk_file="${pkg}-${ver}.apk"
            log "    Downloading ${apk_file}..."
            if ! curl -fsSL --retry 3 "${apk_base}/${apk_file}" -o "${gcompat_tmp}/${pkg}.apk" 2>/dev/null; then
                log "    WARNING: Failed to download ${apk_file}."
                failed=true
            fi
        done

        if [[ "${failed}" == "true" ]]; then
            log "  WARNING: One or more gcompat packages failed to download."
            log "  Attempting online fallback (requires container DNS)..."
            container_exec_root sh -c "apk add --no-cache gcompat" || \
                fail "gcompat install failed both offline and online. Cannot run WAL-G in Alpine container."
        else
            # Copy all apks into the container and install with --no-network --allow-untrusted
            # --allow-untrusted bypasses signature verification since we have no APKINDEX cached in container.
            # The files were fetched over HTTPS from the official Alpine CDN — acceptable risk.
            for pkg in libgcc musl-obstack libucontext gcompat; do
                docker cp "${gcompat_tmp}/${pkg}.apk" "${CONTAINER_NAME}:/tmp/${pkg}.apk"
            done
            if ! container_exec_root sh -c \
                "apk add --no-network --allow-untrusted /tmp/libgcc.apk /tmp/musl-obstack.apk /tmp/libucontext.apk /tmp/gcompat.apk && rm -f /tmp/*.apk"; then
                fail "apk install of gcompat packages failed inside container."
            fi
        fi

        # Final verification
        if ! container_exec_root sh -c "test -f /lib/ld-linux-x86-64.so.2"; then
            fail "gcompat install did not produce /lib/ld-linux-x86-64.so.2. Cannot run glibc binaries in container."
        fi
        log "  gcompat installed successfully — /lib/ld-linux-x86-64.so.2 present."
    else
        log "  gcompat already installed in container."
    fi

    # --- Step 2c: Copy WAL-G binary into the container ---
    local container_ver
    container_ver=$(docker exec "${CONTAINER_NAME}" sh -c "${CONTAINER_WALG_BIN} --version 2>/dev/null | grep -oE 'v[0-9.]+' | head -1" 2>/dev/null || echo "none")
    if [[ "${container_ver}" != "${WALG_VERSION}" ]]; then
        log "  Copying WAL-G binary into container (container has: ${container_ver}, target: ${WALG_VERSION})..."
        docker cp "${HOST_WALG_BIN}" "${CONTAINER_NAME}:${CONTAINER_WALG_BIN}"
        container_exec_root chmod 755 "${CONTAINER_WALG_BIN}"
        log "  WAL-G ${WALG_VERSION} installed inside container at ${CONTAINER_WALG_BIN}"
    else
        log "  WAL-G ${WALG_VERSION} already present inside container — skipping copy."
    fi

    # Verify the binary executes correctly inside the container
    local verify_ver
    verify_ver=$(docker exec --user postgres "${CONTAINER_NAME}" sh -c "${CONTAINER_WALG_BIN} --version 2>&1" || echo "EXEC_FAILED")
    if echo "${verify_ver}" | grep -q "EXEC_FAILED\|error\|Error"; then
        fail "WAL-G binary fails to execute inside container. Output: ${verify_ver}"
    fi
    log "  Verified: ${verify_ver}"
}

install_walg_in_container

# ---------------------------------------------------------------------------
# Step 3: Ensure the backup storage directory is writable by postgres
# ---------------------------------------------------------------------------

log "Verifying backup storage permissions at ${CONTAINER_BACKUP_DIR}..."
if ! docker exec --user postgres "${CONTAINER_NAME}" sh -c "test -w ${CONTAINER_BACKUP_DIR}"; then
    log "  Fixing ownership of ${CONTAINER_BACKUP_DIR}..."
    container_exec_root chown -R "${POSTGRES_UID}:${POSTGRES_GID}" "${CONTAINER_BACKUP_DIR}"
fi
log "  Storage directory OK."

# ---------------------------------------------------------------------------
# Step 4: Take a full base backup
# ---------------------------------------------------------------------------

log "Starting base backup: wal-g backup-push..."
BACKUP_START_TS=$(date +%s)

if ! container_exec "${CONTAINER_WALG_BIN}" backup-push \
        --full \
        --permanent=false \
        /var/lib/postgresql/data; then
    fail "wal-g backup-push failed. Check logs above."
fi

BACKUP_END_TS=$(date +%s)
BACKUP_DURATION=$(( BACKUP_END_TS - BACKUP_START_TS ))
log "Base backup complete in ${BACKUP_DURATION}s."

# ---------------------------------------------------------------------------
# Step 5: Apply retention policy — keep last 7 full backups
#
# wal-g delete retain FULL 7 removes all backups beyond the 7 most recent
# full base backups, along with any WAL segments that are no longer needed
# to restore from those backups. The --confirm flag is required to actually
# execute the deletion (without it, wal-g only prints what would be deleted).
# ---------------------------------------------------------------------------

log "Applying retention policy: keeping last ${FULL_BACKUP_RETAIN} full backups..."
if ! container_exec "${CONTAINER_WALG_BIN}" delete \
        retain FULL "${FULL_BACKUP_RETAIN}" \
        --confirm; then
    log "WARNING: Retention policy application failed — manual cleanup may be needed."
fi
log "Retention policy applied."

# ---------------------------------------------------------------------------
# Step 6: List current backups for the log record
# ---------------------------------------------------------------------------

log "Current backup list:"
container_exec "${CONTAINER_WALG_BIN}" backup-list --detail 2>/dev/null \
    | sed 's/^/  /' || log "  (could not list backups)"

# ---------------------------------------------------------------------------
# Step 7: Report backup storage usage
# ---------------------------------------------------------------------------

log "Backup storage usage:"
du -sh /opt/pnptvapp/infrastructure/data/pnptv/walg-backups/ 2>/dev/null \
    | sed 's/^/  /' || true

log "WAL-G backup sequence complete."

# =============================================================================
# RESTORE / PITR INSTRUCTIONS (DO NOT RUN — READ BEFORE USE)
# =============================================================================
#
# PRE-REQUISITES:
#   - pg-pnptv container must be STOPPED before restoring data
#   - You need to know the target recovery point:
#       - Latest consistent state: use "LATEST" as the backup name
#       - Point-in-time: set WALG_PITR_TARGET_TIME to a specific timestamp
#   - The postgres data directory (/var/lib/postgresql/data) must be EMPTY
#     or the restore will fail (WAL-G will refuse to overwrite existing data)
#
# STEP 1 — Stop the running container:
#   docker compose stop pg-pnptv pnptv-bot
#
# STEP 2 — Wipe the data directory (IRREVERSIBLE — ensure backups are intact first):
#   rm -rf /opt/pnptvapp/infrastructure/data/pnptv/postgres/*
#
# STEP 3 — Start a recovery container using the same image and volumes:
#   docker run --rm -it \
#     -v /opt/pnptvapp/infrastructure/data/pnptv/postgres:/var/lib/postgresql/data \
#     -v /opt/pnptvapp/infrastructure/data/pnptv/walg-backups:/var/lib/postgresql/walg-backups \
#     -e WALG_FILE_PREFIX=/var/lib/postgresql/walg-backups \
#     -e PGDATA=/var/lib/postgresql/data \
#     --user postgres \
#     --entrypoint /bin/sh \
#     postgres:16-alpine
#
#   (Inside that shell, first install gcompat and copy wal-g binary as in Step 2 above,
#    then proceed with the commands below)
#
# STEP 4 — Restore the base backup:
#   # To restore the latest backup:
#   wal-g backup-fetch /var/lib/postgresql/data LATEST
#
#   # To restore a specific backup by name (get names from: wal-g backup-list):
#   wal-g backup-fetch /var/lib/postgresql/data base_000000010000000000000005
#
# STEP 5 — Configure recovery (PITR to a specific point in time):
#   # Create recovery.conf (PostgreSQL < 12) or postgresql.auto.conf entry (PG 12+)
#   # For pg-pnptv (PostgreSQL 16), create recovery signal and configure restore_command:
#
#   cat > /var/lib/postgresql/data/postgresql.auto.conf << 'EOF'
#   restore_command = 'wal-g wal-fetch %f %p'
#   # For PITR to a specific timestamp (UTC):
#   # recovery_target_time = '2026-03-20 03:00:00'
#   # recovery_target_action = 'promote'
#   EOF
#
#   # Create the recovery signal file (PG 12+ replaces recovery.conf):
#   touch /var/lib/postgresql/data/recovery.signal
#
# STEP 6 — Exit the recovery shell and start postgres normally:
#   exit  # from recovery container
#   docker compose up -d pg-pnptv
#
# STEP 7 — Monitor recovery progress:
#   docker logs -f pg-pnptv
#   # Watch for: "database system is ready to accept connections"
#   # PostgreSQL will apply WAL segments and promote when recovery is complete.
#
# STEP 8 — Start the application:
#   docker compose up -d pnptv-bot
#
# VERIFICATION after restore:
#   docker exec pg-pnptv psql -U pnptvbot -d pnptvbot -c "SELECT NOW(), COUNT(*) FROM users;"
#
# =============================================================================
