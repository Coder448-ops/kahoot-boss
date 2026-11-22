/* KAHOOT BOSS — safe math expression parser + evaluator.
   No eval(). Supports + - * / × ÷ % ^, parentheses, sqrt(), and word operators. */

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'lp' } | { type: 'rp' } | { type: 'fn'; value: string };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
const RIGHT_ASSOC = new Set(['^']);

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/,/g, '');
  let prev: Token | null = null;
  while (i < s.length) {
    const c = s[i];
    // Any JS whitespace (space, tab, newline, NBSP, en/em spaces, …) — Kahoot
    // challenge offsets arrive with exotic spacing, and skipping whitespace
    // never changes arithmetic semantics.
    if (c === ' ' || /\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = parseFloat(s.slice(i, j));
      if (Number.isNaN(num)) return null;
      tokens.push({ type: 'num', value: num });
      prev = tokens[tokens.length - 1];
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const word = s.slice(i, j).toLowerCase();
      if (word === 'sqrt') {
        tokens.push({ type: 'fn', value: 'sqrt' });
        prev = tokens[tokens.length - 1];
        i = j;
        continue;
      }
      return null;
    }
    if (c === '(') { tokens.push({ type: 'lp' }); prev = tokens[tokens.length - 1]; i++; continue; }
    if (c === ')') { tokens.push({ type: 'rp' }); prev = tokens[tokens.length - 1]; i++; continue; }
    if ('+-*/%^'.includes(c)) {
      // unary minus handling
      if (c === '-' && (prev === null || prev.type === 'op' || prev.type === 'lp')) {
        tokens.push({ type: 'num', value: 0 });
      }
      tokens.push({ type: 'op', value: c });
      prev = tokens[tokens.length - 1];
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

function toRpn(tokens: Token[]): Token[] | null {
  const out: Token[] = [];
  const stack: Token[] = [];
  for (const t of tokens) {
    if (t.type === 'num') out.push(t);
    else if (t.type === 'fn') stack.push(t);
    else if (t.type === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type === 'op') {
          const pTop = PRECEDENCE[top.value] ?? 0;
          const pCur = PRECEDENCE[t.value] ?? 0;
          const shouldPop = RIGHT_ASSOC.has(t.value) ? pTop > pCur : pTop >= pCur;
          if (!shouldPop) break;
          out.push(stack.pop()!);
        } else if (top.type === 'fn') {
          out.push(stack.pop()!);
        } else break;
      }
      stack.push(t);
    } else if (t.type === 'lp') stack.push(t);
    else if (t.type === 'rp') {
      let found = false;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.type === 'lp') { found = true; break; }
        out.push(top);
      }
      if (!found) return null;
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'lp' || top.type === 'rp') return null;
    out.push(top);
  }
  return out;
}

function evalRpn(rpn: Token[]): number | null {
  const stack: number[] = [];
  for (const t of rpn) {
    if (t.type === 'num') stack.push(t.value);
    else if (t.type === 'fn') {
      const a = stack.pop();
      if (a === undefined || a < 0) return null;
      stack.push(Math.sqrt(a));
    } else if (t.type === 'op') {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return null;
      switch (t.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': if (b === 0) return null; stack.push(a / b); break;
        case '%': if (b === 0) return null; stack.push(a % b); break;
        case '^': stack.push(Math.pow(a, b)); break;
        default: return null;
      }
    }
  }
  return stack.length === 1 ? stack[0] : null;
}

/** Normalize a question into a candidate math expression, or null. */
export function extractMathExpression(question: string): string | null {
  const s = question
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/√/g, 'sqrt ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁴/g, '^4')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\b(times|multiplied by)\b/gi, '*')
    .replace(/\bdivided by\b/gi, '/')
    .replace(/\bto the power of\b/gi, '^')
    .replace(/\bsquared\b/gi, '^2');

  // Handle "X% of Y" -> (X/100)*Y
  const pctOf = s.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
  if (pctOf) {
    const val = (parseFloat(pctOf[1]) / 100) * parseFloat(pctOf[2]);
    return `${val}`;
  }

  // Protect the sqrt keyword, then drop every other letter (prose) and stray symbol.
  // Letter gaps become whitespace runs, which lets us split prose from expressions.
  let t = s.replace(/\bsqrt\b/gi, '§');
  t = t.replace(/[^0-9§+\-*/%^().\s]/g, ' ');
  t = t.split('§').join(' sqrt ');

  const candidates = t
    .split(/\s{2,}/)
    .map((c) => c.trim().replace(/[+\-*/%^(]+\s*$/, '').replace(/^\s*[*/%^)]+/, '').trim())
    .filter((c) => /\d/.test(c) && /[+\-*/%^]/.test(c) && /[0-9)]\s*[+\-*/%^]\s*[\d(sqrt]/.test(c));

  if (candidates.length === 0) {
    // Bare sqrt like "sqrt 144" / "sqrt(144)" that never formed an operator pair
    const m = s.match(/sqrt\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/i);
    if (m) return `sqrt(${m[1]})`;
    return null;
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

export function evaluateExpression(expr: string): number | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  const rpn = toRpn(tokens);
  if (!rpn) return null;
  const v = evalRpn(rpn);
  if (v === null || !Number.isFinite(v)) return null;
  return Math.abs(v) < 1e-12 ? 0 : v;
}

/** Parse a numeric answer option ("12", "3.5", "1,000", "25%") into a number, or null. */
export function parseNumericOption(option: string): number | null {
  let s = option.trim().replace(/,/g, '');
  let multiplier = 1;
  if (/%$/.test(s)) {
    multiplier = 1; // keep as the literal number; percentages compared literally
    s = s.slice(0, -1).trim();
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v * multiplier : null;
}

export function numbersClose(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return diff / scale < 1e-9;
}
