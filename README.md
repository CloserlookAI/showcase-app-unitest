# UniTest - AI-Powered Unit Testing Agent

UniTest is an intelligent unit testing showcase application that analyzes GitHub repositories, detects existing tests, generates missing tests, and produces HTML test reports.

## Features

- **Smart Test Detection**: Automatically detects existing test files and measures code coverage
- **3 Scenario Handling**:
  - **Scenario A**: Repos with good coverage (>80%) - Runs existing tests and generates report
  - **Scenario B**: Repos with partial coverage (<80%) - Generates additional tests for uncovered code
  - **Scenario C**: Repos with no tests - Generates comprehensive test suite from scratch
- **HTML Reports**: Produces detailed test execution reports with coverage metrics
- **Real-time Progress**: Live updates as the agent analyzes and tests your code

## Architecture

- **Frontend**: Next.js 14.2.3 with React 18
- **Styling**: Custom CSS (GitHex-inspired dark theme)
- **Backend**: RemoteAgent API for agent orchestration
- **Port**: 8002

## Setup

### Prerequisites

- Node.js 16+
- Access to a RemoteAgent (Ractor) instance

### Installation

```bash
cd /home/dev/unitest-app
npm install
```

### Environment Variables

The `.env.local` file is already configured with:

```env
RACTOR_HOST_URL=http://159.65.154.242:9000
RACTOR_APPS_UNITEST_ADMIN_TOKEN=<your-token>
```

### Running the App

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

The app will be available at:
- Local: http://localhost:8002
- Network: http://159.65.154.242:8002

## How It Works

1. **User Input**: Paste a GitHub repository URL (e.g., `facebook/react` or `https://github.com/facebook/react`)
2. **Agent Creation**: System creates or reuses an agent tagged with the repo name
3. **Analysis**: Agent clones the repo and detects existing tests
4. **Scenario Selection**: Agent determines which scenario applies based on coverage
5. **Test Generation/Execution**: Agent generates missing tests (if needed) and runs all tests
6. **Report Generation**: Agent produces an HTML test report in markdown format
7. **Display**: Report is rendered with syntax highlighting and formatting

## API Routes

- `GET /api/ractor/responses/[agent]/[response]` - Polls agent response status

## File Structure

```
/home/dev/unitest-app/
├── pages/
│   ├── _app.js              # App wrapper
│   ├── index.js             # Landing page
│   ├── [...slug].js         # Dynamic repo page
│   └── api/
│       └── ractor/
│           └── responses/
│               └── [agent]/
│                   └── [response].js  # Response polling proxy
├── styles/
│   └── globals.css          # Dark theme styles
├── .env.local               # Environment configuration
├── package.json
├── next.config.js
└── README.md
```

## Technologies

- **Next.js**: Server-side rendering and API routes
- **React**: Component-based UI
- **Marked**: Markdown parsing for test reports
- **RemoteAgent API**: Agent orchestration and execution

## Development Notes

- Uses the same UI/UX patterns as GitHex
- Polling interval: 3 seconds
- Agent timeout: 1800 seconds (30 minutes)
- Supports agent reuse via tags for same repositories
# showcase-app-unitest
