/* KAHOOT BOSS — Settings (all persistent, all functional) */
import React from 'react';
import { Bot, CheckCircle2, Database, Eye, EyeOff, FlaskConical, Radio, User, XCircle, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Select, Slider, StatusDot, Toggle } from '../components/ui';
import { useStore, DEFAULT_SETTINGS } from '../store/useStore';
import { solveViaApi } from '../engine/apiClient';
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

  const [name, setName] = React.useState(profile.displayName);
  const [role, setRole] = React.useState(profile.role);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [showLiveKey, setShowLiveKey] = React.useState(false);
  const [apiTest, setApiTest] = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [apiTesting, setApiTesting] = React.useState(false);
  const [liveTest, setLiveTest] = React.useState<{ ok: boolean; msg: string } | null>(null);
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

  const testLiveEndpoint = async () => {
    setLiveTesting(true);
    setLiveTest(null);
    const url = settings.liveApiUrl.trim();
    if (!url) {
      setLiveTest({ ok: false, msg: 'No live endpoint URL is set — live mode is intentionally disabled. Simulation mode is unaffected.' });
      setLiveTesting(false);
      return;
    }
    try {
      const started = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        setLiveTest({ ok: res.ok, msg: res.ok ? `Endpoint responded HTTP ${res.status} in ${formatMs(performance.now() - started)}. Verify with your integration provider that this is an authorized game interface.` : `Endpoint responded HTTP ${res.status} — not usable as a game integration.` });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      setLiveTest({ ok: false, msg: e instanceof Error && e.name === 'AbortError' ? 'Endpoint timed out after 8s — unreachable.' : `Endpoint unreachable (${e instanceof Error ? e.message : 'network error'}).` });
    } finally {
      setLiveTesting(false);
    }
  };

  const exportAll = () => {
    downloadFile(
      `kahoot-boss-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), profile, settings: { ...settings, apiKey: '', liveApiKey: '' }, sessions, solves, activity }, null, 2),
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
        <Card glow={settings.solverMode === 'api'}>
          <CardHeader
            title="Solver engine"
            subtitle="Choose the brain behind Solve and auto-answer."
            right={settings.solverMode === 'api' ? <Badge tone="cyan"><Bot size={12} /> Cloud</Badge> : <Badge tone="accent"><FlaskConical size={12} /> Local</Badge>}
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => updateSettings({ solverMode: 'local' })} className={`rounded-xl border px-3.5 py-3 text-left transition ${settings.solverMode === 'local' ? 'border-accent/60 bg-accent/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                <span className="block text-sm font-semibold text-ink">Local (offline)</span>
                <span className="mt-0.5 block text-xs text-muted">Math + knowledge + fallback. Free, instant, private.</span>
              </button>
              <button onClick={() => updateSettings({ solverMode: 'api' })} className={`rounded-xl border px-3.5 py-3 text-left transition ${settings.solverMode === 'api' ? 'border-accent2/60 bg-accent2/10' : 'border-line bg-void/50 hover:border-white/20'}`}>
                <span className="block text-sm font-semibold text-ink">Cloud AI (BYOK)</span>
                <span className="mt-0.5 block text-xs text-muted">Your key, OpenAI-compatible endpoint.</span>
              </button>
            </div>

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

        {/* Live integration */}
        <Card>
          <CardHeader
            title="Live game integration"
            subtitle="Only officially permitted endpoints. Empty = live mode honestly disabled."
            right={<Badge tone={settings.liveApiUrl.trim() ? 'warn' : 'muted'}><Radio size={12} /> {settings.liveApiUrl.trim() ? 'Custom URL set' : 'Not configured'}</Badge>}
          />
          <CardBody className="space-y-4">
            <Notice tone="info" title="Authorized interfaces only" body="KAHOOT BOSS does not ship with any unofficial Kahoot connector. If your organization provides a permitted game-data endpoint, configure it here; otherwise leave this empty and use simulation mode." />
            <Field label="Live endpoint URL" hint="Optional. Must be an endpoint you are authorized to use.">
              <Input value={settings.liveApiUrl} onChange={(e) => updateSettings({ liveApiUrl: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Live API key" hint="Optional. Stored only in this browser.">
              <div className="relative">
                <Input type={showLiveKey ? 'text' : 'password'} value={settings.liveApiKey} onChange={(e) => updateSettings({ liveApiKey: e.target.value })} placeholder="…" className="pr-11" />
                <button onClick={() => setShowLiveKey(!showLiveKey)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-ink" title={showLiveKey ? 'Hide key' : 'Show key'}>
                  {showLiveKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <div>
              <Button variant="secondary" loading={liveTesting} onClick={testLiveEndpoint}><Radio size={16} /> Test endpoint reachability</Button>
              {liveTest && (
                <p className={`mt-2 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${liveTest.ok ? 'border-good/30 bg-good/5 text-emerald-200' : 'border-warn/30 bg-warn/5 text-amber-200'}`}>
                  <StatusDot tone={liveTest.ok ? 'good' : 'warn'} />
                  {liveTest.msg}
                </p>
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
