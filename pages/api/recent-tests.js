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

  try {
    ensureEnv();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const token = process.env.RA_APPS_UNITEST_ADMIN_TOKEN;
  const host = process.env.RA_HOST_URL.replace(/\/$/, '');

  try {
    // Fetch all unitest agents
    const agentsRes = await fetch(`${host}/api/v0/agents?tags=unitest&limit=50`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'unitest-app'
      }
    });

    if (!agentsRes.ok) {
      throw new Error(`Failed to fetch agents: ${agentsRes.status}`);
    }

    const agentsData = await agentsRes.json();
    const agents = Array.isArray(agentsData.items) ? agentsData.items : [];

    // For each agent, get the latest completed response
    const recentTests = [];

    for (const agent of agents) {
      try {
        const responsesRes = await fetch(`${host}/api/v0/agents/${encodeURIComponent(agent.name)}/responses?limit=10`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'unitest-app'
          }
        });

        if (responsesRes.ok) {
          const responses = await responsesRes.json();
          if (Array.isArray(responses) && responses.length > 0) {
            // Find most recent completed response
            const completed = responses.filter(r => String(r?.status || '').toLowerCase() === 'completed');
            const latest = completed.length > 0 ? completed[0] : responses[0];

            if (latest) {
              // Extract repository info from metadata
              const repo = agent.metadata?.repository;
              if (repo?.owner && repo?.name) {
                recentTests.push({
                  owner: repo.owner,
                  name: repo.name,
                  url: repo.url,
                  agentName: agent.name,
                  responseId: latest.id,
                  status: latest.status,
                  createdAt: latest.created_at,
                  updatedAt: latest.updated_at
                });
              }
            }
          }
        }
      } catch (err) {
        console.error(`[UniTest] Failed to fetch responses for agent ${agent.name}:`, err);
      }
    }

    // Sort by most recent first
    recentTests.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return res.status(200).json({ tests: recentTests.slice(0, 20) }); // Return top 20
  } catch (error) {
    console.error('[UniTest] Failed to fetch recent tests:', error);
    return res.status(500).json({ error: 'Failed to fetch recent tests' });
  }
}
