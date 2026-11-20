/* KAHOOT BOSS — live Kahoot game client.
   Performs a REAL join against Kahoot's session infrastructure using the same
   endpoints the official web client uses (reserve/session + CometD/Bayeux).
   Single-player only: one nickname per connector instance. No flooding,
   no multi-bot features — by design. */

import { EventEmitter } from 'events';
import { BayeuxClient, type BayeuxMessage } from './bayeux';
import {
  EVENT_IDS,
  asBool,
  asNumber,
  asString,
  buildAnswerContent,
  buildLogin,
  buildTwoFactorContent,
  deriveCometToken,
  eventName,
  parseContent,
  solveChallenge,
  ChallengeError,
  ProtocolError,
} from './protocol';
import type { ConnectorConfig } from '../config';
import { validateChoice } from '../validate';

export type LiveState =
  | 'idle'
  | 'reserving'
  | 'solving'
  | 'connecting'
  | 'loggingIn'
  | 'awaitingTwoFactor'
  | 'lobby'
  | 'question'
  | 'ended'
  | 'closed'
  | 'failed';

export class LiveError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'LiveError';
    this.code = code;
    this.detail = detail;
  }
}

export type LiveKahootEvent =
  | { type: 'state'; state: LiveState }
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

export interface LiveSnapshot {
  state: LiveState;
  pin: string | null;
  nickname: string | null;
  quizName: string | null;
  questionCount: number | null;
  choiceCounts: number[];
  twoFactor: boolean;
  current: { index: number; gameType: string; choices: number | null; choicesKnown: boolean; answered: boolean; startedAt: number } | null;
  connectedAt: number | null;
  lastRttMs: number;
}

interface PendingTwoFactor {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const debug = (...args: unknown[]): void => {
  if (process.env.KB_DEBUG === '1') console.log('[live:debug]', ...args);
};

export class KahootLiveClient extends EventEmitter {
  private bayeux: BayeuxClient | null = null;
  private state: LiveState = 'idle';
  private pin: string | null = null;
  private nickname: string | null = null;
  private quizName: string | null = null;
  private questionCount: number | null = null;
  private choiceCounts: number[] = [];
  private twoFactor = false;
  private namerator = false;
  private current: LiveSnapshot['current'] = null;
  private connectedAt: number | null = null;
  private joinedEmitted = false;
  private pendingTwoFactor: PendingTwoFactor | null = null;
  private offs: Array<() => void> = [];

  constructor(private readonly cfg: ConnectorConfig) {
    super();
  }

  getState(): LiveState {
    return this.state;
  }

  getSnapshot(): LiveSnapshot {
    return {
      state: this.state,
      pin: this.pin,
      nickname: this.nickname,
      quizName: this.quizName,
      questionCount: this.questionCount,
      choiceCounts: [...this.choiceCounts],
      twoFactor: this.twoFactor,
      current: this.current ? { ...this.current } : null,
      connectedAt: this.connectedAt,
      lastRttMs: this.bayeux?.getLastRttMs() ?? 0,
    };
  }

  private setState(state: LiveState): void {
    this.state = state;
    this.emit('event', { type: 'state', state } satisfies LiveKahootEvent);
  }

  private emitEvent(e: LiveKahootEvent): void {
    this.emit('event', e);
  }

  onEvent(fn: (e: LiveKahootEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }

  /* ---------------- join ---------------- */

  async join(pin: string, nickname: string): Promise<{ pin: string; nickname: string; twoFactor: boolean }> {
    if (this.state !== 'idle' && this.state !== 'closed' && this.state !== 'failed') {
      throw new LiveError('SESSION_BUSY', 'This connector already has an active live session. Leave it before joining another.');
    }
    this.reset();
    this.pin = pin;
    this.nickname = nickname;

    // 1. Reserve a session slot with Kahoot.
    this.setState('reserving');
    const reserveUrl = `${this.cfg.reserveBase}/reserve/session/${encodeURIComponent(pin)}/?${Date.now()}`;
    let res: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.reserveTimeoutMs);
      try {
        res = await fetch(reserveUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': this.cfg.userAgent,
            Origin: 'https://kahoot.it',
            Referer: 'https://kahoot.it/',
          },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      this.setState('failed');
      if (e instanceof Error && e.name === 'AbortError') {
        throw new LiveError('RESERVE_TIMEOUT', `Kahoot did not answer the session request within ${this.cfg.reserveTimeoutMs / 1000}s. Check your connection and retry.`);
      }
      throw new LiveError(
        'NETWORK_ERROR',
        'Could not reach Kahoot (reserve/session). Check internet access and DNS, and confirm kahoot.it is reachable from this network.',
        e instanceof Error ? e.message : String(e),
      );
    }

    if (res.status === 404) {
      this.setState('failed');
      throw new LiveError('PIN_NOT_FOUND', `No live game found for PIN ${pin}. PINs expire when the host ends the game — confirm the current PIN on the host screen.`);
    }
    if (res.status === 429) {
      this.setState('failed');
      throw new LiveError('RATE_LIMITED', 'Kahoot rate-limited this network address. Wait a minute and retry; avoid rapid repeated joins.');
    }
    if (res.status === 403) {
      this.setState('failed');
      throw new LiveError('BLOCKED', 'Kahoot refused the session request (HTTP 403). The network may be blocked or filtered.');
    }
    if (!res.ok) {
      this.setState('failed');
      throw new LiveError('RESERVE_FAILED', `Kahoot session request failed with HTTP ${res.status}. Retry in a moment.`);
    }

    let body: { challenge?: unknown; twoFactorAuth?: unknown; namerator?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      this.setState('failed');
      throw new LiveError('PROTOCOL_ERROR', 'Kahoot returned an unreadable session response (invalid JSON).');
    }
    const sessionToken = res.headers.get('x-kahoot-session-token');
    if (!sessionToken) {
      this.setState('failed');
      throw new LiveError('PROTOCOL_ERROR', 'Kahoot session response is missing the session token header.');
    }
    if (typeof body.challenge !== 'string' || body.challenge.length === 0) {
      this.setState('failed');
      throw new LiveError('PROTOCOL_ERROR', 'Kahoot session response is missing the challenge payload.');
    }
    this.twoFactor = body.twoFactorAuth === true;
    this.namerator = (body as { namerator?: unknown }).namerator === true;

    // 2. Solve the challenge and derive the CometD token.
    this.setState('solving');
    let solution: string;
    try {
      solution = solveChallenge(body.challenge);
    } catch (e) {
      this.setState('failed');
      if (e instanceof ChallengeError) {
        throw new LiveError('CHALLENGE_FAILED', `Kahoot's session challenge could not be solved: ${e.message}`, undefined);
      }
      throw new LiveError('CHALLENGE_FAILED', 'Challenge solving crashed unexpectedly.', e instanceof Error ? e.message : String(e));
    }
    let cometToken: string;
    try {
      cometToken = deriveCometToken(sessionToken, solution);
    } catch (e) {
      this.setState('failed');
      throw new LiveError('PROTOCOL_ERROR', e instanceof Error ? e.message : 'Could not derive the session token.');
    }

    // 3. Bayeux handshake + subscriptions.
    this.setState('connecting');
    const bayeux = new BayeuxClient({
      handshakeTimeoutMs: this.cfg.handshakeTimeoutMs,
      connectTimeoutMs: this.cfg.handshakeTimeoutMs,
      userAgent: this.cfg.userAgent,
    });
    this.bayeux = bayeux;
    this.offs.push(bayeux.onMessage((channel, msg) => this.routeMessage(channel, msg)));
    this.offs.push(
      bayeux.onClose((info) => {
        const active = this.state !== 'idle' && this.state !== 'closed' && this.state !== 'failed' && this.state !== 'ended';
        if (active) this.setState('closed');
        this.emitEvent({ type: 'closed', code: info.code, reason: info.reason || 'connection closed', unexpected: info.unexpected });
      }),
    );
    this.offs.push(
      bayeux.onError((err) => {
        debug('bayeux error:', err.message);
      }),
    );

    const wsUrl = `${this.cfg.cometdBase}/cometd/${encodeURIComponent(pin)}/${encodeURIComponent(cometToken)}`;
    try {
      await bayeux.connect(wsUrl);
      await bayeux.handshake();
      await bayeux.subscribe(['/service/controller', '/service/player', '/service/status']);
    } catch (e) {
      this.setState('failed');
      await this.teardown();
      const msg = e instanceof Error ? e.message : String(e);
      if (/timed out/i.test(msg)) {
        throw new LiveError('HANDSHAKE_TIMEOUT', `Game server handshake timed out: ${msg}`);
      }
      throw new LiveError('CONNECTION_FAILED', `Could not establish the game channel: ${msg}`, msg);
    }

    // 4. Login (join with nickname).
    this.setState('loggingIn');
    try {
      bayeux.publish('/service/controller', buildLogin(pin, nickname, this.cfg.captchaToken));
    } catch (e) {
      this.setState('failed');
      await this.teardown();
      throw new LiveError('LOGIN_FAILED', 'Could not send the join request over the game channel.', e instanceof Error ? e.message : String(e));
    }

    const outcome = await this.waitForLogin();
    if (outcome === 'rejected') {
      this.setState('failed');
      await this.teardown();
      throw new LiveError(
        'NAME_REJECTED',
        `Nickname "${nickname}" was rejected by Kahoot (duplicate, filtered word, or the host enforces the name generator). Try a different nickname.`,
      );
    }
    if (outcome === 'twoFactor') {
      this.setState('awaitingTwoFactor');
      this.emitEvent({ type: 'twoFactorRequired' });
      return { pin, nickname, twoFactor: true };
    }
    this.enterLobby();
    return { pin, nickname, twoFactor: this.twoFactor };
  }

  private waitForLogin(): Promise<'accepted' | 'rejected' | 'twoFactor' | 'timeout' | 'error'> {
    type Outcome = 'accepted' | 'rejected' | 'twoFactor' | 'timeout' | 'error';
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve('timeout');
      }, this.cfg.loginTimeoutMs);
      const off = this.onEvent((e) => {
        if (e.type === 'joined') {
          cleanup();
          resolve('accepted');
        } else if (e.type === 'twoFactorRequired') {
          cleanup();
          resolve('twoFactor');
        } else if (e.type === 'error' && (e.code === 'NAME_REJECTED' || e.code === 'LOGIN_FAILED')) {
          cleanup();
          resolve(e.code === 'NAME_REJECTED' ? 'rejected' : 'error');
        }
      });
      const cleanup = (): void => {
        clearTimeout(timer);
        off();
      };
    }).then(async (outcome) => {
      if (outcome === 'timeout') {
        this.setState('failed');
        await this.teardown();
        throw new LiveError('LOGIN_TIMEOUT', `Kahoot did not confirm the join within ${this.cfg.loginTimeoutMs / 1000}s. The game may be full, already started, or unreachable.`);
      }
      if (outcome === 'error') {
        this.setState('failed');
        await this.teardown();
        throw new LiveError('LOGIN_FAILED', 'Kahoot rejected the join request. See the error event for the server message.');
      }
      return outcome;
    });
  }

  private enterLobby(): void {
    this.setState('lobby');
    this.connectedAt = Date.now();
    this.emitJoinedOnce();
  }

  private emitJoinedOnce(): void {
    if (this.joinedEmitted || !this.pin || !this.nickname) return;
    this.joinedEmitted = true;
    this.emitEvent({ type: 'joined', pin: this.pin, nickname: this.nickname, quizName: this.quizName, twoFactor: this.twoFactor, namerator: this.namerator });
  }

  /* ---------------- 2-step verification ---------------- */

  async submitTwoFactor(sequence: string): Promise<{ ok: boolean }> {
    if (this.state !== 'awaitingTwoFactor') {
      throw new LiveError('NO_TWO_FACTOR', 'No verification is currently requested by the game.');
    }
    if (!this.bayeux) throw new LiveError('NOT_CONNECTED', 'Game channel is not open.');
    if (this.pendingTwoFactor) throw new LiveError('TWO_FACTOR_BUSY', 'A verification attempt is already in flight.');

    this.bayeux.publish('/service/controller', {
      type: 'message',
      gameid: this.pin,
      host: 'kahoot.it',
      id: EVENT_IDS.SUBMIT_TWO_FACTOR,
      content: JSON.stringify(buildTwoFactorContent(sequence)),
    });

    return new Promise<{ ok: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTwoFactor = null;
        reject(new LiveError('TWO_FACTOR_TIMEOUT', `Kahoot did not answer the verification within ${this.cfg.twoFactorTimeoutMs / 1000}s. Watch for a fresh pattern and retry.`));
      }, this.cfg.twoFactorTimeoutMs);
      this.pendingTwoFactor = {
        resolve: (ok: boolean) => {
          clearTimeout(timer);
          this.pendingTwoFactor = null;
          resolve({ ok });
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          this.pendingTwoFactor = null;
          reject(err);
        },
        timer,
      };
    });
  }

  /* ---------------- answering ---------------- */

  answer(choice: number): { sent: boolean; index: number; choice: number } {
    if (this.state !== 'question' || !this.current) {
      throw new LiveError('NO_ACTIVE_QUESTION', 'There is no active question to answer right now.');
    }
    if (this.current.answered) {
      throw new LiveError('ALREADY_ANSWERED', `Question ${this.current.index + 1} was already answered.`);
    }
    const check = validateChoice(choice, this.current.choicesKnown ? this.current.choices : null);
    if (!check.ok) throw new LiveError('CHOICE_OUT_OF_RANGE', check.error ?? 'Invalid choice.');
    if (!this.bayeux) throw new LiveError('NOT_CONNECTED', 'Game channel is not open.');

    this.bayeux.publish('/service/controller', {
      type: 'message',
      gameid: this.pin,
      host: 'kahoot.it',
      id: EVENT_IDS.GAME_BLOCK_ANSWER,
      content: JSON.stringify(
        buildAnswerContent(this.current.gameType, choice, this.current.index, this.bayeux.getLastRttMs(), this.cfg.userAgent),
      ),
    });
    this.current.answered = true;
    return { sent: true, index: this.current.index, choice };
  }

  /* ---------------- leave / teardown ---------------- */

  async leave(reason = 'operator left'): Promise<void> {
    const wasActive = this.state !== 'idle' && this.state !== 'closed' && this.state !== 'failed';
    await this.teardown();
    this.setState('closed');
    if (wasActive) this.emitEvent({ type: 'left' });
    debug('left:', reason);
  }

  private async teardown(): Promise<void> {
    this.offs.forEach((off) => {
      try { off(); } catch { /* noop */ }
    });
    this.offs = [];
    if (this.pendingTwoFactor) {
      clearTimeout(this.pendingTwoFactor.timer);
      this.pendingTwoFactor = null;
    }
    if (this.bayeux) {
      const b = this.bayeux;
      this.bayeux = null;
      await b.disconnect().catch(() => undefined);
    }
  }

  private reset(): void {
    this.pin = null;
    this.nickname = null;
    this.quizName = null;
    this.questionCount = null;
    this.choiceCounts = [];
    this.twoFactor = false;
    this.namerator = false;
    this.current = null;
    this.connectedAt = null;
    this.joinedEmitted = false;
  }

  /* ---------------- inbound routing ---------------- */

  private routeMessage(channel: string, msg: BayeuxMessage): void {
    try {
      if (channel === '/service/controller') this.onController(msg);
      else if (channel === '/service/player') this.onPlayer(msg);
      else if (channel === '/service/status') debug('status:', JSON.stringify(msg.data ?? {}).slice(0, 300));
      else if (channel.startsWith('/meta/')) {
        if (msg.successful === false) debug('meta unsuccessful:', channel, msg.error ?? '');
      } else {
        debug('unrouted channel:', channel);
      }
    } catch (e) {
      debug('route crash:', e instanceof Error ? e.message : String(e));
    }
  }

  private onController(msg: BayeuxMessage): void {
    const data = (msg.data ?? {}) as Record<string, unknown>;
    if (data.error) {
      const desc = asString(data.description) ?? asString(data.error) ?? 'Unknown controller error.';
      debug('controller error:', desc);
      if (this.state === 'loggingIn' || this.state === 'connecting') {
        this.emitEvent({ type: 'error', code: 'LOGIN_FAILED', message: `Kahoot refused the join: ${desc}` });
      } else {
        this.emitEvent({ type: 'error', code: 'SERVER_ERROR', message: desc });
      }
      return;
    }
    if (data.type === 'loginResponse') {
      debug('loginResponse received');
      // Acceptance is confirmed via USERNAME_ACCEPTED(14); a bare loginResponse
      // without error means the join is being processed. If the game enforces
      // 2-step join, RESET_TWO_FACTOR_AUTH(53) follows on /service/player.
      return;
    }
    const id = asNumber(data.id);
    if (id === EVENT_IDS.ANSWER_RESPONSE) {
      const content = parseContent(data);
      const idx = asNumber(content.questionIndex) ?? this.current?.index ?? -1;
      debug('answer ack for Q', idx);
      if (idx >= 0) this.emitEvent({ type: 'answerAck', index: idx });
    } else if (id !== null) {
      debug('controller id:', eventName(id));
    }
  }

  private onPlayer(msg: BayeuxMessage): void {
    const data = (msg.data ?? {}) as Record<string, unknown>;
    if (data.error) {
      this.emitEvent({ type: 'error', code: 'SERVER_ERROR', message: asString(data.description) ?? 'Game server error.' });
      return;
    }
    const id = asNumber(data.id);
    if (id === null) {
      debug('player message without id');
      return;
    }
    const content = parseContent(data);
    debug('player:', eventName(id));

    switch (id) {
      case EVENT_IDS.USERNAME_ACCEPTED: {
        if (!this.joinedEmitted) {
          if (this.state === 'loggingIn' || this.state === 'connecting') this.enterLobby();
          else this.emitJoinedOnce();
        }
        break;
      }
      case EVENT_IDS.USERNAME_REJECTED: {
        this.emitEvent({ type: 'error', code: 'NAME_REJECTED', message: 'Nickname rejected by Kahoot.' });
        break;
      }
      case EVENT_IDS.RESET_TWO_FACTOR_AUTH: {
        this.twoFactor = true;
        if (this.state !== 'awaitingTwoFactor') {
          this.setState('awaitingTwoFactor');
          this.emitEvent({ type: 'twoFactorRequired' });
        }
        break;
      }
      case EVENT_IDS.TWO_FACTOR_CORRECT: {
        if (!this.joinedEmitted) this.enterLobby();
        else if (this.state === 'awaitingTwoFactor') this.setState('lobby');
        this.emitEvent({ type: 'twoFactorResult', ok: true });
        this.pendingTwoFactor?.resolve(true);
        break;
      }
      case EVENT_IDS.TWO_FACTOR_INCORRECT: {
        this.emitEvent({ type: 'twoFactorResult', ok: false });
        this.pendingTwoFactor?.resolve(false);
        break;
      }
      case EVENT_IDS.START_QUIZ: {
        const quizName = asString(content.quizName);
        if (quizName) this.quizName = quizName;
        const counts = Array.isArray(content.quizQuestionAnswers)
          ? (content.quizQuestionAnswers as unknown[]).filter((n): n is number => typeof n === 'number')
          : [];
        if (counts.length > 0) {
          this.choiceCounts = counts;
          this.questionCount = counts.length;
        }
        const totalQ = asNumber(content.questionCount ?? content.numberOfQuestions);
        if (totalQ !== null) this.questionCount = totalQ;
        this.emitEvent({ type: 'quizStart', quizName: this.quizName, questionCount: this.questionCount, choiceCounts: [...this.choiceCounts] });
        break;
      }
      case EVENT_IDS.START_QUESTION: {
        const index = asNumber(content.questionIndex);
        if (index === null) {
          debug('START_QUESTION without questionIndex — ignoring');
          break;
        }
        const gameType = asString(content.type ?? content.gameBlockType ?? content.quizType) ?? 'quiz';
        let choices: number | null = null;
        let choicesKnown = false;
        const arr = content.quizQuestionAnswers;
        if (Array.isArray(arr) && typeof arr[index] === 'number') {
          choices = arr[index] as number;
          choicesKnown = true;
        } else if (this.choiceCounts[index] !== undefined) {
          choices = this.choiceCounts[index];
          choicesKnown = true;
        }
        this.current = { index, gameType, choices, choicesKnown, answered: false, startedAt: Date.now() };
        this.setState('question');
        this.emitEvent({ type: 'question', index, gameType, choices, choicesKnown, raw: content });
        break;
      }
      case EVENT_IDS.TIME_UP: {
        this.emitEvent({ type: 'timeUp', index: this.current?.index ?? null });
        if (this.state === 'question') this.setState('lobby');
        break;
      }
      case EVENT_IDS.REVEAL_ANSWER: {
        const index = asNumber(content.questionIndex) ?? this.current?.index ?? -1;
        this.emitEvent({
          type: 'feedback',
          index,
          correct: asBool(content.correct ?? content.isCorrect),
          points: asNumber(content.points ?? content.score),
          totalScore: asNumber(content.totalScore ?? content.total ?? content.totalPoints),
          rank: asNumber(content.rank ?? content.ranking),
          streak: asNumber(content.streak ?? content.streakCount),
          raw: content,
        });
        if (this.state === 'question') this.setState('lobby');
        break;
      }
      case EVENT_IDS.GAME_OVER: {
        this.emitEvent({
          type: 'gameOver',
          totalScore: asNumber(content.totalScore ?? content.total ?? content.points),
          rank: asNumber(content.rank ?? content.ranking),
          raw: content,
        });
        this.setState('ended');
        break;
      }
      case EVENT_IDS.REVEAL_RANKING: {
        this.emitEvent({ type: 'podium', raw: content });
        break;
      }
      case EVENT_IDS.RESET_CONTROLLER: {
        this.emitEvent({ type: 'kicked', reason: 'Removed from the game (kicked by host or session reset).' });
        void this.leave('kicked');
        break;
      }
      case EVENT_IDS.GET_READY:
      case EVENT_IDS.GAME_BLOCK_START:
      case EVENT_IDS.GAME_BLOCK_END:
      case EVENT_IDS.PLAY_AGAIN:
      case EVENT_IDS.FEEDBACK:
      case EVENT_IDS.SUBMIT_FEEDBACK:
        debug('ignoring informational event:', eventName(id));
        break;
      default:
        debug('unhandled player event:', eventName(id), JSON.stringify(content).slice(0, 300));
        break;
    }
  }
}

/** Probe whether Kahoot's reserve host is reachable (TCP+TLS handshake, no game touched). */
export async function probeKahoot(hostUrl: string, timeoutMs = 4000): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // A HEAD request to the site root: measures reachability without joining anything.
      await fetch(hostUrl, { method: 'HEAD', signal: ctrl.signal });
      return { reachable: true, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

export { ChallengeError, ProtocolError };
