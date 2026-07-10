#!/usr/bin/env bash
# Cloudflare DNS A 레코드를 현재 공인 IP로 유지한다 (유동 IP 대응)
# 필요: /etc/dogroo/cf.env 의 CF_TOKEN (Edit zone DNS 권한)
set -euo pipefail

source /etc/dogroo/cf.env
ZONE_NAME="sudosoon.org"
RECORD_NAME="dogroo.sudosoon.org"
API="https://api.cloudflare.com/client/v4"

cf() {
  curl -s -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" "$@"
}

ip=$(curl -s https://api.ipify.org)
[[ -n "$ip" ]] || { echo "공인 IP 조회 실패"; exit 1; }

zone_id=$(cf "${API}/zones?name=${ZONE_NAME}" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4)
[[ -n "$zone_id" ]] || { echo "zone 조회 실패 (토큰 권한 확인)"; exit 1; }

record_json=$(cf "${API}/zones/${zone_id}/dns_records?type=A&name=${RECORD_NAME}")
record_id=$(echo "$record_json" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4)
current_ip=$(echo "$record_json" | grep -o '"content":"[0-9.]*"' | head -1 | cut -d'"' -f4)

payload="{\"type\":\"A\",\"name\":\"${RECORD_NAME}\",\"content\":\"${ip}\",\"ttl\":300,\"proxied\":false}"

if [[ -z "$record_id" ]]; then
  cf -X POST "${API}/zones/${zone_id}/dns_records" --data "$payload" >/dev/null
  echo "A 레코드 생성: ${RECORD_NAME} → ${ip}"
elif [[ "$current_ip" != "$ip" ]]; then
  cf -X PUT "${API}/zones/${zone_id}/dns_records/${record_id}" --data "$payload" >/dev/null
  echo "IP 갱신: ${current_ip} → ${ip}"
fi
