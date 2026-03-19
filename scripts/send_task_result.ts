#!/usr/bin/env tsx
// One-shot script: send a completed task's result through the notification router
// Usage: tsx scripts/send_task_result.ts <task_id>

import { create_notification_router } from '../src/notification/router.js';
import { create_slack_client } from '../src/notification/slack.js';
import { create_notion_client } from '../src/notification/notion.js';
import { create_telegram_client } from '../src/notification/telegram.js';
import type { NotificationEvent } from '../src/shared/types.js';

const task_id = process.argv[2];
if (!task_id) {
  console.error('Usage: tsx scripts/send_task_result.ts <task_id>');
  process.exit(1);
}

// Fetch task from gateway
const gateway_url = process.env.GATEWAY_URL ?? 'http://localhost:3100';
const res = await fetch(`${gateway_url}/api/tasks/${task_id}`);
if (!res.ok) {
  console.error(`Failed to fetch task ${task_id}: ${res.status}`);
  process.exit(1);
}

const task = await res.json() as Record<string, unknown>;
const output = task.output as Record<string, unknown> | undefined;

// Extract text from output
let result_text = '';
const summary = (output?.summary as string) ?? '';

try {
  // Parse the nested JSON in summary (after "---\n")
  const json_start = summary.indexOf('{');
  if (json_start >= 0) {
    const parsed = JSON.parse(summary.slice(json_start));
    const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
    result_text = payloads.map((p: { text: string }) => p.text).join('\n\n');
  }
} catch {
  result_text = summary;
}

if (!result_text) {
  console.error('No result text found in task output');
  process.exit(1);
}

console.log(`[send_task_result] Task: ${task.title}`);
console.log(`[send_task_result] Result length: ${result_text.length} chars`);

// Build notification stack
const telegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
  ? create_telegram_client({
      bot_token: process.env.TELEGRAM_BOT_TOKEN,
      chat_id: process.env.TELEGRAM_CHAT_ID,
    })
  : null;

const slack = process.env.SLACK_BOT_TOKEN
  ? create_slack_client({ token: process.env.SLACK_BOT_TOKEN })
  : null;

const notion_db = process.env.NOTION_CRAWL_RESULTS_DB ?? process.env.NOTION_DAILY_REPORTS_DB ?? process.env.NOTION_TASK_RESULTS_DB;
const notion = process.env.NOTION_API_KEY && notion_db
  ? create_notion_client({
      api_key: process.env.NOTION_API_KEY,
      database_id: notion_db,
    })
  : null;

const router = create_notification_router({ telegram, slack, notion });

// Send as crawl_result event
const event: NotificationEvent = {
  type: 'crawl_result',
  message: `[${task.title}]\n\n${result_text}`,
  device: 'hunter',
  severity: 'low',
};

console.log('[send_task_result] Sending via notification router...');
const results = await router.route(event);
console.log('[send_task_result] Results:', JSON.stringify(results));

process.exit(0);
