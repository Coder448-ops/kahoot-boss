/* KAHOOT BOSS — input validation (single source of truth) */

export interface ValidationResult {
  ok: boolean;
  error: string | null;
}

export function validatePin(pin: string): ValidationResult {
  const v = pin.trim();
  if (!v) return { ok: false, error: 'Game PIN is required.' };
  if (!/^\d+$/.test(v)) return { ok: false, error: 'Game PIN must contain digits only.' };
  if (v.length < 4 || v.length > 10)
    return { ok: false, error: 'Game PIN must be between 4 and 10 digits.' };
  return { ok: true, error: null };
}

export function validateNickname(name: string): ValidationResult {
  const v = name.trim();
  if (!v) return { ok: false, error: 'Nickname is required.' };
  if (v.length < 2) return { ok: false, error: 'Nickname must be at least 2 characters.' };
  if (v.length > 15) return { ok: false, error: 'Nickname must be 15 characters or fewer.' };
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(v))
    return { ok: false, error: 'Nickname may only contain letters, numbers, spaces and _ . -' };
  return { ok: true, error: null };
}

export function validateQuestionText(text: string): ValidationResult {
  const v = text.trim();
  if (!v) return { ok: false, error: 'Question text is required.' };
  if (v.length < 4) return { ok: false, error: 'Question text is too short.' };
  if (v.length > 500) return { ok: false, error: 'Question text must be 500 characters or fewer.' };
  return { ok: true, error: null };
}

export function validateOptions(options: string[]): ValidationResult {
  const filled = options.map((o) => o.trim()).filter(Boolean);
  if (filled.length < 2) return { ok: false, error: 'Provide at least 2 answer options.' };
  if (filled.length > 4) return { ok: false, error: 'A maximum of 4 answer options is supported.' };
  const lower = filled.map((o) => o.toLowerCase());
  if (new Set(lower).size !== lower.length)
    return { ok: false, error: 'Answer options must be unique.' };
  for (const o of filled) {
    if (o.length > 120) return { ok: false, error: 'Each option must be 120 characters or fewer.' };
  }
  return { ok: true, error: null };
}

export function validateApiUrl(url: string): ValidationResult {
  const v = url.trim().replace(/\/+$/, '');
  if (!v) return { ok: true, error: null }; // optional
  if (v.startsWith('/')) return { ok: true, error: null }; // relative backend path
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      return { ok: false, error: 'API URL must use http(s).' };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'API URL is not valid.' };
  }
}

export function validateDisplayName(name: string): ValidationResult {
  const v = name.trim();
  if (!v) return { ok: false, error: 'Display name is required.' };
  if (v.length > 30) return { ok: false, error: 'Display name must be 30 characters or fewer.' };
  return { ok: true, error: null };
}
