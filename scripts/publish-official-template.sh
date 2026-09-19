#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mkdir -p "${TMP_DIR}/template/default" "${TMP_DIR}/static"
cp "${ROOT_DIR}/templates/official-enterprise/template/default/README.md" "${TMP_DIR}/template/default/README.md"
cp "${ROOT_DIR}/templates/official-enterprise/static/README.md" "${TMP_DIR}/static/README.md"
if command -v zip >/dev/null 2>&1; then
  (cd "${TMP_DIR}" && zip -q -r "${TMP_DIR}/official-enterprise.zip" template static)
else
  python3 - "${TMP_DIR}" "${TMP_DIR}/official-enterprise.zip" <<'PY'
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
archive = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
    for path in (root / "template", root / "static").rglob("*"):
        if path.is_file():
            output.write(path, path.relative_to(root).as_posix())
PY
fi

exec pnpm template:publish \
  "--archive=${TMP_DIR}/official-enterprise.zip" \
  --name="企业展示起点" \
  --description="适用于企业展示的 PbootCMS 网站起点" \
  --category="企业官网"
