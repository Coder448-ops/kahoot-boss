/* KAHOOT BOSS — live connector configuration (env-driven, documented).
   Defaults target the real Kahoot endpoints used by the official web client.
   Overrides exist for tests and for environments where Kahoot serves traffic
   from alternate hosts. */

export interface ConnectorConfig {
  port: number;
  reserveBase: string; // e.g. https://kahoot.it
  cometdBase: string; // e.g. wss://kahoot.it
  captchaToken: string; // login captcha token (empty string = omit)
  userAgent: string;
  allowedOrigins: string; // '*' or comma-separated list
  reserveTimeoutMs: number;
  handshakeTimeoutMs: number;
  loginTimeoutMs: number;
  joinTimeoutMs: number;
  twoFactorTimeoutMs: number;
  serveStatic: boolean;
  staticDir: string;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function str(name: string, fallback: string): string {
  const v = (process.env[name] ?? '').trim();
  return v.length > 0 ? v : fallback;
}

export function loadConfig(): ConnectorConfig {
  return {
    port: num('PORT', 3001),
    reserveBase: str('KAHOOT_RESERVE_BASE', 'https://kahoot.it').replace(/\/+$/, ''),
    cometdBase: str('KAHOOT_COMETD_BASE', 'wss://kahoot.it').replace(/\/+$/, ''),
    captchaToken: process.env.KAHOOT_CAPTCHA_TOKEN?.trim() ?? 'KAHOOT_TOKEN_eyJ2ZXJzaW9uIjoiIn0=',
    userAgent: str('KAHOOT_CLIENT_UA', 'KAHOOT-BOSS/1.0 (+https://github.com/Coder448-ops/kahoot-boss)'),
    allowedOrigins: str('ALLOWED_ORIGINS', '*'),
    reserveTimeoutMs: num('TIMEOUT_RESERVE_MS', 12000),
    handshakeTimeoutMs: num('TIMEOUT_HANDSHAKE_MS', 15000),
    loginTimeoutMs: num('TIMEOUT_LOGIN_MS', 20000),
    joinTimeoutMs: num('TIMEOUT_JOIN_MS', 60000),
    twoFactorTimeoutMs: num('TIMEOUT_TWO_FACTOR_MS', 20000),
    serveStatic: (process.env.SERVE_STATIC ?? '').trim() === '1',
    staticDir: str('STATIC_DIR', 'dist'),
  };
}

export const PROTOCOL_VERSION = 'kb-live-1';
export const CONNECTOR_VERSION = '1.0.0';
