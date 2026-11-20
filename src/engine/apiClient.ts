/* KAHOOT BOSS — backend API client.
   Talks to /api/* (Vercel serverless in production). Every call has a timeout
   and honest error reporting — failures are surfaced, never faked. */

import type { DiagnosticsPayload, HealthPayload, SolveApiPayload } from '../lib/apiContracts';

function apiBase(): string {
  const v = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return v && v.length > 0 ? v.replace(/\/+$/, '') : '/api';
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ data: T; latencyMs: number }> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const latencyMs = performance.now() - started;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const msg =
        (body as { error?: string } | null)?.error ??
        `Request failed with HTTP ${res.status}`;
      const err = new Error(msg) as Error & { status?: number; code?: string };
      err.status = res.status;
      err.code = (body as { code?: string } | null)?.code;
      throw err;
    }
    return { data: body as T, latencyMs };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Request to ${url} timed out after ${timeoutMs} ms.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(timeoutMs = 6000): Promise<{ data: HealthPayload; latencyMs: number }> {
  return fetchJson<HealthPayload>(`${apiBase()}/health`, { method: 'GET' }, timeoutMs);
}

export interface ApiSolveOptions {
  question: string;
  options: string[];
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export async function solveViaApi(opts: ApiSolveOptions): Promise<{ data: SolveApiPayload; latencyMs: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey?.trim()) headers['x-api-key'] = opts.apiKey.trim();
  return fetchJson<SolveApiPayload>(
    `${apiBase()}/solve`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: opts.question,
        options: opts.options,
        baseUrl: opts.baseUrl?.trim() || undefined,
        model: opts.model?.trim() || undefined,
      }),
    },
    opts.timeoutMs ?? 30000,
  );
}

export async function validateSession(pin: string, nickname: string, timeoutMs = 6000): Promise<{ data: DiagnosticsPayload; latencyMs: number }> {
  return fetchJson<DiagnosticsPayload>(
    `${apiBase()}/session`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, nickname }) },
    timeoutMs,
  );
}

export function getApiBase(): string {
  return apiBase();
}
