// === Notification Types ===

export type NotificationLevel = 'info' | 'approval' | 'alert' | 'briefing' | 'critical';

export type SlackChannel =
  | '#fas-general'
  | '#captain-logs'
  | '#hunter-logs'
  | '#approvals'
  | '#reports'
  | '#crawl-results'
  | '#academy'
  | '#ideas'
  | '#alerts';

export type NotificationEventType =
  | 'agent_log'
  | 'crawl_result'
  | 'approval_mid'
  | 'approval_high'
  | 'academy'
  | 'alert'
  | 'briefing'
  | 'milestone'
  | 'done'
  | 'blocked'
  | 'error';

export type DeviceName = 'captain' | 'hunter';

export type NotificationEvent = {
  type: NotificationEventType;
  message: string;
  device: DeviceName;
  severity?: 'low' | 'mid' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
};

// === Telegram specific ===

export type TelegramMessageType = 'info' | 'approval' | 'alert' | 'briefing';

export type TelegramSendResult = {
  message_id: number;
  success: boolean;
};

export type ApprovalResponse = {
  approved: boolean;
  responded_by: string;
  responded_at: string;
} | null; // null = timeout

// === Notification Result ===

export type NotificationResult = {
  channel: 'telegram' | 'slack' | 'notion';
  success: boolean;
  attempts: number;
  error?: string;
  fallback_used?: boolean;
};

// === Error Types ===

export type FASErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'PII_DETECTED'
  | 'INTERNAL_ERROR'
  | 'NOTIFICATION_ERROR'
  | 'TIMEOUT'
  | 'CROSS_APPROVAL_REJECTED'
  | 'MODE_VIOLATION';

export class FASError extends Error {
  readonly code: FASErrorCode;
  readonly status_code: number;
  readonly details?: Record<string, unknown>;

  constructor(code: FASErrorCode, message: string, status_code: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FASError';
    this.code = code;
    this.status_code = status_code;
    this.details = details;
  }

  to_json() {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// === Task Types ===

export type RiskLevel = 'low' | 'mid' | 'high' | 'critical';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'quarantined';

export type FasMode = 'sleep' | 'awake';

export type Task = {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to: string;
  mode: FasMode | 'recurring';
  risk_level: RiskLevel;
  requires_personal_info: boolean;
  status: TaskStatus;
  created_at: string;
  deadline: string | null;
  depends_on: string[];
  output?: {
    summary: string;
    files_created: string[];
  };
  completed_at?: string;
};

// === Hunter Types ===

export type HunterActionType =
  | 'notebooklm_verify'
  | 'deep_research'
  | 'web_crawl'
  | 'browser_task';

export type HunterTaskResult = {
  status: 'success' | 'failure';
  output: string;
  files: string[];
};

export type HunterHeartbeatResponse = {
  ok: boolean;
  server_time: string;
};

export type HunterPendingTasksResponse = {
  tasks: Task[];
  count: number;
};

// === Cross Approval Types ===

export type CrossApprovalDecision = 'approved' | 'rejected';

export type CrossApprovalResult = {
  decision: CrossApprovalDecision;
  reason: string;
  reviewed_by: string;   // e.g. 'gemini_a'
  reviewed_at: string;   // ISO 8601
};

export type CrossApprovalConfig = {
  gemini_command?: string;        // CLI command to invoke Gemini (default: 'gemini')
  timeout_ms?: number;            // Timeout for approval request (default: 600_000 = 10 min)
  auto_reject_on_error?: boolean; // Auto-reject on parse/timeout error (default: true)
};

// === Agent Healthcheck Types ===

export type AgentName = 'claude' | 'gemini_a' | 'openclaw' | 'gateway' | 'watchdog';

export type AgentStatus = 'running' | 'stopped' | 'crashed';

export type AgentHealthInfo = {
  name: AgentName;
  status: AgentStatus;
  last_heartbeat: string | null;
  uptime_seconds: number | null;
  crash_count: number;
};

// === Mode Management Types (Phase 3) ===

export type ModeState = {
  current_mode: FasMode;
  switched_at: string;
  switched_by: 'cron' | 'human' | 'api';
  next_scheduled_switch: string | null;
};

export type ModeTransitionRequest = {
  target_mode: FasMode;
  reason: string;
  requested_by: 'cron' | 'human' | 'api';
};

// === Activity Logging Types (Phase 7) ===

export type ActivityLogEntry = {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  risk_level: RiskLevel;
  approval_decision?: CrossApprovalDecision;
  approval_reviewer?: string;
  details: Record<string, unknown>;
};

export type ApprovalHistoryEntry = {
  id: string;
  timestamp: string;
  requester: string;
  action: string;
  risk_level: RiskLevel;
  decision: CrossApprovalDecision | 'timeout';
  reviewer: string;
  reason: string;
  duration_ms: number;
};

// === Resource Monitoring Types (Phase 7) ===

export type ResourceSnapshot = {
  timestamp: string;
  cpu_usage_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
};

export type ResourceThresholds = {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
};

// === Network Queue Types (Phase 7) ===

export type QueuedRequest = {
  id: string;
  queued_at: string;
  endpoint: string;
  method: string;
  body: unknown;
  retry_count: number;
};

// === Gateway Types ===

export type ApprovalRequest = {
  id: string;
  requester: string;
  action_type: string;
  action_detail: string;
  risk_level: RiskLevel;
  context: {
    task_id: string;
    files_affected: string[];
    diff_summary?: string;
    evidence: string[];
  };
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  created_at: string;
  resolved_at?: string;
};

export type HealthCheckResponse = {
  status: 'ok' | 'degraded' | 'down';
  mode: FasMode;
  uptime_seconds: number;
  agents: Record<string, {
    status: 'running' | 'stopped' | 'crashed';
    last_heartbeat: string | null;
  }>;
  timestamp: string;
};
