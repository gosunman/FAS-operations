# Hunter Agent

> Browser automation agent running on an isolated device (Mac Studio #1, M1 Ultra)

## Purpose

Hunter is the "eyes" of the FAS system. It executes browser-based tasks delegated by Captain via the Task API. Hunter runs on an isolated machine with no access to personal information — all tasks are sanitized before delivery.

## Architecture

```
Captain (Mac Studio #2)          Hunter (Mac Studio #1)
┌──────────────┐                 ┌──────────────────────┐
│ Gateway API  │◄── Tailscale ──►│ Poll Loop            │
│ :3100        │                 │   ↓                  │
│              │                 │ Task Executor         │
│              │                 │   ├ web_crawl    ✅   │
│              │                 │   ├ browser_task ✅   │
│              │                 │   ├ deep_research ⏳  │
│              │                 │   └ notebooklm   ⏳  │
│              │                 │   ↓                  │
│              │                 │ Browser Manager       │
│              │                 │   └ Playwright        │
└──────────────┘                 └──────────────────────┘
```

## Action Handlers

| Action | Status | Description |
|--------|--------|-------------|
| `web_crawl` | Implemented | Navigate to URL, extract page title + text content |
| `browser_task` | Implemented | Navigate to URL, take screenshot, extract text |
| `deep_research` | Pending | Requires Gemini web UI automation via OpenClaw |
| `notebooklm_verify` | Pending | Requires NotebookLM web UI automation via OpenClaw |

## Module Structure

| File | Description |
|------|-------------|
| `main.ts` | Entry point — sets up browser, executor, poll loop, graceful shutdown |
| `browser.ts` | Playwright browser manager (lazy init, Chromium) |
| `task_executor.ts` | Action routing + handler implementations |
| `poll_loop.ts` | Polling loop with exponential backoff |
| `api_client.ts` | HTTP client for Captain Task API |
| `config.ts` | Environment variable config loader |
| `logger.ts` | File + console dual logger |

## How to Run

```bash
# From project root
pnpm run hunter

# Or directly
npx tsx src/hunter/main.ts
```

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CAPTAIN_API_URL` | Yes | Captain Task API URL (e.g., `http://100.64.0.1:3100`) |
| `HUNTER_API_KEY` | Yes | Shared secret for API authentication |
| `HUNTER_POLL_INTERVAL` | No | Poll interval in ms (default: `10000`) |
| `HUNTER_LOG_DIR` | No | Log directory (default: `./logs`) |
| `HUNTER_HEADLESS` | No | Browser headless mode (default: `true`) |

## Output

- Logs: `./logs/hunter_{date}.log`
- Screenshots: `./output/{task_id}.png` (for `browser_task` actions)
- Extracted content is capped at 10,000 characters per page
