#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${TMP_DIR}/template/default" "${TMP_DIR}/static"
cp "${ROOT_DIR}/templates/official-enterprise/template/default/README.md" "${TMP_DIR}/template/default/README.md"
cp "${ROOT_DIR}/templates/official-enterprise/static/README.md" "${TMP_DIR}/static/README.md"
(cd "${TMP_DIR}" && zip -q -r "${TMP_DIR}/official-enterprise.zip" template static)

exec pnpm template:publish \
  "--archive=${TMP_DIR}/official-enterprise.zip" \
  --name="企业展示起点" \
  --description="适用于企业展示的 PbootCMS 网站起点" \
  --category="企业官网"
