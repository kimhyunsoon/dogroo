// groo(plantingo) 백업 → dogroo 시드 임포트
// 매 기동 시 실행되며 import_ledger에 없는 원본 행만 INSERT한다.
// 이미 들어온 행은 절대 갱신하지 않음 - 사용자가 앱에서 수정했을 수 있다.
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;
use rusqlite::Connection;

use crate::config::CONFIG;
use crate::core::db::{self, DbError, P};
use crate::core::js;
use crate::params;

type CsvRow = HashMap<String, String>;

// RFC4180 간이 CSV 파서 (BOM·CRLF·따옴표 내 콤마/개행 지원)
fn parse_csv(text: &str) -> Vec<CsvRow> {
    let src = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows: Vec<Vec<String>> = vec![];
    let mut field = String::new();
    let mut row: Vec<String> = vec![];
    let mut in_quotes = false;
    let mut chars = src.chars().peekable();
    let strip_cr = |f: &str| f.strip_suffix('\r').unwrap_or(f).to_string();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            row.push(std::mem::take(&mut field));
        } else if ch == '\n' {
            row.push(strip_cr(&field));
            rows.push(std::mem::take(&mut row));
            field.clear();
        } else {
            field.push(ch);
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(strip_cr(&field));
        rows.push(row);
    }
    if rows.is_empty() {
        return vec![];
    }
    let header = rows.remove(0);
    rows.into_iter()
        .filter(|r| r.len() > 1 || !r.first().map(|s| s.as_str()).unwrap_or("").is_empty())
        .map(|r| {
            header
                .iter()
                .enumerate()
                .map(|(i, h)| (h.clone(), r.get(i).cloned().unwrap_or_default()))
                .collect()
        })
        .collect()
}

fn col<'a>(r: &'a CsvRow, k: &str) -> &'a str {
    r.get(k).map(|s| s.as_str()).unwrap_or("")
}

// '2026-05-09 00:00' → '2026-05-09'
fn to_date(value: &str) -> Option<String> {
    static RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    let d = js::utf16_slice(js::trim(value), 0, 10);
    if RE.is_match(&d) { Some(d) } else { None }
}

fn to_int_or_null(value: &str) -> Option<f64> {
    let n = js::string_to_number(js::trim(value));
    if n.is_finite() && n.fract() == 0.0 && n > 0.0 {
        Some(n)
    } else {
        None
    }
}

fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[derive(Default)]
struct Counts {
    species: i64,
    plants: i64,
    archived: i64,
    waterings: i64,
    repottings: i64,
    photos: i64,
}

fn read(path: &Path) -> Result<String, DbError> {
    std::fs::read_to_string(path).map_err(|e| DbError::msg(format!("{}: {e}", path.display())))
}

pub fn run_seed_import() -> Result<(), DbError> {
    let seed_dir = Path::new(&CONFIG.seed_dir);
    if !seed_dir.join("user-plants.csv").exists() {
        return Ok(());
    }
    let images_dir = seed_dir.join("images");
    // Node readdirSync 는 이름순(strcmp)
    let mut image_files: Vec<String> = std::fs::read_dir(&images_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok()?.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    image_files.sort();
    let photos_dir = Path::new(&CONFIG.data_dir).join("photos");
    std::fs::create_dir_all(&photos_dir).map_err(|e| DbError::msg(e.to_string()))?;

    let plants = parse_csv(&read(&seed_dir.join("user-plants.csv"))?);
    let logs = parse_csv(&read(&seed_dir.join("care-logs.csv"))?);
    let notes = parse_csv(&read(&seed_dir.join("care-notes.csv"))?);
    let wiki = parse_csv(&read(&seed_dir.join("species-wiki.csv"))?);
    // new Map(wiki.map(...)) - 같은 ID 는 마지막 것
    let mut wiki_by_id: HashMap<String, &CsvRow> = HashMap::new();
    for w in &wiki {
        wiki_by_id.insert(col(w, "ID").to_string(), w);
    }
    let mut counts = Counts::default();
    let c = db::conn();
    db::transaction(&c, |c| {
        import_all(
            c,
            &plants,
            &logs,
            &notes,
            &wiki,
            &wiki_by_id,
            &image_files,
            &images_dir,
            &mut counts,
        )
    })?;
    drop(c);
    let total = counts.species
        + counts.plants
        + counts.archived
        + counts.waterings
        + counts.repottings
        + counts.photos;
    if total > 0 {
        tracing::info!(
            "시드 임포트: 종 {}, 식물 {}, 보관 복원 {}, 물주기 {}, 분갈이 {}, 사진 {}",
            counts.species,
            counts.plants,
            counts.archived,
            counts.waterings,
            counts.repottings,
            counts.photos
        );
    }
    Ok(())
}

fn ledger_has(c: &Connection, source: &str, id: &str) -> Result<bool, DbError> {
    Ok(db::get(
        c,
        "SELECT 1 FROM import_ledger WHERE source = ? AND source_id = ?",
        params![source, id],
    )?
    .is_some())
}

fn ledger_get(c: &Connection, source: &str, id: &str) -> Result<Option<i64>, DbError> {
    Ok(db::get(
        c,
        "SELECT local_id FROM import_ledger WHERE source = ? AND source_id = ?",
        params![source, id],
    )?
    .and_then(|r| db::int(&r, "local_id")))
}

fn ledger_put(c: &Connection, source: &str, id: &str, local: i64) -> Result<(), DbError> {
    db::run(
        c,
        "INSERT INTO import_ledger (source, source_id, local_id) VALUES (?, ?, ?)",
        params![source, id, local],
    )?;
    Ok(())
}

fn id_of(row: Option<db::Row>) -> Option<i64> {
    row.and_then(|r| db::int(&r, "id"))
}

#[allow(clippy::too_many_arguments)]
fn import_all(
    c: &Connection,
    plants: &[CsvRow],
    logs: &[CsvRow],
    notes: &[CsvRow],
    wiki: &[CsvRow],
    wiki_by_id: &HashMap<String, &CsvRow>,
    image_files: &[String],
    images_dir: &Path,
    counts: &mut Counts,
) -> Result<(), DbError> {
    // 0-a) 치유: 이전 임포트가 영문명으로 만든 종이 풀의 영문명(부분 일치·학명 포함)과 겹치면
    //      풀의 한글 종으로 병합 (식물이 참조하지 않는 행만 - 안전한 정리)
    let wiki_rows = db::all(
        c,
        "SELECT l.source_id, l.local_id, s.name, COALESCE(s.memo, '') AS sci FROM import_ledger l
         JOIN species s ON s.id = l.local_id WHERE l.source = 'wiki-species'",
        params![],
    )?;
    for row in wiki_rows {
        let local = db::int(&row, "local_id");
        let name = db::text(&row, "name").unwrap_or("").to_string();
        let sci = db::text(&row, "sci").unwrap_or("").to_string();
        let korean = id_of(db::get(
            c,
            "SELECT id FROM species WHERE id != ? AND name_en IS NOT NULL AND (
             name_en LIKE '%' || ? || '%' OR (? != '' AND name_en LIKE '%' || ? || '%'))",
            params![local, name, sci.clone(), sci],
        )?);
        let Some(korean) = korean else { continue };
        let referenced = db::get(
            c,
            "SELECT COUNT(*) AS c FROM plants WHERE species_id = ?",
            params![local],
        )?
        .and_then(|r| db::int(&r, "c"))
        .unwrap_or(0);
        if referenced > 0 {
            continue;
        }
        db::run(
            c,
            "UPDATE species SET
           water_summer_days = COALESCE(water_summer_days, (SELECT water_summer_days FROM species WHERE id = ?)),
           water_winter_days = COALESCE(water_winter_days, (SELECT water_winter_days FROM species WHERE id = ?)),
           memo = COALESCE(memo, (SELECT memo FROM species WHERE id = ?))
         WHERE id = ?",
            params![local, local, local, korean],
        )?;
        db::run(c, "DELETE FROM species WHERE id = ?", params![local])?;
        db::run(
            c,
            "UPDATE import_ledger SET local_id = ? WHERE source = 'wiki-species' AND source_id = ?",
            &[P::from(korean), db::from_json(row.get("source_id"))?],
        )?;
    }

    // 0-b) 백업 도감(wiki) 종을 풀로 마이그레이션 - 한글명/영문명으로 매칭, 비어있는 값만 보강
    for w in wiki {
        let wiki_id = js::trim(col(w, "ID")).to_string();
        let en = js::trim(col(w, "대표이름")).to_string();
        let sci = js::trim(col(w, "학명")).to_string();
        let name = if !en.is_empty() {
            en.clone()
        } else {
            sci.clone()
        };
        if wiki_id.is_empty() || name.is_empty() || ledger_has(c, "wiki-species", &wiki_id)? {
            continue;
        }
        let summer = to_int_or_null(col(w, "물주기간격"));
        let winter = summer.map(|s| js_round(s * 1.5));
        let existing = id_of(db::get(
            c,
            "SELECT id FROM species WHERE name = ? OR name = ?
             OR (? != '' AND name_en LIKE '%' || ? || '%')
             OR (? != '' AND name_en LIKE '%' || ? || '%')",
            params![
                en.clone(),
                sci.clone(),
                en.clone(),
                en.clone(),
                sci.clone(),
                sci.clone()
            ],
        )?);
        let nonempty = |s: &String| if s.is_empty() { None } else { Some(s.clone()) };
        if let Some(existing) = existing {
            db::run(
                c,
                "UPDATE species SET
             water_summer_days = COALESCE(water_summer_days, ?),
             water_winter_days = COALESCE(water_winter_days, ?),
             name_en = COALESCE(name_en, ?),
             memo = COALESCE(memo, ?)
           WHERE id = ?",
                params![summer, winter, nonempty(&en), nonempty(&sci), existing],
            )?;
            ledger_put(c, "wiki-species", &wiki_id, existing)?;
        } else {
            let result = db::run(
                c,
                "INSERT INTO species (name, name_en, water_summer_days, water_winter_days, memo) VALUES (?, ?, ?, ?, ?)",
                params![
                    name,
                    nonempty(&sci).or_else(|| nonempty(&en)),
                    summer,
                    winter,
                    nonempty(&sci)
                ],
            )?;
            ledger_put(c, "wiki-species", &wiki_id, result.last_insert_rowid)?;
            counts.species += 1;
        }
    }

    // 1) 종(species) - 사용자가 보던 한글 종명 기준 생성, wiki(도감ID)로 권장 주기 보강
    let mut species_id_by_name: HashMap<String, i64> = HashMap::new();
    let species_name_of = |p: &CsvRow| {
        let direct = col(p, "직접입력종명");
        js::trim(if !direct.is_empty() {
            direct
        } else {
            col(p, "이름")
        })
        .to_string()
    };
    for p in plants {
        let name = species_name_of(p);
        if name.is_empty() || species_id_by_name.contains_key(&name) {
            continue;
        }
        if let Some(existing) = ledger_get(c, "species", &name)? {
            species_id_by_name.insert(name, existing);
            continue;
        }
        let w = wiki_by_id.get(js::trim(col(p, "도감ID")));
        let summer = w.and_then(|w| to_int_or_null(col(w, "물주기간격")));
        // 겨울 권장값은 백업에 없음 - 휴면기 감안 여름의 1.5배로 근사
        let winter = summer.map(|s| js_round(s * 1.5));
        // 풀(species-pool.sql)에 이미 있는 이름이면 재사용하고 비어있는 값만 보강
        let pooled = id_of(db::get(
            c,
            "SELECT id FROM species WHERE name = ?",
            params![name.clone()],
        )?);
        let id = if let Some(pooled) = pooled {
            db::run(
                c,
                "UPDATE species SET
             water_summer_days = COALESCE(water_summer_days, ?),
             water_winter_days = COALESCE(water_winter_days, ?)
           WHERE id = ?",
                params![summer, winter, pooled],
            )?;
            pooled
        } else {
            let result = db::run(
                c,
                "INSERT INTO species (name, water_summer_days, water_winter_days) VALUES (?, ?, ?)",
                params![name.clone(), summer, winter],
            )?;
            counts.species += 1;
            result.last_insert_rowid
        };
        ledger_put(c, "species", &name, id)?;
        species_id_by_name.insert(name, id);
    }

    // 2) 식물 - 화분크기는 백업에 사실상 없음(53/56 빈값) → 기본 M
    let mut plant_id_by_old_id: HashMap<String, i64> = HashMap::new();
    for p in plants {
        let old_id = col(p, "ID").to_string();
        if let Some(existing) = ledger_get(c, "plant", &old_id)? {
            plant_id_by_old_id.insert(old_id, existing);
            continue;
        }
        let result = db::run(
            c,
            "INSERT INTO plants (name, species_id, started_at, pot_size, water_interval_days, repot_interval_months)
           VALUES (?, ?, ?, 'M', ?, ?)",
            params![
                js::trim(col(p, "이름")),
                species_id_by_name.get(&species_name_of(p)).copied(),
                to_date(col(p, "입양일")),
                to_int_or_null(col(p, "물주기주기")),
                to_int_or_null(col(p, "분갈이주기")),
            ],
        )?;
        let id = result.last_insert_rowid;
        ledger_put(c, "plant", &old_id, id)?;
        plant_id_by_old_id.insert(old_id, id);
        counts.plants += 1;
    }

    // 2-b) 그루에서 삭제(보낸)했던 식물 - 백업 목록엔 없지만 로그·노트에 흔적이 남아있다.
    //      "새 식물을 추가했어요" 노트로 이름을 복원할 수 있는 것만 '보관' 상태로 되살린다.
    //      plantIdByOldId에 매핑이 더해지므로 3)에서 이들의 물주기·분갈이 로그도 함께 들어온다.
    static ADDED: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new("^새 식물을 추가했어요! 🪴 ([^\n\r\u{2028}\u{2029}]+)$").unwrap()
    });
    let alive: HashSet<&str> = plants.iter().map(|p| col(p, "ID")).collect();
    let mut deleted_name: IndexMap<String, String> = IndexMap::new(); // 옛 식물ID → 복원한 이름
    let mut deleted_span: HashMap<String, (String, String)> = HashMap::new(); // 활동 기간
    let mut track = |old_id: &str, date: Option<String>| {
        let Some(date) = date else { return };
        if old_id.is_empty() || alive.contains(old_id) {
            return;
        }
        match deleted_span.get_mut(old_id) {
            None => {
                deleted_span.insert(old_id.to_string(), (date.clone(), date));
            }
            Some(span) => {
                if date < span.0 {
                    span.0 = date.clone();
                }
                if date > span.1 {
                    span.1 = date;
                }
            }
        }
    };
    for n in notes {
        let old_id = col(n, "내식물ID");
        if old_id.is_empty() || alive.contains(old_id) {
            continue;
        }
        track(old_id, to_date(col(n, "기록일시")));
        if let Some(m) = ADDED.captures(col(n, "내용")) {
            // 이름에 별칭이 쉼표로 병기된 경우("카랑코에, 카란코에") 첫 항목만
            let first = m[1].split(',').next().unwrap_or("");
            deleted_name.insert(old_id.to_string(), js::trim(first).to_string());
        }
    }
    for l in logs {
        track(col(l, "내식물ID"), to_date(col(l, "완료일시")));
    }
    for (old_id, name) in &deleted_name {
        if name.is_empty() || ledger_has(c, "plant", old_id)? {
            continue;
        }
        let Some((first, last)) = deleted_span.get(old_id) else {
            continue;
        };
        // 종 매칭: 풀·기등록 종에서 이름으로 (실패 시 미지정)
        let species = id_of(db::get(
            c,
            "SELECT id FROM species WHERE name = ?",
            params![name.clone()],
        )?);
        let result = db::run(
            c,
            "INSERT INTO plants (name, species_id, started_at, pot_size, archived_at)
           VALUES (?, ?, ?, 'M', ?)",
            params![
                name.clone(),
                species,
                first.clone(),
                format!("{last} 00:00:00")
            ],
        )?;
        let id = result.last_insert_rowid;
        ledger_put(c, "plant", old_id, id)?;
        plant_id_by_old_id.insert(old_id.clone(), id);
        counts.archived += 1;
    }

    // 3) 케어 로그 - 완료된 물주기/분갈이만. 원본에도 흔적이 없는 식물 소속은 제외
    for l in logs {
        let plant_id = plant_id_by_old_id.get(col(l, "내식물ID")).copied();
        let done_at = to_date(col(l, "완료일시"));
        let ty = js::trim(col(l, "유형"));
        let (Some(plant_id), Some(done_at)) = (plant_id, done_at) else {
            continue;
        };
        if ty != "물주기" && ty != "분갈이하기" {
            continue;
        }
        let old_id = col(l, "ID");
        if ledger_has(c, "care-log", old_id)? {
            continue;
        }
        if ty == "물주기" {
            let result = db::run(
                c,
                "INSERT INTO watering_logs (plant_id, watered_at) VALUES (?, ?)",
                params![plant_id, done_at],
            )?;
            ledger_put(c, "care-log", old_id, result.last_insert_rowid)?;
            counts.waterings += 1;
        } else {
            let result = db::run(
                c,
                "INSERT INTO repotting_logs (plant_id, repotted_at) VALUES (?, ?)",
                params![plant_id, done_at],
            )?;
            ledger_put(c, "care-log", old_id, result.last_insert_rowid)?;
            counts.repottings += 1;
        }
    }

    // 4) 사진 - seed/images의 파일명 규칙: <날짜>_plant-<식물ID>-<순번>.jpg / <날짜>_carenote-<노트ID>-<순번>.jpg
    let mut plant_id_by_note_id: HashMap<String, i64> = HashMap::new();
    for n in notes {
        if let Some(pid) = plant_id_by_old_id.get(col(n, "내식물ID")) {
            plant_id_by_note_id.insert(col(n, "ID").to_string(), *pid);
        }
    }
    static FILE_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^([0-9]{4}-[0-9]{2}-[0-9]{2})_(plant|carenote)-([0-9]+)-([0-9]+)\.jpg$")
            .unwrap()
    });
    for file in image_files {
        let Some(m) = FILE_RE.captures(file) else {
            continue;
        };
        let (date, kind, old_id, seq) = (&m[1], &m[2], &m[3], &m[4]);
        let plant_id = if kind == "plant" {
            plant_id_by_old_id.get(old_id)
        } else {
            plant_id_by_note_id.get(old_id)
        };
        let Some(&plant_id) = plant_id else { continue };
        if ledger_has(c, "photo", file)? {
            continue;
        }
        let dest = format!("photos/{file}");
        std::fs::copy(
            images_dir.join(file),
            Path::new(&CONFIG.data_dir).join(&dest),
        )
        .map_err(|e| DbError::msg(e.to_string()))?;
        let result = db::run(
            c,
            "INSERT INTO photos (plant_id, path, taken_at, is_primary) VALUES (?, ?, ?, ?)",
            params![
                plant_id,
                dest,
                date,
                if kind == "plant" && seq == "0" { 1 } else { 0 }
            ],
        )?;
        ledger_put(c, "photo", file, result.last_insert_rowid)?;
        counts.photos += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_like_ts() {
        let rows = parse_csv("\u{feff}A,B\r\n1,\"x,\"\"y\"\"\nz\"\r\n\r\n2\n");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["B"], "x,\"y\"\nz");
        assert_eq!(rows[1]["A"], "2");
        assert_eq!(rows[1]["B"], "");
    }
}
