import type { FastifyInstance } from 'fastify';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { todayStr } from '../dates.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

interface PhotoRow {
  id: number;
  plant_id: number;
  path: string;
  is_primary: number;
}

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // 사진 업로드 (multipart, 필드명 file)
  app.post<{ Params: { id: string } }>('/plants/:id/photos', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'file_required' });
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) return reply.code(400).send({ error: 'unsupported_type' });
    const buffer = await file.toBuffer();
    const filename = `p${req.params.id}-${Date.now()}.${ext}`;
    writeFileSync(join(config.dataDir, 'photos', filename), buffer);
    // 첫 사진이면 대표로 지정
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM photos WHERE plant_id = ?')
      .get(req.params.id) as { c: number };
    const result = db
      .prepare('INSERT INTO photos (plant_id, path, taken_at, is_primary) VALUES (?, ?, ?, ?)')
      .run(req.params.id, join('photos', filename), todayStr(config.tz), count.c === 0 ? 1 : 0);
    return reply.code(201).send({ id: Number(result.lastInsertRowid), path: join('photos', filename) });
  });

  app.post<{ Params: { id: string } }>('/photos/:id/primary', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id) as
      | PhotoRow
      | undefined;
    if (!photo) return reply.code(404).send({ error: 'not_found' });
    db.prepare('UPDATE photos SET is_primary = 0 WHERE plant_id = ?').run(photo.plant_id);
    db.prepare('UPDATE photos SET is_primary = 1 WHERE id = ?').run(photo.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/photos/:id', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id) as
      | PhotoRow
      | undefined;
    if (!photo) return reply.code(404).send({ error: 'not_found' });
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    try {
      unlinkSync(join(config.dataDir, photo.path));
    } catch {
      // 파일이 이미 없어도 무시
    }
    // 대표 사진을 지웠으면 가장 최근 사진을 대표로 승격
    if (photo.is_primary) {
      db.prepare(
        `UPDATE photos SET is_primary = 1
         WHERE id = (SELECT id FROM photos WHERE plant_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1)`,
      ).run(photo.plant_id);
    }
    return { ok: true };
  });
}
