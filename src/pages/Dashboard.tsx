/* KAHOOT BOSS — Dashboard */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  FlaskConical,
  History,
  Plug2,
  Radio,
  Target,
  Timer,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, ProgressBar, StatCard, StatusDot } from '../components/ui';
import { useStore, globalStats, sessionStats } from '../store/useStore';
import { useConnect } from '../hooks/useConnect';
import { solverSelfTest } from '../engine/solver';
import { formatDateTime, formatDuration, formatMs, percent, timeAgo } from '../lib/utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const profile = useStore((s) => s.profile);
  const sessions = useStore((s) => s.sessions);
  const solves = useStore((s) => s.solves);
  const activity = useStore((s) => s.activity);
  const settings = useStore((s) => s.settings);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const { connection, busy, errors, connect } = useConnect();

  const [pin, setPin] = React.useState(connection.pin || '');
  const [nickname, setNickname] = React.useState(connection.nickname || 'Player-1');
  const [mode, setMode] = React.useState<'simulation' | 'live'>(connection.mode ?? 'simulation');
  const [engine, setEngine] = React.useState<{ passed: boolean; detail: string; latencyMs: number } | null>(null);

  React.useEffect(() => {
    setEngine(solverSelfTest());
  }, []);

  const stats = globalStats(sessions);
  const active = sessions.find((s) => s.id === activeSessionId) ?? null;
  const last = sessions[0] ?? null;
  const lastStats = last ? sessionStats(last) : null;

  const verdicts = solves.filter((s) => s.userVerdict !== null);
  const verdictAcc = verdicts.length > 0 ? verdicts.filter((s) => s.userVerdict === 'correct').length / verdicts.length : null;

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await connect({ pin, nickname, mode });
    if (ok) navigate('/automation');
  };

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile.displayName}.`}
        subtitle="Command center for your quiz automation sessions. Connect to a game, run the AI solver, and automate with full control."
        right={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/solver')}>
              <Bot size={16} /> Open AI Solver
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/automation')}>
              <Zap size={16} /> Automation Center
            </Button>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Questions analyzed" value={String(stats.totalAnswered + solves.length)} sub={`${stats.totalAnswered} in sessions · ${solves.length} in solver`} icon={<Target size={20} />} accent />
        <StatCard label="Correct answers" value={String(stats.totalCorrect)} sub={stats.accuracy !== null ? `${percent(stats.accuracy)} session accuracy` : 'No session answers yet'} icon={<CheckCircle2 size={20} />} />
        <StatCard label="Sessions run" value={String(stats.totalSessions)} sub={stats.avgLatencyMs !== null ? `Avg solve ${formatMs(stats.avgLatencyMs)}` : 'No sessions yet'} icon={<History size={20} />} />
        <StatCard label="Solver accuracy" value={verdictAcc !== null ? percent(verdictAcc) : '—'} sub={verdictAcc !== null ? `from ${verdicts.length} rated solves` : 'Rate solves to measure'} icon={<Bot size={20} />} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Quick connect */}
        <Card className="xl:col-span-3" glow={connection.status !== 'connected'}>
          <CardHeader
            title="Quick connect"
            subtitle="Enter a Game PIN and nickname to attach to the authorized test environment."
            right={
              connection.status === 'connected' ? (
                <Badge tone="cyan"><StatusDot tone="live" pulse /> Connected</Badge>
              ) : connection.status === 'error' ? (
                <Badge tone="bad">Error</Badge>
              ) : (
                <Badge tone="muted">Disconnected</Badge>
              )
            }
          />
          <CardBody>
            <form onSubmit={handleConnect} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Game PIN" error={errors.pin}>
                <Input mono inputMode="numeric" placeholder="e.g. 482913" value={pin} maxLength={10} onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))} />
              </Field>
              <Field label="Player nickname" error={errors.nickname}>
                <Input placeholder="e.g. Player-1" value={nickname} maxLength={15} onChange={(e) => setNickname(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-[13px] font-medium text-ink/90">Environment</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('simulation')}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition ${mode === 'simulation' ? 'border-accent/60 bg-accent/10' : 'border-line bg-void/50 hover:border-white/20'}`}
                  >
                    <FlaskConical size={18} className={mode === 'simulation' ? 'text-accent' : 'text-muted'} />
                    <span>
                      <span className="block text-sm font-semibold text-ink">Simulation</span>
                      <span className="block text-[11px] text-muted">Authorized test env · always available</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('live')}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition ${mode === 'live' ? 'border-accent2/60 bg-accent2/10' : 'border-line bg-void/50 hover:border-white/20'}`}
                  >
                    <Radio size={18} className={mode === 'live' ? 'text-accent2' : 'text-muted'} />
                    <span>
                      <span className="block text-sm font-semibold text-ink">Live</span>
                      <span className="block text-[11px] text-muted">Requires configured endpoint</span>
                    </span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button type="submit" variant="primary" loading={busy}>
                  <Plug2 size={16} /> {connection.status === 'connected' ? 'Reconnect' : 'Connect to Game'}
                </Button>
                <p className="text-xs text-muted">{connection.detail}</p>
              </div>
            </form>
            {mode === 'live' && (
              <div className="mt-4">
                <Notice
                  tone="info"
                  title="Live mode joins real games"
                  body="Live mode performs a genuine join through the connector backend (reserve → challenge → CometD → login). The connector must be running (`npm run server`) and able to reach Kahoot — any failure is reported honestly, never faked."
                  action={<Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>Open configuration <ArrowRight size={14} /></Button>}
                />
              </div>
            )}
          </CardBody>
        </Card>

        {/* Engine + session */}
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card>
            <CardHeader title="AI engine" subtitle={`Mode: ${settings.solverMode === 'local' ? 'Local (offline)' : 'Cloud API'}`} right={engine ? (engine.passed ? <Badge tone="good">Operational</Badge> : <Badge tone="bad">Self-test failed</Badge>) : <Badge tone="muted">Checking…</Badge>} />
            <CardBody>
              <div className="flex items-center gap-3">
                <StatusDot tone={engine ? (engine.passed ? 'good' : 'bad') : 'idle'} pulse />
                <p className="text-[13px] text-muted">{engine ? engine.detail : 'Running solver self-test…'}</p>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {['Math', 'Knowledge', 'Fallback'].map((s) => (
                  <div key={s} className="rounded-lg border border-line bg-void/50 px-2 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{s}</p>
                    <p className={`mt-0.5 font-mono text-xs font-bold ${engine?.passed ? 'text-good' : 'text-muted'}`}>{engine?.passed ? 'READY' : '…'}</p>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => navigate('/solver')}>
                Test the solver <ArrowRight size={14} />
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Current session" subtitle={active ? `PIN ${active.pin} · ${active.nickname}` : 'No active session'} right={active ? <Badge tone="cyan">Running</Badge> : last ? <Badge tone="muted">{last.status}</Badge> : null} />
            <CardBody>
              {active ? (
                <>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted">Question {Math.min(active.currentIndex + 1, active.questions.length)} of {active.questions.length}</span>
                    <span className="font-mono text-ink">{active.answers.filter((a) => a.correct === true).length} correct</span>
                  </div>
                  <ProgressBar value={(active.answers.length / Math.max(1, active.questions.length)) * 100} className="mt-2" />
                  <Button variant="primary" size="sm" className="mt-4 w-full" onClick={() => navigate('/automation')}>
                    <Zap size={14} /> Resume in Automation Center
                  </Button>
                </>
              ) : last && lastStats ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-line bg-void/50 p-2.5">
                      <p className="font-display text-lg font-bold text-ink">{lastStats.correct}</p>
                      <p className="text-[11px] text-muted">Correct</p>
                    </div>
                    <div className="rounded-lg border border-line bg-void/50 p-2.5">
                      <p className="font-display text-lg font-bold text-ink">{lastStats.answered}</p>
                      <p className="text-[11px] text-muted">Answered</p>
                    </div>
                    <div className="rounded-lg border border-line bg-void/50 p-2.5">
                      <p className="font-display text-lg font-bold text-ink">{lastStats.accuracy !== null ? percent(lastStats.accuracy) : '—'}</p>
                      <p className="text-[11px] text-muted">Accuracy</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                    <Timer size={14} />
                    Last session {formatDateTime(last.startedAt)}
                    {last.endedAt ? ` · lasted ${formatDuration(last.endedAt - last.startedAt)}` : ''}
                  </div>
                  <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate('/history')}>
                    <History size={14} /> View session history
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-[13px] leading-relaxed text-muted">No sessions yet. Connect above, then start your first automated test session.</p>
                  <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate('/automation')}>
                    <Zap size={14} /> Go to Automation Center
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Activity */}
      <Card className="mt-4">
        <CardHeader
          title="Recent activity"
          subtitle="A live log of connections, solves and sessions — generated by your real actions."
          right={
            activity.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => useStore.getState().clearActivity()}>Clear</Button>
            ) : undefined
          }
        />
        <CardBody>
          {activity.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-5 text-sm text-muted">
              <Activity size={18} />
              Nothing yet — connect to a game or solve a question and it will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {activity.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.kind === 'session' ? 'bg-accent' : a.kind === 'solver' ? 'bg-accent2' : a.kind === 'connection' ? 'bg-good' : 'bg-muted'}`} />
                  <p className="min-w-0 flex-1 truncate text-[13px] text-ink/90">{a.message}</p>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{timeAgo(a.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
