use serde_json::{Value, json};

use super::{body_for, or_null, trim_of};
use crate::core::app::{HResult, Pre, Reply, Req, Routes, require_auth};
use crate::core::dates;
use crate::core::db::{self, P};
use crate::plants_query::{get_plant, list_plants, to_value};

async fn list(req: Req) -> HResult {
    let archived = req.query_str("archived") == Some("1");
    Ok(Reply::ok(to_value(list_plants(
        &dates::today_str(),
        archived,
    )?)))
}

async fn detail(req: Req) -> HResult {
    let id = req.param("id").to_string();
    let Some(mut plant) = get_plant(P::from(id.clone()), &dates::today_str())? else {
        return Ok(Reply::error(404, "not_found"));
    };
    let c = db::conn();
    let photos = db::all(
        &c,
        "SELECT * FROM photos WHERE plant_id = ? ORDER BY is_primary DESC, taken_at DESC, id DESC",
        crate::params![id.clone()],
    )?;
    let waterings = db::all(
        &c,
        "SELECT * FROM watering_logs WHERE plant_id = ? ORDER BY watered_at DESC, id DESC LIMIT 100",
        crate::params![id.clone()],
    )?;
    let repottings = db::all(
        &c,
        "SELECT * FROM repotting_logs WHERE plant_id = ? ORDER BY repotted_at DESC, id DESC",
        crate::params![id],
    )?;
    plant.insert("photos".into(), to_value(photos));
    plant.insert("waterings".into(), to_value(waterings));
    plant.insert("repottings".into(), to_value(repottings));
    Ok(Reply::ok(Value::Object(plant)))
}

async fn create(req: Req) -> HResult {
    let b = body_for(&req, "name")?;
    let name = match or_null(b.get("name")) {
        None => None,
        v => Some(trim_of(v, "b.name?")?),
    };
    let Some(name) = name.filter(|n| !n.is_empty()) else {
        return Ok(Reply::error(400, "name_required"));
    };
    let pot = match or_null(b.get("pot_size")) {
        None => P::from("M"),
        v => db::from_json(v)?,
    };
    let c = db::conn();
    let result = db::run(
        &c,
        "INSERT INTO plants (name, species_id, started_at, pot_size, pot_type, water_interval_days, repot_interval_months, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        &[
            P::from(name),
            db::from_json(b.get("species_id"))?,
            db::from_json(b.get("started_at"))?,
            pot,
            db::from_json(b.get("pot_type"))?,
            db::from_json(b.get("water_interval_days"))?,
            db::from_json(b.get("repot_interval_months"))?,
            db::from_json(b.get("memo"))?,
        ],
    )?;
    Ok(Reply::json(201, json!({ "id": result.last_insert_rowid })))
}

async fn update(req: Req) -> HResult {
    let b = body_for(&req, "name")?;
    let mut sets: Vec<&str> = vec![];
    let mut values: Vec<P> = vec![];
    if let Some(v) = b.get("name") {
        sets.push("name = ?");
        values.push(P::from(trim_of(Some(v), "b.name")?));
    }
    for (k, set) in [
        ("species_id", "species_id = ?"),
        ("started_at", "started_at = ?"),
        ("pot_size", "pot_size = ?"),
        ("pot_type", "pot_type = ?"),
        ("water_interval_days", "water_interval_days = ?"),
        ("repot_interval_months", "repot_interval_months = ?"),
        ("memo", "memo = ?"),
    ] {
        if let Some(v) = b.get(k) {
            sets.push(set);
            values.push(db::from_json(Some(v))?);
        }
    }
    if sets.is_empty() {
        return Ok(Reply::error(400, "empty_body"));
    }
    values.push(P::from(req.param("id")));
    let c = db::conn();
    db::run(
        &c,
        &format!("UPDATE plants SET {} WHERE id = ?", sets.join(", ")),
        &values,
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

// 삭제 대신 보관(아카이브)
async fn archive(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "UPDATE plants SET archived_at = datetime('now') WHERE id = ?",
        crate::params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn unarchive(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "UPDATE plants SET archived_at = NULL WHERE id = ?",
        crate::params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api/plants", Some(require_auth));
    r.add("GET", p, "/", a, list);
    r.add("GET", p, "/:id", a, detail);
    r.add("POST", p, "/", a, create);
    r.add("PATCH", p, "/:id", a, update);
    r.add("POST", p, "/:id/archive", a, archive);
    r.add("POST", p, "/:id/unarchive", a, unarchive);
}
