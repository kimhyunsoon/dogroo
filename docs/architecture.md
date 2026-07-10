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
├── deploy/                # 서버 배포 구성
│   ├── docker-compose.yml # caddy + backend + frontend (메인 스택)
│   ├── Caddyfile          # 메인 리버스 프록시 (TLS)
│   ├── hooks.json         # 배포 웹훅 정의 (adnanh/webhook 설정)
│   ├── webhook.service    # 웹훅 systemd 유닛
│   └── deploy.sh          # git 최신화 + 대상만 재빌드·재기동 (flock 직렬화)
├── .github/workflows/deploy.yml
└── dev.sh                 # 로컬 개발 (backend :4746 + frontend :4747)
```

## 배포 파이프라인

```
push (main)
  → GitHub Actions: dorny/paths-filter로 backend/ frontend/ deploy/ 변경 감지
  → POST https://<DDNS도메인>/deploy/hook
      헤더 X-Deploy-Key: ${DEPLOY_KEY}   바디 {"targets":["backend",...], "sha":"..."}
  → Caddy(컨테이너)가 /deploy/hook을 host-gateway(호스트 9099)로 프록시
  → webhook (adnanh/webhook, Go 정적 바이너리, systemd)
      X-Deploy-Key 헤더 검증 → 즉시 응답 → deploy.sh 실행
  → deploy.sh "backend,frontend"  (flock으로 직렬화)
      git fetch + reset --hard origin/main
      targets에 deploy 포함 → docker compose up -d --build (전체 재적용)
      아니면 → compose build <targets> && up -d <targets>
```

| 결정 | 이유 |
|---|---|
| 웹훅 = Go 정적 바이너리 (adnanh/webhook) | 호스트가 CentOS 7이라 Node 18+ 실행 불가(glibc 2.17). 정적 빌드라 OS 제약 없음, 이 용도의 검증된 도구. 상세는 docs/server-setup.md |
| 즉시 응답 + flock 직렬화 | 연속 push에도 배포가 겹치지 않음 |
| 키 검증은 webhook trigger-rule | 헤더 불일치 시 스크립트 실행 자체가 안 됨 |

### 시크릿

| 위치 | 키 | 비고 |
|---|---|---|
| GitHub Secrets | `DEPLOY_KEY` (고정 난수), `DEPLOY_URL` | Actions → 웹훅 인증 |
| 서버 `/etc/dogroo/deploy.env` | `DEPLOY_KEY` | webhook systemd EnvironmentFile |
| 서버 `/etc/dogroo/backend.env` | `INITIAL_USERNAME/PASSWORD` | 최초 계정. 세션 시크릿·VAPID 키쌍은 최초 기동 시 자동 생성되어 데이터 디렉토리에 보관 |
| 서버 `/etc/dogroo/caddy.env` | `DOGROO_DOMAIN` | 메인 Caddyfile 사이트 주소 |

## 런타임 토폴로지

```
인터넷 ── iptime 공유기 (80/443 포워딩, DDNS)
             │
        [caddy 컨테이너]  ── HTTPS 자동 인증서
             ├─ /api/*        → backend:4746   (Fastify)
             ├─ /deploy/hook  → host-gateway:9099 (webhook, 호스트 systemd)
             └─ /*            → frontend:80    (정적 PWA)

        [backend 컨테이너] ── /srv/dogroo/data ↔ /data 바인드 마운트
                               ├─ dogroo.db      (SQLite: 데이터·세션)
                               ├─ photos/        (사진 원본)
                               ├─ .session-secret
                               └─ .vapid.json    (푸시 키쌍)
```

- 데이터는 전부 호스트 `/srv/dogroo/data`에 존재 → **백업 = 이 디렉토리 복사**
- 포트 4746/4747은 dogroo의 D(4)·G(7)에서 따온 값 (로컬 충돌 회피)

## 서버 초기 셋업

CentOS 7 유지 전제의 단계별 절차는 **[server-setup.md](server-setup.md)** 참고.
