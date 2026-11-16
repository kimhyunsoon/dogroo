use serde_json::json;

use crate::config::CONFIG;
use crate::core::app::{AppError, HResult, Pre, Reply, Req, Routes, require_auth};
use crate::core::db;
use crate::core::multipart::{self, Limits};
use crate::core::{dates, session};
use crate::params;

const LIMITS: Limits = Limits {
    file_size: 20 * 1024 * 1024,
    files: None,
};

fn ext_by_mime(m: &str) -> Option<&'static str> {
    match m {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/heic" => Some("heic"),
        _ => None,
    }
}

// 사진 업로드 (multipart, 필드명 file)
async fn upload(req: Req) -> HResult {
    // req.file(): 첫 파일 파트
    let parts = multipart::parts(&req, &LIMITS, true).await?;
    let Some(file) = parts.into_iter().find(|p| p.is_file()) else {
        return Ok(Reply::error(400, "file_required"));
    };
    let Some(ext) = ext_by_mime(&file.mimetype) else {
        return Ok(Reply::error(400, "unsupported_type"));
    };
    if file.too_large {
        return Err(AppError {
            status: 413,
            code: Some("FST_REQ_FILE_TOO_LARGE".into()),
            message: "request file too large".into(),
        });
    }
    let id = req.param("id").to_string();
    let filename = format!("p{id}-{}.{ext}", session::now_ms() as i64);
    tokio::fs::write(format!("{}/photos/{filename}", CONFIG.data_dir), &file.data)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    let rel = format!("photos/{filename}");
    // 첫 사진이면 대표로 지정
    let c = db::conn();
    let count = db::get(
        &c,
        "SELECT COUNT(*) AS c FROM photos WHERE plant_id = ?",
        params![id.clone()],
    )?
    .and_then(|r| db::int(&r, "c"))
    .unwrap_or(0);
    let result = db::run(
        &c,
        "INSERT INTO photos (plant_id, path, taken_at, is_primary) VALUES (?, ?, ?, ?)",
        params![
            id,
            rel.clone(),
            dates::today_str(),
            if count == 0 { 1 } else { 0 }
        ],
    )?;
    Ok(Reply::json(
        201,
        json!({ "id": result.last_insert_rowid, "path": rel }),
    ))
}

async fn set_primary(req: Req) -> HResult {
    let c = db::conn();
    let Some(photo) = db::get(
        &c,
        "SELECT * FROM photos WHERE id = ?",
        params![req.param("id")],
    )?
    else {
        return Ok(Reply::error(404, "not_found"));
    };
    db::run(
        &c,
        "UPDATE photos SET is_primary = 0 WHERE plant_id = ?",
        params![db::int(&photo, "plant_id")],
    )?;
    db::run(
        &c,
        "UPDATE photos SET is_primary = 1 WHERE id = ?",
        params![db::int(&photo, "id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn delete(req: Req) -> HResult {
    let photo = {
        let c = db::conn();
        db::get(
            &c,
            "SELECT * FROM photos WHERE id = ?",
            params![req.param("id")],
        )?
    };
    let Some(photo) = photo else {
        return Ok(Reply::error(404, "not_found"));
    };
    {
        let c = db::conn();
        db::run(
            &c,
            "DELETE FROM photos WHERE id = ?",
            params![db::int(&photo, "id")],
        )?;
    }
    // 파일이 이미 없어도 무시
    let _ = tokio::fs::remove_file(format!(
        "{}/{}",
        CONFIG.data_dir,
        db::text(&photo, "path").unwrap_or("")
    ))
    .await;
    // 대표 사진을 지웠으면 가장 최근 사진을 대표로 승격
    if db::int(&photo, "is_primary").unwrap_or(0) != 0 {
        let c = db::conn();
        db::run(
            &c,
            "UPDATE photos SET is_primary = 1
         WHERE id = (SELECT id FROM photos WHERE plant_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1)",
            params![db::int(&photo, "plant_id")],
        )?;
    }
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api", Some(require_auth));
    r.add("POST", p, "/plants/:id/photos", a, upload);
    r.add("POST", p, "/photos/:id/primary", a, set_primary);
    r.add("DELETE", p, "/photos/:id", a, delete);
}
