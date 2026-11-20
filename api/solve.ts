/* POST /api/solve — cloud AI solving via an OpenAI-compatible endpoint.
   Self-contained (no cross-file imports): serverless-safe by construction.
   Uses server env (AI_API_BASE_URL / AI_API_KEY / AI_MODEL) or caller-supplied
   BYOK credentials (x-api-key header + baseUrl/model in body).
   Returns 501 with an honest message when no provider is configured. */

interface SolveBody {
  question?: unknown;
  options?: unknown;
  baseUrl?: unknown;
  model?: unknown;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function send(res: { setHeader(k: string, v: string): void; statusCode: number; end(b: string): void }, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: { on(e: string, cb: (...a: never[]) => void): void }): Promise<T> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', ((c: Buffer) => chunks.push(Buffer.from(c))) as never);
    req.on('end', (() => resolve()) as never);
    req.on('error', ((e: Error) => reject(e)) as never);
  });
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function extractJson(text: string): { bestIndex: number; confidence: number; explanation: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { bestIndex?: unknown; confidence?: unknown; explanation?: unknown };
    if (typeof parsed.bestIndex !== 'number' || !Number.isInteger(parsed.bestIndex)) return null;
    if (typeof parsed.confidence !== 'number' || typeof parsed.explanation !== 'string') return null;
    return { bestIndex: parsed.bestIndex, confidence: parsed.confidence, explanation: parsed.explanation };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, { status: 'error', error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body: SolveBody;
  try {
    body = await readJsonBody<SolveBody>(req);
  } catch {
    send(res, 400, { status: 'error', error: 'Invalid JSON body.', code: 'BAD_JSON' });
    return;
  }

  if (typeof body.question !== 'string' || body.question.trim().length < 4 || body.question.trim().length > 500) {
    send(res, 422, { status: 'error', error: 'Question must be 4–500 characters.', code: 'INVALID_QUESTION' });
    return;
  }
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 4) {
    send(res, 422, { status: 'error', error: 'Provide 2–4 answer options.', code: 'INVALID_OPTIONS' });
    return;
  }
  const options = (body.options as unknown[]).map((o) => String(o).slice(0, 120));
  if (options.some((o) => o.trim().length === 0)) {
    send(res, 422, { status: 'error', error: 'Answer options must not be empty.', code: 'INVALID_OPTIONS' });
    return;
  }

  const headerKey = typeof req.headers?.['x-api-key'] === 'string' ? (req.headers['x-api-key'] as string).trim() : '';
  const baseUrl = (
    (typeof body.baseUrl === 'string' && body.baseUrl.trim()) ||
    process.env.AI_API_BASE_URL ||
    ''
  ).replace(/\/+$/, '');
  const apiKey = headerKey || process.env.AI_API_KEY || '';
  const model = (typeof body.model === 'string' && body.model.trim()) || process.env.AI_MODEL || 'gpt-4o-mini';

  if (!baseUrl || !apiKey) {
    send(res, 501, {
      status: 'error',
      error: 'Cloud AI is not configured.',
      code: 'AI_NOT_CONFIGURED',
      hint: 'Add an API key in Settings → Solver Engine (BYOK), or set AI_API_BASE_URL + AI_API_KEY on the server. The offline engine remains available.',
    });
    return;
  }

  const started = Date.now();
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a precise quiz-solving assistant. Given a multiple-choice question, pick the single most likely correct option. Reply with ONLY a JSON object: {"bestIndex": <0-based index>, "confidence": <0..1>, "explanation": "<one or two sentences>"}. No other text.',
    },
    {
      role: 'user',
      content: `Question: ${body.question}\nOptions:\n${options.map((o, i) => `${i}. ${o}`).join('\n')}`,
    },
  ];

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 300 }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      send(res, 502, {
        status: 'error',
        error: `AI provider returned HTTP ${upstream.status}.`,
        code: 'PROVIDER_ERROR',
        hint: text.slice(0, 300) || 'Check the endpoint URL, API key and model name in Settings.',
      });
      return;
    }
    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed || parsed.bestIndex < 0 || parsed.bestIndex >= options.length) {
      send(res, 502, {
        status: 'error',
        error: 'AI provider returned an unparseable answer.',
        code: 'PROVIDER_BAD_RESPONSE',
        hint: 'Try again or switch the solver mode to Local (offline).',
      });
      return;
    }
    send(res, 200, {
      status: 'ok',
      bestIndex: parsed.bestIndex,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      explanation: parsed.explanation.slice(0, 600),
      method: 'api',
      model,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    send(res, 502, {
      status: 'error',
      error: e instanceof Error && e.name === 'AbortError' ? 'AI provider request timed out.' : 'Could not reach the AI provider.',
      code: 'PROVIDER_UNREACHABLE',
      hint: 'Check the endpoint URL and your network connection, or switch to Local mode.',
    });
  }
};
