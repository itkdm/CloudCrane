#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" != 0 ]]; then
  echo "run this verification on the Docker host as root" >&2
  exit 1
fi
container="${1:?usage: verify-cloudcrane-metadata-policy.sh WORKSPACE_CONTAINER}"
docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${container}" |
  grep -q '^cloudcrane-workspace-'
iptables -w -C DOCKER-USER -i 'br+' -j CLOUDCRANE-METADATA-DENY
iptables -w -C CLOUDCRANE-METADATA-DENY -d 100.100.100.200/32 -j REJECT

before="$(iptables -w -L CLOUDCRANE-METADATA-DENY -v -x -n | awk '$3 == "REJECT" { print $1; exit }')"
docker exec "${container}" sh -ec '
  ! curl --silent --show-error --connect-timeout 2 --max-time 3 http://100.100.100.200/latest/meta-data/instance-id >/dev/null
  ! curl --silent --show-error --connect-timeout 2 --max-time 3 -X PUT \
    -H "X-aliyun-ecs-metadata-token-ttl-seconds: 60" \
    http://100.100.100.200/latest/api/token >/dev/null
  curl --fail --silent --show-error --connect-timeout 5 --max-time 10 https://example.com >/dev/null
'
after="$(iptables -w -L CLOUDCRANE-METADATA-DENY -v -x -n | awk '$3 == "REJECT" { print $1; exit }')"
if [[ ! "${before}" =~ ^[0-9]+$ || ! "${after}" =~ ^[0-9]+$ || "${after}" -lt $((before + 2)) ]]; then
  echo "metadata deny rule did not reject both Workspace probes" >&2
  exit 1
fi
echo "Workspace metadata GET and token PUT were rejected by host policy; public HTTPS remains available"
