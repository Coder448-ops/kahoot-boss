/* KAHOOT BOSS — shared domain types */

export type SolverMethod = 'math' | 'knowledge' | 'heuristic' | 'api' | 'unresolved';

export interface SolveResult {
  bestIndex: number;
  confidence: number; // 0..1
  explanation: string;
  method: SolverMethod;
  language: string; // detected language label, e.g. "English"
  languageCode: string; // e.g. "en"
  scores: number[]; // per-option score 0..1
  reasoning: string[]; // step-by-step trace
  latencyMs: number;
  viaApi: boolean;
}

export type QuestionKind = 'text' | 'math' | 'image';

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  kind: QuestionKind;
  timeLimitSec: number;
  imageHint?: string;
}

export interface SessionAnswer {
  questionId: string;
  questionText: string;
  category: string;
  options: string[];
  pickedIndex: number | null; // null = unanswered / timeout
  correctIndex: number;
  correct: boolean | null; // null = unanswered
  timedOut: boolean;
  method: SolverMethod | 'manual';
  confidence: number | null;
  latencyMs: number;
  points?: number | null;
  rank?: number | null;
  streak?: number | null;
}

export type SessionStatus = 'running' | 'paused' | 'completed' | 'stopped';

export interface SessionEvent {
  ts: number;
  type: 'info' | 'answer' | 'error' | 'system';
  message: string;
}

export interface Session {
  id: string;
  pin: string;
  nickname: string;
  mode: 'simulation' | 'live';
  status: SessionStatus;
  startedAt: number;
  endedAt: number | null;
  currentIndex: number;
  autoAnswer: boolean;
  answerDelayMs: number;
  confidenceThreshold: number;
  questions: Question[];
  answers: SessionAnswer[];
  events: SessionEvent[];
  errors: string[];
}

export interface SolveRecord {
  id: string;
  ts: number;
  question: string;
  options: string[];
  imageName: string | null;
  result: SolveResult;
  userVerdict: 'correct' | 'wrong' | null;
}

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: 'session' | 'solver' | 'system' | 'settings' | 'connection';
  message: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  pin: string;
  nickname: string;
  mode: 'simulation' | 'live' | null;
  detail: string;
  latencyMs: number | null;
  connectedAt: number | null;
  lastError: string | null;
}

export interface Settings {
  solverMode: 'local' | 'api';
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
  autoAnswer: boolean;
  answerDelayMs: number;
  confidenceThreshold: number;
  defaultQuestionCount: number;
  defaultTimeLimitSec: number;
  liveBackendUrl: string;
  persistHistory: boolean;
  soundEnabled: boolean;
}

export interface Profile {
  displayName: string;
  role: string;
}

export type DiagnosticStatus = 'pending' | 'pass' | 'warn' | 'fail';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  latencyMs: number | null;
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}
