/* KAHOOT BOSS — live connector backend client (REST + SSE).
   Talks to the connector server (same-origin `/live` in dev via Vite proxy,
   or a deployed connector URL from Settings). All failures surface as
   LiveBackendError with the server's real code + message. */

export interface LiveHealth {
  status: 'ok';
  service: string;
  version: string;
  protocol: string;
  time: string;
  uptimeSec: number;
  reserveBase: string;
  cometdBase: string;
  kahootReachable: boolean;
  kahootLatencyMs: number | null;
  kahootProbeNote: string;
  sessionActive: boolean;
  sessionState: string;
}

export interface LiveSnapshotCurrent {
  index: number;
  gameType: string;
  choices: number | null;
  choicesKnown: boolean;
  answered: boolean;
  startedAt: number;
}

export interface LiveSnapshot {
  state: string;
  pin: string | null;
  nickname: string | null;
  quizName: string | null;
  questionCount: number | null;
  choiceCounts: number[];
  twoFactor: boolean;
  current: LiveSnapshotCurrent | null;
  connectedAt: number | null;
  lastRttMs: number;
}

export type LiveEvent =
  | { type: 'state'; state: string }
  | { type: 'joined'; pin: string; nickname: string; quizName: string | null; twoFactor: boolean; namerator: boolean }
  | { type: 'twoFactorRequired' }
  | { type: 'twoFactorResult'; ok: boolean }
  | { type: 'quizStart'; quizName: string | null; questionCount: number | null; choiceCounts: number[] }
  | { type: 'question'; index: number; gameType: string; choices: number | null; choicesKnown: boolean; raw: Record<string, unknown> }
  | { type: 'answerAck'; index: number }
  | { type: 'feedback'; index: number; correct: boolean | null; points: number | null; totalScore: number | null; rank: number | null; streak: number | null; raw: Record<string, unknown> }
  | { type: 'timeUp'; index: number | null }
  | { type: 'gameOver'; totalScore: number | null; rank: number | null; raw: Record<string, unknown> }
  | { type: 'podium'; raw: Record<string, unknown> }
  | { type: 'kicked'; reason: string }
  | { type: 'left' }
  | { type: 'closed'; code: number; reason: string; unexpected: boolean }
  | { type: 'error'; code: string; message: string };

export class LiveBackendError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'LiveBackendError';
    this.code = code;
    this.status = status;
  }
}

export function resolveLiveBase(configured: string): string {
  const v = (configured ?? '').trim().replace(/\/+$/, '');
  return v.length > 0 ? v : '/live';
}

async function req<T>(base: string, path: string, init: RequestInit, timeoutMs: number): Promise<{ data: T; latencyMs: number }> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal });
    const latencyMs = performance.now() - started;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const obj = (body ?? {}) as { error?: string; code?: string };
      throw new LiveBackendError(obj.error ?? `Connector request failed with HTTP ${res.status}.`, obj.code ?? 'HTTP_ERROR', res.status);
    }
    return { data: body as T, latencyMs };
  } catch (e) {
    if (e instanceof LiveBackendError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LiveBackendError(`Connector request timed out after ${Math.round(timeoutMs / 1000)}s.`, 'TIMEOUT', 0);
    }
    throw new LiveBackendError(
      `Cannot reach the live connector at ${base}${path}. Start it with \`npm run server\` (or set the connector URL in Settings).`,
      'UNREACHABLE',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface JoinResult {
  status: 'joined' | 'awaitingTwoFactor';
  pin: string;
  nickname: string;
  twoFactor: boolean;
  snapshot: LiveSnapshot;
}

/** Live backend surface. Implemented by the connector client (REST + SSE)
 *  below and by the direct in-browser runtime (src/engine/directLive.ts),
 *  so the UI works identically against either transport. */
export interface LiveApi {
  health(base: string, timeoutMs?: number): Promise<{ data: LiveHealth; latencyMs: number }>;
  status(base: string, timeoutMs?: number): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }>;
  join(base: string, pin: string, nickname: string, timeoutMs?: number): Promise<{ data: JoinResult; latencyMs: number }>;
  twoFactor(base: string, sequence: string, timeoutMs?: number): Promise<{ data: { status: string; ok: boolean; snapshot: LiveSnapshot }; latencyMs: number }>;
  answer(base: string, choice: number, timeoutMs?: number): Promise<{ data: { status: string; sent: boolean; index: number; choice: number }; latencyMs: number }>;
  leave(base: string, timeoutMs?: number): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }>;
  subscribe(base: string, onEvent: (e: LiveEvent) => void, onError?: (err: Error) => void): () => void;
}

export const liveApi: LiveApi = {
  health(base: string, timeoutMs = 8000): Promise<{ data: LiveHealth; latencyMs: number }> {
    return req<LiveHealth>(base, '/health', { method: 'GET' }, timeoutMs);
  },

  status(base: string, timeoutMs = 8000): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }> {
    return req(base, '/status', { method: 'GET' }, timeoutMs);
  },

  join(base: string, pin: string, nickname: string, timeoutMs = 75000): Promise<{ data: JoinResult; latencyMs: number }> {
    return req<JoinResult>(base, '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, nickname }),
    }, timeoutMs);
  },

  twoFactor(base: string, sequence: string, timeoutMs = 25000): Promise<{ data: { status: string; ok: boolean; snapshot: LiveSnapshot }; latencyMs: number }> {
    return req(base, '/two-factor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence }),
    }, timeoutMs);
  },

  answer(base: string, choice: number, timeoutMs = 10000): Promise<{ data: { status: string; sent: boolean; index: number; choice: number }; latencyMs: number }> {
    return req(base, '/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice }),
    }, timeoutMs);
  },

  leave(base: string, timeoutMs = 8000): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }> {
    return req(base, '/leave', { method: 'POST' }, timeoutMs);
  },

  /** Subscribe to the live event stream. Returns an unsubscribe function. */
  subscribe(base: string, onEvent: (e: LiveEvent) => void, onError?: (err: Error) => void): () => void {
    const es = new EventSource(`${base}/events`);
    es.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as LiveEvent);
      } catch {
        onError?.(new Error('Received a malformed event from the connector.'));
      }
    };
    es.onerror = () => {
      onError?.(new Error('Live event stream interrupted. The connector may have stopped — check its status.'));
    };
    return () => es.close();
  },
};

/** Humanize a connector/backend error code for toasts and statuses. */
export function liveErrorHint(code: string): string {
  switch (code) {
    case 'UNREACHABLE': return 'Start the connector with `npm run server`, or set its URL in Settings.';
    case 'PIN_NOT_FOUND': return 'Confirm the current PIN on the host screen — PINs expire when the game ends.';
    case 'NAME_REJECTED': return 'Try a different nickname.';
    case 'SESSION_BUSY': return 'One live session at a time — leave the current one first.';
    case 'RATE_LIMITED': return 'Wait a minute before retrying.';
    case 'RELAY_UNREACHABLE': return 'The reserve relay is unreachable. It runs on the deployed site — in local dev, use connector mode (`npm run server`).';
    case 'CHALLENGE_FAILED': return 'The app needs a protocol update for the new challenge format.';
    default: return '';
  }
}
