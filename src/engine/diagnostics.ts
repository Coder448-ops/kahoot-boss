/* KAHOOT BOSS — connection diagnostics.
   Every check performs a REAL measurement; nothing is simulated. */

import type { DiagnosticCheck, Settings } from '../lib/types';
import { checkHealth } from './apiClient';
import { liveApi, resolveLiveBase } from './liveClient';
import { solverSelfTest } from './solver';

export type DiagnosticProgress = (check: DiagnosticCheck) => void;

function entry(id: string, label: string): DiagnosticCheck {
  return { id, label, status: 'pending', detail: 'Waiting…', latencyMs: null };
}

async function checkOnline(): Promise<DiagnosticCheck> {
  const c = entry('online', 'Network reachability');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ...c, status: 'fail', detail: 'Browser reports offline. Connect to a network.' };
  }
  return { ...c, status: 'pass', detail: 'Browser is online.' };
}

async function checkStorage(): Promise<DiagnosticCheck> {
  const c = entry('storage', 'Local persistence');
  try {
    const key = '__kb_probe__';
    localStorage.setItem(key, '1');
    const v = localStorage.getItem(key);
    localStorage.removeItem(key);
    if (v !== '1') throw new Error('read-back mismatch');
    return { ...c, status: 'pass', detail: 'localStorage read/write verified — settings and history will persist.' };
  } catch {
    return { ...c, status: 'fail', detail: 'localStorage is unavailable — settings and history cannot persist in this browser context.' };
  }
}

async function checkSolver(): Promise<DiagnosticCheck> {
  const c = entry('solver', 'AI engine self-test');
  const t = solverSelfTest();
  return {
    ...c,
    status: t.passed ? 'pass' : 'fail',
    detail: t.detail,
    latencyMs: t.latencyMs,
  };
}

async function checkBackend(): Promise<DiagnosticCheck> {
  const c = entry('backend', 'Backend API (/api/health)');
  try {
    const { data, latencyMs } = await checkHealth(6000);
    return {
      ...c,
      status: 'pass',
      detail: `Backend reachable — ${data.service} v${data.version}, mode ${data.mode}.`,
      latencyMs,
    };
  } catch (e) {
    return {
      ...c,
      status: 'warn',
      detail: `Backend API unreachable (${e instanceof Error ? e.message : 'unknown error'}). Local engine remains fully operational.`,
    };
  }
}

async function checkLive(settings: Settings): Promise<DiagnosticCheck> {
  const c = entry('live', 'Live connector backend');
  const base = resolveLiveBase(settings.liveBackendUrl);
  try {
    const { data, latencyMs } = await liveApi.health(base, 9000);
    if (!data.kahootReachable) {
      return {
        ...c,
        status: 'warn',
        detail: `Connector v${data.version} (${data.protocol}) is up at ${base}, but it cannot reach Kahoot from its network — joins will fail until Kahoot is reachable. Simulation mode is unaffected.`,
        latencyMs,
      };
    }
    if (data.sessionActive) {
      return {
        ...c,
        status: 'warn',
        detail: `Connector is online (Kahoot reachable in ${Math.round(data.kahootLatencyMs ?? 0)} ms) but busy with another live session (${data.sessionState}).`,
        latencyMs,
      };
    }
    return {
      ...c,
      status: 'pass',
      detail: `Connector v${data.version} online — Kahoot reachable in ${Math.round(data.kahootLatencyMs ?? 0)} ms, session slot free.`,
      latencyMs,
    };
  } catch (e) {
    return {
      ...c,
      status: 'warn',
      detail: `Live connector unreachable at ${base} (${e instanceof Error ? e.message : 'network error'}). Start it with \`npm run server\`, or set its URL in Settings. Simulation mode remains available.`,
    };
  }
}

/** Run all checks sequentially, streaming progress. */
export async function runDiagnostics(settings: Settings, onProgress: DiagnosticProgress): Promise<DiagnosticCheck[]> {
  const results: DiagnosticCheck[] = [];
  const steps = [checkOnline, checkStorage, checkSolver, checkBackend, () => checkLive(settings)];
  for (const step of steps) {
    const pending = entry(step.name, '…');
    void pending;
    const r = await step();
    results.push(r);
    onProgress(r);
  }
  return results;
}
