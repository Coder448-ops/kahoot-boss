/* KAHOOT BOSS — AI Solver */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Check,
  Clock3,
  Eraser,
  FlaskConical,
  ImagePlus,
  Languages,
  Lightbulb,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfidenceBar,
  EmptyState,
  Field,
  Input,
  Notice,
  OptionMarker,
  PageHeader,
  StatusDot,
  Textarea,
} from '../components/ui';
import { useStore } from '../store/useStore';
import { methodLabel, solveLocal } from '../engine/solver';
import { detectLanguage } from '../engine/language';
import { solveViaApi } from '../engine/apiClient';
import { validateOptions, validateQuestionText } from '../lib/validation';
import type { SolveResult } from '../lib/types';
import { formatMs, percent, timeAgo, uid } from '../lib/utils';

const SAMPLES = [
  { q: 'What is 144 ÷ 12?', o: ['10', '11', '12', '14'] },
  { q: 'What is the capital of Uzbekistan?', o: ['Samarkand', 'Bukhara', 'Tashkent', 'Andijan'] },
  { q: 'Which planet is known as the Red Planet?', o: ['Venus', 'Mars', 'Jupiter', 'Saturn'] },
  { q: 'Solve: (8 + 5) × 3 − 10', o: ['29', '39', '19', '49'] },
];

const OPTION_LABELS = ['Option A — red ▲', 'Option B — blue ◆', 'Option C — yellow ●', 'Option D — green ■'];

export default function Solver() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const solves = useStore((s) => s.solves);
  const recordSolve = useStore((s) => s.recordSolve);
  const setVerdict = useStore((s) => s.setVerdict);
  const clearSolves = useStore((s) => s.clearSolves);
  const pushToast = useStore((s) => s.pushToast);

  const [question, setQuestion] = React.useState('');
  const [optionCount, setOptionCount] = React.useState(4);
  const [options, setOptions] = React.useState<string[]>(['', '', '', '']);
  const [image, setImage] = React.useState<{ url: string; name: string; size: number; dims: string } | null>(null);
  const [transcription, setTranscription] = React.useState('');
  const [solving, setSolving] = React.useState(false);
  const [result, setResult] = React.useState<SolveResult | null>(null);
  const [resultFor, setResultFor] = React.useState<{ q: string; o: string[] } | null>(null);
  const [solvedRecordId, setSolvedRecordId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [formErrors, setFormErrors] = React.useState<{ question?: string; options?: string }>({});
  const [historyFilter, setHistoryFilter] = React.useState<'all' | 'correct' | 'wrong' | 'unrated'>('all');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const activeOptions = options.slice(0, optionCount);
  const lang = React.useMemo(() => (question.trim() ? detectLanguage(question) : null), [question]);

  React.useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));

  const loadSample = (i: number) => {
    const s = SAMPLES[i % SAMPLES.length];
    setQuestion(s.q);
    setOptionCount(s.o.length);
    setOptions([s.o[0] ?? '', s.o[1] ?? '', s.o[2] ?? '', s.o[3] ?? '']);
    setResult(null);
    setError(null);
  };

  const clearForm = () => {
    setQuestion('');
    setOptions(['', '', '', '']);
    setTranscription('');
    setResult(null);
    setResultFor(null);
    setSolvedRecordId(null);
    setError(null);
    setFormErrors({});
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
  };

  const handleImage = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      pushToast({ title: 'Not an image', body: 'Please choose a PNG, JPG, WEBP or GIF file.', tone: 'warn' });
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      pushToast({ title: 'Image too large', body: 'Please use an image under 8 MB.', tone: 'warn' });
      return;
    }
    const url = URL.createObjectURL(f);
    const probe = new Image();
    probe.onload = () => {
      setImage({ url, name: f.name, size: f.size, dims: `${probe.naturalWidth}×${probe.naturalHeight}px` });
      URL.revokeObjectURL(probe.src);
    };
    probe.onerror = () => setImage({ url, name: f.name, size: f.size, dims: 'unknown dimensions' });
    probe.src = url;
  };

  const effectiveQuestion = transcription.trim()
    ? `${question.trim()}\n[Image context: ${transcription.trim()}]`
    : question.trim();

  const handleSolve = async (forceLocal = false) => {
    const filled = activeOptions.map((o) => o.trim()).filter(Boolean);
    const qCheck = validateQuestionText(question);
    const oCheck = validateOptions(filled);
    setFormErrors({ question: qCheck.error ?? undefined, options: oCheck.error ?? undefined });
    if (!qCheck.ok || !oCheck.ok) return;

    setSolving(true);
    setError(null);
    setResult(null);
    try {
      const useApi = settings.solverMode === 'api' && !forceLocal;
      if (useApi) {
        const started = performance.now();
        const { data } = await solveViaApi({
          question: effectiveQuestion,
          options: filled,
          baseUrl: settings.apiBaseUrl,
          model: settings.apiModel,
          apiKey: settings.apiKey,
        });
        const scores = filled.map((_, i) => (i === data.bestIndex ? data.confidence : Math.max(0.05, (1 - data.confidence) / 3)));
        const r: SolveResult = {
          bestIndex: data.bestIndex,
          confidence: data.confidence,
          explanation: data.explanation,
          method: 'api',
          language: lang?.label ?? 'English',
          languageCode: lang?.code ?? 'en',
          scores,
          reasoning: [`Cloud model "${data.model}" analyzed the question and options.`, `Server-side inference took ${formatMs(data.latencyMs)}; round-trip ${formatMs(performance.now() - started)}.`],
          latencyMs: performance.now() - started,
          viaApi: true,
        };
        setResult(r);
        setResultFor({ q: effectiveQuestion, o: filled });
        const rec = recordSolve(effectiveQuestion, filled, image?.name ?? null, r);
        setSolvedRecordId(rec.id);
      } else {
        // Keep UI honest: local solve is synchronous, but yield a frame so the loading state paints.
        await new Promise((r) => setTimeout(r, 60));
        const r = solveLocal({ question: effectiveQuestion, options: filled });
        setResult(r);
        setResultFor({ q: effectiveQuestion, o: filled });
        const rec = recordSolve(effectiveQuestion, filled, image?.name ?? null, r);
        setSolvedRecordId(rec.id);
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'AI_NOT_CONFIGURED') {
        setError('CLOUD_NOT_CONFIGURED');
      } else {
        setError(err.message || 'Solving failed.');
      }
    } finally {
      setSolving(false);
    }
  };

  const verdicts = solves.filter((s) => s.userVerdict !== null);
  const verdictAcc = verdicts.length > 0 ? verdicts.filter((s) => s.userVerdict === 'correct').length / verdicts.length : null;

  const filtered = solves.filter((s) => {
    if (historyFilter === 'all') return true;
    if (historyFilter === 'unrated') return s.userVerdict === null;
    return s.userVerdict === historyFilter;
  });

  return (
    <div>
      <PageHeader
        title="AI Solver"
        subtitle="Recognize a question, analyze its options, and get a ranked answer with confidence and reasoning. The offline engine is fully functional; cloud mode needs an API key."
        right={
          <Badge tone={settings.solverMode === 'api' ? 'cyan' : 'accent'}>
            <Bot size={13} /> {settings.solverMode === 'api' ? 'Cloud AI mode' : 'Local engine mode'}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Input */}
        <Card glow={!result}>
          <CardHeader
            title="Question input"
            subtitle="Type or paste a question, add 2–4 options, optionally attach an image."
            right={<Button variant="ghost" size="sm" onClick={clearForm}><Eraser size={14} /> Clear</Button>}
          />
          <CardBody className="space-y-4">
            <Field label="Question text" error={formErrors.question} hint={lang ? `Detected language: ${lang.label} (${Math.round(lang.confidence * 100)}%)` : 'Supports math, facts, logic and multiple languages'}>
              <Textarea placeholder="e.g. What is 12 × 8?" value={question} onChange={(e) => setQuestion(e.target.value)} />
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink/90">Answer options</span>
                <div className="flex gap-1 rounded-lg border border-line bg-void/60 p-0.5">
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setOptionCount(n)}
                      className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${optionCount === n ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {activeOptions.map((o, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <OptionMarker index={i} size={32} />
                    <Input aria-label={OPTION_LABELS[i]} placeholder={OPTION_LABELS[i]} value={o} maxLength={120} onChange={(e) => setOption(i, e.target.value)} />
                  </div>
                ))}
              </div>
              {formErrors.options && <p className="mt-1.5 text-xs text-bad">{formErrors.options}</p>}
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink/90">Image-based question <span className="font-normal text-muted">(optional)</span></span>
              {!image ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-void/50 px-4 py-5 text-sm text-muted transition hover:border-accent/50 hover:text-ink"
                >
                  <ImagePlus size={18} /> Attach a question image (PNG/JPG/WEBP, ≤8 MB)
                </button>
              ) : (
                <div className="flex gap-3 rounded-xl border border-line bg-void/50 p-3">
                  <img src={image.url} alt="Attached question" className="h-20 w-20 shrink-0 rounded-lg border border-line object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{image.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{(image.size / 1024).toFixed(0)} KB · {image.dims}</p>
                    <button type="button" onClick={() => { URL.revokeObjectURL(image.url); setImage(null); }} className="mt-1 inline-flex items-center gap-1 text-xs text-bad hover:underline">
                      <X size={13} /> Remove
                    </button>
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImage(e.target.files?.[0])} />
              {image && (
                <Textarea
                  className="mt-2 min-h-[56px]"
                  placeholder="Transcribe or describe the image content here — the offline engine solves from text, so your transcription becomes part of the question."
                  value={transcription}
                  onChange={(e) => setTranscription(e.target.value)}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" loading={solving} onClick={() => handleSolve(false)}>
                <Sparkles size={16} /> {settings.solverMode === 'api' ? 'Solve with Cloud AI' : 'Solve locally'}
              </Button>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <FlaskConical size={14} /> Try:
                {SAMPLES.map((s, i) => (
                  <button key={uid('sample')} type="button" onClick={() => loadSample(i)} className="rounded-md border border-line bg-white/5 px-2 py-1 font-medium text-ink/80 transition hover:border-accent/50 hover:text-ink">
                    #{i + 1}
                  </button>
                ))}
              </div>
            </div>

            {error === 'CLOUD_NOT_CONFIGURED' ? (
              <Notice
                tone="warn"
                title="Cloud AI is not configured"
                body="No API key or endpoint is set, so the cloud solver honestly refused the request. Add credentials in Settings, or solve with the offline engine instead."
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>Open Settings</Button>
                    <Button size="sm" variant="primary" onClick={() => handleSolve(true)}>Solve locally instead</Button>
                  </div>
                }
              />
            ) : error ? (
              <Notice tone="error" title="Solving failed" body={error} />
            ) : null}
          </CardBody>
        </Card>

        {/* Result */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Solution"
              subtitle={result ? `Solved in ${formatMs(result.latencyMs)} · ${methodLabel(result.method)}` : 'Your answer will appear here with confidence and reasoning.'}
              right={result ? <Badge tone={result.confidence >= 0.75 ? 'good' : result.confidence >= 0.45 ? 'warn' : 'bad'}>{methodLabel(result.method)}</Badge> : undefined}
            />
            <CardBody>
              {!result && !solving && (
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
                  <Lightbulb size={18} className="shrink-0" />
                  Fill in the form and press Solve. Nothing here is pre-computed — every answer is produced live by the engine.
                </div>
              )}
              {solving && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted"><Bot size={16} className="animate-pulse-soft text-accent" /> Analyzing question and ranking options…</div>
                  <div className="kb-shimmer h-16 rounded-xl" />
                  <div className="kb-shimmer h-10 rounded-xl" />
                </div>
              )}
              {result && resultFor && (
                <div className="space-y-4 animate-fade-up">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[13px]">
                      <span className="font-medium text-muted">Confidence</span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Languages size={13} />{result.language}</span>
                    </div>
                    <ConfidenceBar value={result.confidence} />
                  </div>

                  <div className="space-y-2">
                    {resultFor.o.map((o, i) => {
                      const best = i === result.bestIndex;
                      return (
                        <div key={i} className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition ${best ? 'border-good/50 bg-good/5 shadow-[0_0_24px_-8px_rgba(52,211,153,0.5)]' : 'border-line bg-void/40'}`}>
                          <OptionMarker index={i} size={30} />
                          <p className={`flex-1 text-sm ${best ? 'font-semibold text-ink' : 'text-muted'}`}>{o}</p>
                          <span className="font-mono text-xs text-muted">{Math.round((result.scores[i] ?? 0) * 100)}%</span>
                          {best && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-good text-void"><Check size={14} strokeWidth={3} /></span>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-line bg-void/50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Why this answer</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{result.explanation}</p>
                  </div>

                  <details className="group rounded-xl border border-line bg-void/50 px-4 py-3">
                    <summary className="cursor-pointer text-[13px] font-semibold text-ink/90">Reasoning trace ({result.reasoning.length} steps)</summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-muted">
                      {result.reasoning.map((r, i) => <li key={i}>{r}</li>)}
                    </ol>
                  </details>

                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <span className="text-[13px] text-muted">Was this correct?</span>
                    <Button size="sm" variant={solves.find((s) => s.id === solvedRecordId)?.userVerdict === 'correct' ? 'success' : 'secondary'} onClick={() => solvedRecordId && setVerdict(solvedRecordId, 'correct')}>
                      <ThumbsUp size={14} /> Correct
                    </Button>
                    <Button size="sm" variant={solves.find((s) => s.id === solvedRecordId)?.userVerdict === 'wrong' ? 'danger' : 'secondary'} onClick={() => solvedRecordId && setVerdict(solvedRecordId, 'wrong')}>
                      <ThumbsDown size={14} /> Wrong
                    </Button>
                    <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-muted"><Clock3 size={13} />{formatMs(result.latencyMs)}</span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* History */}
          <Card>
            <CardHeader
              title="Solve history"
              subtitle={verdictAcc !== null ? `Measured accuracy ${percent(verdictAcc)} across ${verdicts.length} rated solves` : 'Rate solutions above to measure real accuracy.'}
              right={solves.length > 0 ? <Button variant="ghost" size="sm" onClick={clearSolves}><Trash2 size={14} /> Clear</Button> : undefined}
            />
            <CardBody>
              {solves.length === 0 ? (
                <EmptyState icon={<Bot size={26} />} title="No solves yet" body="Every solution you run is recorded here with its method, confidence and your rating." />
              ) : (
                <>
                  <div className="mb-3 flex gap-1.5">
                    {(['all', 'correct', 'wrong', 'unrated'] as const).map((f) => (
                      <button key={f} onClick={() => setHistoryFilter(f)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition ${historyFilter === f ? 'bg-accent/20 text-ink' : 'text-muted hover:text-ink'}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                  <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {filtered.map((s) => (
                      <li key={s.id} className="rounded-xl border border-line bg-void/40 px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <StatusDot tone={s.userVerdict === 'correct' ? 'good' : s.userVerdict === 'wrong' ? 'bad' : 'idle'} />
                          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{s.question.split('\n')[0]}</p>
                          <span className="shrink-0 font-mono text-[11px] text-muted">{timeAgo(s.ts)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                          <span>→ option {s.result.bestIndex + 1} · {Math.round(s.result.confidence * 100)}% · {methodLabel(s.result.method)}</span>
                          <span className="ml-auto flex gap-1">
                            <button onClick={() => setVerdict(s.id, 'correct')} className={`rounded-md p-1 transition ${s.userVerdict === 'correct' ? 'text-good' : 'hover:text-good'}`} title="Mark correct"><ThumbsUp size={13} /></button>
                            <button onClick={() => setVerdict(s.id, 'wrong')} className={`rounded-md p-1 transition ${s.userVerdict === 'wrong' ? 'text-bad' : 'hover:text-bad'}`} title="Mark wrong"><ThumbsDown size={13} /></button>
                          </span>
                        </div>
                      </li>
                    ))}
                    {filtered.length === 0 && <p className="py-4 text-center text-[13px] text-muted">No solves match this filter.</p>}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
