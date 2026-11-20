/* KAHOOT BOSS — server-side input validation for the live connector.
   Mirrors the client rules so malformed requests are rejected with clear errors. */

export interface Check {
  ok: boolean;
  error: string | null;
}

/** Live Kahoot PINs are 6–10 digits (Kahoot issues a fresh numeric PIN per game). */
export function validateLivePin(pin: unknown): Check {
  if (typeof pin !== 'string') return { ok: false, error: 'Game PIN must be a string of digits.' };
  const v = pin.trim();
  if (!/^\d+$/.test(v)) return { ok: false, error: 'Game PIN must contain digits only.' };
  if (v.length < 6 || v.length > 10)
    return { ok: false, error: 'Game PIN must be 6–10 digits. Kahoot PINs are issued per game by the host.' };
  return { ok: true, error: null };
}

export function validateLiveNickname(nickname: unknown): Check {
  if (typeof nickname !== 'string') return { ok: false, error: 'Nickname must be a string.' };
  const v = nickname.trim();
  if (v.length < 2) return { ok: false, error: 'Nickname must be at least 2 characters.' };
  if (v.length > 15) return { ok: false, error: 'Nickname must be 15 characters or fewer.' };
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(v))
    return { ok: false, error: 'Nickname may only contain letters, numbers, spaces and _ . -' };
  return { ok: true, error: null };
}

/** 2-step join sequence: four shape indices (0–3) in host-screen order. */
export function validateTwoFactorSequence(seq: unknown): Check {
  if (typeof seq !== 'string') return { ok: false, error: 'Sequence must be a string.' };
  if (!/^[0-3]{4}$/.test(seq.trim()))
    return { ok: false, error: 'Sequence must be exactly 4 shape indices (each 0–3) in the order shown on the host screen.' };
  return { ok: true, error: null };
}

export function validateChoice(choice: unknown, maxChoices: number | null): Check {
  if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0)
    return { ok: false, error: 'Choice must be a non-negative integer.' };
  if (maxChoices !== null && choice >= maxChoices)
    return { ok: false, error: `Choice ${choice} is out of range for this question (${maxChoices} options, 0–${maxChoices - 1}).` };
  return { ok: true, error: null };
}
