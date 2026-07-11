import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

// 식물 풀 검색 - 등록 시 종 선택용
export async function speciesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get<{ Querystring: { q?: string } }>('/', async (req) => {
    const q = (req.query.q ?? '').trim();
    // 한글명·영문명 모두 검색, 앞부분 일치 우선, 한글 유통명이 영문명보다 먼저
    return db
      .prepare(
        `SELECT * FROM species
         WHERE name LIKE '%' || ? || '%' OR name_en LIKE '%' || ? || '%'
         ORDER BY (name LIKE ? || '%') DESC, (name GLOB '[A-Za-z]*'), name LIMIT 50`,
      )
      .all(q, q, q);
  });
}
