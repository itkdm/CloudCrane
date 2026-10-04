#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" != 0 ]]; then
  echo "run this host security verification as root" >&2
  exit 1
fi

policy_bin="/usr/local/sbin/cloudcrane-metadata-deny"
policy_service="cloudcrane-metadata-deny.service"
docker_dropin="/etc/systemd/system/docker.service.d/cloudcrane-metadata-deny.conf"

if [[ ! -x "${policy_bin}" ]]; then
  echo "metadata deny policy executable is missing; refusing to start CloudCrane services" >&2
  exit 1
fi
if ! systemctl is-enabled --quiet "${policy_service}"; then
  echo "metadata deny policy service is not enabled; refusing to start CloudCrane services" >&2
  exit 1
fi
if ! systemctl is-active --quiet "${policy_service}"; then
  echo "metadata deny policy service is not active; refusing to start CloudCrane services" >&2
  exit 1
fi
if [[ ! -f "${docker_dropin}" ]] || \
  ! grep -Fqx 'ExecStartPost=/usr/local/sbin/cloudcrane-metadata-deny' "${docker_dropin}"; then
  echo "Docker metadata policy restart hook is missing; refusing to start CloudCrane services" >&2
  exit 1
fi

if ! "${policy_bin}" --check-only; then
  echo "host firewall metadata policy is missing or incorrectly ordered; refusing to start CloudCrane services" >&2
  exit 1
fi

echo "CloudCrane Docker metadata deny policy is enabled, active, and installed"
