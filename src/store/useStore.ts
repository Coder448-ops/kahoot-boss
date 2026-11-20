/* KAHOOT BOSS — global state (zustand + localStorage persistence).
   Persisted: profile, settings, sessions, solver history, activity.
   Ephemeral: connection, active session id, toasts. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEvent,
  ConnectionState,
  Profile,
  Question,
  Session,
  SessionAnswer,
  SessionEvent,
  SessionStatus,
  Settings,
  SolveRecord,
  SolveResult,
  Toast,
} from '../lib/types';
import { uid } from '../lib/utils';

export const DEFAULT_SETTINGS: Settings = {
  solverMode: 'local',
  apiBaseUrl: '/api',
  apiKey: '',
  apiModel: 'gpt-4o-mini',
  autoAnswer: true,
  answerDelayMs: 2500,
  confidenceThreshold: 0.4,
  defaultQuestionCount: 10,
  defaultTimeLimitSec: 20,
  liveApiUrl: '',
  liveApiKey: '',
  persistHistory: true,
  soundEnabled: false,
};

export const DEFAULT_PROFILE: Profile = {
  displayName: 'Operator',
  role: 'Quiz Automation Engineer',
};

const DISCONNECTED: ConnectionState = {
  status: 'disconnected',
  pin: '',
  nickname: '',
  mode: null,
  detail: 'Not connected. Enter a Game PIN to begin.',
  latencyMs: null,
  connectedAt: null,
  lastError: null,
};

interface Store {
  profile: Profile;
  settings: Settings;
  sessions: Session[];
  solves: SolveRecord[];
  activity: ActivityEvent[];
  connection: ConnectionState;
  activeSessionId: string | null;
  toasts: Toast[];

  setProfile: (p: Partial<Profile>) => void;
  updateSettings: (s: Partial<Settings>) => void;
  resetSettings: () => void;

  setConnection: (c: Partial<ConnectionState>) => void;
  disconnect: (reason?: string) => void;

  startSession: (opts: {
    pin: string;
    nickname: string;
    mode: 'simulation' | 'live';
    questions: Question[];
    autoAnswer: boolean;
    answerDelayMs: number;
    confidenceThreshold: number;
  }) => Session;
  appendSessionEvent: (sessionId: string, type: SessionEvent['type'], message: string) => void;
  recordAnswer: (sessionId: string, answer: SessionAnswer) => void;
  advanceSession: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setSessionError: (sessionId: string, error: string) => void;
  updateActiveSessionControls: (patch: Partial<Pick<Session, 'autoAnswer' | 'answerDelayMs' | 'confidenceThreshold'>>) => void;
  finishSession: (sessionId: string, status: 'completed' | 'stopped') => void;
  deleteSession: (id: string) => void;
  clearSessions: () => void;
  importSessions: (sessions: Session[]) => number;

  recordSolve: (question: string, options: string[], imageName: string | null, result: SolveResult) => SolveRecord;
  setVerdict: (id: string, verdict: 'correct' | 'wrong' | null) => void;
  clearSolves: () => void;

  pushActivity: (kind: ActivityEvent['kind'], message: string) => void;
  clearActivity: () => void;

  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

function cap<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(0, max) : arr;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      profile: DEFAULT_PROFILE,
      settings: DEFAULT_SETTINGS,
      sessions: [],
      solves: [],
      activity: [],
      connection: DISCONNECTED,
      activeSessionId: null,
      toasts: [],

      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      updateSettings: (s2) => set((s) => ({ settings: { ...s.settings, ...s2 } })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),

      setConnection: (c) => set((s) => ({ connection: { ...s.connection, ...c } })),
      disconnect: (reason) =>
        set((s) => ({
          connection: {
            ...DISCONNECTED,
            detail: reason ?? 'Disconnected.',
            lastError: s.connection.status === 'error' ? s.connection.lastError : null,
          },
          activeSessionId: null,
        })),

      startSession: (opts) => {
        const now = Date.now();
        const session: Session = {
          id: uid('ses'),
          pin: opts.pin,
          nickname: opts.nickname,
          mode: opts.mode,
          status: 'running',
          startedAt: now,
          endedAt: null,
          currentIndex: 0,
          autoAnswer: opts.autoAnswer,
          answerDelayMs: opts.answerDelayMs,
          confidenceThreshold: opts.confidenceThreshold,
          questions: opts.questions,
          answers: [],
          events: [{ ts: now, type: 'system', message: `Session started — PIN ${opts.pin}, player "${opts.nickname}", ${opts.questions.length} questions.` }],
          errors: [],
        };
        set((s) => ({ sessions: cap([session, ...s.sessions], 50), activeSessionId: session.id }));
        get().pushActivity('session', `Session started · PIN ${opts.pin} · ${opts.questions.length} questions (${opts.mode})`);
        return session;
      },

      appendSessionEvent: (sessionId, type, message) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === sessionId ? { ...ses, events: [...ses.events, { ts: Date.now(), type, message }].slice(-200) } : ses,
          ),
        })),

      recordAnswer: (sessionId, answer) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === sessionId ? { ...ses, answers: [...ses.answers, answer] } : ses,
          ),
        })),

      advanceSession: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === sessionId ? { ...ses, currentIndex: ses.currentIndex + 1 } : ses,
          ),
        })),

      setSessionStatus: (sessionId, status) =>
        set((s) => ({
          sessions: s.sessions.map((ses) => (ses.id === sessionId ? { ...ses, status } : ses)),
        })),

      setSessionError: (sessionId, error) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === sessionId ? { ...ses, errors: [...ses.errors, error].slice(-50) } : ses,
          ),
        })),

      updateActiveSessionControls: (patch) =>
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === s.activeSessionId ? { ...ses, ...patch } : ses,
          ),
        })),

      finishSession: (sessionId, status) => {
        const ses = get().sessions.find((x) => x.id === sessionId);
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, status, endedAt: Date.now() } : x,
          ),
          activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
        }));
        if (ses) {
          const correct = ses.answers.filter((a) => a.correct === true).length;
          get().pushActivity(
            'session',
            `Session ${status} · PIN ${ses.pin} · ${correct}/${ses.answers.length} correct`,
          );
        }
      },

      deleteSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        })),
      clearSessions: () => set({ sessions: [], activeSessionId: null }),
      importSessions: (sessions) => {
        const valid = sessions.filter(
          (x) => x && typeof x.id === 'string' && Array.isArray(x.questions) && Array.isArray(x.answers),
        );
        if (valid.length === 0) return 0;
        set((s) => {
          const ids = new Set(s.sessions.map((x) => x.id));
          const merged = [...valid.filter((x) => !ids.has(x.id)), ...s.sessions];
          return { sessions: cap(merged, 50) };
        });
        return valid.length;
      },

      recordSolve: (question, options, imageName, result) => {
        const rec: SolveRecord = { id: uid('sol'), ts: Date.now(), question, options, imageName, result, userVerdict: null };
        if (get().settings.persistHistory) {
          set((s) => ({ solves: cap([rec, ...s.solves], 100) }));
        }
        get().pushActivity('solver', `Solved "${question.slice(0, 48)}${question.length > 48 ? '…' : ''}" → option ${result.bestIndex + 1} (${Math.round(result.confidence * 100)}%)`);
        return rec;
      },
      setVerdict: (id, verdict) =>
        set((s) => ({ solves: s.solves.map((r) => (r.id === id ? { ...r, userVerdict: verdict } : r)) })),
      clearSolves: () => set({ solves: [] }),

      pushActivity: (kind, message) =>
        set((s) => ({ activity: cap([{ id: uid('act'), ts: Date.now(), kind, message }, ...s.activity], 100) })),
      clearActivity: () => set({ activity: [] }),

      pushToast: (t) => {
        const id = uid('toast');
        set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-5) }));
        setTimeout(() => get().dismissToast(id), 4200);
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'kahoot-boss-store-v1',
      partialize: (s) => ({
        profile: s.profile,
        settings: s.settings,
        sessions: s.sessions,
        solves: s.solves,
        activity: s.activity,
      }),
    },
  ),
);

/* ---------- selectors ---------- */

export function sessionStats(ses: Session): { answered: number; correct: number; wrong: number; unanswered: number; accuracy: number | null } {
  const answered = ses.answers.filter((a) => a.correct !== null).length;
  const correct = ses.answers.filter((a) => a.correct === true).length;
  const wrong = ses.answers.filter((a) => a.correct === false).length;
  const unanswered = ses.answers.filter((a) => a.correct === null).length;
  return { answered, correct, wrong, unanswered, accuracy: answered > 0 ? correct / answered : null };
}

export function globalStats(sessions: Session[]): {
  totalSessions: number;
  totalAnswered: number;
  totalCorrect: number;
  accuracy: number | null;
  avgLatencyMs: number | null;
} {
  let answered = 0;
  let correct = 0;
  let latSum = 0;
  let latN = 0;
  for (const s of sessions) {
    for (const a of s.answers) {
      if (a.correct !== null) {
        answered++;
        if (a.correct) correct++;
      }
      latSum += a.latencyMs;
      latN++;
    }
  }
  return {
    totalSessions: sessions.length,
    totalAnswered: answered,
    totalCorrect: correct,
    accuracy: answered > 0 ? correct / answered : null,
    avgLatencyMs: latN > 0 ? latSum / latN : null,
  };
}
