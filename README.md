# KAHOOT BOSS — Intelligence. Automation. Control.

A premium AI-powered quiz automation workbench: an offline-first solving engine, a fully instrumented Automation Center with real timers, honest connection management, session history, analytics, and persistent settings.

> **Honesty by design.** KAHOOT BOSS only uses officially permitted interfaces. The simulation test environment is always available; **live mode refuses to connect unless an authorized endpoint is configured and reachable.** Every status, latency, and diagnostic in the UI is measured live — nothing is faked.

## Quick start

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # typecheck + production build
npm run preview  # serve the production build
```

## Environment

Copy `.env.example` to `.env` (never commit real keys):

| Variable | Purpose |
|---|---|
| `AI_API_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Server-side cloud solver (OpenAI-compatible). Optional — the app also supports per-user BYOK in Settings. |
| `LIVE_GAME_API_URL` / `LIVE_GAME_API_KEY` | Authorized live-game endpoint. Optional — empty means live mode is honestly disabled. |
| `VITE_API_BASE_URL` | Browser → backend base path (default `/api`). |
| `VITE_APP_VERSION` | Displayed version string. |

## Architecture

```
├── api/                  # Serverless backend (/api/health, /api/solve, /api/session)
│   └── shared.ts         # Contracts shared with the client (validation, payloads)
├── src/
│   ├── engine/           # solver.ts · mathSolver.ts · language.ts · knowledgeBase.ts
│   │                     # simulation.ts (practice bank) · diagnostics.ts · apiClient.ts
│   ├── store/            # Typed zustand store + localStorage persistence
│   ├── hooks/            # useConnect — connect/disconnect orchestration
│   ├── components/       # AppShell (nav/topbar/toasts) · ui (design system)
│   └── pages/            # Dashboard · Connection · Solver · Automation ·
│                         # History · Statistics · Settings · About
```

- **Solver pipeline:** language detection → safe math evaluation (no `eval()`) → curated knowledge base → statistical fallback. Every result carries a method label, confidence score, explanation, and reasoning trace.
- **Automation runner:** real countdown timers (100 ms tick), auto/manual answering, pause-resume with frozen timers, timeout + low-confidence + solver-error logging.
- **Backend:** `GET /api/health` (liveness + capability flags), `POST /api/solve` (OpenAI-compatible proxy with BYOK, `501` when unconfigured), `GET/POST /api/session` (live-status report + simulation credential validation).

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — greeting, quick connect, engine status, KPIs, current session, activity |
| `/connect` | Game Connection — PIN/nickname, environment picker, status panel, real diagnostics |
| `/solver` | AI Solver — question input, 2–4 options, image attach + transcription, confidence, verdicts, history |
| `/automation` | Automation Center — session setup, live runner, controls, solver insight, event log |
| `/history` | Session History — search/filter, answer review, JSON/CSV export, import |
| `/stats` | Statistics — accuracy, latency, methods, categories (all derived from real data) |
| `/settings` | Profile, solver engine + cloud test, live integration test, defaults, data backup |
| `/about` | Product, honesty statement, architecture |

## Deploy (Vercel)

The repo ships with `vercel.json` (SPA rewrites + `api/` functions). Import the repo in Vercel, set env vars as needed, deploy. No build configuration required beyond defaults (`npm run build` → `dist`).

## Fair use

Kahoot! is a trademark of Kahoot! ASA. KAHOOT BOSS is an independent tool, not affiliated with or endorsed by Kahoot!. Use only with quizzes and integrations you are authorized to automate.
