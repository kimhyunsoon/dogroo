# 두그루(dogroo) - 리포 구조 & 배포 아키텍처

## 리포 구조

```
groo/  (GitHub 개인 리포, main 단일 브랜치)
├── assets/                # 마크·아이콘 SVG 원본 + compose-icons.py (do 시리즈 공용 아이콘 합성기, docs/icon-guide.md)
├── docs/data/             # groo 백업 원본 (git 제외, 로컬 보존)
├── backend/               # Rust (axum + rusqlite) API 서버 (독립 cargo 크레이트, rust-toolchain.toml 로 버전 고정)
│   ├── src/
│   │   ├── main.rs        # 부트스트랩 (마이그레이션·시드·최초 계정, 라우트 등록, 알림 스케줄러)
│   │   ├── config.rs      # 상수 + 최소 env (시크릿·VAPID 키는 자동 생성)
│   │   ├── db.rs          # SQLite 열기 + schema.sql / species-pool.sql 적용 + 그룹 자동 분류
│   │   ├── schema.sql     # 데이터 모델
│   │   ├── species-pool.sql # 식물 풀 (한글·영문명, 계절별 물주기·분갈이 주기)
│   │   ├── plants_query.rs  # 목록·상세 계산 (D-day, 추천 주기: 종 × 화분 크기 × 계절)
│   │   ├── notify.rs      # 물주기 푸시 스케줄러 (Web Push)
│   │   ├── seed.rs        # groo 백업 임포트 (원장 기반 멱등)
│   │   ├── core/          # 4개 앱(dogroo·donoti·docook·doquiz) 공통 사본 - 세션 쿠키·SQLite·JSON·multipart·정적 파일·web-push (고칠 때 네 곳을 같이)
│   │   └── routes/        # auth · plants · logs · photos · species · push · settings · files(사진 파일 서빙)
│   ├── seed/              # 백업 CSV + 사진 (초기화 시 자동 임포트)
│   ├── dev.sh             # 로컬 backend 실행 (cargo run, cargo-watch 있으면 자동 재시작)
│   └── Dockerfile         # cargo-chef 빌드 → gcr.io/distroless/cc-debian12
├── frontend/              # Lit + Vite PWA (독립 pnpm 패키지)
│   ├── src/
│   │   ├── app-root.ts    # 해시 라우터 (#/login #/plants #/plants/:id #/settings)
│   │   ├── ui.ts          # 모달 히스토리 스택·스크롤 잠금·토스트·확인창
│   │   ├── sheets/        # 바텀시트 (공통 베이스 + 폼·종류·시간·소급날짜·라이트박스)
│   │   └── views/         # login · plant-list · plant-detail · settings
│   ├── public/            # manifest, sw.js, favicon, icons/
│   ├── Dockerfile         # pnpm build → caddy:2-alpine 정적 서빙
│   └── Caddyfile          # 컨테이너 내부용 (SPA fallback)
├── deploy/                # 서버 배포 구성 (프록시·웹훅·DDNS는 gateway/ 소관)
│   ├── docker-compose.yml # backend + frontend (external 네트워크 gateway 참여)
│   └── deploy.sh          # git 최신화 + 바뀐 서비스만 빌드·재기동 + 게이트웨이 재적용 (4개 앱 공용 잠금)
├── gateway/               # 공용 게이트웨이 (앱 중립 - dogroo·donoti·docook·doquiz 공용, gateway/README.md 참고)
│   ├── docker-compose.yml # caddy 단독 (80/443, HTTPS 자동 인증서)
│   ├── Caddyfile          # 도메인별 라우팅 (컨테이너명 참조)
│   ├── hooks.json         # 배포 웹훅 정의 (dogroo·donoti·docook·doquiz 훅 4개)
│   ├── webhook.service    # 웹훅 systemd 유닛
│   ├── cf-ddns.sh         # Cloudflare A 레코드 IP 갱신 (크론, 앱 도메인 전부)
│   └── server-setup.sh    # 게이트웨이 전환 + donoti 셋업 (재실행 안전)
├── .github/workflows/deploy.yml
└── dev.sh                 # 로컬 개발 (backend :4746 + frontend :4747, 하나가 죽거나 Ctrl+C 면 전부 종료)
```

## 배포 파이프라인

```
push (main)
  → GitHub Actions: backend(cargo fmt·clippy·test)와 frontend(빌드)를 병렬 검증 (하나라도 실패하면 배포 시작 안 됨)
  → POST https://dogroo.sudosoon.org/deploy/hook
      헤더 X-Deploy-Key: ${DEPLOY_KEY}   바디 {"targets":"deploy", "sha":"..."}
  → gateway caddy가 /deploy/hook → /deploy/dogroo 로 rewrite 후 host-gateway(호스트 9099)로 프록시
  → webhook (adnanh/webhook, systemd, gateway/ 소관)
      X-Deploy-Key 헤더 검증 → 즉시 응답 → 이 리포의 deploy/deploy.sh 실행
  → deploy.sh  (4개 앱 공용 잠금 /tmp/do-series-deploy.lock - 서버 빌드는 한 번에 하나씩)
      git fetch + reset --hard FETCH_HEAD
      서비스(backend·frontend)마다 마지막 성공 커밋(/var/lib/do-deploy/dogroo/) 이후 경로가 바뀌었거나
      컨테이너가 없으면 그 서비스만 docker compose up -d --build (실패하면 기록이 안 남아 다음 배포에서 다시)
      + gateway/ 재적용 (compose up -d + caddy 무중단 reload - Caddyfile 변경도 push로 반영)
      전부 다시 빌드: FORCE=1 bash deploy/deploy.sh   로그: /var/log/dogroo-deploy.log
```

### 시크릿

| 위치 | 키 | 비고 |
|---|---|---|
| GitHub Secrets | `DEPLOY_KEY` (고정 난수), `DEPLOY_URL` | Actions → 웹훅 인증 |
| 서버 `/etc/gateway/deploy.env` | `DEPLOY_KEY_DOGROO` | webhook systemd EnvironmentFile (gateway 소관) |
| 서버 `/etc/dogroo/backend.env` | `INITIAL_USERNAME/PASSWORD` | 최초 계정. 세션 시크릿·VAPID 키쌍은 최초 기동 시 자동 생성되어 데이터 디렉토리에 보관 |
| 서버 `/etc/gateway/caddy.env` | `DOGROO_DOMAIN`, `DONOTI_DOMAIN`, `DOCOOK_DOMAIN`, `DOQUIZ_DOMAIN` | gateway Caddyfile 사이트 주소 |
| 서버 `/etc/gateway/cf.env` | `CF_TOKEN` | Cloudflare DNS 갱신용 (gateway/cf-ddns.sh) |

## 런타임 토폴로지

```
인터넷 ── dogroo.sudosoon.org (Cloudflare DNS) ── iptime 공유기 (80/443 포워딩)
             │
        [gateway-caddy 컨테이너]  ── HTTPS 자동 인증서 (gateway/ 소관, 도메인별 라우팅)
             ├─ /api/*        → dogroo-backend:4746   (Rust axum)
             ├─ /deploy/hook  → host-gateway:9099 (webhook, 호스트 systemd)
             └─ /*            → dogroo-frontend:80    (정적 PWA)

        [dogroo-backend 컨테이너] ── /root/workspace/dogroo-data ↔ /data 바인드 마운트
                               ├─ dogroo.db      (SQLite: 데이터·세션)
                               ├─ photos/        (사진 원본)
                               ├─ .session-secret
                               └─ .vapid.json    (푸시 키쌍)
```

- 컨테이너들은 수동 생성한 공용 docker 네트워크 `gateway`에 참여한다. `container_name`(dogroo-backend/dogroo-frontend)은 gateway Caddyfile이 참조하므로 변경 금지
- 데이터는 전부 호스트 `/root/workspace/dogroo-data`에 존재 → **백업 = 이 디렉토리 복사**
- 사진은 `/api/files/photos/*`(로그인 필수)로만 내보낸다. 데이터 폴더의 다른 파일(`dogroo.db`, `.session-secret`, `.vapid.json`)은 404
- 유동 IP는 `gateway/cf-ddns.sh`(크론 10분)가 Cloudflare A 레코드에 반영

## 서버 셋업

서버(CentOS 7) 세팅은 두 스크립트로 처리한다 (둘 다 root 실행, 재실행 안전):

```sh
bash /root/workspace/dogroo/docs/server-setup.sh   # OS·docker·클론·시크릿·앱 기동
bash /root/workspace/dogroo/gateway/server-setup.sh  # 게이트웨이·웹훅·DDNS 전환
```

스크립트 밖에서 할 일:

1. GitHub Secrets - `DEPLOY_KEY`(= `/etc/gateway/deploy.env`의 `DEPLOY_KEY_DOGROO`), `DEPLOY_URL`(`https://dogroo.sudosoon.org/deploy/hook`)
2. iptime - 서버 내부 IP 고정 + 포트포워딩 80→80, 443→443 (TCP)
3. 확인 - `docker logs gateway-caddy | grep -i cert`(인증서), 접속·로그인, push 배포 테스트(`tail -f /var/log/dogroo-deploy.log`)
