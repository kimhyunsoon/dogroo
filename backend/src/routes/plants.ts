import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { todayStr } from '../dates.js';
import { listPlants, getPlant } from '../plants-query.js';

interface PlantBody {
  name: string;
  species_id?: number | null; // 식물 풀에서 선택
  started_at?: string | null;
  pot_size?: 'S' | 'M' | 'L';
  pot_type?: string | null; // 화분 재질
  water_interval_days?: number | null; // null = 자동(추천값 사용)
  repot_interval_months?: number | null;
  memo?: string | null;
}

export async function plantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Querystring: { archived?: string } }>('/', async (req) => {
    return listPlants(todayStr(config.tz), req.query.archived === '1');
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const plant = getPlant(req.params.id, todayStr(config.tz));
    if (!plant) return reply.code(404).send({ error: 'not_found' });
    const photos = db
      .prepare('SELECT * FROM photos WHERE plant_id = ? ORDER BY is_primary DESC, taken_at DESC, id DESC')
      .all(req.params.id);
    const waterings = db
      .prepare('SELECT * FROM watering_logs WHERE plant_id = ? ORDER BY watered_at DESC, id DESC LIMIT 100')
      .all(req.params.id);
    const repottings = db
      .prepare('SELECT * FROM repotting_logs WHERE plant_id = ? ORDER BY repotted_at DESC, id DESC')
      .all(req.params.id);
    return { ...plant, photos, waterings, repottings };
  });

  app.post<{ Body: PlantBody }>('/', async (req, reply) => {
    const b = req.body;
    if (!b.name?.trim()) return reply.code(400).send({ error: 'name_required' });
    const result = db
      .prepare(
        `INSERT INTO plants (name, species_id, started_at, pot_size, pot_type, water_interval_days, repot_interval_months, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        b.name.trim(),
        b.species_id ?? null,
        b.started_at ?? null,
        b.pot_size ?? 'M',
        b.pot_type ?? null,
        b.water_interval_days ?? null,
        b.repot_interval_months ?? null,
        b.memo ?? null,
      );
    return reply.code(201).send({ id: Number(result.lastInsertRowid) });
  });

  app.patch<{ Params: { id: string }; Body: Partial<PlantBody> }>('/:id', async (req, reply) => {
    const b = req.body;
    const sets: string[] = [];
    const values: unknown[] = [];
    if (b.name !== undefined) { sets.push('name = ?'); values.push(b.name.trim()); }
    if (b.species_id !== undefined) { sets.push('species_id = ?'); values.push(b.species_id); }
    if (b.started_at !== undefined) { sets.push('started_at = ?'); values.push(b.started_at); }
    if (b.pot_size !== undefined) { sets.push('pot_size = ?'); values.push(b.pot_size); }
    if (b.pot_type !== undefined) { sets.push('pot_type = ?'); values.push(b.pot_type); }
    if (b.water_interval_days !== undefined) { sets.push('water_interval_days = ?'); values.push(b.water_interval_days); }
    if (b.repot_interval_months !== undefined) { sets.push('repot_interval_months = ?'); values.push(b.repot_interval_months); }
    if (b.memo !== undefined) { sets.push('memo = ?'); values.push(b.memo); }
    if (sets.length === 0) return reply.code(400).send({ error: 'empty_body' });
    db.prepare(`UPDATE plants SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    return { ok: true };
  });

  // 삭제 대신 보관(아카이브)
  app.post<{ Params: { id: string } }>('/:id/archive', async (req) => {
    db.prepare(`UPDATE plants SET archived_at = datetime('now') WHERE id = ?`).run(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/:id/unarchive', async (req) => {
    db.prepare('UPDATE plants SET archived_at = NULL WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
