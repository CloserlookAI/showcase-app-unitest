export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agentName, message } = req.body;

  if (!agentName || !message) {
    return res.status(400).json({ error: 'Missing agentName or message' });
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
    'Content-Type': 'application/json',
    'User-Agent': 'unitest-app'
  };

  try {
    const messageBody = {
      input: {
        content: [{
          type: 'text',
          content: message
        }]
      }
    };

    const responseRes = await fetch(
      `${base}/api/v0/agents/${encodeURIComponent(agentName)}/responses`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(messageBody)
      }
    );

    if (!responseRes.ok) {
      const errorText = await responseRes.text();
      console.error('[UniTest Chat] Failed to send message:', errorText);
      return res.status(responseRes.status).json({
        error: 'Failed to send message to agent',
        details: errorText
      });
    }

    const response = await responseRes.json();
    return res.status(200).json(response);
  } catch (error) {
    console.error('[UniTest Chat] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
