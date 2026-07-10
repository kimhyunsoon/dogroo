import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { config } from '../config.js';

// groo(plantingo) 백업 → dogroo 시드 임포트
// 매 기동 시 실행되며 import_ledger에 없는 원본 행만 INSERT한다.
// 이미 들어온 행은 절대 갱신하지 않음 - 사용자가 앱에서 수정했을 수 있다. (docs/migration.md 참고)

// RFC4180 간이 CSV 파서 (BOM·CRLF·따옴표 내 콤마/개행 지원)
function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// '2026-05-09 00:00' → '2026-05-09'
function toDate(value: string): string | null {
  const d = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function toIntOrNull(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface Counts {
  species: number;
  plants: number;
  waterings: number;
  repottings: number;
  photos: number;
}

export function runSeedImport(log: (msg: string) => void = console.log): void {
  const seedDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../seed');
  if (!existsSync(join(seedDir, 'user-plants.csv'))) return;

  const imagesDir = join(seedDir, 'images');
  const imageFiles = existsSync(imagesDir) ? readdirSync(imagesDir) : [];
  const photosDir = join(config.dataDir, 'photos');
  mkdirSync(photosDir, { recursive: true });

  const ledgerHas = db.prepare('SELECT 1 FROM import_ledger WHERE source = ? AND source_id = ?');
  const ledgerGet = db.prepare('SELECT local_id FROM import_ledger WHERE source = ? AND source_id = ?');
  const ledgerPut = db.prepare('INSERT INTO import_ledger (source, source_id, local_id) VALUES (?, ?, ?)');
  const counts: Counts = { species: 0, plants: 0, waterings: 0, repottings: 0, photos: 0 };

  const plants = parseCsv(readFileSync(join(seedDir, 'user-plants.csv'), 'utf-8'));
  const wiki = parseCsv(readFileSync(join(seedDir, 'species-wiki.csv'), 'utf-8'));
  const wikiById = new Map(wiki.map((w) => [w['ID'] ?? '', w]));

  const importAll = db.transaction((): void => {
    // 0-a) 치유: 이전 임포트가 영문명으로 만든 종이 풀의 영문명(부분 일치·학명 포함)과 겹치면
    //      풀의 한글 종으로 병합 (식물이 참조하지 않는 행만 - 안전한 정리)
    const wikiRows = db
      .prepare(
        `SELECT l.source_id, l.local_id, s.name, COALESCE(s.memo, '') AS sci FROM import_ledger l
         JOIN species s ON s.id = l.local_id WHERE l.source = 'wiki-species'`,
      )
      .all() as { source_id: string; local_id: number; name: string; sci: string }[];
    for (const row of wikiRows) {
      const korean = db
        .prepare(
          `SELECT id FROM species WHERE id != ? AND name_en IS NOT NULL AND (
             name_en LIKE '%' || ? || '%' OR (? != '' AND name_en LIKE '%' || ? || '%'))`,
        )
        .get(row.local_id, row.name, row.sci, row.sci) as { id: number } | undefined;
      if (!korean) continue;
      const referenced = db
        .prepare('SELECT COUNT(*) AS c FROM plants WHERE species_id = ?')
        .get(row.local_id) as { c: number };
      if (referenced.c > 0) continue;
      db.prepare(
        `UPDATE species SET
           water_summer_days = COALESCE(water_summer_days, (SELECT water_summer_days FROM species WHERE id = ?)),
           water_winter_days = COALESCE(water_winter_days, (SELECT water_winter_days FROM species WHERE id = ?)),
           memo = COALESCE(memo, (SELECT memo FROM species WHERE id = ?))
         WHERE id = ?`,
      ).run(row.local_id, row.local_id, row.local_id, korean.id);
      db.prepare('DELETE FROM species WHERE id = ?').run(row.local_id);
      db.prepare(`UPDATE import_ledger SET local_id = ? WHERE source = 'wiki-species' AND source_id = ?`).run(
        korean.id,
        row.source_id,
      );
    }

    // 0-b) 백업 도감(wiki) 종을 풀로 마이그레이션 - 한글명/영문명으로 매칭, 비어있는 값만 보강
    for (const w of wiki) {
      const wikiId = (w['ID'] ?? '').trim();
      const en = (w['대표이름'] ?? '').trim();
      const sci = (w['학명'] ?? '').trim();
      const name = en || sci;
      if (!wikiId || !name || ledgerHas.get('wiki-species', wikiId)) continue;
      const summer = toIntOrNull(w['물주기간격'] ?? '');
      const winter = summer ? Math.round(summer * 1.5) : null;
      const existing = db
        .prepare(
          `SELECT id FROM species WHERE name = ? OR name = ?
             OR (? != '' AND name_en LIKE '%' || ? || '%')
             OR (? != '' AND name_en LIKE '%' || ? || '%')`,
        )
        .get(en, sci, en, en, sci, sci) as { id: number } | undefined;
      if (existing) {
        db.prepare(
          `UPDATE species SET
             water_summer_days = COALESCE(water_summer_days, ?),
             water_winter_days = COALESCE(water_winter_days, ?),
             name_en = COALESCE(name_en, ?),
             memo = COALESCE(memo, ?)
           WHERE id = ?`,
        ).run(summer, winter, en || null, sci || null, existing.id);
        ledgerPut.run('wiki-species', wikiId, existing.id);
      } else {
        const result = db
          .prepare('INSERT INTO species (name, name_en, water_summer_days, water_winter_days, memo) VALUES (?, ?, ?, ?, ?)')
          .run(name, sci || en || null, summer, winter, sci || null);
        ledgerPut.run('wiki-species', wikiId, Number(result.lastInsertRowid));
        counts.species++;
      }
    }

    // 1) 종(species) - 사용자가 보던 한글 종명 기준 생성, wiki(도감ID)로 권장 주기 보강
    const speciesIdByName = new Map<string, number>();
    for (const p of plants) {
      const name = (p['직접입력종명'] || p['이름'] || '').trim();
      if (!name || speciesIdByName.has(name)) continue;
      const existing = ledgerGet.get('species', name) as { local_id: number } | undefined;
      if (existing) {
        speciesIdByName.set(name, existing.local_id);
        continue;
      }
      const w = wikiById.get(p['도감ID']?.trim() ?? '');
      const summer = w ? toIntOrNull(w['물주기간격'] ?? '') : null;
      // 겨울 권장값은 백업에 없음 - 휴면기 감안 여름의 1.5배로 근사
      const winter = summer ? Math.round(summer * 1.5) : null;
      // 풀(species-pool.sql)에 이미 있는 이름이면 재사용하고 비어있는 값만 보강
      const pooled = db.prepare('SELECT id FROM species WHERE name = ?').get(name) as
        | { id: number }
        | undefined;
      let id: number;
      if (pooled) {
        db.prepare(
          `UPDATE species SET
             water_summer_days = COALESCE(water_summer_days, ?),
             water_winter_days = COALESCE(water_winter_days, ?)
           WHERE id = ?`,
        ).run(summer, winter, pooled.id);
        id = pooled.id;
      } else {
        const result = db
          .prepare('INSERT INTO species (name, water_summer_days, water_winter_days) VALUES (?, ?, ?)')
          .run(name, summer, winter);
        id = Number(result.lastInsertRowid);
        counts.species++;
      }
      ledgerPut.run('species', name, id);
      speciesIdByName.set(name, id);
    }

    // 2) 식물 - 화분크기는 백업에 사실상 없음(53/56 빈값) → 기본 M
    const plantIdByOldId = new Map<string, number>();
    for (const p of plants) {
      const oldId = p['ID'] ?? '';
      const existing = ledgerGet.get('plant', oldId) as { local_id: number } | undefined;
      if (existing) {
        plantIdByOldId.set(oldId, existing.local_id);
        continue;
      }
      const speciesName = (p['직접입력종명'] || p['이름'] || '').trim();
      const result = db
        .prepare(
          `INSERT INTO plants (name, species_id, started_at, pot_size, water_interval_days, repot_interval_months)
           VALUES (?, ?, ?, 'M', ?, ?)`,
        )
        .run(
          (p['이름'] ?? '').trim(),
          speciesIdByName.get(speciesName) ?? null,
          toDate(p['입양일'] ?? ''),
          toIntOrNull(p['물주기주기'] ?? ''),
          toIntOrNull(p['분갈이주기'] ?? ''),
        );
      const id = Number(result.lastInsertRowid);
      ledgerPut.run('plant', oldId, id);
      plantIdByOldId.set(oldId, id);
      counts.plants++;
    }

    // 3) 케어 로그 - 완료된 물주기/분갈이만. 백업에 없는 식물(보낸 아이) 소속은 제외
    const logs = parseCsv(readFileSync(join(seedDir, 'care-logs.csv'), 'utf-8'));
    for (const l of logs) {
      const plantId = plantIdByOldId.get(l['내식물ID'] ?? '');
      const doneAt = toDate(l['완료일시'] ?? '');
      const type = (l['유형'] ?? '').trim();
      if (!plantId || !doneAt) continue;
      if (type !== '물주기' && type !== '분갈이하기') continue;
      const oldId = l['ID'] ?? '';
      if (ledgerHas.get('care-log', oldId)) continue;
      if (type === '물주기') {
        const result = db
          .prepare('INSERT INTO watering_logs (plant_id, watered_at) VALUES (?, ?)')
          .run(plantId, doneAt);
        ledgerPut.run('care-log', oldId, Number(result.lastInsertRowid));
        counts.waterings++;
      } else {
        const result = db
          .prepare('INSERT INTO repotting_logs (plant_id, repotted_at) VALUES (?, ?)')
          .run(plantId, doneAt);
        ledgerPut.run('care-log', oldId, Number(result.lastInsertRowid));
        counts.repottings++;
      }
    }

    // 4) 사진 - seed/images의 파일명 규칙: <날짜>_plant-<식물ID>-<순번>.jpg / <날짜>_carenote-<노트ID>-<순번>.jpg
    const notes = parseCsv(readFileSync(join(seedDir, 'care-notes.csv'), 'utf-8'));
    const plantIdByNoteId = new Map<string, number>();
    for (const n of notes) {
      const plantId = plantIdByOldId.get(n['내식물ID'] ?? '');
      if (plantId) plantIdByNoteId.set(n['ID'] ?? '', plantId);
    }
    for (const file of imageFiles) {
      const m = file.match(/^(\d{4}-\d{2}-\d{2})_(plant|carenote)-(\d+)-(\d+)\.jpg$/);
      if (!m) continue;
      const date = m[1]!;
      const kind = m[2]!;
      const oldId = m[3]!;
      const seq = m[4]!;
      const plantId =
        kind === 'plant' ? plantIdByOldId.get(oldId) : plantIdByNoteId.get(oldId);
      if (!plantId) continue;
      if (ledgerHas.get('photo', file)) continue;
      const destPath = join('photos', file);
      copyFileSync(join(imagesDir, file), join(config.dataDir, destPath));
      const result = db
        .prepare('INSERT INTO photos (plant_id, path, taken_at, is_primary) VALUES (?, ?, ?, ?)')
        .run(plantId, destPath, date, kind === 'plant' && seq === '0' ? 1 : 0);
      ledgerPut.run('photo', file, Number(result.lastInsertRowid));
      counts.photos++;
    }
  });

  importAll();
  const total = counts.species + counts.plants + counts.waterings + counts.repottings + counts.photos;
  if (total > 0) {
    log(
      `시드 임포트: 종 ${counts.species}, 식물 ${counts.plants}, 물주기 ${counts.waterings}, ` +
        `분갈이 ${counts.repottings}, 사진 ${counts.photos}`,
    );
  }
}
