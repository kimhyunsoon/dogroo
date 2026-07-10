#!/usr/bin/env bash
# 사용법: deploy.sh <targets...>  (backend | frontend | deploy)
# hook-server.mjs가 호출. 직접 실행해도 동작한다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/srv/dogroo/app}"
cd "$REPO_DIR"

echo "git 최신화 (origin/main)"
git fetch origin main
git reset --hard origin/main

cd deploy

if [[ " $* " == *" deploy "* ]]; then
  # 배포 구성 자체가 바뀜 → 전체 재적용 (caddy 포함)
  echo "compose 전체 재적용"
  docker compose up -d --build
else
  echo "대상 재빌드: $*"
  docker compose build "$@"
  docker compose up -d "$@"
fi

# 사용하지 않는 이전 이미지 정리
docker image prune -f
echo "배포 완료"
