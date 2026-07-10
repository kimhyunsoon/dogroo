# dogroo — 리포 구조 & 배포 아키텍처

기획 확정 내용은 [overview.html](./overview.html) 참조. 이 문서는 코드 구조와 배포 파이프라인을 다룬다.

## 리포 구조

```
groo/  (GitHub 개인 리포, main 단일 브랜치)
├── docs/                  # 기획 문서, 로고 원본 에셋
├── backend/               # Fastify + better-sqlite3 API 서버 (독립 pnpm 패키지)
│   ├── src/
│   │   ├── server.ts      # 부트스트랩 (플러그인·라우트 등록, 최초 계정 생성)
│   │   ├── config.ts      # 환경변수 로딩
│   │   ├── db.ts          # SQLite 초기화 + schema.sql 적용
│   │   ├── schema.sql     # 데이터 모델 (overview 문서와 동일)
│   │   ├── auth.ts        # argon2 해시, 세션 인증 훅
│   │   └── routes/        # auth · plants · logs · species · push · settings
│   ├── Dockerfile         # pnpm build → node:22-slim 실행
│   └── .env.example
├── frontend/              # Lit + Vite PWA (독립 pnpm 패키지)
│   ├── src/
│   │   ├── main.ts        # 엔트리
│   │   ├── app-root.ts    # 셸 + 해시 라우터
│   │   ├── api.ts         # fetch 래퍼 (세션 쿠키 포함)
│   │   ├── style.ts       # 공통 디자인 토큰
│   │   └── views/         # login · plant-list · plant-detail · plant-edit · settings
│   ├── public/            # manifest.webmanifest, sw.js, icons/
│   ├── Dockerfile         # pnpm build → caddy:2-alpine 정적 서빙
│   └── Caddyfile          # 컨테이너 내부용 (SPA fallback)
├── deploy/                # 서버 배포 구성
│   ├── docker-compose.yml # caddy + backend + frontend
│   ├── Caddyfile          # 메인 리버스 프록시 (TLS)
│   ├── hook-server.mjs    # 배포 웹훅 수신기 (호스트 systemd로 실행)
│   ├── deploy.sh          # git 최신화 + 대상만 재빌드·재기동
│   └── dogroo-hook.service# systemd 유닛
├── .github/workflows/deploy.yml
└── README.md
```

- backend/frontend는 **루트 워크스페이스 없는 독립 패키지** — GitHub Actions가 디렉토리 단위로 변경을 감지해 배포하는 모델과 일치.
- 공유 타입이 필요해지면 추후 `shared/` 패키지 추가 검토.

## 배포 파이프라인

```
push (main)
  → GitHub Actions: dorny/paths-filter로 backend/ frontend/ deploy/ 변경 감지
  → POST https://<DDNS도메인>/deploy/hook
      헤더 X-Deploy-Key: ${DEPLOY_KEY}   바디 {"targets":["backend",...], "sha":"..."}
  → Caddy(컨테이너) が /deploy/hook을 host-gateway(호스트 9099)로 프록시
  → hook-server.mjs (호스트 systemd)
      키 timing-safe 검증 → 202 즉시 응답 → 배포 큐에 직렬 등록
  → deploy.sh <targets>
      git fetch + reset --hard origin/main
      targets에 deploy 포함 → docker compose up -d --build (전체 재적용)
      아니면 → compose build <targets> && up -d <targets>
```

설계 이유:

| 결정 | 이유 |
|---|---|
| 웹훅 수신기를 호스트 systemd로 | git·docker를 자연스럽게 실행. 컴포즈 재빌드 사이클 밖에 있어 "자기 자신을 재배포"하는 꼬임이 없음 |
| 202 즉시 응답 + 직렬 큐 | Actions는 발사 후 종료. 연속 push에도 배포가 겹치지 않음 |
| targets 화이트리스트 | `backend` `frontend` `deploy` 외 값은 거부 |
| main 단일 브랜치 | 개인 프로젝트 — PR/스테이징 오버헤드 제거 |

### 시크릿 관리

| 위치 | 키 | 용도 |
|---|---|---|
| GitHub Secrets | `DEPLOY_KEY` | 고정 난수 (예: `openssl rand -hex 32`) |
| GitHub Secrets | `DEPLOY_URL` | `https://<도메인>/deploy/hook` (도메인 노출 방지) |
| 서버 `/etc/dogroo/deploy.env` | `DEPLOY_KEY`, `REPO_DIR` | hook-server가 검증·실행에 사용 |
| 서버 `/etc/dogroo/backend.env` | `INITIAL_USERNAME/PASSWORD` | backend 컨테이너 env_file. 세션 시크릿·VAPID 키쌍은 최초 기동 시 자동 생성되어 데이터 디렉토리에 보관 |
| 서버 `/etc/dogroo/caddy.env` | `DOGROO_DOMAIN` | 메인 Caddyfile의 사이트 주소 |

시크릿은 리포에 커밋하지 않는다. `.env.example`만 커밋.

## 런타임 토폴로지

```
인터넷 ── iptime 공유기 (80/443 포워딩, DDNS)
             │
        [caddy 컨테이너]  ── HTTPS 자동 인증서
             ├─ /api/*        → backend:4746   (Fastify)
             ├─ /deploy/hook  → host-gateway:9099 (hook-server, 호스트)
             └─ /*            → frontend:80    (정적 PWA)

        [backend 컨테이너] ── /srv/dogroo/data ↔ /data 바인드 마운트
                               ├─ dogroo.db   (SQLite)
                               └─ photos/     (사진 원본·썸네일)
```

- 데이터는 전부 호스트 `/srv/dogroo/data`에 존재 → **백업 = 이 디렉토리 복사** (로드맵 M7에서 cron 자동화).
- 컨테이너는 전부 `restart: unless-stopped`.

## 서버 초기 셋업 체크리스트 (Ubuntu 재설치 후 1회)

1. docker + compose plugin, git, Node 22(웹훅용) 설치
2. `git clone <repo> /srv/dogroo/app`, `mkdir -p /srv/dogroo/data`
3. `/etc/dogroo/{deploy,backend,caddy}.env` 작성 (위 표 참고)
4. `cp deploy/dogroo-hook.service /etc/systemd/system/` → `systemctl enable --now dogroo-hook`
5. iptime: DDNS 설정 + 80/443 포트포워딩
6. 최초 기동: `cd /srv/dogroo/app/deploy && docker compose up -d --build`
7. GitHub Secrets(`DEPLOY_KEY`, `DEPLOY_URL`) 등록 → 이후 main push만으로 배포됨

## 로컬 개발

- backend: `pnpm dev` (tsx watch, :4746)
- frontend: `pnpm dev` (vite, :4747 → `/api` 프록시로 backend 연결) — **http://localhost:4747 접속**
- 최초 로그인 계정은 backend `.env`의 `INITIAL_USERNAME/INITIAL_PASSWORD`로 서버 기동 시 자동 생성 (users 테이블이 비어있을 때만)
