/* KAHOOT BOSS — shared backend contracts (type-only; used by the web client).
   The /api/* functions are intentionally self-contained (no cross-file
   imports) for serverless reliability — these interfaces mirror their
   JSON shapes and must be kept in sync manually.
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

