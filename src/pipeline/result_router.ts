// Result Router — routes completed hunter task results to specialized handlers
// Dispatches by task title (matching schedule names) to the appropriate
// parser/notifier pipeline. Fallback: generic crawl_result notification.
//
// Wired into server.ts POST /api/hunter/tasks/:id/result after security + PII checks.

import type { NotificationRouter } from '../notification/router.js';
import type { NotificationEvent } from '../shared/types.js';
import type { ResearchStore } from '../captain/research_store.js';
import type { SmartEscalator, EscalationSeverity } from '../notification/smart_escalation.js';
import { process_blind_results } from './blind_monitor.js';
import { parse_grant_announcements, detect_new_grants, match_grant_to_profile, calculate_deadline_alerts, generate_grant_report } from '../hunter/startup_grants.js';
import { create_grant_notification_handler } from '../hunter/grant_notifier.js';
import { parse_housing_announcements, detect_new_housing, match_housing_to_profile, generate_housing_report } from '../hunter/housing_lottery.js';
import { create_housing_notification_handler } from '../hunter/housing_notifier.js';

// === Types ===

export type ResultRouterDeps = {
  router: NotificationRouter;
  research_store?: ResearchStore | null;
  escalator?: SmartEscalator | null; // optional: time-aware Telegram escalation for high-value results
};

export type RouteResult = {
  handled: boolean;
  handler: string;       // which handler processed this (for logging)
  error?: string;        // if handler threw, capture message here
};

export type TaskInfo = {
  id: string;
  title: string;
  description?: string;
  action?: string;
};

// === Route matching — maps task title keywords to handler names ===

// Order matters — more specific patterns first to avoid false matches.
// E.g., "에듀테크 경쟁사 딥 리서치" must match edutech_competitors, not deep_research.
const ROUTE_MAP: Array<{ pattern: RegExp; handler: string }> = [
  { pattern: /창업지원사업/i, handler: 'grant' },
  { pattern: /청약/i, handler: 'housing' },
  { pattern: /블라인드.*NVC|NVC.*수요/i, handler: 'blind_nvc' },
  { pattern: /블라인드.*네이버|blind.*naver/i, handler: 'blind' },
  { pattern: /에듀테크.*경쟁사|edutech.*competitor/i, handler: 'edutech_competitors' },
  { pattern: /AI 트렌드|ai.?trend/i, handler: 'ai_trends' },
  { pattern: /빅테크.*커리어|bigtech.*job|글로벌.*빅테크/i, handler: 'bigtech_jobs' },
  { pattern: /대학원.*지원|grad.*school|OMSCS|GSEP/i, handler: 'grad_school' },
  { pattern: /Lighthouse|lighthouse|SEO.*성능/i, handler: 'lighthouse' },
  { pattern: /B2B.*인텐트|b2b.*intent/i, handler: 'b2b_intent' },
  { pattern: /AI 에이전트.*자동화|ai.?agent.*automation/i, handler: 'ai_agent_automation' },
  { pattern: /FAS.*개선.*인텔|fas.*improvement/i, handler: 'fas_improvement' },
  { pattern: /Claude Code.*업데이트|claude.?code.*update/i, handler: 'claude_code_updates' },
  // deep_research must be last among content patterns — "딥 리서치" appears in other titles
  { pattern: /^deep.?research|^딥.?리서치/i, handler: 'deep_research' },
];

// Identify handler by task title
export const match_handler = (title: string): string => {
  for (const { pattern, handler } of ROUTE_MAP) {
    if (pattern.test(title)) return handler;
  }
  return 'generic';
};

// === High-value detection — determines if a result warrants Telegram escalation ===
//
// Rules (from task spec):
// - Grant: priority === 'high' (regardless of deadline)
// - Housing: priority === 'residence'
// - Blind: category === 'hot' (comments 50+ or likes 100+)
// - Bigtech jobs: brand_tier === 'S' or brand_tier === 'A'
// - AI trends: items with matched_keywords.length >= 2
// - Everything else: Slack only (no Telegram escalation)
//
// Since handler output is a raw string from ChatGPT/crawlers, we use heuristic
// keyword/pattern matching on the output text to detect high-value signals.

type HighValueResult = {
  title: string;
  summary: string;
  severity: EscalationSeverity;
};

export const detect_high_value = (handler_name: string, output: string): HighValueResult | null => {
  switch (handler_name) {
    case 'grant': {
      // High-priority grant: look for priority markers in output
      const has_high_priority = /priority[:\s]*["']?high/i.test(output)
        || /우선순위[:\s]*높음/i.test(output)
        || /긴급|즉시\s?지원/i.test(output);
      if (has_high_priority) {
        const snippet = output.slice(0, 120).replace(/\n/g, ' ');
        return { title: 'Grant: 고우선 공고 감지', summary: snippet, severity: 'high' };
      }
      return null;
    }

    case 'housing': {
      // Residence-priority housing: look for residence markers
      const has_residence = /priority[:\s]*["']?residence/i.test(output)
        || /거주[용지]?\s*(우선|적합|매칭)/i.test(output)
        || /강남.*1시간|50\s*㎡/i.test(output);
      if (has_residence) {
        const snippet = output.slice(0, 120).replace(/\n/g, ' ');
        return { title: 'Housing: 거주용 청약 매칭', summary: snippet, severity: 'high' };
      }
      return null;
    }

    case 'blind':
    case 'blind_nvc': {
      // Hot posts: comments 50+ or likes 100+
      const comment_match = output.match(/comment_count[:\s]*(\d+)/i)
        ?? output.match(/댓글[:\s]*(\d+)/);
      const like_match = output.match(/like_count[:\s]*(\d+)/i)
        ?? output.match(/좋아요[:\s]*(\d+)/);
      const comments = comment_match ? parseInt(comment_match[1], 10) : 0;
      const likes = like_match ? parseInt(like_match[1], 10) : 0;
      const has_hot = comments >= 50 || likes >= 100
        || /category[:\s]*["']?hot/i.test(output)
        || /🔥\s*hot/i.test(output);
      if (has_hot) {
        const snippet = output.slice(0, 120).replace(/\n/g, ' ');
        return {
          title: handler_name === 'blind_nvc' ? 'Blind: NVC 핫 포스트' : 'Blind: 네이버 핫 포스트',
          summary: `댓글 ${comments}+ / 좋아요 ${likes}+ — ${snippet}`,
          severity: 'medium',
        };
      }
      return null;
    }

    case 'bigtech_jobs': {
      // S-tier or A-tier brand matches
      const has_top_tier = /brand_tier[:\s]*["']?[SA]/i.test(output)
        || /tier[:\s]*["']?[SA]/i.test(output)
        || /\b(Google|Apple|Meta|Amazon|Microsoft|Netflix|OpenAI)\b/i.test(output);
      if (has_top_tier) {
        const snippet = output.slice(0, 120).replace(/\n/g, ' ');
        return { title: 'Bigtech: S/A급 포지션 발견', summary: snippet, severity: 'high' };
      }
      return null;
    }

    case 'ai_trends': {
      // Multiple keyword matches (matched_keywords.length >= 2)
      const keyword_matches = output.match(/matched_keywords[:\s]*\[([^\]]*)\]/i);
      if (keyword_matches) {
        const keywords = keyword_matches[1].split(',').filter(Boolean);
        if (keywords.length >= 2) {
          const snippet = output.slice(0, 120).replace(/\n/g, ' ');
          return { title: 'AI Trend: 다중 키워드 매칭', summary: `${keywords.length}개 키워드 — ${snippet}`, severity: 'medium' };
        }
      }
      // Fallback: check for multiple relevant keyword mentions in plain text
      const ai_keywords = ['LLM', 'GPT', 'Claude', 'Gemini', 'transformer', 'RAG', 'fine-tuning', 'agent', 'multimodal'];
      const found_keywords = ai_keywords.filter((kw) => new RegExp(kw, 'i').test(output));
      if (found_keywords.length >= 2) {
        const snippet = output.slice(0, 120).replace(/\n/g, ' ');
        return { title: 'AI Trend: 다중 키워드 매칭', summary: `키워드: ${found_keywords.join(', ')} — ${snippet}`, severity: 'medium' };
      }
      return null;
    }

    // These three are ALWAYS high-value — owner explicitly requested daily delivery
    case 'ai_agent_automation': {
      const snippet = output.slice(0, 200).replace(/\n/g, ' ');
      return { title: '🤖 AI Agent 자동화 동향', summary: snippet, severity: 'high' };
    }

    case 'fas_improvement': {
      const snippet = output.slice(0, 200).replace(/\n/g, ' ');
      return { title: '🔧 FAS 개선 인텔리전스', summary: snippet, severity: 'high' };
    }

    case 'claude_code_updates': {
      const snippet = output.slice(0, 200).replace(/\n/g, ' ');
      return { title: '🧠 Claude Code 업데이트', summary: snippet, severity: 'high' };
    }

    default:
      // All other handlers: no Telegram escalation
      return null;
  }
};

// === Create the result router factory ===

export const create_result_router = (deps: ResultRouterDeps) => {
  const { router, research_store, escalator } = deps;

  // Pre-create notification handlers that need factory initialization
  const grant_handler = create_grant_notification_handler({ router });
  const housing_handler = create_housing_notification_handler({ router });

  // Route a completed task's output to the appropriate handler
  const route = async (task: TaskInfo, output: string): Promise<RouteResult> => {
    const handler_name = match_handler(task.title);

    try {
      let result: RouteResult;

      switch (handler_name) {
        case 'grant':
          result = await handle_grant(output, task);
          break;

        case 'housing':
          result = await handle_housing(output, task);
          break;

        case 'blind':
        case 'blind_nvc':
          result = await handle_blind(output, task, handler_name);
          break;

        case 'ai_trends':
          result = await handle_formatted_result(output, task, '🤖 AI Trend Research');
          break;

        case 'bigtech_jobs':
          result = await handle_formatted_result(output, task, '💼 Bigtech Career Scan');
          break;

        case 'edutech_competitors':
          result = await handle_formatted_result(output, task, '🔬 Edutech Competitor Research');
          break;

        case 'grad_school':
          result = await handle_formatted_result(output, task, '🎓 Grad School Deadline');
          break;

        case 'lighthouse':
          result = await handle_formatted_result(output, task, '🔍 Lighthouse Audit');
          break;

        case 'b2b_intent':
          result = await handle_formatted_result(output, task, '🎯 B2B Intent Crawl');
          break;

        case 'ai_agent_automation':
          result = await handle_formatted_result(output, task, '🤖 AI Agent Automation Intel');
          break;

        case 'fas_improvement':
          result = await handle_formatted_result(output, task, '🔧 FAS Improvement Intel');
          break;

        case 'claude_code_updates':
          result = await handle_formatted_result(output, task, '🧠 Claude Code Updates');
          break;

        case 'deep_research':
          result = await handle_deep_research(output, task);
          break;

        default:
          result = await handle_generic(output, task);
          break;
      }

      // After successful handling, check for high-value escalation
      if (result.handled && escalator) {
        const escalation = detect_high_value(handler_name, output);
        if (escalation) {
          // Fire-and-forget: escalation failure should not break result routing
          escalator.escalate(escalation.title, escalation.summary, escalation.severity)
            .catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[ResultRouter] Escalation failed for ${handler_name}: ${msg}`);
            });
        }
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fallback: send generic notification so results are never lost
      await handle_generic(output, task).catch(() => {});
      return { handled: false, handler: handler_name, error: msg };
    }
  };

  // --- Handler implementations ---

  // Grant: parse HTML → structured report → Notion + Telegram alerts
  const handle_grant = async (output: string, task: TaskInfo): Promise<RouteResult> => {
    try {
      const announcements = parse_grant_announcements(output);
      const new_grants = detect_new_grants(announcements);
      const matches = announcements.map(match_grant_to_profile);
      const deadline_alerts = calculate_deadline_alerts(announcements);
      const report = generate_grant_report(announcements, new_grants, matches, deadline_alerts);
      await grant_handler(report);
      return { handled: true, handler: 'grant' };
    } catch {
      // If structured parsing fails, fall back to formatted result
      return await handle_formatted_result(output, task, '📋 Grant Report');
    }
  };

  // Housing: parse HTML → structured report → Notion + Telegram alerts
  const handle_housing = async (output: string, task: TaskInfo): Promise<RouteResult> => {
    try {
      const announcements = parse_housing_announcements(output);
      const new_housing = detect_new_housing(announcements);
      const matches = announcements.map(match_housing_to_profile);
      const deadline_alerts = matches
        .filter((m) => m.priority !== 'skip')
        .map((m) => ({
          announcement: m.announcement,
          days_remaining: m.deadline_days ?? 999,
          alert_level: (m.deadline_days ?? 999) <= 1 ? 'D-1' as const
            : (m.deadline_days ?? 999) <= 3 ? 'D-3' as const
            : (m.deadline_days ?? 999) <= 7 ? 'D-7' as const
            : 'none' as const,
        }))
        .filter((a) => a.alert_level !== 'none');
      const report = generate_housing_report(announcements, new_housing, matches, deadline_alerts);
      await housing_handler(report);
      return { handled: true, handler: 'housing' };
    } catch {
      // If structured parsing fails, fall back to formatted result
      return await handle_formatted_result(output, task, '🏠 Housing Report');
    }
  };

  // Blind: parse chatgpt_task result → filter hot/trending → Slack
  const handle_blind = async (output: string, task: TaskInfo, handler_name: string): Promise<RouteResult> => {
    const result = process_blind_results(output);

    if (result.alerts.length === 0) {
      return { handled: true, handler: handler_name };
    }

    const header = handler_name === 'blind_nvc'
      ? '💬 블라인드 NVC 수요 모니터링'
      : '👀 블라인드 네이버 인기글';

    const alert_text = result.alerts.map((a) => a.text).join('\n\n');
    const stats_line = `(총 ${result.stats.total}건 | 🔥 ${result.stats.hot} hot | 📈 ${result.stats.trending} trending)`;

    const event: NotificationEvent = {
      type: 'crawl_result',
      message: `${header}\n${stats_line}\n\n${alert_text}`,
      device: 'hunter',
      severity: result.stats.hot > 0 ? 'medium' : 'low',
    };
    await router.route(event);
    return { handled: true, handler: handler_name };
  };

  // Formatted result: prefix with title header → Notion + Slack
  const handle_formatted_result = async (output: string, task: TaskInfo, header: string): Promise<RouteResult> => {
    const event: NotificationEvent = {
      type: 'crawl_result',
      message: `${header}\n\n${output}`,
      device: 'hunter',
      severity: 'low',
    };
    await router.route(event);
    return { handled: true, handler: match_handler(task.title) || 'formatted' };
  };

  // Deep Research: save to research store + notify
  const handle_deep_research = async (output: string, task: TaskInfo): Promise<RouteResult> => {
    // Save to research store if available
    if (research_store) {
      research_store.save_research({
        id: task.id,
        topic: task.title,
        query: task.description ?? task.title,
        result_text: output,
        source: 'gemini_deep_research',
        created_at: new Date().toISOString(),
        tags: ['deep_research', 'auto'],
      });
    }

    // Also notify via Notion + Slack
    return await handle_formatted_result(output, task, '🔬 Deep Research');
  };

  // Generic fallback: crawl_result notification
  const handle_generic = async (output: string, task: TaskInfo): Promise<RouteResult> => {
    const event: NotificationEvent = {
      type: 'crawl_result',
      message: `[${task.title}]\n\n${output}`,
      device: 'hunter',
      severity: 'low',
    };
    await router.route(event);
    return { handled: true, handler: 'generic' };
  };

  return { route, match_handler };
};

// Export type for dependency injection
export type ResultRouter = ReturnType<typeof create_result_router>;
