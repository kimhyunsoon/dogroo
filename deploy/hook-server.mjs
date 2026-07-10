// dogroo 배포 웹훅 수신기 — 호스트에서 systemd로 실행 (deploy/dogroo-hook.service)
// GitHub Actions가 POST /deploy/hook (X-Deploy-Key) 로 호출하면 deploy.sh를 직렬 실행한다.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.HOOK_PORT ?? 9099);
const HOST = process.env.HOOK_HOST ?? '0.0.0.0'; // 컨테이너 host-gateway에서 접근 가능해야 함
const DEPLOY_KEY = process.env.DEPLOY_KEY;
const LOG_FILE = process.env.HOOK_LOG ?? '/var/log/dogroo-deploy.log';
const VALID_TARGETS = new Set(['backend', 'frontend', 'deploy']);
const DEPLOY_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy.sh');

if (!DEPLOY_KEY) {
  console.error('DEPLOY_KEY가 설정되지 않았습니다 (/etc/dogroo/deploy.env)');
  process.exit(1);
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // 로그 파일 실패는 무시 (stdout은 journald가 수집)
  }
}

function keyMatches(given) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(DEPLOY_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 배포 직렬 큐 — 겹침 방지
const queue = [];
let running = false;

function enqueue(targets, sha) {
  queue.push({ targets, sha });
  void runNext();
}

async function runNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  log(`배포 시작: targets=${job.targets.join(',')} sha=${job.sha}`);
  const child = spawn('bash', [DEPLOY_SCRIPT, ...job.targets], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log(`[deploy] ${String(d).trimEnd()}`));
  child.stderr.on('data', (d) => log(`[deploy:err] ${String(d).trimEnd()}`));
  child.on('close', (code) => {
    log(`배포 종료: exit=${code}`);
    running = false;
    void runNext();
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/deploy/hook') {
    res.writeHead(404).end();
    return;
  }
  if (!keyMatches(req.headers['x-deploy-key'])) {
    log(`인증 실패: ${req.socket.remoteAddress}`);
    res.writeHead(401).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    const targets = Array.isArray(payload.targets)
      ? payload.targets.filter((t) => VALID_TARGETS.has(t))
      : [];
    if (targets.length === 0) {
      res.writeHead(400).end(JSON.stringify({ error: 'no_valid_targets' }));
      return;
    }
    enqueue(targets, String(payload.sha ?? 'unknown'));
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queued: true, targets }));
  });
});

server.listen(PORT, HOST, () => log(`hook-server 대기 중: ${HOST}:${PORT}`));
