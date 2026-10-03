#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_DIR="${1:-$(pwd)}"
CURRENT_BASE_ROOT="${WORKSPACE_MANAGED_PBOOT_BASE_ROOT:-/var/lib/cloudcrane/pbootcms-base}"
BASE_REGISTRY_ROOT="${WORKSPACE_MANAGED_PBOOT_BASE_REGISTRY_ROOT:-/var/lib/cloudcrane/pbootcms-bases}"
RELEASES_FILE="${CONTROL_DIR}/docker/workspace-pboot/pboot-releases.json"

if [[ ! -f "${RELEASES_FILE}" ]]; then
  echo "Pboot release registry is missing" >&2
  exit 64
fi

mkdir -p "${BASE_REGISTRY_ROOT}"

releases="$(node -e 'const r=require(process.argv[1]); for(const [v,x] of Object.entries(r)) console.log(`${v}\t${x.sourceCommit}`)' "${RELEASES_FILE}")"
if [[ -z "${releases}" ]]; then
  echo "Pboot release registry is empty" >&2
  exit 65
fi

while IFS=$'\t' read -r version commit; do
  [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "invalid Pboot version in release registry" >&2
    exit 65
  }
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "invalid Pboot source commit in release registry" >&2
    exit 65
  }

  current_marker="${CURRENT_BASE_ROOT}/.cloudcrane-base"
  if [[ -f "${current_marker}" ]] &&
    grep -qxF "pbootcms=${version}" "${current_marker}" &&
    grep -qxF "sourceCommit=${commit}" "${current_marker}"; then
    continue
  fi

  target="${BASE_REGISTRY_ROOT}/${version}-${commit}"
  marker="${target}/.cloudcrane-base"
  if [[ -L "${target}" ]]; then
    echo "managed Pboot base registry entry must not be a symlink" >&2
    exit 66
  fi
  if [[ -e "${target}" ]]; then
    if [[ -f "${marker}" ]] &&
      grep -qxF "pbootcms=${version}" "${marker}" &&
      grep -qxF "sourceCommit=${commit}" "${marker}"; then
      continue
    fi
    echo "existing managed Pboot base does not match the trusted registry" >&2
    exit 66
  fi

  temporary="$(mktemp -d "${BASE_REGISTRY_ROOT}/.install-${version}.XXXXXX")"
  trap 'chmod -R u+w -- "${temporary}" 2>/dev/null || true; rm -rf -- "${temporary}"' EXIT
  mkdir "${temporary}/source" "${temporary}/base"
  git -C "${temporary}/source" init --quiet
  git -C "${temporary}/source" remote add origin https://github.com/pbootcmspro/PbootCMS.git
  git -C "${temporary}/source" fetch --quiet --depth=1 origin "${commit}"
  actual_commit="$(git -C "${temporary}/source" rev-parse FETCH_HEAD)"
  if [[ "${actual_commit}" != "${commit}" ]]; then
    echo "upstream Pboot source commit does not match the trusted registry" >&2
    exit 67
  fi
  git -C "${temporary}/source" archive "${commit}" | tar -xf - -C "${temporary}/base"
  printf 'pbootcms=%s\nsourceCommit=%s\n' "${version}" "${commit}" > "${temporary}/base/.cloudcrane-base"
  mv -T "${temporary}/base" "${target}"
  chmod -R a-w "${target}"
  chmod -R u+w -- "${temporary}"
  rm -rf -- "${temporary}"
  trap - EXIT
done <<< "${releases}"

echo "trusted managed Pboot base registry is ready"
