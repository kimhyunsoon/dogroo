#!/usr/bin/env bash
# 두그루 서버 셋업 스크립트 (CentOS 7, root로 실행)
# 사용법: bash server-setup.sh
# 재실행해도 안전하다 (완료된 단계는 건너뜀).
set -euo pipefail

REPO_SSH="git@github.com:kimhyunsoon/dogroo.git"
APP_DIR="/root/workspace/dogroo"
DATA_DIR="/root/workspace/dogroo-data"
WEBHOOK_VERSION="2.8.2"
# 앱 도메인 (Cloudflare DNS)
DOMAIN="dogroo.sudosoon.org"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
skip() { printf '    (이미 완료 - 건너뜀)\n'; }

# 실행 중 git reset으로 스크립트 자신이 갱신되어도 안전하도록 전체를 함수로 감싼다
main() {

[[ $EUID -eq 0 ]] || { echo "root로 실행하세요 (sudo -i)"; exit 1; }

# ── 1. yum 저장소를 vault로 교체 (CentOS 7 EOL 대응) ──────────────
step "1/8 yum 저장소 복구"
if grep -rq '^mirrorlist=' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null; then
  sed -i -e 's|^mirrorlist=|#mirrorlist=|' \
         -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' \
         /etc/yum.repos.d/CentOS-*.repo
  yum clean all && yum makecache
else
  skip
fi

# ── 2. git + Docker CE + compose plugin ───────────────────────────
step "2/8 Docker 설치"
if ! command -v docker >/dev/null; then
  yum install -y yum-utils git
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
  skip
fi
systemctl enable --now docker
# 구커널(3.10) 호환용 최신 seccomp 프로필 적용
if [[ ! -f /etc/docker/seccomp.json ]]; then
  curl -fsSL -o /etc/docker/seccomp.json \
    https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json
  printf '{ "seccomp-profile": "/etc/docker/seccomp.json" }\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
docker version --format '    docker {{.Server.Version}}'
# overlay2 사전 확인 (xfs ftype=0이면 컨테이너 파일시스템이 깨질 수 있음)
if xfs_info / >/dev/null 2>&1 && ! xfs_info / | grep -q 'ftype=1'; then
  echo "    ⚠ 경고: 루트 파일시스템 xfs ftype=0 - overlay2에 문제가 될 수 있음. 진행 전에 알려줄 것"
fi

# ── 3. GitHub Deploy Key ───────────────────────────────────────────
step "3/8 GitHub Deploy Key"
if [[ ! -f ~/.ssh/id_ed25519 ]]; then
  ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 >/dev/null
fi
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "    아래 공개키가 GitHub 리포에 등록되어 있어야 클론이 가능합니다:"
  echo "    github.com/kimhyunsoon/dogroo → Settings → Deploy keys → Add (read-only면 충분)"
  echo
  printf '\033[1;33m%s\033[0m\n' "$(cat ~/.ssh/id_ed25519.pub)"
  echo
  read -rp "    이미 등록했거나 방금 등록했다면 Enter를 누르세요... "
fi

# ── 4. 클론 또는 최신화 + 데이터 디렉토리 ──────────────────────────
step "4/8 리포 클론·최신화"
mkdir -p "$DATA_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  # git 1.8 호환 (FETCH_HEAD 기준으로 최신화)
  ( cd "$APP_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
else
  git clone "$REPO_SSH" "$APP_DIR"
fi

# ── 5. 시크릿 파일 (/etc/dogroo) ───────────────────────────────────
step "5/8 시크릿 파일"
mkdir -p /etc/dogroo
if [[ ! -f /etc/dogroo/deploy.env ]]; then
  read -rp "    DEPLOY_KEY (GitHub Secrets에 등록한 것과 동일한 난수): " deploy_key
  printf 'DEPLOY_KEY=%s\n' "$deploy_key" > /etc/dogroo/deploy.env
fi
if [[ ! -f /etc/dogroo/backend.env ]]; then
  read -rp "    앱 로그인 아이디: " app_user
  read -rsp "    앱 로그인 비밀번호: " app_pass; echo
  printf 'INITIAL_USERNAME=%s\nINITIAL_PASSWORD=%s\n' "$app_user" "$app_pass" > /etc/dogroo/backend.env
fi
chmod 600 /etc/dogroo/*.env 2>/dev/null || true
echo "    /etc/dogroo 준비 완료"

# ── 6. Cloudflare DNS (도메인 + IP 자동 갱신) ──────────────────────
step "6/8 Cloudflare DNS"
rm -f /etc/cron.d/duckdns # 구 DDNS 크론 제거
if [[ ! -f /etc/dogroo/cf.env ]]; then
  echo "    Cloudflare API 토큰이 필요합니다:"
  echo "    dash.cloudflare.com → 우측 상단 프로필 → My Profile → API Tokens → Create Token"
  echo "    → 'Edit zone DNS' 템플릿 선택, Zone Resources: sudosoon.org"
  read -rp "    CF API Token: " cf_token
  printf 'CF_TOKEN=%s\n' "$cf_token" > /etc/dogroo/cf.env
  chmod 600 /etc/dogroo/cf.env
fi
cat > /etc/cron.d/cf-ddns <<EOF
*/10 * * * * root bash ${APP_DIR}/deploy/cf-ddns.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/cf-ddns
echo "    레코드 등록·확인:"
bash "$APP_DIR/deploy/cf-ddns.sh" && echo "    완료 (${DOMAIN})"
# 도메인이 바뀌면 caddy.env 교체 (compose가 env_file 변경을 감지하지 못해 강제 재생성 필요)
CADDY_RECREATE=0
if ! grep -qs "DOGROO_DOMAIN=${DOMAIN}" /etc/dogroo/caddy.env; then
  printf 'DOGROO_DOMAIN=%s\n' "$DOMAIN" > /etc/dogroo/caddy.env
  chmod 600 /etc/dogroo/caddy.env
  CADDY_RECREATE=1
  echo "    도메인: $DOMAIN"
fi

# ── 7. 배포 웹훅 (adnanh/webhook + systemd) ────────────────────────
step "7/8 배포 웹훅"
if ! command -v webhook >/dev/null; then
  curl -fsSL -o /tmp/webhook.tar.gz \
    "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-linux-amd64.tar.gz"
  tar -xzf /tmp/webhook.tar.gz -C /tmp
  mv /tmp/webhook-linux-amd64/webhook /usr/local/bin/webhook
  rm -rf /tmp/webhook.tar.gz /tmp/webhook-linux-amd64
fi
cp "$APP_DIR/deploy/webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable webhook >/dev/null 2>&1
systemctl restart webhook
systemctl is-active webhook >/dev/null && echo "    webhook 실행 중 (:9099)"

# ── 8. 메인 스택 기동 ──────────────────────────────────────────────
step "8/8 앱 기동 (첫 빌드는 몇 분 걸립니다)"
cd "$APP_DIR/deploy"
docker compose up -d --build
if [[ "$CADDY_RECREATE" == "1" ]]; then
  echo "    도메인 변경 반영을 위해 caddy 재생성"
  docker compose up -d --force-recreate caddy
fi
echo
docker compose logs backend 2>/dev/null | tail -5

printf '\n\033[1;32m✔ 서버 셋업 완료. 남은 일:\033[0m\n'
cat <<EOF
  1. iptime 관리 페이지에서
     - 서버 내부 IP를 DHCP 고정 할당
     - 포트포워딩: 외부 80 → 서버:80, 외부 443 → 서버:443 (TCP)
  2. GitHub Secrets의 DEPLOY_URL을 https://${DOMAIN}/deploy/hook 으로
  3. 인증서 발급 확인: docker logs dogroo-caddy-1 2>&1 | grep -i cert
  4. 브라우저에서 https://${DOMAIN} 접속 → 로그인 확인
  5. 배포 테스트: 노트북에서 push → tail -f /var/log/dogroo-deploy.log
EOF
}

main "$@"
