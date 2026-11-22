/* KAHOOT BOSS — shared connect / disconnect orchestration.
   Simulation mode attaches to the local test environment.
   Live mode performs a REAL join through the connector backend
   (reserve/session -> challenge -> CometD -> login). A "connected" live
   status is only ever set after the backend confirms the join. */

import { useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import { validateNickname, validatePin } from '../lib/validation';
import { validateSession } from '../engine/apiClient';
import { LiveBackendError } from '../engine/liveClient';
import { resolveLiveRuntime } from '../engine/directLive';

export interface ConnectInput {
  pin: string;
  nickname: string;
  mode: 'simulation' | 'live';
}

export function useConnect() {
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const setConnection = useStore((s) => s.setConnection);
  const pushActivity = useStore((s) => s.pushActivity);
  const pushToast = useStore((s) => s.pushToast);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const finishSession = useStore((s) => s.finishSession);
  const disconnectStore = useStore((s) => s.disconnect);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ pin?: string; nickname?: string }>({});

  const connect = useCallback(
    async (input: ConnectInput): Promise<boolean> => {
      // Live Kahoot PINs are 6–10 digits; simulation accepts the wider test range.
      const pinCheck = validatePin(input.pin, input.mode === 'live' ? 6 : 4);
      const nickCheck = validateNickname(input.nickname);
      setErrors({ pin: pinCheck.error ?? undefined, nickname: nickCheck.error ?? undefined });
      if (!pinCheck.ok || !nickCheck.ok) return false;

      const pin = input.pin.trim();
      const nickname = input.nickname.trim();
      setBusy(true);

      try {
        if (input.mode === 'live') {
          return await connectLive(pin, nickname);
        }
        return await connectSimulation(pin, nickname);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.liveMode, settings.liveBackendUrl, setConnection, pushActivity, pushToast],
  );

  const connectSimulation = async (pin: string, nickname: string): Promise<boolean> => {
    setConnection({ status: 'connecting', pin, nickname, mode: 'simulation', detail: 'Contacting test environment…', lastError: null });
    try {
      let latencyMs: number | null = null;
      let via: 'backend' | 'local' = 'local';
      try {
        const r = await validateSession(pin, nickname, 5000);
        latencyMs = r.latencyMs;
        via = 'backend';
      } catch {
        via = 'local';
      }
      await new Promise((r) => setTimeout(r, 450));
      setConnection({
        status: 'connected',
        detail: via === 'backend' ? `Test environment ready (${Math.round(latencyMs ?? 0)} ms, validated by backend).` : 'Test environment ready (validated locally — backend unreachable).',
        latencyMs,
        connectedAt: Date.now(),
      });
      pushActivity('connection', `Connected (simulation) · PIN ${pin} · ${nickname} · validated ${via === 'backend' ? 'by backend' : 'locally'}`);
      pushToast({ title: 'Connected to test environment', body: `PIN ${pin} · player "${nickname}"`, tone: 'success' });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection failed.';
      setConnection({ status: 'error', detail: msg, lastError: msg, connectedAt: null });
      pushActivity('connection', `Connection failed for PIN ${pin} — ${msg}`);
      pushToast({ title: 'Connection failed', body: msg, tone: 'error' });
      return false;
    }
  };

  const connectLive = async (pin: string, nickname: string): Promise<boolean> => {
    const { api, base, mode } = resolveLiveRuntime(settings);
    const via = mode === 'direct' ? 'directly (browser → Kahoot via the reserve relay)' : `via connector ${base}`;
    setConnection({ status: 'connecting', pin, nickname, mode: 'live', detail: `Joining live game ${pin} ${via}…`, lastError: null });

    // Step 1: the transport must be up (connector backend, or relay+Kahoot probe in direct mode).
    try {
      const { data: health } = await api.health(base, mode === 'direct' ? 15000 : 8000);
      if (health.sessionActive) {
        const holder = mode === 'direct' ? 'This browser' : 'Connector';
        const msg = `${holder} already hosts an active live session (${health.sessionState}). Leave it before joining another — one player at a time.`;
        setConnection({ status: 'error', detail: msg, lastError: msg, connectedAt: null });
        pushActivity('connection', `Live join refused — ${mode} backend busy (${health.sessionState})`);
        pushToast({ title: mode === 'direct' ? 'Session busy' : 'Connector busy', body: msg, tone: 'warn' });
        return false;
      }
      if (!health.kahootReachable) {
        pushToast({
          title: mode === 'direct' ? 'Direct mode reports Kahoot unreachable' : 'Connector reports Kahoot unreachable',
          body: `${health.kahootProbeNote} Attempting the join anyway — the join itself is the ground truth.`,
          tone: 'warn',
        });
      }
    } catch (e) {
      const err = e as LiveBackendError;
      const msg = mode === 'direct'
        ? `Direct live mode cannot reach Kahoot: ${err.message} Simulation mode remains available.`
        : `Live connector unreachable at ${base}. Start it with \`npm run server\` (or set the connector URL in Settings). Simulation mode remains available.`;
      setConnection({ status: 'error', detail: msg, lastError: err.message, connectedAt: null });
      pushActivity('connection', mode === 'direct' ? 'Live join failed — direct mode cannot reach Kahoot' : `Live join failed — connector unreachable at ${base}`);
      pushToast({ title: mode === 'direct' ? 'Direct mode unreachable' : 'Connector unreachable', body: mode === 'direct' ? err.message : `No live backend at ${base}.`, tone: 'error' });
      return false;
    }

    // Step 2: the real join (reserve -> challenge -> CometD -> login).
    setConnection({ status: 'connecting', pin, nickname, mode: 'live', detail: `Reserving session for PIN ${pin} with Kahoot…`, lastError: null });
    try {
      const { data, latencyMs } = await api.join(base, pin, nickname, 75000);
      if (data.status === 'awaitingTwoFactor') {
        setConnection({
          status: 'connected',
          detail: `Joined PIN ${pin} — the host requires 2-step verification. Complete the pattern in the Automation Center.`,
          latencyMs,
          connectedAt: Date.now(),
        });
        pushActivity('connection', `Live join pending 2-step verification · PIN ${pin} · ${nickname}`);
        pushToast({ title: '2-step verification required', body: 'Complete the host-screen pattern to enter the lobby.', tone: 'warn' });
        return true;
      }
      setConnection({
        status: 'connected',
        detail: `Live join accepted for PIN ${pin} as "${nickname}" in ${Math.round(latencyMs)} ms. Kahoot confirmed the nickname — confirm it appears on the host screen; only the host screen proves the seat.`,
        latencyMs,
        connectedAt: Date.now(),
      });
      pushActivity('connection', `Live join accepted · PIN ${pin} · ${nickname} · ${Math.round(latencyMs)} ms (seat: verify on host screen)`);
      pushToast({ title: 'Join accepted — verify your seat', body: `PIN ${pin} · "${nickname}" — check the host screen for your nickname.`, tone: 'success' });
      return true;
    } catch (e) {
      const err = e as LiveBackendError;
      const msg = err.message || 'Live join failed.';
      setConnection({ status: 'error', detail: msg, lastError: msg, connectedAt: null });
      pushActivity('connection', `Live join failed for PIN ${pin} — ${err.code}: ${msg}`);
      pushToast({ title: 'Live join failed', body: msg, tone: 'error' });
      return false;
    }
  };

  const disconnect = useCallback(
    (reason = 'Disconnected by operator.') => {
      // Best-effort live leave (never blocks the UI, never throws).
      if (connection.mode === 'live' && (connection.status === 'connected' || connection.status === 'error')) {
        const { api, base } = resolveLiveRuntime(settings);
        api.leave(base, 5000).catch(() => undefined);
      }
      const active = sessions.find((s) => s.id === activeSessionId);
      if (active && (active.status === 'running' || active.status === 'paused')) {
        finishSession(active.id, 'stopped');
      }
      disconnectStore(reason);
      pushActivity('connection', reason);
    },
    [sessions, activeSessionId, finishSession, disconnectStore, pushActivity, connection.mode, connection.status, settings.liveMode, settings.liveBackendUrl],
  );

  return { connection, busy, errors, setErrors, connect, disconnect };
}
