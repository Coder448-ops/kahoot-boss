/* KAHOOT BOSS — About */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Database, FlaskConical, Gauge, Plug2, Server, ShieldCheck, Zap } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Notice, PageHeader } from '../components/ui';
import { getQuestionBankSize } from '../engine/simulation';
import { KNOWLEDGE_BASE } from '../engine/knowledgeBase';

const VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.0';

export default function About() {
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="About KAHOOT BOSS"
        subtitle="Intelligence. Automation. Control. — a premium quiz-automation workbench built on honest engineering."
        right={<Badge tone="accent">v{VERSION}</Badge>}
      />

      {/* Hero */}
      <Card glow>
        <CardBody className="flex flex-col items-start gap-5 py-8 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-[#5B21B6] shadow-glow">
            <span className="font-display text-4xl font-bold text-white">K</span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-bold text-ink">
              KAHOOT <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">BOSS</span>
            </h2>
            <p className="mt-1 font-display text-sm font-medium uppercase tracking-[0.2em] text-muted">Intelligence · Automation · Control</p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
              KAHOOT BOSS is a web-based automation platform for quiz play and testing. It combines an offline-first
              AI solving engine, a real live-game connector that joins Kahoot sessions for genuine play, and a
              simulation environment for safe practice — with honest connection management throughout: every status
              is measured, and failures are reported, never faked.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => navigate('/automation')}><Zap size={15} /> Start automating</Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/solver')}><Bot size={15} /> Try the solver</Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="What it does" subtitle="Real capabilities, all functional in this build." />
          <CardBody className="space-y-3">
            {[
              ['AI solving engine', `${KNOWLEDGE_BASE.length}+ curated facts, safe math evaluator, statistical fallback — every answer carries a method label and confidence score.`],
              ['Real live connection', 'Genuine joins via reserve/session → challenge → CometD → login, 2-step verification support, live questions, real submissions and Kahoot-reported scores.'],
              ['Automation center', `Real countdowns, auto/manual answering, pause-resume with frozen timers, event log, error detection and a ${getQuestionBankSize()}-question practice bank.`],
              ['Analytics', 'Accuracy, latency, method distribution and category performance — computed live from your data, never seeded.'],
              ['History & export', 'Full session records with per-question review, JSON/CSV export and import.'],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-line bg-void/40 px-4 py-3">
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{b}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Honesty & fair use" subtitle="How this product treats integrations." />
            <CardBody className="space-y-3">
              <Notice
                tone="success"
                title="No fake connections, ever"
                body="Live mode performs a genuine join and only reports “connected” after Kahoot confirms it. Invalid PINs, rejected nicknames, kicks and drops are reported with meaningful errors — a failure is never displayed as success."
              />
              <p className="text-[13px] leading-relaxed text-muted">
                There is no official public gameplay API, so the connector speaks the same documented session protocol
                as the official web client — as a single player, one nickname per connector, with join throttling and
                no multi-bot features. Only join games you are invited to. The simulation environment exists so teams can
                practice, benchmark solvers and test automation safely without touching any third-party game service.
                Kahoot! is a trademark of Kahoot! ASA; this is an independent tool and is not affiliated with or
                endorsed by Kahoot!.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Architecture" subtitle="Modular, offline-first, deployable anywhere." />
            <CardBody>
              <ul className="space-y-2.5">
                {[
                  [<Bot key="i" size={17} className="text-accent" />, 'Engine layer', 'solver · math parser · language detection · knowledge base'],
                  [<FlaskConical key="i" size={17} className="text-accent2" />, 'Simulation layer', 'practice bank · session runner · real timers'],
                  [<Plug2 key="i" size={17} className="text-accent2" />, 'Connector layer', 'challenge solver · Bayeux client · live game client · REST+SSE'],
                  [<Server key="i" size={17} className="text-good" />, 'API layer', '/api/health · /api/solve · /api/session (serverless-ready)'],
                  [<Database key="i" size={17} className="text-warn" />, 'State layer', 'typed store · localStorage persistence · import/export'],
                  [<Gauge key="i" size={17} className="text-muted" />, 'UI layer', 'React + TypeScript · Tailwind · responsive shell'],
                ].map(([icon, t, b], i) => (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-line bg-void/40 px-3.5 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel3">{icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{t}</span>
                      <span className="block truncate font-mono text-xs text-muted">{b}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          [<Plug2 size={19} />, 'Permitted interfaces only', 'Live integrations require explicit, authorized configuration.'],
          [<ShieldCheck size={19} />, 'Private by default', 'Data stays in your browser; keys are never logged or committed.'],
          [<Zap size={19} />, 'Production mindset', 'Validation, error handling, loading and empty states throughout.'],
        ].map(([icon, t, b], i) => (
          <Card key={i}>
            <CardBody className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-panel3 text-accent">{icon}</span>
              <span>
                <span className="block text-sm font-semibold text-ink">{t}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{b}</span>
              </span>
            </CardBody>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-center font-mono text-xs text-muted">
        KAHOOT BOSS v{VERSION} · React + TypeScript · {new Date().getFullYear()}
      </p>
    </div>
  );
}
