# 🌱 두그루 (dogroo)

개인용 화분 물주기·분갈이 관리 PWA. 구조는 [docs/architecture.md](docs/architecture.md), do 시리즈 아이콘 규칙은 [docs/icon-guide.md](docs/icon-guide.md) 참고.

## 개발

```sh
./dev.sh   # backend(Rust :4746) + frontend(:4747) 동시 기동
           # → http://localhost:4747 접속
```

- 필요: Rust 툴체인(`rustup`, 버전은 `backend/rust-toolchain.toml`), Node 22 + pnpm(frontend)

- 첫 기동 시 시드(식물·기록·사진·식물 풀)가 자동 임포트된다
- 초기 계정: `backend/.env`의 `INITIAL_USERNAME` / `INITIAL_PASSWORD`

## 로고

`assets/dogroo-mark.svg`가 마크 원본(단색 벡터). 아이콘·파비콘 규칙과 재생성 명령은 dogroo [docs/icon-guide.md](docs/icon-guide.md) 를 따른다.

```sh
python3 assets/compose-icons.py assets/dogroo-mark.svg '#e6f2e9' assets
for s in 180 192 512; do rsvg-convert -w $s assets/icon.svg -o frontend/public/icons/icon-$s.png; done
rsvg-convert -w 512 assets/icon-maskable.svg -o frontend/public/icons/icon-512-maskable.png
```
