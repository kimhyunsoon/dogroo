import { db } from './db.js';

interface StoredSession {
  cookie?: { expires?: string | Date | null };
  [key: string]: unknown;
}

type Callback = (err?: Error | null, session?: StoredSession | null) => void;

// SQLite 기반 세션 스토어 - 서버 재시작·재배포에도 로그인이 유지된다
export class SqliteSessionStore {
  constructor() {
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT PRIMARY KEY,
        sess    TEXT NOT NULL,
        expires INTEGER NOT NULL
      )`,
    );
    // 기동 시 만료 세션 정리
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  set(sid: string, session: StoredSession, callback: Callback): void {
    const expires = session.cookie?.expires
      ? new Date(session.cookie.expires).getTime()
      : Date.now() + 1000 * 60 * 60 * 24 * 90;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)').run(
      sid,
      JSON.stringify(session),
      expires,
    );
    callback();
  }

  get(sid: string, callback: Callback): void {
    const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid) as
      | { sess: string; expires: number }
      | undefined;
    if (!row || row.expires < Date.now()) {
      callback(null, null);
      return;
    }
    const session = JSON.parse(row.sess) as StoredSession;
    // JSON 직렬화로 문자열이 된 만료일을 Date로 복원
    if (session.cookie?.expires) session.cookie.expires = new Date(session.cookie.expires);
    callback(null, session);
  }

  destroy(sid: string, callback: Callback): void {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    callback();
  }
}
