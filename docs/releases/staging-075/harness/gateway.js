// LOCAL Supabase-shaped gateway for the disposable 075 stack (stands in for Kong):
//   http://127.0.0.1:54321/auth/v1/*  -> GoTrue   127.0.0.1:9999
//   http://127.0.0.1:54321/rest/v1/*  -> PostgREST 127.0.0.1:3010
// Requires an apikey signed with the local secret (anon or service_role), like Kong. Never exposed beyond 127.0.0.1.
// `node gateway.js keys` prints the local anon/service JWTs (local-only secret, not a staging/production key).
const http = require('http');
const crypto = require('crypto');
const SECRET = process.env.LOCAL_JWT_SECRET || 'local-only-jwt-secret-goldia-075-at-least-32-chars';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(s), Buffer.from(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')));
  return ok ? JSON.parse(Buffer.from(p, 'base64url').toString()) : null;
}
const KEYS = {
  anon: sign({ iss: 'supabase-local-075', role: 'anon', iat: 1793000000, exp: 1893456000 }),
  service: sign({ iss: 'supabase-local-075', role: 'service_role', iat: 1793000000, exp: 1893456000 }),
};
if (process.argv[2] === 'keys') { console.log(JSON.stringify(KEYS)); process.exit(0); }
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,range,x-supabase-api-version,x-upsert',
  'access-control-expose-headers': 'content-range,x-total-count',
};
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const m = req.url.match(/^\/(auth|rest)\/v1(\/.*)?$/);
  if (!m) { res.writeHead(404, CORS); return res.end('{"message":"not found"}'); }
  let claims = null; try { claims = verify(req.headers.apikey); } catch { claims = null; }
  if (!claims || !['anon', 'service_role'].includes(claims.role)) { res.writeHead(401, { ...CORS, 'content-type': 'application/json' }); return res.end('{"message":"Invalid API key"}'); }
  const headers = { ...req.headers };
  // Kong behaviour: without Authorization the apikey is used as bearer
  if (!headers.authorization) headers.authorization = `Bearer ${req.headers.apikey}`;
  const target = m[1] === 'auth' ? { port: 9999, path: m[2] || '/' } : { port: 3010, path: m[2] || '/' };
  delete headers.host;
  const up = http.request({ host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...CORS }); r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, CORS); res.end(JSON.stringify({ message: e.message })); });
  req.pipe(up);
}).listen(54321, '127.0.0.1', () => console.log('gateway on 127.0.0.1:54321'));
