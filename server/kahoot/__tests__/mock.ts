/* KAHOOT BOSS — faithful mock of Kahoot's session infrastructure (tests only).
   Implements the DOCUMENTED wire behavior: reserve/session HTTP semantics,
   real-format JS challenges with verifiable solutions, and a Bayeux-speaking
   WebSocket game server with a scripted quiz. Used to prove the complete
   join → play → feedback workflow without touching production Kahoot. */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { deriveCometToken, solveChallenge } from '../protocol';

export const MOCK_PINS = {
  game: '1000001',
  twoFactor: '1000002',
  badChallenge: '1000003',
  silentLogin: '1000004',
  kick: '1000005',
  notFound: '9999999',
};

export const MOCK_TWO_FACTOR_SEQUENCE = '0123';
export const MOCK_CORRECT = [2, 1]; // q0 (quiz, 4 opts) -> 2 ; q1 (true/false) -> 1

function buildChallenge(seed: number): string {
  // Real documented format; deterministic per seed.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let msg = '';
  let s = seed;
  for (let i = 0; i < 96; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    msg += alphabet[s % alphabet.length];
  }
  const a = 10 + (seed % 50);
  const b = 5 + ((seed * 7) % 90);
  const c = 2 + ((seed * 13) % 20);
  const checks = ['isObject', 'isDate', 'isString', 'isArray'];
  const check = checks[seed % checks.length];
  return (
    `decode.call(this, '${msg}');\n\n` +
    `function decode(message) {\n` +
    `  var offset = (${a} + (${b} + ${c}) + ${a * 2});\n` +
    `  if (this.angular.${check}(offset)) console.log("Offset derived as: {", offset, "}");\n` +
    `    return _.replace(message, /./g, function(char, position) {\n` +
    `      return String.fromCharCode((((char.charCodeAt(0) * position) + offset) % 77) + 48);\n` +
    `    });\n` +
    `}`
  );
}

interface PinMaterial {
  challenge: string;
  sessionB64: string;
  expectedToken: string;
  twoFactor: boolean;
}

function materials(pin: string): PinMaterial | null {
  if (pin === MOCK_PINS.notFound) return null;
  if (pin === MOCK_PINS.badChallenge) {
    return { challenge: 'this is not a kahoot challenge {{{', sessionB64: Buffer.from(`mock-${pin}`).toString('base64'), expectedToken: '', twoFactor: false };
  }
  const seed = parseInt(pin.slice(-4), 10) || 1;
  const challenge = buildChallenge(seed);
  const sessionB64 = Buffer.from(`mock-session-token-${pin}-abc`).toString('base64');
  const expectedToken = deriveCometToken(sessionB64, solveChallenge(challenge));
  return { challenge, sessionB64, expectedToken, twoFactor: pin === MOCK_PINS.twoFactor };
}

interface BayeuxMsg {
  id?: string;
  channel: string;
  clientId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  subscription?: string;
}

export class MockKahootServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  readonly httpBase: string;
  readonly wsBase: string;
  /** all answers received, for assertions */
  readonly receivedAnswers: Array<{ pin: string; choice: number; questionIndex: number }> = [];

  private constructor(httpServer: http.Server, wss: WebSocketServer, port: number) {
    this.httpServer = httpServer;
    this.wss = wss;
    this.httpBase = `http://127.0.0.1:${port}`;
    this.wsBase = `ws://127.0.0.1:${port}`;
  }

  static async start(): Promise<MockKahootServer> {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://mock');
      if (req.method === 'HEAD' && url.pathname === '/') {
        res.writeHead(200);
        res.end();
        return;
      }
      const m = url.pathname.match(/^\/reserve\/session\/(\d+)\/?$/);
      if (req.method === 'GET' && m) {
        const pin = m[1];
        const mat = materials(pin);
        if (!mat) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-kahoot-session-token': mat.sessionB64,
        });
        res.end(JSON.stringify({ challenge: mat.challenge, twoFactorAuth: mat.twoFactor, namerator: false }));
        return;
      }
      res.writeHead(404);
      res.end('nope');
    });

    const wss = new WebSocketServer({ server });
    const mock = new MockKahootServer(server, wss, 0);
    wss.on('connection', (ws, req) => mock.handleSocket(ws, req.url ?? ''));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    (mock as { httpBase: string }).httpBase = `http://127.0.0.1:${port}`;
    (mock as { wsBase: string }).wsBase = `ws://127.0.0.1:${port}`;
    return mock;
  }

  async stop(): Promise<void> {
    this.wss.clients.forEach((c) => {
      try { c.close(); } catch { /* noop */ }
    });
    await new Promise<void>((resolve) => {
      this.wss.close(() => this.httpServer.close(() => resolve()));
    });
  }

  private handleSocket(ws: WebSocket, url: string): void {
    const m = url.match(/^\/cometd\/(\d+)\/(.+)$/);
    if (!m) {
      ws.close(1008, 'bad path');
      return;
    }
    const pin = m[1];
    let token: string;
    try {
      token = decodeURIComponent(m[2]);
    } catch {
      ws.close(1008, 'bad token encoding');
      return;
    }
    const mat = materials(pin);
    if (!mat || !mat.expectedToken || token !== mat.expectedToken) {
      ws.close(1008, 'invalid comet token');
      return;
    }

    const send = (msgs: BayeuxMsg[]): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msgs));
    };
    const player = (id: number, content: unknown): void =>
      send([{ channel: '/service/player', data: { id, type: 'message', content: JSON.stringify(content) } }]);
    const controller = (data: Record<string, unknown>): void =>
      send([{ channel: '/service/controller', data }]);

    let loggedIn = false;
    let answered = new Set<number>();

    const script = (): void => {
      // Scripted 2-question game with small delays.
      setTimeout(() => player(9, { quizName: 'Mock Quiz', quizQuestionAnswers: [4, 2] }), 30);
      setTimeout(() => player(2, { questionIndex: 0, type: 'quiz', quizQuestionAnswers: [4, 2] }), 80);
    };

    ws.on('message', (raw) => {
      let msgs: BayeuxMsg[];
      try {
        const parsed: unknown = JSON.parse(String(raw));
        msgs = Array.isArray(parsed) ? (parsed as BayeuxMsg[]) : [parsed as BayeuxMsg];
      } catch {
        return;
      }
      for (const msg of msgs) {
        if (msg.channel === '/meta/handshake') {
          send([{ id: msg.id, channel: '/meta/handshake', successful: true, clientId: 'mock-client-1', version: '1.0', minimumVersion: '1.0', supportedConnectionTypes: ['websocket'], advice: { reconnect: 'retry' } }]);
        } else if (msg.channel === '/meta/connect') {
          send([{ id: msg.id, channel: '/meta/connect', successful: true }]);
        } else if (msg.channel === '/meta/subscribe') {
          send([{ id: msg.id, channel: '/meta/subscribe', successful: true, subscription: msg.subscription }]);
        } else if (msg.channel === '/meta/disconnect') {
          send([{ id: msg.id, channel: '/meta/disconnect', successful: true }]);
          ws.close(1000, 'bye');
        } else if (msg.channel === '/service/controller' && msg.data) {
          const data = msg.data as { type?: string; id?: number; name?: string; content?: string };
          if (data.type === 'login') {
            if (pin === MOCK_PINS.silentLogin) {
              // never respond -> client must time out honestly
              continue;
            }
            if (data.name === 'Taken') {
              setTimeout(() => player(15, { reason: 'duplicate' }), 20);
              continue;
            }
            loggedIn = true;
            if (pin === MOCK_PINS.twoFactor) {
              setTimeout(() => player(53, {}), 20);
            } else {
              setTimeout(() => {
                player(14, { name: data.name });
                controller({ type: 'loginResponse', gameid: pin });
                script();
              }, 20);
            }
          } else if (data.type === 'message' && data.id === 50) {
            const seq = (JSON.parse(String(data.content)) as { sequence?: string }).sequence;
            if (seq === MOCK_TWO_FACTOR_SEQUENCE) {
              setTimeout(() => {
                player(52, {});
                player(14, {});
                script();
              }, 20);
            } else {
              setTimeout(() => player(51, {}), 20);
            }
          } else if (data.type === 'message' && data.id === 45) {
            if (!loggedIn) continue;
            const content = JSON.parse(String(data.content)) as { choice: number; questionIndex: number; type: string };
            this.receivedAnswers.push({ pin, choice: content.choice, questionIndex: content.questionIndex });
            const qi = content.questionIndex;
            if (answered.has(qi)) continue;
            answered.add(qi);
            setTimeout(() => controller({ id: 7, type: 'message', content: JSON.stringify({ questionIndex: qi }) }), 10);
            const correct = content.choice === MOCK_CORRECT[qi];
            const points = correct ? 900 - qi * 100 : 0;
            setTimeout(() => {
              player(8, { questionIndex: qi, correct, points, totalScore: points, rank: correct ? 2 : 5, streak: correct ? 1 : 0 });
            }, 30);
            if (pin === MOCK_PINS.kick) {
              setTimeout(() => player(10, {}), 60);
            } else if (qi === 0) {
              setTimeout(() => player(4, { questionIndex: 0 }), 60);
              setTimeout(() => player(2, { questionIndex: 1, type: 'true_false', quizQuestionAnswers: [4, 2] }), 90);
            } else if (qi === 1) {
              const total = 900 - 0 + (content.choice === MOCK_CORRECT[1] ? 800 : 0);
              setTimeout(() => player(3, { totalScore: total, rank: 3 }), 60);
              setTimeout(() => player(13, { podium: [{ name: 'MockPlayer', rank: 3 }] }), 90);
            }
          }
        }
      }
    });
  }
}

/** Build a challenge string in the exact documented format (for unit tests). */
export function documentedSampleChallenge(): string {
  return (
    `decode.call(this, 'KWWegtcjd7X3zvwL98druR5Vj58Om8OBSpDYO2px2MEMF6KW7JqhxeuSXyqqxWeYGiiRsSRTWgn67DcJBTGV08XJEBQjGWYeWJyR');\n\n` +
    `function decode(message) {\n` +
    `  var offset = (20 + ((61 + 3) + 22 + 86));\n` +
    `  if (this.angular.isObject(offset)) console.log("Offset derived as: {", offset, "}");\n` +
    `    return _.replace(message, /./g, function(char, position) {\n` +
    `      return String.fromCharCode((((char.charCodeAt(0) * position) + offset) % 77) + 48);\n` +
    `    });\n` +
    `}`
  );
}
