use std::sync::LazyLock;

use crate::core::config as c;
use crate::core::webpush::{self, Vapid};

// 개인용 단일 서버 전제 - 바뀔 일 없는 값은 상수로 고정
// 포트는 로컬에서 다른 프로그램과 안 겹치게 dogroo의 D(4)·G(7)를 딴 4746/4747 사용
const PORT: u16 = 4746;
pub const HOST: &str = "0.0.0.0";
const VAPID_SUBJECT: &str = "mailto:sudosoon@gmail.com";

pub struct Config {
    pub port: u16,
    pub data_dir: String,
    pub seed_dir: String,
    pub session_secret: String,
    pub initial_username: Option<String>,
    pub initial_password: Option<String>,
    pub vapid: Vapid,
}

pub static CONFIG: LazyLock<Config> = LazyLock::new(|| {
    // 데이터 디렉토리 (SQLite + photos/) - 도커에서만 /data로 주입
    let data_dir = c::data_dir();
    std::fs::create_dir_all(format!("{data_dir}/photos")).expect("data dir");
    Config {
        port: c::port(PORT),
        // groo 백업 시드 - 로컬은 backend/seed, 도커는 /app/seed (작업 폴더 기준)
        seed_dir: std::env::var("SEED_DIR").unwrap_or_else(|_| "./seed".into()),
        // 세션 시크릿은 최초 기동 시 자동 생성해 데이터 디렉토리에 보관 (env 불필요)
        session_secret: c::load_secret_file(&data_dir, ".session-secret", 48),
        initial_username: c::env_nonempty("INITIAL_USERNAME"),
        initial_password: c::env_nonempty("INITIAL_PASSWORD"),
        // VAPID 키쌍(ECDSA P-256)도 최초 기동 시 자동 생성해 보관.
        // 재생성되면 기존 푸시 구독이 전부 무효가 되므로 구독 DB와 같은 디렉토리에 함께 유지한다.
        vapid: webpush::load_or_create(&data_dir, VAPID_SUBJECT),
        data_dir,
    }
});
