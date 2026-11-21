/* KAHOOT BOSS — Game Connection */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FlaskConical, Loader2, Plug2, PlugZap, Radio, RefreshCw, ShieldAlert, Unplug, XCircle, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, StatusDot } from '../components/ui';
import { useStore } from '../store/useStore';
import { useConnect } from '../hooks/useConnect';
import { runDiagnostics } from '../engine/diagnostics';
import type { DiagnosticCheck } from '../lib/types';
import { formatDateTime, formatMs } from '../lib/utils';

export default function Connection() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const pushToast = useStore((s) => s.pushToast);
  const { connection, busy, errors, connect, disconnect } = useConnect();

  const [pin, setPin] = React.useState(connection.pin || '');
  const [nickname, setNickname] = React.useState(connection.nickname || 'Player-1');
  const [mode, setMode] = React.useState<'simulation' | 'live'>(connection.mode ?? 'simulation');
  const [checks, setChecks] = React.useState<DiagnosticCheck[]>([]);
  const [diagRunning, setDiagRunning] = React.useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    await connect({ pin, nickname, mode });
  };

  const handleDiagnostics = async () => {
    setDiagRunning(true);
    setChecks([]);
    try {
      await runDiagnostics(settings, (c) => setChecks((prev) => [...prev.filter((x) => x.id !== c.id), c]));
    } finally {
      setDiagRunning(false);
    }
  };

  const connected = connection.status === 'connected';

  return (
    <div>
      <PageHeader
        title="Game Connection"
        subtitle="Attach to the authorized test environment — or join a real live game. Every status on this page reflects a real check."
        right={
          connected ? (
            <Button variant="secondary" size="sm" onClick={() => navigate('/automation')}>
              <Zap size={16} /> Start session
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Connect form */}
        <Card glow={!connected}>
          <CardHeader
            title="Connection setup"
            subtitle="Validate a Game PIN and player nickname."
            right={
              connection.status === 'connected' ? <Badge tone="cyan"><StatusDot tone="live" pulse /> Connected</Badge>
              : connection.status === 'connecting' ? <Badge tone="warn">Connecting</Badge>
              : connection.status === 'error' ? <Badge tone="bad">Error</Badge>
              : <Badge tone="muted">Disconnected</Badge>
            }
          />
          <CardBody>
            <form onSubmit={handleConnect} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Game PIN" error={errors.pin} hint={mode === 'live' ? 'Live PINs are 6–10 digits' : '4–10 digits'}>
                  <Input mono inputMode="numeric" placeholder="482913" value={pin} maxLength={10} onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))} />
                </Field>
                <Field label="Player nickname" error={errors.nickname} hint="2–15 characters">
                  <Input placeholder="Player-1" value={nickname} maxLength={15} onChange={(e) => setNickname(e.target.value)} />
                </Field>
              </div>

              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-ink/90">Environment</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setMode('simulation')}
                    className={`rounded-xl border p-3.5 text-left transition ${mode === 'simulation' ? 'border-accent/60 bg-accent/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                    <span className="flex items-center gap-2">
                      <FlaskConical size={17} className={mode === 'simulation' ? 'text-accent' : 'text-muted'} />
                      <span className="text-sm font-semibold text-ink">Simulation</span>
                      {mode === 'simulation' && <CheckCircle2 size={15} className="ml-auto text-accent" />}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted">Authorized local test environment. Practice questions, real timers, real scoring. Always available.</span>
                  </button>
                  <button type="button" onClick={() => setMode('live')}
                    className={`rounded-xl border p-3.5 text-left transition ${mode === 'live' ? 'border-accent2/60 bg-accent2/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                    <span className="flex items-center gap-2">
                      <Radio size={17} className={mode === 'live' ? 'text-accent2' : 'text-muted'} />
                      <span className="text-sm font-semibold text-ink">Live</span>
                      {mode === 'live' && <CheckCircle2 size={15} className="ml-auto text-accent2" />}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-muted">Real join: reserve/session → challenge → CometD → login. Direct mode works out of the box; connector mode needs `npm run server`. Both need network access to Kahoot.</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {!connected ? (
                  <Button type="submit" variant="primary" loading={busy}>
                    <Plug2 size={16} /> Connect to Game
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => { disconnect(); pushToast({ title: 'Disconnected', tone: 'info' }); }}>
                    <Unplug size={16} /> Disconnect
                  </Button>
                )}
                <Button variant="secondary" onClick={handleDiagnostics} loading={diagRunning}>
                  <PlugZap size={16} /> Run diagnostics
                </Button>
              </div>
            </form>

            {mode === 'live' && (
              <div className="mt-4">
                <Notice
                  tone="info"
                  title="How live mode connects"
                  body="Direct (default): this browser reserves a real seat through the tiny /api/kahoot-reserve relay (Kahoot's session endpoint sends no CORS headers, so that one step is relayed), then solves the challenge and holds the game channel open itself — the same flow as the official web client, one player at a time. Prefer a backend? Switch to connector mode in Settings."
                  action={<Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>Live settings</Button>}
                />
              </div>
            )}

            {connection.status === 'error' && connection.lastError && (
              <div className="mt-4">
                <Notice tone="error" title="Connection failed" body={connection.lastError} />
              </div>
            )}
          </CardBody>
        </Card>

        {/* Status panel */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Connection status" subtitle="Live values from the current connection state." />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3">
                {[
                  ['State', connection.status],
                  ['PIN', connection.pin || '—'],
                  ['Nickname', connection.nickname || '—'],
                  ['Environment', connection.mode ?? '—'],
                  ['Latency', connection.latencyMs !== null ? formatMs(connection.latencyMs) : '—'],
                  ['Since', connection.connectedAt ? formatDateTime(connection.connectedAt) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-void/50 px-3.5 py-2.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
                    <dd className="mt-0.5 truncate font-mono text-sm text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 rounded-xl border border-line bg-void/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted">{connection.detail}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Connection diagnostics"
              subtitle="Each check performs a real measurement against this browser and backend."
              right={checks.length > 0 && !diagRunning ? (
                <Button variant="ghost" size="sm" onClick={handleDiagnostics}><RefreshCw size={14} /> Re-run</Button>
              ) : undefined}
            />
            <CardBody>
              {checks.length === 0 && !diagRunning && (
                <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">
                  No diagnostics run yet. Press “Run diagnostics” to measure connectivity, persistence, the AI engine, the backend API and live-integration state.
                </p>
              )}
              <ul className="space-y-2.5">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 rounded-xl border border-line bg-void/50 px-3.5 py-3">
                    {c.status === 'pass' && <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" />}
                    {c.status === 'warn' && <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />}
                    {c.status === 'fail' && <XCircle size={18} className="mt-0.5 shrink-0 text-bad" />}
                    {c.status === 'pending' && <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin-slow text-muted" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {c.label}
                        {c.latencyMs !== null && <span className="ml-2 font-mono text-xs font-normal text-muted">{formatMs(c.latencyMs)}</span>}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
