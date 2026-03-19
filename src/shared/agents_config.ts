// Load agent configuration from config/agents.yml
// Single source of truth for tmux session names, device assignments, etc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

// === Types ===

export type AgentConfig = {
  display_name: string;
  identity: string;
  device: string;
  account: string;
  autonomy: string;
  tmux_session: string;
  execution_mode: string;
  capabilities: string[];
  max_concurrent_tasks: number;
  allowed_modes: string[];
  priority_weight: number;
  can_access_personal_info: boolean;
  restart_policy?: {
    max_retries: number;
    retry_delay_seconds: number;
    escalate_after: number;
  };
  communication?: string;
  report_to?: Record<string, string>;
};

type AgentsFile = {
  agents: Record<string, AgentConfig>;
};

// === Loader ===

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'config/agents.yml');

export const load_agents_config = (
  config_path = DEFAULT_CONFIG_PATH,
): Record<string, AgentConfig> => {
  const raw = readFileSync(config_path, 'utf-8');
  const parsed = parse(raw) as AgentsFile;
  return parsed.agents;
};

// === Helpers ===

/**
 * Get tmux session names for a specific device (e.g. 'captain', 'hunter').
 * Useful for the output watcher — only watch sessions on our device.
 */
export const get_sessions_for_device = (
  device: string,
  config_path = DEFAULT_CONFIG_PATH,
): string[] => {
  const agents = load_agents_config(config_path);
  return Object.values(agents)
    .filter((agent) => agent.device === device)
    .map((agent) => agent.tmux_session);
};

/**
 * Get all tmux session names across all agents.
 */
export const get_all_sessions = (
  config_path = DEFAULT_CONFIG_PATH,
): string[] => {
  const agents = load_agents_config(config_path);
  return Object.values(agents).map((agent) => agent.tmux_session);
};
