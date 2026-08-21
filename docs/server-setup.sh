#!/usr/bin/env bash
# 두그루 서버 셋업 스크립트 (CentOS 7, root로 실행)
# 사용법: bash server-setup.sh
# 재실행해도 안전하다 (완료된 단계는 건너뜀).
#
# 게이트웨이(caddy 80/443)·배포 웹훅·Cloudflare DDNS는 edge 리포 소관이다.
# 순서: 이 스크립트(1~5) → edge/server-setup.sh → 이 스크립트 재실행(6에서 기동)
set -euo pipefail

REPO_SSH="git@github.com:kimhyunsoon/dogroo.git"
APP_DIR="/root/workspace/dogroo"
DATA_DIR="/root/workspace/dogroo-data"
# 앱 도메인 (edge의 Cloudflare DDNS가 관리)
DOMAIN="dogroo.sudosoon.org"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
skip() { printf '    (이미 완료 - 건너뜀)\n'; }

# 실행 중 git reset으로 스크립트 자신이 갱신되어도 안전하도록 전체를 함수로 감싼다
main() {

[[ $EUID -eq 0 ]] || { echo "root로 실행하세요 (sudo -i)"; exit 1; }

# ── 1. yum 저장소를 vault로 교체 (CentOS 7 EOL 대응) ──────────────
step "1/6 yum 저장소 복구"
if grep -rq '^mirrorlist=' /etc/yum.repos.d/CentOS-*.repo 2>/dev/null; then
  sed -i -e 's|^mirrorlist=|#mirrorlist=|' \
         -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' \
         /etc/yum.repos.d/CentOS-*.repo
  yum clean all && yum makecache
else
  skip
fi

# ── 2. git + Docker CE + compose plugin ───────────────────────────
step "2/6 Docker 설치"
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
step "3/6 GitHub Deploy Key"
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
step "4/6 리포 클론·최신화"
mkdir -p "$DATA_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  # git 1.8 호환 (FETCH_HEAD 기준으로 최신화)
  ( cd "$APP_DIR" && git fetch origin main && git reset --hard FETCH_HEAD )
else
  git clone "$REPO_SSH" "$APP_DIR"
fi

# ── 5. 시크릿 파일 (/etc/dogroo) ───────────────────────────────────
step "5/6 시크릿 파일"
mkdir -p /etc/dogroo
if [[ ! -f /etc/dogroo/backend.env ]]; then
  read -rp "    앱 로그인 아이디: " app_user
  read -rsp "    앱 로그인 비밀번호: " app_pass; echo
  printf 'INITIAL_USERNAME=%s\nINITIAL_PASSWORD=%s\n' "$app_user" "$app_pass" > /etc/dogroo/backend.env
fi
chmod 600 /etc/dogroo/*.env 2>/dev/null || true
echo "    /etc/dogroo 준비 완료"

# ── 6. 앱 기동 (게이트웨이는 edge 소관) ────────────────────────────
step "6/6 앱 기동 (첫 빌드는 몇 분 걸립니다)"
if ! docker network inspect edge >/dev/null 2>&1; then
  docker network create edge
  echo "    ⚠ edge 네트워크를 방금 만들었습니다. 외부 접속은 edge caddy가 떠야 가능합니다:"
  echo "      bash /root/workspace/edge/server-setup.sh  (edge 리포 참고)"
fi
cd "$APP_DIR/deploy"
docker compose up -d --build --remove-orphans
echo
docker compose logs backend 2>/dev/null | tail -5

printf '\n\033[1;32m✔ 서버 셋업 완료. 남은 일 (edge 리포 소관 포함):\033[0m\n'
cat <<EOF
  1. 게이트웨이·웹훅·DDNS: bash /root/workspace/edge/server-setup.sh
  2. iptime - 서버 내부 IP 고정 + 포트포워딩 80→80, 443→443 (TCP)
  3. GitHub Secrets의 DEPLOY_URL을 https://${DOMAIN}/deploy/hook 으로
     (DEPLOY_KEY는 /etc/edge/deploy.env 의 DEPLOY_KEY_DOGROO 와 동일해야 함)
  4. 브라우저에서 https://${DOMAIN} 접속 → 로그인 확인
  5. 배포 테스트: 노트북에서 push → tail -f /var/log/dogroo-deploy.log
EOF
}

main "$@"
