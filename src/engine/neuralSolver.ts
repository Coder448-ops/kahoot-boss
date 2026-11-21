/* KAHOOT BOSS — on-device neural solver (no API key, no cloud).
   Runs a real transformer model (sentence embeddings) 100% in the browser
   via Transformers.js + ONNX WebAssembly. The question and each option are
   embedded locally; the option closest to the question in vector space wins.

   First use downloads the model (~6 MB quantized, cached by the browser
   afterwards). Everything after that — including inference — works offline.
   Statuses and errors are always reported honestly; nothing is faked. */

import type { SolveResult } from '../lib/types';
import { detectLanguage } from './language';
import { useStore } from '../store/useStore';

export const NEURAL_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const NEURAL_MODEL_SIZE = '~6 MB (quantized)';
export const NEURAL_MODEL_PARAMS = '22.7M parameters · MiniLM';

/** Minimal structural type for the dynamically imported extractor. */
interface EmbeddingOutput {
  tolist(): number[][];
  dims: number[];
}
type ExtractorFn = (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<EmbeddingOutput>;

let extractorPromise: Promise<ExtractorFn> | null = null;

export class NeuralError extends Error {
  code: 'MODEL_LOAD_FAILED' | 'INFERENCE_FAILED' | 'MODEL_UNAVAILABLE';
  constructor(code: NeuralError['code'], message: string) {
    super(message);
    this.name = 'NeuralError';
    this.code = code;
  }
}

function setNeural(patch: Partial<{ status: 'idle' | 'loading' | 'ready' | 'error'; progress: number; file: string | null; error: string | null }>): void {
  try {
    useStore.getState().setNeural(patch);
  } catch {
    /* store unavailable (tests) — ignore */
  }
}

function progressHandler(info: { status?: string; file?: string; name?: string; progress?: number; loaded?: number; total?: number }): void {
  const status = info.status ?? '';
  if (status === 'progress') {
    const pct = typeof info.progress === 'number' ? info.progress : 0;
    setNeural({ status: 'loading', progress: Math.round(pct), file: info.file ?? info.name ?? null });
  } else if (status === 'initiate' || status === 'download') {
    setNeural({ status: 'loading', file: info.file ?? info.name ?? null });
  } else if (status === 'ready') {
    setNeural({ status: 'ready', progress: 100, file: null, error: null });
  }
}

/**
 * Load the on-device model (idempotent; concurrent callers share one load).
 * Resolves when inference is possible, rejects with NeuralError otherwise.
 */
export function ensureNeuralModel(): Promise<ExtractorFn> {
  if (!extractorPromise) {
    setNeural({ status: 'loading', progress: 0, file: null, error: null });
    extractorPromise = (async (): Promise<ExtractorFn> => {
      try {
        // Dynamic import: the ML runtime (~1 MB JS) loads only on first neural use.
        const { pipeline, env } = await import('@xenova/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        // Single-threaded WASM: multithreading needs COOP/COEP headers which
        // plain static hosting doesn't send. Slower, but works everywhere.
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = 1;
        }
        // Quantized first (small + fast); fall back to full precision if the
        // quantized weights are unavailable for this revision.
        try {
          const ext = await pipeline('feature-extraction', NEURAL_MODEL_ID, {
            quantized: true,
            progress_callback: progressHandler,
          });
          return ext as unknown as ExtractorFn;
        } catch (e) {
          if (!isNeuralReady()) {
            setNeural({ file: 'quantized weights unavailable — trying full precision…' });
            const ext = await pipeline('feature-extraction', NEURAL_MODEL_ID, {
              quantized: false,
              progress_callback: progressHandler,
            });
            return ext as unknown as ExtractorFn;
          }
          throw e;
        }
      } catch (e) {
        extractorPromise = null;
        const msg = e instanceof Error ? e.message : 'unknown error';
        const friendly =
          /fetch|network|load failed|failed to fetch/i.test(msg)
            ? `Could not download the on-device model (${NEURAL_MODEL_ID}). Check your internet connection and retry — the model host (Hugging Face CDN) must be reachable once; afterwards it runs offline.`
            : `On-device model failed to start: ${msg}`;
        setNeural({ status: 'error', error: friendly, file: null });
        throw new NeuralError('MODEL_LOAD_FAILED', friendly);
      }
    })();
    extractorPromise.then(
      () => setNeural({ status: 'ready', progress: 100, file: null, error: null }),
      () => { /* error state already set above */ },
    );
  }
  return extractorPromise;
}

/** True only if a previous ensureNeuralModel() fully succeeded. */
export function isNeuralReady(): boolean {
  try {
    return useStore.getState().neural.status === 'ready';
  } catch {
    return false;
  }
}

/** Pure ranking math — exported for unit testing. */
export function rankSimilarities(sims: number[]): { bestIndex: number; runnerUp: number; margin: number; confidence: number; scores: number[] } {
  let best = 0;
  for (let i = 1; i < sims.length; i++) if (sims[i] > sims[best]) best = i;
  let runnerUp = -1;
  for (let i = 0; i < sims.length; i++) {
    if (i === best) continue;
    if (runnerUp === -1 || sims[i] > sims[runnerUp]) runnerUp = i;
  }
  const margin = runnerUp === -1 ? 1 : Math.max(0, sims[best] - sims[runnerUp]);
  // Honest calibration: similarity is a relevance signal, never proof.
  // Clear winner ≈ 0.8+, toss-up ≈ 0.25. Capped — never claims certainty.
  const confidence = Math.min(0.88, Math.max(0.25, 0.25 + margin * 1.6));
  // Softmax distribution for the score bars (temperature tuned for [-1, 1] cosines).
  const t = 0.12;
  const exps = sims.map((s) => Math.exp(s / t));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const scores = exps.map((e) => e / sum);
  scores[best] = confidence;
  return { bestIndex: best, runnerUp, margin, confidence, scores };
}

/**
 * Solve with the on-device model (loads it first if needed, with progress).
 * Throws NeuralError on failure — callers must surface the message honestly.
 */
export async function solveNeural(question: string, options: string[]): Promise<SolveResult> {
  const started = performance.now();
  const q = question.trim();
  const opts = options.map((o) => o.trim());
  const lang = detectLanguage(q);

  let extractor: ExtractorFn;
  try {
    extractor = await ensureNeuralModel();
  } catch (e) {
    if (e instanceof NeuralError) throw e;
    throw new NeuralError('MODEL_UNAVAILABLE', 'On-device model is not available.');
  }

  let sims: number[];
  try {
    const output = await extractor([q, ...opts], { pooling: 'mean', normalize: true });
    const rows = output.tolist();
    if (!Array.isArray(rows) || rows.length !== opts.length + 1) {
      throw new Error(`expected ${opts.length + 1} embeddings, got ${Array.isArray(rows) ? rows.length : 'none'}`);
    }
    const [qVec, ...oVecs] = rows;
    sims = oVecs.map((v) => {
      let dot = 0;
      const n = Math.min(qVec.length, v.length);
      for (let i = 0; i < n; i++) dot += qVec[i] * v[i];
      return dot;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    throw new NeuralError('INFERENCE_FAILED', `On-device inference failed: ${msg}`);
  }

  const { bestIndex, margin, confidence, scores } = rankSimilarities(sims);
  const simReport = opts.map((o, i) => `option ${i + 1} (“${o.slice(0, 40)}${o.length > 40 ? '…' : ''}”) similarity ${sims[i].toFixed(3)}`);
  return {
    bestIndex,
    confidence,
    explanation:
      `On-device neural model (${NEURAL_MODEL_ID}) embedded the question and each option locally — no cloud, no API key. ` +
      `Option ${bestIndex + 1} is semantically closest (similarity ${sims[bestIndex].toFixed(3)}, margin +${margin.toFixed(3)} over the runner-up). ` +
      `Similarity measures relevance, not truth — verify high-stakes answers independently.`,
    method: 'neural',
    language: lang.label,
    languageCode: lang.code,
    scores,
    reasoning: [
      `Neural stage: embedded question + ${opts.length} options with ${NEURAL_MODEL_ID} (quantized, in-browser ONNX).`,
      `Neural stage: cosine similarities — ${simReport.join('; ')}.`,
      `Neural stage: picked option ${bestIndex + 1} with margin ${margin.toFixed(3)} → confidence ${(confidence * 100).toFixed(0)}% (capped at 88%: similarity is a signal, not proof).`,
    ],
    latencyMs: performance.now() - started,
    viaApi: false,
  };
}

/**
 * Background-friendly attempt: runs inference only if the model is already
 * loaded; otherwise kicks off a background load and returns null so callers
 * can fall back (e.g. to the instant local engine) without stalling.
 */
export async function trySolveNeural(question: string, options: string[]): Promise<SolveResult | null> {
  if (!isNeuralReady() || !extractorPromise) {
    void ensureNeuralModel().catch(() => { /* error state is stored; caller fell back already */ });
    return null;
  }
  try {
    const extractor = await extractorPromise;
    const started = performance.now();
    const q = question.trim();
    const opts = options.map((o) => o.trim());
    const lang = detectLanguage(q);
    const output = await extractor([q, ...opts], { pooling: 'mean', normalize: true });
    const rows = output.tolist();
    if (!Array.isArray(rows) || rows.length !== opts.length + 1) return null;
    const [qVec, ...oVecs] = rows;
    const sims = oVecs.map((v) => {
      let dot = 0;
      const n = Math.min(qVec.length, v.length);
      for (let i = 0; i < n; i++) dot += qVec[i] * v[i];
      return dot;
    });
    const { bestIndex, margin, confidence, scores } = rankSimilarities(sims);
    return {
      bestIndex,
      confidence,
      explanation: `On-device neural model picked option ${bestIndex + 1} by semantic similarity (${sims[bestIndex].toFixed(3)}, margin +${margin.toFixed(3)}). No cloud used.`,
      method: 'neural',
      language: lang.label,
      languageCode: lang.code,
      scores,
      reasoning: [`Neural stage: option ${bestIndex + 1} closest to the question (margin ${margin.toFixed(3)}).`],
      latencyMs: performance.now() - started,
      viaApi: false,
    };
  } catch {
    return null;
  }
}
