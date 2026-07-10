#!/usr/bin/env bash
# 두그루 서버 셋업 스크립트 (CentOS 7, root로 실행)
# 사용법: bash server-setup.sh
# 재실행해도 안전하다 (완료된 단계는 건너뜀).
set -euo pipefail

REPO_SSH="git@github.com:kimhyunsoon/dogroo.git"
APP_DIR="/root/workspace/dogroo"
DATA_DIR="/root/workspace/dogroo-data"
WEBHOOK_VERSION="2.8.2"
DEFAULT_DOMAIN="sudosoon.iptime.org"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
skip() { printf '    (이미 완료 - 건너뜀)\n'; }

[[ $EUID -eq 0 ]] || { echo "root로 실행하세요 (sudo -i)"; exit 1; }

# ── 1. yum 저장소를 vault로 교체 (CentOS 7 EOL 대응) ──────────────
step "1/7 yum 저장소 복구"
if grep -rq '^mirrorlist=' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null; then
  sed -i -e 's|^mirrorlist=|#mirrorlist=|' \
         -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' \
         /etc/yum.repos.d/CentOS-*.repo
  yum clean all && yum makecache
else
  skip
fi

# ── 2. git + Docker CE + compose plugin ───────────────────────────
step "2/7 Docker 설치"
if ! command -v docker >/dev/null; then
  yum install -y yum-utils git
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
  skip
fi
systemctl enable --now docker
# 커널 3.10 + 최신 Node 이미지 호환: 구식 seccomp이 새 시스템콜에 EPERM을 돌려줘
# pnpm 등이 깨진다 → 최신 프로필(미지원 시 ENOSYS 반환)로 교체
if [[ ! -f /etc/docker/seccomp.json ]]; then
  curl -fsSL -o /etc/docker/seccomp.json \
    https://raw.githubusercontent.com/moby/moby/master/profiles/seccomp/default.json
  printf '{ "seccomp-profile": "/etc/docker/seccomp.json" }\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
docker version --format '    docker {{.Server.Version}}'
# overlay2 사전 확인 (xfs ftype=0이면 컨테이너 파일시스템이 깨질 수 있음)
if xfs_info / >/dev/null 2>&1 && ! xfs_info / | grep -q 'ftype=1'; then
  echo "    ⚠ 경고: 루트 파일시스템 xfs ftype=0 - overlay2에 문제가 될 수 있음. 진행 전에 알려줄 것"
fi

# ── 3. GitHub Deploy Key ───────────────────────────────────────────
step "3/7 GitHub Deploy Key"
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

# ── 4. 클론 + 데이터 디렉토리 ──────────────────────────────────────
step "4/7 리포 클론"
mkdir -p "$DATA_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  skip
else
  git clone "$REPO_SSH" "$APP_DIR"
fi

# ── 5. 시크릿 파일 (/etc/dogroo) ───────────────────────────────────
step "5/7 시크릿 파일"
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
if [[ ! -f /etc/dogroo/caddy.env ]]; then
  read -rp "    도메인 [$DEFAULT_DOMAIN]: " domain
  printf 'DOGROO_DOMAIN=%s\n' "${domain:-$DEFAULT_DOMAIN}" > /etc/dogroo/caddy.env
fi
chmod 600 /etc/dogroo/*.env
echo "    /etc/dogroo 준비 완료"

# ── 6. 배포 웹훅 (adnanh/webhook + systemd) ────────────────────────
step "6/7 배포 웹훅"
if ! command -v webhook >/dev/null; then
  curl -fsSL -o /tmp/webhook.tar.gz \
    "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/webhook-linux-amd64.tar.gz"
  tar -xzf /tmp/webhook.tar.gz -C /tmp
  mv /tmp/webhook-linux-amd64/webhook /usr/local/bin/webhook
  rm -rf /tmp/webhook.tar.gz /tmp/webhook-linux-amd64
fi
cp "$APP_DIR/deploy/webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now webhook
systemctl is-active webhook >/dev/null && echo "    webhook 실행 중 (:9099)"

# ── 7. 메인 스택 기동 ──────────────────────────────────────────────
step "7/7 앱 기동 (첫 빌드는 몇 분 걸립니다)"
cd "$APP_DIR/deploy"
docker compose up -d --build
echo
docker compose logs backend 2>/dev/null | tail -5

printf '\n\033[1;32m✔ 서버 셋업 완료. 남은 일:\033[0m\n'
cat <<'EOF'
  1. iptime 관리 페이지에서
     - 서버 내부 IP를 DHCP 고정 할당
     - 포트포워딩: 외부 80 → 서버:80, 외부 443 → 서버:443 (TCP)
  2. 브라우저에서 https://<도메인> 접속 → 로그인 확인
     (인증서 발급에 1~2분 걸릴 수 있음)
  3. 배포 테스트: 노트북에서 push → tail -f /var/log/dogroo-deploy.log
EOF
