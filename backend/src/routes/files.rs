// 사진 파일 서빙 (/api/files/photos/... → DATA_DIR/photos/...) - 로그인 필수
// TS(@fastify/static root=DATA_DIR)는 데이터 폴더 전체(.session-secret, dogroo.db 포함)를 내보냈다.
// 프론트는 photos/ 만 쓰므로 photos/ 아래만 내보낸다 (보안 수정, 나머지는 404).
use std::path::Path;

use crate::config::CONFIG;
use crate::core::app::{HResult, Req, Routes, require_auth};
use crate::core::static_files::{self, Served};

async fn file(req: Req) -> HResult {
    let rel = req.param("wildcard").to_string();
    let Some(photo) = rel.strip_prefix("photos/") else {
        return Ok(req.not_found());
    };
    if photo
        .split('/')
        .any(|seg| seg.starts_with('.') && seg != "..")
    {
        return Ok(req.not_found());
    }
    let root = Path::new(&CONFIG.data_dir).join("photos");
    Ok(
        match static_files::serve(&req, &root, photo, "public, max-age=0").await {
            Served::File(r) => r,
            Served::NotFound => req.not_found(),
        },
    )
}

pub fn register(r: &mut Routes) {
    r.add("GET", "/api/files", "/*", Some(require_auth), file);
}
