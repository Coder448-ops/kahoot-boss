/* /api/session (self-contained: no cross-file imports)
   GET  — explains that live availability is reported by the connector
          backend (this stateless function cannot know it).
   POST — validates { pin, nickname } for the simulation environment and
          returns a short-lived local validation token. This is NOT a
          Kahoot connection and is labeled as such everywhere. */
import { randomBytes } from 'crypto';

function send(res: { setHeader(k: string, v: string): void; statusCode: number; end(b: string): void }, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: { on(e: string, cb: (...a: never[]) => void): void }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', ((c: Buffer) => chunks.push(Buffer.from(c))) as never);
    req.on('end', (() => resolve()) as never);
    req.on('error', ((e: Error) => reject(e)) as never);
  });
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function validPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,10}$/.test(pin.trim());
}

function validNickname(nickname: unknown): nickname is string {
  if (typeof nickname !== 'string') return false;
  const v = nickname.trim();
  if (v.length < 2 || v.length > 15) return false;
  return /^[\p{L}\p{N} _.\-]+$/u.test(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = async function handler(req: any, res: any): Promise<void> {
  if (req.method === 'GET') {
    // Live availability is determined by the connector backend (server/),
    // which the browser queries directly — this stateless function cannot
    // know its state, so it reports that honestly instead of guessing.
    send(res, 200, {
      status: 'ok',
      liveEnabled: false,
      message: 'Live availability is reported by the connector backend configured in Settings (GET /live/health) — query it directly.',
    });
    return;
  }

  if (req.method === 'POST') {
    let parsed: { pin?: unknown; nickname?: unknown };
    try {
      parsed = await readJsonBody(req);
    } catch {
      send(res, 400, { status: 'error', error: 'Invalid JSON body.', code: 'BAD_JSON' });
      return;
    }
    if (!validPin(parsed.pin)) {
      send(res, 422, { status: 'error', error: 'Game PIN must be 4–10 digits.', code: 'INVALID_PIN' });
      return;
    }
    if (!validNickname(parsed.nickname)) {
      send(res, 422, {
        status: 'error',
        error: 'Nickname must be 2–15 characters (letters, numbers, spaces, _ . -).',
        code: 'INVALID_NICKNAME',
      });
      return;
    }
    send(res, 200, {
      status: 'validated',
      mode: 'simulation-ready',
      pin: (parsed.pin as string).trim(),
      nickname: (parsed.nickname as string).trim(),
      token: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      message: 'Credentials validated for the authorized local test environment only. This is not a Kahoot game connection.',
    });
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  send(res, 405, { status: 'error', error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
};
