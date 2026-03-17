# Hunter Browsing Rules — OpenClaw

## Bot Detection Bypass

### Human-like Browsing Patterns
- **Random delays**: Wait 2-5 seconds between actions (randomized, not fixed intervals)
- **Natural scrolling**: Scroll gradually, not jump-to-element
- **Mouse movement**: Move cursor naturally before clicking (not teleport)
- **Reading time**: Spend realistic time on pages (proportional to content length)
- **Tab behavior**: Open multiple tabs like a human would, don't process pages sequentially in one tab

### Technical Measures
- Use Chrome with `--user-data-dir` for persistent sessions (avoid fresh profiles)
- Maintain consistent user-agent across sessions
- Accept cookies normally — don't block or clear between requests
- Allow JavaScript execution — don't disable it
- Use residential-quality IP (home network via Tailscale)

### Rate Limiting
- Maximum 30 page loads per minute across all tabs
- Maximum 100 API-like requests per minute
- Back off exponentially if CAPTCHAs appear
- Pause 10+ minutes if blocked, then resume with reduced rate

## Allowed Sites

### Always Allowed (Green List)
| Category | Sites |
|----------|-------|
| News / Tech | HackerNews, Reddit, TechCrunch, The Verge, ArsTechnica |
| Research | arxiv.org, scholar.google.com, papers.ssrn.com |
| Korean Gov/Startup | K-Startup, 창업진흥원, 청약홈, 정부24, TIPS |
| Development | GitHub (public repos), StackOverflow, MDN, npm, PyPI |
| AI / Tools | Hugging Face, ProductHunt, AlternativeTo |
| Market Data | CrunchBase (public), AngelList (public), LinkedIn (public) |
| General | Wikipedia, YouTube (search/watch), Google Search |

### Conditional (Yellow List) — Proceed with Caution
| Category | Sites | Condition |
|----------|-------|-----------|
| Google Services | Gmail, Drive, Calendar | **Hunter Account B ONLY** — never Account A |
| Social Media | Twitter/X, Facebook, Instagram | Read-only, no posting, no login to owner's accounts |
| Forums | Specific subreddits, Discourse forums | Read-only unless Hunter has dedicated account |

### Forbidden (Red List) — Never Access
| Category | Sites | Reason |
|----------|-------|--------|
| Owner's Accounts | Owner's Gmail, banking, social media | PII protection |
| Financial | Any banking/payment sites | Critical prohibition |
| FAS Infrastructure | Captain's Task API (except designated endpoints) | Isolation |
| Sensitive | Dark web, illegal content, malware sites | Legal/ethical |
| Owner's Clients | Student management platforms, client portals | PII protection |

## Google Account Rules

### Hunter-Dedicated Account (Account B) Only
- All Google service access MUST use Hunter's dedicated Account B
- Chrome profile: `/Users/user/fas-google-profile-hunter/`
- Never log into Account A from Hunter's machine
- If session expires: report to owner for manual re-login (VNC)

### Google Services Usage
- **Google Search**: Freely usable for research
- **NotebookLM**: Use for verification tasks delegated by Captain
- **Gemini/Deep Research**: Use for exploration and analysis
- **Google Drive**: Hunter's own Drive only (Account B)
- **Gmail**: Hunter's own Gmail only (Account B) — for service signups if needed

## Data Collection Rules

### What to Collect
- Public information relevant to owner's interests
- Trend data, market analysis, opportunity assessments
- Technical documentation, tutorials, best practices
- News, announcements, policy changes

### What NOT to Collect
- Personally identifiable information (PII) of any person
- Private/proprietary data behind authentication walls (unless Hunter's own account)
- Copyrighted content in full (summaries and excerpts with attribution are OK)
- Financial data of individuals or private companies

### Data Handling
- All collected data flows through Task API to Captain — no local long-term storage
- Temporary files are cleared after task completion
- Browser cache is periodically cleared (Watchdog manages this)
- No data persistence across reinitializations (except designated preservation data on Captain)

## Error Handling

### CAPTCHA Encountered
1. First attempt: Wait 30 seconds, try again
2. Second attempt: Switch to different approach (different search query, different site)
3. Third attempt: Report `[BLOCKED]` and move to next task

### Site Blocking
1. Do NOT retry aggressively — this worsens the block
2. Report the block to Captain via Task API
3. Try alternative sources for the same information
4. If critical, report `[BLOCKED]` for owner attention

### Session Expiry
1. Report "Login required" via Task API to Captain
2. Captain/Watchdog sends Telegram notification to owner
3. Wait for owner to manually re-login via VNC
4. Resume operations after session is restored
