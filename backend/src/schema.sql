-- dogroo 데이터 모델 (docs/overview.html 데이터 모델 초안과 동일)

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- argon2id
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS species (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE, -- 별칭 (한국 유통명)
  name_en           TEXT,                 -- 학명
  group_name        TEXT,                 -- 그룹 (물주기 동선 단위, 예: 호야)
  water_summer_days INTEGER,              -- 여름철 권장 물주기
  water_winter_days INTEGER,              -- 겨울철 권장 물주기
  repot_months      INTEGER,              -- 권장 분갈이 주기
  memo              TEXT
);

CREATE TABLE IF NOT EXISTS plants (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,    -- 애칭
  species_id            INTEGER REFERENCES species(id),
  started_at            TEXT,             -- 키우기 시작일 (ISO date)
  pot_size              TEXT CHECK (pot_size IN ('S', 'M', 'L')) DEFAULT 'M',
  pot_type              TEXT,             -- 화분 재질: 슬릿|도자기|수경|토분|플라스틱
  water_interval_days   INTEGER,          -- 사용자 확정값 (추천은 참고)
  repot_interval_months INTEGER,
  memo                  TEXT,
  archived_at           TEXT              -- 보관(아카이브) 처리
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY,
  plant_id   INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  taken_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS watering_logs (
  id         INTEGER PRIMARY KEY,
  plant_id   INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  watered_at TEXT NOT NULL,               -- 소급 기록 지원 (오늘~5일 전)
  memo       TEXT
);

CREATE TABLE IF NOT EXISTS repotting_logs (
  id          INTEGER PRIMARY KEY,
  plant_id    INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  repotted_at TEXT NOT NULL,
  pot_size    TEXT CHECK (pot_size IN ('S', 'M', 'L')),  -- 새 화분 크기 (성장 이력)
  memo        TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_settings (
  type    TEXT PRIMARY KEY CHECK (type IN ('watering', 'repotting', 'reminder')),
  enabled INTEGER NOT NULL DEFAULT 1,
  send_at TEXT NOT NULL DEFAULT '08:00'   -- 발송 시각 (HH:MM)
);

-- 알림은 물주기 단일 (기본 저녁 6시)
INSERT OR IGNORE INTO notification_settings (type, enabled, send_at) VALUES
  ('watering', 1, '18:00');

-- groo 백업 임포트 원장 - 한 번 들어온 원본 행은 다시 갱신하지 않는다 (앱에서 수정됐을 수 있음)
CREATE TABLE IF NOT EXISTS import_ledger (
  source      TEXT NOT NULL,   -- 'species' | 'plant' | 'care-log' | 'photo'
  source_id   TEXT NOT NULL,   -- 원본 백업의 식별자
  local_id    INTEGER,         -- 생성된 로컬 row id
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_watering_logs_plant ON watering_logs(plant_id, watered_at DESC);
CREATE INDEX IF NOT EXISTS idx_repotting_logs_plant ON repotting_logs(plant_id, repotted_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_plant ON photos(plant_id);
