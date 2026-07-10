import webpush from 'web-push';
import { db } from './db.js';
import { config } from './config.js';
import { todayStr } from './dates.js';
import { listPlants } from './plants-query.js';

interface SettingRow {
  type: 'watering' | 'repotting' | 'reminder';
  enabled: number;
  send_at: string;
}

interface SubRow {
  id: number;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

// 알림 스케줄러 - 30초마다 설정 시각(HH:MM) 도달 여부를 확인해 Web Push 발송
export function startNotifier(log: (msg: string) => void): void {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

  // type → 마지막 발송일 (같은 날 중복 발송 방지)
  const lastSent = new Map<string, string>();
  setInterval(() => void check(), 30_000);

  async function check(): Promise<void> {
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-GB', {
      timeZone: config.tz,
      hour: '2-digit',
      minute: '2-digit',
    });
    const today = todayStr(config.tz);
    const settings = db
      .prepare('SELECT * FROM notification_settings WHERE enabled = 1')
      .all() as SettingRow[];

    for (const s of settings) {
      if (s.send_at !== hhmm || lastSent.get(s.type) === today) continue;
      lastSent.set(s.type, today);
      const message = buildMessage(s.type, today);
      if (message) await broadcast(message.title, message.body);
    }
  }

  // 알림은 물주기 단일 (분갈이·리마인더 없음)
  function buildMessage(type: SettingRow['type'], today: string): { title: string; body: string } | null {
    if (type !== 'watering') return null;
    const plants = listPlants(today, false);
    const waterDue = plants.filter((p) => p.water_dday !== null && p.water_dday <= 0);
    if (waterDue.length === 0) return null;
    const names = waterDue.map((p) => p.name);
    const body = names.slice(0, 5).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}개` : '');
    return { title: `💧 오늘 물 줄 화분 ${waterDue.length}개`, body };
  }

  async function broadcast(title: string, body: string): Promise<void> {
    const subs = db.prepare('SELECT * FROM push_subscriptions').all() as SubRow[];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
          JSON.stringify({ title, body }),
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 만료된 구독은 정리
        if (status === 404 || status === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          log(`푸시 발송 실패 (${sub.id}): ${String(err)}`);
        }
      }
    }
    log(`푸시 발송: ${title}`);
  }
}
