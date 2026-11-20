/* KAHOOT BOSS — connection diagnostics.
   Every check performs a REAL measurement; nothing is simulated. */

import type { DiagnosticCheck, Settings } from '../lib/types';
import { checkHealth, checkLiveStatus } from './apiClient';
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

async function checkLive(_settings: Settings): Promise<DiagnosticCheck> {
  const c = entry('live', 'Live game integration');
  try {
    const { data } = await checkLiveStatus(6000);
    if (data.liveEnabled) {
      return { ...c, status: 'pass', detail: 'Live integration endpoint is configured server-side and reports ready.' };
    }
    return {
      ...c,
      status: 'warn',
      detail: 'No authorized live-game endpoint is configured (LIVE_GAME_API_URL is empty). Simulation mode is available; live mode stays disabled until an authorized integration is configured.',
    };
  } catch {
    return {
      ...c,
      status: 'warn',
      detail: 'Live-integration status could not be verified because the backend API is unreachable. Simulation mode remains available.',
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
