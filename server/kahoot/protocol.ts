/* KAHOOT BOSS — Kahoot live wire protocol.
   Implements the same session handshake the official Kahoot web client uses:
     1. GET {reserveBase}/reserve/session/{pin}/?{ms} -> { challenge, twoFactorAuth, ... }
        + `x-kahoot-session-token` header (404 = unknown PIN).
     2. Solve the JS challenge WITHOUT eval: parse the message literal, the
        offset expression (evaluated by our safe arithmetic evaluator) and the
        char-transform parameters, then compute the decoded string.
     3. XOR the base64-decoded session token with the solution -> comet token.
     4. Bayeux (CometD) over WebSocket at {cometdBase}/cometd/{pin}/{token}.
   No step is ever faked: unrecognized formats raise ChallengeError so the
   operator gets an honest "protocol changed" message instead of a fake join. */

import { evaluateExpression } from '../../src/engine/mathSolver';

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export interface ChallengeParts {
  message: string;
  offset: number;
  mod: number;
  plus: number;
}

/**
 * Parse a Kahoot JS challenge of the documented shape:
 *   decode.call(this, 'MESSAGE');
 *   function decode(message) {
 *     var offset = (EXPR);
 *     if (this.angular.isX(offset)) ...;
 *     return _.replace(message, /./g, function(char, position) {
 *       return String.fromCharCode((((char.charCodeAt(0) * position) + offset) % MOD) + PLUS);
 *     });
 *   }
 */
export function parseChallenge(challenge: string): ChallengeParts {
  if (!challenge || typeof challenge !== 'string' || challenge.length > 20000) {
    throw new ChallengeError('Challenge payload is missing or unreasonably large.');
  }

  const msgMatch = challenge.match(/decode\.call\(\s*this\s*,\s*['"]([^'"]+)['"]\s*\)/);
  if (!msgMatch) {
    throw new ChallengeError(
      'Unrecognized challenge format: invocation `decode.call(this, …)` not found. Kahoot may have changed their challenge — the connector needs an update.',
    );
  }

  const offsetMatch = challenge.match(/var\s+offset\s*=\s*([^;]+);/);
  if (!offsetMatch) {
    throw new ChallengeError('Unrecognized challenge format: `var offset = …` not found.');
  }
  const offset = evaluateExpression(offsetMatch[1].trim());
  if (offset === null || !Number.isFinite(offset)) {
    throw new ChallengeError(`Challenge offset expression could not be evaluated safely: "${offsetMatch[1].trim().slice(0, 120)}".`);
  }

  const codeIdx = challenge.indexOf('fromCharCode');
  const tail = codeIdx >= 0 ? challenge.slice(codeIdx) : challenge;
  const modMatch = tail.match(/%\s*(\d+)\)\s*\+\s*(\d+)/);
  if (!modMatch) {
    throw new ChallengeError('Unrecognized challenge format: char-transform `% MOD) + PLUS` not found.');
  }
  const mod = parseInt(modMatch[1], 10);
  const plus = parseInt(modMatch[2], 10);
  if (!(mod > 0) || !(plus >= 0) || mod > 100000 || plus > 100000) {
    throw new ChallengeError(`Challenge transform parameters out of range (mod=${modMatch[1]}, plus=${modMatch[2]}).`);
  }

  return { message: msgMatch[1], offset, mod, plus };
}

/** Compute the decoded solution string using exact JS char-code semantics. */
export function computeSolution(parts: ChallengeParts): string {
  const { message, offset, mod, plus } = parts;
  let out = '';
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i);
    out += String.fromCharCode(((code * i + offset) % mod) + plus);
  }
  return out;
}

/** Full challenge solve: parse + compute. Throws ChallengeError on any deviation. */
export function solveChallenge(challenge: string): string {
  return computeSolution(parseChallenge(challenge));
}

/**
 * Derive the CometD path token: base64-decode the session token, XOR every
 * byte with the solution (cycling), return a binary string.
 * The caller MUST URL-encode the result before placing it in the WS path.
 */
export function deriveCometToken(sessionTokenB64: string, solution: string): string {
  if (!sessionTokenB64 || typeof sessionTokenB64 !== 'string') {
    throw new ProtocolError('Missing `x-kahoot-session-token` response header.');
  }
  if (!solution) {
    throw new ProtocolError('Cannot derive comet token from an empty challenge solution.');
  }
  // Isomorphic base64 decode (atob exists in browsers and Node 16+; no Buffer).
  let bin: string;
  try {
    bin = atob(sessionTokenB64.trim());
  } catch {
    throw new ProtocolError('Session token is not valid base64.');
  }
  if (bin.length === 0) throw new ProtocolError('Session token decoded to zero bytes.');
  let out = '';
  for (let i = 0; i < bin.length; i++) {
    out += String.fromCharCode(bin.charCodeAt(i) ^ (solution.charCodeAt(i % solution.length) & 0xff));
  }
  return out;
}

/* ---------------- service message IDs (documented client event codes) ---------------- */

export const EVENT_IDS = {
  GET_READY: 1,
  START_QUESTION: 2,
  GAME_OVER: 3,
  TIME_UP: 4,
  PLAY_AGAIN: 5,
  ANSWER_SELECTED: 6,
  ANSWER_RESPONSE: 7,
  REVEAL_ANSWER: 8,
  START_QUIZ: 9,
  RESET_CONTROLLER: 10,
  SUBMIT_FEEDBACK: 11,
  FEEDBACK: 12,
  REVEAL_RANKING: 13,
  USERNAME_ACCEPTED: 14,
  USERNAME_REJECTED: 15,
  GAME_BLOCK_START: 43,
  GAME_BLOCK_END: 44,
  GAME_BLOCK_ANSWER: 45,
  SUBMIT_TWO_FACTOR: 50,
  TWO_FACTOR_INCORRECT: 51,
  TWO_FACTOR_CORRECT: 52,
  RESET_TWO_FACTOR_AUTH: 53,
} as const;

export const EVENT_NAMES: Record<number, string> = {
  1: 'GET_READY',
  2: 'START_QUESTION',
  3: 'GAME_OVER',
  4: 'TIME_UP',
  5: 'PLAY_AGAIN',
  6: 'ANSWER_SELECTED',
  7: 'ANSWER_RESPONSE',
  8: 'REVEAL_ANSWER',
  9: 'START_QUIZ',
  10: 'RESET_CONTROLLER',
  11: 'SUBMIT_FEEDBACK',
  12: 'FEEDBACK',
  13: 'REVEAL_RANKING',
  14: 'USERNAME_ACCEPTED',
  15: 'USERNAME_REJECTED',
  16: 'REQUEST_RECOVERY_DATA',
  31: 'IFRAME_CONTROLLER_EVENT',
  32: 'SERVER_IFRAME_EVENT',
  43: 'GAME_BLOCK_START',
  44: 'GAME_BLOCK_END',
  45: 'GAME_BLOCK_ANSWER',
  50: 'SUBMIT_TWO_FACTOR',
  51: 'TWO_FACTOR_INCORRECT',
  52: 'TWO_FACTOR_CORRECT',
  53: 'RESET_TWO_FACTOR_AUTH',
};

export function eventName(id: number): string {
  return EVENT_NAMES[id] ?? `UNKNOWN_${id}`;
}

/* ---------------- outbound message builders ---------------- */

export interface LoginPayload {
  type: 'login';
  gameid: string;
  host: 'kahoot.it';
  name: string;
  captchaToken?: string;
}

export function buildLogin(pin: string, name: string, captchaToken: string): LoginPayload {
  const payload: LoginPayload = { type: 'login', gameid: pin, host: 'kahoot.it', name };
  if (captchaToken) payload.captchaToken = captchaToken;
  return payload;
}

export interface AnswerContent {
  type: string;
  choice: number;
  questionIndex: number;
  meta: { lag: number; device: { userAgent: string } };
}

export function buildAnswerContent(type: string, choice: number, questionIndex: number, lagMs: number, userAgent: string): AnswerContent {
  return {
    type,
    choice,
    questionIndex,
    meta: { lag: Math.max(0, Math.round(lagMs)), device: { userAgent } },
  };
}

export function buildTwoFactorContent(sequence: string): { sequence: string } {
  return { sequence };
}

/** Parse the JSON `content` field of a service message; never throws. */
export function parseContent(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const content = (data as { content?: unknown }).content;
  if (typeof content === 'object' && content !== null) return content as Record<string, unknown>;
  if (typeof content === 'string' && content.length > 0) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      return { value: parsed };
    } catch {
      return { raw: content };
    }
  }
  return {};
}

export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
