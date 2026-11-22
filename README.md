# KAHOOT BOSS — Intelligence. Automation. Control.

A premium AI-powered quiz automation workbench: an offline-first solving engine, an Automation Center for simulated **and real live games**, honest connection management, session history, analytics, and persistent settings.

Three solver brains: **Local** (instant math + knowledge, always offline), **On-device AI** (a real neural model running 100% in the browser — no API key; one-time ~6 MB download, cached afterwards), and **Cloud AI** (BYOK, OpenAI-compatible).

> **Real connections, honestly reported.** Live mode performs a genuine join against Kahoot's session infrastructure using the same flow as the official web client (reserve/session → challenge → CometD → login). There is no official public gameplay API, so the live engine speaks the documented client protocol — **directly from the browser by default** (the game channel is a WebSocket, which is not CORS-gated; only the session-reserve HTTP step is relayed through the tiny serverless `/api/kahoot-reserve`). A self-hosted connector backend remains available as an advanced option. Every status, latency, and diagnostic is measured live — failures are reported with meaningful errors, never masked as success.

## Quick start

```bash
npm install

# Terminal 1 — web UI (http://localhost:5173)
npm run dev

# Terminal 2 — OPTIONAL connector backend (http://localhost:3001/live/*)
# Only needed for connector mode (Settings → Live backend). Direct mode
# needs no backend: local dev proxies the reserve relay to the deployed site.
npm run server
```

Simulation mode works with the UI alone. Live mode needs network access to Kahoot (direct: via the reserve relay; connector: via `npm run server`).

```bash
npm run build        # typecheck + production UI build
npm run server:build # production connector build (→ dist-server, run with npm run server:start)
npm run test:live    # 48-assertion connector suite (challenge, join, play, 2FA, failures)
npm run test:direct  # 28-assertion direct-mode suite (real relay + in-browser engine)
```

## Environment

Copy `.env.example` to `.env` (never commit real keys). Highlights:

| Variable | Purpose |
|---|---|
| `VITE_LIVE_BACKEND_URL` | Default connector base for connector mode (`/live` = dev proxy, same origin). Ignored in direct mode. |
| `AI_API_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Server-side cloud solver (OpenAI-compatible). Optional — BYOK also available in Settings. |
| `PORT` | Connector listen port (default 3001). |
| `KAHOOT_RESERVE_BASE` / `KAHOOT_COMETD_BASE` | Real Kahoot session hosts (defaults `https://kahoot.it` / `wss://kahoot.it`). Override for tests only. |
| `KAHOOT_CAPTCHA_TOKEN` | Login token sent with joins (documented client value; empty = omit). |
| `ALLOWED_ORIGINS` | CORS allowlist (`*` for dev). |
| `TIMEOUT_*_MS` | Reserve / handshake / login / join / 2FA timeouts. |
| `SERVE_STATIC=1` + `STATIC_DIR=dist` | Single-process deploy: connector also serves the built UI. |

## Architecture

```
├── server/                   # Live connector backend (Node + Express + ws)
│   ├── index.ts              # REST + SSE API, rate limiting, optional static hosting
│   ├── config.ts             # env-driven configuration
│   ├── validate.ts           # server-side input validation
│   └── kahoot/
│       ├── protocol.ts       # challenge solver (no eval), token derivation, event IDs
│       ├── bayeux.ts         # minimal CometD/Bayeux client (handshake, heartbeat, pub/sub)
│       ├── client.ts         # live game client: join → lobby → questions → answers → results
│       └── __tests__/        # faithful mock + 48-assertion workflow suite
├── api/                      # Serverless UI backend (/api/health, /api/solve, /api/session)
├── src/
│   ├── engine/               # solver · math · language · knowledge · simulation ·
│   │                         # diagnostics · apiClient · liveClient (REST+SSE) ·
│   │                         # directLive (in-browser engine + relay reserve)
│   ├── store/                # typed zustand store + persistence (sim + live sessions)
│   ├── hooks/                # useConnect — real connect/disconnect orchestration
│   ├── components/           # AppShell · ui system · LiveRunner (real-time game UI)
│   └── pages/                # Dashboard · Connection · Solver · Automation ·
│                             # History · Statistics · Settings · About
```

### How the live connection works

1. **Reserve** — `GET {reserveBase}/reserve/session/{PIN}/?{ms}`. HTTP 404 means the PIN doesn't exist (reported as `PIN_NOT_FOUND`, never faked). The response carries a JS `challenge` plus the `x-kahoot-session-token` header.
2. **Solve** — the challenge is parsed (message literal, offset expression via a safe evaluator, char-transform parameters) and computed with exact JS semantics — cross-checked in tests against an independent JS-eval reference. Unrecognized formats raise `CHALLENGE_FAILED` with an honest "protocol changed" message.
3. **Derive** — base64-decode the session token, XOR with the solution → CometD path token.
4. **Connect** — Bayeux handshake + heartbeat over WebSocket at `{cometdBase}/cometd/{PIN}/{token}`, subscribe to `/service/{controller,player,status}`.
5. **Login** — publish `{type:'login', gameid, host, name}`; acceptance (`USERNAME_ACCEPTED`), rejection (`USERNAME_REJECTED` → try another nickname), or 2-step request (`RESET_TWO_FACTOR_AUTH` → operator enters the host-screen pattern, submitted as message id 50).
6. **Play** — `START_QUIZ` (quiz name, per-question choice counts), `START_QUESTION` (index, type, choices — **Kahoot shows question text on the host screen only**), answers published as message id 45, `REVEAL_ANSWER` returns the genuine verdict (correct / points / total / rank / streak), `GAME_OVER` + `REVEAL_RANKING` close the game. Kicks (`RESET_CONTROLLER`) and drops are surfaced immediately.

Single-player only: one nickname per session, join throttling, no multi-bot features — by design.

### Live transports

| Mode | How it joins | Needs |
|---|---|---|
| **Direct** (default, Settings → Live backend) | In-browser engine: reserve via the serverless `/api/kahoot-reserve` relay (the only step browsers can't do — Kahoot sends no CORS headers), then challenge solve + Bayeux over the native WebSocket, all locally. | Nothing to run — works on the deployed site out of the box. |
| **Connector** (advanced) | Same engine on your Node host (`npm run server`) or the standalone `kb-connector.cjs` file; the UI talks to it over REST + SSE (contract below). | A host with outbound Kahoot access. Use this if direct mode joins but your nickname never appears on the host screen (split-network seats can be refused). |

Both transports implement the same `LiveApi` surface and emit the same honest codes — the UI behaves identically.

### UI ↔ connector contract

| Endpoint | Purpose |
|---|---|
| `GET /live/health` | Liveness + version + protocol + measured Kahoot reachability + session slot state |
| `GET /live/status` | Current session snapshot |
| `POST /live/join {pin, nickname}` | Real join → `joined` / `awaitingTwoFactor` or a coded error |
| `POST /live/two-factor {sequence}` | Submit a 4-shape pattern (`0–3` × 4) |
| `POST /live/answer {choice}` | Submit an answer (`202 accepted`; verdict arrives via events) |
| `POST /live/leave` | Leave and close the channel |
| `GET /live/events` | Server-sent event stream (state, questions, feedback, …) |

Every error is `{status:'error', error, code}` with an honest, actionable message (`PIN_NOT_FOUND`, `NAME_REJECTED`, `RATE_LIMITED`, `LOGIN_TIMEOUT`, `CHALLENGE_FAILED`, `KICKED`, …).

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — greeting, quick connect (sim + live), engine status, KPIs, activity |
| `/connect` | Game Connection — PIN/nickname, environment picker, status, real diagnostics |
| `/solver` | AI Solver — question input, 2–4 options, image context, confidence, verdicts, history |
| `/automation` | Automation Center — simulation runner **and** live game runner (lobby, 2FA, questions, solver-assisted submit, real scoreboard) |
| `/history` | Session History — sim + live records, answer review with real scores, JSON/CSV export, import |
| `/stats` | Statistics — accuracy, latency, methods, categories (all derived from real data) |
| `/settings` | Profile, solver engine + cloud test, live backend (direct/connector) + health check, defaults, backup |
| `/about` | Product, honesty statement, architecture |

## Deploy

- **UI + direct live (Vercel)**: import the repo (`vercel.json` included; `npm run build` → `dist`). Direct mode works immediately — the `/api/kahoot-reserve` relay deploys as a serverless function alongside the UI. No backend to host.
- **Connector** (optional, advanced): any long-lived Node host (VPS, Railway, Render, Fly…): `npm ci && npm run server:build && npm run server:start` (needs outbound access to Kahoot), then set `VITE_LIVE_BACKEND_URL` to its URL and pick connector mode in Settings. Or single-process: build the UI, then `SERVE_STATIC=1 STATIC_DIR=dist npm run server:start`.
- **Standalone connector file** (easiest local option, no repo needed): download [`kb-connector.cjs`](https://github.com/Coder448-ops/kahoot-boss/releases/download/connector-v1/kb-connector.cjs), run `node kb-connector.cjs` (Node 20+, keep it running), pick connector mode in Settings with URL `http://127.0.0.1:3001`. Reserve and game channel then share your network — use this if direct mode joins but your nickname never appears on the host screen.

## Testing

- `npm run test:live` — full workflow against a faithful mock: challenge solving (4 format variants vs JS-eval reference), token derivation, join → 2-question game → real feedback, invalid PIN, bad challenge, rejected name, silent server, wrong/right 2FA patterns, kick, plus REST validation, busy-join, SSE streaming and leave. **48/48 passing.**
- `npm run test:direct` — the browser path end-to-end: the REAL reserve relay (pointed at the mock) + the REAL in-browser engine over WebSocket — health probe, full game, failure codes, 2FA, kick. **28/28 passing.**
- Live verification against production Kahoot requires a network with Kahoot access and a real game PIN; the engine reports every step, so any protocol drift shows up as an explicit error, not a fake status.

## Fair use

Kahoot! is a trademark of Kahoot! ASA. KAHOOT BOSS is an independent tool, not affiliated with or endorsed by Kahoot!. Only join games you are invited to, respect hosts and players, and comply with Kahoot!'s terms. The connector deliberately supports a single player — please don't use it to disrupt games.
