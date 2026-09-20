#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.server.local"
PRIVATE_ENV_FILE="${ROOT_DIR}/.env.private.local"
SESSION_NAME="${CLOUDCRANE_TMUX_SESSION:-cloudcrane-acceptance}"
LOG_DIR="${CLOUDCRANE_LOG_DIR:-/var/log/cloudcrane}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi
if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session already exists: ${SESSION_NAME}" >&2
  exit 1
fi
mkdir -p "${LOG_DIR}"
chmod 750 "${LOG_DIR}"

start_service() {
  local window_name="$1"
  local package_name="$2"
  tmux new-window -t "${SESSION_NAME}" -n "${window_name}" \
    "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && if [[ -f '${PRIVATE_ENV_FILE}' ]]; then . '${PRIVATE_ENV_FILE}'; fi && set +a && exec pnpm --filter '${package_name}' start"
}

tmux new-session -d -s "${SESSION_NAME}" -n gateway \
  "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && if [[ -f '${PRIVATE_ENV_FILE}' ]]; then . '${PRIVATE_ENV_FILE}'; fi && set +a && exec pnpm --filter @cloudcrane/workspace-gateway start"
start_service runner @cloudcrane/runner
start_service agent @cloudcrane/agent-service
start_service preview @cloudcrane/preview-gateway
tmux new-window -t "${SESSION_NAME}" -n web \
    "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && if [[ -f '${PRIVATE_ENV_FILE}' ]]; then . '${PRIVATE_ENV_FILE}'; fi && export NEXT_PUBLIC_AGENT_SERVICE_URL=\"\${NEXT_PUBLIC_AGENT_SERVICE_URL:-http://localhost:4101}\" && set +a && exec pnpm --filter @cloudcrane/web exec next start -H 127.0.0.1"

for window in gateway runner agent preview web; do
  tmux pipe-pane -t "${SESSION_NAME}:${window}" -o "cat >> '${LOG_DIR}/${window}.log'"
done

tmux select-window -t "${SESSION_NAME}:gateway"
echo "started tmux session: ${SESSION_NAME}"
echo "attach with: tmux attach -t ${SESSION_NAME}"
