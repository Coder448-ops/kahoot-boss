/* KAHOOT BOSS — live connector backend (optional, advanced).
   The same live engine also runs directly in the browser (see
   src/engine/directLive.ts — the default). This small server runs that engine
   server-side and exposes it to the UI over same-origin REST + SSE, for
   operators who prefer a backend (e.g. local dev without the serverless
   relay, or a controlled egress network). Nothing here is simulated:
   every status reflects the actual Kahoot session state. */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { loadConfig, CONNECTOR_VERSION, PROTOCOL_VERSION } from './config';
import { KahootLiveClient, LiveError, createDirectReserve, probeKahoot, type LiveKahootEvent } from './kahoot/client';
import { createNodeSocket } from './kahoot/nodeSocket';
import { validateLiveNickname, validateLivePin, validateTwoFactorSequence } from './validate';

const cfg = loadConfig();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

const origins = cfg.allowedOrigins.trim() === '*' ? '*' : cfg.allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins === '*' ? '*' : origins }));

// Single active live session per connector (one player — no bot swarms, by design).
const client = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });

// ---- tiny in-memory join throttle (per IP, 10 joins / minute) ----
const joinHits = new Map<string, number[]>();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, hits] of joinHits) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length === 0) joinHits.delete(ip);
    else joinHits.set(ip, fresh);
  }
}, 30_000).unref?.();

function throttled(ip: string): boolean {
  const now = Date.now();
  const hits = (joinHits.get(ip) ?? []).filter((t) => t > now - 60_000);
  hits.push(now);
  joinHits.set(ip, hits);
  return hits.length > 10;
}

// ---- SSE fan-out ----
type Subscriber = (e: LiveKahootEvent) => void;
const subscribers = new Set<Subscriber>();
client.onEvent((e) => {
  subscribers.forEach((fn) => {
    try { fn(e); } catch { /* subscriber crash-proof */ }
  });
});

// ---- Kahoot reachability probe (cached 20s so health stays fast) ----
let probeCache: { at: number; reachable: boolean; latencyMs: number | null } | null = null;
async function kahootReachability(): Promise<{ reachable: boolean; latencyMs: number | null }> {
  if (probeCache && Date.now() - probeCache.at < 20_000) return probeCache;
  const r = await probeKahoot(cfg.reserveBase, 4000);
  probeCache = { at: Date.now(), ...r };
  return r;
}

function liveErrorStatus(code: string): number {
  switch (code) {
    case 'SESSION_BUSY': return 409;
    case 'PIN_NOT_FOUND': return 404;
    case 'NAME_REJECTED': return 422;
    case 'NO_ACTIVE_QUESTION':
    case 'ALREADY_ANSWERED':
    case 'CHOICE_OUT_OF_RANGE':
    case 'NO_TWO_FACTOR':
    case 'TWO_FACTOR_BUSY':
    case 'NOT_CONNECTED': return 409;
    case 'RATE_LIMITED': return 429;
    case 'RESERVE_TIMEOUT':
    case 'HANDSHAKE_TIMEOUT':
    case 'LOGIN_TIMEOUT':
    case 'TWO_FACTOR_TIMEOUT': return 504;
    default: return 502;
  }
}

function sendLiveError(res: express.Response, e: unknown): void {
  if (e instanceof LiveError) {
    res.status(liveErrorStatus(e.code)).json({ status: 'error', error: e.message, code: e.code, ...(e.detail ? { detail: e.detail } : {}) });
  } else {
    res.status(500).json({ status: 'error', error: e instanceof Error ? e.message : 'Internal connector error.', code: 'INTERNAL' });
  }
}

/* ---------------- routes ---------------- */

app.get('/live/health', async (_req, res) => {
  const reach = await kahootReachability();
  res.json({
    status: 'ok',
    service: 'kahoot-boss-live-connector',
    version: CONNECTOR_VERSION,
    protocol: PROTOCOL_VERSION,
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    reserveBase: cfg.reserveBase,
    cometdBase: cfg.cometdBase,
    kahootReachable: reach.reachable,
    kahootLatencyMs: reach.latencyMs,
    kahootProbeNote: reach.reachable
      ? 'Kahoot infrastructure is reachable from this connector.'
      : 'Kahoot is NOT reachable from this connector — joins will fail until network access is available. No status is faked.',
    sessionActive: client.getState() !== 'idle' && client.getState() !== 'closed' && client.getState() !== 'failed',
    sessionState: client.getState(),
  });
});

app.get('/live/status', (_req, res) => {
  res.json({ status: 'ok', snapshot: client.getSnapshot() });
});

app.post('/live/join', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (throttled(ip)) {
    res.status(429).json({ status: 'error', error: 'Too many join attempts from this address. Wait a minute and retry.', code: 'THROTTLED' });
    return;
  }
  const pinCheck = validateLivePin(req.body?.pin);
  if (!pinCheck.ok) {
    res.status(422).json({ status: 'error', error: pinCheck.error, code: 'INVALID_PIN' });
    return;
  }
  const nickCheck = validateLiveNickname(req.body?.nickname);
  if (!nickCheck.ok) {
    res.status(422).json({ status: 'error', error: nickCheck.error, code: 'INVALID_NICKNAME' });
    return;
  }
  try {
    const overall = new Promise<{ pin: string; nickname: string; twoFactor: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new LiveError('LOGIN_TIMEOUT', `Join did not complete within ${cfg.joinTimeoutMs / 1000}s.`)), cfg.joinTimeoutMs);
      client
        .join(String(req.body.pin).trim(), String(req.body.nickname).trim())
        .then((r) => { clearTimeout(timer); resolve(r); })
        .catch((e: unknown) => { clearTimeout(timer); reject(e); });
    });
    const r = await overall;
    res.json({ status: r.twoFactor ? 'awaitingTwoFactor' : 'joined', ...r, snapshot: client.getSnapshot() });
  } catch (e) {
    sendLiveError(res, e);
  }
});

app.post('/live/two-factor', async (req, res) => {
  const check = validateTwoFactorSequence(req.body?.sequence);
  if (!check.ok) {
    res.status(422).json({ status: 'error', error: check.error, code: 'INVALID_SEQUENCE' });
    return;
  }
  try {
    const r = await client.submitTwoFactor(String(req.body.sequence).trim());
    res.json({ status: 'ok', ok: r.ok, snapshot: client.getSnapshot() });
  } catch (e) {
    sendLiveError(res, e);
  }
});

app.post('/live/answer', (req, res) => {
  const choice = req.body?.choice;
  if (typeof choice !== 'number' || !Number.isInteger(choice)) {
    res.status(422).json({ status: 'error', error: 'Choice must be an integer option index.', code: 'INVALID_CHOICE' });
    return;
  }
  try {
    const r = client.answer(choice);
    res.status(202).json({ status: 'accepted', ...r });
  } catch (e) {
    sendLiveError(res, e);
  }
});

app.post('/live/leave', async (_req, res) => {
  try {
    await client.leave();
    res.json({ status: 'ok', snapshot: client.getSnapshot() });
  } catch (e) {
    sendLiveError(res, e);
  }
});

app.get('/live/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (e: LiveKahootEvent): void => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  // Immediate snapshot so late subscribers know the current state.
  send({ type: 'state', state: client.getSnapshot().state });
  subscribers.add(send);

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 20000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(send);
  });
});

// Optional single-process deployment: serve the built frontend.
if (cfg.serveStatic) {
  const dir = path.resolve(process.cwd(), cfg.staticDir);
  app.use(express.static(dir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/live/')) {
      next();
      return;
    }
    res.sendFile(path.join(dir, 'index.html'), (err) => {
      if (err) next();
    });
  });
  console.log(`[live] serving static frontend from ${dir}`);
}

app.use('/live', (_req, res) => {
  res.status(404).json({ status: 'error', error: 'Unknown live endpoint.', code: 'NOT_FOUND' });
});

let server: ReturnType<typeof app.listen> | null = null;
if (process.env.KB_NO_LISTEN !== '1') {
  server = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[live] KAHOOT BOSS live connector v${CONNECTOR_VERSION} (${PROTOCOL_VERSION}) on :${cfg.port}`);
    console.log(`[live] reserve=${cfg.reserveBase} cometd=${cfg.cometdBase}`);
  });
}

process.on('SIGTERM', () => {
  console.log('[live] shutting down…');
  void client.leave('shutdown').finally(() => {
    const s = server;
    if (s) s.close(() => process.exit(0));
    else process.exit(0);
  });
});

export { app, client };
