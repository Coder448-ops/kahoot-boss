/* KAHOOT BOSS — Automation Center: real session runner with live timers */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  History,
  Info,
  Pause,
  Play,
  Radio,
  SkipForward,
  Square,
  Timer,
  Volume2,
  VolumeX,
  X,
  Zap,
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
  ProgressBar,
  Select,
  Slider,
  StatusDot,
  Toggle,
} from '../components/ui';
import { useStore, sessionStats } from '../store/useStore';
import { useConnect } from '../hooks/useConnect';
import LiveRunner from '../components/LiveRunner';
import { liveApi, resolveLiveBase, type LiveHealth } from '../engine/liveClient';
import { buildSessionQuestions, getQuestionBankSize } from '../engine/simulation';
import { methodLabel, solveLocal } from '../engine/solver';
import { solveViaApi, checkHealth } from '../engine/apiClient';
import { trySolveNeural } from '../engine/neuralSolver';
import { solverSelfTest } from '../engine/solver';
import { validateNickname, validatePin } from '../lib/validation';
import type { Session, SolveResult } from '../lib/types';
import { formatDateTime, formatDuration, formatMs, percent } from '../lib/utils';

function beep(freq: number, durMs: number): void {
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
  } catch {
    /* audio unavailable — non-fatal */
  }
}

export default function Automation() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const connection = useStore((s) => s.connection);
  const setConnection = useStore((s) => s.setConnection);
  const startSession = useStore((s) => s.startSession);
  const recordAnswer = useStore((s) => s.recordAnswer);
  const advanceSession = useStore((s) => s.advanceSession);
  const setSessionStatus = useStore((s) => s.setSessionStatus);
  const setSessionError = useStore((s) => s.setSessionError);
  const appendSessionEvent = useStore((s) => s.appendSessionEvent);
  const updateControls = useStore((s) => s.updateActiveSessionControls);
  const finishSession = useStore((s) => s.finishSession);
  const pushToast = useStore((s) => s.pushToast);
  const pushActivity = useStore((s) => s.pushActivity);

  const active = sessions.find((s) => s.id === activeSessionId) ?? null;

  /* ---------- setup form ---------- */
  const [pin, setPin] = React.useState('');
  const [nickname, setNickname] = React.useState('');
  const [prefilled, setPrefilled] = React.useState(false);
  const [qCount, setQCount] = React.useState(settings.defaultQuestionCount);
  const [timeOverride, setTimeOverride] = React.useState<number | null>(null);
  const [autoAnswer, setAutoAnswer] = React.useState(settings.autoAnswer);
  const [delay, setDelay] = React.useState(settings.answerDelayMs);
  const [threshold, setThreshold] = React.useState(settings.confidenceThreshold);
  const [setupErrors, setSetupErrors] = React.useState<{ pin?: string; nickname?: string }>({});
  const [setupTab, setSetupTab] = React.useState<'simulation' | 'live'>('simulation');
  const [liveHealth, setLiveHealth] = React.useState<LiveHealth | null>(null);
  const [liveHealthLoading, setLiveHealthLoading] = React.useState(false);
  const [liveHealthError, setLiveHealthError] = React.useState<string | null>(null);
  const { connect: connectLive, busy: liveBusy } = useConnect();

  React.useEffect(() => {
    if (!prefilled) {
      setPin(connection.pin || '');
      setNickname(connection.nickname || 'Player-1');
      setPrefilled(true);
    }
  }, [connection.pin, connection.nickname, prefilled]);

  /* ---------- live runner ---------- */
  const qIndex = active?.currentIndex ?? 0;
  const question = active && qIndex < active.questions.length ? active.questions[qIndex] : null;
  const [remainingMs, setRemainingMs] = React.useState(0);
  const [totalMs, setTotalMs] = React.useState(1);
  const [insight, setInsight] = React.useState<SolveResult | null>(null);
  const [insightLoading, setInsightLoading] = React.useState(false);
  const [reveal, setReveal] = React.useState<{ picked: number | null; correct: number } | null>(null);
  const [lastSummary, setLastSummary] = React.useState<Session | null>(null);
  const [quickChecks, setQuickChecks] = React.useState<string[] | null>(null);
  const [quickRunning, setQuickRunning] = React.useState(false);

  const deadlineRef = React.useRef(0);
  const remainingRef = React.useRef<number | null>(null);
  const answeredRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const autoTimerRef = React.useRef<number | null>(null);
  const advanceTimerRef = React.useRef<number | null>(null);
  const tickRef = React.useRef<number | null>(null);
  const pendingAutoRef = React.useRef(false);
  const stateRef = React.useRef({ active, question, qIndex });
  stateRef.current = { active, question, qIndex };

  const clearTimers = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
  };
  React.useEffect(() => clearTimers, []);

  const sound = settings.soundEnabled;

  const submitAnswer = React.useCallback(
    (pickedIndex: number | null, reason: 'auto' | 'manual' | 'timeout' | 'skipped') => {
      const { active: a, question: q } = stateRef.current;
      if (!a || !q) return;
      if (answeredRef.current === q.id) return;
      answeredRef.current = q.id;
      if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }

      const latencyMs = Date.now() - startedAtRef.current;
      const timedOut = reason === 'timeout';
      const correct = pickedIndex === null ? null : pickedIndex === q.correctIndex;
      const currentInsight = pendingInsightRef.current;

      recordAnswer(a.id, {
        questionId: q.id,
        questionText: q.text,
        category: q.category,
        options: q.options,
        pickedIndex,
        correctIndex: q.correctIndex,
        correct,
        timedOut,
        method: reason === 'manual' ? 'manual' : (currentInsight?.method ?? 'heuristic'),
        confidence: reason === 'manual' ? null : (currentInsight?.confidence ?? null),
        latencyMs,
      });

      if (sound) {
        if (correct === true) beep(880, 180);
        else if (correct === false) beep(220, 250);
        else beep(330, 200);
      }

      if (reason === 'timeout') {
        setSessionError(a.id, `Q${stateRef.current.qIndex + 1}: time expired with no answer.`);
        appendSessionEvent(a.id, 'error', `Q${stateRef.current.qIndex + 1} timed out after ${q.timeLimitSec}s — recorded as unanswered.`);
      } else if (reason === 'skipped') {
        appendSessionEvent(a.id, 'info', `Q${stateRef.current.qIndex + 1} skipped by operator.`);
      } else {
        const label = pickedIndex === null ? 'no answer' : `option ${pickedIndex + 1}`;
        appendSessionEvent(
          a.id,
          'answer',
          `Q${stateRef.current.qIndex + 1} answered ${label} (${reason}) in ${formatMs(latencyMs)} — ${correct ? 'CORRECT ✓' : 'WRONG ✗'}.`,
        );
        if (reason === 'auto' && currentInsight && currentInsight.confidence < a.confidenceThreshold) {
          appendSessionEvent(a.id, 'error', `Q${stateRef.current.qIndex + 1} confidence ${percent(currentInsight.confidence)} was below threshold ${percent(a.confidenceThreshold)} — answered anyway (best available).`);
        }
      }

      setReveal({ picked: pickedIndex, correct: q.correctIndex });
      setRemainingMs(0);

      advanceTimerRef.current = window.setTimeout(() => {
        const latest = stateRef.current.active;
        if (!latest) return;
        if (stateRef.current.qIndex >= latest.questions.length - 1) {
          const snap: Session = { ...latest, answers: [...latest.answers], status: 'completed', endedAt: Date.now() };
          // Pull the fresh answers array from the store for an accurate summary
          const fresh = useStore.getState().sessions.find((s) => s.id === latest.id);
          finishSession(latest.id, 'completed');
          appendSessionEvent(latest.id, 'system', 'Session completed — all questions processed.');
          setLastSummary(fresh ? { ...fresh, status: 'completed', endedAt: Date.now() } : snap);
          pushToast({ title: 'Session completed', body: `${latest.pin} · ${latest.answers.length + 1}/${latest.questions.length} questions processed`, tone: 'success' });
        } else {
          advanceSession(latest.id);
        }
      }, 1600);
    },
    [recordAnswer, appendSessionEvent, setSessionError, finishSession, advanceSession, pushToast, sound],
  );

  // Insight bridge so submitAnswer can read the latest solver output
  const pendingInsightRef = React.useRef<SolveResult | null>(null);
  React.useEffect(() => {
    pendingInsightRef.current = insight;
  }, [insight]);

  // When insight arrives and an auto-answer was deferred waiting for it, fire now.
  React.useEffect(() => {
    if (insight && pendingAutoRef.current && active && question && active.status === 'running' && answeredRef.current !== question.id) {
      pendingAutoRef.current = false;
      submitAnswer(insight.bestIndex, 'auto');
    }
  }, [insight, active, question, submitAnswer]);

  // Per-question lifecycle: timers, solver insight, auto-answer scheduling
  React.useEffect(() => {
    if (!active || !question || active.status !== 'running') {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    setReveal(null);
    setInsight(null);
    pendingInsightRef.current = null;
    pendingAutoRef.current = false;
    answeredRef.current = null;
    setInsightLoading(true);

    const limit = question.timeLimitSec * 1000;
    const resumeMs = remainingRef.current;
    remainingRef.current = null;
    const budget = resumeMs !== null && resumeMs > 0 ? resumeMs : limit;
    startedAtRef.current = Date.now() - (limit - budget); // keep latency honest across resume
    deadlineRef.current = Date.now() + budget;
    setTotalMs(limit);
    setRemainingMs(budget);

    // Real countdown tick
    tickRef.current = window.setInterval(() => {
      const left = deadlineRef.current - Date.now();
      if (left <= 0) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setRemainingMs(0);
        submitAnswer(null, 'timeout');
      } else {
        setRemainingMs(left);
      }
    }, 100);

    // Solver insight (local, or cloud when configured)
    let cancelled = false;
    (async () => {
      const st = useStore.getState().settings;
      try {
        if (st.solverMode === 'api') {
          try {
            const { data } = await solveViaApi({
              question: question.text,
              options: question.options,
              baseUrl: st.apiBaseUrl,
              model: st.apiModel,
              apiKey: st.apiKey,
              timeoutMs: Math.min(15000, Math.max(4000, budget - 1500)),
            });
            if (cancelled) return;
            const scores = question.options.map((_, i) => (i === data.bestIndex ? data.confidence : 0.1));
            const r: SolveResult = {
              bestIndex: data.bestIndex,
              confidence: data.confidence,
              explanation: data.explanation,
              method: 'api',
              language: 'English',
              languageCode: 'en',
              scores,
              reasoning: [`Cloud model "${data.model}" solved this question in ${formatMs(data.latencyMs)}.`],
              latencyMs: data.latencyMs,
              viaApi: true,
            };
            setInsight(r);
            pendingInsightRef.current = r;
          } catch (e) {
            if (cancelled) return;
            const msg = e instanceof Error ? e.message : 'Cloud solver failed';
            setSessionError(active.id, `Q${qIndex + 1}: cloud solver failed (${msg}) — fell back to local engine.`);
            appendSessionEvent(active.id, 'error', `Q${qIndex + 1}: cloud solver failed, used local engine instead.`);
            const r = solveLocal({ question: question.text, options: question.options });
            setInsight(r);
            pendingInsightRef.current = r;
          }
        } else if (st.solverMode === 'neural') {
          // On-device AI when loaded; otherwise local engine (model keeps loading in background).
          const nr = await trySolveNeural(question.text, question.options);
          if (cancelled) return;
          if (nr) {
            setInsight(nr);
            pendingInsightRef.current = nr;
          } else {
            appendSessionEvent(active.id, 'system', `Q${qIndex + 1}: on-device AI still loading — used local engine for this question.`);
            const r = solveLocal({ question: question.text, options: question.options });
            setInsight(r);
            pendingInsightRef.current = r;
          }
        } else {
          const r = solveLocal({ question: question.text, options: question.options });
          if (cancelled) return;
          setInsight(r);
          pendingInsightRef.current = r;
        }
      } finally {
        if (!cancelled) setInsightLoading(false);
      }
    })();

    // Auto-answer scheduling
    if (active.autoAnswer) {
      const wait = Math.min(active.answerDelayMs, Math.max(500, budget - 1200));
      autoTimerRef.current = window.setTimeout(() => {
        const cur = stateRef.current;
        if (!cur.active || !cur.question || cur.active.status !== 'running') return;
        if (answeredRef.current === cur.question.id) return;
        // Re-read fresh state: the operator may have disabled auto-answer mid-question.
        const fresh = useStore.getState().sessions.find((s) => s.id === cur.active!.id);
        if (!fresh || !fresh.autoAnswer) return;
        if (pendingInsightRef.current) {
          submitAnswer(pendingInsightRef.current.bestIndex, 'auto');
        } else {
          pendingAutoRef.current = true; // answer as soon as the solver resolves
        }
      }, wait);
    }

    return () => {
      cancelled = true;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, qIndex, active?.status]);

  /* ---------- actions ---------- */
  const checkConnector = async (): Promise<void> => {
    setLiveHealthLoading(true);
    setLiveHealthError(null);
    setLiveHealth(null);
    try {
      const { data } = await liveApi.health(resolveLiveBase(settings.liveBackendUrl), 9000);
      setLiveHealth(data);
    } catch (e) {
      setLiveHealthError(e instanceof Error ? e.message : 'Connector check failed.');
    } finally {
      setLiveHealthLoading(false);
    }
  };

  const handleLiveJoin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const pinCheck = validatePin(pin, 6);
    const nickCheck = validateNickname(nickname);
    setSetupErrors({ pin: pinCheck.error ?? undefined, nickname: nickCheck.error ?? undefined });
    if (!pinCheck.ok || !nickCheck.ok) return;
    await connectLive({ pin, nickname, mode: 'live' });
    // On success the connection flips to live-connected and <LiveRunner/> takes over.
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    const pinCheck = validatePin(pin);
    const nickCheck = validateNickname(nickname);
    setSetupErrors({ pin: pinCheck.error ?? undefined, nickname: nickCheck.error ?? undefined });
    if (!pinCheck.ok || !nickCheck.ok) return;

    const questions = buildSessionQuestions(qCount, timeOverride, Date.now());
    setConnection({
      status: 'connected',
      pin: pin.trim(),
      nickname: nickname.trim(),
      mode: 'simulation',
      detail: 'Test environment ready — session controlled from Automation Center.',
      latencyMs: null,
      connectedAt: Date.now(),
      lastError: null,
    });
    setLastSummary(null);
    startSession({
      pin: pin.trim(),
      nickname: nickname.trim(),
      mode: 'simulation',
      questions,
      autoAnswer,
      answerDelayMs: delay,
      confidenceThreshold: threshold,
    });
    pushToast({ title: 'Session started', body: `${questions.length} questions · ${autoAnswer ? 'auto-answer ON' : 'manual mode'}`, tone: 'success' });
  };

  const handlePause = () => {
    if (!active) return;
    remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
    clearTimers();
    setSessionStatus(active.id, 'paused');
    appendSessionEvent(active.id, 'system', `Paused by operator at Q${qIndex + 1} with ${formatMs(remainingRef.current)} left.`);
  };

  const handleResume = () => {
    if (!active) return;
    setSessionStatus(active.id, 'running');
    appendSessionEvent(active.id, 'system', 'Resumed by operator.');
  };

  const handleStop = () => {
    if (!active) return;
    clearTimers();
    const fresh = useStore.getState().sessions.find((s) => s.id === active.id);
    finishSession(active.id, 'stopped');
    appendSessionEvent(active.id, 'system', 'Stopped by operator.');
    setLastSummary(fresh ? { ...fresh, status: 'stopped', endedAt: Date.now() } : { ...active, status: 'stopped', endedAt: Date.now() });
    pushToast({ title: 'Session stopped', body: 'Progress was saved to history.', tone: 'info' });
    pushActivity('session', `Session stopped by operator · PIN ${active.pin}`);
  };

  const handleQuickChecks = async () => {
    setQuickRunning(true);
    const lines: string[] = [];
    const t = solverSelfTest();
    lines.push(t.passed ? `✓ AI engine self-test passed (${formatMs(t.latencyMs)})` : `✗ AI engine self-test FAILED: ${t.detail}`);
    try {
      const { data, latencyMs } = await checkHealth(5000);
      lines.push(`✓ Backend ${data.service} v${data.version} reachable (${formatMs(latencyMs)}, mode ${data.mode})`);
    } catch {
      lines.push('! Backend unreachable — running on local engine (sessions unaffected)');
    }
    lines.push(navigator.onLine ? '✓ Browser reports online' : '✗ Browser reports offline');
    setQuickChecks(lines);
    setQuickRunning(false);
  };

  /* ================= RENDER ================= */
  const liveConnected = connection.status === 'connected' && connection.mode === 'live';
  if (liveConnected) {
    return <LiveRunner />;
  }
  if (!active) {
    const summary = lastSummary;
    const sStats = summary ? sessionStats(summary) : null;
    return (
      <div>
        <PageHeader
          title="Automation Center"
          subtitle="Automate the simulation test environment — or join and play a real live game through the connector."
        />
        {summary && sStats && (
          <Card className="mb-4" glow>
            <CardHeader
              title={summary.status === 'completed' ? 'Session completed' : 'Session stopped'}
              subtitle={`PIN ${summary.pin} · ${summary.nickname} · ${formatDateTime(summary.startedAt)}${summary.endedAt ? ` · lasted ${formatDuration(summary.endedAt - summary.startedAt)}` : ''}`}
              right={<Badge tone={summary.status === 'completed' ? 'good' : 'muted'}>{summary.status}</Badge>}
            />
            <CardBody>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Correct', String(sStats.correct)],
                  ['Wrong', String(sStats.wrong)],
                  ['Unanswered', String(sStats.unanswered)],
                  ['Accuracy', sStats.accuracy !== null ? percent(sStats.accuracy) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-void/50 p-3 text-center">
                    <p className="font-display text-xl font-bold text-ink">{v}</p>
                    <p className="text-[11px] uppercase tracking-wider text-muted">{k}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => navigate('/history')}><History size={14} /> Open in history</Button>
                <Button size="sm" variant="ghost" onClick={() => setLastSummary(null)}>Dismiss</Button>
              </div>
            </CardBody>
          </Card>
        )}

        <div className="mb-4 flex gap-1 rounded-xl border border-line bg-panel/70 p-1" role="tablist" aria-label="Session type">
          <button
            role="tab"
            aria-selected={setupTab === 'simulation'}
            onClick={() => setSetupTab('simulation')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${setupTab === 'simulation' ? 'bg-accent/20 text-ink shadow-[inset_0_0_0_1px_rgba(139,92,246,0.4)]' : 'text-muted hover:text-ink'}`}
          >
            <FlaskConical size={16} /> Simulation
          </button>
          <button
            role="tab"
            aria-selected={setupTab === 'live'}
            onClick={() => setSetupTab('live')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${setupTab === 'live' ? 'bg-accent2/15 text-ink shadow-[inset_0_0_0_1px_rgba(6,182,212,0.4)]' : 'text-muted hover:text-ink'}`}
          >
            <Radio size={16} /> Live game
          </button>
        </div>

        {setupTab === 'simulation' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3" glow>
            <CardHeader title="New automated session" subtitle="Identity, question set and answering behavior." />
            <CardBody>
              <form onSubmit={handleStart} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Game PIN" error={setupErrors.pin}>
                    <Input mono inputMode="numeric" value={pin} maxLength={10} placeholder="482913" onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))} />
                  </Field>
                  <Field label="Player nickname" error={setupErrors.nickname}>
                    <Input value={nickname} maxLength={15} placeholder="Player-1" onChange={(e) => setNickname(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={`Questions: ${qCount}`} hint={`Practice bank holds ${getQuestionBankSize()} questions`}>
                    <Slider value={qCount} min={3} max={getQuestionBankSize()} step={1} onChange={setQCount} />
                  </Field>
                  <Field label="Time per question" hint="Override, or keep each question's default">
                    <Select value={timeOverride === null ? 'default' : String(timeOverride)} onChange={(e) => setTimeOverride(e.target.value === 'default' ? null : Number(e.target.value))}>
                      <option value="default">Per-question default</option>
                      <option value="10">10 seconds</option>
                      <option value="15">15 seconds</option>
                      <option value="20">20 seconds</option>
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds</option>
                    </Select>
                  </Field>
                </div>
                <div className="rounded-xl border border-line bg-void/40 p-4">
                  <Toggle checked={autoAnswer} onChange={setAutoAnswer} label="Automatic answer selection" hint="The AI engine answers each question after the delay below. Turn off to answer manually by clicking." />
                  <div className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 ${autoAnswer ? '' : 'pointer-events-none opacity-40'}`}>
                    <Field label={`Answer delay: ${(delay / 1000).toFixed(1)}s`} hint="Wait before auto-answering">
                      <Slider value={delay} min={500} max={10000} step={500} onChange={setDelay} disabled={!autoAnswer} />
                    </Field>
                    <Field label={`Confidence threshold: ${Math.round(threshold * 100)}%`} hint="Answers below this are flagged in the log">
                      <Slider value={Math.round(threshold * 100)} min={0} max={90} step={5} onChange={(v) => setThreshold(v / 100)} disabled={!autoAnswer} />
                    </Field>
                  </div>
                </div>
                <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto">
                  <Play size={17} /> Start automated session
                </Button>
              </form>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-4 xl:col-span-2">
            <Card>
              <CardHeader title="How it works" subtitle="Transparent by design" />
              <CardBody className="space-y-3 text-[13px] leading-relaxed text-muted">
                {[
                  'Questions come from the built-in practice bank — original content for the test environment, never Kahoot servers.',
                  'Each question runs a real countdown. Auto-answer uses the AI solver; manual mode lets you click.',
                  'Timeouts, low-confidence answers and solver errors are logged honestly — never hidden.',
                  'Everything is scored from actual responses and saved to Session History.',
                ].map((t, i) => (
                  <p key={i} className="flex gap-2.5"><ChevronRight size={15} className="mt-0.5 shrink-0 text-accent" />{t}</p>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
        ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3" glow>
            <CardHeader
              title="Join a real live game"
              subtitle="The connector performs a genuine join: reserve/session → challenge → CometD → login."
              right={
                liveHealth ? (
                  <Badge tone={liveHealth.kahootReachable ? 'good' : 'warn'}>
                    <StatusDot tone={liveHealth.kahootReachable ? 'good' : 'warn'} />
                    {liveHealth.kahootReachable ? 'Kahoot reachable' : 'Kahoot unreachable'}
                  </Badge>
                ) : undefined
              }
            />
            <CardBody>
              <form onSubmit={handleLiveJoin} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Game PIN" error={setupErrors.pin} hint="Live PINs are 6–10 digits">
                    <Input mono inputMode="numeric" value={pin} maxLength={10} placeholder="482913" onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))} />
                  </Field>
                  <Field label="Player nickname" error={setupErrors.nickname} hint="2–15 characters">
                    <Input value={nickname} maxLength={15} placeholder="Player-1" onChange={(e) => setNickname(e.target.value)} />
                  </Field>
                </div>
                <div className="rounded-xl border border-line bg-void/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-medium text-ink/90">Connector: <span className="font-mono">{resolveLiveBase(settings.liveBackendUrl)}</span></p>
                    <Button variant="secondary" size="sm" onClick={checkConnector} loading={liveHealthLoading}>Check connector</Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>Change URL</Button>
                  </div>
                  {liveHealthError && <p className="mt-2 text-[13px] text-bad">{liveHealthError}</p>}
                  {liveHealth && (
                    <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[['Version', liveHealth.version], ['Protocol', liveHealth.protocol], ['Kahoot', liveHealth.kahootReachable ? `${formatMs(liveHealth.kahootLatencyMs ?? 0)}` : 'unreachable'], ['Session', liveHealth.sessionActive ? `busy (${liveHealth.sessionState})` : 'free']].map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-line bg-void/60 px-2.5 py-2">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
                          <dd className="mt-0.5 truncate font-mono text-xs text-ink">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <Notice
                  tone="info"
                  title="What happens on join"
                  body="Your connector reserves a real seat with Kahoot, solves the session challenge, and logs in with your nickname. Questions arrive live; you read them on the host screen, the AI ranks the options, and answers are submitted through the real game channel. Correctness and score come back from Kahoot."
                />
                <Button type="submit" variant="primary" size="lg" loading={liveBusy} className="w-full sm:w-auto">
                  <Radio size={17} /> Join live game
                </Button>
              </form>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-4 xl:col-span-2">
            <Card>
              <CardHeader title="Fair play" subtitle="One player, full transparency" />
              <CardBody className="space-y-3 text-[13px] leading-relaxed text-muted">
                {[
                  'The connector joins as ONE player with your nickname — no bot swarms, no lobby flooding.',
                  'Only join games you are invited to. Respect the host and the other players.',
                  'If the host enables 2-step join, you must complete the pattern from the host screen.',
                  'Every status reflects the real session — failures are reported, never hidden.',
                ].map((t, i) => (
                  <p key={i} className="flex gap-2.5"><ChevronRight size={15} className="mt-0.5 shrink-0 text-accent2" />{t}</p>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
        )}
      </div>
    );
  }

  /* ---------- live view ---------- */
  const stats = sessionStats(active);
  const progress = (active.answers.length / Math.max(1, active.questions.length)) * 100;
  const secsLeft = Math.ceil(remainingMs / 1000);
  const timerTone = secsLeft <= 5 ? 'bad' as const : secsLeft <= 10 ? 'warn' as const : 'accent' as const;

  return (
    <div>
      <PageHeader
        title="Automation Center"
        subtitle={`Live session · PIN ${active.pin} · ${active.nickname} · question ${Math.min(qIndex + 1, active.questions.length)} of ${active.questions.length}`}
        right={
          <>
            <Button variant="ghost" size="sm" onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })} title="Toggle sound">
              {settings.soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </Button>
            {active.status === 'running' ? (
              <Button variant="secondary" size="sm" onClick={handlePause}><Pause size={15} /> Pause</Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleResume}><Play size={15} /> Resume</Button>
            )}
            <Button variant="danger" size="sm" onClick={handleStop}><Square size={15} /> End session</Button>
          </>
        }
      />

      {active.status === 'paused' && (
        <div className="mb-4">
          <Notice tone="warn" title="Session paused" body="Timers are frozen. Resume to continue the current question with its remaining time intact." />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Question panel */}
        <div className="flex flex-col gap-4 xl:col-span-3">
          <Card glow={active.status === 'running'}>
            <CardBody>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StatusDot tone={active.status === 'running' ? 'live' : 'warn'} pulse={active.status === 'running'} />
                  <span className="text-[13px] font-semibold text-ink">{active.status === 'running' ? 'LIVE' : 'PAUSED'}</span>
                  {question && <Badge tone="muted">{question.category}</Badge>}
                  {question?.kind === 'image' && <Badge tone="cyan">Image-based</Badge>}
                  {question?.kind === 'math' && <Badge tone="accent">Math</Badge>}
                </div>
                <span className="inline-flex items-center gap-1.5 font-mono text-lg font-bold text-ink">
                  <Timer size={18} className={secsLeft <= 5 ? 'text-bad' : 'text-muted'} />{secsLeft}s
                </span>
              </div>
              <ProgressBar value={(remainingMs / totalMs) * 100} tone={timerTone} className="mt-2 h-2.5" />

              {question ? (
                <div className="mt-5">
                  <p className="font-display text-xl font-semibold leading-snug text-ink sm:text-2xl">{question.text}</p>
                  {question.kind === 'image' && question.imageHint && (
                    <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-accent2/30 bg-accent2/5 px-3 py-1.5 text-[13px] text-cyan-200">
                      <Info size={14} /> Attached visual: {question.imageHint}
                    </p>
                  )}
                  <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {question.options.map((o, i) => {
                      const isPicked = reveal?.picked === i;
                      const isCorrect = reveal !== null && question.correctIndex === i;
                      const dimmed = reveal !== null && !isPicked && !isCorrect;
                      const clickable = !reveal && !active.autoAnswer && active.status === 'running';
                      return (
                        <button
                          key={i}
                          disabled={!clickable}
                          onClick={() => submitAnswer(i, 'manual')}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 ${
                            isCorrect
                              ? 'border-good/60 bg-good/10 shadow-[0_0_28px_-8px_rgba(52,211,153,0.6)]'
                              : isPicked
                                ? 'border-bad/60 bg-bad/10'
                                : dimmed
                                  ? 'border-line bg-void/30 opacity-45'
                                  : clickable
                                    ? 'border-line bg-void/50 hover:scale-[1.01] hover:border-accent/60 hover:bg-panel3'
                                    : 'border-line bg-void/50'
                          } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <OptionMarker index={i} size={34} />
                          <span className="flex-1 text-sm font-medium text-ink">{o}</span>
                          {isCorrect && <CheckCircle2 size={19} className="shrink-0 text-good" />}
                          {isPicked && !isCorrect && <X size={19} className="shrink-0 text-bad" />}
                        </button>
                      );
                    })}
                  </div>

                  {reveal && question && (
                    <div className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm animate-fade-up ${reveal.picked === question.correctIndex ? 'border-good/40 bg-good/5 text-emerald-200' : reveal.picked === null ? 'border-warn/40 bg-warn/5 text-amber-200' : 'border-bad/40 bg-bad/5 text-red-200'}`}>
                      {reveal.picked === question.correctIndex ? <Check size={17} className="mt-0.5 shrink-0" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
                      <p><strong>{reveal.picked === question.correctIndex ? 'Correct. ' : reveal.picked === null ? 'Unanswered. ' : 'Wrong. '}</strong>{question.explanation}</p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ProgressBar value={progress} className="h-1.5 flex-1" />
                    <span className="font-mono text-xs text-muted">{active.answers.length}/{active.questions.length}</span>
                    {!reveal && active.status === 'running' && (
                      <Button variant="ghost" size="sm" onClick={() => submitAnswer(null, 'skipped')} title="Skip this question">
                        <SkipForward size={14} /> Skip
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted">Finishing session…</p>
              )}
            </CardBody>
          </Card>

          {/* Solver insight */}
          <Card>
            <CardHeader
              title="Solver insight"
              subtitle={active.autoAnswer ? 'What the engine thinks about the current question.' : 'Manual mode — the engine still analyzes for reference.'}
              right={insight ? <Badge tone={insight.confidence >= 0.75 ? 'good' : insight.confidence >= 0.45 ? 'warn' : 'bad'}>{methodLabel(insight.method)}</Badge> : undefined}
            />
            <CardBody>
              {insightLoading && !insight && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Bot size={16} className="animate-pulse-soft text-accent" />
                  {settings.solverMode === 'api' ? 'Consulting cloud AI…' : settings.solverMode === 'neural' ? 'Analyzing with on-device AI…' : 'Analyzing with local engine…'}
                </div>
              )}
              {insight && (
                <div className="space-y-3 animate-fade-up">
                  <ConfidenceBar value={insight.confidence} />
                  <p className="text-sm leading-relaxed text-ink/90">
                    Recommends <strong>option {insight.bestIndex + 1}</strong>
                    {question ? ` (“${question.options[insight.bestIndex]}”)` : ''} — {insight.explanation}
                  </p>
                  <p className="font-mono text-xs text-muted">solved in {formatMs(insight.latencyMs)}{insight.viaApi ? ' · cloud' : ' · local'}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Controls + log */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader title="Session controls" subtitle="Auto-answer toggles instantly; delay and threshold apply from the next question." />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Correct', stats.correct],
                  ['Wrong', stats.wrong],
                  ['Skip/Timeout', stats.unanswered],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-xl border border-line bg-void/50 p-2.5">
                    <p className="font-display text-lg font-bold text-ink">{v}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
                  </div>
                ))}
              </div>
              <Toggle checked={active.autoAnswer} onChange={(v) => { updateControls({ autoAnswer: v }); appendSessionEvent(active.id, 'system', `Auto-answer ${v ? 'enabled' : 'disabled'} by operator.`); }} label="Automatic answer selection" />
              <Field label={`Answer delay: ${(active.answerDelayMs / 1000).toFixed(1)}s`}>
                <Slider value={active.answerDelayMs} min={500} max={10000} step={500} onChange={(v) => updateControls({ answerDelayMs: v })} />
              </Field>
              <Field label={`Confidence threshold: ${Math.round(active.confidenceThreshold * 100)}%`}>
                <Slider value={Math.round(active.confidenceThreshold * 100)} min={0} max={90} step={5} onChange={(v) => updateControls({ confidenceThreshold: v / 100 })} />
              </Field>
              <div className="border-t border-line pt-4">
                <Button variant="secondary" size="sm" className="w-full" loading={quickRunning} onClick={handleQuickChecks}>
                  <FlaskConical size={14} /> Run quick diagnostics
                </Button>
                {quickChecks && (
                  <ul className="mt-2.5 space-y-1 rounded-xl border border-line bg-void/50 p-3 font-mono text-xs leading-relaxed text-muted">
                    {quickChecks.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Event log" subtitle={`${active.events.length} events · errors: ${active.errors.length}`} />
            <CardBody>
              <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                {[...active.events].reverse().map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-void/40 px-3 py-2">
                    {e.type === 'error' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-bad" />
                      : e.type === 'answer' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" />
                      : <Info size={14} className="mt-0.5 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] leading-snug text-ink/90">{e.message}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-muted">{formatDateTime(e.ts)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex items-center gap-3">
              <Zap size={18} className="shrink-0 text-accent2" />
              <p className="text-[13px] leading-relaxed text-muted">
                Started {formatDateTime(active.startedAt)} · {active.autoAnswer ? `auto after ${(active.answerDelayMs / 1000).toFixed(1)}s` : 'manual answering'}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
