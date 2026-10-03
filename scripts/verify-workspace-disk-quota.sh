#!/usr/bin/env bash
set -Eeuo pipefail

readonly workspace_root="${WORKSPACE_ROOT:-/var/lib/cloudcrane/workspaces-quota}"
readonly workspace_image="${WORKSPACE_IMAGE:-website-workspace-pboot:v1}"
readonly quota_a="${workspace_root}/.quota-acceptance-a-$$"
readonly quota_b="${workspace_root}/.quota-acceptance-b-$$"
readonly project_a=$((1800000000 + $$ % 100000000))
readonly project_b=$((project_a + 1))

if [[ "$(id -u)" != 0 ]]; then
  echo "run Workspace disk quota verification on the Docker host as root" >&2
  exit 1
fi
findmnt -T "${workspace_root}" -no FSTYPE,OPTIONS | grep -q '^ext4 .*prjquota'
quotaon -P -p "${workspace_root}" | grep -q 'project quota on .* is on'
curl --fail --silent --show-error http://127.0.0.1:4102/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:4104/health >/dev/null

cleanup() {
  rm -rf -- "${quota_a}" "${quota_b}"
  setquota -P "${project_a}" 0 0 0 0 "${workspace_root}" || true
  setquota -P "${project_b}" 0 0 0 0 "${workspace_root}" || true
}
trap cleanup EXIT

mkdir "${quota_a}" "${quota_b}"
chown 1000:1000 "${quota_a}" "${quota_b}"
chattr -p "${project_a}" "${quota_a}"
chattr +P "${quota_a}"
chattr -p "${project_b}" "${quota_b}"
chattr +P "${quota_b}"
setquota -P "${project_a}" 0 16384 0 10000 "${workspace_root}"
setquota -P "${project_b}" 0 65536 0 10000 "${workspace_root}"

if docker run --rm --network none --user 1000:1000 --entrypoint /bin/sh \
  -v "${quota_a}:/workspace:rw" "${workspace_image}" \
  -ec 'dd if=/dev/zero of=/workspace/fill bs=1M count=24 conv=fsync status=none'; then
  echo "Workspace A wrote beyond its 16 MiB project quota" >&2
  exit 1
fi
written="$(stat --format=%s "${quota_a}/fill")"
if (( written > 16 * 1024 * 1024 )); then
  echo "Workspace A exceeded its hard disk quota (${written} bytes)" >&2
  exit 1
fi

docker run --rm --network none --user 1000:1000 --entrypoint /bin/sh \
  -v "${quota_b}:/workspace:rw" "${workspace_image}" \
  -ec 'dd if=/dev/zero of=/workspace/fill bs=1M count=32 conv=fsync status=none'
test "$(stat --format=%s "${quota_b}/fill")" -eq $((32 * 1024 * 1024))
echo "Workspace A hit ENOSPC at its hard quota; Workspace B stayed writable; Runner and Production Gateway health checks passed"
