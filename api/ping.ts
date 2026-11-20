/* GET /api/ping — minimal runtime probe. Zero imports, CJS export.
   Used to distinguish "project code fails to bundle" from "the function
   runtime itself is broken". Safe to keep: it reports real liveness. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = (req: any, res: any): void => {
  void req;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ status: 'ok', probe: 'pong', node: process.version }));
};
