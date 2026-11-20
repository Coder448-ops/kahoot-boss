/* KAHOOT BOSS — reusable UI primitives (design system) */
import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Diamond, Info, Loader2, Square, Triangle, XCircle } from 'lucide-react';

/* ---------- Card ---------- */
export function Card(props: { className?: string; children: React.ReactNode; glow?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-line bg-panel/80 backdrop-blur-sm shadow-card ${props.glow ? 'shadow-glow' : ''} ${props.className ?? ''}`}
    >
      {props.children}
    </div>
  );
}

export function CardHeader(props: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
      <div>
        <h3 className="font-display text-[15px] font-semibold tracking-wide text-ink">{props.title}</h3>
        {props.subtitle && <p className="mt-1 text-[13px] leading-relaxed text-muted">{props.subtitle}</p>}
      </div>
      {props.right}
    </div>
  );
}

export function CardBody(props: { className?: string; children: React.ReactNode }) {
  return <div className={`px-5 py-5 sm:px-6 ${props.className ?? ''}`}>{props.children}</div>;
}

/* ---------- Button ---------- */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type BtnSize = 'sm' | 'md' | 'lg';

export function Button(props: {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit';
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const v = props.variant ?? 'secondary';
  const s = props.size ?? 'md';
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none select-none';
  const sizes: Record<BtnSize, string> = {
    sm: 'px-3 py-1.5 text-[13px]',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-[15px]',
  };
  const variants: Record<BtnVariant, string> = {
    primary:
      'bg-gradient-to-r from-accent to-[#6D28D9] text-white shadow-glow hover:brightness-110 hover:shadow-[0_0_50px_-8px_rgba(139,92,246,0.7)] active:scale-[0.98]',
    secondary:
      'bg-panel3 border border-line text-ink hover:border-accent/50 hover:bg-[#23233a] active:scale-[0.98]',
    ghost: 'text-muted hover:text-ink hover:bg-white/5 active:scale-[0.98]',
    danger:
      'bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 active:scale-[0.98]',
    success:
      'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 active:scale-[0.98]',
  };
  return (
    <button
      type={props.type ?? 'button'}
      title={props.title}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      className={`${base} ${sizes[s]} ${variants[v]} ${props.className ?? ''}`}
    >
      {props.loading && <Loader2 size={16} className="animate-spin-slow" />}
      {props.children}
    </button>
  );
}

/* ---------- Inputs ---------- */
export function Field(props: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink/90">{props.label}</span>
      {props.children}
      {props.error ? (
        <span className="mt-1.5 block text-xs text-bad">{props.error}</span>
      ) : props.hint ? (
        <span className="mt-1.5 block text-xs text-muted">{props.hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-line bg-void/70 px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/60 outline-none transition-all focus:border-accent/60 focus:ring-2 focus:ring-accent/20 hover:border-white/15';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { mono, className, ...rest } = props;
  return <input {...rest} className={`${inputCls} ${mono ? 'font-mono tracking-widest' : ''} ${className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea {...rest} className={`${inputCls} min-h-[88px] resize-y leading-relaxed ${className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select {...rest} className={`${inputCls} cursor-pointer appearance-none ${className ?? ''}`}>
      {children}
    </select>
  );
}

/* ---------- Toggle ---------- */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="group flex w-full items-center justify-between gap-4 text-left disabled:opacity-45"
    >
      {(props.label || props.hint) && (
        <span>
          {props.label && <span className="block text-sm font-medium text-ink">{props.label}</span>}
          {props.hint && <span className="mt-0.5 block text-xs text-muted">{props.hint}</span>}
        </span>
      )}
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          props.checked ? 'bg-gradient-to-r from-accent to-accent2' : 'bg-panel3 border border-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${
            props.checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

/* ---------- Range slider ---------- */
export function Slider(props: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(Number(e.target.value))}
      className="kb-range w-full"
      aria-label="Value slider"
    />
  );
}

/* ---------- Status dot + badge ---------- */
export function StatusDot(props: { tone: 'good' | 'warn' | 'bad' | 'idle' | 'live'; pulse?: boolean }) {
  const colors = {
    good: 'bg-good',
    warn: 'bg-warn',
    bad: 'bg-bad',
    idle: 'bg-muted/50',
    live: 'bg-accent2',
  } as const;
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {props.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${colors[props.tone]}`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors[props.tone]}`} />
    </span>
  );
}

export function Badge(props: { tone?: 'accent' | 'cyan' | 'good' | 'warn' | 'bad' | 'muted'; children: React.ReactNode; className?: string }) {
  const t = props.tone ?? 'muted';
  const map = {
    accent: 'bg-accent/15 text-[#C4B5FD] border-accent/30',
    cyan: 'bg-accent2/10 text-cyan-300 border-accent2/30',
    good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/10 text-red-300 border-red-500/30',
    muted: 'bg-white/5 text-muted border-line',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${map[t]} ${props.className ?? ''}`}>
      {props.children}
    </span>
  );
}

/* ---------- Progress ---------- */
export function ProgressBar(props: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad'; className?: string }) {
  const v = Math.min(100, Math.max(0, props.value));
  const tone = props.tone ?? 'accent';
  const bg = {
    accent: 'from-accent to-accent2',
    good: 'from-emerald-400 to-emerald-500',
    warn: 'from-amber-400 to-amber-500',
    bad: 'from-red-400 to-red-500',
  }[tone];
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-white/5 ${props.className ?? ''}`}>
      <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${bg}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function ConfidenceBar(props: { value: number }) {
  const v = Math.min(1, Math.max(0, props.value));
  const tone = v >= 0.75 ? 'good' : v >= 0.45 ? 'warn' : 'bad';
  return (
    <div className="flex items-center gap-3">
      <ProgressBar value={v * 100} tone={tone} className="flex-1" />
      <span className="font-mono text-sm font-semibold text-ink">{Math.round(v * 100)}%</span>
    </div>
  );
}

/* ---------- Kahoot-style option marker ---------- */
const SHAPES = [
  { Icon: Triangle, cls: 'bg-[#E21B3C]', label: 'Red triangle' },
  { Icon: Diamond, cls: 'bg-[#1368CE]', label: 'Blue diamond' },
  { Icon: Circle, cls: 'bg-[#D89E00]', label: 'Yellow circle' },
  { Icon: Square, cls: 'bg-[#26890C]', label: 'Green square' },
];

export function OptionMarker(props: { index: number; size?: number }) {
  const s = SHAPES[props.index % SHAPES.length];
  const size = props.size ?? 34;
  return (
    <span
      title={s.label}
      className={`flex shrink-0 items-center justify-center rounded-lg ${s.cls}`}
      style={{ width: size, height: size }}
    >
      <s.Icon size={size * 0.5} className="text-white" fill="currentColor" />
    </span>
  );
}

/* ---------- Empty / loading ---------- */
export function EmptyState(props: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel3 text-muted">
        {props.icon}
      </div>
      <h4 className="font-display text-[15px] font-semibold text-ink">{props.title}</h4>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{props.body}</p>
      {props.action && <div className="mt-5">{props.action}</div>}
    </div>
  );
}

export function Skeleton(props: { className?: string }) {
  return <div className={`kb-shimmer rounded-xl ${props.className ?? 'h-20'}`} />;
}

/* ---------- Notice banner ---------- */
export function Notice(props: { tone: 'info' | 'warn' | 'error' | 'success'; title: string; body?: string; action?: React.ReactNode }) {
  const map = {
    info: { Icon: Info, cls: 'border-accent2/30 bg-accent2/5 text-cyan-200' },
    warn: { Icon: AlertTriangle, cls: 'border-amber-500/30 bg-amber-500/5 text-amber-200' },
    error: { Icon: XCircle, cls: 'border-red-500/30 bg-red-500/5 text-red-200' },
    success: { Icon: CheckCircle2, cls: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' },
  } as const;
  const { Icon, cls } = map[props.tone];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{props.title}</p>
        {props.body && <p className="mt-0.5 text-[13px] leading-relaxed opacity-80">{props.body}</p>}
        {props.action && <div className="mt-2.5">{props.action}</div>}
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal(props: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={props.onClose} />
      <div
        className={`relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-panel shadow-card animate-fade-up sm:rounded-2xl ${
          props.wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-panel/95 px-5 py-4 backdrop-blur sm:px-6">
          <h3 className="font-display text-base font-semibold text-ink">{props.title}</h3>
          <button
            onClick={props.onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-ink"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">{props.children}</div>
      </div>
    </div>
  );
}

/* ---------- Stat card ---------- */
export function StatCard(props: { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={`group transition-all duration-200 hover:border-accent/40 ${props.accent ? 'shadow-glow' : ''}`}>
      <CardBody className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-gradient-to-br from-panel3 to-void text-accent transition-transform duration-200 group-hover:scale-105">
          {props.icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted">{props.label}</p>
          <p className="font-display text-xl font-bold text-ink">{props.value}</p>
          {props.sub && <p className="truncate text-xs text-muted">{props.sub}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

/* ---------- Page header ---------- */
export function PageHeader(props: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{props.title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{props.subtitle}</p>
      </div>
      {props.right && <div className="flex flex-wrap items-center gap-2">{props.right}</div>}
    </div>
  );
}
