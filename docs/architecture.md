# 두그루(dogroo) - 리포 구조 & 배포 아키텍처

## 리포 구조

```
groo/  (GitHub 개인 리포, main 단일 브랜치)
├── assets/                # 로고 원본 (파비콘·아이콘 재생성 소스)
├── docs/data/             # groo 백업 원본 (git 제외, 로컬 보존)
├── backend/               # Fastify + better-sqlite3 API 서버 (독립 pnpm 패키지)
│   ├── src/
│   │   ├── server.ts      # 부트스트랩 (플러그인·라우트 등록, 최초 계정 생성)
│   │   ├── config.ts      # 상수 + 최소 env (시크릿·VAPID 키는 자동 생성)
│   │   ├── db.ts          # SQLite 초기화 + schema.sql / species-pool.sql 적용
│   │   ├── schema.sql     # 데이터 모델
│   │   ├── species-pool.sql # 식물 풀 (한글·영문명, 계절별 물주기·분갈이 주기)
│   │   ├── session-store.ts # SQLite 세션 스토어 (재시작에도 로그인 유지)
│   │   ├── plants-query.ts  # 목록·상세 계산 (D-day, 추천 주기)
│   │   ├── recommend.ts   # 주기 알고리즘 (종 × 화분 크기 × 계절)
│   │   ├── notify.ts      # 물주기 푸시 스케줄러 (Web Push)
│   │   ├── seed/import.ts # groo 백업 임포트 (원장 기반 멱등)
│   │   └── routes/        # auth · plants · logs · photos · species · push · settings
│   ├── seed/              # 백업 CSV + 사진 (초기화 시 자동 임포트)
│   └── Dockerfile         # pnpm build → node:22-slim
├── frontend/              # Lit + Vite PWA (독립 pnpm 패키지)
│   ├── src/
│   │   ├── app-root.ts    # 해시 라우터 (#/login #/plants #/plants/:id #/settings)
│   │   ├── ui.ts          # 모달 히스토리 스택·스크롤 잠금·토스트·확인창
│   │   ├── sheets/        # 바텀시트 (공통 베이스 + 폼·종류·시간·소급날짜·라이트박스)
│   │   └── views/         # login · plant-list · plant-detail · settings
│   ├── public/            # manifest, sw.js, favicon, icons/
│   ├── Dockerfile         # pnpm build → caddy:2-alpine 정적 서빙
│   └── Caddyfile          # 컨테이너 내부용 (SPA fallback)
├── deploy/                # 서버 배포 구성 (프록시·웹훅·DDNS는 edge 리포 소관)
│   ├── docker-compose.yml # backend + frontend (external 네트워크 edge 참여)
│   └── deploy.sh          # git 최신화 + 전체 재빌드·재기동 (flock 직렬화)
├── .github/workflows/deploy.yml
└── dev.sh                 # 로컬 개발 (backend :4746 + frontend :4747)
```

## 배포 파이프라인

```
push (main)
  → GitHub Actions: backend/frontend 빌드 검증 (실패 시 배포 시작 안 됨)
  → POST https://dogroo.sudosoon.org/deploy/hook
      헤더 X-Deploy-Key: ${DEPLOY_KEY}   바디 {"targets":"deploy", "sha":"..."}
  → edge caddy가 /deploy/hook → /deploy/dogroo 로 rewrite 후 host-gateway(호스트 9099)로 프록시
  → webhook (adnanh/webhook, systemd, edge 리포 소관)
      X-Deploy-Key 헤더 검증 → 즉시 응답 → 이 리포의 deploy/deploy.sh 실행
  → deploy.sh  (flock으로 직렬화)
      git fetch + reset --hard FETCH_HEAD
      docker compose up -d --build --remove-orphans (항상 전체 재적용)
```

### 시크릿

| 위치 | 키 | 비고 |
|---|---|---|
| GitHub Secrets | `DEPLOY_KEY` (고정 난수), `DEPLOY_URL` | Actions → 웹훅 인증 |
| 서버 `/etc/edge/deploy.env` | `DEPLOY_KEY_DOGROO` | webhook systemd EnvironmentFile (edge 소관) |
| 서버 `/etc/dogroo/backend.env` | `INITIAL_USERNAME/PASSWORD` | 최초 계정. 세션 시크릿·VAPID 키쌍은 최초 기동 시 자동 생성되어 데이터 디렉토리에 보관 |
| 서버 `/etc/edge/caddy.env` | `DOGROO_DOMAIN`, `DONOTI_DOMAIN` | edge Caddyfile 사이트 주소 |
| 서버 `/etc/edge/cf.env` | `CF_TOKEN` | Cloudflare DNS 갱신용 (edge cf-ddns.sh) |

## 런타임 토폴로지

```
인터넷 ── dogroo.sudosoon.org (Cloudflare DNS) ── iptime 공유기 (80/443 포워딩)
             │
        [edge-caddy 컨테이너]  ── HTTPS 자동 인증서 (edge 리포 소관, 도메인별 라우팅)
             ├─ /api/*        → dogroo-backend:4746   (Fastify)
             ├─ /deploy/hook  → host-gateway:9099 (webhook, 호스트 systemd)
             └─ /*            → dogroo-frontend:80    (정적 PWA)

        [dogroo-backend 컨테이너] ── /root/workspace/dogroo-data ↔ /data 바인드 마운트
                               ├─ dogroo.db      (SQLite: 데이터·세션)
                               ├─ photos/        (사진 원본)
                               ├─ .session-secret
                               └─ .vapid.json    (푸시 키쌍)
```

- 컨테이너들은 수동 생성한 공용 docker 네트워크 `edge`에 참여한다. `container_name`(dogroo-backend/dogroo-frontend)은 edge Caddyfile이 참조하므로 변경 금지
- 데이터는 전부 호스트 `/root/workspace/dogroo-data`에 존재 → **백업 = 이 디렉토리 복사**
- 유동 IP는 edge 리포의 `cf-ddns.sh`(크론 10분)가 Cloudflare A 레코드에 반영

## 서버 셋업

서버(CentOS 7) 세팅은 두 스크립트로 처리한다 (둘 다 root 실행, 재실행 안전):

```sh
bash /root/workspace/dogroo/docs/server-setup.sh   # OS·docker·클론·시크릿·앱 기동
bash /root/workspace/edge/server-setup.sh          # 게이트웨이·웹훅·DDNS (edge 리포)
```

스크립트 밖에서 할 일:

1. GitHub Secrets - `DEPLOY_KEY`(= `/etc/edge/deploy.env`의 `DEPLOY_KEY_DOGROO`), `DEPLOY_URL`(`https://dogroo.sudosoon.org/deploy/hook`)
2. iptime - 서버 내부 IP 고정 + 포트포워딩 80→80, 443→443 (TCP)
3. 확인 - `docker logs edge-caddy | grep -i cert`(인증서), 접속·로그인, push 배포 테스트(`tail -f /var/log/dogroo-deploy.log`)
