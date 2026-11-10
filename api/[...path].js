const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

function send(res, status, value, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, val] of Object.entries(headers)) res.setHeader(key, val);
  res.end(JSON.stringify(value));
}

async function rpc(name, args = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en Vercel.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.message || `Supabase respondió HTTP ${response.status}.`);
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PoW-Challenge, X-PoW-Response, X-Client-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const parsed = new URL(req.url, 'https://pow-rate-limiter.vercel.app');
  const route = parsed.pathname.replace(/^\/api\/?/, '');
  try {
    if (req.method === 'GET' && route === 'pow/challenge') {
      const challenge = await rpc('pow_issue_challenge', { p_client_id: parsed.searchParams.get('clientId') || req.headers['x-client-id'] || 'anon-client' });
      return send(res, 200, challenge);
    }
    if (req.method === 'POST' && route === 'heavy-report') {
      const verification = await rpc('pow_verify_challenge', {
        p_challenge: req.headers['x-pow-challenge'] || null,
        p_client_nonce: req.headers['x-pow-response'] || null
      });
      if (!verification.valid) {
        return send(res, 428, { error: 'Proof-of-Work Requerido o Inválido', reason: verification.reason,
          nextChallenge: await rpc('pow_issue_challenge', { p_client_id: 'anon-client' }) }, { 'X-PoW-Required': 'true' });
      }
      return send(res, 200, {
        status: 'Éxito', message: 'Acceso concedido a la API compartida.',
        reportData: { reportId: `REP-${Math.floor(100000 + Math.random() * 900000)}`,
          generatedAt: new Date().toISOString(), recordsProcessed: 45200,
          summary: 'Reporte consolidado verificado correctamente.' },
        powMetrics: { difficulty: verification.difficulty, hashMatched: verification.hash,
          serverVerifyTimeMs: 0, serverProcessingTimeMs: 0 }
      });
    }
    if (req.method === 'GET' && route === 'metrics') return send(res, 200, await rpc('pow_get_metrics'));
    if (req.method === 'GET' && route === 'blockchain') return send(res, 200, await rpc('pow_get_blockchain'));
    if (req.method === 'POST' && route === 'admin/difficulty') {
      const data = typeof req.body === 'object' && req.body !== null ? req.body : {};
      return send(res, 200, await rpc('pow_set_difficulty', { p_difficulty: String(data.difficulty ?? 'auto') }));
    }
    if (req.method === 'GET' && route === 'benchmark/distributed/status') {
      return send(res, 200, await rpc('pow_benchmark_get'));
    }
    if (req.method === 'GET' && route === 'benchmark/distributed.csv') {
      const state = await rpc('pow_benchmark_get');
      const results = state?.results?.results || [];
      if (!results.length) return send(res, 404, { error: 'Todavía no hay resultados del benchmark Dask.' });
      const fields = Object.keys(results[0]);
      const csv = [fields.join(','), ...results.map(row => fields.map(field => JSON.stringify(row[field] ?? '')).join(','))].join('\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="pow_distributed_benchmark.csv"');
      return res.end(csv);
    }
    if (req.method === 'POST' && route === 'benchmark/run') {
      return send(res, 501, { success: false, error: 'El benchmark secuencial con Python está disponible al ejecutar el proyecto localmente.' });
    }
    if (req.method === 'GET' && route === 'benchmark/status') {
      return send(res, 200, { running: false, results: null });
    }
    return send(res, 404, { error: 'Ruta API no encontrada.' });
  } catch (error) {
    console.error(`API ${route}: ${error.message}`);
    return send(res, 500, { error: error.message || 'Error interno.' });
  }
};
