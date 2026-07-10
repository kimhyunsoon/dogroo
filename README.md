# 🌱 dogroo (두그루)

서비스 종료되는 그루우(groo)를 대신할, 화분 80개를 위한 개인용 물주기·분갈이 관리 PWA.

- **기획**: [docs/overview.html](docs/overview.html) (사용성·기술 두 탭)
- **구조·배포**: [docs/architecture.md](docs/architecture.md)

## 구성

| 디렉토리 | 내용 |
|---|---|
| `backend/` | Fastify + better-sqlite3 API (pnpm) |
| `frontend/` | Lit + Vite PWA (pnpm) |
| `deploy/` | docker compose + Caddy + 배포 웹훅 |

## 로컬 개발

```sh
./dev.sh   # backend(:4746) + frontend(:4747) 동시 기동, .env·의존성 자동 준비
           # → http://localhost:4747 접속
```

- 첫 기동 시 groo 백업 시드가 자동 임포트된다 (식물 56 + 기록 + 사진, [docs/migration.md](docs/migration.md))
- 초기 계정: `backend/.env`의 `INITIAL_USERNAME` / `INITIAL_PASSWORD` (기본 admin / change-me)

## 배포

main에 push하면 GitHub Actions가 변경된 디렉토리만 감지해 개인 서버 웹훅을 호출하고,
서버가 해당 타깃만 docker 재빌드·재기동한다. 상세는 [architecture.md](docs/architecture.md) 참고.
