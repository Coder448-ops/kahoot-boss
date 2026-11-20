/* GET /api/health — real liveness + capability report. No secrets are exposed.
   Self-contained (no cross-file imports): serverless-safe by construction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = async function handler(_req: any, res: any): Promise<void> {
  const aiConfigured = Boolean(process.env.AI_API_KEY && process.env.AI_API_BASE_URL);
  const body = {
    status: 'ok',
    service: 'kahoot-boss-api',
    version: process.env.npm_package_version ?? '1.0.0',
    time: new Date().toISOString(),
    mode: aiConfigured ? 'full' : 'limited',
    aiConfigured,
    liveConfigured: false,
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};
