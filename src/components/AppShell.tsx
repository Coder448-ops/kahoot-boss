/* KAHOOT BOSS — application shell: sidebar, topbar, toasts, backdrop */
import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  History,
  Home,
  Info,
  Menu,
  Plug2,
  Settings as SettingsIcon,
  ShieldAlert,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { StatusDot } from './ui';
import type { Toast } from '../lib/types';

const NAV = [
  { to: '/', label: 'Dashboard', Icon: Home, end: true },
  { to: '/connect', label: 'Game Connection', Icon: Plug2 },
  { to: '/solver', label: 'AI Solver', Icon: Bot },
  { to: '/automation', label: 'Automation Center', Icon: Zap },
  { to: '/history', label: 'Session History', Icon: History },
  { to: '/stats', label: 'Statistics', Icon: BarChart3 },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
  { to: '/about', label: 'About', Icon: Info },
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#5B21B6] shadow-glow">
        <span className="font-display text-lg font-bold text-white">K</span>
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-void bg-accent2" />
      </div>
      <div>
        <p className="font-display text-[15px] font-bold leading-none tracking-wide text-ink">
          KAHOOT <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">BOSS</span>
        </p>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Intelligence · Control</p>
      </div>
    </div>
  );
}

function SidebarContent(props: { onNavigate?: () => void }) {
  const connection = useStore((s) => s.connection);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const active = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Primary">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={props.onNavigate}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-gradient-to-r from-accent/20 to-accent2/10 text-ink shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]'
                  : 'text-muted hover:bg-white/5 hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-accent' : 'text-muted group-hover:text-ink'} />
                {label}
                {to === '/automation' && active && (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full bg-accent2/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent2">
                    <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent2" /> Live
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="p-4">
        <div className="rounded-xl border border-line bg-void/60 p-3.5">
          <div className="flex items-center gap-2.5">
            <StatusDot tone={connection.status === 'connected' ? 'live' : connection.status === 'connecting' ? 'warn' : connection.status === 'error' ? 'bad' : 'idle'} pulse={connection.status === 'connected' || connection.status === 'connecting'} />
            <p className="text-[13px] font-semibold text-ink">
              {connection.status === 'connected' ? 'Connected' : connection.status === 'connecting' ? 'Connecting…' : connection.status === 'error' ? 'Connection error' : 'Disconnected'}
            </p>
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {connection.status === 'connected' && connection.pin
              ? `PIN ${connection.pin} · ${connection.nickname}`
              : connection.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t: Toast) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel/95 p-3.5 shadow-card backdrop-blur animate-fade-up"
        >
          {t.tone === 'success' && <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" />}
          {t.tone === 'error' && <XCircle size={18} className="mt-0.5 shrink-0 text-bad" />}
          {t.tone === 'warn' && <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />}
          {t.tone === 'info' && <Activity size={18} className="mt-0.5 shrink-0 text-accent2" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{t.title}</p>
            {t.body && <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-ink" aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AppShell(props: { children: React.ReactNode }) {
  const [drawer, setDrawer] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const profile = useStore((s) => s.profile);
  const connection = useStore((s) => s.connection);

  React.useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  const initials = profile.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative min-h-screen bg-void text-ink">
      {/* ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-accent/15 blur-[140px] animate-gradient-pan" />
        <div className="absolute -bottom-52 right-[-120px] h-[520px] w-[520px] rounded-full bg-accent2/10 blur-[160px] animate-gradient-pan" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_40%,rgba(8,8,16,0.7))]" />
      </div>

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-line bg-panel/70 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-panel shadow-card animate-fade-up">
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="relative lg:pl-[264px]">
        {/* topbar */}
        <header className="sticky top-0 z-30 border-b border-line bg-void/75 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <button
              className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-ink lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <button
              onClick={() => navigate('/connect')}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:border-accent/50 ${
                connection.status === 'connected'
                  ? 'border-accent2/30 bg-accent2/10 text-cyan-200'
                  : connection.status === 'error'
                    ? 'border-red-500/30 bg-red-500/10 text-red-200'
                    : 'border-line bg-white/5 text-muted hover:text-ink'
              }`}
              title="Open connection settings"
            >
              {connection.status === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connection.status === 'connected' ? `PIN ${connection.pin}` : 'Not connected'}
              {connection.mode && <span className="opacity-70">· {connection.mode}</span>}
            </button>
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 transition hover:border-line hover:bg-white/5"
                title="Profile settings"
              >
                <span className="hidden text-right sm:block">
                  <span className="block text-[13px] font-semibold leading-tight text-ink">{profile.displayName}</span>
                  <span className="block text-[11px] leading-tight text-muted">{profile.role}</span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 font-display text-[13px] font-bold text-white">
                  {initials || 'OP'}
                </span>
              </button>
            </div>
          </div>
        </header>

        <main key={location.pathname} className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 animate-fade-up">
          {props.children}
        </main>
      </div>

      <ToastHost />
    </div>
  );
}
