// Hunter agent configuration loader
// Reads from environment variables with sensible defaults

export type HunterConfig = {
  captain_api_url: string;
  poll_interval_ms: number;
  log_dir: string;
  device_name: string;
};

export const load_hunter_config = (): HunterConfig => {
  const captain_api_url = process.env.CAPTAIN_API_URL;
  if (!captain_api_url) {
    throw new Error('CAPTAIN_API_URL environment variable is required');
  }

  return {
    captain_api_url,
    poll_interval_ms: parseInt(process.env.HUNTER_POLL_INTERVAL ?? '10000', 10),
    log_dir: process.env.HUNTER_LOG_DIR ?? './logs',
    device_name: 'hunter',
  };
};
