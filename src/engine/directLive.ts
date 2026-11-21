/* KAHOOT BOSS — direct live mode (no connector backend).
   Runs the SAME KahootLiveClient engine that powers the connector, inside the
   browser: session reserve goes through the tiny /api/kahoot-reserve relay
   (the only step browsers cannot do themselves — Kahoot's session endpoint
   sends no CORS headers), while challenge solving, token derivation, the
   Bayeux handshake and play run locally over the native WebSocket.
   Nothing is simulated: every error is the real relay/Kahoot answer, with the
   same honest codes the connector surface uses. */

import {
  KahootLiveClient,
  LiveError,
  type ReserveData,
  type ReserveFn,
} from '../../server/kahoot/client';
import type { BayeuxSocket, WsFactory } from '../../server/kahoot/bayeux';
import { CONNECTOR_VERSION, PROTOCOL_VERSION, type ConnectorConfig } from '../../server/config';
import type { Settings } from '../lib/types';
import {
  LiveBackendError,
  liveApi as connectorLiveApi,
  resolveLiveBase,
  type JoinResult,
  type LiveApi,
  type LiveEvent,
  type LiveHealth,
  type LiveSnapshot,
} from './liveClient';

export type LiveMode = 'direct' | 'connector';

/** Pseudo-base used wherever the connector client expects a base URL. */
export const DIRECT_BASE = 'direct';

/** Same-origin reserve relay (serverless, deployed with the site). */
const RELAY_PATH = '/api/kahoot-reserve';

/** Impossible PIN used ONLY to verify Kahoot answers the relay.
 *  A reserve touches no game: entering a lobby requires the socket login. */
const PROBE_PIN = '0000000000';

/* ---------------- native WebSocket adapter ---------------- */

class BrowserSocket implements BayeuxSocket {
  private readonly ws: WebSocket;

  constructor(url: string) {
    // Note: browsers forbid custom headers (no User-Agent override) — the
    // adapter takes none, and Kahoot accepts the browser default.
    this.ws = new WebSocket(url);
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  onOpen(fn: () => void): void {
    this.ws.addEventListener('open', fn);
  }

  onMessage(fn: (data: string) => void): void {
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      const data: unknown = ev.data;
      if (typeof data === 'string') {
        fn(data);
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data.text().then(fn).catch(() => undefined);
      } else if (data instanceof ArrayBuffer) {
        fn(new TextDecoder().decode(data));
      }
      // Other frame kinds are ignored — the game channel sends text.
    });
  }

  onClose(fn: (code: number, reason: string) => void): void {
    this.ws.addEventListener('close', (ev: CloseEvent) => fn(ev.code, ev.reason ?? ''));
  }

  onError(fn: (err: Error) => void): void {
    // Browsers deliberately hide transport details; say so honestly.
    this.ws.addEventListener('error', () => {
      fn(new Error('The game channel reported a transport error (browsers hide the details — a close event with the code follows).'));
    });
  }
}

const createBrowserSocket: WsFactory = (url) => new BrowserSocket(url);

/* ---------------- relay-backed reserve ---------------- */

function relayErrorMessage(body: { error?: unknown }, fallback: string): string {
  return typeof body.error === 'string' && body.error.length > 0 ? body.error : fallback;
}

function createRelayReserve(relayPath = RELAY_PATH, timeoutMs = 15000): ReserveFn {
  return async (pin: string): Promise<ReserveData> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await fetch(`${relayPath}?pin=${encodeURIComponent(pin)}`, { signal: ctrl.signal });
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new LiveError('RESERVE_TIMEOUT', `The reserve relay did not answer within ${timeoutMs / 1000}s. Check your connection and retry.`);
        }
        throw new LiveError(
          'RELAY_UNREACHABLE',
          'The reserve relay (/api/kahoot-reserve) could not be reached. It is deployed with this site — in local dev, use connector mode (`npm run server`).',
          e instanceof Error ? e.message : String(e),
        );
      }
      let body: Record<string, unknown> = {};
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new LiveError(
          'RELAY_UNREACHABLE',
          'The reserve relay answered with an unreadable response (expected JSON). It is deployed with this site — in local dev, use connector mode (`npm run server`).',
        );
      }
      if (res.ok && body.status === 'ok') {
        if (typeof body.challenge !== 'string' || body.challenge.length === 0 || typeof body.sessionToken !== 'string' || body.sessionToken.length === 0) {
          throw new LiveError('PROTOCOL_ERROR', 'The reserve relay answered OK but without the challenge/session payload.');
        }
        return {
          challenge: body.challenge,
          sessionToken: body.sessionToken,
          twoFactorAuth: body.twoFactorAuth === true,
          namerator: body.namerator === true,
        };
      }
      const code = typeof body.code === 'string' ? body.code : 'RESERVE_FAILED';
      // Relay codes already mirror the connector's honest vocabulary — keep them.
      switch (code) {
        case 'PIN_NOT_FOUND':
          throw new LiveError('PIN_NOT_FOUND', relayErrorMessage(body, `No live game found for PIN ${pin}. Confirm the current PIN on the host screen.`));
        case 'INVALID_PIN':
          throw new LiveError('INVALID_PIN', relayErrorMessage(body, 'Game PIN must be 6–10 digits.'));
        case 'RESERVE_TIMEOUT':
          throw new LiveError('RESERVE_TIMEOUT', relayErrorMessage(body, 'Kahoot did not answer the session request in time.'));
        case 'RESERVE_UNREACHABLE':
          throw new LiveError('NETWORK_ERROR', relayErrorMessage(body, 'Kahoot could not be reached from the relay network.'));
        case 'RESERVE_REJECTED':
          throw new LiveError('RESERVE_FAILED', relayErrorMessage(body, 'Kahoot rejected the session request.'));
        case 'RESERVE_BAD_RESPONSE':
          throw new LiveError('PROTOCOL_ERROR', relayErrorMessage(body, 'Kahoot answered with an unreadable session payload.'));
        case 'RATE_LIMITED':
          throw new LiveError('RATE_LIMITED', relayErrorMessage(body, 'Kahoot rate-limited this network address. Wait a minute and retry.'));
        default:
          throw new LiveError(code, relayErrorMessage(body, `Reserve failed (HTTP ${res.status}).`));
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

/* ---------------- direct engine (singleton per page load) ---------------- */

function directConfig(cometdBase = 'wss://kahoot.it'): ConnectorConfig {
  return {
    port: 0, // unused in direct mode
    reserveBase: 'relay', // unused — the relay replaces direct reserve
    cometdBase,
    captchaToken: 'KAHOOT_TOKEN_eyJ2ZXJzaW9uIjoiIn0=',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'KAHOOT-BOSS/1.0 direct',
    allowedOrigins: '*', // unused in direct mode
    reserveTimeoutMs: 15000,
    handshakeTimeoutMs: 15000,
    loginTimeoutMs: 20000,
    joinTimeoutMs: 60000,
    twoFactorTimeoutMs: 20000,
    serveStatic: false,
    staticDir: '',
  };
}

export interface DirectLiveOptions {
  /** Reserve relay endpoint (same-origin in production; override in tests). */
  relayPath?: string;
  /** CometD base (wss://kahoot.it in production; mock in tests). */
  cometdBase?: string;
}

function toBackendError(e: unknown): LiveBackendError {
  if (e instanceof LiveBackendError) return e;
  if (e instanceof LiveError) return new LiveBackendError(e.message, e.code, 0);
  return new LiveBackendError(e instanceof Error ? e.message : 'Direct live operation failed.', 'DIRECT_ERROR', 0);
}

function snapshotOf(client: KahootLiveClient): LiveSnapshot {
  // The engine snapshot is structurally identical to the UI snapshot
  // (LiveState narrows to string) — no translation, no loss.
  return client.getSnapshot();
}

function isActiveState(state: string): boolean {
  return state !== 'idle' && state !== 'closed' && state !== 'failed';
}

/** Real two-stage probe: (1) the relay itself (no PIN → 422, Kahoot untouched),
 *  (2) Kahoot through the relay with an impossible PIN (404 = Kahoot answered). */
async function probeRelayAndKahoot(relayPath: string, timeoutMs: number): Promise<{ reachable: boolean; latencyMs: number | null; note: string }> {
  const started = performance.now();
  // Stage 1: relay alive? (422 INVALID_PIN expected — proves the relay runs.)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 10000));
    try {
      const res = await fetch(relayPath, { signal: ctrl.signal });
      if (res.status !== 422) {
        return {
          reachable: false,
          latencyMs: null,
          note: `Reserve relay answered HTTP ${res.status} instead of the expected PIN check — the relay may be outdated or missing; in local dev use connector mode.`,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { reachable: false, latencyMs: null, note: 'Reserve relay timed out — the deployment may be unreachable or offline.' };
    }
    return {
      reachable: false,
      latencyMs: null,
      note: 'Reserve relay unreachable (same-origin /api/kahoot-reserve). It is deployed with this site — in local dev use connector mode (`npm run server`).',
    };
  }
  // Stage 2: does Kahoot answer through the relay? Any Kahoot verdict counts.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${relayPath}?pin=${PROBE_PIN}`, { signal: ctrl.signal });
    const latencyMs = performance.now() - started;
    if (res.status === 404) {
      return { reachable: true, latencyMs, note: 'Verified end-to-end: relay → Kahoot answered (404 for the probe PIN = no such game, Kahoot itself reachable).' };
    }
    if (res.status === 429 || res.status === 403) {
      return { reachable: true, latencyMs, note: `Kahoot answered through the relay (HTTP ${res.status}) — reachable, but throttling or refusing this network right now.` };
    }
    if (res.ok) {
      return { reachable: true, latencyMs, note: 'Kahoot answered through the relay (probe PIN unexpectedly resolved — network path verified).' };
    }
    return { reachable: false, latencyMs: null, note: `Relay is up, but Kahoot did not answer through it (HTTP ${res.status}). The relay network may be offline or blocked.` };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { reachable: false, latencyMs: null, note: 'Kahoot probe timed out — the relay is up, but Kahoot did not answer in time.' };
    }
    return { reachable: false, latencyMs: null, note: 'Kahoot probe failed — the relay is up, but the path to Kahoot broke mid-probe.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Build a direct-mode LiveApi. Production uses the shared singleton below;
 *  tests inject mock relay/cometd endpoints. Each instance owns one engine. */
export function createDirectLiveApi(opts: DirectLiveOptions = {}): LiveApi {
  const relayPath = opts.relayPath ?? RELAY_PATH;
  const cometdBase = opts.cometdBase ?? 'wss://kahoot.it';
  const client = new KahootLiveClient(directConfig(cometdBase), {
    createSocket: createBrowserSocket,
    reserve: createRelayReserve(relayPath),
  });
  return {
  async health(_base: string, timeoutMs = 15000): Promise<{ data: LiveHealth; latencyMs: number }> {
    const started = performance.now();
    const probe = await probeRelayAndKahoot(relayPath, timeoutMs);
    const snap = client.getSnapshot();
    const data: LiveHealth = {
      status: 'ok',
      service: 'kahoot-boss-direct',
      version: CONNECTOR_VERSION,
      protocol: PROTOCOL_VERSION,
      time: new Date().toISOString(),
      uptimeSec: Math.round(performance.now() / 1000),
      reserveBase: `relay:${RELAY_PATH}`,
      cometdBase: 'wss://kahoot.it',
      kahootReachable: probe.reachable,
      kahootLatencyMs: probe.latencyMs,
      kahootProbeNote: probe.note,
      sessionActive: isActiveState(snap.state),
      sessionState: snap.state,
    };
    return { data, latencyMs: performance.now() - started };
  },

  async status(_base: string, _timeoutMs = 8000): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }> {
    const started = performance.now();
    return { data: { status: 'ok', snapshot: snapshotOf(client) }, latencyMs: performance.now() - started };
  },

  async join(_base: string, pin: string, nickname: string, _timeoutMs = 75000): Promise<{ data: JoinResult; latencyMs: number }> {
    const started = performance.now();
    try {
      await client.join(pin, nickname);
    } catch (e) {
      throw toBackendError(e);
    }
    const snap = snapshotOf(client);
    return {
      data: {
        status: client.getState() === 'awaitingTwoFactor' ? 'awaitingTwoFactor' : 'joined',
        pin,
        nickname,
        twoFactor: snap.twoFactor,
        snapshot: snap,
      },
      latencyMs: performance.now() - started,
    };
  },

  async twoFactor(_base: string, sequence: string, _timeoutMs = 25000): Promise<{ data: { status: string; ok: boolean; snapshot: LiveSnapshot }; latencyMs: number }> {
    const started = performance.now();
    try {
      const { ok } = await client.submitTwoFactor(sequence);
      return { data: { status: 'verified', ok, snapshot: snapshotOf(client) }, latencyMs: performance.now() - started };
    } catch (e) {
      throw toBackendError(e);
    }
  },

  async answer(_base: string, choice: number, _timeoutMs = 10000): Promise<{ data: { status: string; sent: boolean; index: number; choice: number }; latencyMs: number }> {
    const started = performance.now();
    try {
      const r = client.answer(choice);
      return { data: { status: 'sent', ...r }, latencyMs: performance.now() - started };
    } catch (e) {
      throw toBackendError(e);
    }
  },

  async leave(_base: string, _timeoutMs = 8000): Promise<{ data: { status: string; snapshot: LiveSnapshot }; latencyMs: number }> {
    const started = performance.now();
    await client.leave('operator left').catch(() => undefined);
    return { data: { status: 'left', snapshot: snapshotOf(client) }, latencyMs: performance.now() - started };
  },

  subscribe(_base: string, onEvent: (e: LiveEvent) => void, _onError?: (err: Error) => void): () => void {
    // In-process subscription — cannot break like an SSE stream; the engine
    // reports transport failures as 'closed'/'error' events instead.
    return client.onEvent((e) => onEvent(e));
  },
  };
}

/** Shared production instance (one live session per page load, by design). */
export const directLiveApi: LiveApi = createDirectLiveApi();

export interface LiveRuntime {
  api: LiveApi;
  base: string;
  mode: LiveMode;
}

/** Choose the live transport from settings. Direct (default) runs the engine
 *  in this browser via the reserve relay; connector talks to `npm run server`. */
export function resolveLiveRuntime(settings: Pick<Settings, 'liveMode' | 'liveBackendUrl'>): LiveRuntime {
  if (settings.liveMode === 'connector') {
    return { api: connectorLiveApi, base: resolveLiveBase(settings.liveBackendUrl), mode: 'connector' };
  }
  return { api: directLiveApi, base: DIRECT_BASE, mode: 'direct' };
}
