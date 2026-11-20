/* KAHOOT BOSS — lightweight language detector (heuristic, offline).
   Detects script + characteristic stop-words for common quiz languages. */

export interface DetectedLanguage {
  code: string;
  label: string;
  confidence: number; // 0..1
}

const STOPWORDS: Record<string, { label: string; words: string[] }> = {
  en: { label: 'English', words: ['the', 'what', 'which', 'is', 'are', 'who', 'how', 'many', 'does', 'where', 'when', 'and', 'of'] },
  es: { label: 'Spanish', words: ['el', 'la', 'los', 'las', 'qué', 'que', 'cuál', 'cual', 'cuántos', 'cuantos', 'dónde', 'donde', 'quién', 'quien', 'una', 'para'] },
  fr: { label: 'French', words: ['le', 'la', 'les', 'des', 'quel', 'quelle', 'combien', 'comment', 'où', 'ou', 'qui', 'est', 'une', 'dans'] },
  de: { label: 'German', words: ['der', 'die', 'das', 'welche', 'welcher', 'was', 'wie', 'viele', 'ist', 'und', 'oder', 'eine', 'nicht'] },
  uz: { label: 'Uzbek', words: ['va', 'qaysi', 'qanday', 'necha', 'kim', 'nima', 'qayerda', 'qachon', 'bilan', 'uchun', 'yoki', 'bo‘lgan', 'bolgan'] },
  ru: { label: 'Russian', words: ['что', 'какой', 'какая', 'сколько', 'кто', 'где', 'когда', 'или', 'это', 'для', 'как'] },
  tr: { label: 'Turkish', words: ['hangi', 'nasıl', 'nasil', 'kaç', 'kac', 'kim', 'nerede', 'nedir', 'veya', 'için', 'icin', 'bir'] },
  it: { label: 'Italian', words: ['che', 'quale', 'quanti', 'come', 'dove', 'quando', 'chi', 'una', 'della', 'nella', 'sono'] },
  pt: { label: 'Portuguese', words: ['que', 'qual', 'quantos', 'como', 'onde', 'quando', 'quem', 'uma', 'para', 'não', 'nao'] },
  ar: { label: 'Arabic', words: ['ما', 'من', 'في', 'ما هو', 'كم', 'أين', 'متى', 'الذي', 'التي'] },
};

export function detectLanguage(text: string): DetectedLanguage {
  const t = text.toLowerCase();
  if (!t.trim()) return { code: 'en', label: 'English', confidence: 0.5 };

  // Script-based detection first (high confidence)
  if (/[\u0400-\u04FF]/.test(t)) return { code: 'ru', label: 'Russian', confidence: 0.95 };
  if (/[\u0600-\u06FF]/.test(t)) return { code: 'ar', label: 'Arabic', confidence: 0.95 };

  let best = { code: 'en', label: 'English', hits: 0, total: 0 };
  for (const [code, { label, words }] of Object.entries(STOPWORDS)) {
    let hits = 0;
    for (const w of words) {
      const re = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[?.,!])`);
      if (re.test(t)) hits++;
    }
    if (hits > best.hits) best = { code, label, hits, total: words.length };
  }
  if (best.hits === 0) return { code: 'en', label: 'English', confidence: 0.4 };
  return { code: best.code, label: best.label, confidence: Math.min(0.9, 0.45 + best.hits * 0.12) };
}
