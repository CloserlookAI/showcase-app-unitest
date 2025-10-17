import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { marked } from 'marked';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
marked.setOptions({ breaks: true });

function isTerminal(status) {
  if (!status) return false;
  return TERMINAL_STATUSES.has(String(status).toLowerCase());
}

function normalizeResponse(resp) {
  if (!resp || typeof resp !== 'object') return null;
  const segments = Array.isArray(resp.segments) ? resp.segments : [];
  const output = Array.isArray(resp.output_content) ? resp.output_content : [];
  return { ...resp, segments, output_content: output };
}

function extractLatestCommentary(segments) {
  if (!Array.isArray(segments)) return null;
  for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
    const entry = segments[idx];
    if (!entry || typeof entry !== 'object') continue;
    const type = (entry.type || '').toLowerCase();
    if (type === 'commentary') {
      const text = entry?.text || entry?.content || '';
      if (typeof text === 'string' && text.trim()) return text;
    }
  }
  return null;
}

function formatCommentary(commentary) {
  if (!commentary) return null;
  const cleaned = String(commentary).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length <= 140) return cleaned;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 0) {
    const lastSentence = sentences[sentences.length - 1];
    if (lastSentence.length <= 140) return lastSentence;
  }
  return `${cleaned.slice(0, 137)}…`;
}

function renderOutputItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <p className="output-panel__error">
        The agent did not return any test results.
      </p>
    );
  }

  return items.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const type = (item.type || '').toLowerCase();

    if (type === 'markdown' || type === 'text') {
      const markdown = typeof item.content === 'string' ? item.content : '';
      const html = marked.parse(markdown || '');
      return (
        <section className="output-panel__item" key={`out-${index}`}>
          <div
            className="output-panel__markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </section>
      );
    }

    if (type === 'json') {
      const value = item.content ?? item;
      const formatted = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return (
        <section className="output-panel__item" key={`out-${index}`}>
          <pre className="output-panel__markdown">{formatted}</pre>
        </section>
      );
    }

    return null;
  });
}

export default function RepoTestPage({ owner, name, repoUrl, agentName, response: initialResponse, responseId: initialResponseId, setupError, repoStats }) {
  const normalizedInitial = useMemo(() => normalizeResponse(initialResponse), [initialResponse]);
  const [response, setResponse] = useState(normalizedInitial);
  const derivedResponseId = response?.id || initialResponseId || null;
  const derivedAgentName = response?.agent_name || agentName || null;
  const [isPolling, setIsPolling] = useState(() => Boolean(derivedResponseId && !isTerminal((normalizedInitial?.status) || 'pending')));
  const [pollError, setPollError] = useState(null);

  // Poll for response updates every 3 seconds
  useEffect(() => {
    if (!derivedAgentName || !derivedResponseId || !isPolling) {
      return undefined;
    }

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ra/responses/${encodeURIComponent(derivedAgentName)}/${encodeURIComponent(derivedResponseId)}`);
        if (!res.ok) {
          throw new Error(`Polling failed with status ${res.status}`);
        }
        const data = normalizeResponse(await res.json());
        if (!cancelled && data) {
          setResponse(data);
          setPollError(null);
          if (isTerminal(data.status)) {
            setIsPolling(false);
            clearInterval(interval);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[UniTest] Polling error', err);
          setPollError('Temporary issue polling agent status…');
        }
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [derivedAgentName, derivedResponseId, isPolling]);

  const status = (response?.status || 'pending').toLowerCase();
  const commentary = useMemo(() => {
    if (isTerminal(status)) return null;
    return extractLatestCommentary(response?.segments);
  }, [status, response?.segments]);

  const outputItems = useMemo(() => {
    if (!isTerminal(status)) return [];
    return Array.isArray(response?.output_content) ? response.output_content : [];
  }, [response?.output_content, status]);

  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  const missingSetup = setupError || !derivedAgentName || !derivedResponseId;

  const statusMessage = useMemo(() => {
    if (missingSetup) {
      return setupError || 'Required configuration is missing.';
    }

    if (isTerminal(status)) {
      if (isFailed) {
        return `The agent failed to generate/run tests for ${owner}/${name}.`;
      } else if (isCancelled) {
        return `The request was cancelled before completion.`;
      } else {
        return `Test execution completed for ${owner}/${name}.`;
      }
    } else {
      return formatCommentary(commentary) || `Analyzing ${owner}/${name} and running tests…`;
    }
  }, [commentary, isCancelled, isFailed, missingSetup, name, owner, setupError, status]);

  if (missingSetup) {
    return (
      <main className="test-page">
        <Link href="/" className="test-brand">UniTest</Link>
        <div className="test-card">
          <div className="repo-header">
            <h1 className="repo-title">
              <span className="repo-title__segment">{owner}</span>
              <span className="repo-title__slash">/</span>
              <span className="repo-title__segment">{name}</span>
            </h1>
          </div>
          <p className="test-status__message">{statusMessage}</p>
        </div>
        <footer className="test-footer">
          <Link href="/">Try another repository</Link>
        </footer>
      </main>
    );
  }

  return (
    <main className="test-page">
      <div className="test-page-header">
        <Link href="/" className="test-brand-link">
          <span className="test-brand-text">UniTest</span>
          <span className="test-brand-separator">·</span>
          <span className="test-brand-subtitle">RemoteAgent</span>
        </Link>
      </div>

      <div className="test-card">
        <div className="repo-summary">
          <div className="repo-header">
            <h1 className="repo-title">
              <span className="repo-title__segment">{owner}</span>
              <span className="repo-title__slash">/</span>
              <span className="repo-title__segment repo-title__segment--repo">
                {name}
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="repo-title__arrow"
                  title="View on GitHub"
                >
                  ↗
                </a>
              </span>
            </h1>
          </div>

          {repoStats?.description && (
            <p className="repo-description">{repoStats.description}</p>
          )}
        </div>

        {!isTerminal(status) && (
          <section className="test-progress" aria-live="polite">
            <p className="test-status__message test-status__message--active">
              {statusMessage}
            </p>
            {pollError && (
              <p className="test-status__message">{pollError}</p>
            )}
          </section>
        )}

        {isTerminal(status) && (
          <section className="output-panel" aria-live="polite">
            {isFailed && (
              <p className="output-panel__error">
                The agent failed to generate/run tests for {owner}/{name}. Please try again later.
              </p>
            )}
            {isCancelled && (
              <p className="output-panel__error">
                The request was cancelled before completion. Please try again.
              </p>
            )}
            {!isFailed && !isCancelled && renderOutputItems(outputItems)}
          </section>
        )}

        <footer className="test-footer">
          <Link href="/">Test another repository</Link>
        </footer>
      </div>
    </main>
  );
}

// Server-side: Create or reuse agent and response
export async function getServerSideProps(context) {
  const { params } = context;
  const slug = Array.isArray(params?.slug) ? params.slug : [];

  if (slug.length < 2) {
    return { redirect: { destination: '/', permanent: false } };
  }

  const [owner, name] = slug;
  const repoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  // Validate GitHub repo
  let repoInfo = null;
  try {
    const githubRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      headers: { 'User-Agent': 'unitest-app', Accept: 'application/vnd.github+json' }
    });
    if (!githubRes.ok) throw new Error(`GitHub responded with ${githubRes.status}`);
    repoInfo = await githubRes.json();
    if (repoInfo?.private) throw new Error('Repository is private');
  } catch (error) {
    return { redirect: { destination: `/?error=repo_inaccessible`, permanent: false } };
  }

  const repoStats = { description: repoInfo?.description ?? null, language: repoInfo?.language ?? null };

  const adminToken = process.env.RA_APPS_UNITEST_ADMIN_TOKEN;
  const raHost = process.env.RA_HOST_URL;

  if (!adminToken || !raHost) {
    return {
      props: {
        owner, name, repoUrl, agentName: null, response: null, responseId: null,
        setupError: 'Required RA credentials are missing. Set RA_HOST_URL and RA_APPS_UNITEST_ADMIN_TOKEN.',
        repoStats
      }
    };
  }

  const base = raHost.endsWith('/') ? raHost.slice(0, -1) : raHost;
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'unitest-app'
  };

  const tagValue = `${owner}/${name}`;

  // Try to find existing agent by tag
  try {
    const listRes = await fetch(`${base}/api/v0/agents?tags=${encodeURIComponent(tagValue)}&limit=1`, { headers });
    if (listRes.ok) {
      const page = await listRes.json();
      const found = Array.isArray(page.items) && page.items.length ? page.items[0] : null;

      if (found && found.name) {
        // Agent exists, get latest response
        const responsesRes = await fetch(`${base}/api/v0/agents/${encodeURIComponent(found.name)}/responses?limit=1`, { headers });
        if (responsesRes.ok) {
          const list = await responsesRes.json();
          if (Array.isArray(list) && list.length > 0) {
            return {
              props: { owner, name, repoUrl, agentName: found.name, response: list[0], responseId: list[0].id, setupError: null, repoStats }
            };
          }
        }

        // Create new response for existing agent
        const messageBody = {
          input: {
            content: [{
              type: 'text',
              content: `Clone ${repoUrl}. After cloning, follow these steps:

**Step 1: Detect existing tests**
Search for test files (test*.py, *test*.js, *_spec.rb, test/, tests/, etc.).

**Step 2: Determine scenario and execute:**

**Scenario A** - Has tests with >80% coverage:
- Run existing tests
- Generate HTML test report
- Output report in markdown

**Scenario B** - Has partial tests (<80% coverage):
- Run tests and measure coverage
- Generate tests for uncovered code
- Run all tests (existing + new)
- Generate HTML report with before/after comparison
- Output report in markdown

**Scenario C** - No tests:
- Analyze codebase
- Generate comprehensive unit tests
- Run generated tests
- Generate HTML report
- Output report in markdown

**IMPORTANT - You must provide TWO complete outputs:**

**1. Detailed Markdown Output (display directly):**
Write a comprehensive markdown report including:
- Executive Summary: Key metrics (coverage %, total tests, pass/fail counts, execution time)
- Repository Analysis: Languages detected, frameworks found, existing test infrastructure
- Test Execution Details:
  * All commands you ran (with full output)
  * Test results by file/module with pass/fail details
  * Any errors, warnings, or issues encountered
  * Screenshots or logs of test execution
- Coverage Analysis:
  * Overall coverage percentage (before/after if applicable)
  * Per-file coverage breakdown with specific percentages
  * Functions/lines covered vs uncovered
- Generated Tests:
  * Show 5-10 example tests you created (full code with syntax highlighting)
  * Explain what each test does and why it's important
  * List ALL test files created with their full paths
- Recommendations: Detailed suggestions for improving coverage and code quality

**2. Complete HTML Report (publish to content server):**
Create a professional, comprehensive HTML report with:
- Clean, modern design with proper CSS styling and mobile responsiveness
- Executive summary dashboard (coverage %, test counts, status badges)
- Full test execution logs (commands, output, timestamps)
- Complete test results table (all tests with status, assertions, execution time, error messages)
- Coverage visualization (charts, graphs, per-file breakdowns with color coding)
- ALL generated test code (syntax highlighted, organized by file)
- Before/after comparison (if applicable)
- Detailed recommendations section
- Navigation menu for easy browsing

Publish the HTML report to the content server and provide the link at the END of your markdown output.

**Both outputs must be complete and detailed. The markdown should be substantial (not just a link), and the HTML should include everything in even greater detail.**`
            }]
          }
        };

        const responseRes = await fetch(`${base}/api/v0/agents/${encodeURIComponent(found.name)}/responses`, {
          method: 'POST', headers, body: JSON.stringify(messageBody)
        });
        if (!responseRes.ok) throw new Error('Failed to enqueue response');
        const response = await responseRes.json();
        return { props: { owner, name, repoUrl, agentName: found.name, response, responseId: response.id, setupError: null, repoStats } };
      }
    }
  } catch (e) {
    console.warn('[UniTest] Agent reuse check failed:', e);
  }

  // Create new agent with readable naming
  function sanitizeName(str) {
    return str.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  }

  function createShortHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString().slice(0, 4);
  }

  const cleanName = sanitizeName(name);
  const shortId = createShortHash(`${owner}/${name}`);
  const agentName = `ut-${cleanName}-${shortId}`;

  try {
    const agentPayload = {
      name: agentName,
      description: `UniTest agent for ${owner}/${name}`,
      tags: ['unitest', tagValue],
      metadata: { source: 'unitest', repository: { owner, name, url: repoUrl } },
      instructions: `You are UniTest, an intelligent test generation and analysis agent. Your mission is to help developers achieve comprehensive test coverage.

**Core Capabilities:**
- Detect and analyze existing test suites and measure code coverage
- Generate comprehensive unit tests for uncovered code (normal paths, edge cases, error handling, input validation)
- Execute complete test suites and collect detailed results
- Produce clean, professional HTML reports with proper structure, color coding, and syntax highlighting

**HTML Report Standards:**
Your reports must be well-structured, visually appealing, and professionally formatted with:
- Executive Summary (coverage %, total tests, pass/fail counts)
- Coverage Analysis (before/after comparison, by file/module)
- Test Results (detailed tables with status, execution time, assertions)
- Generated Tests (syntax-highlighted code blocks)
- Recommendations (actionable suggestions for improvement)
- Clean HTML5 markup, proper CSS styling, color coding (green/red/yellow), progress bars, and mobile-responsive design

Always deliver thorough, professional output that helps developers improve code quality.`,
      busy_timeout_seconds: 1800
    };

    const createAgentRes = await fetch(`${base}/api/v0/agents`, {
      method: 'POST', headers, body: JSON.stringify(agentPayload)
    });
    if (!createAgentRes.ok) throw new Error('Failed to create agent');

    const messageBody = {
      input: {
        content: [{
          type: 'text',
          content: `Clone ${repoUrl}. After cloning, follow these steps:

**Step 1: Detect existing tests**
Search for test files (test*.py, *test*.js, *_spec.rb, test/, tests/, etc.).

**Step 2: Determine scenario and execute:**

**Scenario A** - Has tests with >80% coverage:
- Run existing tests
- Generate HTML test report
- Output report in markdown

**Scenario B** - Has partial tests (<80% coverage):
- Run tests and measure coverage
- Generate tests for uncovered code
- Run all tests (existing + new)
- Generate HTML report with before/after comparison
- Output report in markdown

**Scenario C** - No tests:
- Analyze codebase
- Generate comprehensive unit tests
- Run generated tests
- Generate HTML report
- Output report in markdown

**IMPORTANT - You must provide TWO complete outputs:**

**1. Detailed Markdown Output (display directly):**
Write a comprehensive markdown report including:
- Executive Summary: Key metrics (coverage %, total tests, pass/fail counts, execution time)
- Repository Analysis: Languages detected, frameworks found, existing test infrastructure
- Test Execution Details:
  * All commands you ran (with full output)
  * Test results by file/module with pass/fail details
  * Any errors, warnings, or issues encountered
  * Screenshots or logs of test execution
- Coverage Analysis:
  * Overall coverage percentage (before/after if applicable)
  * Per-file coverage breakdown with specific percentages
  * Functions/lines covered vs uncovered
- Generated Tests:
  * Show 5-10 example tests you created (full code with syntax highlighting)
  * Explain what each test does and why it's important
  * List ALL test files created with their full paths
- Recommendations: Detailed suggestions for improving coverage and code quality

**2. Complete HTML Report (publish to content server):**
Create a professional, comprehensive HTML report with:
- Clean, modern design with proper CSS styling and mobile responsiveness
- Executive summary dashboard (coverage %, test counts, status badges)
- Full test execution logs (commands, output, timestamps)
- Complete test results table (all tests with status, assertions, execution time, error messages)
- Coverage visualization (charts, graphs, per-file breakdowns with color coding)
- ALL generated test code (syntax highlighted, organized by file)
- Before/after comparison (if applicable)
- Detailed recommendations section
- Navigation menu for easy browsing

Publish the HTML report to the content server and provide the link at the END of your markdown output.

**Both outputs must be complete and detailed. The markdown should be substantial (not just a link), and the HTML should include everything in even greater detail.**`
        }]
      }
    };

    const responseRes = await fetch(`${base}/api/v0/agents/${encodeURIComponent(agentName)}/responses`, {
      method: 'POST', headers, body: JSON.stringify(messageBody)
    });
    if (!responseRes.ok) throw new Error('Failed to enqueue response');

    const response = await responseRes.json();
    return { props: { owner, name, repoUrl, agentName, response, responseId: response.id, setupError: null, repoStats } };
  } catch (error) {
    console.error('[UniTest] Error preparing agent workflow:', error);
    return { redirect: { destination: `/?error=setup_failed`, permanent: false } };
  }
}
