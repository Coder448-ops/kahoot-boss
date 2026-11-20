/* KAHOOT BOSS — Session History */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, FileJson, FileSpreadsheet, History as HistoryIcon, Search, Trash2, Upload, XCircle, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, OptionMarker, PageHeader, Select, StatusDot } from '../components/ui';
import { useStore, sessionStats } from '../store/useStore';
import type { Session, SessionStatus } from '../lib/types';
import { downloadFile, formatDateTime, formatDuration, formatMs, percent, toCsv } from '../lib/utils';

function sessionToRows(s: Session): string[][] {
  const head = ['#', 'Question', 'Category', 'Picked', 'Correct option', 'Result', 'Method', 'Confidence', 'Latency ms', 'Timed out'];
  const rows = s.answers.map((a, i) => [
    String(i + 1),
    a.questionText,
    a.category,
    a.pickedIndex === null ? '—' : `${a.pickedIndex + 1}. ${a.options[a.pickedIndex] ?? ''}`,
    a.correctIndex >= 0 ? `${a.correctIndex + 1}. ${a.options[a.correctIndex] ?? ''}` : 'not disclosed by host',
    a.correct === null ? 'unanswered' : a.correct ? 'correct' : 'wrong',
    a.method,
    a.confidence === null ? '—' : `${Math.round(a.confidence * 100)}%`,
    String(Math.round(a.latencyMs)),
    a.timedOut ? 'yes' : 'no',
  ]);
  return [head, ...rows];
}

export default function History() {
  const navigate = useNavigate();
  const sessions = useStore((s) => s.sessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const clearSessions = useStore((s) => s.clearSessions);
  const importSessions = useStore((s) => s.importSessions);
  const pushToast = useStore((s) => s.pushToast);

  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | SessionStatus>('all');
  const [detail, setDetail] = React.useState<Session | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const filtered = sessions.filter((s) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return s.pin.includes(q) || s.nickname.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });

  const exportSessionJson = (s: Session) => {
    downloadFile(`kahoot-boss-session-${s.pin}-${s.id.slice(-6)}.json`, JSON.stringify(s, null, 2));
    pushToast({ title: 'Session exported', body: 'JSON file downloaded.', tone: 'success' });
  };

  const exportSessionCsv = (s: Session) => {
    downloadFile(`kahoot-boss-session-${s.pin}-${s.id.slice(-6)}.csv`, toCsv(sessionToRows(s)), 'text/csv');
    pushToast({ title: 'Session exported', body: 'CSV file downloaded.', tone: 'success' });
  };

  const exportAll = () => {
    downloadFile(`kahoot-boss-sessions-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(sessions, null, 2));
    pushToast({ title: 'History exported', body: `${sessions.length} session(s) downloaded as JSON.`, tone: 'success' });
  };

  const handleImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const n = importSessions(arr as Session[]);
      pushToast({ title: n > 0 ? 'Import complete' : 'Nothing imported', body: n > 0 ? `${n} session(s) added.` : 'No valid sessions found in that file.', tone: n > 0 ? 'success' : 'warn' });
    } catch {
      pushToast({ title: 'Import failed', body: 'That file is not valid session JSON.', tone: 'error' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const statusTone = (st: SessionStatus) =>
    st === 'completed' ? 'good' : st === 'running' ? 'cyan' : st === 'paused' ? 'warn' : 'muted';

  return (
    <div>
      <PageHeader
        title="Session History"
        subtitle="Every automated session you run is recorded here with full answer detail. Nothing is seeded — this is your real data."
        right={
          sessions.length > 0 ? (
            <>
              <Button variant="secondary" size="sm" onClick={exportAll}><Download size={15} /> Export all</Button>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import</Button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => handleImport(e.target.files?.[0])} />
            </>
          ) : undefined
        }
      />

      {sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HistoryIcon size={26} />}
            title="No sessions yet"
            body="Run your first automated session and it will appear here with per-question results, timing and solver methods."
            action={<Button variant="primary" onClick={() => navigate('/automation')}><Zap size={16} /> Go to Automation Center</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <Input placeholder="Search by PIN, nickname or session ID…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | SessionStatus)}>
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="stopped">Stopped</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState icon={<Search size={26} />} title="No matches" body="No sessions match your current search and filters." />
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((s) => {
                const st = sessionStats(s);
                return (
                  <Card key={s.id} className="transition hover:border-accent/40">
                    <CardBody className="flex flex-wrap items-center gap-4">
                      <StatusDot tone={s.status === 'completed' ? 'good' : s.status === 'running' ? 'live' : s.status === 'paused' ? 'warn' : 'idle'} pulse={s.status === 'running'} />
                      <button onClick={() => setDetail(s)} className="min-w-0 flex-1 text-left" title="View session detail">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[15px] font-bold text-ink">PIN {s.pin}</span>
                          <span className="text-sm text-muted">· {s.nickname}</span>
                          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                          <Badge tone="muted">{s.mode}</Badge>
                        </span>
                        <span className="mt-1 block text-xs text-muted">
                          {formatDateTime(s.startedAt)}
                          {s.endedAt ? ` · lasted ${formatDuration(s.endedAt - s.startedAt)}` : ' · in progress'}
                          {' · '}{s.answers.length}/{s.questions.length} questions
                          {s.errors.length > 0 ? ` · ${s.errors.length} error(s)` : ''}
                        </span>
                      </button>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-display text-lg font-bold text-ink">{st.accuracy !== null ? percent(st.accuracy) : '—'}</p>
                          <p className="text-[11px] text-muted">{st.correct}/{st.answered} correct</p>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => setDetail(s)}>Review</Button>
                        <Button variant="ghost" size="sm" onClick={() => { deleteSession(s.id); pushToast({ title: 'Session deleted', tone: 'info' }); }} title="Delete session">
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">Delete all {sessions.length} sessions?</span>
                <Button variant="danger" size="sm" onClick={() => { clearSessions(); setConfirmClear(false); pushToast({ title: 'History cleared', tone: 'info' }); }}>Confirm</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Clear all history</Button>
            )}
          </div>
        </>
      )}

      {/* Detail modal */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? `Session · PIN ${detail.pin}` : ''} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
              <Badge tone="muted">{detail.mode}</Badge>
              <Badge tone="muted">{detail.nickname}</Badge>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => exportSessionJson(detail)}><FileJson size={14} /> JSON</Button>
                <Button size="sm" variant="secondary" onClick={() => exportSessionCsv(detail)}><FileSpreadsheet size={14} /> CSV</Button>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Answered', detail.answers.filter((a) => a.correct !== null).length],
                ['Correct', detail.answers.filter((a) => a.correct === true).length],
                ['Errors', detail.errors.length],
                ['Avg latency', detail.answers.length ? formatMs(detail.answers.reduce((x, a) => x + a.latencyMs, 0) / detail.answers.length) : '—'],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-line bg-void/50 p-3 text-center">
                  <p className="font-display text-base font-bold text-ink">{v}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
                </div>
              ))}
            </div>

            {detail.errors.length > 0 && (
              <Field label={`Errors (${detail.errors.length})`}>
                <ul className="space-y-1 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[13px] text-red-200">
                  {detail.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              </Field>
            )}

            <div>
              <p className="mb-2 text-[13px] font-medium text-ink/90">Answer review ({detail.answers.length})</p>
              <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {detail.answers.map((a, i) => (
                  <li key={`${a.questionId}-${i}`} className="rounded-xl border border-line bg-void/40 px-3.5 py-2.5">
                    <div className="flex items-start gap-2">
                      {a.correct === true ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" />
                        : a.correct === false ? <XCircle size={16} className="mt-0.5 shrink-0 text-bad" />
                        : <span className="mt-0.5 shrink-0 font-mono text-xs text-warn">—</span>}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">Q{i + 1}. {a.questionText}</p>
                        <p className="mt-1 text-xs text-muted">
                          Picked: {a.pickedIndex === null ? '— (unanswered)' : <span className="text-ink/80">{a.options[a.pickedIndex] ?? `choice #${a.pickedIndex + 1}`}</span>}
                          {' · '}Correct: {a.correctIndex >= 0 ? <span className="text-good">{a.options[a.correctIndex] ?? `choice #${a.correctIndex + 1}`}</span> : <span className="italic">not disclosed by host</span>}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted">
                          {a.method} · {a.confidence !== null ? `${Math.round(a.confidence * 100)}%` : 'manual'} · {formatMs(a.latencyMs)}{a.timedOut ? ' · TIMEOUT' : ''}
                          {a.points !== null && a.points !== undefined ? ` · +${a.points} pts` : ''}{a.rank !== null && a.rank !== undefined ? ` · rank #${a.rank}` : ''}{a.streak ? ` · streak ×${a.streak}` : ''}
                        </p>
                      </div>
                      {a.pickedIndex !== null && <OptionMarker index={a.pickedIndex} size={26} />}
                    </div>
                  </li>
                ))}
                {detail.answers.length === 0 && <p className="py-3 text-center text-[13px] text-muted">No answers recorded in this session.</p>}
              </ul>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
