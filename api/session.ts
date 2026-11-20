/* /api/session
   GET  — reports whether an authorized live integration is configured.
   POST — validates { pin, nickname } for the simulation environment and
          returns a short-lived local validation token. This is NOT a
          Kahoot connection and is labeled as such everywhere. */
import { json, readJsonBody, validateNickname, validatePin, type DiagnosticsPayload, type LiveStatusPayload } from './shared';
import { randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === 'GET') {
    const liveEnabled = Boolean(process.env.LIVE_GAME_API_URL);
    const body: LiveStatusPayload = {
      status: 'ok',
      liveEnabled,
      message: liveEnabled
        ? 'An authorized live-game endpoint is configured.'
        : 'No authorized live-game endpoint is configured. Simulation mode only.',
    };
    json(res, 200, body);
    return;
  }

  if (req.method === 'POST') {
    let parsed: { pin?: unknown; nickname?: unknown };
    try {
      parsed = await readJsonBody(req);
    } catch {
      json(res, 400, { status: 'error', error: 'Invalid JSON body.', code: 'BAD_JSON' });
      return;
    }
    if (!validatePin(parsed.pin)) {
      json(res, 422, { status: 'error', error: 'Game PIN must be 4–10 digits.', code: 'INVALID_PIN' });
      return;
    }
    if (!validateNickname(parsed.nickname)) {
      json(res, 422, {
        status: 'error',
        error: 'Nickname must be 2–15 characters (letters, numbers, spaces, _ . -).',
        code: 'INVALID_NICKNAME',
      });
      return;
    }
    const body: DiagnosticsPayload = {
      status: 'validated',
      mode: 'simulation-ready',
      pin: (parsed.pin as string).trim(),
      nickname: (parsed.nickname as string).trim(),
      token: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      message: 'Credentials validated for the authorized local test environment only. This is not a Kahoot game connection.',
    };
    json(res, 200, body);
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  json(res, 405, { status: 'error', error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
}
