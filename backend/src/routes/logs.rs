use serde_json::{Value, json};

use super::{body_for, or_null};
use crate::core::app::{HResult, Pre, Reply, Req, Routes, require_auth};
use crate::core::dates;
use crate::core::db::{self, P};
use crate::params;

// 허용 날짜: 오늘 ~ 7일 전 (소급 기록)
fn is_allowed_date(date: &Value) -> bool {
    let today = dates::today_str();
    let Value::String(d) = date else { return false };
    (0..=7).any(|n| dates::add_days(&today, -(n as f64)).as_deref() == Some(d.as_str()))
}

fn date_or_today(v: Option<&Value>) -> Value {
    or_null(v)
        .cloned()
        .unwrap_or_else(|| Value::String(dates::today_str()))
}

async fn add_watering(req: Req) -> HResult {
    let b = body_for(&req, "watered_at")?;
    let at = date_or_today(b.get("watered_at"));
    if !is_allowed_date(&at) {
        return Ok(Reply::error(400, "out_of_range"));
    }
    let c = db::conn();
    let result = db::run(
        &c,
        "INSERT INTO watering_logs (plant_id, watered_at, memo) VALUES (?, ?, ?)",
        &[
            P::from(req.param("id")),
            db::from_json(Some(&at))?,
            db::from_json(b.get("memo"))?,
        ],
    )?;
    Ok(Reply::json(
        201,
        json!({ "id": result.last_insert_rowid, "watered_at": at }),
    ))
}

// 오늘 기록 토글 취소 (목록에서 완료 버튼 재탭)
async fn undo_today_watering(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM watering_logs WHERE plant_id = ? AND watered_at = ?",
        params![req.param("id"), dates::today_str()],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

// 실행취소·오기록 정정용 삭제
async fn delete_watering(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM watering_logs WHERE id = ?",
        params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn add_repotting(req: Req) -> HResult {
    let b = body_for(&req, "repotted_at")?;
    let at = date_or_today(b.get("repotted_at"));
    if !is_allowed_date(&at) {
        return Ok(Reply::error(400, "out_of_range"));
    }
    let c = db::conn();
    let result = db::run(
        &c,
        "INSERT INTO repotting_logs (plant_id, repotted_at, pot_size, memo) VALUES (?, ?, ?, ?)",
        &[
            P::from(req.param("id")),
            db::from_json(Some(&at))?,
            db::from_json(b.get("pot_size"))?,
            db::from_json(b.get("memo"))?,
        ],
    )?;
    // 새 화분 크기를 현재 화분 크기에도 반영
    if crate::core::js::truthy(b.get("pot_size")) {
        db::run(
            &c,
            "UPDATE plants SET pot_size = ? WHERE id = ?",
            &[db::from_json(b.get("pot_size"))?, P::from(req.param("id"))],
        )?;
    }
    Ok(Reply::json(
        201,
        json!({ "id": result.last_insert_rowid, "repotted_at": at }),
    ))
}

async fn undo_today_repotting(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM repotting_logs WHERE plant_id = ? AND repotted_at = ?",
        params![req.param("id"), dates::today_str()],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn delete_repotting(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM repotting_logs WHERE id = ?",
        params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api", Some(require_auth));
    r.add("POST", p, "/plants/:id/waterings", a, add_watering);
    r.add(
        "DELETE",
        p,
        "/plants/:id/waterings/today",
        a,
        undo_today_watering,
    );
    r.add("DELETE", p, "/waterings/:id", a, delete_watering);
    r.add("POST", p, "/plants/:id/repottings", a, add_repotting);
    r.add(
        "DELETE",
        p,
        "/plants/:id/repottings/today",
        a,
        undo_today_repotting,
    );
    r.add("DELETE", p, "/repottings/:id", a, delete_repotting);
}
