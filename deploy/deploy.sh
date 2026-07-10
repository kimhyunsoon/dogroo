#!/usr/bin/env bash
# 사용법: deploy.sh <targets>   (쉼표 구분: backend,frontend,deploy)
# webhook(hooks.json)이 호출. 직접 실행해도 동작한다.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/workspace/dogroo}"
LOG_FILE="${DEPLOY_LOG:-/var/log/dogroo-deploy.log}"

# 동시 배포 직렬화 - 앞선 배포가 끝날 때까지 대기
exec 9>/tmp/dogroo-deploy.lock
flock 9

{
  echo "[$(date '+%F %T')] 배포 시작: ${1:-}"

  cd "$REPO_DIR"
  # git 1.8 호환 (FETCH_HEAD 기준으로 최신화)
  git fetch origin main
  git reset --hard FETCH_HEAD

  cd deploy
  IFS=',' read -ra targets <<< "${1:-}"

  if [[ " ${targets[*]-} " == *" deploy "* ]]; then
    # 배포 구성 자체가 바뀜 → 전체 재적용 (caddy 포함)
    docker compose up -d --build
  else
    docker compose build "${targets[@]}"
    docker compose up -d "${targets[@]}"
  fi

  # 사용하지 않는 이전 이미지 정리
  docker image prune -f
  echo "[$(date '+%F %T')] 배포 완료"
} >> "$LOG_FILE" 2>&1
