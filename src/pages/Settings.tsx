/* KAHOOT BOSS — Settings (all persistent, all functional) */
import React from 'react';
import { Bot, Brain, CheckCircle2, Database, Download, Eye, EyeOff, FlaskConical, Radio, User, XCircle, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, Slider, StatusDot, Toggle } from '../components/ui';
import { useStore, DEFAULT_SETTINGS } from '../store/useStore';
import { solveViaApi } from '../engine/apiClient';
import { type LiveHealth } from '../engine/liveClient';
import { resolveLiveRuntime } from '../engine/directLive';
import { NEURAL_MODEL_ID, NEURAL_MODEL_PARAMS, NEURAL_MODEL_SIZE, ensureNeuralModel } from '../engine/neuralSolver';
import { validateApiUrl, validateDisplayName } from '../lib/validation';
import { downloadFile, formatMs } from '../lib/utils';

export default function Settings() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const resetSettings = useStore((s) => s.resetSettings);
  const sessions = useStore((s) => s.sessions);
  const solves = useStore((s) => s.solves);
  const activity = useStore((s) => s.activity);
  const clearSessions = useStore((s) => s.clearSessions);
  const clearSolves = useStore((s) => s.clearSolves);
  const clearActivity = useStore((s) => s.clearActivity);
  const pushToast = useStore((s) => s.pushToast);
  const pushActivity = useStore((s) => s.pushActivity);
  const neural = useStore((s) => s.neural);

  const [name, setName] = React.useState(profile.displayName);
  const [role, setRole] = React.useState(profile.role);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [apiTest, setApiTest] = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [apiTesting, setApiTesting] = React.useState(false);
  const [liveHealth, setLiveHealth] = React.useState<LiveHealth | null>(null);
  const [liveHealthError, setLiveHealthError] = React.useState<string | null>(null);
  const [liveTesting, setLiveTesting] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  React.useEffect(() => {
    setName(profile.displayName);
    setRole(profile.role);
  }, [profile.displayName, profile.role]);

  const saveProfile = () => {
    const check = validateDisplayName(name);
    setNameError(check.error);
    if (!check.ok) return;
    setProfile({ displayName: name.trim(), role: role.trim() || 'Operator' });
    pushActivity('settings', `Profile updated → "${name.trim()}"`);
    pushToast({ title: 'Profile saved', tone: 'success' });
  };

  const testCloudApi = async () => {
    setApiTesting(true);
    setApiTest(null);
    try {
      const { data, latencyMs } = await solveViaApi({
        question: 'What is 2 + 2?',
        options: ['3', '4', '5', '6'],
        baseUrl: settings.apiBaseUrl,
        model: settings.apiModel,
        apiKey: settings.apiKey,
        timeoutMs: 20000,
      });
      const correct = data.bestIndex === 1;
      setApiTest({
        ok: true,
        msg: `Connected to model "${data.model}" in ${formatMs(latencyMs)}. Test answer: option ${data.bestIndex + 1} (${Math.round(data.confidence * 100)}%) — ${correct ? 'correct ✓' : 'unexpected answer, but the pipeline works'}.`,
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      setApiTest({
        ok: false,
        msg: err.code === 'AI_NOT_CONFIGURED'
          ? 'No credentials found: set an API key above (or server-side AI_API_KEY) and a valid endpoint.'
          : err.message,
      });
    } finally {
      setApiTesting(false);
    }
  };

  const liveMode = settings.liveMode ?? 'direct';
  const testConnector = async () => {
    setLiveTesting(true);
    setLiveHealth(null);
    setLiveHealthError(null);
    try {
      const { api, base, mode } = resolveLiveRuntime(settings);
      const { data } = await api.health(base, mode === 'direct' ? 15000 : 9000);
      setLiveHealth(data);
      pushActivity('settings', `${mode === 'direct' ? 'Direct' : 'Connector'} check: v${data.version} · Kahoot ${data.kahootReachable ? `reachable (${data.kahootLatencyMs} ms)` : 'unreachable'}`);
    } catch (e) {
      setLiveHealthError(e instanceof Error ? e.message : 'Live backend check failed.');
    } finally {
      setLiveTesting(false);
    }
  };

  const exportAll = () => {
    downloadFile(
      `kahoot-boss-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), profile, settings: { ...settings, apiKey: '' }, sessions, solves, activity }, null, 2),
    );
    pushToast({ title: 'Backup exported', body: 'API keys were excluded from the file for safety.', tone: 'success' });
  };

  const urlCheck = validateApiUrl(settings.apiBaseUrl);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Profile, solver engine, integrations, automation defaults and data management. Everything saves automatically to this browser."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Profile */}
        <Card>
          <CardHeader title="Profile" subtitle="Shown across the dashboard and top bar." />
          <CardBody className="space-y-4">
            <Field label="Display name" error={nameError}>
              <Input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Operator" />
            </Field>
            <Field label="Role / title" hint="Free text, e.g. Quiz Automation Engineer">
              <Input value={role} maxLength={40} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Button variant="secondary" onClick={saveProfile}><User size={16} /> Save profile</Button>
          </CardBody>
        </Card>

        {/* Solver engine */}
        <Card glow={settings.solverMode !== 'local'}>
          <CardHeader
            title="Solver engine"
            subtitle="Choose the brain behind Solve and auto-answer."
            right={
              settings.solverMode === 'api' ? <Badge tone="cyan"><Bot size={12} /> Cloud</Badge>
              : settings.solverMode === 'neural' ? <Badge tone="good"><Brain size={12} /> On-device AI</Badge>
              : <Badge tone="accent"><FlaskConical size={12} /> Local</Badge>
            }
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button onClick={() => updateSettings({ solverMode: 'local' })} className={`rounded-xl border px-3.5 py-3 text-left transition ${settings.solverMode === 'local' ? 'border-accent/60 bg-accent/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                <span className="block text-sm font-semibold text-ink">Local (offline)</span>
                <span className="mt-0.5 block text-xs text-muted">Math + knowledge. Free, instant, private.</span>
              </button>
              <button onClick={() => updateSettings({ solverMode: 'neural' })} className={`rounded-xl border px-3.5 py-3 text-left transition ${settings.solverMode === 'neural' ? 'border-good/60 bg-good/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                <span className="block text-sm font-semibold text-ink">On-device AI</span>
                <span className="mt-0.5 block text-xs text-muted">Real neural model, no API key. One-time download.</span>
              </button>
              <button onClick={() => updateSettings({ solverMode: 'api' })} className={`rounded-xl border px-3.5 py-3 text-left transition ${settings.solverMode === 'api' ? 'border-accent2/60 bg-accent2/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                <span className="block text-sm font-semibold text-ink">Cloud AI (BYOK)</span>
                <span className="mt-0.5 block text-xs text-muted">Your key, OpenAI-compatible endpoint.</span>
              </button>
            </div>

            {settings.solverMode === 'neural' && (
              <div className="space-y-3 rounded-xl border border-good/25 bg-good/5 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <StatusDot tone={neural.status === 'ready' ? 'good' : neural.status === 'error' ? 'bad' : neural.status === 'loading' ? 'warn' : 'idle'} />
                    {neural.status === 'ready' ? 'On-device AI ready' : neural.status === 'loading' ? `Downloading model… ${neural.progress}%` : neural.status === 'error' ? 'Model failed to load' : 'Model not downloaded yet'}
                  </p>
                  {neural.status !== 'loading' && (
                    <Button size="sm" variant={neural.status === 'ready' ? 'ghost' : 'secondary'} onClick={() => { void ensureNeuralModel().then(() => pushActivity('settings', 'On-device AI model loaded')).catch(() => { /* error shown inline */ }); }}>
                      <Download size={14} /> {neural.status === 'ready' ? 'Reload' : neural.status === 'error' ? 'Retry download' : 'Download & load'}
                    </Button>
                  )}
                </div>
                {neural.status === 'loading' && (
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-good transition-all" style={{ width: `${neural.progress}%` }} />
                    </div>
                    {neural.file && <p className="mt-1.5 truncate font-mono text-[11px] text-muted">{neural.file}</p>}
                  </div>
                )}
                {neural.status === 'error' && neural.error && (
                  <p className="text-[13px] leading-relaxed text-red-200">{neural.error}</p>
                )}
                {neural.status === 'ready' && (
                  <p className="text-[13px] leading-relaxed text-emerald-200/90">Inference runs 100% in this browser — questions never leave your device, and no API key is needed.</p>
                )}
                <dl className="grid grid-cols-3 gap-2">
                  {[
                    ['Model', NEURAL_MODEL_ID.replace('Xenova/', '')],
                    ['Size', `${NEURAL_MODEL_SIZE} · cached`],
                    ['Engine', NEURAL_MODEL_PARAMS],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line bg-void/60 px-2.5 py-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
                      <dd className="mt-0.5 truncate font-mono text-xs text-ink" title={v}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className={settings.solverMode === 'api' ? '' : 'pointer-events-none opacity-40'}>
              <div className="space-y-4">
                <Field label="API base URL" error={urlCheck.error} hint="OpenAI-compatible base, e.g. https://api.openai.com/v1 — or /api to use this app's backend">
                  <Input value={settings.apiBaseUrl} onChange={(e) => updateSettings({ apiBaseUrl: e.target.value })} placeholder="/api" />
                </Field>
                <Field label="API key" hint="Stored only in this browser. Never committed, never logged.">
                  <div className="relative">
                    <Input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(e) => updateSettings({ apiKey: e.target.value })} placeholder="sk-…" className="pr-11" />
                    <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-ink" title={showKey ? 'Hide key' : 'Show key'}>
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <Field label="Model" hint="Passed to the provider's chat-completions API">
                  <Input value={settings.apiModel} onChange={(e) => updateSettings({ apiModel: e.target.value })} placeholder="gpt-4o-mini" />
                </Field>
                <div>
                  <Button variant="secondary" loading={apiTesting} onClick={testCloudApi}><Zap size={16} /> Test cloud connection</Button>
                  {apiTest && (
                    <p className={`mt-2 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${apiTest.ok ? 'border-good/30 bg-good/5 text-emerald-200' : 'border-bad/30 bg-bad/5 text-red-200'}`}>
                      {apiTest.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                      {apiTest.msg}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Live backend */}
        <Card>
          <CardHeader
            title="Live backend"
            subtitle="How this browser joins real games: directly, or through the optional connector server."
            right={<Badge tone={liveHealth ? (liveHealth.kahootReachable ? 'good' : 'warn') : 'muted'}><Radio size={12} /> {liveHealth ? (liveHealth.kahootReachable ? 'Ready' : 'No Kahoot route') : 'Unchecked'}</Badge>}
          />
          <CardBody className="space-y-4">
            <Notice tone="info" title="How live mode connects" body="Direct (default): this browser reserves a real seat with Kahoot through the tiny /api/kahoot-reserve relay, solves the session challenge, and holds the game channel open — no backend to run. Connector: the same engine runs on your own Node host (npm run server) and this UI talks to it over REST + SSE." />
            <Field label="Live connection mode" hint={liveMode === 'direct' ? 'Recommended — works on the deployed site with zero setup.' : 'Advanced — needs a running connector; use it in local dev.'}>
              <Select value={liveMode} onChange={(e) => updateSettings({ liveMode: e.target.value as 'direct' | 'connector' })}>
                <option value="direct">Direct — in-browser engine + reserve relay</option>
                <option value="connector">Connector — self-hosted server (npm run server)</option>
              </Select>
            </Field>
            {liveMode === 'connector' && (
              <>
                <Field label="Connector base URL" hint="Standalone file: http://127.0.0.1:3001 (see below). Dev proxy: /live. Example remote: https://your-connector.example.com/live">
                  <Input value={settings.liveBackendUrl} onChange={(e) => updateSettings({ liveBackendUrl: e.target.value })} placeholder="/live" />
                </Field>
                <Notice
                  tone="info"
                  title="Standalone connector (easiest local option)"
                  body="One file, no install besides Node 20+: download it, run `node kb-connector.cjs`, keep it running while you play, and use http://127.0.0.1:3001 above. Reserve and game channel then share your network."
                  action={<Button size="sm" variant="secondary" onClick={() => window.open('/kb-connector.cjs', '_blank', 'noopener')}><Download size={14} /> Download kb-connector.cjs</Button>}
                />
              </>
            )}
            <div>
              <Button variant="secondary" loading={liveTesting} onClick={testConnector}><Radio size={16} /> {liveMode === 'direct' ? 'Check direct live path' : 'Check connector health'}</Button>
              {liveHealthError && (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-200">
                  <StatusDot tone="bad" /> {liveHealthError}
                </p>
              )}
              {liveHealth && (
                <div className="mt-2.5 rounded-xl border border-line bg-void/50 p-3.5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <StatusDot tone={liveHealth.kahootReachable ? 'good' : 'warn'} />
                    {liveHealth.service === 'kahoot-boss-direct' ? 'Direct engine' : 'Connector'} v{liveHealth.version} · protocol {liveHealth.protocol}
                  </p>
                  <dl className="mt-2.5 grid grid-cols-2 gap-2">
                    {[
                      ['Kahoot route', liveHealth.kahootReachable ? `yes · ${formatMs(liveHealth.kahootLatencyMs ?? 0)}` : 'NO — joins will fail'],
                      ['Session slot', liveHealth.sessionActive ? `busy (${liveHealth.sessionState})` : 'free'],
                      ['Reserve', liveHealth.reserveBase],
                      ['CometD', liveHealth.cometdBase],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-line bg-void/60 px-2.5 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{k}</dt>
                        <dd className="mt-0.5 truncate font-mono text-xs text-ink" title={v}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Automation defaults */}
        <Card>
          <CardHeader title="Automation defaults" subtitle="Pre-fill for every new session in the Automation Center." />
          <CardBody className="space-y-4">
            <Toggle checked={settings.autoAnswer} onChange={(v) => updateSettings({ autoAnswer: v })} label="Auto-answer by default" hint="Sessions start with automatic answer selection enabled." />
            <Field label={`Default answer delay: ${(settings.answerDelayMs / 1000).toFixed(1)}s`}>
              <Slider value={settings.answerDelayMs} min={500} max={10000} step={500} onChange={(v) => updateSettings({ answerDelayMs: v })} />
            </Field>
            <Field label={`Default confidence threshold: ${Math.round(settings.confidenceThreshold * 100)}%`}>
              <Slider value={Math.round(settings.confidenceThreshold * 100)} min={0} max={90} step={5} onChange={(v) => updateSettings({ confidenceThreshold: v / 100 })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default questions">
                <Select value={settings.defaultQuestionCount} onChange={(e) => updateSettings({ defaultQuestionCount: Number(e.target.value) })}>
                  {[5, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n} questions</option>)}
                </Select>
              </Field>
              <Field label="Default time limit">
                <Select value={settings.defaultTimeLimitSec} onChange={(e) => updateSettings({ defaultTimeLimitSec: Number(e.target.value) })}>
                  {[10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} seconds</option>)}
                </Select>
              </Field>
            </div>
            <Toggle checked={settings.soundEnabled} onChange={(v) => updateSettings({ soundEnabled: v })} label="Session sounds" hint="Short tones for correct, wrong and timeout events." />
            <Toggle checked={settings.persistHistory} onChange={(v) => updateSettings({ persistHistory: v })} label="Persist solve history" hint="When off, new solves are kept for this visit only." />
          </CardBody>
        </Card>

        {/* Data */}
        <Card className="xl:col-span-2">
          <CardHeader title="Data management" subtitle={`${sessions.length} sessions · ${solves.length} solves · ${activity.length} activity events stored locally.`} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={exportAll}><Database size={16} /> Export full backup (JSON)</Button>
              <Button variant="ghost" onClick={() => { clearSessions(); pushToast({ title: 'Sessions cleared', tone: 'info' }); }}>Clear sessions</Button>
              <Button variant="ghost" onClick={() => { clearSolves(); pushToast({ title: 'Solve history cleared', tone: 'info' }); }}>Clear solves</Button>
              <Button variant="ghost" onClick={() => { clearActivity(); pushToast({ title: 'Activity cleared', tone: 'info' }); }}>Clear activity</Button>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-sm font-semibold text-ink">Danger zone</p>
              <p className="mt-0.5 text-[13px] text-muted">Reset all settings to defaults. Sessions and history are kept.</p>
              {confirmReset ? (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[13px] text-muted">Reset {JSON.stringify(Object.keys(DEFAULT_SETTINGS).length)} settings to defaults?</span>
                  <Button variant="danger" size="sm" onClick={() => { resetSettings(); setConfirmReset(false); pushToast({ title: 'Settings reset', tone: 'info' }); }}>Confirm reset</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="danger" size="sm" className="mt-2.5" onClick={() => setConfirmReset(true)}>Reset settings to defaults</Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
