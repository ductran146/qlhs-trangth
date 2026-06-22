const ALLOWED_ORIGINS = [
  'https://ductran146.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o));
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors   = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    let body;
    try {
      const text = await request.text();
      body = JSON.parse(text);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'Missing messages' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const payload = JSON.stringify({
      model:      body.model      || 'claude-sonnet-4-6',
      max_tokens: Math.min(Number(body.max_tokens) || 600, 1000),
      system:     String(body.system || ''),
      messages,
    });

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: payload,
      });

      const result = await upstream.text();
      return new Response(result, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upstream failed', detail: String(e) }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};
