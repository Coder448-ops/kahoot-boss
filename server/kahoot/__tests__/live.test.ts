/* KAHOOT BOSS — live connector verification suite.
   Runs the COMPLETE connection workflow against a faithful mock of Kahoot's
   documented infrastructure: challenge solving (cross-checked against an
   independent JS-eval reference), join, questions, answers, real feedback,
   2-step verification, kicks, timeouts, and every failure path.
   Run: npm run test:live */

import vm from 'vm';
import { solveChallenge, parseChallenge, deriveCometToken, ChallengeError } from '../protocol';
import { KahootLiveClient, LiveError, createDirectReserve, type LiveKahootEvent } from '../client';
import { createNodeSocket } from '../nodeSocket';
import { loadConfig } from '../../config';
import { MockKahootServer, MOCK_PINS, MOCK_TWO_FACTOR_SEQUENCE, MOCK_CORRECT, documentedSampleChallenge } from './mock';

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

/** Independent reference: evaluate the challenge as the official client would (JS eval with shims). */
function referenceEval(challenge: string): string {
  const sandbox = {
    angular: { isString: () => true, isArray: () => true, isObject: () => true, isDate: () => true },
    _: {
      replace: (...args: unknown[]): string => {
        const s = String(args[0]);
        if (args.length < 3) return s;
        return s.replace(args[1] as RegExp, args[2] as (substring: string, ...rest: unknown[]) => string);
      },
    },
    console: { log: () => undefined },
  };
  vm.createContext(sandbox);
  return vm.runInContext(challenge, sandbox) as string;
}

function waitFor(events: LiveKahootEvent[], pred: (e: LiveKahootEvent) => boolean, timeoutMs: number, label: string): Promise<LiveKahootEvent> {
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
  /* ---------- 1. challenge solver vs independent JS reference ---------- */
  console.log('— challenge solver (cross-checked with JS-eval reference) —');
  const sample = documentedSampleChallenge();
  const expected = referenceEval(sample);
  assert('documented sample solves identically to JS-eval reference', solveChallenge(sample) === expected);

  const variants = [
    sample.replace('isObject', 'isDate'),
    sample.replace('_.replace(message, /./g,', 'message.replace(/./g,'),
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '(7 * 30 - 18 + (4 * 5))'),
    sample.replace('% 77) + 48', '% 91) + 33'),
  ];
  variants.forEach((v, i) => {
    assert(`challenge variant ${i + 1} matches JS-eval reference`, solveChallenge(v) === referenceEval(v));
  });

  // Real-world drift: Kahoot ships offset expressions with exotic whitespace
  // (tabs, newlines, NBSP, em spaces) and comment/zero-width obfuscation.
  // Each must solve identically to the JS-eval reference (no eval in prod path).
  const obfuscated = [
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72\t*29)\n+\r\n(8*\u00A0(62\u2003*29)))'),
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72\u2007*29)\u2028+\u2029(8*\uFEFF(62\u00A0*29)))'),
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72/**/+29) + (8* (62/*x*/*29))) // trailing'),
  ];
  obfuscated.forEach((v, i) => {
    assert(`obfuscated offset ${i + 1} matches JS-eval reference`, solveChallenge(v) === referenceEval(v));
  });

  // Zero-width format chars are NOT valid JS (the reference itself would throw),
  // so assert the parsed offset directly: (72*29)+(8*(62*29)) = 16472.
  const zeroWidth = [
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72\u200B*29) + (8* (62\u200B*29)))'),
    sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72\u200C*29) + (8*\u200D(62\u2060*29)))'),
  ];
  zeroWidth.forEach((v, i) => {
    assert(`zero-width offset ${i + 1} parses to 16472`, parseChallenge(v).offset === 16472);
  });

  // Truly unknown characters still fail — but now name their codepoints.
  const backslash = sample.replace('(20 + ((61 + 3) + 22 + 86))', '((72 *29) + (8* (62 \\*29)))');
  try {
    solveChallenge(backslash);
    assert('backslash offset rejected with codepoint diagnostics', false, 'solve unexpectedly succeeded');
  } catch (e) {
    assert(
      'backslash offset rejected with codepoint diagnostics',
      e instanceof ChallengeError && /U\+005C/.test(e.message),
      e instanceof Error ? e.message : String(e),
    );
  }

  const parts = parseChallenge(sample);
  assert('offset parsed as 192', parts.offset === 192, `got ${parts.offset}`);
  assert('mod/plus parsed as 77/48', parts.mod === 77 && parts.plus === 48);

  for (const bad of ['', 'garbage', "decode.call(this, 'x');", 'function decode() {}']) {
    let threw = false;
    try {
      solveChallenge(bad);
    } catch (e) {
      threw = e instanceof ChallengeError;
    }
    assert(`malformed challenge rejected honestly (${JSON.stringify(bad).slice(0, 28)}…)`, threw);
  }

  /* ---------- 2. token derivation ---------- */
  console.log('— comet token derivation —');
  const sessionB64 = Buffer.from('session-bytes-1234').toString('base64');
  const solution = 'Ab9!xQ';
  const token = deriveCometToken(sessionB64, solution);
  // Independent re-computation (plain loop, no shared code path beyond Buffer).
  const raw = Buffer.from(sessionB64, 'base64');
  let manual = '';
  for (let i = 0; i < raw.length; i++) manual += String.fromCharCode(raw[i] ^ (solution.charCodeAt(i % solution.length) & 0xff));
  assert('XOR derivation matches independent computation', token === manual);
  assert('token URL-encodes safely', decodeURIComponent(encodeURIComponent(token)) === token);

  /* ---------- 3. mock server ---------- */
  console.log('— mock infrastructure —');
  const mock = await MockKahootServer.start();
  assert('mock server started', mock.httpBase.startsWith('http://127.0.0.1:'));

  const baseCfg = loadConfig();
  const cfg = {
    ...baseCfg,
    reserveBase: mock.httpBase,
    cometdBase: mock.wsBase,
    reserveTimeoutMs: 5000,
    handshakeTimeoutMs: 5000,
    loginTimeoutMs: 4000,
    twoFactorTimeoutMs: 3000,
  };

  /* ---------- 4. full game: join → questions → answers → real feedback ---------- */
  console.log('— full game workflow (client level) —');
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    const events: LiveKahootEvent[] = [];
    c.onEvent((e) => events.push(e));

    const joined = await c.join(MOCK_PINS.game, 'Tester');
    assert('join resolves with pin + nickname', joined.pin === MOCK_PINS.game && joined.nickname === 'Tester' && joined.twoFactor === false);

    const qs = (await waitFor(events, (e) => e.type === 'quizStart', 5000, 'quizStart')) as Extract<LiveKahootEvent, { type: 'quizStart' }>;
    assert('quizStart carries name + counts', qs.quizName === 'Mock Quiz' && qs.questionCount === 2 && qs.choiceCounts.join(',') === '4,2');

    const q0 = (await waitFor(events, (e) => e.type === 'question', 5000, 'question 0')) as Extract<LiveKahootEvent, { type: 'question' }>;
    assert('question 0 parsed (quiz, 4 known choices)', q0.index === 0 && q0.gameType === 'quiz' && q0.choices === 4 && q0.choicesKnown === true);

    const sent = c.answer(MOCK_CORRECT[0]);
    assert('answer q0 accepted', sent.sent === true && sent.choice === 2);

    const fb0 = (await waitFor(events, (e) => e.type === 'feedback', 5000, 'feedback 0')) as Extract<LiveKahootEvent, { type: 'feedback' }>;
    assert('answer reached the wire (mock received it)', mock.receivedAnswers.some((a) => a.questionIndex === 0 && a.choice === 2));
    assert('feedback q0 correct=true with score + rank', fb0.correct === true && (fb0.points ?? 0) > 0 && fb0.totalScore === fb0.points && fb0.rank === 2);

    const q1 = (await waitFor(events, (e) => e.type === 'question' && e.index === 1, 5000, 'question 1')) as Extract<LiveKahootEvent, { type: 'question' }>;
    assert('question 1 parsed (true_false, 2 choices)', q1.gameType === 'true_false' && q1.choices === 2);

    c.answer(0); // wrong on purpose
    const fb1 = (await waitFor(events, (e) => e.type === 'feedback' && e.index === 1, 5000, 'feedback 1')) as Extract<LiveKahootEvent, { type: 'feedback' }>;
    assert('feedback q1 correct=false, zero points', fb1.correct === false && fb1.points === 0);

    const over = (await waitFor(events, (e) => e.type === 'gameOver', 5000, 'gameOver')) as Extract<LiveKahootEvent, { type: 'gameOver' }>;
    assert('gameOver carries totals', typeof over.totalScore === 'number' && typeof over.rank === 'number');
    await waitFor(events, (e) => e.type === 'podium', 5000, 'podium');
    assert('podium event delivered', true);

    await c.leave();
    assert('leave → closed state', c.getState() === 'closed');
  }

  /* ---------- 5. failure paths: never a fake success ---------- */
  console.log('— failure paths —');
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    try {
      await c.join(MOCK_PINS.notFound, 'Tester');
      assert('unknown PIN rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('unknown PIN → PIN_NOT_FOUND', e instanceof LiveError && e.code === 'PIN_NOT_FOUND', e instanceof Error ? e.message : String(e));
    }
    assert('failed join leaves client unusable-but-clean', c.getState() === 'failed');
  }
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    try {
      await c.join(MOCK_PINS.badChallenge, 'Tester');
      assert('bad challenge rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('bad challenge → CHALLENGE_FAILED', e instanceof LiveError && e.code === 'CHALLENGE_FAILED');
    }
  }
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    try {
      await c.join(MOCK_PINS.game, 'Taken');
      assert('rejected name rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('duplicate name → NAME_REJECTED', e instanceof LiveError && e.code === 'NAME_REJECTED');
    }
  }
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    try {
      await c.join(MOCK_PINS.silentLogin, 'Tester');
      assert('silent server rejected', false, 'join unexpectedly succeeded');
    } catch (e) {
      assert('silent login → LOGIN_TIMEOUT', e instanceof LiveError && e.code === 'LOGIN_TIMEOUT');
    }
  }
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    try {
      c.answer(0);
      assert('answer with no session rejected', false);
    } catch (e) {
      assert('answer with no session → NO_ACTIVE_QUESTION', e instanceof LiveError && e.code === 'NO_ACTIVE_QUESTION');
    }
  }

  /* ---------- 6. two-step verification ---------- */
  console.log('— 2-step verification —');
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    const events: LiveKahootEvent[] = [];
    c.onEvent((e) => events.push(e));
    const r = await c.join(MOCK_PINS.twoFactor, 'Tester');
    assert('2FA join reports awaitingTwoFactor', r.twoFactor === true && c.getState() === 'awaitingTwoFactor');

    const wrong = await c.submitTwoFactor('0000');
    assert('wrong pattern → ok:false, stays awaiting', wrong.ok === false && c.getState() === 'awaitingTwoFactor');

    const right = await c.submitTwoFactor(MOCK_TWO_FACTOR_SEQUENCE);
    assert('correct pattern → ok:true, lobby reached', right.ok === true && c.getState() === 'lobby');
    assert('joined event emitted after verification', events.some((e) => e.type === 'joined'));
    await c.leave();
  }

  /* ---------- 7. kick handling ---------- */
  console.log('— kick handling —');
  {
    const c = new KahootLiveClient(cfg, { createSocket: createNodeSocket, reserve: createDirectReserve(cfg) });
    const events: LiveKahootEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.join(MOCK_PINS.kick, 'Tester');
    await waitFor(events, (e) => e.type === 'question', 5000, 'kick-game question');
    c.answer(0);
    const kicked = await waitFor(events, (e) => e.type === 'kicked', 5000, 'kicked');
    assert('kick event carries reason', kicked.type === 'kicked' && kicked.reason.length > 10);
    await c.leave().catch(() => undefined);
  }

  /* ---------- 8. REST + SSE layer ---------- */
  console.log('— REST + SSE layer —');
  {
    process.env.KB_NO_LISTEN = '1';
    process.env.KAHOOT_RESERVE_BASE = mock.httpBase;
    process.env.KAHOOT_COMETD_BASE = mock.wsBase;
    process.env.TIMEOUT_LOGIN_MS = '4000';
    const { app } = await import('../../index');
    const srv = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => srv.on('listening', () => resolve()));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const post = async (path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };

    const health = await (await fetch(`${base}/live/health`)).json() as { status: string; kahootReachable: boolean; protocol: string };
    assert('health reports ok + reachable mock + protocol', health.status === 'ok' && health.kahootReachable === true && typeof health.protocol === 'string');

    const badPin = await post('/live/join', { pin: 'abc', nickname: 'Tester' });
    assert('REST rejects malformed PIN (422 INVALID_PIN)', badPin.status === 422 && badPin.json.code === 'INVALID_PIN');

    const shortPin = await post('/live/join', { pin: '123', nickname: 'Tester' });
    assert('REST rejects short PIN for live (6–10 digits)', shortPin.status === 422);

    const noGame = await post('/live/join', { pin: MOCK_PINS.notFound, nickname: 'Tester' });
    assert('REST unknown PIN → 404 PIN_NOT_FOUND', noGame.status === 404 && noGame.json.code === 'PIN_NOT_FOUND');

    const early = await post('/live/answer', { choice: 0 });
    assert('REST answer with no session → 409', early.status === 409);

    // SSE subscribes BEFORE the join so it observes the full event sequence.
    const seen: string[] = [];
    const ctrl = new AbortController();
    let sseReady!: () => void;
    const sseReadyPromise = new Promise<void>((resolve) => { sseReady = resolve; });
    const ssePromise = (async () => {
      const res = await fetch(`${base}/live/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts2 = buf.split('\n\n');
        buf = parts2.pop() ?? '';
        for (const chunk of parts2) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            try {
              seen.push((JSON.parse(line.slice(6)) as { type: string }).type);
              if (first) { first = false; sseReady(); }
            } catch { /* partial */ }
          }
        }
        if (seen.includes('question')) break;
      }
      ctrl.abort();
    })();
    const sseGuard = ssePromise.catch(() => undefined);
    await Promise.race([
      sseReadyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('sse subscribe timeout')), 5000)),
    ]);
    assert('SSE subscription receives initial state snapshot', seen[0] === 'state');

    const join = await post('/live/join', { pin: MOCK_PINS.game, nickname: 'Resty' });
    assert('REST join works end-to-end', join.status === 200 && join.json.status === 'joined');

    const busy = await post('/live/join', { pin: MOCK_PINS.game, nickname: 'Other' });
    assert('second join while busy → 409 SESSION_BUSY', busy.status === 409 && busy.json.code === 'SESSION_BUSY');

    const st = (await (await fetch(`${base}/live/status`)).json()) as { snapshot: { state: string; nickname: string } };
    assert('status snapshot reflects live session', ['lobby', 'question'].includes(st.snapshot.state) && st.snapshot.nickname === 'Resty');

    await Promise.race([
      sseGuard,
      new Promise((_, reject) => setTimeout(() => reject(new Error('sse question timeout')), 8000)),
    ]).catch((e: Error) => {
      assert('SSE streams joined → quizStart → question', false, e.message);
    });
    if (seen.includes('question')) {
      assert('SSE streams joined → quizStart → question', seen.includes('joined') && seen.includes('quizStart') && seen.includes('question'), seen.join(','));
    }

    // Answer the live question through REST (correct choice for q0)
    const ans = await post('/live/answer', { choice: MOCK_CORRECT[0] });
    assert('REST answer accepted (202)', ans.status === 202 && ans.json.sent === true);

    const leave = await post('/live/leave', {});
    assert('REST leave ok', leave.status === 200);

    srv.close();
  }

  await mock.stop();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('SUITE CRASHED:', e);
  process.exit(1);
});
