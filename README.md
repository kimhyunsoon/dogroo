# 🌱 두그루 (dogroo)

개인용 화분 물주기·분갈이 관리 PWA. 구조는 [docs/architecture.md](docs/architecture.md) 참고.

## 개발

```sh
./dev.sh   # backend(:4746) + frontend(:4747) 동시 기동
           # → http://localhost:4747 접속
```

- 첫 기동 시 시드(식물·기록·사진·식물 풀)가 자동 임포트된다
- 초기 계정: `backend/.env`의 `INITIAL_USERNAME` / `INITIAL_PASSWORD`
