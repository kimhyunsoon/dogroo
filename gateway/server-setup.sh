#!/usr/bin/env bash
# 게이트웨이 전환 + donoti 신규 배포 스크립트 (CentOS 7, root로 실행)
# 사용법: bash server-setup.sh
# 재실행해도 안전하다 (완료된 단계는 건너뜀).
#
# 전제:
#   - dogroo가 이미 이 서버에서 운영 중 (docker 설치, /etc/dogroo/* 존재)
#   - dogroo 리포의 main에 "gateway 폴더 + 자체 caddy 제거" 커밋이 push되어 있음
#   - donoti 리포가 GitHub에 push되어 있고 서버 Deploy Key가 등록되어 있음
set -euo pipefail

DONOTI_REPO_SSH="git@github.com:kimhyunsoon/donoti.git"
DOGROO_DIR="/root/workspace/dogroo"
GATEWAY_DIR="/root/workspace/dogroo/gateway"
DONOTI_DIR="/root/workspace/donoti"
DONOTI_DATA_DIR="/root/workspace/donoti-data"
DOGROO_DOMAIN="dogroo.sudosoon.org"
DONOTI_DOMAIN="donoti.sudosoon.org"
WEBHOOK_VERSION="2.8.2"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
skip() { printf '    (이미 완료 - 건너뜀)\n'; }

# 실행 중 git reset으로 스크립트 자신이 갱신되어도 안전하도록 전체를 함수로 감싼다
main() {

[[ $EUID -eq 0 ]] || { echo "root로 실행하세요 (sudo -i)"; exit 1; }
command -v docker >/dev/null || { echo "docker가 없습니다 - dogroo docs/server-setup.sh를 먼저 실행하세요"; exit 1; }
# webhook 바이너리 (adnanh/webhook, Go 단일 바이너리)
if ! command -v webhook >/dev/null; then
  curl -fsSL -o /tmp/webhook.tar.gz \
    "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-linux-amd64.tar.gz"
  tar -xzf /tmp/webhook.tar.gz -C /tmp
  mv /tmp/webhook-linux-amd64/webhook /usr/local/bin/webhook
  rm -rf /tmp/webhook.tar.gz /tmp/webhook-linux-amd64
fi

# ── 1. 리포 최신화 (dogroo) + 클론 (donoti) ────────────────────────
step "1/8 리포 최신화·클론"
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
# git 1.8 호환 (FETCH_HEAD 기준으로 최신화)
( cd "$DOGROO_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
grep -q 'container_name: dogroo-backend' "$DOGROO_DIR/deploy/docker-compose.yml" \
  || { echo "    ✖ dogroo main에 gateway 전환 커밋이 없습니다. dogroo를 먼저 push하세요."; exit 1; }
if [[ -d "$DONOTI_DIR/.git" ]]; then
  ( cd "$DONOTI_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
else
  git clone "$DONOTI_REPO_SSH" "$DONOTI_DIR"
fi
mkdir -p "$DONOTI_DATA_DIR"

# ── 2. 시크릿 파일 (/etc/gateway, /etc/donoti) ─────────────────────
step "2/8 시크릿 파일"
mkdir -p /etc/gateway /etc/donoti

# caddy.env: 두 도메인
if ! grep -qs "DONOTI_DOMAIN=${DONOTI_DOMAIN}" /etc/gateway/caddy.env; then
  printf 'DOGROO_DOMAIN=%s\nDONOTI_DOMAIN=%s\n' "$DOGROO_DOMAIN" "$DONOTI_DOMAIN" > /etc/gateway/caddy.env
fi

# deploy.env: dogroo 키는 기존 값 이전, donoti 키는 신규 생성
if [[ ! -f /etc/gateway/deploy.env ]]; then
  dogroo_key=$(grep -s '^DEPLOY_KEY=' /etc/dogroo/deploy.env | cut -d= -f2- || true)
  if [[ -z "$dogroo_key" ]]; then
    read -rp "    DEPLOY_KEY_DOGROO (dogroo GitHub Secrets의 DEPLOY_KEY): " dogroo_key
  fi
  donoti_key=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  printf 'DEPLOY_KEY_DOGROO=%s\nDEPLOY_KEY_DONOTI=%s\n' "$dogroo_key" "$donoti_key" > /etc/gateway/deploy.env
  echo "    donoti 배포 키 생성됨 → donoti GitHub Secrets의 DEPLOY_KEY로 등록하세요:"
  printf '\033[1;33m    %s\033[0m\n' "$donoti_key"
fi

# cf.env: 기존 토큰 이전
if [[ ! -f /etc/gateway/cf.env ]]; then
  if [[ -f /etc/dogroo/cf.env ]]; then
    cp /etc/dogroo/cf.env /etc/gateway/cf.env
  else
    read -rp "    Cloudflare API Token (Edit zone DNS): " cf_token
    printf 'CF_TOKEN=%s\n' "$cf_token" > /etc/gateway/cf.env
  fi
fi

# donoti backend.env
if [[ ! -f /etc/donoti/backend.env ]]; then
  read -rp "    donoti 로그인 아이디: " app_user
  read -rsp "    donoti 로그인 비밀번호: " app_pass; echo
  printf 'INITIAL_USERNAME=%s\nINITIAL_PASSWORD=%s\n' "$app_user" "$app_pass" > /etc/donoti/backend.env
fi
chmod 600 /etc/gateway/*.env /etc/donoti/*.env
echo "    /etc/gateway, /etc/donoti 준비 완료"

# ── 3. 공용 docker 네트워크 ────────────────────────────────────────
step "3/8 docker 네트워크 (gateway)"
if docker network inspect gateway >/dev/null 2>&1; then
  skip
else
  docker network create gateway
fi

# ── 4. Cloudflare DNS - donoti A 레코드 선등록 + 크론 교체 ─────────
step "4/8 Cloudflare DNS"
bash "$GATEWAY_DIR/cf-ddns.sh"
cat > /etc/cron.d/cf-ddns <<EOF
*/10 * * * * root bash ${GATEWAY_DIR}/cf-ddns.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/cf-ddns
echo "    (donoti 레코드를 방금 만들었다면 전파까지 몇 분 대기 후 진행 권장)"

# ── 5. donoti 이미지 사전 빌드 (다운타임 창 밖에서) ────────────────
step "5/8 donoti 이미지 사전 빌드 (첫 빌드는 몇 분 걸립니다)"
( cd "$DONOTI_DIR/deploy" && docker compose build )

# ── 6. 컷오버: dogroo 자체 caddy 제거 → gateway caddy 기동 ─────────
#     이 단계부터 gateway caddy가 뜰 때까지 수십 초 다운타임
step "6/8 컷오버 (dogroo caddy → gateway caddy)"
# 옛 caddy(80/443 점유)를 --remove-orphans로 제거하며 새 구성 적용
( cd "$DOGROO_DIR/deploy" && docker compose up -d --build --remove-orphans )
( cd "$GATEWAY_DIR" && docker compose up -d )
echo "    인증서 발급 확인 (수 초 내 완료):"
sleep 5
docker logs gateway-caddy 2>&1 | grep -i 'certificate obtained' | tail -4 || true

# ── 7. 웹훅 전환 (dogroo deploy 소속 → gateway 소속) ───────────────
step "7/8 배포 웹훅 전환"
cp "$GATEWAY_DIR/webhook.service" /etc/systemd/system/webhook.service
systemctl daemon-reload
systemctl enable webhook >/dev/null 2>&1
systemctl restart webhook
systemctl is-active webhook >/dev/null && echo "    webhook 실행 중 (:9099, 훅: dogroo·donoti)"

# ── 8. donoti 기동 ─────────────────────────────────────────────────
step "8/8 donoti 기동"
( cd "$DONOTI_DIR/deploy" && docker compose up -d )
docker compose -p donoti logs backend 2>/dev/null | tail -5 || true

printf '\n\033[1;32m✔ 전환 완료. 남은 일:\033[0m\n'
cat <<EOF
  1. 브라우저 확인: https://${DOGROO_DOMAIN} (기존 유지), https://${DONOTI_DOMAIN} (로그인)
  2. donoti GitHub Secrets 등록:
     - DEPLOY_URL = https://${DONOTI_DOMAIN}/deploy/hook
     - DEPLOY_KEY = /etc/gateway/deploy.env 의 DEPLOY_KEY_DONOTI 값
     (dogroo Secrets는 변경 불필요 - /deploy/hook 경로가 유지됨)
  3. 배포 테스트: 각 리포 push → tail -f /var/log/dogroo-deploy.log /var/log/donoti-deploy.log
  4. 이상 없으면 옛 리소스 정리:
     docker volume rm dogroo_caddy-data dogroo_caddy-config
     rm -f /etc/dogroo/caddy.env /etc/dogroo/deploy.env
롤백(문제 시): cd ${GATEWAY_DIR} && docker compose down
  → cd ${DOGROO_DIR} && git reset --hard <이전 커밋> && cd deploy && docker compose up -d --build
EOF
}

main "$@"
