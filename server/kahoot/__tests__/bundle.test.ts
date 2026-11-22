/* KAHOOT BOSS — standalone connector bundle test.
   Proves the single-file bundle (dist-connector/kb-connector.cjs, zero runtime
   deps beyond node) boots and performs a real join against the mock Kahoot
   infrastructure. This is the exact file users download to run a local
   connector (same network for reserve + game channel).
   Run: npm run connector:test-bundle */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { MockKahootServer, MOCK_PINS } from './mock';

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function waitForHealth(base: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/live/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main(): Promise<void> {
  console.log('— standalone bundle —');
  const bundlePath = path.resolve(process.cwd(), 'dist-connector', 'kb-connector.cjs');
  assert('bundle file exists', fs.existsSync(bundlePath), bundlePath);
  if (!fs.existsSync(bundlePath)) {
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  const sizeKb = Math.round(fs.statSync(bundlePath).size / 1024);
  console.log(`  bundle size: ${sizeKb} KB`);
  const code = fs.readFileSync(bundlePath, 'utf8');
  const externals = ['express', 'cors', 'ws'].filter((m) => code.includes(`require("${m}")`) || code.includes(`require('${m}')`));
  assert('bundle is self-contained (deps bundled, none required externally)', externals.length === 0, externals.join(','));

  const mock = await MockKahootServer.start();
  const port = 3219;
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  try {
    child = spawn('node', [bundlePath], {
      env: {
        ...process.env,
        PORT: String(port),
        KAHOOT_RESERVE_BASE: mock.httpBase,
        KAHOOT_COMETD_BASE: mock.wsBase,
        TIMEOUT_LOGIN_MS: '4000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d).slice(0, 2000); });
    const up = await waitForHealth(base, 15000);
    assert('bundled connector boots and serves /live/health', up, stderr.slice(0, 300));
    if (!up) throw new Error('connector did not boot');

    const health = (await (await fetch(`${base}/live/health`)).json()) as { version: string; protocol: string };
    assert('health reports version + protocol', typeof health.version === 'string' && typeof health.protocol === 'string');

    const joinRes = await fetch(`${base}/live/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: MOCK_PINS.game, nickname: 'Bundle' }),
    });
    const joined = (await joinRes.json()) as { status: string; snapshot: { state: string } };
    assert('bundle performs a real join → lobby', joinRes.ok && joined.status === 'joined' && joined.snapshot.state === 'lobby', JSON.stringify(joined).slice(0, 200));

    const status = (await (await fetch(`${base}/live/status`)).json()) as { snapshot: { state: string } };
    assert('status reflects lobby', status.snapshot.state === 'lobby');

    const bad = await fetch(`${base}/live/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: MOCK_PINS.notFound, nickname: 'Bundle' }),
    });
    const badBody = (await bad.json()) as { code: string };
    assert('bundle rejects busy/unknown honestly', !bad.ok && typeof badBody.code === 'string', JSON.stringify(badBody).slice(0, 120));

    const leave = await fetch(`${base}/live/leave`, { method: 'POST' });
    assert('leave works', leave.ok);
  } finally {
    child?.kill('SIGTERM');
    await mock.stop();
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('bundle test crashed:', e);
  process.exit(1);
});
