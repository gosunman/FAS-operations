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

// === Task Types ===

export type RiskLevel = 'low' | 'mid' | 'high' | 'critical';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

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
