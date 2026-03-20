// Notification module barrel export
export { create_telegram_client, type TelegramClient, type TelegramConfig } from './telegram.js';
export { create_slack_client, type SlackClient, type SlackConfig } from './slack.js';
export { create_notification_router, type NotificationRouter, type NotificationRouterDeps, type ResilientRouterConfig } from './router.js';
export { create_notion_client, type NotionClient, type NotionConfig } from './notion.js';
