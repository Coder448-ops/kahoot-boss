/* GET /api/health — real liveness + capability report. No secrets are exposed. */
import { json, type HealthPayload } from './shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(_req: any, res: any): Promise<void> {
  const aiConfigured = Boolean(process.env.AI_API_KEY && process.env.AI_API_BASE_URL);
  const liveConfigured = Boolean(process.env.LIVE_GAME_API_URL);
  const body: HealthPayload = {
    status: 'ok',
    service: 'kahoot-boss-api',
    version: process.env.npm_package_version ?? '1.0.0',
    time: new Date().toISOString(),
    mode: aiConfigured ? 'full' : 'limited',
    aiConfigured,
    liveConfigured,
  };
  json(res, 200, body);
}
