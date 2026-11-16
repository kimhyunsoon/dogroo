use serde_json::json;

use super::{body_for, or_null};
use crate::core::app::{HResult, Pre, Reply, Req, Routes, require_auth};
use crate::core::db::{self, P};
use crate::core::js;
use crate::params;
use crate::plants_query::to_value;

async fn list(_req: Req) -> HResult {
    // 알림은 물주기 단일
    let c = db::conn();
    Ok(Reply::ok(to_value(db::all(
        &c,
        "SELECT * FROM notification_settings WHERE type = 'watering'",
        params![],
    )?)))
}

async fn update(req: Req) -> HResult {
    let ty = req.param("type").to_string();
    if ty != "watering" {
        return Ok(Reply::error(400, "invalid_type"));
    }
    let c = db::conn();
    let current = db::get(
        &c,
        "SELECT enabled, send_at FROM notification_settings WHERE type = ?",
        params![ty.clone()],
    )?
    .unwrap_or_default();
    let b = body_for(&req, "enabled")?;
    let enabled = match b.get("enabled") {
        None => db::from_json(current.get("enabled"))?,
        v => P::Num(if js::truthy(v) { 1.0 } else { 0.0 }),
    };
    let send_at = match or_null(b.get("send_at")) {
        None => db::from_json(current.get("send_at"))?,
        v => db::from_json(v)?,
    };
    db::run(
        &c,
        "UPDATE notification_settings SET enabled = ?, send_at = ? WHERE type = ?",
        &[enabled, send_at, P::from(ty)],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api/settings", Some(require_auth));
    r.add("GET", p, "/notifications", a, list);
    r.add("PUT", p, "/notifications/:type", a, update);
}
