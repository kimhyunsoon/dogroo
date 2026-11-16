use serde_json::Value;

use crate::core::app::{AppError, HResult, Reply, Req, Routes, require_auth};
use crate::core::{db, js};
use crate::params;
use crate::plants_query::to_value;

// 식물 풀 검색 - 등록 시 종 선택용
async fn search(req: Req) -> HResult {
    let q = match req.query("q") {
        None => String::new(),
        Some(Value::String(s)) => js::trim(s).to_string(),
        Some(_) => {
            return Err(AppError::type_error(
                "(req.query.q ?? \"\").trim is not a function",
            ));
        }
    };
    // 한글명·영문명 모두 검색, 앞부분 일치 우선, 한글 유통명이 영문명보다 먼저
    let c = db::conn();
    let rows = db::all(
        &c,
        "SELECT * FROM species
         WHERE name LIKE '%' || ? || '%' OR name_en LIKE '%' || ? || '%'
         ORDER BY (name LIKE ? || '%') DESC, (name GLOB '[A-Za-z]*'), name LIMIT 50",
        params![q.clone(), q.clone(), q],
    )?;
    Ok(Reply::ok(to_value(rows)))
}

pub fn register(r: &mut Routes) {
    r.add("GET", "/api/species", "/", Some(require_auth), search);
}
