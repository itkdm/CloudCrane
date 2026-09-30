#!/usr/bin/env bash
set -euo pipefail

COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [[ "${COMMAND}" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  TARGET_SHA="${BASH_REMATCH[1]}"
else
  echo "only a deployment request is allowed" >&2
  exit 64
fi

CONTROL_DIR="/opt/cloudcrane"
cd "${CONTROL_DIR}"
git fetch --quiet origin main
if [[ "$(git rev-parse origin/main)" != "${TARGET_SHA}" ]]; then
  echo "requested commit is not the current origin/main" >&2
  exit 65
fi

DEPLOY_SCRIPT="/run/cloudcrane-deploy-${TARGET_SHA}.sh"
trap 'rm -f "${DEPLOY_SCRIPT}"' EXIT
git show "${TARGET_SHA}:scripts/deploy-production.sh" > "${DEPLOY_SCRIPT}"
chmod 700 "${DEPLOY_SCRIPT}"
bash "${DEPLOY_SCRIPT}" "${TARGET_SHA}"
