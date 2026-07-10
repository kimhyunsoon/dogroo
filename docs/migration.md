# groo(plantingo) 백업 → dogroo 마이그레이션 전략

백업 원본은 `docs/data/`에 있으며 **git에 포함하지 않는다** (.gitignore). 마이그레이션에 필요한 파일만 선별·가공해 `backend/seed/`에 커밋하고, **백엔드가 기동할 때마다 자동 임포트**된다.

## 백업 파일 인벤토리 — 선별 결과

| 파일 | 내용 | 결정 | 이유 |
|---|---|---|---|
| `user-plants.csv` (56행) | 화분 목록 | ✅ **seed 포함** | plants·species의 원천 |
| `care-logs.csv` (6,618행) | 케어 기록 | ✅ **seed 포함** | 물주기 6,023 + 분갈이 251 완료 기록 |
| `care-notes.csv` (585행) | 노트·성장 스냅 | ✅ **seed 포함** | 이미지 229건의 식물 연결 정보로 사용 |
| `species-wiki.csv` (44행) | 종 도감 | ✅ **seed 포함** | 물주기 권장 간격(9종) → 추천 주기 보강 |
| `plantingo-images/image-urls.csv` (761행) | 이미지 URL | 🔧 **다운로드에만 사용** | CDN 종료 대비 실파일 확보 완료, 파일명에 매핑 정보 포함되어 CSV 자체는 불필요 |
| `user-sites.csv` (5행) | 장소 | ❌ 제외 | dogroo에 장소 개념 없음 (비스코프) |
| `plant-tags.csv` (3행) | 태그 | ❌ 제외 | 태그 기능 없음 (비스코프) |
| `gallery.html`, `groo-photos-backup-list.txt`, `*.zip` | 열람 보조·중복 | ❌ 제외 | image-urls.csv와 중복 |

## 이미지 파이프라인 (완료)

1. `image-urls.csv` 761건 중 **현존 식물과 연결된 161건만 선별** — 나머지 600건은 백업에 없는(떠나보낸) 식물 소속
2. CDN(cloudfront)에서 전량 다운로드 — 서비스 종료 시 URL이 죽으므로 선행 확보
3. 원본(179MB)은 `docs/data/original-images/`에 로컬 보존
4. seed용은 **장변 1600px·JPEG q85로 통일** (PNG 93·HEIC 1건 포함 전부 변환) → **24MB**, `backend/seed/images/` 커밋
5. 파일명 규칙이 매핑 키: `<날짜>_plant-<식물ID>-<순번>.jpg`, `<날짜>_carenote-<노트ID>-<순번>.jpg`

## 매핑

| 원본 | → dogroo | 비고 |
|---|---|---|
| `직접입력종명` (한글 종명) | `species.name` | find-or-create. 사용자가 보던 이름 그대로 자동완성에 노출 |
| `species-wiki.물주기간격` (도감ID 연결) | `species.water_summer_days` | 겨울값은 백업에 없음 → **여름×1.5 반올림으로 근사** |
| user-plants `이름`/`입양일`/`물주기주기`/`분갈이주기` | `plants.name`/`started_at`/`water_interval_days`/`repot_interval_months` | 화분크기는 53/56이 빈값 → 전부 기본 `M` |
| care-logs `물주기`+완료 | `watering_logs` | 예정(미완료) 92건은 제외 — 앱이 자체 계산 |
| care-logs `분갈이하기`+완료 | `repotting_logs` | |
| plant 이미지 (순번 0) | `photos` `is_primary=1` | 파일을 `DATA_DIR/photos/`로 복사 |
| carenote 이미지 | `photos` (taken_at=기록일) | 성장 기록 사진으로 편입 |

**제외 데이터**: 영양관리(152)·분무(28)·환기(42)·물갈이(15)·가지치기(7) 로그와 노트 텍스트는 dogroo 스코프 밖. 백업에 없는 식물 소속 로그 1,367건·노트 354건도 제외 (연결할 식물이 없음).

## 임포트 동작 (backend/src/seed/import.ts)

- 기동 시 `migrate()` 직후 실행. `backend/seed/user-plants.csv`가 없으면 조용히 건너뜀
- **멱등성**: `import_ledger(source, source_id)` 원장에 임포트된 원본 행을 기록.
  원장에 있는 행은 **절대 다시 쓰지 않는다** — INSERT만 하고 UPDATE 없음.
  → 사용자가 앱에서 수정·삭제한 내용이 재기동으로 되돌아가지 않음
- 전체가 단일 트랜잭션 — 중간 실패 시 어떤 행도 반영되지 않고 다음 기동에서 재시도
- 신규 화분 등의 배포 후 데이터와 자연 공존 (시드는 원장 기준으로 자기 몫만 채움)

## 검증 방법

1. `./dev.sh`로 기동 → 로그에 `시드 임포트: 종 N, 식물 56, 물주기 ~6000, ...` 출력 확인
2. 재기동 → 임포트 로그가 나오지 않아야 함 (원장에 의해 전량 스킵)
3. 앱에서 식물 하나 수정 후 재기동 → 수정 내용 유지 확인
