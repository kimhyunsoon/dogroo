// 목록·상세 계산 (D-day, 추천 주기) - TS plants-query.ts + recommend.ts
// JS 숫자 의미 그대로: 화분 크기가 S/M/L 이 아니면 계수가 undefined 라 NaN → JSON null
use serde_json::{Map, Value};

use crate::core::app::AppError;
use crate::core::dates::{add_days, add_months, diff_days, month_of};
use crate::core::db::{self, P, Row};
use crate::core::js;

const LIST_SQL: &str = "
SELECT p.*, s.name AS species_name, s.name_en AS species_name_en, s.group_name,
  s.water_summer_days, s.water_winter_days, s.repot_months,
  (SELECT MAX(watered_at) FROM watering_logs w WHERE w.plant_id = p.id) AS last_watered_at,
  (SELECT MAX(repotted_at) FROM repotting_logs r WHERE r.plant_id = p.id) AS last_repotted_at,
  (SELECT path FROM photos ph WHERE ph.plant_id = p.id
    ORDER BY ph.is_primary DESC, ph.taken_at DESC, ph.id DESC LIMIT 1) AS photo
FROM plants p LEFT JOIN species s ON s.id = p.species_id";

// 화분이 작을수록 빨리 마르므로 주기 단축
fn pot_factor(pot: Option<&Value>) -> f64 {
    match pot.and_then(|v| v.as_str()) {
        Some("S") => 0.8,
        Some("M") => 1.0,
        Some("L") => 1.3,
        _ => f64::NAN,
    }
}

// 4~9월 여름 주기, 10~3월 겨울 주기
pub fn is_summer(date: &str) -> bool {
    let m = month_of(date);
    (4.0..=9.0).contains(&m)
}

// 종 데이터가 없을 때의 기본값 - D-day가 항상 계산되도록 보장
const FALLBACK_WATER_SUMMER: f64 = 7.0;
const FALLBACK_WATER_WINTER: f64 = 10.0;
const FALLBACK_REPOT_MONTHS: f64 = 12.0;

/// JS Math.round (.5 는 +∞ 쪽)
fn js_round(x: f64) -> f64 {
    if x.is_nan() { x } else { (x + 0.5).floor() }
}

/// 값 → JS number (null/undefined 는 None: `??` 대상)
fn num(v: Option<&Value>) -> Option<f64> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::Number(n)) => Some(js::as_f64(n)),
        // TEXT 친화성 없는 INTEGER 컬럼에 문자열이 들어간 경우 - JS 산술처럼 Number()
        Some(Value::String(s)) => Some(js::string_to_number(s)),
        Some(other) => Some(if js::truthy(Some(other)) { 1.0 } else { 0.0 }),
    }
}

fn truthy_num(f: f64) -> bool {
    f != 0.0 && !f.is_nan()
}

fn invalid_time() -> AppError {
    AppError::internal("Invalid time value")
}

fn enrich(mut row: Row, today: &str) -> Result<Row, AppError> {
    let has_species = js::truthy(row.get("species_id"));
    let summer = is_summer(today);
    let species_water = if has_species {
        num(row.get(if summer {
            "water_summer_days"
        } else {
            "water_winter_days"
        }))
    } else {
        None
    };
    let base = species_water.unwrap_or(if summer {
        FALLBACK_WATER_SUMMER
    } else {
        FALLBACK_WATER_WINTER
    });
    let rec_water = {
        let r = js_round(base * pot_factor(row.get("pot_size")));
        if r.is_nan() { f64::NAN } else { r.max(1.0) }
    };
    let rec_repot = if has_species {
        num(row.get("repot_months"))
    } else {
        None
    }
    .unwrap_or(FALLBACK_REPOT_MONTHS);
    let water_days = num(row.get("water_interval_days")).unwrap_or(rec_water);
    let repot_months = num(row.get("repot_interval_months")).unwrap_or(rec_repot);

    let slice10 = |v: Option<&Value>| -> Option<String> {
        match v {
            Some(Value::String(s)) if !s.is_empty() => Some(js::utf16_slice(s, 0, 10)),
            Some(Value::Number(n)) => Some(js::utf16_slice(
                &js::to_js_string(Some(&Value::Number(n.clone()))),
                0,
                10,
            )),
            _ => None,
        }
    };
    let last_watered = slice10(row.get("last_watered_at"));
    let next_water = match (&last_watered, truthy_num(water_days)) {
        (Some(d), true) => Some(add_days(d, water_days).ok_or_else(invalid_time)?),
        _ => None,
    };
    let repot_base = match slice10(row.get("last_repotted_at")) {
        Some(d) => Some(d),
        None => match row.get("started_at") {
            Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
            _ => None,
        },
    };
    let next_repot = match (&repot_base, truthy_num(repot_months)) {
        (Some(b), true) => {
            Some(add_months(&js::utf16_slice(b, 0, 10), repot_months).ok_or_else(invalid_time)?)
        }
        _ => None,
    };
    let dday = |next: &Option<String>| -> Value {
        match next {
            Some(n) => diff_days(n, today).map(Value::from).unwrap_or(Value::Null),
            None => Value::Null,
        }
    };
    let opt = |s: &Option<String>| s.clone().map(Value::String).unwrap_or(Value::Null);
    row.insert("recommended_water_days".into(), js::num(rec_water));
    row.insert("recommended_repot_months".into(), js::num(rec_repot));
    row.insert("effective_water_days".into(), js::num(water_days));
    row.insert("effective_repot_months".into(), js::num(repot_months));
    row.insert("next_water_at".into(), opt(&next_water));
    row.insert("next_repot_at".into(), opt(&next_repot));
    row.insert("water_dday".into(), dday(&next_water));
    row.insert("repot_dday".into(), dday(&next_repot));
    Ok(row)
}

pub fn list_plants(today: &str, include_archived: bool) -> Result<Vec<Row>, AppError> {
    let where_ = if include_archived {
        ""
    } else {
        " WHERE p.archived_at IS NULL"
    };
    let rows = {
        let c = db::conn();
        db::all(&c, &format!("{LIST_SQL}{where_} ORDER BY p.name"), &[])?
    };
    rows.into_iter().map(|r| enrich(r, today)).collect()
}

pub fn get_plant(id: P, today: &str) -> Result<Option<Row>, AppError> {
    let row = {
        let c = db::conn();
        db::get(&c, &format!("{LIST_SQL} WHERE p.id = ?"), &[id])?
    };
    row.map(|r| enrich(r, today)).transpose()
}

pub fn to_value(rows: Vec<Row>) -> Value {
    Value::Array(rows.into_iter().map(Value::Object).collect())
}

pub fn obj(row: Row) -> Value {
    Value::Object(row)
}

pub type Obj = Map<String, Value>;
