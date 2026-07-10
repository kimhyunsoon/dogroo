import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export const db: Database.Database = new Database(join(config.dataDir, 'dogroo.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 스키마 + 식물 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
export function migrate(): void {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');
  db.exec(schema);
  // 기존 DB에 name_en 컬럼이 없으면 추가
  const cols = db.prepare('PRAGMA table_info(species)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'name_en')) {
    db.exec('ALTER TABLE species ADD COLUMN name_en TEXT');
  }
  const pool = readFileSync(new URL('./species-pool.sql', import.meta.url), 'utf-8');
  db.exec(pool);
}
