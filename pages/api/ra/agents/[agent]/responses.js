export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agent } = req.query;

  if (!agent) {
    return res.status(400).json({ error: 'Missing agent name' });
  }

  const adminToken = process.env.RA_APPS_UNITEST_ADMIN_TOKEN;
  const raHost = process.env.RA_HOST_URL;

  if (!adminToken || !raHost) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const base = raHost.endsWith('/') ? raHost.slice(0, -1) : raHost;
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    Accept: 'application/json',
    'User-Agent': 'unitest-app'
  };

  try {
    // Fetch all responses for the agent
    const fetchRes = await fetch(
      `${base}/api/v0/agents/${encodeURIComponent(agent)}/responses?limit=50`,
      { headers }
    );

    if (!fetchRes.ok) {
      const errorText = await fetchRes.text();
      console.error('[UniTest] Failed to fetch agent responses:', errorText);
      return res.status(fetchRes.status).json({
        error: 'Failed to fetch agent responses',
        details: errorText
      });
    }

    const responses = await fetchRes.json();
    return res.status(200).json(responses);
  } catch (error) {
    console.error('[UniTest] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
