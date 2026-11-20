/* KAHOOT BOSS — modular AI solving engine (offline-first).
   Pipeline: language detect -> math solver -> knowledge base -> statistical fallback.
   Every result carries a method label + confidence so guesses are never
   presented as certainties. */

import type { SolveResult, SolverMethod } from '../lib/types';
import { detectLanguage } from './language';
import { evaluateExpression, extractMathExpression, numbersClose, parseNumericOption } from './mathSolver';
import { KNOWLEDGE_BASE } from './knowledgeBase';
import { fuzzyIncludes, normalizeText, tokenOverlap, tokens } from '../lib/utils';

export interface SolverInput {
  question: string;
  options: string[];
}

function emptyScores(n: number, fill = 0): number[] {
  return new Array(n).fill(fill);
}

/** Stage 1 — exact math evaluation. */
function tryMath(question: string, options: string[], reasoning: string[]): { index: number; value: number; expr: string } | null {
  const expr = extractMathExpression(question);
  if (!expr) {
    reasoning.push('Math stage: no arithmetic expression detected in the question.');
    return null;
  }
  reasoning.push(`Math stage: detected expression "${expr}".`);
  const value = evaluateExpression(expr);
  if (value === null) {
    reasoning.push('Math stage: expression could not be evaluated safely — skipping.');
    return null;
  }
  reasoning.push(`Math stage: evaluated result = ${value}.`);
  for (let i = 0; i < options.length; i++) {
    const opt = parseNumericOption(options[i]);
    if (opt !== null && numbersClose(opt, value)) {
      reasoning.push(`Math stage: option ${i + 1} ("${options[i]}") matches the computed result exactly.`);
      return { index: i, value, expr };
    }
  }
  reasoning.push('Math stage: computed result does not match any numeric option — skipping.');
  return null;
}

/** Stage 2 — curated knowledge base. */
function tryKnowledge(question: string, options: string[], reasoning: string[]): { index: number; confidence: number; explanation: string } | null {
  const qNorm = normalizeText(question);
  const qTokens = tokens(question);
  let best: { entry: (typeof KNOWLEDGE_BASE)[number]; score: number } | null = null;

  for (const entry of KNOWLEDGE_BASE) {
    for (const trigger of entry.triggers) {
      const tNorm = normalizeText(trigger);
      let score = 0;
      if (qNorm.includes(tNorm)) score = 0.95;
      else {
        const overlap = tokenOverlap(qTokens, tokens(trigger));
        if (overlap >= 0.6) score = 0.55 + overlap * 0.3;
      }
      if (score > 0 && (!best || score > best.score)) best = { entry, score };
    }
  }

  if (!best) {
    reasoning.push('Knowledge stage: no fact entry matched this question.');
    return null;
  }
  reasoning.push(`Knowledge stage: matched fact "${best.entry.triggers[0]}" (match ${(best.score * 100).toFixed(0)}%).`);

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (fuzzyIncludes(opt, best.entry.answer) || best.entry.aliases.some((a) => fuzzyIncludes(opt, a))) {
      reasoning.push(`Knowledge stage: option ${i + 1} ("${opt}") matches the known answer "${best.entry.answer}".`);
      return { index: i, confidence: Math.min(0.93, best.score), explanation: best.entry.explanation };
    }
  }
  reasoning.push(`Knowledge stage: known answer is "${best.entry.answer}" but it is not among the options — skipping.`);
  return null;
}

/** Stage 3 — honest statistical fallback. Low confidence, clearly labeled. */
function heuristicFallback(question: string, options: string[], reasoning: string[]): { index: number; scores: number[] } {
  const qTokens = tokens(question);
  const scores = options.map((opt) => {
    const oTokens = tokens(opt);
    const overlap = tokenOverlap(qTokens, oTokens);
    // Prefer options sharing distinctive vocabulary with the question,
    // with a mild preference for mid-length, specific answers.
    const lenFactor = clamp01(1 - Math.abs(opt.length - 14) / 40) * 0.15;
    return overlap * 0.85 + lenFactor;
  });
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  reasoning.push(
    `Fallback stage: no exact solution found. Ranked options by keyword overlap with the question; ` +
      `option ${best + 1} scored highest (${scores[best].toFixed(2)}). This is a statistical guess, not a verified answer.`,
  );
  return { index: best, scores };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function solveLocal(input: SolverInput): SolveResult {
  const started = performance.now();
  const question = input.question.trim();
  const options = input.options.map((o) => o.trim());
  const reasoning: string[] = [];

  const lang = detectLanguage(question);
  reasoning.push(`Detected question language: ${lang.label} (${(lang.confidence * 100).toFixed(0)}% confidence).`);

  // --- Stage 1: math ---
  const math = tryMath(question, options, reasoning);
  if (math) {
    const scores = emptyScores(options.length, 0.05);
    scores[math.index] = 0.97;
    return {
      bestIndex: math.index,
      confidence: 0.97,
      explanation: `Evaluated "${math.expr}" = ${math.value}. Option ${math.index + 1} matches the computed result exactly.`,
      method: 'math',
      language: lang.label,
      languageCode: lang.code,
      scores,
      reasoning,
      latencyMs: performance.now() - started,
      viaApi: false,
    };
  }

  // --- Stage 2: knowledge ---
  const kb = tryKnowledge(question, options, reasoning);
  if (kb) {
    const scores = emptyScores(options.length, 0.08);
    scores[kb.index] = kb.confidence;
    return {
      bestIndex: kb.index,
      confidence: kb.confidence,
      explanation: kb.explanation,
      method: 'knowledge',
      language: lang.label,
      languageCode: lang.code,
      scores,
      reasoning,
      latencyMs: performance.now() - started,
      viaApi: false,
    };
  }

  // --- Stage 3: fallback ---
  const fb = heuristicFallback(question, options, reasoning);
  const confidence = clamp01(0.22 + fb.scores[fb.index] * 0.35);
  const norm = fb.scores.map((s) => clamp01(0.1 + s * 0.5));
  norm[fb.index] = confidence;
  return {
    bestIndex: fb.index,
    confidence,
    explanation:
      'No exact mathematical solution or verified fact matched. The engine ranked the options by keyword relevance — treat this as a low-confidence suggestion and verify it independently.',
    method: 'heuristic',
    language: lang.label,
    languageCode: lang.code,
    scores: norm,
    reasoning,
    latencyMs: performance.now() - started,
    viaApi: false,
  };
}

/** Self-test used by diagnostics + engine status. Returns true only if known items solve correctly. */
export function solverSelfTest(): { passed: boolean; detail: string; latencyMs: number } {
  const started = performance.now();
  try {
    const a = solveLocal({ question: 'What is 12 × 8?', options: ['86', '96', '104', '88'] });
    const b = solveLocal({ question: 'What is the capital of France?', options: ['Berlin', 'Paris', 'Madrid', 'Rome'] });
    const okA = a.bestIndex === 1 && a.method === 'math';
    const okB = b.bestIndex === 1 && b.method === 'knowledge';
    const latencyMs = performance.now() - started;
    if (okA && okB) return { passed: true, detail: `Math + knowledge stages verified in ${latencyMs.toFixed(1)} ms.`, latencyMs };
    return { passed: false, detail: `Self-test mismatch (math=${a.bestIndex}/${a.method}, kb=${b.bestIndex}/${b.method}).`, latencyMs };
  } catch (e) {
    return { passed: false, detail: `Self-test threw: ${e instanceof Error ? e.message : 'unknown error'}`, latencyMs: performance.now() - started };
  }
}

export function methodLabel(method: SolverMethod | 'manual'): string {
  switch (method) {
    case 'math': return 'Math solver';
    case 'knowledge': return 'Knowledge base';
    case 'heuristic': return 'Statistical fallback';
    case 'api': return 'Cloud AI';
    case 'manual': return 'Manual pick';
    default: return 'Unresolved';
  }
}
