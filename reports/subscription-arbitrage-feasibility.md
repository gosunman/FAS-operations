# Subscription Arbitrage Feasibility Report

**Date**: 2026-03-23
**Subject**: Claude Max subscription (CLI daemon on Captain) as backend for GrantCraft
**Author**: Captain (AI Agent)

## Executive Summary

Using Claude Max subscription via `claude -p` CLI on Captain Mac Studio to process GrantCraft requests instead of the Anthropic API is **technically feasible** but has significant latency and reliability trade-offs. Recommended only as a cost-reduction measure for low-volume async use cases, not as a primary production backend.

## Architecture Proposal

```
[User Browser] -> [Vercel API Route] -> [Queue (Turso/Supabase)]
                                              |
                              [Captain Mac Studio daemon]
                              polls queue -> claude -p "prompt"
                              writes result -> Queue
                                              |
[User Browser] <- polling /api/status/[id] <- [Vercel API Route]
```

### 1. Queue Storage Options

**Turso (SQLite edge)**
- Pros: Already in FAS stack consideration, low latency reads from Vercel edge
- Cons: Need to set up Turso account, schema migration
- Schema: `jobs(id, status, input_json, output_json, created_at, completed_at, error)`

**Supabase**
- Pros: Already connected via MCP, realtime subscriptions possible
- Cons: Slightly more latency than Turso for simple queue operations
- Can use Supabase Realtime to push completion events instead of polling

**Recommendation**: Supabase is simpler since we already have it connected. Use a single `grant_jobs` table.

### 2. CLI Daemon on Captain

```bash
# Can be called programmatically
claude -p "system prompt here" --model claude-opus-4-6 < input.txt > output.txt
```

**Implementation**:
- TypeScript daemon running in tmux session (`fas-captain`)
- Polls Supabase every 5-10 seconds for pending jobs
- Executes `claude -p` via `execFile()` (safe subprocess spawning, no shell injection)
- Writes result back to Supabase
- Handles timeouts (5 min per request) and retries (max 3)

```typescript
// Pseudocode
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

const process_job = async (job: Job) => {
  const result = await exec_file('claude', ['-p', job.prompt], {
    timeout: 300_000, // 5 min
  });
  await supabase.from('grant_jobs').update({
    status: 'completed',
    output_json: result.stdout,
    completed_at: new Date().toISOString(),
  }).eq('id', job.id);
};
```

### 3. Latency Analysis

| Component | Latency |
|-----------|---------|
| User submit -> Vercel -> Supabase write | ~200ms |
| Daemon poll interval | 5-10s average |
| Claude CLI cold start | 2-5s |
| Claude Opus 4.6 generation (8K tokens) | 30-90s |
| Result write to Supabase | ~200ms |
| User poll -> Vercel -> Supabase read | ~200ms |
| **Total end-to-end** | **40-110s** |

Compare to current API direct call: **30-60s** (no queue overhead)

**User experience**: User submits, sees "processing" screen, polls every 5s. Result appears within 1-2 minutes. Acceptable for a free tool generating a 3000+ character business proposal.

### 4. Concurrency and Throughput

- Claude Max subscription: effectively **1 concurrent request** via CLI
- With 50 users and 3 uses each = **150 total requests**
- At ~60s per request, serial processing = **2.5 hours** to drain full queue
- Peak scenario: 10 users submit simultaneously -> last user waits ~10 minutes

**Mitigation**:
- Show queue position to user ("3rd in line, estimated 3 minutes")
- Process during off-peak hours (users are Korean, peak = daytime KST)
- Keep API fallback for premium/paid users

### 5. Security Considerations

**Risks**:
1. **User input reaches Captain Claude Code session**: The prompt contains user-submitted business ideas. These are not sensitive to the owner, but could theoretically contain prompt injection attempts.
   - **Mitigation**: Sanitize input before passing to CLI (already done in validate.ts). Wrap in structured prompt template, not raw user text.

2. **CLI output parsing**: Claude CLI output is plain text, not structured API response.
   - **Mitigation**: Use the same `extract_json` + `parse_proposal_response` parser that already handles varied output formats.

3. **Supabase credentials exposure**: Vercel and Captain both need Supabase access.
   - **Mitigation**: Use Supabase service role key only on Captain (server-side). Use anon key with RLS on Vercel.

4. **Rate abuse**: Without API-level rate limiting, users could flood the queue.
   - **Mitigation**: Existing invite code system + rate limiter in route.ts already handles this.

5. **Claude Max ToS compliance**: Using subscription CLI to process third-party requests may violate Anthropic Terms of Service for Max plan.
   - **Risk level**: MEDIUM. The Max plan is intended for individual developer use. Processing requests on behalf of other users through a web service could be considered a violation.
   - **Mitigation**: Review Anthropic Max plan ToS carefully before deploying.

### 6. Cost Analysis

| Approach | Monthly Cost | Notes |
|----------|-------------|-------|
| API (current) | $0.15/req x 150 = **~$22.50** | Pay per use, predictable |
| API (50 users, heavy) | $0.15 x 500 = **~$75** | Worst case |
| Max subscription | **$0** incremental | Already paying for Max |
| Hybrid (API + Max overflow) | **~$10-15** | API for first 100, Max for overflow |

At current scale (50 users, 3 uses each), the API cost is ~$22.50, which is negligible. Subscription arbitrage saves minimal money at this scale.

### 7. Recommendation

**For current launch (2026-03-24 deadline): Do NOT implement.**
- API direct call works fine
- Cost is negligible (~$22)
- Adding queue complexity before a deadline is high-risk

**For future scaling (post-launch):**
- Consider if monthly API costs exceed $50-100
- Implement as async "economy mode" for free tier users
- Keep API as "instant mode" for paid users
- Verify Anthropic Max plan ToS compliance first

### 8. Implementation Effort

| Task | Effort |
|------|--------|
| Supabase table + RLS | 1 hour |
| Captain daemon (poll + execFile) | 3 hours |
| Vercel queue submit endpoint | 2 hours |
| Vercel poll/status endpoint | 1 hour |
| Frontend async UX (progress, polling) | 3 hours |
| Testing + edge cases | 3 hours |
| **Total** | **~13 hours** |

## Conclusion

Technically feasible, but not worth implementing before the 2026-03-24 launch. The API cost at expected scale (~$22) does not justify the 13+ hours of development time and added complexity. Revisit post-launch if user volume exceeds expectations and API costs become significant.
