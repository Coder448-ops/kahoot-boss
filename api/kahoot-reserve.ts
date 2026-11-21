/* GET /api/kahoot-reserve?pin={6-10 digits} — reserve/session relay.
   The browser cannot call Kahoot directly (no CORS headers), so this tiny
   serverless function performs ONLY the session-reserve HTTP step and relays
   the result. Everything after that (challenge solve, CometD channel, play)
   can run straight from the browser over WebSocket, which is not CORS-gated.

   Self-contained zero-import CJS (serverless-safe by construction).
   Responses are never cached and never faked:
     200 PIN valid   -> { status:'ok', challenge, sessionToken, twoFactorAuth, namerator }
     404 PIN unknown -> { status:'error', code:'PIN_NOT_FOUND', ... } (relayed from Kahoot)
     4xx/5xx         -> honest validation / upstream / network errors.
*/
function sendRelay(res: { setHeader(k: string, v: string): void; statusCode: number; end(b: string): void }, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function validRelayPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6,10}$/.test(pin.trim());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendRelay(res, 405, { status: 'error', error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const pinRaw = req.query?.pin;
  const pin = Array.isArray(pinRaw) ? pinRaw[0] : pinRaw;
  if (!validRelayPin(pin)) {
    sendRelay(res, 422, { status: 'error', error: 'Game PIN must be 6–10 digits. Kahoot PINs are issued per game by the host.', code: 'INVALID_PIN' });
    return;
  }
  const base = (process.env.KAHOOT_RESERVE_BASE || 'https://kahoot.it').replace(/\/+$/, '');
  const url = `${base}/reserve/session/${encodeURIComponent(pin.trim())}/?${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let upstream: Response;
  try {
    try {
      upstream = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'KAHOOT-BOSS/1.0 (reserve-relay)', Accept: 'application/json' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    sendRelay(res, 502, {
      status: 'error',
      error: timedOut
        ? 'Kahoot did not answer the session request within 12s.'
        : 'Could not reach Kahoot (reserve/session) from this network.',
      code: timedOut ? 'RESERVE_TIMEOUT' : 'RESERVE_UNREACHABLE',
    });
    return;
  }
  if (upstream.status === 404) {
    sendRelay(res, 404, {
      status: 'error',
      error: `No live game uses PIN ${pin.trim()} right now (Kahoot answered 404). Check the PIN with the host — PINs expire when the game ends.`,
      code: 'PIN_NOT_FOUND',
    });
    return;
  }
  if (!upstream.ok) {
    sendRelay(res, 502, {
      status: 'error',
      error: `Kahoot rejected the session request (HTTP ${upstream.status}). The game may be locked, or Kahoot may be throttling this network.`,
      code: 'RESERVE_REJECTED',
    });
    return;
  }
  let body: { challenge?: unknown; twoFactorAuth?: unknown; namerator?: unknown };
  try {
    body = (await upstream.json()) as typeof body;
  } catch {
    sendRelay(res, 502, { status: 'error', error: 'Kahoot answered with an unreadable session payload.', code: 'RESERVE_BAD_RESPONSE' });
    return;
  }
  const sessionToken = upstream.headers.get('x-kahoot-session-token');
  if (typeof body.challenge !== 'string' || body.challenge.length === 0 || !sessionToken) {
    sendRelay(res, 502, { status: 'error', error: 'Kahoot session response is missing the challenge or session token.', code: 'RESERVE_BAD_RESPONSE' });
    return;
  }
  sendRelay(res, 200, {
    status: 'ok',
    challenge: body.challenge,
    sessionToken,
    twoFactorAuth: body.twoFactorAuth === true,
    namerator: (body as { namerator?: unknown }).namerator === true,
  });
};
