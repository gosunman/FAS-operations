// Bigtech Job Scanner — prestigious company career scanning for brand-name collecting
// Purpose: career branding (이름빨 간판 모으기), NOT salary optimization.
// Stateless config + matching logic. Actual crawling delegated to hunter via chatgpt_task.

// === Types ===

export type WorkArrangement = 'remote' | 'onsite' | 'hybrid';

export type ContractType = 'full_time' | 'contract' | 'short_term' | 'internship' | 'part_time';

export type BrandTier = 'S' | 'A' | 'B';

export type TargetCompany = {
  id: string;
  name: string;
  career_url: string;
  brand_tier: BrandTier;     // S = top prestige, A = high prestige, B = notable
  tags: string[];            // quick identification keywords
};

export type RoleCategory =
  | 'engineering'
  | 'product'
  | 'design'
  | 'research'
  | 'data'
  | 'operations'
  | 'marketing'
  | 'other';

export type JobPosting = {
  company_id: string;
  title: string;
  role_category: RoleCategory;
  team?: string;
  work_arrangement: WorkArrangement;
  contract_type: ContractType;
  location: string;
  url: string;
  deadline?: string;          // YYYY-MM-DD if known
  requirements: string[];
  brand_value: 'high' | 'medium' | 'low';
  notes?: string;
};

export type ScanConfig = {
  companies?: TargetCompany[];
  accepted_arrangements?: WorkArrangement[];
  accepted_contract_types?: ContractType[];
  min_brand_tier?: BrandTier;
  role_categories?: RoleCategory[] | 'all';
};

export type ScanReport = {
  postings: JobPosting[];
  summary: string;
  generated_at: string;
};

// === Target Companies — brand-name/prestigious companies for career branding ===

export const TARGET_COMPANIES: TargetCompany[] = [
  // S-tier: globally iconic, top brand recognition
  {
    id: 'google',
    name: 'Google',
    career_url: 'https://careers.google.com/',
    brand_tier: 'S',
    tags: ['alphabet', 'google', 'deepmind'],
  },
  {
    id: 'apple',
    name: 'Apple',
    career_url: 'https://jobs.apple.com/',
    brand_tier: 'S',
    tags: ['apple'],
  },
  {
    id: 'meta',
    name: 'Meta',
    career_url: 'https://www.metacareers.com/',
    brand_tier: 'S',
    tags: ['meta', 'facebook', 'instagram'],
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    career_url: 'https://careers.microsoft.com/',
    brand_tier: 'S',
    tags: ['microsoft', 'azure', 'github'],
  },
  {
    id: 'amazon',
    name: 'Amazon',
    career_url: 'https://www.amazon.jobs/',
    brand_tier: 'S',
    tags: ['amazon', 'aws'],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    career_url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    brand_tier: 'S',
    tags: ['nvidia', 'gpu', 'cuda'],
  },
  {
    id: 'tesla',
    name: 'Tesla',
    career_url: 'https://www.tesla.com/careers',
    brand_tier: 'S',
    tags: ['tesla', 'spacex'],
  },

  // A-tier: highly prestigious in tech, strong brand signal
  {
    id: 'openai',
    name: 'OpenAI',
    career_url: 'https://openai.com/careers/',
    brand_tier: 'A',
    tags: ['openai', 'chatgpt', 'gpt'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    career_url: 'https://www.anthropic.com/careers',
    brand_tier: 'A',
    tags: ['anthropic', 'claude'],
  },
  {
    id: 'netflix',
    name: 'Netflix',
    career_url: 'https://jobs.netflix.com/',
    brand_tier: 'A',
    tags: ['netflix'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    career_url: 'https://stripe.com/jobs',
    brand_tier: 'A',
    tags: ['stripe', 'payments'],
  },
  {
    id: 'databricks',
    name: 'Databricks',
    career_url: 'https://www.databricks.com/company/careers',
    brand_tier: 'A',
    tags: ['databricks', 'spark', 'lakehouse'],
  },

  // B-tier: notable/respected, strong within dev community
  {
    id: 'figma',
    name: 'Figma',
    career_url: 'https://www.figma.com/careers/',
    brand_tier: 'B',
    tags: ['figma', 'design'],
  },
  {
    id: 'notion',
    name: 'Notion',
    career_url: 'https://www.notion.so/careers',
    brand_tier: 'B',
    tags: ['notion', 'productivity'],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    career_url: 'https://vercel.com/careers',
    brand_tier: 'B',
    tags: ['vercel', 'nextjs', 'next.js'],
  },
] as const;

// === Default Config: accept everything (근무조건/직군/계약 무관) ===

export const DEFAULT_SCAN_CONFIG: Required<ScanConfig> = {
  companies: [...TARGET_COMPANIES],
  accepted_arrangements: ['remote', 'onsite', 'hybrid'],
  accepted_contract_types: ['full_time', 'contract', 'short_term', 'internship', 'part_time'],
  min_brand_tier: 'B',
  role_categories: 'all',
};

// === Brand Tier Ordering ===

const BRAND_TIER_ORDER: Record<BrandTier, number> = {
  S: 3,
  A: 2,
  B: 1,
} as const;

// === Utility Functions ===

// Check if a company meets the minimum brand tier threshold
export const meets_brand_tier = (
  company_tier: BrandTier,
  min_tier: BrandTier,
): boolean => {
  return BRAND_TIER_ORDER[company_tier] >= BRAND_TIER_ORDER[min_tier];
};

// Filter companies by brand tier
export const filter_companies_by_tier = (
  companies: TargetCompany[],
  min_tier: BrandTier,
): TargetCompany[] => {
  return companies.filter((c) => meets_brand_tier(c.brand_tier, min_tier));
};

// Determine brand value of a posting based on company tier + contract type
export const calculate_brand_value = (
  company_tier: BrandTier,
  contract_type: ContractType,
): 'high' | 'medium' | 'low' => {
  // S-tier company: even short_term/contract gives high brand value
  if (company_tier === 'S') return 'high';

  // A-tier: full_time/contract = high, short_term = medium
  if (company_tier === 'A') {
    return contract_type === 'short_term' || contract_type === 'part_time'
      ? 'medium'
      : 'high';
  }

  // B-tier: full_time = medium, otherwise low
  return contract_type === 'full_time' ? 'medium' : 'low';
};

// Categorize a role title into a RoleCategory
export const categorize_role = (title: string): RoleCategory => {
  const lower = title.toLowerCase();

  // Data patterns — checked BEFORE engineering because "Data Engineer" should be 'data'
  if (/data\s*(?:analyst|engineer|scientist)|analytics|bi\b|business\s*intelligence/.test(lower)) {
    return 'data';
  }
  // Research patterns — checked before engineering because "ML Researcher" should be 'research'
  if (/research|scientist|ml\b|machine\s*learning|ai\b/.test(lower)) {
    return 'research';
  }
  // Engineering patterns
  if (/engineer|developer|swe|sre|devops|backend|frontend|fullstack|full.?stack|platform/.test(lower)) {
    return 'engineering';
  }
  // Product patterns
  if (/product\s*manager|pm\b|product\s*lead|product\s*owner|program\s*manager/.test(lower)) {
    return 'product';
  }
  // Design patterns
  if (/design|ux|ui\b|creative|visual|brand\s*design/.test(lower)) {
    return 'design';
  }
  // Operations patterns
  if (/operations|ops\b|strategy|business\s*ops|chief\s*of\s*staff|coordinator/.test(lower)) {
    return 'operations';
  }
  // Marketing patterns
  if (/marketing|growth|content|community|communications|pr\b|public\s*relations/.test(lower)) {
    return 'marketing';
  }

  return 'other';
};

// Match a posting against scan configuration filters
export const matches_scan_config = (
  posting: JobPosting,
  company: TargetCompany,
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
): boolean => {
  const effective = { ...DEFAULT_SCAN_CONFIG, ...config };

  // Check work arrangement
  if (!effective.accepted_arrangements.includes(posting.work_arrangement)) {
    return false;
  }

  // Check contract type
  if (!effective.accepted_contract_types.includes(posting.contract_type)) {
    return false;
  }

  // Check brand tier
  if (!meets_brand_tier(company.brand_tier, effective.min_brand_tier)) {
    return false;
  }

  // Check role category (skip if 'all')
  if (effective.role_categories !== 'all') {
    if (!effective.role_categories.includes(posting.role_category)) {
      return false;
    }
  }

  return true;
};

// Find a company by ID from the target list
export const find_company = (
  company_id: string,
  companies: TargetCompany[] = [...TARGET_COMPANIES],
): TargetCompany | undefined => {
  return companies.find((c) => c.id === company_id);
};

// === Report Generator ===

export const generate_scan_report = (postings: JobPosting[]): ScanReport => {
  const now = new Date().toISOString();
  const date_str = now.split('T')[0];

  if (postings.length === 0) {
    return {
      postings: [],
      summary: `=== Bigtech Career Branding Scan (${date_str}) ===\n\nNo matching postings found.\n`,
      generated_at: now,
    };
  }

  // Sort by brand_value (high > medium > low), then by company name
  const brand_order = { high: 3, medium: 2, low: 1 };
  const sorted = [...postings].sort((a, b) => {
    const brand_diff = brand_order[b.brand_value] - brand_order[a.brand_value];
    if (brand_diff !== 0) return brand_diff;
    return a.company_id.localeCompare(b.company_id);
  });

  const lines: string[] = [];
  lines.push(`=== Bigtech Career Branding Scan (${date_str}) ===`);
  lines.push(`Purpose: career branding (이름빨 간판 모으기)`);
  lines.push(`Total: ${sorted.length} postings`);
  lines.push('');

  // Group by brand value
  for (const brand_val of ['high', 'medium', 'low'] as const) {
    const group = sorted.filter((p) => p.brand_value === brand_val);
    if (group.length === 0) continue;

    const emoji = brand_val === 'high' ? '🏆' : brand_val === 'medium' ? '⭐' : '📌';
    lines.push(`--- ${emoji} Brand Value: ${brand_val.toUpperCase()} (${group.length}) ---`);
    lines.push('');

    for (const posting of group) {
      const company = find_company(posting.company_id);
      const company_name = company?.name ?? posting.company_id;
      lines.push(`  [${company_name}] ${posting.title}`);
      lines.push(`    Role: ${posting.role_category} | ${posting.work_arrangement} | ${posting.contract_type}`);
      lines.push(`    Location: ${posting.location}`);
      if (posting.team) lines.push(`    Team: ${posting.team}`);
      if (posting.deadline) lines.push(`    Deadline: ${posting.deadline}`);
      lines.push(`    URL: ${posting.url}`);
      lines.push('');
    }
  }

  return {
    postings: sorted,
    summary: lines.join('\n'),
    generated_at: now,
  };
};

// === Hunter Prompt Generator ===
// Generates the detailed instruction prompt sent to hunter for career page scanning

export const generate_hunter_prompt = (
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
): string => {
  const effective = { ...DEFAULT_SCAN_CONFIG, ...config };
  const companies = filter_companies_by_tier(effective.companies, effective.min_brand_tier);

  const company_list = companies
    .map((c) => `- ${c.name}: ${c.career_url}`)
    .join('\n');

  const role_section = effective.role_categories === 'all'
    ? 'All roles (engineering, product, design, research, data, operations, marketing, etc.)'
    : effective.role_categories.join(', ');

  const arrangement_section = effective.accepted_arrangements.join(', ');
  const contract_section = effective.accepted_contract_types.join(', ');

  return [
    '=== Bigtech Career Branding Scan ===',
    '',
    'Purpose: Career branding (이름빨 간판 모으기). Salary is irrelevant.',
    'Even 1-month contracts are acceptable if the company name adds brand value.',
    '',
    '## Target Companies',
    company_list,
    '',
    '## Criteria',
    `- Roles: ${role_section}`,
    `- Work arrangement: ${arrangement_section}`,
    `- Contract types: ${contract_section}`,
    '- Location: Korea-based OR remote-eligible positions',
    '- Duration: any (even 1 month is OK)',
    '',
    '## Output Format',
    'For each matching position, provide:',
    '| Company | Title | Role Type | Work Arrangement | Contract Type | Location | Team | Deadline | URL |',
    '',
    'Sort by company brand tier (S > A > B), then by role relevance.',
  ].join('\n');
};
