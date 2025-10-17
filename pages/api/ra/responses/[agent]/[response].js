const REQUIRED_ENV_VARS = ['RA_APPS_UNITEST_ADMIN_TOKEN', 'RA_HOST_URL'];

function ensureEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agent, response } = req.query || {};
  if (!agent || !response) {
    return res.status(400).json({ error: 'Missing agent or response identifier' });
  }

  try {
    ensureEnv();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const token = process.env.RA_APPS_UNITEST_ADMIN_TOKEN;
  const host = process.env.RA_HOST_URL.replace(/\/$/, '');
  const agentId = encodeURIComponent(Array.isArray(agent) ? agent[0] : agent);
  const responseId = encodeURIComponent(Array.isArray(response) ? response[0] : response);
  const target = `${host}/api/v0/agents/${agentId}/responses/${responseId}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'unitest-app'
      }
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = { error: 'Unexpected response from RA API', raw: text };
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json(payload);
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error('[UniTest] Failed to proxy RA response:', error);
    return res.status(500).json({ error: 'Failed to fetch response status from RA' });
  }
}
