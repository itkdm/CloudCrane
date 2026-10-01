#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR="/opt/cloudcrane"
RELEASES_DIR="/opt/cloudcrane-releases"
STATE_DIR="/var/lib/cloudcrane/deploy"
BACKUP_DIR="/var/backups/cloudcrane/postgres"
SESSION_NAME="cloudcrane-production"
TARGET_SHA="${1:-}"

if [[ ! "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "expected a full commit SHA" >&2
  exit 64
fi

cd "${CONTROL_DIR}"
git fetch --quiet origin main
REMOTE_MAIN="$(git rev-parse origin/main)"
if [[ "${REMOTE_MAIN}" != "${TARGET_SHA}" ]]; then
  echo "requested commit is not the current origin/main" >&2
  exit 65
fi

PREVIOUS_SHA="$(cat "${STATE_DIR}/current-sha" 2>/dev/null || git rev-parse HEAD)"
RELEASE_DIR="${RELEASES_DIR}/${TARGET_SHA}"
mkdir -p "${RELEASES_DIR}" "${STATE_DIR}" "${BACKUP_DIR}"
chmod 700 "${STATE_DIR}" "${BACKUP_DIR}"

if [[ ! -d "${RELEASE_DIR}" ]]; then
  git worktree add --detach "${RELEASE_DIR}" "${TARGET_SHA}"
fi
for env_file in .env.server.local .env.private.local; do
  if [[ -f "${CONTROL_DIR}/${env_file}" && ! -e "${RELEASE_DIR}/${env_file}" ]]; then
    ln -s "${CONTROL_DIR}/${env_file}" "${RELEASE_DIR}/${env_file}"
  fi
done

cd "${RELEASE_DIR}"
pnpm install --frozen-lockfile
set -a
. ./.env.server.local
if [[ -f ./.env.private.local ]]; then
  . ./.env.private.local
fi
set +a
pnpm build
nginx -t

# Build the runtime image on the ECS that owns the Docker daemon used by Runner.
# GitHub CI builds the same Dockerfile for validation; Runner cannot pull images from CI.
if [[ -n "${PRODUCTION_HOST_SUFFIX:-}" ]]; then
  docker build \
    -f docker/production-pboot/Dockerfile \
    -t "${PRODUCTION_IMAGE:-cloudcrane-production-pboot:v1}" \
    .
fi

DB_CONTAINER="$(docker compose -f "${CONTROL_DIR}/docker/compose/docker-compose.server.yml" ps -q postgres)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "production PostgreSQL container is not running" >&2
  exit 66
fi
BACKUP_FILE="${BACKUP_DIR}/predeploy-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_SHA:0:7}.dump"
docker exec "${DB_CONTAINER}" sh -c \
  'pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' > "${BACKUP_FILE}"
if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo "PostgreSQL backup is empty" >&2
  exit 67
fi
chmod 600 "${BACKUP_FILE}"

pnpm --filter @cloudcrane/db db:migrate
pnpm --filter @cloudcrane/db db:backfill-preview-slugs

tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
CLOUDCRANE_TMUX_SESSION="${SESSION_NAME}" bash ./scripts/server-acceptance-start.sh

healthy() {
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/api/auth/get-session >/dev/null &&
    curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4101/health >/dev/null &&
    curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4102/health >/dev/null &&
    curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4103/health >/dev/null &&
    { [[ -z "${PRODUCTION_HOST_SUFFIX:-}" ]] || curl --fail --silent --show-error --max-time 5 http://127.0.0.1:4104/health >/dev/null; }
}

healthy_after=0
for attempt in $(seq 1 60); do
  if healthy; then
    healthy_after=1
    break
  fi
  sleep 5
done

if [[ "${healthy_after}" != "1" ]]; then
  echo "new release failed health checks; restoring previous application release" >&2
  tmux kill-session -t "${SESSION_NAME}" 2>/dev/null || true
  if [[ -d "${RELEASES_DIR}/${PREVIOUS_SHA}" ]]; then
    PREVIOUS_DIR="${RELEASES_DIR}/${PREVIOUS_SHA}"
  else
    PREVIOUS_DIR="${CONTROL_DIR}"
  fi
  if [[ ! -f "${PREVIOUS_DIR}/.env.server.local" && -f "${CONTROL_DIR}/.env.server.local" ]]; then
    ln -s "${CONTROL_DIR}/.env.server.local" "${PREVIOUS_DIR}/.env.server.local"
  fi
  if [[ ! -f "${PREVIOUS_DIR}/.env.private.local" && -f "${CONTROL_DIR}/.env.private.local" ]]; then
    ln -s "${CONTROL_DIR}/.env.private.local" "${PREVIOUS_DIR}/.env.private.local"
  fi
  CLOUDCRANE_TMUX_SESSION="${SESSION_NAME}" bash "${PREVIOUS_DIR}/scripts/server-acceptance-start.sh"
  exit 68
fi

printf '%s\n' "${TARGET_SHA}" > "${STATE_DIR}/current-sha.tmp"
mv "${STATE_DIR}/current-sha.tmp" "${STATE_DIR}/current-sha"
echo "production deployment healthy: ${TARGET_SHA}"
