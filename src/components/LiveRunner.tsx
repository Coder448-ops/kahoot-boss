/* KAHOOT BOSS — live game runner.
   Drives a REAL Kahoot session through the connector backend: lobby, live
   questions (metadata only — Kahoot shows question text on the host screen),
   operator-assisted solving, real answer submission, and genuine feedback
   (correct / points / rank / streak) reported by Kahoot itself. */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  History,
  Info,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Timer,
  Trophy,
  Unplug,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfidenceBar,
  Field,
  Input,
  Notice,
  OptionMarker,
  PageHeader,
  Slider,
  StatusDot,
  Textarea,
  Toggle,
} from '../components/ui';
import { useStore, sessionStats } from '../store/useStore';
import { liveApi, resolveLiveBase, LiveBackendError, type LiveEvent, type LiveSnapshot } from '../engine/liveClient';
import { methodLabel, solveLocal } from '../engine/solver';
import { solveViaApi } from '../engine/apiClient';
import { validateOptions, validateQuestionText } from '../lib/validation';
import type { Question, SolveResult, SolverMethod } from '../lib/types';
import { formatDateTime, formatMs, percent, timeAgo, uid } from '../lib/utils';

interface FeedItem {
  id: string;
  ts: number;
  tone: 'info' | 'good' | 'bad' | 'warn';
  text: string;
}

function playTone(freq: number, durMs: number): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
    setTimeout(() => ctx.close().catch(() => undefined), durMs + 100);
  } catch { /* audio unavailable */ }
}

const SHAPE_NAMES = ['Red ▲', 'Blue ◆', 'Yellow ●', 'Green ■'];

export default function LiveRunner() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const connection = useStore((s) => s.connection);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const startSession = useStore((s) => s.startSession);
  const recordSolve = useStore((s) => s.recordSolve);
  const appendLiveQuestion = useStore((s) => s.appendLiveQuestion);
  const updateLiveQuestion = useStore((s) => s.updateLiveQuestion);
  const upsertLiveAnswer = useStore((s) => s.upsertLiveAnswer);
  const appendSessionEvent = useStore((s) => s.appendSessionEvent);
  const advanceSession = useStore((s) => s.advanceSession);
  const finishSession = useStore((s) => s.finishSession);
  const updateControls = useStore((s) => s.updateActiveSessionControls);
  const setSessionError = useStore((s) => s.setSessionError);
  const pushToast = useStore((s) => s.pushToast);
  const pushActivity = useStore((s) => s.pushActivity);
  const setConnection = useStore((s) => s.setConnection);
  const disconnectStore = useStore((s) => s.disconnect);

  const base = React.useMemo(() => resolveLiveBase(settings.liveBackendUrl), [settings.liveBackendUrl]);
  const [snapshot, setSnapshot] = React.useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [streamBroken, setStreamBroken] = React.useState(false);
  const [feed, setFeed] = React.useState<FeedItem[]>([]);
  const [fatal, setFatal] = React.useState<{ title: string; body: string } | null>(null);
  const [finalScore, setFinalScore] = React.useState<{ total: number | null; rank: number | null } | null>(null);

  // Operator question input + solving
  const [qText, setQText] = React.useState('');
  const [qOptions, setQOptions] = React.useState<string[]>(['', '', '', '']);
  const [solving, setSolving] = React.useState(false);
  const [solveError, setSolveError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SolveResult | null>(null);
  const [pendingChoice, setPendingChoice] = React.useState<number | null>(null);
  const [pendingMethod, setPendingMethod] = React.useState<SolverMethod | 'manual'>('manual');
  const [pendingConf, setPendingConf] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [elapsedMs, setElapsedMs] = React.useState(0);

  // 2-step verification
  const [tfaSeq, setTfaSeq] = React.useState<string>('');
  const [tfaBusy, setTfaBusy] = React.useState(false);
  const [tfaError, setTfaError] = React.useState<string | null>(null);

  const sessionIdRef = React.useRef<string | null>(null);
  const snapshotRef = React.useRef<LiveSnapshot | null>(null);
  snapshotRef.current = snapshot;
  const autoTimerRef = React.useRef<number | null>(null);

  const liveSession = sessions.find((s) => s.id === activeSessionId && s.mode === 'live')
    ?? sessions.find((s) => s.mode === 'live' && (s.status === 'running' || s.status === 'paused')) ?? null;

  const pushFeed = React.useCallback((tone: FeedItem['tone'], text: string) => {
    setFeed((f) => [{ id: uid('lf'), ts: Date.now(), tone, text }, ...f].slice(0, 120));
  }, []);

  const logSession = React.useCallback((type: 'info' | 'answer' | 'error' | 'system', message: string) => {
    const id = sessionIdRef.current;
    if (id) appendSessionEvent(id, type, message);
  }, [appendSessionEvent]);

  /* ---------- ensure a session record exists ---------- */
  React.useEffect(() => {
    const st = useStore.getState();
    // One automation target at a time: park any running simulation while live.
    for (const sim of st.sessions.filter((s) => s.mode === 'simulation' && (s.status === 'running' || s.status === 'paused'))) {
      st.finishSession(sim.id, 'stopped');
      st.pushActivity('session', `Simulation session parked — live game took over (PIN ${sim.pin}).`);
    }
    const existing = st.sessions.find(
      (s) => s.mode === 'live' && (s.status === 'running' || s.status === 'paused') && s.pin === st.connection.pin,
    );
    if (existing) {
      sessionIdRef.current = existing.id;
      return;
    }
    const created = st.startSession({
      pin: st.connection.pin,
      nickname: st.connection.nickname,
      mode: 'live',
      questions: [],
      autoAnswer: st.settings.autoAnswer,
      answerDelayMs: st.settings.answerDelayMs,
      confidenceThreshold: st.settings.confidenceThreshold,
    });
    sessionIdRef.current = created.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- status + event stream ---------- */
  const refreshStatus = React.useCallback(async () => {
    try {
      const { data } = await liveApi.status(base, 8000);
      setSnapshot(data.snapshot);
      setLoadError(null);
      return data.snapshot;
    } catch (e) {
      const err = e as LiveBackendError;
      setLoadError(err.message);
      return null;
    }
  }, [base]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshStatus().then((snap) => {
      if (cancelled) return;
      setLoading(false);
      if (snap) {
        pushFeed('info', `Attached to live session (state: ${snap.state}).`);
        if (snap.state === 'idle' || snap.state === 'closed' || snap.state === 'failed') {
          setFatal({
            title: 'No live session on the connector',
            body: 'The connector reports no active game. The join may have expired — reconnect to start a fresh live session.',
          });
        }
      }
    });

    const off = liveApi.subscribe(
      base,
      (e) => handleLiveEvent(e),
      () => setStreamBroken(true),
    );
    return () => {
      cancelled = true;
      off();
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const qidFor = (pin: string, index: number): string => `live-${pin}-${index}`;

  const handleLiveEvent = (e: LiveEvent): void => {
    const snap = snapshotRef.current;
    const sid = sessionIdRef.current;
    switch (e.type) {
      case 'state':
        setSnapshot((s) => (s ? { ...s, state: e.state } : s));
        break;
      case 'joined':
        setSnapshot((s) => (s ? { ...s, state: 'lobby', pin: e.pin, nickname: e.nickname, quizName: e.quizName ?? s.quizName, twoFactor: e.twoFactor } : s));
        pushFeed('good', `Joined lobby as "${e.nickname}"${e.namerator ? ' (host enforces name generator — custom name accepted)' : ''}.`);
        logSession('system', `Joined live lobby as "${e.nickname}".`);
        pushActivity('session', `Live lobby joined · PIN ${e.pin} · ${e.nickname}`);
        break;
      case 'twoFactorRequired':
        setSnapshot((s) => (s ? { ...s, state: 'awaitingTwoFactor' } : s));
        pushFeed('warn', 'Host requires 2-step verification — enter the pattern from the host screen.');
        pushToast({ title: '2-step verification required', body: 'Tap the shapes in host-screen order.', tone: 'warn' });
        break;
      case 'twoFactorResult':
        pushFeed(e.ok ? 'good' : 'bad', e.ok ? 'Verification accepted — entering lobby.' : 'Pattern rejected — wait for the next pattern and retry.');
        if (!e.ok) setTfaError('Pattern rejected by Kahoot. Wait for a fresh pattern on the host screen and try again.');
        else {
          setTfaSeq('');
          setTfaError(null);
        }
        break;
      case 'quizStart':
        setSnapshot((s) => (s ? { ...s, quizName: e.quizName ?? s.quizName, questionCount: e.questionCount ?? s.questionCount, choiceCounts: e.choiceCounts } : s));
        pushFeed('good', `Quiz started${e.quizName ? `: "${e.quizName}"` : ''}${e.questionCount ? ` · ${e.questionCount} questions` : ''}.`);
        logSession('system', `Quiz started${e.quizName ? ` — "${e.quizName}"` : ''}.`);
        break;
      case 'question': {
        setSnapshot((s) => (s ? {
          ...s,
          state: 'question',
          current: { index: e.index, gameType: e.gameType, choices: e.choices, choicesKnown: e.choicesKnown, answered: false, startedAt: Date.now() },
        } : s));
        setQText('');
        setQOptions(['', '', '', '']);
        setResult(null);
        setPendingChoice(null);
        setSolveError(null);
        setElapsedMs(0);
        const pin = snap?.pin ?? '';
        if (sid) {
          const placeholder: Question = {
            id: qidFor(pin, e.index),
            text: `Live question #${e.index + 1} (${e.gameType})`,
            options: [],
            correctIndex: -1,
            explanation: 'Question text is shown on the host screen — enter it above to let the solver assist.',
            category: e.gameType,
            kind: 'text',
            timeLimitSec: 0,
          };
          appendLiveQuestion(sid, placeholder);
          logSession('info', `Q${e.index + 1} started (${e.gameType}${e.choicesKnown ? `, ${e.choices} choices` : ', choice count not disclosed'}). Enter the question from the host screen.`);
        }
        pushFeed('info', `Question ${e.index + 1} live (${e.gameType}${e.choicesKnown ? `, ${e.choices} choices` : ''}).`);
        break;
      }
      case 'answerAck':
        pushFeed('good', `Q${e.index + 1}: answer received by Kahoot.`);
        break;
      case 'feedback': {
        setSnapshot((s) => (s && s.current ? { ...s, state: 'lobby', current: { ...s.current, answered: true } } : (s ? { ...s, state: 'lobby' } : s)));
        if (sid && snap) {
          const qid = qidFor(snap.pin ?? '', e.index);
          const prev = useStore.getState().sessions.find((x) => x.id === sid)?.answers.find((a) => a.questionId === qid);
          upsertLiveAnswer(sid, {
            questionId: qid,
            questionText: prev?.questionText ?? `Live question #${e.index + 1}`,
            category: prev?.category ?? snap.current?.gameType ?? 'live',
            options: prev?.options ?? [],
            pickedIndex: prev?.pickedIndex ?? null,
            correctIndex: e.correct === true && prev?.pickedIndex !== null && prev?.pickedIndex !== undefined ? prev.pickedIndex : -1,
            correct: e.correct,
            timedOut: false,
            method: prev?.method ?? 'manual',
            confidence: prev?.confidence ?? null,
            latencyMs: prev?.latencyMs ?? 0,
            points: e.points,
            rank: e.rank,
            streak: e.streak,
          });
          advanceSession(sid);
        }
        if (settings.soundEnabled) playTone(e.correct === true ? 880 : 220, e.correct === true ? 180 : 260);
        pushFeed(
          e.correct === true ? 'good' : e.correct === false ? 'bad' : 'warn',
          e.correct === true
            ? `Q${e.index + 1} CORRECT ✓ +${e.points ?? '?'} pts · total ${e.totalScore ?? '?'} · rank #${e.rank ?? '?'}` + (e.streak ? ` · streak ×${e.streak}` : '')
            : e.correct === false
              ? `Q${e.index + 1} wrong ✗ · total ${e.totalScore ?? '?'} · rank #${e.rank ?? '?'}`
              : `Q${e.index + 1} result unclear — Kahoot sent no verdict.`,
        );
        logSession('answer', `Q${e.index + 1}: ${e.correct === true ? 'CORRECT' : e.correct === false ? 'WRONG' : 'UNKNOWN'} (${e.points ?? 0} pts, rank ${e.rank ?? '?'}, streak ${e.streak ?? 0}).`);
        break;
      }
      case 'timeUp': {
        if (sid && snap?.current && !snap.current.answered) {
          const qid = qidFor(snap.pin ?? '', snap.current.index);
          upsertLiveAnswer(sid, {
            questionId: qid,
            questionText: `Live question #${snap.current.index + 1}`,
            category: snap.current.gameType,
            options: [],
            pickedIndex: null,
            correctIndex: -1,
            correct: null,
            timedOut: true,
            method: 'manual',
            confidence: null,
            latencyMs: Date.now() - snap.current.startedAt,
          });
          advanceSession(sid);
          logSession('error', `Q${snap.current.index + 1}: time expired with no answer submitted.`);
        }
        setSnapshot((s) => (s ? { ...s, state: 'lobby' } : s));
        pushFeed('warn', `Time up${e.index !== null ? ` on Q${e.index + 1}` : ''}.`);
        break;
      }
      case 'gameOver':
        setFinalScore({ total: e.totalScore, rank: e.rank });
        setSnapshot((s) => (s ? { ...s, state: 'ended' } : s));
        if (sid) {
          finishSession(sid, 'completed');
          logSession('system', `Game over — final score ${e.totalScore ?? '?'} · rank #${e.rank ?? '?'} (reported by Kahoot).`);
        }
        pushFeed('good', `Game over — final score ${e.totalScore ?? '?'} · rank #${e.rank ?? '?'}.`);
        pushToast({ title: 'Live game finished', body: `Score ${e.totalScore ?? '?'} · rank #${e.rank ?? '?'}`, tone: 'success' });
        break;
      case 'podium':
        pushFeed('info', 'Podium announced by host.');
        break;
      case 'kicked':
        if (sid) {
          setSessionError(sid, e.reason);
          finishSession(sid, 'stopped');
        }
        setFatal({ title: 'Removed from the game', body: e.reason });
        pushToast({ title: 'Removed from game', body: e.reason, tone: 'error' });
        break;
      case 'left':
      case 'closed': {
        const unexpected = e.type === 'closed' && e.unexpected;
        if (sid) {
          const sess = useStore.getState().sessions.find((x) => x.id === sid);
          if (sess && (sess.status === 'running' || sess.status === 'paused')) finishSession(sid, 'stopped');
        }
        if (unexpected) {
          setFatal({ title: 'Live connection lost', body: e.type === 'closed' ? `The game channel closed unexpectedly (${e.reason || 'no reason given'}). Reconnect to rejoin — note Kahoot usually cannot rejoin mid-game.` : 'Session ended.' });
        } else {
          setFatal({ title: 'Live session ended', body: 'The connector session is closed. Reconnect to join a new game.' });
        }
        break;
      }
      case 'error':
        pushFeed('bad', `Server: ${e.message}`);
        if (sid) setSessionError(sid, e.message);
        break;
    }
  };

  /* ---------- elapsed ticker (honest stopwatch — Kahoot exposes no host timer) ---------- */
  React.useEffect(() => {
    if (snapshot?.state !== 'question' || !snapshot.current) return;
    const started = snapshot.current.startedAt;
    const t = setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => clearInterval(t);
  }, [snapshot?.state, snapshot?.current?.startedAt, snapshot?.current?.index]);

  /* ---------- auto-submit when armed ---------- */
  const autoArmed = !!liveSession?.autoAnswer && pendingChoice !== null && snapshot?.state === 'question' && !snapshot.current?.answered;
  React.useEffect(() => {
    if (!autoArmed || pendingChoice === null || !liveSession) return;
    const delay = Math.max(300, liveSession.answerDelayMs);
    autoTimerRef.current = window.setTimeout(() => {
      void submitChoice(pendingChoice, 'auto');
    }, delay);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoArmed, pendingChoice]);

  /* ---------- actions ---------- */
  const choiceCount = snapshot?.current?.choices ?? 4;
  const choicesKnown = snapshot?.current?.choicesKnown ?? false;
  const visibleOptions = qOptions.slice(0, Math.min(4, Math.max(2, choiceCount)));

  const handleSolve = async (): Promise<void> => {
    const filled = visibleOptions.map((o) => o.trim());
    const qCheck = validateQuestionText(qText);
    const oCheck = validateOptions(filled.filter(Boolean));
    if (!qCheck.ok || !oCheck.ok) {
      setSolveError(qCheck.error ?? oCheck.error ?? 'Invalid input.');
      return;
    }
    const sid = sessionIdRef.current;
    const snap = snapshotRef.current;
    if (!sid || !snap?.current) return;
    // Persist the operator-provided question for history.
    updateLiveQuestion(sid, qidFor(snap.pin ?? '', snap.current.index), { text: qText.trim(), options: filled.filter(Boolean) });

    setSolving(true);
    setSolveError(null);
    try {
      let r: SolveResult;
      if (settings.solverMode === 'api') {
        const { data } = await solveViaApi({ question: qText.trim(), options: filled.filter(Boolean), baseUrl: settings.apiBaseUrl, model: settings.apiModel, apiKey: settings.apiKey });
        const started = performance.now();
        r = {
          bestIndex: data.bestIndex,
          confidence: data.confidence,
          explanation: data.explanation,
          method: 'api',
          language: 'English',
          languageCode: 'en',
          scores: filled.filter(Boolean).map((_, i) => (i === data.bestIndex ? data.confidence : 0.1)),
          reasoning: [`Cloud model "${data.model}" solved this live question.`],
          latencyMs: performance.now() - started,
          viaApi: true,
        };
      } else {
        await new Promise((rr) => setTimeout(rr, 60));
        r = solveLocal({ question: qText.trim(), options: filled.filter(Boolean) });
      }
      setResult(r);
      recordSolve(qText.trim(), filled.filter(Boolean), null, r);
      if (liveSession && r.confidence < liveSession.confidenceThreshold) {
        setPendingChoice(null);
        pushFeed('warn', `Solver confidence ${percent(r.confidence)} is below threshold ${percent(liveSession.confidenceThreshold)} — pick manually.`);
        logSession('error', `Solver below confidence threshold (${percent(r.confidence)} < ${percent(liveSession.confidenceThreshold)}) — auto-submit skipped.`);
      } else {
        setPendingChoice(r.bestIndex);
        setPendingMethod(r.method);
        setPendingConf(r.confidence);
        pushFeed('info', `Solver recommends option ${r.bestIndex + 1} at ${percent(r.confidence)} (${methodLabel(r.method)}).`);
      }
    } catch (e) {
      setSolveError(e instanceof Error ? e.message : 'Solving failed.');
    } finally {
      setSolving(false);
    }
  };

  const submitChoice = async (choice: number, origin: 'auto' | 'manual' | 'quick'): Promise<void> => {
    const snap = snapshotRef.current;
    const sid = sessionIdRef.current;
    if (!snap?.current || snap.current.answered || submitting) return;
    setSubmitting(true);
    try {
      await liveApi.answer(base, choice, 10000);
      if (sid) {
        upsertLiveAnswer(sid, {
          questionId: qidFor(snap.pin ?? '', snap.current.index),
          questionText: qText.trim() || `Live question #${snap.current.index + 1}`,
          category: snap.current.gameType,
          options: visibleOptions.map((o, i) => o.trim() || `Choice ${i + 1}`),
          pickedIndex: choice,
          correctIndex: -1, // Kahoot never discloses the correct index — only our verdict
          correct: null,
          timedOut: false,
          method: origin === 'manual' || origin === 'quick' ? 'manual' : pendingMethod,
          confidence: origin === 'manual' || origin === 'quick' ? null : pendingConf,
          latencyMs: Date.now() - snap.current.startedAt,
        });
        logSession('answer', `Q${snap.current.index + 1}: submitted option ${choice + 1} (${origin}). Awaiting Kahoot's verdict…`);
      }
      setSnapshot((s) => (s && s.current ? { ...s, current: { ...s.current, answered: true } } : s));
      setPendingChoice(null);
      pushFeed('info', `Option ${choice + 1} submitted (${origin}) — waiting for Kahoot's verdict.`);
    } catch (e) {
      const err = e as LiveBackendError;
      pushFeed('bad', `Submit failed: ${err.message}`);
      if (sid) setSessionError(sid, `Submit failed: ${err.message}`);
      pushToast({ title: 'Submit failed', body: err.message, tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTwoFactor = async (): Promise<void> => {
    if (!/^[0-3]{4}$/.test(tfaSeq)) {
      setTfaError('Enter exactly 4 shapes in host-screen order.');
      return;
    }
    setTfaBusy(true);
    setTfaError(null);
    try {
      const { data } = await liveApi.twoFactor(base, tfaSeq, 25000);
      if (!data.ok) {
        setTfaError('Pattern rejected by Kahoot. Wait for a fresh pattern and retry.');
        setTfaSeq('');
      } else {
        setTfaSeq('');
      }
      await refreshStatus();
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Verification failed.');
    } finally {
      setTfaBusy(false);
    }
  };

  const handleLeave = async (): Promise<void> => {
    try {
      await liveApi.leave(base, 6000);
    } catch { /* best effort */ }
    const sid = sessionIdRef.current;
    if (sid) {
      const sess = useStore.getState().sessions.find((x) => x.id === sid);
      if (sess && (sess.status === 'running' || sess.status === 'paused')) finishSession(sid, 'stopped');
    }
    disconnectStore('Left live game.');
    setConnection({ status: 'disconnected', pin: '', nickname: '', mode: null, detail: 'Not connected. Enter a Game PIN to begin.', latencyMs: null, connectedAt: null, lastError: null });
    pushActivity('connection', 'Left live game.');
    navigate('/connect');
  };

  /* ================= RENDER ================= */
  const stats = liveSession ? sessionStats(liveSession) : null;

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/80 px-5 py-8">
        <Loader2 size={20} className="animate-spin-slow text-accent" />
        <p className="text-sm text-muted">Attaching to the live connector session…</p>
      </div>
    );
  }

  if (loadError && !snapshot) {
    return (
      <Card>
        <CardBody>
          <Notice
            tone="error"
            title="Cannot reach the live connector"
            body={loadError}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setLoading(true); refreshStatus().then(() => setLoading(false)); }}><RefreshCw size={14} /> Retry</Button>
                <Button size="sm" variant="ghost" onClick={handleLeave}>Back to connection</Button>
              </div>
            }
          />
        </CardBody>
      </Card>
    );
  }

  if (fatal) {
    return (
      <Card>
        <CardBody>
          <Notice
            tone={fatal.title === 'Live session ended' ? 'info' : 'warn'}
            title={fatal.title}
            body={fatal.body}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => navigate('/history')}><History size={14} /> View recorded session</Button>
                <Button size="sm" variant="primary" onClick={handleLeave}>Back to connection</Button>
              </div>
            }
          />
          {liveSession && stats && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Correct', stats.correct], ['Wrong', stats.wrong], ['Unanswered', stats.unanswered], ['Accuracy', stats.accuracy !== null ? percent(stats.accuracy) : '—']].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-line bg-void/50 p-3 text-center">
                  <p className="font-display text-xl font-bold text-ink">{v}</p>
                  <p className="text-[11px] uppercase tracking-wider text-muted">{k}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  const state = snapshot?.state ?? 'unknown';
  const current = snapshot?.current ?? null;

  return (
    <div>
      <PageHeader
        title="Live game session"
        subtitle={`PIN ${snapshot?.pin ?? connection.pin} · ${snapshot?.nickname ?? connection.nickname}${snapshot?.quizName ? ` · "${snapshot.quizName}"` : ''}`}
        right={
          <>
            <Button variant="ghost" size="sm" onClick={() => refreshStatus()} title="Refresh connector status"><RefreshCw size={15} /></Button>
            <Button variant="danger" size="sm" onClick={handleLeave}><Unplug size={15} /> Leave game</Button>
          </>
        }
      />

      {streamBroken && (
        <div className="mb-4">
          <Notice tone="warn" title="Event stream interrupted" body="Live updates may be delayed. The game connection itself is unaffected — press refresh to re-sync." action={<Button size="sm" variant="secondary" onClick={() => { setStreamBroken(false); refreshStatus(); }}>Re-sync now</Button>} />
        </div>
      )}

      {/* status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={state === 'question' ? 'cyan' : state === 'lobby' ? 'good' : state === 'awaitingTwoFactor' ? 'warn' : state === 'ended' ? 'muted' : 'accent'}>
          <StatusDot tone={state === 'question' ? 'live' : state === 'lobby' ? 'good' : state === 'awaitingTwoFactor' ? 'warn' : 'idle'} pulse={state === 'question'} />
          {state === 'question' ? 'QUESTION LIVE' : state.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}
        </Badge>
        {snapshot?.questionCount ? <Badge tone="muted">{liveSession?.answers.length ?? 0}/{snapshot.questionCount} answered</Badge> : null}
        {snapshot && snapshot.lastRttMs > 0 && <Badge tone="muted">link {formatMs(snapshot.lastRttMs)}</Badge>}
        {stats && stats.accuracy !== null && <Badge tone="good">{percent(stats.accuracy)} so far</Badge>}
      </div>

      {/* 2-step verification */}
      {state === 'awaitingTwoFactor' && (
        <Card glow className="mb-4">
          <CardHeader title="2-step verification" subtitle="The host requires the shape pattern from the host screen. It refreshes about every 10 seconds." />
          <CardBody>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-void/60">
                  {tfaSeq[i] !== undefined ? <OptionMarker index={Number(tfaSeq[i])} size={26} /> : <span className="font-mono text-muted">·</span>}
                </span>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setTfaSeq((s) => s.slice(0, -1))} disabled={tfaSeq.length === 0}>⌫</Button>
              <Button variant="ghost" size="sm" onClick={() => setTfaSeq('')} disabled={tfaSeq.length === 0}>Clear</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <button
                  key={i}
                  disabled={tfaSeq.length >= 4 || tfaBusy}
                  onClick={() => setTfaSeq((s) => (s.length < 4 ? s + i : s))}
                  className="flex items-center gap-2 rounded-xl border border-line bg-void/50 px-3.5 py-2.5 text-sm transition hover:border-accent/60 disabled:opacity-40"
                >
                  <OptionMarker index={i} size={24} /> {SHAPE_NAMES[i]}
                </button>
              ))}
            </div>
            {tfaError && <p className="mt-2.5 text-[13px] text-bad">{tfaError}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="primary" loading={tfaBusy} disabled={tfaSeq.length !== 4} onClick={handleTwoFactor}><ShieldAlert size={16} /> Submit pattern</Button>
              <Button variant="ghost" onClick={handleLeave}>Cancel & leave</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* lobby */}
      {state === 'lobby' && !finalScore && (
        <Card className="mb-4">
          <CardBody className="flex items-center gap-4 py-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel3">
              <Loader2 size={22} className="animate-spin-slow text-accent2" />
            </span>
            <div>
              <p className="font-display text-[15px] font-semibold text-ink">In lobby — waiting for the host{snapshot?.quizName ? ` · "${snapshot.quizName}"` : ''}</p>
              <p className="mt-0.5 text-[13px] text-muted">Your seat is held. Questions appear here the moment the host starts them — keep the host screen visible.</p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* live question */}
      {state === 'question' && current && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="flex flex-col gap-4 xl:col-span-3">
            <Card glow>
              <CardBody>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="cyan">Q{current.index + 1}{snapshot?.questionCount ? ` of ${snapshot.questionCount}` : ''}</Badge>
                  <Badge tone="muted">{current.gameType}</Badge>
                  {current.choicesKnown && current.choices !== null ? (
                    <Badge tone="muted">{current.choices} choices</Badge>
                  ) : (
                    <Badge tone="warn">choice count undisclosed</Badge>
                  )}
                  {current.answered ? <Badge tone="good"><Check size={12} /> answer locked</Badge> : null}
                  <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-sm text-muted">
                    <Timer size={15} /> elapsed {(elapsedMs / 1000).toFixed(1)}s
                  </span>
                </div>

                {current.gameType !== 'quiz' && current.gameType !== 'true_false' && (
                  <div className="mt-3">
                    <Notice tone="warn" title={`Block type "${current.gameType}"`} body="This build submits single-choice answers. Watch the host screen and use quick-pick if the format differs." />
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-line bg-void/40 p-4">
                  <p className="text-[13px] font-medium text-ink/90">What does the host screen show?</p>
                  <p className="mt-0.5 text-xs text-muted">Kahoot sends players timing only — type the question + options to let the AI solve, or quick-pick a shape.</p>
                  <Textarea className="mt-2.5 min-h-[64px]" placeholder="Question text from the host screen…" value={qText} onChange={(e) => setQText(e.target.value)} disabled={current.answered} />
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {visibleOptions.map((o, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <OptionMarker index={i} size={30} />
                        <Input placeholder={`Option ${i + 1} (${SHAPE_NAMES[i] ?? ''})`} value={o} maxLength={120} onChange={(e) => setQOptions((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))} disabled={current.answered} />
                      </div>
                    ))}
                  </div>
                  {solveError && <p className="mt-2 text-[13px] text-bad">{solveError}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" loading={solving} disabled={current.answered} onClick={handleSolve}>
                      <Sparkles size={15} /> Solve{liveSession?.autoAnswer ? ' & queue auto-submit' : ''}
                    </Button>
                    {result && pendingChoice !== null && !current.answered && (
                      <Button variant="secondary" size="sm" loading={submitting} onClick={() => submitChoice(pendingChoice, 'manual')}>
                        <Send size={14} /> Submit option {pendingChoice + 1} now
                      </Button>
                    )}
                  </div>
                  {result && (
                    <div className="mt-3 animate-fade-up rounded-xl border border-line bg-void/50 p-3.5">
                      <ConfidenceBar value={result.confidence} />
                      <p className="mt-2 text-sm text-ink/90">
                        Recommends <strong>option {result.bestIndex + 1}</strong> — {result.explanation}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted">{methodLabel(result.method)} · {formatMs(result.latencyMs)}{autoArmed ? ` · auto-submit in ${((liveSession?.answerDelayMs ?? 0) / 1000).toFixed(1)}s` : ''}</p>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-medium text-ink/90">Quick-pick {current.answered ? '(locked)' : ''}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Array.from({ length: Math.min(4, Math.max(2, choiceCount)) }).map((_, i) => (
                      <button
                        key={i}
                        disabled={current.answered || submitting}
                        onClick={() => submitChoice(i, 'quick')}
                        className="flex items-center justify-center gap-2 rounded-xl border border-line bg-void/50 px-3 py-3 transition hover:scale-[1.02] hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <OptionMarker index={i} size={28} />
                        <span className="text-sm font-semibold text-ink">{i + 1}</span>
                      </button>
                    ))}
                  </div>
                  {!choicesKnown && <p className="mt-2 text-xs text-muted">Choice count was not disclosed for this question — 4 shapes shown; ignore extras if the host shows fewer.</p>}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-col gap-4 xl:col-span-2">
            <Card>
              <CardHeader title="Answering" subtitle="Live controls for this question." />
              <CardBody className="space-y-3">
                <Toggle
                  checked={!!liveSession?.autoAnswer}
                  onChange={(v) => { updateControls({ autoAnswer: v }); if (liveSession) logSession('system', `Auto-submit ${v ? 'enabled' : 'disabled'}.`); }}
                  label="Auto-submit solver answers"
                  hint="Submits queued solutions after the delay below."
                />
                <Field label={`Submit delay: ${((liveSession?.answerDelayMs ?? 2500) / 1000).toFixed(1)}s`}>
                  <Slider value={liveSession?.answerDelayMs ?? 2500} min={500} max={10000} step={500} onChange={(v) => updateControls({ answerDelayMs: v })} />
                </Field>
                <Field label={`Confidence threshold: ${Math.round((liveSession?.confidenceThreshold ?? 0.4) * 100)}%`}>
                  <Slider value={Math.round((liveSession?.confidenceThreshold ?? 0.4) * 100)} min={0} max={90} step={5} onChange={(v) => updateControls({ confidenceThreshold: v / 100 })} />
                </Field>
                <p className="rounded-lg border border-line bg-void/50 px-3 py-2 text-xs leading-relaxed text-muted">
                  Auto-submit only fires for solver-backed answers above threshold. Without operator input there is nothing to submit — the platform never guesses blindly on live games.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Scoreboard" subtitle="Reported by Kahoot — never computed locally." />
              <CardBody>
                {stats ? (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[['Correct', stats.correct], ['Wrong', stats.wrong], ['No answer', stats.unanswered]].map(([k, v]) => (
                      <div key={k as string} className="rounded-xl border border-line bg-void/50 p-2.5">
                        <p className="font-display text-lg font-bold text-ink">{v}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">No answers yet.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* game over */}
      {state === 'ended' && (
        <Card glow className="mb-4">
          <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-card">
              <Trophy size={26} className="text-white" />
            </span>
            <div className="flex-1">
              <p className="font-display text-lg font-bold text-ink">Game over — {finalScore ? `score ${finalScore.total ?? '?'} · rank #${finalScore.rank ?? '?'}` : 'results incoming'}</p>
              <p className="mt-0.5 text-[13px] text-muted">Final standings as reported by Kahoot. The full record is saved in Session History.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/history')}><History size={14} /> History</Button>
              <Button variant="primary" size="sm" onClick={handleLeave}>Leave game</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* connecting / transitional */}
      {['idle', 'reserving', 'solving', 'connecting', 'loggingIn'].includes(state) && (
        <Card className="mb-4">
          <CardBody className="flex items-center gap-3">
            <Loader2 size={18} className="animate-spin-slow text-accent" />
            <p className="text-sm text-muted">Establishing live session ({state})…</p>
          </CardBody>
        </Card>
      )}

      {/* live event feed */}
      <Card className="mt-4">
        <CardHeader title="Live event feed" subtitle="Every message from the game channel, as it arrives." />
        <CardBody>
          {feed.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-muted">Listening…</p>
          ) : (
            <ul className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
              {feed.map((f) => (
                <li key={f.id} className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-void/40 px-3 py-2">
                  {f.tone === 'good' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" />
                    : f.tone === 'bad' ? <X size={14} className="mt-0.5 shrink-0 text-bad" />
                    : f.tone === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                    : <Info size={14} className="mt-0.5 shrink-0 text-muted" />}
                  <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink/90">{f.text}</p>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">{timeAgo(f.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <Bot size={14} className="mt-0.5 shrink-0" />
        <span>
          How live mode works: your connector joined this game for real (PIN {snapshot?.pin}). Kahoot streams timing events only — the question itself stays on the host screen.
          Type what you see, let the solver rank the options, then submit through the same channel. Correctness, points and rank come back from Kahoot untouched.
          Started {liveSession ? formatDateTime(liveSession.startedAt) : '—'}.
        </span>
      </p>
    </div>
  );
}
