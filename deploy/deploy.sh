#!/usr/bin/env bash
# 사용법: deploy.sh <targets>   (인자는 웹훅 페이로드 호환용 - 항상 전체 재적용)
# gateway/hooks.json의 webhook이 호출. 직접 실행해도 동작한다.
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
  # 항상 전체 재적용 - 변경 없는 이미지는 Docker 캐시로 수 초에 끝난다
  # (--remove-orphans: compose에서 제거된 서비스의 잔류 컨테이너 정리)
  docker compose up -d --build --remove-orphans

  # 게이트웨이(../gateway)도 함께 재적용 - 변경 없으면 no-op.
  # Caddyfile 변경은 무중단 reload로 반영. 컷오버 전(옛 caddy가 80/443 점유)에는 실패해도 무해
  if docker network inspect gateway >/dev/null 2>&1; then
    ( cd ../gateway && docker compose up -d ) || echo "게이트웨이 적용 실패 (컷오버 전이면 정상)"
    docker exec gateway-caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
  fi

  # 사용하지 않는 이전 이미지 정리
  docker image prune -f
  echo "[$(date '+%F %T')] 배포 완료"
} >> "$LOG_FILE" 2>&1
