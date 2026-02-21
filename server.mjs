import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const AIDA_AUTH_TOKEN = String(process.env.AIDA_AUTH_TOKEN || '').trim();
const UPSTREAM_BASE_URL = String(process.env.UPSTREAM_BASE_URL || '').replace(/\/+$/, '');
const UPSTREAM_PATH = String(process.env.UPSTREAM_PATH || '/v1/chat/completions');
const UPSTREAM_API_KEY = String(process.env.UPSTREAM_API_KEY || '').trim();
const DEFAULT_MODEL = String(process.env.DEFAULT_MODEL || 'aida').trim();

let AGENT_MODEL_MAP = { puter: 'aida', arkaios: 'arkaios', lab: 'lab' };
try {
  if (process.env.AGENT_MODEL_MAP) {
    AGENT_MODEL_MAP = { ...AGENT_MODEL_MAP, ...JSON.parse(process.env.AGENT_MODEL_MAP) };
  }
} catch {
  // no-op: se queda el mapa default
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  });
  res.end(body);
}

function unauthorized(res, message = 'Unauthorized') {
  return json(res, 401, { ok: false, message });
}

function methodNotAllowed(res) {
  return json(res, 405, { ok: false, message: 'Method not allowed' });
}

function normalizeObjective(params = {}) {
  const p = params || {};
  return (
    p.objective ||
    p.prompt ||
    p.text ||
    p.input ||
    p.message ||
    ''
  ).toString();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function forwardToUpstream({ agentId, action, params }) {
  if (!UPSTREAM_BASE_URL) {
    throw new Error('Missing UPSTREAM_BASE_URL');
  }

  const model = AGENT_MODEL_MAP[String(agentId || '').toLowerCase()] || DEFAULT_MODEL;
  const objective = normalizeObjective(params);

  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: objective || `agent_id=${agentId} action=${action}`
      }
    ],
    stream: false
  };

  const headers = { 'content-type': 'application/json' };
  if (UPSTREAM_API_KEY) headers.authorization = `Bearer ${UPSTREAM_API_KEY}`;

  const url = `${UPSTREAM_BASE_URL}${UPSTREAM_PATH.startsWith('/') ? UPSTREAM_PATH : `/${UPSTREAM_PATH}`}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const txt = await r.text();

  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      message: `Upstream error ${r.status}`,
      upstream_body: txt.slice(0, 1200)
    };
  }

  let parsed = null;
  try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }

  const note =
    parsed?.choices?.[0]?.message?.content ||
    parsed?.choices?.[0]?.text ||
    parsed?.text ||
    parsed?.reply ||
    txt;

  return {
    ok: true,
    status: 200,
    result: {
      agent_id: agentId,
      action,
      params: params || {},
      model,
      note
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'arkaios-cosmos-gateway',
      endpoint: '/aida/gateway'
    });
  }

  if (url.pathname === '/healthz' && req.method === 'GET') {
    return json(res, 200, { ok: true });
  }

  if (url.pathname !== '/aida/gateway') {
    return json(res, 404, { ok: false, message: 'Not found' });
  }

  if (req.method !== 'POST') return methodNotAllowed(res);

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!AIDA_AUTH_TOKEN || token !== AIDA_AUTH_TOKEN) {
    return unauthorized(res, 'Invalid bearer token');
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, message: String(e.message || e) });
  }

  const agentId = String(body.agent_id || '').trim();
  const action = String(body.action || '').trim();
  const params = body.params || {};

  if (!agentId || !action) {
    return json(res, 400, { ok: false, message: 'agent_id and action are required' });
  }

  try {
    if (action === 'ping') {
      return json(res, 200, {
        ok: true,
        result: { agent_id: agentId, action, params, note: 'pong' }
      });
    }

    const forwarded = await forwardToUpstream({ agentId, action, params });
    if (!forwarded.ok) {
      return json(res, 502, forwarded);
    }
    return json(res, 200, forwarded);
  } catch (e) {
    return json(res, 500, { ok: false, message: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`[cosmos-gateway] running on :${PORT}`);
});
