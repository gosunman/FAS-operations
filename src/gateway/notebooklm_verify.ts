// NotebookLM 3rd-party verification module for FAS factcheck pipeline
// Creates a task via Task API, polls for completion, returns verification result.
// Used as tiebreaker when Claude and Gemini disagree on factcheck.
// Graceful fallback: timeout or error → unverified result (no crash).

// === Types ===

export type VerificationResult = {
  verified: boolean;
  confidence: number;
  explanation: string;
};

export type NotebookLmVerifierDeps = {
  task_api_url: string;         // e.g. "http://localhost:3100"
  poll_interval_ms?: number;    // default 5000 (5s)
  timeout_ms?: number;          // default 180000 (3 min)
  fetch_fn?: typeof fetch;      // injectable for testing
};

export type NotebookLmTask = {
  id: string;
  status: string;
  output?: {
    summary?: string;
  };
};

// === Constants ===

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

// === Unverified fallback (safe default) ===

const make_unverified = (reason: string): VerificationResult => ({
  verified: false,
  confidence: 0,
  explanation: `NotebookLM verification unavailable: ${reason}`,
});

// === Parse the completed task output into a VerificationResult ===

export const parse_verification_output = (raw: string): VerificationResult => {
  // Try to extract JSON from the output
  const json_match = raw.match(/\{[\s\S]*\}/);
  if (!json_match) {
    return make_unverified(`could not parse verification output: no JSON found`);
  }

  try {
    const parsed = JSON.parse(json_match[0]) as Record<string, unknown>;

    const verified = typeof parsed.verified === 'boolean' ? parsed.verified : false;
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    const explanation = typeof parsed.explanation === 'string'
      ? parsed.explanation
      : '';

    return { verified, confidence, explanation };
  } catch {
    return make_unverified(`could not parse verification output: invalid JSON`);
  }
};

// === Create a NotebookLM verifier factory ===

export const create_notebooklm_verifier = (deps: NotebookLmVerifierDeps) => {
  const {
    task_api_url,
    poll_interval_ms = DEFAULT_POLL_INTERVAL_MS,
    timeout_ms = DEFAULT_TIMEOUT_MS,
    fetch_fn = fetch,
  } = deps;

  // POST /api/tasks to create a notebooklm_verify task
  const create_verification_task = async (
    content: string,
    context?: string,
  ): Promise<string | null> => {
    try {
      const res = await fetch_fn(`${task_api_url}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `NotebookLM factcheck verification`,
          description: JSON.stringify({ content, context }),
          assigned_to: 'captain',
          priority: 'high',
          mode: 'notebooklm_verify',
        }),
      });

      if (!res.ok) return null;

      const task = await res.json() as NotebookLmTask;
      return task.id ?? null;
    } catch {
      return null;
    }
  };

  // GET /api/tasks/:id and check for completion
  const poll_task = async (task_id: string): Promise<NotebookLmTask | null> => {
    try {
      const res = await fetch_fn(`${task_api_url}/api/tasks/${task_id}`);
      if (!res.ok) return null;
      return await res.json() as NotebookLmTask;
    } catch {
      return null;
    }
  };

  // Sleep helper (injectable via fetch_fn doesn't matter here)
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Main verification function: create task, poll until done or timeout
  const request_notebooklm_verification = async (
    content: string,
    context?: string,
  ): Promise<VerificationResult> => {
    // Step 1: Create task
    const task_id = await create_verification_task(content, context);
    if (!task_id) {
      return make_unverified('failed to create verification task');
    }

    // Step 2: Poll with timeout
    const deadline = Date.now() + timeout_ms;

    while (Date.now() < deadline) {
      await sleep(poll_interval_ms);

      const task = await poll_task(task_id);
      if (!task) continue; // transient error, keep polling

      if (task.status === 'done' || task.status === 'completed') {
        const raw_output = task.output?.summary ?? '';
        if (!raw_output) {
          return make_unverified('verification task completed but no output');
        }
        return parse_verification_output(raw_output);
      }

      if (task.status === 'blocked' || task.status === 'failed') {
        return make_unverified(`verification task ${task.status}`);
      }

      // Still pending/in-progress — keep polling
    }

    // Timeout
    return make_unverified('verification timed out after 3 minutes');
  };

  return {
    request_notebooklm_verification,
    // Expose internals for testing
    _create_verification_task: create_verification_task,
    _poll_task: poll_task,
  };
};
