# Hunter Agent

> Browser automation + ChatGPT-powered agent running on an isolated device (Mac Studio #1, M1 Ultra)

## Purpose

Hunter is the "eyes" of the FAS system. It executes tasks delegated by Captain via the Task API — from simple web crawling to abstract research powered by ChatGPT (OpenClaw engine). Hunter runs on an isolated machine with no access to personal information — all tasks are sanitized before delivery.

## Architecture

```
Captain (Mac Studio #2)          Hunter (Mac Studio #1)
┌──────────────┐                 ┌──────────────────────────┐
│ Gateway API  │◄── Tailscale ──►│ Poll Loop                │
│ :3100        │                 │   ↓                      │
│              │                 │ Task Executor             │
│              │                 │   ├ web_crawl        ✅   │
│              │                 │   ├ browser_task     ✅   │
│              │                 │   ├ deep_research    ✅   │
│              │                 │   ├ notebooklm       ✅   │
│              │                 │   └ chatgpt_task     ✅   │
│              │                 │   ↓                      │
│              │                 │   ↓                      │
│              │                 │ Playwright (Browser)      │
│              │                 │   └ Persistent Profile    │
│              │                 │     (Google OAuth / B)    │
└──────────────┘                 └──────────────────────────┘
```

## Action Handlers

| Action | Engine | Description |
|--------|--------|-------------|
| `web_crawl` | Playwright | Navigate to URL, extract page title + text content |
| `browser_task` | Playwright | Navigate to URL, take screenshot, extract text |
| `deep_research` | Playwright | Gemini web UI automation (persistent Google profile) |
| `notebooklm_verify` | Playwright | NotebookLM web UI automation (persistent Google profile) |
| `chatgpt_task` | Playwright (ChatGPT Web UI) | Abstract reasoning, analysis, trend exploration via ChatGPT Pro (Google OAuth) |

### Action Routing (resolve_action)

Tasks are routed by keyword matching:
- `notebooklm` / `notebook_lm` → `notebooklm_verify`
- `deep research` / `deep_research` → `deep_research`
- `crawl` / `scrape` / `크롤링` → `web_crawl`
- `chatgpt` / `분석` / `리서치` / `탐색` / `트렌드` / `analyze` / `trend` / `explore` / `research` → `chatgpt_task`
- Default: URL present → `browser_task`, no URL → `chatgpt_task`

## Module Structure

| File | Description |
|------|-------------|
| `main.ts` | Entry point — sets up browser, executor, poll loop, graceful shutdown |
| `browser.ts` | Playwright browser manager (lazy init, ephemeral + persistent contexts) |
| `task_executor.ts` | Action routing + handler implementations (5 handlers incl. ChatGPT browser automation) |
| `poll_loop.ts` | Polling loop with exponential backoff |
| `api_client.ts` | HTTP client for Captain Task API |
| `config.ts` | Environment variable config loader |
| `logger.ts` | File + console dual logger |
| `notify.ts` | Telegram/Slack notification (fire-and-forget) |

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
| `CHATGPT_TIMEOUT_MS` | No | ChatGPT response wait timeout (default: `180000`) |
| `HUNTER_POLL_INTERVAL` | No | Poll interval in ms (default: `10000`) |
| `HUNTER_LOG_DIR` | No | Log directory (default: `./logs`) |
| `HUNTER_HEADLESS` | No | Browser headless mode (default: `true`) |
| `GOOGLE_PROFILE_DIR` | No | Chrome profile for Google login (default: `./fas-google-profile-hunter`) |

## Output

- Logs: `./logs/hunter_{date}.log`
- Screenshots: `./output/{task_id}.png` (for `browser_task` actions)
- Extracted content is capped at 10,000 characters per page
