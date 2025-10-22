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

function renderOutputItems(items, isChat = false) {
  if (!Array.isArray(items) || items.length === 0) {
    if (isChat) {
      // For chat messages, don't show error if no output yet
      return null;
    }
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

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [currentChatResponseId, setCurrentChatResponseId] = useState(null);
  const [isChatPolling, setIsChatPolling] = useState(false);
  const [isChatHistoryLoaded, setIsChatHistoryLoaded] = useState(false);

  // Load chat history from agent responses on mount
  useEffect(() => {
    if (!derivedAgentName || !derivedResponseId || isChatHistoryLoaded) {
      return;
    }

    const loadChatHistory = async () => {
      try {
        // Fetch all responses for this agent
        const allResponsesRes = await fetch(`/api/ra/agents/${encodeURIComponent(derivedAgentName)}/responses`);
        if (!allResponsesRes.ok) {
          setIsChatHistoryLoaded(true);
          return;
        }

        const allResponses = await allResponsesRes.json();

        // Filter to only show followup chat messages (not initial test generation)
        const chatResponses = Array.isArray(allResponses)
          ? allResponses.filter(r => {
              if (!r || !r.id) return false;

              // Skip the current/initial response
              if (r.id === derivedResponseId) return false;

              // Extract user's input using input_content (per API docs)
              const inputContent = r.input_content?.[0]?.content || '';

              // Filter out the initial test generation prompt
              // It contains "Clone" and "**Step 1:" keywords and is very long
              if (inputContent.length > 500 ||
                  (inputContent.includes('Clone') && inputContent.includes('**Step 1:'))) {
                return false;
              }

              return true;
            }).sort((a, b) => {
              // Sort by created_at ascending (oldest first)
              const dateA = new Date(a.created_at || 0);
              const dateB = new Date(b.created_at || 0);
              return dateA - dateB;
            })
          : [];

        // Convert responses to chat messages
        const messages = [];
        for (const resp of chatResponses) {
          if (!resp || !resp.id) continue;

          // Extract user message using input_content (per API docs)
          let userContent = '';
          if (resp.input_content && Array.isArray(resp.input_content) && resp.input_content.length > 0) {
            const firstContent = resp.input_content[0];
            if (firstContent && typeof firstContent.content === 'string') {
              userContent = firstContent.content;
            }
          }

          // Skip if we couldn't extract a valid user message
          if (!userContent || userContent.trim().length === 0) continue;

          // Add user message
          messages.push({
            id: `user-${resp.id}`,
            type: 'user',
            content: userContent,
            timestamp: resp.created_at || new Date().toISOString()
          });

          // Check if this response timed out (status is still pending/processing and response is old)
          let finalStatus = resp.status;
          const responseAge = new Date() - new Date(resp.created_at);
          const isStale = responseAge > 3600000; // 1 hour old

          if ((resp.status === 'pending' || resp.status === 'processing') && isStale) {
            // Likely timed out - check if agent is sleeping
            try {
              const agentStateRes = await fetch(`/api/ra/agents/${encodeURIComponent(derivedAgentName)}/state`);
              if (agentStateRes.ok) {
                const agentData = await agentStateRes.json();
                if (agentData.state === 'slept') {
                  finalStatus = 'busy_timeout';
                }
              }
            } catch (stateErr) {
              console.error('[UniTest] Error checking agent state during history load:', stateErr);
            }
          }

          // Add agent response
          messages.push({
            id: resp.id,
            type: 'agent',
            content: userContent,
            timestamp: resp.updated_at || resp.created_at || new Date().toISOString(),
            response: normalizeResponse(resp),
            status: finalStatus,
            agentState: finalStatus === 'busy_timeout' ? 'slept' : undefined
          });
        }

        setChatMessages(messages);
        setIsChatHistoryLoaded(true);
      } catch (error) {
        console.error('[UniTest] Error loading chat history:', error);
        setIsChatHistoryLoaded(true);
      }
    };

    loadChatHistory();
  }, [derivedAgentName, derivedResponseId, isChatHistoryLoaded]);

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

  // Poll for chat response updates every 3 seconds
  useEffect(() => {
    if (!derivedAgentName || !currentChatResponseId || !isChatPolling) {
      return undefined;
    }

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ra/responses/${encodeURIComponent(derivedAgentName)}/${encodeURIComponent(currentChatResponseId)}`);
        if (!res.ok) {
          throw new Error(`Chat polling failed with status ${res.status}`);
        }
        const data = normalizeResponse(await res.json());
        if (!cancelled && data) {
          // Check if response is pending for too long - might indicate agent sleep
          if (data.status === 'pending' || data.status === 'processing') {
            // Check agent state
            try {
              const agentStateRes = await fetch(`/api/ra/agents/${encodeURIComponent(derivedAgentName)}/state`);
              if (agentStateRes.ok) {
                const agentData = await agentStateRes.json();
                // If agent is sleeping, mark this message as timed out
                if (agentData.state === 'slept') {
                  setChatMessages(prev => prev.map(msg =>
                    msg.id === currentChatResponseId
                      ? { ...msg, response: data, status: 'busy_timeout', agentState: 'slept' }
                      : msg
                  ));
                  setIsChatPolling(false);
                  setCurrentChatResponseId(null);
                  clearInterval(interval);
                  return;
                }
              }
            } catch (stateErr) {
              console.error('[UniTest Chat] Error checking agent state:', stateErr);
            }
          }

          // Update the chat message with the response
          setChatMessages(prev => prev.map(msg =>
            msg.id === currentChatResponseId
              ? { ...msg, response: data, status: data.status }
              : msg
          ));

          if (isTerminal(data.status)) {
            setIsChatPolling(false);
            setCurrentChatResponseId(null);
            clearInterval(interval);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[UniTest Chat] Polling error', err);
        }
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [derivedAgentName, currentChatResponseId, isChatPolling]);

  // Handle chat submission
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isSendingChat || !derivedAgentName) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setIsSendingChat(true);

    // Add user message to chat
    const userMsgId = Date.now().toString();
    setChatMessages(prev => [...prev, {
      id: userMsgId,
      type: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: derivedAgentName,
          message: userMessage
        })
      });

      if (!res.ok) {
        throw new Error('Failed to send message');
      }

      const chatResponse = await res.json();

      // Add agent message placeholder to chat
      setChatMessages(prev => [...prev, {
        id: chatResponse.id,
        type: 'agent',
        content: userMessage,
        timestamp: new Date().toISOString(),
        response: chatResponse,
        status: chatResponse.status
      }]);

      // Start polling for this response
      setCurrentChatResponseId(chatResponse.id);
      setIsChatPolling(true);
    } catch (error) {
      console.error('[UniTest Chat] Error sending message:', error);
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        type: 'error',
        content: 'Failed to send message. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsSendingChat(false);
    }
  };

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
          <span className="test-brand-separator">×</span>
          <span className="test-brand-subtitle">
            <img alt="RemoteAgent" className="remoteagent-logo" src="https://dev-cloud.remoteagent.com/favicon-32x32.png" />
            <span className="remoteagent-text">RemoteAgent</span>
          </span>
        </Link>
      </div>

      <div className="test-card">
        <div className="repo-summary">
          <div className="repo-header">
            <div className="repo-title-container">
              <svg className="github-icon" viewBox="0 0 16 16" width="28" height="28" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
              </svg>
              <h1 className="repo-title">
                <span className="repo-title__owner">{owner}</span>
                <span className="repo-title__slash">/</span>
                <span className="repo-title__name">{name}</span>
              </h1>
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="repo-link-button"
                title="View on GitHub"
              >
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-3.5a.75.75 0 00-1.5 0v3.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-8.5a.25.25 0 01.25-.25h3.5a.75.75 0 000-1.5h-3.5z"></path>
                  <path d="M10.75 2a.75.75 0 000 1.5h1.69L7.22 8.72a.75.75 0 101.06 1.06l5.22-5.22v1.69a.75.75 0 001.5 0V2h-4.25z"></path>
                </svg>
                View Repository
              </a>
            </div>
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

        {isTerminal(status) && !isFailed && !isCancelled && (
          <section className="chat-section">
            <div className="chat-header">
              <h2 className="chat-title">Ask Follow-up Questions</h2>
              <p className="chat-subtitle">Continue the conversation with the test agent</p>
            </div>

            {chatMessages.length > 0 && (
              <div className="chat-messages">
                {chatMessages.map((msg) => {
                  if (msg.type === 'user') {
                    return (
                      <div key={msg.id} className="chat-message chat-message--user">
                        <div className="chat-message__label">You</div>
                        <div className="chat-message__content">{msg.content}</div>
                      </div>
                    );
                  }

                  if (msg.type === 'agent') {
                    const agentStatus = msg.status || 'pending';
                    const isAgentTerminal = isTerminal(agentStatus) || agentStatus === 'busy_timeout';
                    const agentOutputItems = isAgentTerminal && msg.response?.output_content
                      ? msg.response.output_content
                      : [];

                    const isBusyTimeout = agentStatus === 'busy_timeout' || msg.agentState === 'slept';

                    return (
                      <div key={msg.id} className="chat-message chat-message--agent">
                        <div className="chat-message__label">Agent</div>
                        <div className="chat-message__content">
                          {!isAgentTerminal && (
                            <p className="chat-message__thinking">
                              {formatCommentary(extractLatestCommentary(msg.response?.segments)) || 'Thinking...'}
                            </p>
                          )}
                          {isBusyTimeout && (
                            <div className="chat-message__timeout">
                              <p style={{ margin: 0, fontWeight: 600, color: 'var(--accent-rose)' }}>⏱️ Agent Busy Timeout</p>
                              <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
                                The agent was busy with another task and couldn't respond in time. The agent has now gone to sleep to conserve resources.
                              </p>
                              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
                                Please try your question again, or generate a new test to wake the agent.
                              </p>
                            </div>
                          )}
                          {isAgentTerminal && agentStatus === 'failed' && !isBusyTimeout && (
                            <p className="chat-message__error">Failed to process your message.</p>
                          )}
                          {isAgentTerminal && agentStatus === 'completed' && !isBusyTimeout && (
                            <div className="chat-message__output">
                              {renderOutputItems(agentOutputItems, true)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (msg.type === 'error') {
                    return (
                      <div key={msg.id} className="chat-message chat-message--error">
                        <div className="chat-message__content">{msg.content}</div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            )}

            <form onSubmit={handleChatSubmit} className="chat-input-form">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about the tests, coverage, or request changes..."
                className="chat-input"
                disabled={isSendingChat || isChatPolling}
              />
              <button
                type="submit"
                className="chat-submit"
                disabled={!chatInput.trim() || isSendingChat || isChatPolling}
              >
                {isSendingChat ? 'Sending...' : 'Send'}
              </button>
            </form>
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
