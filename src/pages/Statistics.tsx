/* KAHOOT BOSS — Statistics & Analytics (100% derived from real user data) */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bot, Target, Timer, Zap } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard } from '../components/ui';
import { useStore, globalStats } from '../store/useStore';
import { methodLabel } from '../engine/solver';
import { formatMs, percent } from '../lib/utils';

const PIE_COLORS = ['#8B5CF6', '#06B6D4', '#34D399', '#FBBF24', '#F87171', '#9292A8'];

const tooltipStyle = {
  backgroundColor: '#161624',
  border: '1px solid rgba(148,148,180,0.2)',
  borderRadius: 12,
  color: '#F8FAFC',
  fontSize: 12,
} as const;

export default function Statistics() {
  const navigate = useNavigate();
  const sessions = useStore((s) => s.sessions);
  const solves = useStore((s) => s.solves);

  const stats = globalStats(sessions);

  const perSession = React.useMemo(
    () =>
      [...sessions].reverse().map((s, i) => {
        const answered = s.answers.filter((a) => a.correct !== null);
        const correct = answered.filter((a) => a.correct === true).length;
        return {
          name: `S${i + 1}`,
          pin: s.pin,
          accuracy: answered.length > 0 ? Math.round((correct / answered.length) * 100) : 0,
          correct,
          wrong: answered.length - correct,
        };
      }),
    [sessions],
  );

  const methodDist = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) for (const a of s.answers) map.set(a.method, (map.get(a.method) ?? 0) + 1);
    for (const r of solves) map.set(r.result.method, (map.get(r.result.method) ?? 0) + 1);
    return [...map.entries()].map(([method, count]) => ({ name: methodLabel(method as 'math'), count }));
  }, [sessions, solves]);

  const categoryPerf = React.useMemo(() => {
    const map = new Map<string, { correct: number; total: number }>();
    for (const s of sessions) {
      for (const a of s.answers) {
        if (a.correct === null) continue;
        const e = map.get(a.category) ?? { correct: 0, total: 0 };
        e.total++;
        if (a.correct) e.correct++;
        map.set(a.category, e);
      }
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      total: v.total,
    }));
  }, [sessions]);

  const verdicts = solves.filter((s) => s.userVerdict !== null);
  const verdictAcc = verdicts.length > 0 ? verdicts.filter((s) => s.userVerdict === 'correct').length / verdicts.length : null;

  const hasData = sessions.length > 0 || solves.length > 0;

  return (
    <div>
      <PageHeader
        title="Statistics & Analytics"
        subtitle="Performance computed live from your actual sessions and solves. No sample data, no placeholders — empty states mean empty data."
      />

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<BarChart3 size={26} />}
            title="No data to analyze yet"
            body="Charts and metrics will appear here automatically once you run a session or solve a question. Everything on this page is derived from real activity."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => navigate('/automation')}><Zap size={16} /> Run a session</Button>
                <Button variant="secondary" onClick={() => navigate('/solver')}><Bot size={16} /> Solve a question</Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Session accuracy" value={stats.accuracy !== null ? percent(stats.accuracy) : '—'} sub={`${stats.totalCorrect}/${stats.totalAnswered} correct`} icon={<Target size={20} />} accent />
            <StatCard label="Avg solve latency" value={stats.avgLatencyMs !== null ? formatMs(stats.avgLatencyMs) : '—'} sub="per answered question" icon={<Timer size={20} />} />
            <StatCard label="Solver rating accuracy" value={verdictAcc !== null ? percent(verdictAcc) : '—'} sub={verdictAcc !== null ? `${verdicts.length} rated solves` : 'no rated solves'} icon={<Bot size={20} />} />
            <StatCard label="Total sessions" value={String(stats.totalSessions)} sub={`${solves.length} standalone solves`} icon={<Zap size={20} />} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Accuracy per session" subtitle="Correct-answer rate for each recorded session, oldest to newest." />
              <CardBody>
                {perSession.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">No sessions recorded yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={perSession} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(148,148,180,0.12)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: '#9292A8', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#9292A8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, 'Accuracy']} labelFormatter={(_, p) => (p?.[0]?.payload ? `PIN ${p[0].payload.pin}` : '')} />
                      <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
                        {perSession.map((e, i) => (
                          <Cell key={i} fill={e.accuracy >= 70 ? '#34D399' : e.accuracy >= 40 ? '#FBBF24' : '#F87171'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Solving methods" subtitle="Which engine stages produced your answers." />
              <CardBody>
                {methodDist.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">No answers recorded yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={methodDist} dataKey="count" nameKey="name" innerRadius={62} outerRadius={95} paddingAngle={3} strokeWidth={0}>
                        {methodDist.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12, color: '#9292A8' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader title="Accuracy by category" subtitle="Session performance grouped by question category." />
              <CardBody>
                {categoryPerf.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">No categorized answers yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={categoryPerf} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(148,148,180,0.12)" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: '#9292A8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#F8FAFC', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, _n, p) => [`${v}% · ${p?.payload?.total ?? 0} answered`, 'Accuracy']} />
                      <Bar dataKey="accuracy" radius={[0, 6, 6, 0]} fill="#8B5CF6" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
