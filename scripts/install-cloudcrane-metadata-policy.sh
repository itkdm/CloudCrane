#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly policy_source="${ROOT_DIR}/deploy/security/cloudcrane-metadata-deny"
readonly unit_source="${ROOT_DIR}/deploy/security/cloudcrane-metadata-deny.service"
readonly docker_dropin_source="${ROOT_DIR}/deploy/security/docker.service.d/cloudcrane-metadata-deny.conf"

if [[ "$(id -u)" != 0 ]]; then
  echo "run this host security installer as root" >&2
  exit 1
fi

install -o root -g root -m 0750 "${policy_source}" /usr/local/sbin/cloudcrane-metadata-deny
install -o root -g root -m 0644 "${unit_source}" /etc/systemd/system/cloudcrane-metadata-deny.service
install -D -o root -g root -m 0644 "${docker_dropin_source}" \
  /etc/systemd/system/docker.service.d/cloudcrane-metadata-deny.conf
systemctl daemon-reload
systemctl enable cloudcrane-metadata-deny.service
systemctl restart cloudcrane-metadata-deny.service
systemctl is-active --quiet cloudcrane-metadata-deny.service
iptables -w -C DOCKER-USER -i 'br+' -j CLOUDCRANE-METADATA-DENY
iptables -w -C CLOUDCRANE-METADATA-DENY -d 100.100.100.200/32 -j REJECT
iptables -w -C CLOUDCRANE-METADATA-DENY -d 169.254.0.0/16 -j REJECT
echo "CloudCrane Docker metadata deny policy is installed and active"
