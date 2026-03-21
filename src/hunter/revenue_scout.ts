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

  return `IMPORTANT: You MUST respond with ONLY a JSON array. No explanation, no markdown, no text before or after. Just the JSON array.

You are Hunter, an autonomous revenue agent. Find 3-5 monetizable side-project opportunities from:
1. GitHub Trending (last 7 days) — tools that could become paid services
2. ProductHunt — products that could be replicated for Korean market
3. IndieHackers, r/SideProject — proven solo-founder revenue models
4. AI tool trends — new AI capabilities enabling new businesses

Requirements per opportunity:
- One person can build MVP in under 1 week
- Korean market demand exists
- Monthly revenue potential

Skip these existing projects: ${titles_list}

YOUR RESPONSE MUST BE EXACTLY THIS FORMAT (valid JSON array, nothing else):
[{"title":"Project name","category":"micro_saas","expected_revenue":"월 30만원","resources_needed":["Node.js","Vercel"],"reasoning":"Why promising"}]

Valid categories: youtube_shorts_automation, blog_seo_auto_content, micro_saas, print_on_demand, info_brokerage, github_trending_service, other

RESPOND WITH ONLY THE JSON ARRAY. NO OTHER TEXT.`;
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

// Extract the actual LLM text from OpenClaw's JSON envelope.
// OpenClaw --json returns: {"runId":"...","result":{"payloads":[{"text":"actual response"}]}}
// If the input is not an OpenClaw envelope, returns the input unchanged.
export const extract_openclaw_payload = (raw: string): string => {
  try {
    const envelope = JSON.parse(raw);
    if (envelope?.result?.payloads?.[0]?.text) {
      return envelope.result.payloads[0].text;
    }
    // If parsed but no payloads, return stringified result
    if (envelope?.result) {
      return JSON.stringify(envelope.result);
    }
  } catch {
    // Not JSON envelope — return as-is
  }
  return raw;
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
        // Fall through to attempt 4
      }
    }

    // Attempt 4: extract individual JSON objects {...} and assemble an array
    // Handles cases where OpenClaw returns narrative text with embedded JSON objects
    const object_matches = raw.match(/\{[^{}]*"title"[^{}]*\}/g);
    if (object_matches && object_matches.length > 0) {
      const results: Opportunity[] = [];
      for (const obj_str of object_matches) {
        try {
          const parsed = JSON.parse(obj_str);
          results.push(parsed as Opportunity);
        } catch {
          // Skip malformed objects
        }
      }
      if (results.length > 0) return results;
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

    // Step 2.5: Extract actual LLM response from OpenClaw JSON envelope
    // OpenClaw --json wraps responses in: {"runId":"...","result":{"payloads":[{"text":"..."}]}}
    const raw_text = extract_openclaw_payload(openclaw_result.output);
    logger.info(`revenue_scout: extracted payload (${raw_text.length} chars)`);

    // Step 3: Parse the response into opportunities
    const opportunities = parse_opportunities(raw_text);

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
