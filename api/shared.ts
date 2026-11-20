/* KAHOOT BOSS — shared backend contracts (used by /api/* and the web client).
   These are honest capability endpoints: they validate input, report real
   configuration state, and proxy to a configured AI provider when available.
   They NEVER fabricate a Kahoot connection. */

export interface HealthPayload {
  status: 'ok';
  service: 'kahoot-boss-api';
  version: string;
  time: string;
  mode: 'full' | 'limited';
  aiConfigured: boolean;
  liveConfigured: boolean;
}

export interface LiveStatusPayload {
  status: 'ok';
  liveEnabled: boolean;
  message: string;
}

export interface DiagnosticsPayload {
  status: 'validated';
  mode: 'simulation-ready';
  pin: string;
  nickname: string;
  token: string;
  expiresAt: string;
  message: string;
}

export interface SolveApiPayload {
  status: 'ok';
  bestIndex: number;
  confidence: number;
  explanation: string;
  method: 'api';
  model: string;
  latencyMs: number;
}

export interface ApiErrorPayload {
  status: 'error';
  error: string;
  code: string;
  hint?: string;
}

export function validatePin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,10}$/.test(pin.trim());
}

export function validateNickname(nickname: unknown): nickname is string {
  if (typeof nickname !== 'string') return false;
  const v = nickname.trim();
  if (v.length < 2 || v.length > 15) return false;
  return /^[\p{L}\p{N} _.\-]+$/u.test(v);
}

export function json(res: { setHeader(k: string, v: string): void; statusCode: number; end(b: string): void }, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export async function readJsonBody<T>(req: { on(e: string, cb: (...a: never[]) => void): void }): Promise<T> {
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
