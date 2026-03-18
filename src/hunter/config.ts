// Hunter agent configuration loader
// Reads from environment variables with sensible defaults

export type HunterConfig = {
  captain_api_url: string;
  hunter_api_key?: string;  // API key for captain authentication (Defense in Depth)
  poll_interval_ms: number;
  log_dir: string;
  device_name: string;
  // Google Chrome profile directory for persistent login sessions
  google_profile_dir: string;
  // Timeout for Gemini Deep Research automation (research can take 1-5 min)
  deep_research_timeout_ms: number;
  // Timeout for NotebookLM verification automation
  notebooklm_timeout_ms: number;
  // OpenClaw ChatGPT browser automation timeout (response wait)
  chatgpt_timeout_ms: number;
  // Notification config — hunter's own tokens, separate from captain
  telegram_bot_token?: string;
  telegram_chat_id?: string;
  slack_webhook_url?: string;
};

export const load_hunter_config = (): HunterConfig => {
  const captain_api_url = process.env.CAPTAIN_API_URL;
  if (!captain_api_url) {
    throw new Error('CAPTAIN_API_URL environment variable is required');
  }

  const hunter_api_key = process.env.HUNTER_API_KEY;
  if (!hunter_api_key) {
    console.warn('[Hunter] HUNTER_API_KEY not set — API key authentication disabled');
  }

  return {
    captain_api_url,
    hunter_api_key,
    poll_interval_ms: parseInt(process.env.HUNTER_POLL_INTERVAL ?? '10000', 10),
    log_dir: process.env.HUNTER_LOG_DIR ?? './logs',
    device_name: 'hunter',
    google_profile_dir: process.env.GOOGLE_PROFILE_DIR ?? './fas-google-profile-hunter',
    deep_research_timeout_ms: parseInt(process.env.DEEP_RESEARCH_TIMEOUT_MS ?? '300000', 10),
    notebooklm_timeout_ms: parseInt(process.env.NOTEBOOKLM_TIMEOUT_MS ?? '180000', 10),
    // OpenClaw ChatGPT browser automation wait time
    chatgpt_timeout_ms: parseInt(process.env.CHATGPT_TIMEOUT_MS ?? '180000', 10),
    // Notification — all optional, hunter works without them (just logs)
    telegram_bot_token: process.env.HUNTER_TELEGRAM_BOT_TOKEN,
    telegram_chat_id: process.env.HUNTER_TELEGRAM_CHAT_ID,
    slack_webhook_url: process.env.HUNTER_SLACK_WEBHOOK_URL,
  };
};
