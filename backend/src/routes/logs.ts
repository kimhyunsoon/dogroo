import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { todayStr, addDays } from '../dates.js';

interface WateringBody {
  watered_at?: string; // 소급 기록 (오늘~5일 전), 생략 시 오늘
  memo?: string;
}

interface RepottingBody {
  repotted_at?: string;
  pot_size?: 'S' | 'M' | 'L';
  memo?: string;
}

// 허용 날짜: 오늘 ~ 7일 전 (소급 기록)
function isAllowedDate(date: string): boolean {
  const today = todayStr(config.tz);
  for (let n = 0; n <= 7; n++) {
    if (date === addDays(today, -n)) return true;
  }
  return false;
}

export async function logRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post<{ Params: { id: string }; Body: WateringBody }>(
    '/plants/:id/waterings',
    async (req, reply) => {
      const at = req.body.watered_at ?? todayStr(config.tz);
      if (!isAllowedDate(at)) return reply.code(400).send({ error: 'out_of_range' });
      const result = db
        .prepare('INSERT INTO watering_logs (plant_id, watered_at, memo) VALUES (?, ?, ?)')
        .run(req.params.id, at, req.body.memo ?? null);
      return reply.code(201).send({ id: Number(result.lastInsertRowid), watered_at: at });
    },
  );

  // 오늘 기록 토글 취소 (목록에서 완료 버튼 재탭)
  app.delete<{ Params: { id: string } }>('/plants/:id/waterings/today', async (req) => {
    db.prepare('DELETE FROM watering_logs WHERE plant_id = ? AND watered_at = ?').run(
      req.params.id,
      todayStr(config.tz),
    );
    return { ok: true };
  });

  // 실행취소·오기록 정정용 삭제
  app.delete<{ Params: { id: string } }>('/waterings/:id', async (req) => {
    db.prepare('DELETE FROM watering_logs WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: RepottingBody }>(
    '/plants/:id/repottings',
    async (req, reply) => {
      const at = req.body.repotted_at ?? todayStr(config.tz);
      if (!isAllowedDate(at)) return reply.code(400).send({ error: 'out_of_range' });
      const result = db
        .prepare('INSERT INTO repotting_logs (plant_id, repotted_at, pot_size, memo) VALUES (?, ?, ?, ?)')
        .run(req.params.id, at, req.body.pot_size ?? null, req.body.memo ?? null);
      // 새 화분 크기를 현재 화분 크기에도 반영
      if (req.body.pot_size) {
        db.prepare('UPDATE plants SET pot_size = ? WHERE id = ?').run(req.body.pot_size, req.params.id);
      }
      return reply.code(201).send({ id: Number(result.lastInsertRowid), repotted_at: at });
    },
  );

  app.delete<{ Params: { id: string } }>('/plants/:id/repottings/today', async (req) => {
    db.prepare('DELETE FROM repotting_logs WHERE plant_id = ? AND repotted_at = ?').run(
      req.params.id,
      todayStr(config.tz),
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/repottings/:id', async (req) => {
    db.prepare('DELETE FROM repotting_logs WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
