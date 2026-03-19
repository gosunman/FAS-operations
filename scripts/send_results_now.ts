#!/usr/bin/env tsx
// Send B + C competitor analysis results to Notion + Slack

import { create_notion_client } from '../src/notification/notion.js';
import { WebClient } from '@slack/web-api';

const notion = create_notion_client({
  api_key: process.env.NOTION_API_KEY!,
  database_id: process.env.NOTION_CRAWL_RESULTS_DB!,
});
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

const extract_text = async (task_id: string): Promise<string> => {
  const res = await fetch(`http://localhost:3100/api/tasks/${task_id}`);
  const task = await res.json() as Record<string, unknown>;
  const output = task.output as Record<string, unknown> | undefined;
  const summary = (output?.summary as string) ?? '';
  const json_start = summary.indexOf('{');
  if (json_start >= 0) {
    try {
      const parsed = JSON.parse(summary.slice(json_start));
      const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
      return payloads.map((p: { text: string }) => p.text).join('\n\n');
    } catch { return summary; }
  }
  return summary;
};

// B: Text research
const text_b = await extract_text('ad138755-beaa-4368-a2e8-3204a1738185');
console.log(`[B] Text research: ${text_b.length} chars`);

const page_b = await notion.send_notification({
  type: 'crawl_result',
  message: text_b,
  device: 'hunter',
  severity: 'low',
  metadata: { task_id: 'ad138755', title: '[B] 경쟁 서비스 분석 — 텍스트 리서치 모드' },
});
console.log(`[Notion B] ${page_b.url}`);

// C: Browser mode
const text_c = await extract_text('101a8460-62dc-4fb9-a5c9-7bcbefd65d0a');
console.log(`[C] Browser mode: ${text_c.length} chars`);

const page_c = await notion.send_notification({
  type: 'crawl_result',
  message: text_c,
  device: 'hunter',
  severity: 'low',
  metadata: { task_id: '101a8460', title: '[C] 경쟁 서비스 분석 — OpenClaw 브라우저 모드' },
});
console.log(`[Notion C] ${page_c.url}`);

// Slack — send to #fas-general with Notion links
const b_summary = text_b.slice(0, 200).replace(/\n/g, ' ');
await slack.chat.postMessage({
  channel: '#fas-general',
  text: `🔍 *[경쟁 분석 — 텍스트 리서치]* ${b_summary}…\n📄 <${page_b.url}|Notion에서 원문 보기>`,
});
console.log('[Slack B] sent to #fas-general');

const c_summary = text_c.slice(0, 200).replace(/\n/g, ' ');
await slack.chat.postMessage({
  channel: '#fas-general',
  text: `🔍 *[경쟁 분석 — 브라우저 직접 방문]* ${c_summary}…\n📄 <${page_c.url}|Notion에서 원문 보기>`,
});
console.log('[Slack C] sent to #fas-general');

console.log('\n=== 완료 ===');
console.log('Notion B:', page_b.url);
console.log('Notion C:', page_c.url);
