#!/usr/bin/env bash
set -Eeuo pipefail

readonly image="/var/lib/cloudcrane/workspaces-quota.ext4"
readonly quota_root="/var/lib/cloudcrane/workspaces-quota"
readonly image_size_bytes=$((30 * 1024 * 1024 * 1024))
readonly root_reserve_bytes=$((10 * 1024 * 1024 * 1024))
source_root="${WORKSPACE_ROOT:-/var/lib/cloudcrane/workspaces}"

if [[ "$(id -u)" != 0 ]]; then
  echo "run Workspace quota storage provisioning as root" >&2
  exit 1
fi
if [[ "${source_root}" == "${quota_root}" ]]; then
  source_root="${quota_root}"
fi
command -v mkfs.ext4 >/dev/null 2>&1 && command -v tune2fs >/dev/null 2>&1 || {
  echo "ext4 project-quota tools are required" >&2
  exit 1
}
if ! command -v setquota >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq quota
fi
command -v rsync >/dev/null 2>&1 || {
  echo "rsync is required for safe Workspace storage migration" >&2
  exit 1
}

mkdir -p "${quota_root}" /var/lib/cloudcrane
if [[ ! -f "${image}" ]]; then
  available_bytes="$(df -PB1 /var/lib/cloudcrane | awk 'NR == 2 { print $4 }')"
  if [[ ! "${available_bytes}" =~ ^[0-9]+$ ]] ||
    (( available_bytes < image_size_bytes + root_reserve_bytes )); then
    echo "not enough free host disk for the Workspace quota filesystem and recovery reserve" >&2
    exit 1
  fi
  image_temporary="${image}.tmp.$$"
  trap 'rm -f "${image_temporary}"' EXIT
  truncate -s "${image_size_bytes}" "${image_temporary}"
  mkfs.ext4 -F -q -O project,quota "${image_temporary}"
  tune2fs -Q prjquota "${image_temporary}" >/dev/null
  mv "${image_temporary}" "${image}"
  trap - EXIT
fi

if ! grep -Fq "${image} ${quota_root} ext4 loop,prjquota 0 0" /etc/fstab; then
  printf '%s\n' "${image} ${quota_root} ext4 loop,prjquota 0 0" >>/etc/fstab
fi
if ! mountpoint -q "${quota_root}"; then
  mount "${quota_root}"
fi
findmnt -T "${quota_root}" -no FSTYPE,OPTIONS | grep -q '^ext4 .*prjquota' || {
  echo "Workspace quota mount is not ext4 with project quotas enabled" >&2
  exit 1
}
loop_device="$(losetup --associated "${image}" --noheadings --output NAME | xargs)"
mount_source="$(findmnt -T "${quota_root}" --noheadings --output SOURCE | xargs)"
if [[ -z "${loop_device}" || "${mount_source}" != "${loop_device}" ]]; then
  echo "Workspace quota mount does not use the configured quota image" >&2
  exit 1
fi
tune2fs -l "${image}" | grep -q 'project' || {
  echo "Workspace quota filesystem lacks project ID tracking" >&2
  exit 1
}

if [[ "${source_root}" != "${quota_root}" ]]; then
  if [[ -d "${source_root}" ]] && find "${source_root}" -mindepth 1 -print -quit | grep -q .; then
    mapfile -t workspace_containers < <(docker ps -q --filter 'name=^/cloudcrane-workspace-')
    if ((${#workspace_containers[@]} > 0)); then
      docker stop "${workspace_containers[@]}" >/dev/null
    fi
    rsync -aHAX --numeric-ids --delete --exclude=/lost+found/ "${source_root}/" "${quota_root}/"
  fi
  local_env="/opt/cloudcrane/.env.server.local"
  if [[ ! -f "${local_env}" ]]; then
    echo "CloudCrane server environment file was not found; Workspace storage root was not changed" >&2
    exit 1
  fi
  temporary_env="$(mktemp "${local_env}.XXXXXX")"
  awk -v root="${quota_root}" '
    BEGIN { replaced = 0 }
    /^WORKSPACE_ROOT=/ { print "WORKSPACE_ROOT=" root; replaced = 1; next }
    { print }
    END { if (!replaced) print "WORKSPACE_ROOT=" root }
  ' "${local_env}" >"${temporary_env}"
  chmod --reference="${local_env}" "${temporary_env}"
  chown --reference="${local_env}" "${temporary_env}"
  mv "${temporary_env}" "${local_env}"
fi

quotaon -P -p "${quota_root}" | grep -q 'project quota on .* is on' || {
  echo "project quota accounting is not active on the Workspace filesystem" >&2
  exit 1
}
echo "Workspace storage is mounted with ext4 project quotas"
