// Quick integration test: send real messages to Telegram and Slack
import 'dotenv/config';
import { create_telegram_client } from '../src/notification/telegram.js';
import { create_slack_client } from '../src/notification/slack.js';

const run = async () => {
  let telegram_ok = false;
  let slack_ok = false;

  // === Telegram ===
  console.log('[TEST] Telegram 전송 중...');
  try {
    const tg = create_telegram_client({
      token: process.env.TELEGRAM_BOT_TOKEN!,
      chat_id: process.env.TELEGRAM_CHAT_ID!,
    });
    const result = await tg.send('🧪 *FAS 테스트* — Telegram 연동 성공!', 'alert');
    telegram_ok = result.success;
    console.log('[Telegram]', result.success ? '✅ 성공' : '❌ 실패', result);
    tg.stop();
  } catch (err) {
    console.error('[Telegram] ❌ 에러:', err);
  }

  // === Slack ===
  console.log('[TEST] Slack 전송 중...');
  try {
    const slack = create_slack_client({
      token: process.env.SLACK_BOT_TOKEN!,
    });
    const result = await slack.send('#fas-alerts', '🧪 *FAS 테스트* — Slack 연동 성공!');
    slack_ok = result;
    console.log('[Slack]', result ? '✅ 성공' : '❌ 실패');
  } catch (err) {
    console.error('[Slack] ❌ 에러:', err);
  }

  // === Summary ===
  console.log('\n========== 결과 ==========');
  console.log(`Telegram: ${telegram_ok ? '✅' : '❌'}`);
  console.log(`Slack:    ${slack_ok ? '✅' : '❌'}`);

  process.exit(telegram_ok && slack_ok ? 0 : 1);
};

run();
