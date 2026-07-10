import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

interface NotificationSettingBody {
  enabled?: boolean;
  send_at?: string; // HH:MM
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/notifications', async () => {
    // 알림은 물주기 단일
    return db.prepare(`SELECT * FROM notification_settings WHERE type = 'watering'`).all();
  });

  app.put<{ Params: { type: string }; Body: NotificationSettingBody }>(
    '/notifications/:type',
    async (req, reply) => {
      const { type } = req.params;
      if (type !== 'watering') {
        return reply.code(400).send({ error: 'invalid_type' });
      }
      const current = db
        .prepare('SELECT enabled, send_at FROM notification_settings WHERE type = ?')
        .get(type) as { enabled: number; send_at: string };
      db.prepare('UPDATE notification_settings SET enabled = ?, send_at = ? WHERE type = ?').run(
        req.body.enabled === undefined ? current.enabled : req.body.enabled ? 1 : 0,
        req.body.send_at ?? current.send_at,
        type,
      );
      return { ok: true };
    },
  );
}
