// Revenue Scout — discovers monetizable side-project opportunities via OpenClaw
// Runs every 6 hours in autonomous mode.
// Delegates web research to OpenClaw (ChatGPT Pro CLI) and registers
// discovered opportunities in the Project DB.

import { spawn } from 'node:child_process';
import type { Logger } from './logger.js';
import type { HunterConfig } from './config.js';

// === OpenClaw CLI execution ===
// Reuses the same pattern as task_executor.ts for invoking OpenClaw.

type OpenClawResult = {
  success: boolean;
  output: string;
  error?: string;
};

// Duck-typed ProjectDB interface to avoid circular imports.
// Any object with create() and get_all() methods will work.
type ProjectDBLike = {
  create: (params: {
    title: string;
    category: string;
    expected_revenue: string;
    resources_needed: string[];
  }) => { id: string };
  get_all: () => { title: string }[];
};

// Single opportunity discovered by OpenClaw research
export type Opportunity = {
  title: string;
  category: string;
  expected_revenue: string;
  resources_needed: string[];
  reasoning: string;
};

// Result of a complete scout cycle
export type ScoutResult = {
  opportunities_found: number;
  projects_created: string[]; // IDs of newly created projects
  errors: string[];
};

// Public API for the revenue scout module
export type RevenueScout = {
  run_scout_cycle: () => Promise<ScoutResult>;
};

// Scout timeout: 5 minutes — OpenClaw needs time to research multiple sources
const SCOUT_TIMEOUT_MS = 300_000;

// Build the OpenClaw research prompt with existing project titles for dedup
export const build_scout_prompt = (existing_titles: string[]): string => {
  const titles_list = existing_titles.length > 0
    ? existing_titles.join(', ')
    : '(none)';

  return `You are the brain of Hunter, an autonomous revenue agent. Your mission is to find monetizable side-project opportunities.

Search these sources:
1. GitHub Trending (last 7 days) — look for tools/frameworks that could become paid services
2. ProductHunt — recent popular products that could be replicated/adapted
3. Overseas communities (IndieHackers, r/SideProject, r/Entrepreneur) — proven revenue models
4. AI tool trends — new AI capabilities that enable new business models

For each opportunity, evaluate:
- Can one person build an MVP in under 1 week?
- Is there Korean market demand?
- Expected monthly revenue range
- Required technical resources

Already known projects (skip these): ${titles_list}

Return a JSON array (no markdown, just raw JSON):
[{
  "title": "Project name",
  "category": "youtube_shorts_automation|blog_seo_auto_content|micro_saas|print_on_demand|info_brokerage|github_trending_service|other",
  "expected_revenue": "월 XX만원",
  "resources_needed": ["tool1", "tool2"],
  "reasoning": "Why this is promising"
}]

Find 3-5 opportunities. Be creative but realistic.`;
};

// Execute OpenClaw CLI with the given prompt and timeout.
// Returns structured result with success flag, output text, and optional error.
export const exec_openclaw = (
  command: string,
  agent: string,
  prompt: string,
  timeout_ms: number,
): Promise<OpenClawResult> => {
  return new Promise((resolve) => {
    const proc = spawn(command, ['agent', '--agent', agent, '-m', prompt, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout_ms,
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: `OpenClaw exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message.includes('ENOENT')
          ? 'OpenClaw not installed. Run: npm install -g openclaw@latest && openclaw onboard'
          : err.message,
      });
    });
  });
};

// Extract JSON array from raw text.
// Tries direct JSON.parse first, then falls back to extracting
// JSON from markdown code blocks (```json ... ``` or ``` ... ```).
export const parse_opportunities = (raw: string): Opportunity[] | null => {
  // Attempt 1: direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as Opportunity[];
    }
    return null;
  } catch {
    // Attempt 2: extract JSON from markdown code blocks
    // Matches ```json\n[...]\n``` or ```\n[...]\n```
    const code_block_match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (code_block_match) {
      try {
        const parsed = JSON.parse(code_block_match[1].trim());
        if (Array.isArray(parsed)) {
          return parsed as Opportunity[];
        }
      } catch {
        // Fall through to return null
      }
    }

    // Attempt 3: find the first JSON array bracket pair in the output
    const array_match = raw.match(/\[[\s\S]*\]/);
    if (array_match) {
      try {
        const parsed = JSON.parse(array_match[0]);
        if (Array.isArray(parsed)) {
          return parsed as Opportunity[];
        }
      } catch {
        // Fall through to return null
      }
    }

    return null;
  }
};

// Validate that an opportunity object has all required fields
const is_valid_opportunity = (opp: unknown): opp is Opportunity => {
  if (typeof opp !== 'object' || opp === null) return false;
  const o = opp as Record<string, unknown>;
  return (
    typeof o.title === 'string' && o.title.length > 0 &&
    typeof o.category === 'string' &&
    typeof o.expected_revenue === 'string' &&
    Array.isArray(o.resources_needed)
  );
};

// Create the revenue scout module with injected dependencies
export const create_revenue_scout = (deps: {
  config: HunterConfig;
  logger: Logger;
  project_db: ProjectDBLike;
}): RevenueScout => {
  const { config, logger, project_db } = deps;

  const run_scout_cycle = async (): Promise<ScoutResult> => {
    const result: ScoutResult = {
      opportunities_found: 0,
      projects_created: [],
      errors: [],
    };

    logger.info('revenue_scout: starting scout cycle');

    // Step 1: Get existing project titles for deduplication
    const existing_projects = project_db.get_all();
    const existing_titles = new Set(
      existing_projects.map((p) => p.title.toLowerCase()),
    );

    logger.info(`revenue_scout: ${existing_titles.size} existing projects for dedup`);

    // Step 2: Build and send the research prompt to OpenClaw
    const prompt = build_scout_prompt([...existing_titles]);
    const openclaw_result = await exec_openclaw(
      config.openclaw_command,
      config.openclaw_agent,
      prompt,
      SCOUT_TIMEOUT_MS,
    );

    if (!openclaw_result.success) {
      const error_msg = `OpenClaw failed: ${openclaw_result.error}`;
      logger.error(`revenue_scout: ${error_msg}`);
      result.errors.push(error_msg);
      return result;
    }

    logger.info(`revenue_scout: OpenClaw returned ${openclaw_result.output.length} chars`);

    // Step 3: Parse the response into opportunities
    const opportunities = parse_opportunities(openclaw_result.output);

    if (!opportunities) {
      const error_msg = 'Failed to parse OpenClaw response as JSON';
      logger.error(`revenue_scout: ${error_msg}`);
      result.errors.push(error_msg);
      return result;
    }

    result.opportunities_found = opportunities.length;
    logger.info(`revenue_scout: found ${opportunities.length} opportunities`);

    // Step 4: Register each opportunity as a project (skip duplicates)
    for (const opp of opportunities) {
      // Validate opportunity structure
      if (!is_valid_opportunity(opp)) {
        const error_msg = `Invalid opportunity structure: ${JSON.stringify(opp).slice(0, 200)}`;
        logger.warn(`revenue_scout: ${error_msg}`);
        result.errors.push(error_msg);
        continue;
      }

      // Check for duplicate title (case-insensitive)
      if (existing_titles.has(opp.title.toLowerCase())) {
        logger.info(`revenue_scout: skipping duplicate "${opp.title}"`);
        continue;
      }

      // Register in project DB
      try {
        const project = project_db.create({
          title: opp.title,
          category: opp.category,
          expected_revenue: opp.expected_revenue,
          resources_needed: opp.resources_needed,
        });

        result.projects_created.push(project.id);
        // Add to existing titles set to prevent duplicates within the same batch
        existing_titles.add(opp.title.toLowerCase());
        logger.info(`revenue_scout: created project "${opp.title}" (${project.id})`);
      } catch (err) {
        const error_msg = `Failed to create project "${opp.title}": ${err instanceof Error ? err.message : String(err)}`;
        logger.error(`revenue_scout: ${error_msg}`);
        result.errors.push(error_msg);
      }
    }

    logger.info(
      `revenue_scout: cycle complete — ${result.opportunities_found} found, ` +
      `${result.projects_created.length} created, ${result.errors.length} errors`,
    );

    return result;
  };

  return { run_scout_cycle };
};
