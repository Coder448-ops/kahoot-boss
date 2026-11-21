/* KAHOOT BOSS — direct (backend-free) live mode verification suite.
   Runs the COMPLETE browser path against faithful mocks: the REAL serverless
   reserve relay (api/kahoot-reserve.ts, pointed at the mock via
   KAHOOT_RESERVE_BASE) + the REAL in-browser engine
   (src/engine/directLive.ts: relay reserve, challenge solve, native-WebSocket
   Bayeux, play logic) + the mock Kahoot infrastructure. The only
   browser-only piece this substitutes is the WebSocket implementation (Node's
   global WebSocket instead of the browser's — same API surface).
   Run: npm run test:direct */

import http from 'http';
import { createDirectLiveApi } from '../../../src/engine/directLive';
import { LiveBackendError, type LiveEvent } from '../../../src/engine/liveClient';
import { MockKahootServer, MOCK_PINS, MOCK_TWO_FACTOR_SEQUENCE, MOCK_CORRECT } from './mock';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const relayHandler = require('../../../api/kahoot-reserve') as (req: unknown, res: unknown) => Promise<void>;

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function waitFor(events: LiveEvent[], pred: (e: LiveEvent) => boolean, timeoutMs: number, label: string): Promise<LiveEvent> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.find(pred);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}. Got: ${events.map((e) => e.type).join(', ') || '(nothing)'}`));
      }
    }, 25);
  });
}

async function main(): Promise<void> {
  /* ---------- 1. infrastructure: mock Kahoot + REAL relay handler ---------- */
  console.log('— direct-mode infrastructure —');
  const mock = await MockKahootServer.start();
  assert('mock Kahoot started', mock.httpBase.startsWith('http://127.0.0.1:'));

  process.env.KAHOOT_RESERVE_BASE = mock.httpBase;
  const relay = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://relay');
    if (url.pathname !== '/api/kahoot-reserve') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    (req as unknown as { query: Record<string, string | undefined> }).query = { pin: url.searchParams.get('pin') ?? undefined };
    void (relayHandler(req, res) as Promise<void>).catch((e: Error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'error', code: 'RELAY_CRASH', error: e.message }));
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const relayBase = `http://127.0.0.1:${(relay.address() as { port: number }).port}/api/kahoot-reserve`;
  assert('relay harness serves the real handler', relayBase.includes('/api/kahoot-reserve'));

  const makeApi = () => createDirectLiveApi({ relayPath: relayBase, cometdBase: mock.wsBase });

  /* ---------- 2. health probe: relay alive + Kahoot answers through it ---------- */
  console.log('— health probe (real two-stage) —');
  {
    const api = makeApi();
    const { data } = await api.health('direct', 15000);
    assert('health identifies the direct engine', data.service === 'kahoot-boss-direct' && data.reserveBase.startsWith('relay:'));
    assert('probe proves Kahoot reachable via relay', data.kahootReachable === true && (data.kahootLatencyMs ?? 0) > 0, data.kahootProbeNote);
    assert('probe note explains the measurement', data.kahootProbeNote.length > 20);
    assert('idle engine reports free slot', data.sessionActive === false && data.sessionState === 'idle');
  }

  /* ---------- 3. full game through the relay + native WebSocket Bayeux ---------- */
  console.log('— full game workflow (direct engine) —');
  {
    const api = makeApi();
    const events: LiveEvent[] = [];
    const off = api.subscribe('direct', (e) => events.push(e));

    const { data: joined } = await api.join('direct', MOCK_PINS.game, 'Tester', 75000);
    assert('join resolves joined + snapshot', joined.status === 'joined' && joined.snapshot.state === 'lobby' && joined.snapshot.pin === MOCK_PINS.game);
    assert('join snapshot carries nickname', joined.snapshot.nickname === 'Tester');

    const { data: st } = await api.status('direct');
    assert('status reflects lobby', st.snapshot.state === 'lobby');

    const qs = (await waitFor(events, (e) => e.type === 'quizStart', 5000, 'quizStart')) as Extract<LiveEvent, { type: 'quizStart' }>;
    assert('quizStart carries name + counts', qs.quizName === 'Mock Quiz' && qs.questionCount === 2 && qs.choiceCounts.join(',') === '4,2');

    const q0 = (await waitFor(events, (e) => e.type === 'question', 5000, 'question 0')) as Extract<LiveEvent, { type: 'question' }>;
    assert('question 0 parsed (quiz, 4 known choices)', q0.index === 0 && q0.gameType === 'quiz' && q0.choices === 4 && q0.choicesKnown === true);

    const { data: sent } = await api.answer('direct', MOCK_CORRECT[0]);
    assert('answer q0 accepted via facade', sent.status === 'sent' && sent.sent === true && sent.choice === 2 && sent.index === 0);

    const fb0 = (await waitFor(events, (e) => e.type === 'feedback', 5000, 'feedback 0')) as Extract<LiveEvent, { type: 'feedback' }>;
    assert('answer reached the wire (mock received it)', mock.receivedAnswers.some((a) => a.questionIndex === 0 && a.choice === 2));
    assert('feedback q0 correct=true with score + rank', fb0.correct === true && (fb0.points ?? 0) > 0 && fb0.rank === 2);

    const q1 = (await waitFor(events, (e) => e.type === 'question' && e.index === 1, 5000, 'question 1')) as Extract<LiveEvent, { type: 'question' }>;
    assert('question 1 parsed (true_false, 2 choices)', q1.gameType === 'true_false' && q1.choices === 2);

    await api.answer('direct', 0); // wrong on purpose
    const fb1 = (await waitFor(events, (e) => e.type === 'feedback' && e.index === 1, 5000, 'feedback 1')) as Extract<LiveEvent, { type: 'feedback' }>;
    assert('feedback q1 correct=false, zero points', fb1.correct === false && fb1.points === 0);

    const over = (await waitFor(events, (e) => e.type === 'gameOver', 5000, 'gameOver')) as Extract<LiveEvent, { type: 'gameOver' }>;
    assert('gameOver carries totals', typeof over.totalScore === 'number' && typeof over.rank === 'number');

    const { data: left } = await api.leave('direct');
    assert('leave → left + closed snapshot', left.status === 'left' && left.snapshot.state === 'closed');
    off();
  }

  /* ---------- 4. failure paths: same honest codes as the connector ---------- */
  console.log('— failure paths —');
  {
    const api = makeApi();
    try {
      await api.join('direct', MOCK_PINS.notFound, 'Tester');
      assert('unknown PIN rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('unknown PIN → PIN_NOT_FOUND', e instanceof LiveBackendError && e.code === 'PIN_NOT_FOUND', e instanceof Error ? e.message : String(e));
    }
  }
  {
    const api = makeApi();
    try {
      await api.join('direct', MOCK_PINS.badChallenge, 'Tester');
      assert('bad challenge rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('bad challenge → CHALLENGE_FAILED', e instanceof LiveBackendError && e.code === 'CHALLENGE_FAILED');
    }
  }
  {
    const api = makeApi();
    try {
      await api.join('direct', MOCK_PINS.game, 'Taken');
      assert('rejected name rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('duplicate name → NAME_REJECTED', e instanceof LiveBackendError && e.code === 'NAME_REJECTED');
    }
  }
  {
    const api = makeApi();
    try {
      await api.answer('direct', 0);
      assert('answer with no session rejected', false);
    } catch (e) {
      assert('answer with no session → NO_ACTIVE_QUESTION', e instanceof LiveBackendError && e.code === 'NO_ACTIVE_QUESTION');
    }
  }
  {
    // Relay itself unreachable → honest RELAY_UNREACHABLE (not a fake join).
    const api = createDirectLiveApi({ relayPath: 'http://127.0.0.1:1/api/kahoot-reserve', cometdBase: mock.wsBase });
    try {
      await api.join('direct', MOCK_PINS.game, 'Tester');
      assert('dead relay rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('dead relay → RELAY_UNREACHABLE', e instanceof LiveBackendError && e.code === 'RELAY_UNREACHABLE', e instanceof Error ? e.message : String(e));
    }
  }

  /* ---------- 5. two-step verification through the facade ---------- */
  console.log('— 2-step verification —');
  {
    const api = makeApi();
    const events: LiveEvent[] = [];
    const off = api.subscribe('direct', (e) => events.push(e));
    const { data: r } = await api.join('direct', MOCK_PINS.twoFactor, 'Tester');
    assert('2FA join reports awaitingTwoFactor', r.status === 'awaitingTwoFactor' && r.snapshot.state === 'awaitingTwoFactor');

    const { data: wrong } = await api.twoFactor('direct', '0000');
    assert('wrong pattern → ok:false, stays awaiting', wrong.ok === false && wrong.snapshot.state === 'awaitingTwoFactor');

    const { data: right } = await api.twoFactor('direct', MOCK_TWO_FACTOR_SEQUENCE);
    assert('correct pattern → ok:true, lobby reached', right.ok === true && right.snapshot.state === 'lobby');
    assert('joined event emitted after verification', events.some((e) => e.type === 'joined'));
    await api.leave('direct');
    off();
  }

  /* ---------- 6. kick handling ---------- */
  console.log('— kick handling —');
  {
    const api = makeApi();
    const events: LiveEvent[] = [];
    const off = api.subscribe('direct', (e) => events.push(e));
    await api.join('direct', MOCK_PINS.kick, 'Tester');
    await waitFor(events, (e) => e.type === 'question', 5000, 'kick-game question');
    await api.answer('direct', 0);
    const kicked = await waitFor(events, (e) => e.type === 'kicked', 5000, 'kicked');
    assert('kick event carries reason', kicked.type === 'kicked' && kicked.reason.length > 10);
    await api.leave('direct').catch(() => undefined);
    off();
  }

  relay.close();
  await mock.stop();

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('direct test crashed:', e);
  process.exit(1);
});
