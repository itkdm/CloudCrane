#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.server.local"
SESSION_NAME="${CLOUDCRANE_TMUX_SESSION:-cloudcrane-acceptance}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "missing ${ENV_FILE}" >&2
  exit 1
fi
if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session already exists: ${SESSION_NAME}" >&2
  exit 1
fi

start_service() {
  local window_name="$1"
  local package_name="$2"
  tmux new-window -t "${SESSION_NAME}" -n "${window_name}" \
    "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && set +a && exec pnpm --filter '${package_name}' start"
}

tmux new-session -d -s "${SESSION_NAME}" -n gateway \
  "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && set +a && exec pnpm --filter @cloudcrane/workspace-gateway start"
start_service runner @cloudcrane/runner
start_service agent @cloudcrane/agent-service
start_service preview @cloudcrane/preview-gateway
tmux new-window -t "${SESSION_NAME}" -n web \
  "cd '${ROOT_DIR}' && set -a && . '${ENV_FILE}' && export NEXT_PUBLIC_AGENT_SERVICE_URL=http://localhost:4101 && set +a && exec pnpm --filter @cloudcrane/web start"

tmux select-window -t "${SESSION_NAME}:gateway"
echo "started tmux session: ${SESSION_NAME}"
echo "attach with: tmux attach -t ${SESSION_NAME}"
