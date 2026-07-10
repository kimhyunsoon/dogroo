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

# 공인 IP 조회 - cloudflare trace 우선, 실패 시 ipify(http) 폴백
ip=$(curl -s https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -o '^ip=[0-9.]*' | cut -d= -f2 || true)
if [[ -z "$ip" ]]; then
  ip=$(curl -s http://api.ipify.org 2>/dev/null || true)
fi
[[ "$ip" =~ ^[0-9.]+$ ]] || { echo "공인 IP 조회 실패"; exit 1; }

zone_json=$(cf "${API}/zones?name=${ZONE_NAME}")
zone_id=$(echo "$zone_json" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)
[[ -n "$zone_id" ]] || { echo "zone 조회 실패: ${zone_json:0:200}"; exit 1; }

record_json=$(cf "${API}/zones/${zone_id}/dns_records?type=A&name=${RECORD_NAME}")
record_id=$(echo "$record_json" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)
current_ip=$(echo "$record_json" | grep -o '"content":"[0-9.]*"' | head -1 | cut -d'"' -f4 || true)

payload="{\"type\":\"A\",\"name\":\"${RECORD_NAME}\",\"content\":\"${ip}\",\"ttl\":300,\"proxied\":false}"

if [[ -z "$record_id" ]]; then
  result=$(cf -X POST "${API}/zones/${zone_id}/dns_records" --data "$payload")
  echo "$result" | grep -q '"success":true' || { echo "레코드 생성 실패: ${result:0:200}"; exit 1; }
  echo "A 레코드 생성: ${RECORD_NAME} → ${ip}"
elif [[ "$current_ip" != "$ip" ]]; then
  result=$(cf -X PUT "${API}/zones/${zone_id}/dns_records/${record_id}" --data "$payload")
  echo "$result" | grep -q '"success":true' || { echo "레코드 갱신 실패: ${result:0:200}"; exit 1; }
  echo "IP 갱신: ${current_ip} → ${ip}"
else
  echo "변경 없음: ${RECORD_NAME} → ${ip}"
fi
