import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

function extractGitHubRepo(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let pathCandidate = trimmed;

  // Handle full GitHub URLs
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    pathCandidate = parsed.pathname;
  } catch (_) {
    // Not a URL, try to parse as owner/repo format
    if (/^https?:/i.test(trimmed)) {
      return null;
    }
    // Remove any github.com prefix if present
    const normalized = trimmed
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^github\.com\//i, '');
    pathCandidate = normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  const clean = pathCandidate.replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/');

  // Must be owner/repo format
  if (segments.length === 2 && segments[0] && segments[1]) {
    return `/${segments[0]}/${segments[1]}`;
  }

  return null;
}

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const [recentTests, setRecentTests] = useState([]);
  const [loadingTests, setLoadingTests] = useState(true);
  const [hiddenAgents, setHiddenAgents] = useState([]);

  useEffect(() => {
    // Load hidden agents from localStorage
    const hidden = JSON.parse(localStorage.getItem('hiddenAgents') || '[]');
    setHiddenAgents(hidden);
  }, []);

  useEffect(() => {
    async function fetchRecentTests() {
      try {
        const res = await fetch('/api/recent-tests');
        if (res.ok) {
          const data = await res.json();
          // Filter out hidden agents
          const filtered = (data.tests || []).filter(test => !hiddenAgents.includes(test.agentName));
          setRecentTests(filtered);
        }
      } catch (err) {
        console.error('Failed to fetch recent tests:', err);
      } finally {
        setLoadingTests(false);
      }
    }
    fetchRecentTests();
  }, [hiddenAgents]);

  function hideAgent(agentName, event) {
    event.preventDefault();
    event.stopPropagation();
    const updated = [...hiddenAgents, agentName];
    setHiddenAgents(updated);
    localStorage.setItem('hiddenAgents', JSON.stringify(updated));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const repoPath = extractGitHubRepo(input);
    if (!repoPath) {
      setError('Please enter a valid GitHub repository (e.g., owner/repo or https://github.com/owner/repo)');
      return;
    }
    setError(null);
    setInput('');
    // Navigate to test page with repo
    await router.push(repoPath);
  }

  return (
    <main>
      <section className="hero">
        <h1>UniTest</h1>
        <p className="tagline">
          <img alt="RemoteAgent" className="tagline-logo" src="https://dev-cloud.remoteagent.com/favicon-32x32.png" />
          RemoteAgent Showcase
        </p>

        <form className="input-row" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Enter GitHub repo (owner/repo or full URL)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-label="GitHub Repository"
            autoFocus
          />
          <button className="button" type="submit">
            Generate Tests
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}

        <div className="features">
          <div className="feature-card">
            <div className="feature-icon">🧪</div>
            <h3>Smart Test Generation</h3>
            <p>Automatically generate comprehensive unit tests for your code</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h3>Edge Case Coverage</h3>
            <p>Identify and test edge cases you might have missed</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Multiple Frameworks</h3>
            <p>Support for Jest, Mocha, PyTest, and more</p>
          </div>
        </div>

        {!loadingTests && recentTests.length > 0 && (
          <div className="recent-tests-section">
            <h2 className="recent-tests-title">Recently Tested Repositories</h2>
            <div className="recent-tests-grid">
              {recentTests.map((test) => (
                <div key={test.agentName} className="recent-test-card-wrapper">
                  <Link
                    href={`/${test.owner}/${test.name}`}
                    className="recent-test-card"
                  >
                    <div className="recent-test-header">
                      <h3 className="recent-test-repo">
                        {test.owner}/{test.name}
                      </h3>
                      <span className={`recent-test-status recent-test-status--${test.status}`}>
                        {test.status}
                      </span>
                    </div>
                    <div className="recent-test-meta">
                      <span className="recent-test-time">{formatTimeAgo(test.updatedAt)}</span>
                      <span className="recent-test-link">View Results →</span>
                    </div>
                  </Link>
                  <button
                    className="recent-test-remove"
                    onClick={(e) => hideAgent(test.agentName, e)}
                    title="Remove from list"
                    aria-label="Remove from list"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
