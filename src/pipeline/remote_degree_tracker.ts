// Remote Degree Program Tracker — monitors application deadlines and requirements
// for online/remote graduate programs (OMSCS, GSEP, UT Austin MSCSO, UIUC MCS, etc.)
// Stateless: each invocation checks current state against deadlines.
// Complements grad_school_tracker.ts which handles staged alerts (D-30, D-14, etc.)
// This module provides a broader view: program comparison, deadline reports, and discovery.

// === Types ===

export type DegreeType = 'ms' | 'phd' | 'certificate';

export type DeliveryMode = 'fully_online' | 'hybrid';

export type ProgramRequirements = {
  gre_required: boolean;
  toefl_required: boolean;
  min_gpa: number | null;
  letters_of_rec: number;
  work_experience_years: number | null;
};

export type RemoteDegreeProgram = {
  id: string;
  name: string;
  university: string;
  url: string;
  degree_type: DegreeType;
  delivery: DeliveryMode;
  next_deadline: string | null; // ISO date YYYY-MM-DD
  application_url: string;
  requirements: ProgramRequirements;
  tuition_total_usd: number | null;
  duration_months: number;
  brand_score: number; // 1-10, university prestige
  notes: string;
};

export type DeadlineReport = {
  programs: RemoteDegreeProgram[];
  summary: string;
  generated_at: string;
};

// === Known Remote Degree Programs ===

export const REMOTE_DEGREE_PROGRAMS: RemoteDegreeProgram[] = [
  {
    id: 'gatech_omscs',
    name: 'Online Master of Science in Computer Science (OMSCS)',
    university: 'Georgia Institute of Technology',
    url: 'https://omscs.gatech.edu/',
    degree_type: 'ms',
    delivery: 'fully_online',
    next_deadline: '2026-03-01', // Fall 2026 application deadline
    application_url: 'https://omscs.gatech.edu/apply-now',
    requirements: {
      gre_required: false, // Optional but recommended
      toefl_required: true, // iBT 100+ or IELTS 7.5+
      min_gpa: 3.0,
      letters_of_rec: 3,
      work_experience_years: null, // Not required, but preferred
    },
    tuition_total_usd: 7000, // ~$7,000 for full program
    duration_months: 24, // 2-3 years typical
    brand_score: 9, // Top 10 CS program, globally recognized
    notes: 'Fall-only admission. One of the most affordable and prestigious online MS CS programs. ~$180/credit hour. Specializations: Computing Systems, Interactive Intelligence, Machine Learning, Computational Perception & Robotics.',
  },
  {
    id: 'snu_gsep',
    name: 'Graduate School of Engineering Practice (GSEP)',
    university: 'Seoul National University',
    url: 'https://gsep.snu.ac.kr/',
    degree_type: 'ms',
    delivery: 'hybrid', // Weekend/evening classes, some online
    next_deadline: '2026-05-15', // Fall 2026 application deadline
    application_url: 'https://admission.snu.ac.kr/graduate',
    requirements: {
      gre_required: false,
      toefl_required: true, // iBT 80+ or IELTS 6.0+ or TEPS 326+
      min_gpa: null, // No explicit minimum, competitive
      letters_of_rec: 2,
      work_experience_years: 3, // Recommended 3+ years
    },
    tuition_total_usd: 12000, // ~KRW 16M total (4 semesters)
    duration_months: 24,
    brand_score: 10, // #1 university in Korea, top 30 globally
    notes: 'Weekend/evening classes designed for working professionals. SNU brand is the highest prestige in Korea. Fall (Apr-May) and Spring (Sep-Oct) admission cycles.',
  },
  {
    id: 'utaustin_mscso',
    name: 'Master of Science in Computer Science Online (MSCSO)',
    university: 'University of Texas at Austin',
    url: 'https://www.cs.utexas.edu/graduate-program/masters-program/msonline',
    degree_type: 'ms',
    delivery: 'fully_online',
    next_deadline: '2026-03-15', // Fall 2026 application deadline
    application_url: 'https://www.cs.utexas.edu/graduate-program/prospective-students/apply',
    requirements: {
      gre_required: false, // Not required
      toefl_required: true, // iBT 79+ or IELTS 6.5+
      min_gpa: 3.0,
      letters_of_rec: 3,
      work_experience_years: null,
    },
    tuition_total_usd: 10000, // ~$10,000 for full program
    duration_months: 18, // 1.5-3 years
    brand_score: 8, // Top 10 CS program in US
    notes: 'UT Austin CS is top-10 nationally. Same faculty as on-campus program. 10 courses required. Specialization tracks available.',
  },
  {
    id: 'uiuc_mcs',
    name: 'Master of Computer Science (MCS) Online',
    university: 'University of Illinois Urbana-Champaign',
    url: 'https://cs.illinois.edu/academics/graduate/professional-mcs',
    degree_type: 'ms',
    delivery: 'fully_online',
    next_deadline: '2026-04-15', // Fall 2026 application deadline
    application_url: 'https://cs.illinois.edu/academics/graduate/professional-mcs/application-process',
    requirements: {
      gre_required: false, // Not required
      toefl_required: true, // iBT 103+ or IELTS 7.5+
      min_gpa: 3.2,
      letters_of_rec: 3,
      work_experience_years: null,
    },
    tuition_total_usd: 21000, // ~$21,440 for full program
    duration_months: 24, // 1-3 years
    brand_score: 8, // Top 5 CS program in US
    notes: 'UIUC CS is top-5 nationally. 8 courses (32 credit hours) required. Available through Coursera platform. Strong in systems, data science, and AI.',
  },
  {
    id: 'stanford_scpd',
    name: 'Stanford Center for Professional Development (CS Courses)',
    university: 'Stanford University',
    url: 'https://online.stanford.edu/',
    degree_type: 'certificate', // Graduate certificate, not full MS
    delivery: 'fully_online',
    next_deadline: null, // Rolling enrollment per course
    application_url: 'https://online.stanford.edu/explore',
    requirements: {
      gre_required: false,
      toefl_required: false, // No language requirement for certificates
      min_gpa: null,
      letters_of_rec: 0,
      work_experience_years: null,
    },
    tuition_total_usd: 15000, // ~$1,500-2,000 per course, varies by program
    duration_months: 12, // Varies by certificate
    brand_score: 10, // Stanford is the highest prestige globally
    notes: 'Individual courses and graduate certificates, not a full MS degree. Courses are the same as on-campus. Rolling enrollment. Stanford brand on resume is extremely valuable.',
  },
] as const;

// === Utility: Calculate days until a deadline from a reference date ===

export const calculate_days_until = (deadline: string, today: Date = new Date()): number => {
  const [year, month, day] = deadline.split('-').map(Number);
  const deadline_date = new Date(year, month - 1, day);
  const today_midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff_ms = deadline_date.getTime() - today_midnight.getTime();
  return Math.round(diff_ms / (1000 * 60 * 60 * 24));
};

// === Get all tracked programs ===

export const get_tracked_programs = (
  programs: readonly RemoteDegreeProgram[] = REMOTE_DEGREE_PROGRAMS,
): RemoteDegreeProgram[] => {
  // Return a mutable copy sorted by brand_score descending, then by deadline ascending
  return [...programs].sort((a, b) => {
    // Brand score descending
    const brand_diff = b.brand_score - a.brand_score;
    if (brand_diff !== 0) return brand_diff;

    // Programs with deadlines come before those without
    if (a.next_deadline && !b.next_deadline) return -1;
    if (!a.next_deadline && b.next_deadline) return 1;
    if (!a.next_deadline && !b.next_deadline) return 0;

    // Earlier deadline first
    return a.next_deadline!.localeCompare(b.next_deadline!);
  });
};

// === Get programs with deadlines within N days ===

export const get_upcoming_deadlines = (
  days: number,
  today: Date = new Date(),
  programs: readonly RemoteDegreeProgram[] = REMOTE_DEGREE_PROGRAMS,
): RemoteDegreeProgram[] => {
  return [...programs]
    .filter((p) => {
      if (!p.next_deadline) return false;
      const remaining = calculate_days_until(p.next_deadline, today);
      return remaining >= 0 && remaining <= days;
    })
    .sort((a, b) => {
      // Sort by urgency: fewer days remaining first
      const days_a = calculate_days_until(a.next_deadline!, today);
      const days_b = calculate_days_until(b.next_deadline!, today);
      return days_a - days_b;
    });
};

// === Generate formatted markdown report for Telegram/Slack ===

export const generate_deadline_report = (
  today: Date = new Date(),
  programs: readonly RemoteDegreeProgram[] = REMOTE_DEGREE_PROGRAMS,
): DeadlineReport => {
  const now = new Date().toISOString();
  const date_str = now.split('T')[0];
  const sorted = get_tracked_programs(programs);

  const lines: string[] = [];
  lines.push(`=== Remote Degree Program Report (${date_str}) ===`);
  lines.push('Purpose: remote/online degree tracking for career branding');
  lines.push(`Total: ${sorted.length} programs tracked`);
  lines.push('');

  // Section 1: Upcoming deadlines (within 90 days)
  const upcoming = get_upcoming_deadlines(90, today, programs);
  if (upcoming.length > 0) {
    lines.push('--- Upcoming Deadlines (90 days) ---');
    lines.push('');
    for (const p of upcoming) {
      const days = calculate_days_until(p.next_deadline!, today);
      const urgency = days <= 7 ? '🚨' : days <= 30 ? '⚠️' : 'ℹ️';
      lines.push(`  ${urgency} [${p.university}] ${p.name}`);
      lines.push(`    Deadline: ${p.next_deadline} (D-${days})`);
      lines.push(`    Delivery: ${p.delivery} | Degree: ${p.degree_type}`);
      lines.push(`    Tuition: ${p.tuition_total_usd ? `$${p.tuition_total_usd.toLocaleString()}` : 'TBD'}`);
      lines.push(`    Brand Score: ${p.brand_score}/10`);
      lines.push(`    URL: ${p.application_url}`);
      lines.push('');
    }
  } else {
    lines.push('--- No upcoming deadlines within 90 days ---');
    lines.push('');
  }

  // Section 2: All programs overview
  lines.push('--- All Tracked Programs ---');
  lines.push('');
  for (const p of sorted) {
    const deadline_info = p.next_deadline
      ? `Deadline: ${p.next_deadline} (D-${calculate_days_until(p.next_deadline, today)})`
      : 'Deadline: Rolling / TBD';
    lines.push(`  [${p.university}] ${p.name}`);
    lines.push(`    ${deadline_info}`);
    lines.push(`    Type: ${p.degree_type} | Mode: ${p.delivery} | Duration: ${p.duration_months}mo`);
    lines.push(`    Tuition: ${p.tuition_total_usd ? `$${p.tuition_total_usd.toLocaleString()}` : 'TBD'}`);
    lines.push(`    Brand: ${p.brand_score}/10`);

    // Requirements summary
    const reqs: string[] = [];
    if (p.requirements.gre_required) reqs.push('GRE');
    if (p.requirements.toefl_required) reqs.push('TOEFL/IELTS');
    if (p.requirements.min_gpa) reqs.push(`GPA ${p.requirements.min_gpa}+`);
    if (p.requirements.letters_of_rec > 0) reqs.push(`${p.requirements.letters_of_rec} LoR`);
    if (p.requirements.work_experience_years) reqs.push(`${p.requirements.work_experience_years}yr exp`);
    lines.push(`    Requirements: ${reqs.length > 0 ? reqs.join(', ') : 'Minimal'}`);

    if (p.notes) {
      lines.push(`    Notes: ${p.notes}`);
    }
    lines.push('');
  }

  return {
    programs: sorted,
    summary: lines.join('\n'),
    generated_at: now,
  };
};

// === Placeholder: Check for new remote degree programs ===
// Future: web scrape university program listings and ranking sites
// to discover new online/remote degree programs worth tracking.

export const check_new_programs = async (): Promise<{
  discovered: string[];
  message: string;
}> => {
  // Placeholder — will be replaced with actual web scraping logic
  // Potential sources:
  //   - US News online program rankings
  //   - Class Central / Coursera degree listings
  //   - University announcements (new online program launches)
  //   - Korean university websites (KAIST, POSTECH, etc.)

  return {
    discovered: [],
    message: '[remote_degree_tracker] No new programs discovered (placeholder — web scraping not yet implemented)',
  };
};
