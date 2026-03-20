// Grad School Deadline Tracker — OMSCS & GSEP application deadline monitoring
// Fires staged Telegram alerts at D-30, D-14, D-7, D-3 with auto-generated checklists.
// Stateless: checks "should alert fire today?" each invocation. Dedup handled by caller.

// === Types ===

export type GradSchoolProgram = {
  id: string;
  name: string;
  institution: string;
  deadline: string; // YYYY-MM-DD format
  requirements: string[];
  url: string;
  notes?: string;
};

export type AlertStage = {
  days_before: number;
  label: string;       // Korean label for the alert
  severity: 'info' | 'warning' | 'urgent' | 'critical';
};

export type DeadlineAlert = {
  program: GradSchoolProgram;
  stage: AlertStage;
  days_remaining: number;
  checklist: string;
};

// === Alert Stage Definitions ===

export const ALERT_STAGES: AlertStage[] = [
  { days_before: 30, label: '1개월 남았습니다', severity: 'info' },
  { days_before: 14, label: '2주 남았습니다', severity: 'warning' },
  { days_before: 7,  label: '1주 남았습니다', severity: 'urgent' },
  { days_before: 3,  label: '3일 남았습니다', severity: 'critical' },
] as const;

// === Known Program Deadlines (configurable, updated yearly) ===

export const GRAD_SCHOOL_PROGRAMS: GradSchoolProgram[] = [
  {
    id: 'omscs_fall_2026',
    name: 'Georgia Tech OMSCS (Fall 2026)',
    institution: 'Georgia Tech',
    deadline: '2026-03-01',
    requirements: [
      'TOEFL/IELTS score (TOEFL iBT 100+ / IELTS 7.5+)',
      'Official transcripts from all universities attended',
      'Statement of Purpose (SoP)',
      '3 recommendation letters',
      'Resume/CV',
      'GRE scores (optional but recommended)',
      'Application fee payment ($75)',
    ],
    url: 'https://omscs.gatech.edu/apply-now',
    notes: 'Application typically opens in January. Fall-only admission cycle.',
  },
  {
    id: 'gsep_fall_2026',
    name: 'Seoul National University GSEP (Fall 2026)',
    institution: 'Seoul National University',
    deadline: '2026-05-15',
    requirements: [
      '학업계획서 (Study Plan)',
      '성적증명서 (Official Transcripts)',
      '영어성적 (TOEFL iBT 80+ / IELTS 6.0+ / TEPS 326+)',
      '추천서 2부 (2 Recommendation Letters)',
      '연구계획서 (Research Proposal)',
      '졸업(예정)증명서 (Graduation Certificate)',
      '전형료 납부 (Application Fee)',
    ],
    url: 'https://admission.snu.ac.kr/graduate',
    notes: 'Fall round typically mid-April to mid-May. Spring round Sep-Oct.',
  },
  {
    id: 'gsep_spring_2027',
    name: 'Seoul National University GSEP (Spring 2027)',
    institution: 'Seoul National University',
    deadline: '2026-10-15',
    requirements: [
      '학업계획서 (Study Plan)',
      '성적증명서 (Official Transcripts)',
      '영어성적 (TOEFL iBT 80+ / IELTS 6.0+ / TEPS 326+)',
      '추천서 2부 (2 Recommendation Letters)',
      '연구계획서 (Research Proposal)',
      '졸업(예정)증명서 (Graduation Certificate)',
      '전형료 납부 (Application Fee)',
    ],
    url: 'https://admission.snu.ac.kr/graduate',
    notes: 'Spring round typically Sep-Oct.',
  },
];

// === Utility: Calculate days between today and a deadline ===

export const calculate_days_until = (deadline: string, today: Date = new Date()): number => {
  // Parse deadline as local date (midnight)
  const [year, month, day] = deadline.split('-').map(Number);
  const deadline_date = new Date(year, month - 1, day);

  // Normalize today to midnight for clean day calculation
  const today_midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const diff_ms = deadline_date.getTime() - today_midnight.getTime();
  return Math.round(diff_ms / (1000 * 60 * 60 * 24));
};

// === Checklist Generator ===

export const generate_checklist = (program: GradSchoolProgram): string => {
  return program.requirements
    .map((req) => `☐ ${req}`)
    .join('\n');
};

// === Alert Message Formatter ===

export const format_alert_message = (alert: DeadlineAlert): string => {
  const severity_emoji = {
    info: 'ℹ️',
    warning: '⚠️',
    urgent: '🔴',
    critical: '🚨',
  } as const;

  const emoji = severity_emoji[alert.stage.severity];
  const header = `${emoji} [대학원 지원] ${alert.program.name}`;
  const deadline_line = `마감일: ${alert.program.deadline} (D-${alert.days_remaining})`;
  const stage_line = `${alert.stage.label}`;
  const url_line = `지원 페이지: ${alert.program.url}`;
  const notes_line = alert.program.notes ? `참고: ${alert.program.notes}` : '';

  const checklist_section = `\n준비물 체크리스트:\n${alert.checklist}`;

  const parts = [
    header,
    '',
    stage_line,
    deadline_line,
    '',
    checklist_section,
    '',
    url_line,
  ];

  if (notes_line) {
    parts.push(notes_line);
  }

  return parts.join('\n');
};

// === Main: Check which deadlines should fire alerts today ===

export const check_deadlines = (
  today: Date = new Date(),
  programs: GradSchoolProgram[] = GRAD_SCHOOL_PROGRAMS,
): DeadlineAlert[] => {
  const alerts: DeadlineAlert[] = [];

  for (const program of programs) {
    const days_remaining = calculate_days_until(program.deadline, today);

    // Skip past deadlines
    if (days_remaining < 0) continue;

    // Check if today matches any alert stage
    for (const stage of ALERT_STAGES) {
      if (days_remaining === stage.days_before) {
        alerts.push({
          program,
          stage,
          days_remaining,
          checklist: generate_checklist(program),
        });
        break; // Only one stage per program per day
      }
    }
  }

  return alerts;
};
