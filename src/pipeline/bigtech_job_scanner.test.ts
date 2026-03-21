import { describe, it, expect } from 'vitest';
import {
  TARGET_COMPANIES,
  DEFAULT_SCAN_CONFIG,
  meets_brand_tier,
  filter_companies_by_tier,
  calculate_brand_value,
  categorize_role,
  matches_scan_config,
  find_company,
  generate_scan_report,
  generate_hunter_prompt,
  type TargetCompany,
  type JobPosting,
  type BrandTier,
  type ScanConfig,
} from './bigtech_job_scanner.js';

describe('Bigtech Job Scanner', () => {
  // ========================================
  // 1. Target Companies Database
  // ========================================

  describe('Target Companies', () => {
    it('should include all 15 specified companies', () => {
      // Given: the target company list
      const expected_ids = [
        'google', 'meta', 'apple', 'amazon', 'microsoft', 'netflix',
        'openai', 'anthropic', 'nvidia', 'tesla', 'stripe', 'databricks',
        'figma', 'notion', 'vercel',
      ];

      // Then: all expected companies should be present
      const actual_ids = TARGET_COMPANIES.map((c) => c.id);
      for (const id of expected_ids) {
        expect(actual_ids).toContain(id);
      }
      expect(TARGET_COMPANIES).toHaveLength(15);
    });

    it('should have unique IDs for all companies', () => {
      // Given: all companies
      const ids = TARGET_COMPANIES.map((c) => c.id);

      // Then: no duplicate IDs
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have valid career URLs for all companies', () => {
      // Then: every company has a valid URL
      for (const company of TARGET_COMPANIES) {
        expect(company.career_url).toMatch(/^https?:\/\//);
      }
    });

    it('should have at least one tag per company', () => {
      // Then: every company has identification tags
      for (const company of TARGET_COMPANIES) {
        expect(company.tags.length).toBeGreaterThan(0);
      }
    });

    it('should assign S-tier to FAANG + NVIDIA + Tesla', () => {
      // Given: the S-tier companies
      const s_tier = TARGET_COMPANIES.filter((c) => c.brand_tier === 'S');
      const s_tier_ids = s_tier.map((c) => c.id);

      // Then: Google, Apple, Meta, Microsoft, Amazon, NVIDIA, Tesla are S-tier
      expect(s_tier_ids).toContain('google');
      expect(s_tier_ids).toContain('apple');
      expect(s_tier_ids).toContain('meta');
      expect(s_tier_ids).toContain('microsoft');
      expect(s_tier_ids).toContain('amazon');
      expect(s_tier_ids).toContain('nvidia');
      expect(s_tier_ids).toContain('tesla');
    });

    it('should assign A-tier to OpenAI, Anthropic, Netflix, Stripe, Databricks', () => {
      // Given: the A-tier companies
      const a_tier = TARGET_COMPANIES.filter((c) => c.brand_tier === 'A');
      const a_tier_ids = a_tier.map((c) => c.id);

      // Then: expected A-tier companies
      expect(a_tier_ids).toContain('openai');
      expect(a_tier_ids).toContain('anthropic');
      expect(a_tier_ids).toContain('netflix');
      expect(a_tier_ids).toContain('stripe');
      expect(a_tier_ids).toContain('databricks');
    });

    it('should assign B-tier to Figma, Notion, Vercel', () => {
      // Given: the B-tier companies
      const b_tier = TARGET_COMPANIES.filter((c) => c.brand_tier === 'B');
      const b_tier_ids = b_tier.map((c) => c.id);

      // Then: expected B-tier companies
      expect(b_tier_ids).toContain('figma');
      expect(b_tier_ids).toContain('notion');
      expect(b_tier_ids).toContain('vercel');
    });
  });

  // ========================================
  // 2. Default Config — accept everything
  // ========================================

  describe('Default Scan Config', () => {
    it('should accept all work arrangements', () => {
      // Then: remote, onsite, hybrid all accepted
      expect(DEFAULT_SCAN_CONFIG.accepted_arrangements).toContain('remote');
      expect(DEFAULT_SCAN_CONFIG.accepted_arrangements).toContain('onsite');
      expect(DEFAULT_SCAN_CONFIG.accepted_arrangements).toContain('hybrid');
    });

    it('should accept all contract types including short_term', () => {
      // Then: all contract types accepted (even 1-month OK)
      expect(DEFAULT_SCAN_CONFIG.accepted_contract_types).toContain('full_time');
      expect(DEFAULT_SCAN_CONFIG.accepted_contract_types).toContain('contract');
      expect(DEFAULT_SCAN_CONFIG.accepted_contract_types).toContain('short_term');
    });

    it('should accept all role categories', () => {
      // Then: role_categories should be "all" (직군 무관)
      expect(DEFAULT_SCAN_CONFIG.role_categories).toBe('all');
    });

    it('should include all 15 target companies', () => {
      // Then: default config has all companies
      expect(DEFAULT_SCAN_CONFIG.companies).toHaveLength(15);
    });
  });

  // ========================================
  // 3. Brand Tier Logic
  // ========================================

  describe('meets_brand_tier', () => {
    it('should pass S-tier when min is B', () => {
      expect(meets_brand_tier('S', 'B')).toBe(true);
    });

    it('should pass S-tier when min is S', () => {
      expect(meets_brand_tier('S', 'S')).toBe(true);
    });

    it('should fail B-tier when min is A', () => {
      expect(meets_brand_tier('B', 'A')).toBe(false);
    });

    it('should fail B-tier when min is S', () => {
      expect(meets_brand_tier('B', 'S')).toBe(false);
    });

    it('should pass A-tier when min is A', () => {
      expect(meets_brand_tier('A', 'A')).toBe(true);
    });

    it('should pass A-tier when min is B', () => {
      expect(meets_brand_tier('A', 'B')).toBe(true);
    });
  });

  describe('filter_companies_by_tier', () => {
    it('should return all companies when min tier is B', () => {
      // When: filtering with min B
      const result = filter_companies_by_tier([...TARGET_COMPANIES], 'B');

      // Then: all 15 companies pass
      expect(result).toHaveLength(15);
    });

    it('should exclude B-tier when min tier is A', () => {
      // When: filtering with min A
      const result = filter_companies_by_tier([...TARGET_COMPANIES], 'A');

      // Then: B-tier companies (figma, notion, vercel) excluded
      const ids = result.map((c) => c.id);
      expect(ids).not.toContain('figma');
      expect(ids).not.toContain('notion');
      expect(ids).not.toContain('vercel');
      expect(result.length).toBe(12); // 7 S + 5 A
    });

    it('should only return S-tier when min tier is S', () => {
      // When: filtering with min S
      const result = filter_companies_by_tier([...TARGET_COMPANIES], 'S');

      // Then: only S-tier companies
      expect(result.every((c) => c.brand_tier === 'S')).toBe(true);
      expect(result.length).toBe(7);
    });
  });

  // ========================================
  // 4. Brand Value Calculator
  // ========================================

  describe('calculate_brand_value', () => {
    it('should return high for S-tier regardless of contract type', () => {
      // S-tier company: even short_term = high brand value
      expect(calculate_brand_value('S', 'full_time')).toBe('high');
      expect(calculate_brand_value('S', 'contract')).toBe('high');
      expect(calculate_brand_value('S', 'short_term')).toBe('high');
      expect(calculate_brand_value('S', 'part_time')).toBe('high');
    });

    it('should return high for A-tier full_time/contract', () => {
      expect(calculate_brand_value('A', 'full_time')).toBe('high');
      expect(calculate_brand_value('A', 'contract')).toBe('high');
    });

    it('should return medium for A-tier short_term/part_time', () => {
      expect(calculate_brand_value('A', 'short_term')).toBe('medium');
      expect(calculate_brand_value('A', 'part_time')).toBe('medium');
    });

    it('should return medium for B-tier full_time', () => {
      expect(calculate_brand_value('B', 'full_time')).toBe('medium');
    });

    it('should return low for B-tier contract/short_term', () => {
      expect(calculate_brand_value('B', 'contract')).toBe('low');
      expect(calculate_brand_value('B', 'short_term')).toBe('low');
    });
  });

  // ========================================
  // 5. Role Categorizer
  // ========================================

  describe('categorize_role', () => {
    it('should detect engineering roles', () => {
      expect(categorize_role('Senior Software Engineer')).toBe('engineering');
      expect(categorize_role('Frontend Developer')).toBe('engineering');
      expect(categorize_role('SRE Lead')).toBe('engineering');
      expect(categorize_role('Backend Engineer')).toBe('engineering');
      expect(categorize_role('Full Stack Developer')).toBe('engineering');
      expect(categorize_role('Platform Engineer')).toBe('engineering');
    });

    it('should detect product roles', () => {
      expect(categorize_role('Product Manager')).toBe('product');
      expect(categorize_role('Senior PM, Cloud')).toBe('product');
      expect(categorize_role('Program Manager')).toBe('product');
    });

    it('should detect design roles', () => {
      expect(categorize_role('UX Designer')).toBe('design');
      expect(categorize_role('UI Design Lead')).toBe('design');
      expect(categorize_role('Visual Designer')).toBe('design');
    });

    it('should detect research roles', () => {
      expect(categorize_role('Research Scientist')).toBe('research');
      expect(categorize_role('ML Researcher')).toBe('research');
      expect(categorize_role('AI Safety Researcher')).toBe('research');
    });

    it('should detect data roles', () => {
      expect(categorize_role('Data Analyst')).toBe('data');
      expect(categorize_role('Data Engineer')).toBe('data');
      expect(categorize_role('Business Intelligence Analyst')).toBe('data');
    });

    it('should detect operations roles', () => {
      expect(categorize_role('Operations Manager')).toBe('operations');
      expect(categorize_role('Business Ops Lead')).toBe('operations');
      expect(categorize_role('Strategy & Operations')).toBe('operations');
    });

    it('should detect marketing roles', () => {
      expect(categorize_role('Growth Marketing Manager')).toBe('marketing');
      expect(categorize_role('Content Strategist')).toBe('marketing');
      expect(categorize_role('Community Manager')).toBe('marketing');
    });

    it('should return other for unrecognized roles', () => {
      expect(categorize_role('Office Barista')).toBe('other');
      expect(categorize_role('Legal Counsel')).toBe('other');
    });
  });

  // ========================================
  // 6. Posting Matcher
  // ========================================

  describe('matches_scan_config', () => {
    const google = TARGET_COMPANIES.find((c) => c.id === 'google')!;
    const vercel = TARGET_COMPANIES.find((c) => c.id === 'vercel')!;

    const make_posting = (overrides: Partial<JobPosting> = {}): JobPosting => ({
      company_id: 'google',
      title: 'Software Engineer',
      role_category: 'engineering',
      work_arrangement: 'remote',
      contract_type: 'full_time',
      location: 'Seoul, Korea',
      url: 'https://careers.google.com/jobs/123',
      requirements: [],
      brand_value: 'high',
      ...overrides,
    });

    it('should match with default config (accept everything)', () => {
      // Given: a basic posting with default config
      const posting = make_posting();

      // Then: should match
      expect(matches_scan_config(posting, google)).toBe(true);
    });

    it('should match onsite postings (근무조건 무관)', () => {
      const posting = make_posting({ work_arrangement: 'onsite' });
      expect(matches_scan_config(posting, google)).toBe(true);
    });

    it('should match hybrid postings (근무조건 무관)', () => {
      const posting = make_posting({ work_arrangement: 'hybrid' });
      expect(matches_scan_config(posting, google)).toBe(true);
    });

    it('should match short_term contracts (1개월도 OK)', () => {
      const posting = make_posting({ contract_type: 'short_term' });
      expect(matches_scan_config(posting, google)).toBe(true);
    });

    it('should match non-engineering roles (직군 무관)', () => {
      const posting = make_posting({ role_category: 'marketing' });
      expect(matches_scan_config(posting, google)).toBe(true);
    });

    it('should reject when work arrangement is excluded', () => {
      // Given: config that only accepts remote
      const config: ScanConfig = { accepted_arrangements: ['remote'] };
      const posting = make_posting({ work_arrangement: 'onsite' });

      // Then: should not match
      expect(matches_scan_config(posting, google, config)).toBe(false);
    });

    it('should reject when contract type is excluded', () => {
      // Given: config that only accepts full_time
      const config: ScanConfig = { accepted_contract_types: ['full_time'] };
      const posting = make_posting({ contract_type: 'short_term' });

      // Then: should not match
      expect(matches_scan_config(posting, google, config)).toBe(false);
    });

    it('should reject B-tier company when min tier is A', () => {
      // Given: config requiring A-tier minimum
      const config: ScanConfig = { min_brand_tier: 'A' };
      const posting = make_posting({ company_id: 'vercel' });

      // Then: B-tier vercel should not match
      expect(matches_scan_config(posting, vercel, config)).toBe(false);
    });

    it('should reject role category when specific categories are set', () => {
      // Given: config that only accepts engineering
      const config: ScanConfig = { role_categories: ['engineering'] };
      const posting = make_posting({ role_category: 'marketing' });

      // Then: marketing should not match
      expect(matches_scan_config(posting, google, config)).toBe(false);
    });
  });

  // ========================================
  // 7. Company Lookup
  // ========================================

  describe('find_company', () => {
    it('should find google by ID', () => {
      const google = find_company('google');
      expect(google).toBeDefined();
      expect(google!.name).toBe('Google');
    });

    it('should find anthropic by ID', () => {
      const anthropic = find_company('anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.name).toBe('Anthropic');
    });

    it('should return undefined for unknown company', () => {
      const unknown = find_company('unknown_corp');
      expect(unknown).toBeUndefined();
    });
  });

  // ========================================
  // 8. Report Generator
  // ========================================

  describe('generate_scan_report', () => {
    it('should generate empty report when no postings', () => {
      // When: generating report with no postings
      const report = generate_scan_report([]);

      // Then: summary should indicate no results
      expect(report.postings).toHaveLength(0);
      expect(report.summary).toContain('No matching postings');
      expect(report.generated_at).toBeTruthy();
    });

    it('should include career branding purpose in report', () => {
      // Given: a posting
      const posting: JobPosting = {
        company_id: 'google',
        title: 'Software Engineer',
        role_category: 'engineering',
        work_arrangement: 'remote',
        contract_type: 'full_time',
        location: 'Remote',
        url: 'https://careers.google.com/jobs/123',
        requirements: [],
        brand_value: 'high',
      };

      // When: generating report
      const report = generate_scan_report([posting]);

      // Then: should mention career branding purpose
      expect(report.summary).toContain('Career Branding');
    });

    it('should sort postings by brand value (high first)', () => {
      // Given: postings with different brand values
      const postings: JobPosting[] = [
        {
          company_id: 'vercel',
          title: 'Intern',
          role_category: 'engineering',
          work_arrangement: 'remote',
          contract_type: 'internship',
          location: 'Remote',
          url: 'https://vercel.com/careers/1',
          requirements: [],
          brand_value: 'low',
        },
        {
          company_id: 'google',
          title: 'SWE',
          role_category: 'engineering',
          work_arrangement: 'remote',
          contract_type: 'full_time',
          location: 'Seoul',
          url: 'https://careers.google.com/1',
          requirements: [],
          brand_value: 'high',
        },
        {
          company_id: 'anthropic',
          title: 'PM',
          role_category: 'product',
          work_arrangement: 'hybrid',
          contract_type: 'short_term',
          location: 'SF',
          url: 'https://anthropic.com/careers/1',
          requirements: [],
          brand_value: 'medium',
        },
      ];

      // When: generating report
      const report = generate_scan_report(postings);

      // Then: high should appear before medium, medium before low
      const high_pos = report.summary.indexOf('HIGH');
      const medium_pos = report.summary.indexOf('MEDIUM');
      const low_pos = report.summary.indexOf('LOW');
      expect(high_pos).toBeLessThan(medium_pos);
      expect(medium_pos).toBeLessThan(low_pos);
    });

    it('should include company name and posting details', () => {
      // Given: a google posting
      const posting: JobPosting = {
        company_id: 'google',
        title: 'Senior Staff Engineer',
        role_category: 'engineering',
        work_arrangement: 'hybrid',
        contract_type: 'contract',
        location: 'Seoul, Korea',
        url: 'https://careers.google.com/jobs/456',
        team: 'Cloud Platform',
        deadline: '2026-04-15',
        requirements: ['5+ years experience'],
        brand_value: 'high',
      };

      // When: generating report
      const report = generate_scan_report([posting]);

      // Then: should include key details
      expect(report.summary).toContain('Google');
      expect(report.summary).toContain('Senior Staff Engineer');
      expect(report.summary).toContain('hybrid');
      expect(report.summary).toContain('Seoul, Korea');
      expect(report.summary).toContain('Cloud Platform');
      expect(report.summary).toContain('2026-04-15');
    });

    it('should be within Telegram message size limit', () => {
      // Given: several postings
      const posting: JobPosting = {
        company_id: 'google',
        title: 'Test Role',
        role_category: 'engineering',
        work_arrangement: 'remote',
        contract_type: 'full_time',
        location: 'Remote',
        url: 'https://example.com',
        requirements: [],
        brand_value: 'high',
      };

      // When: generating report with multiple postings
      const report = generate_scan_report([posting, posting, posting]);

      // Then: should fit within Telegram limit
      expect(report.summary.length).toBeLessThan(4096);
    });
  });

  // ========================================
  // 9. Hunter Prompt Generator
  // ========================================

  describe('generate_hunter_prompt', () => {
    it('should include all target company names and URLs', () => {
      // When: generating default prompt
      const prompt = generate_hunter_prompt();

      // Then: all companies should be listed
      for (const company of TARGET_COMPANIES) {
        expect(prompt).toContain(company.name);
        expect(prompt).toContain(company.career_url);
      }
    });

    it('should mention career branding purpose', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('Career branding');
      expect(prompt).toContain('이름빨');
    });

    it('should mention 1-month contracts are acceptable', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('1 month');
    });

    it('should include all role types when config is "all"', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('All roles');
    });

    it('should include all work arrangements', () => {
      const prompt = generate_hunter_prompt();
      expect(prompt).toContain('remote');
      expect(prompt).toContain('onsite');
      expect(prompt).toContain('hybrid');
    });

    it('should filter companies by min tier in config', () => {
      // Given: config with S-tier minimum
      const config: ScanConfig = { min_brand_tier: 'S' };

      // When: generating prompt
      const prompt = generate_hunter_prompt(config);

      // Then: should NOT include B-tier companies
      expect(prompt).not.toContain('Figma');
      expect(prompt).not.toContain('Notion');
      expect(prompt).not.toContain('Vercel');

      // But should include S-tier
      expect(prompt).toContain('Google');
      expect(prompt).toContain('Apple');
    });
  });
});
