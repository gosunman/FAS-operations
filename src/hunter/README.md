# Hunter Agent

> Dual-mode autonomous agent: Captain tasks + self-directed revenue projects

## Purpose

Hunter is the "eyes" and autonomous revenue arm of the FAS system. It runs on an isolated Mac Studio (M1 Max 32GB) with two operating modes:

- **Captain Mode**: Polls Captain's Task API for assigned work (web crawling, research, analysis)
- **Autonomous Mode**: Self-directed revenue project discovery, execution, and learning via OpenClaw (ChatGPT Pro)

When Captain becomes unreachable, Hunter automatically switches to autonomous mode and pursues revenue projects. When Captain recovers, Hunter switches back.

## Architecture

```
Captain (Mac Studio #2)          Hunter (Mac Studio #1)
┌──────────────┐                 ┌─────────────────────────────────┐
│ Gateway API  │◄── Tailscale ──►│ Mode Router                     │
│ :3100        │                 │   Captain alive? → Captain Mode  │
│              │                 │   Captain dead?  → Autonomous    │
│              │                 ├─────────────────────────────────┤
│              │                 │ CAPTAIN MODE:                    │
│              │                 │   Poll Loop → Task Executor      │
│              │                 │     ├ web_crawl        ✅        │
│              │                 │     ├ browser_task     ✅        │
│              │                 │     ├ deep_research    ✅        │
│              │                 │     ├ notebooklm       ✅        │
│              │                 │     └ chatgpt_task     ✅        │
│              │                 ├─────────────────────────────────┤
│              │                 │ AUTONOMOUS MODE:                 │
│              │                 │   Revenue Scout (6h cycle)       │
│              │                 │     → discover opportunities     │
│              │                 │   Project Executor               │
│              │                 │     → advance most promising     │
│              │                 │   Retrospective Engine           │
│              │                 │     → daily/weekly self-review   │
│              │                 │   Reporter                       │
│              │                 │     → Telegram alerts + reports  │
│              │                 ├─────────────────────────────────┤
│              │                 │ ┌─────────┐ ┌──────────┐        │
│              │                 │ │Playwright│ │OpenClaw   │        │
│              │                 │ │(Browser) │ │(ChatGPT) │        │
│              │                 │ └─────────┘ └──────────┘        │
│              │                 │          ↓                       │
│              │                 │ ┌──────────────────┐            │
│              │                 │ │ Project DB (SQLite)│            │
│              │                 │ └──────────────────┘            │
└──────────────┘                 └─────────────────────────────────┘
```

## Module Structure

### Core System
| File | Description |
|------|-------------|
| `main.ts` | Entry point — dual mode startup, mode transitions, daily scheduling |
| `mode_router.ts` | Captain API health monitor — switches between captain/autonomous |
| `poll_loop.ts` | Captain mode polling loop with exponential backoff + dedup |
| `task_executor.ts` | Action routing + 5 handler implementations |
| `api_client.ts` | HTTP client for Captain Task API |

### Autonomous Revenue System
| File | Description |
|------|-------------|
| `project_db.ts` | SQLite project pipeline (discovered → succeeded/failed) |
| `revenue_scout.ts` | OpenClaw-powered opportunity discovery (6h cycle) |
| `project_executor.ts` | Advances projects through stages via OpenClaw |
| `retrospective.ts` | Daily/weekly self-reflection + failure analysis |
| `reporter.ts` | Telegram alerts + file reports + daily summary |
| `seed_first_project.ts` | Seeds MoneyPrinterV2 as first autonomous project |

### Infrastructure
| File | Description |
|------|-------------|
| `config.ts` | Environment variable config loader (captain + autonomous) |
| `logger.ts` | File + console dual logger |
| `notify.ts` | Telegram/Slack notification (fire-and-forget) |
| `browser.ts` | Playwright browser manager |

### Specialized Features
| File | Description |
|------|-------------|
| `startup_grants.ts` | K-Startup grant parser + matching |
| `housing_lottery.ts` | Housing lottery parser + matching |
| `grant_notifier.ts` | Grant → Notion format + alerts |
| `housing_notifier.ts` | Housing → Notion format + alerts |

## Project Lifecycle

```
discovered → researching → planned → building → testing → deployed → monitoring → succeeded
                                                                                   ↓
                                                                                 failed
                                                                                   ↓
                                                                              (retrospective)
```

Each stage is delegated to OpenClaw with stage-specific timeouts:
- Research: 30 min
- Planning: 15 min
- Building: 60 min
- Testing: 30 min
- Deployment: 30 min

## How to Run

```bash
# From project root
pnpm run hunter

# Or directly
npx tsx src/hunter/main.ts

# Seed first project
npx tsx src/hunter/seed_first_project.ts
```

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `CAPTAIN_API_URL` | Captain Task API URL (e.g., `http://100.64.0.1:3100`) |
| `HUNTER_API_KEY` | Shared secret for API authentication |

### Optional — Captain Mode
| Variable | Default | Description |
|----------|---------|-------------|
| `HUNTER_POLL_INTERVAL` | `10000` | Poll interval in ms |
| `HUNTER_HEADLESS` | `true` | Browser headless mode |
| `GOOGLE_PROFILE_DIR` | `./fas-google-profile-hunter` | Chrome profile for Google login |
| `DEEP_RESEARCH_TIMEOUT_MS` | `300000` | Gemini Deep Research timeout |
| `NOTEBOOKLM_TIMEOUT_MS` | `180000` | NotebookLM timeout |
| `CHATGPT_TIMEOUT_MS` | `180000` | OpenClaw task timeout |

### Optional — Autonomous Mode
| Variable | Default | Description |
|----------|---------|-------------|
| `HUNTER_DB_PATH` | `./data/hunter_projects.db` | Project pipeline SQLite DB |
| `HUNTER_REPORTS_DIR` | `./reports` | Daily/weekly report directory |
| `HUNTER_SCOUT_INTERVAL_MS` | `21600000` (6h) | Revenue scout cycle interval |
| `CAPTAIN_HEALTH_CHECK_INTERVAL_MS` | `30000` (30s) | Captain API health check interval |
| `CAPTAIN_FAILURE_THRESHOLD` | `3` | Consecutive failures before autonomous switch |

### Optional — Notifications
| Variable | Description |
|----------|-------------|
| `HUNTER_TELEGRAM_BOT_TOKEN` | Hunter's own Telegram bot token |
| `HUNTER_TELEGRAM_CHAT_ID` | Owner's Telegram chat ID |
| `HUNTER_SLACK_WEBHOOK_URL` | Hunter's Slack webhook URL |

## Output

- Logs: `./logs/hunter_{date}.log`
- Screenshots: `./output/{task_id}.png`
- Project DB: `./data/hunter_projects.db`
- Reports: `./reports/daily/`, `./reports/weekly/`, `./reports/failures/`
- Daily Telegram summary at 22:00 KST
