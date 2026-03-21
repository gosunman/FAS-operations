import { describe, it, expect } from 'vitest';
import {
  add_idea,
  get_ideas,
  advance_stage,
  score_idea,
  get_top_ideas,
  generate_pipeline_report,
  calculate_weighted_score,
  SEED_IDEAS,
  STAGE_ORDER,
  STAGE_SEQUENCE,
  type Idea,
  type IdeaScores,
  type IdeaStage,
} from './idea_pipeline.js';

// === Helper: create a test idea with overrides ===
const make_idea = (overrides: Partial<Idea> = {}): Idea => ({
  id: 'test_idea',
  name: 'Test Idea',
  description: 'A test idea description',
  stage: 'ideation',
  scores: {
    feasibility: 5,
    revenue: 5,
    difficulty: 5,
    brand: 5,
    automation: 5,
    social: 5,
  },
  next_action: 'Do something',
  deadline: null,
  notes: 'Test notes',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('Idea Pipeline', () => {
  // ========================================
  // 1. Seed Ideas Database
  // ========================================

  describe('Seed Ideas Database', () => {
    it('should contain EIDOS SCIENCE 에듀테크', () => {
      const eidos = SEED_IDEAS.find((i) => i.id === 'eidos_science');
      expect(eidos).toBeDefined();
      expect(eidos!.stage).toBe('mvp');
      expect(eidos!.scores.feasibility).toBeGreaterThanOrEqual(1);
    });

    it('should contain SafelyHonest NVC 플랫폼', () => {
      const nvc = SEED_IDEAS.find((i) => i.id === 'safely_honest');
      expect(nvc).toBeDefined();
      expect(nvc!.stage).toBe('launch');
      expect(nvc!.scores.social).toBe(10);
    });

    it('should contain OpenClaw', () => {
      const oc = SEED_IDEAS.find((i) => i.id === 'openclaw');
      expect(oc).toBeDefined();
      expect(oc!.stage).toBe('validation');
    });

    it('should have unique IDs for all seed ideas', () => {
      const ids = SEED_IDEAS.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have valid scores (1-10) for all seed ideas', () => {
      for (const idea of SEED_IDEAS) {
        for (const [key, value] of Object.entries(idea.scores)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(10);
        }
      }
    });

    it('should have valid stages for all seed ideas', () => {
      const valid_stages = Object.keys(STAGE_ORDER);
      for (const idea of SEED_IDEAS) {
        expect(valid_stages).toContain(idea.stage);
      }
    });
  });

  // ========================================
  // 2. Stage Constants
  // ========================================

  describe('Stage Constants', () => {
    it('should have correct stage order from 0 to 4', () => {
      expect(STAGE_ORDER.ideation).toBe(0);
      expect(STAGE_ORDER.validation).toBe(1);
      expect(STAGE_ORDER.mvp).toBe(2);
      expect(STAGE_ORDER.launch).toBe(3);
      expect(STAGE_ORDER.growth).toBe(4);
    });

    it('should have 5 stages in STAGE_SEQUENCE', () => {
      expect(STAGE_SEQUENCE.length).toBe(5);
      expect(STAGE_SEQUENCE[0]).toBe('ideation');
      expect(STAGE_SEQUENCE[4]).toBe('growth');
    });
  });

  // ========================================
  // 3. calculate_weighted_score
  // ========================================

  describe('calculate_weighted_score', () => {
    it('should calculate a weighted score from IdeaScores', () => {
      // Given: scores all at 5
      const scores: IdeaScores = {
        feasibility: 5,
        revenue: 5,
        difficulty: 5,
        brand: 5,
        automation: 5,
        social: 5,
      };

      // When: calculating weighted score
      const result = calculate_weighted_score(scores);

      // Then: should return a number
      expect(typeof result).toBe('number');
      expect(result).not.toBeNaN();
    });

    it('should weight revenue and automation higher', () => {
      // Given: two scores where only revenue/automation differ
      const high_revenue: IdeaScores = {
        feasibility: 5, revenue: 10, difficulty: 5, brand: 5, automation: 10, social: 5,
      };
      const low_revenue: IdeaScores = {
        feasibility: 5, revenue: 1, difficulty: 5, brand: 5, automation: 1, social: 5,
      };

      // When: calculating weighted scores
      const high = calculate_weighted_score(high_revenue);
      const low = calculate_weighted_score(low_revenue);

      // Then: high revenue/automation should score significantly higher
      expect(high).toBeGreaterThan(low);
      expect(high - low).toBeGreaterThan(20); // substantial difference due to 2.0 weight
    });

    it('should penalize higher difficulty', () => {
      // Given: two scores where only difficulty differs
      const easy: IdeaScores = {
        feasibility: 5, revenue: 5, difficulty: 1, brand: 5, automation: 5, social: 5,
      };
      const hard: IdeaScores = {
        feasibility: 5, revenue: 5, difficulty: 10, brand: 5, automation: 5, social: 5,
      };

      // When: calculating weighted scores
      const easy_score = calculate_weighted_score(easy);
      const hard_score = calculate_weighted_score(hard);

      // Then: easier idea should score higher
      expect(easy_score).toBeGreaterThan(hard_score);
    });
  });

  // ========================================
  // 4. add_idea
  // ========================================

  describe('add_idea', () => {
    it('should add a new idea to the list', () => {
      // Given: an empty list
      const ideas: Idea[] = [];

      // When: adding a new idea
      const result = add_idea(ideas, {
        id: 'new_idea',
        name: 'New Idea',
        description: 'A new idea',
        stage: 'ideation',
        scores: { feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5 },
        next_action: 'Research',
        deadline: null,
        notes: '',
      });

      // Then: list should have one idea
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('new_idea');
    });

    it('should set created_at and updated_at timestamps', () => {
      const ideas: Idea[] = [];
      const result = add_idea(ideas, {
        id: 'ts_test',
        name: 'Timestamp Test',
        description: 'Testing timestamps',
        stage: 'ideation',
        scores: { feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5 },
        next_action: 'Test',
        deadline: null,
        notes: '',
      });

      expect(result[0].created_at).toBeTruthy();
      expect(result[0].updated_at).toBeTruthy();
      // created_at and updated_at should be the same on creation
      expect(result[0].created_at).toBe(result[0].updated_at);
    });

    it('should not mutate the original array', () => {
      const ideas: Idea[] = [make_idea({ id: 'existing' })];
      const result = add_idea(ideas, {
        id: 'new',
        name: 'New',
        description: 'Desc',
        stage: 'ideation',
        scores: { feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5 },
        next_action: 'Act',
        deadline: null,
        notes: '',
      });

      expect(ideas.length).toBe(1);
      expect(result.length).toBe(2);
      expect(result).not.toBe(ideas);
    });
  });

  // ========================================
  // 5. get_ideas
  // ========================================

  describe('get_ideas', () => {
    it('should return all ideas when no filter is specified', () => {
      const ideas = [
        make_idea({ id: 'a', stage: 'ideation' }),
        make_idea({ id: 'b', stage: 'mvp' }),
        make_idea({ id: 'c', stage: 'launch' }),
      ];

      const result = get_ideas(ideas);
      expect(result.length).toBe(3);
    });

    it('should filter by stage', () => {
      const ideas = [
        make_idea({ id: 'a', stage: 'ideation' }),
        make_idea({ id: 'b', stage: 'mvp' }),
        make_idea({ id: 'c', stage: 'launch' }),
      ];

      const result = get_ideas(ideas, { stage: 'mvp' });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('b');
    });

    it('should sort by stage (later stages first)', () => {
      const ideas = [
        make_idea({ id: 'ideation', stage: 'ideation' }),
        make_idea({ id: 'growth', stage: 'growth' }),
        make_idea({ id: 'mvp', stage: 'mvp' }),
      ];

      const result = get_ideas(ideas);
      expect(result[0].id).toBe('growth');
      expect(result[2].id).toBe('ideation');
    });

    it('should sort by weighted score within same stage', () => {
      const ideas = [
        make_idea({ id: 'low', stage: 'ideation', scores: {
          feasibility: 1, revenue: 1, difficulty: 10, brand: 1, automation: 1, social: 1,
        }}),
        make_idea({ id: 'high', stage: 'ideation', scores: {
          feasibility: 10, revenue: 10, difficulty: 1, brand: 10, automation: 10, social: 10,
        }}),
      ];

      const result = get_ideas(ideas);
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('low');
    });

    it('should return empty array for empty input', () => {
      const result = get_ideas([]);
      expect(result).toEqual([]);
    });

    it('should return empty array when no ideas match filter', () => {
      const ideas = [make_idea({ id: 'a', stage: 'ideation' })];
      const result = get_ideas(ideas, { stage: 'growth' });
      expect(result).toEqual([]);
    });
  });

  // ========================================
  // 6. advance_stage
  // ========================================

  describe('advance_stage', () => {
    it('should advance from ideation to validation', () => {
      const ideas = [make_idea({ id: 'test', stage: 'ideation' })];
      const result = advance_stage(ideas, 'test');

      expect(result.advanced).toBe(true);
      expect(result.new_stage).toBe('validation');
      expect(result.ideas[0].stage).toBe('validation');
    });

    it('should advance through all stages sequentially', () => {
      let ideas = [make_idea({ id: 'test', stage: 'ideation' })];

      const expected_stages: IdeaStage[] = ['validation', 'mvp', 'launch', 'growth'];
      for (const expected of expected_stages) {
        const result = advance_stage(ideas, 'test');
        expect(result.advanced).toBe(true);
        expect(result.new_stage).toBe(expected);
        ideas = result.ideas;
      }
    });

    it('should not advance beyond growth stage', () => {
      const ideas = [make_idea({ id: 'test', stage: 'growth' })];
      const result = advance_stage(ideas, 'test');

      expect(result.advanced).toBe(false);
      expect(result.new_stage).toBe('growth');
      expect(result.ideas[0].stage).toBe('growth');
    });

    it('should return advanced=false for non-existent id', () => {
      const ideas = [make_idea({ id: 'test' })];
      const result = advance_stage(ideas, 'non_existent');

      expect(result.advanced).toBe(false);
      expect(result.new_stage).toBeNull();
    });

    it('should update the updated_at timestamp', () => {
      const ideas = [make_idea({ id: 'test', stage: 'ideation', updated_at: '2026-01-01T00:00:00Z' })];
      const result = advance_stage(ideas, 'test');

      expect(result.ideas[0].updated_at).not.toBe('2026-01-01T00:00:00Z');
    });

    it('should not mutate the original array', () => {
      const ideas = [make_idea({ id: 'test', stage: 'ideation' })];
      const result = advance_stage(ideas, 'test');

      expect(ideas[0].stage).toBe('ideation');
      expect(result.ideas[0].stage).toBe('validation');
      expect(result.ideas).not.toBe(ideas);
    });
  });

  // ========================================
  // 7. score_idea
  // ========================================

  describe('score_idea', () => {
    it('should update scores for an existing idea', () => {
      const ideas = [make_idea({ id: 'test', scores: {
        feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5,
      }})];

      const result = score_idea(ideas, 'test', { revenue: 9, automation: 8 });

      expect(result.updated).toBe(true);
      expect(result.ideas[0].scores.revenue).toBe(9);
      expect(result.ideas[0].scores.automation).toBe(8);
      // Unchanged scores should remain
      expect(result.ideas[0].scores.feasibility).toBe(5);
    });

    it('should return updated=false for non-existent id', () => {
      const ideas = [make_idea({ id: 'test' })];
      const result = score_idea(ideas, 'non_existent', { revenue: 9 });

      expect(result.updated).toBe(false);
    });

    it('should update the updated_at timestamp', () => {
      const ideas = [make_idea({ id: 'test', updated_at: '2026-01-01T00:00:00Z' })];
      const result = score_idea(ideas, 'test', { revenue: 9 });

      expect(result.ideas[0].updated_at).not.toBe('2026-01-01T00:00:00Z');
    });

    it('should not mutate the original array', () => {
      const ideas = [make_idea({ id: 'test', scores: {
        feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5,
      }})];
      const result = score_idea(ideas, 'test', { revenue: 9 });

      expect(ideas[0].scores.revenue).toBe(5);
      expect(result.ideas[0].scores.revenue).toBe(9);
    });
  });

  // ========================================
  // 8. get_top_ideas
  // ========================================

  describe('get_top_ideas', () => {
    it('should return top N ideas by weighted score', () => {
      const ideas = [
        make_idea({ id: 'low', scores: {
          feasibility: 1, revenue: 1, difficulty: 10, brand: 1, automation: 1, social: 1,
        }}),
        make_idea({ id: 'mid', scores: {
          feasibility: 5, revenue: 5, difficulty: 5, brand: 5, automation: 5, social: 5,
        }}),
        make_idea({ id: 'high', scores: {
          feasibility: 10, revenue: 10, difficulty: 1, brand: 10, automation: 10, social: 10,
        }}),
      ];

      const result = get_top_ideas(ideas, 2);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('high');
      expect(result[1].id).toBe('mid');
    });

    it('should return all ideas if n > total ideas', () => {
      const ideas = [make_idea({ id: 'only' })];
      const result = get_top_ideas(ideas, 5);
      expect(result.length).toBe(1);
    });

    it('should return empty array for empty input', () => {
      const result = get_top_ideas([], 3);
      expect(result).toEqual([]);
    });

    it('should not mutate the original array', () => {
      const ideas = [
        make_idea({ id: 'a' }),
        make_idea({ id: 'b' }),
      ];
      const result = get_top_ideas(ideas, 1);
      expect(result).not.toBe(ideas);
      expect(ideas.length).toBe(2);
    });
  });

  // ========================================
  // 9. generate_pipeline_report
  // ========================================

  describe('generate_pipeline_report', () => {
    it('should generate a report with all ideas', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(SEED_IDEAS, today);

      expect(report.ideas.length).toBe(SEED_IDEAS.length);
      expect(report.generated_at).toBeTruthy();
    });

    it('should include report header', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(SEED_IDEAS, today);

      expect(report.summary).toContain('Idea-to-Business Pipeline Report');
      expect(report.summary).toContain(`${SEED_IDEAS.length} ideas in pipeline`);
    });

    it('should include stage summary', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(SEED_IDEAS, today);

      expect(report.summary).toContain('Stage Summary');
      for (const stage of STAGE_SEQUENCE) {
        expect(report.summary).toContain(stage);
      }
    });

    it('should include top ideas section', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(SEED_IDEAS, today);

      expect(report.summary).toContain('Top Ideas');
      expect(report.summary).toContain('#1');
    });

    it('should include detailed pipeline section', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(SEED_IDEAS, today);

      expect(report.summary).toContain('Detailed Pipeline');
    });

    it('should include score breakdown for ideas', () => {
      const ideas = [make_idea({ id: 'scored', scores: {
        feasibility: 8, revenue: 7, difficulty: 3, brand: 6, automation: 9, social: 5,
      }})];
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(ideas, today);

      expect(report.summary).toContain('F=8');
      expect(report.summary).toContain('R=7');
      expect(report.summary).toContain('D=3');
      expect(report.summary).toContain('A=9');
    });

    it('should include deadline info for ideas with deadlines', () => {
      const ideas = [make_idea({ id: 'dl', deadline: '2026-04-30', name: 'Deadline Idea' })];
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report(ideas, today);

      expect(report.summary).toContain('2026-04-30');
    });

    it('should handle empty ideas list gracefully', () => {
      const today = new Date('2026-03-22');
      const report = generate_pipeline_report([], today);

      expect(report.ideas).toEqual([]);
      expect(report.summary).toContain('0 ideas in pipeline');
    });
  });

  // ========================================
  // 10. Integration
  // ========================================

  describe('Integration', () => {
    it('should support full lifecycle: add → score → advance → report', () => {
      // Given: start with seed ideas
      let ideas = [...SEED_IDEAS];

      // When: add a new idea
      ideas = add_idea(ideas, {
        id: 'new_biz',
        name: 'New Business Idea',
        description: 'A brand new business idea',
        stage: 'ideation',
        scores: { feasibility: 7, revenue: 8, difficulty: 4, brand: 6, automation: 7, social: 5 },
        next_action: 'Market research',
        deadline: null,
        notes: 'Integration test idea',
      });

      // Then: idea should exist
      expect(ideas.find((i) => i.id === 'new_biz')).toBeDefined();

      // When: score the idea
      const scored = score_idea(ideas, 'new_biz', { revenue: 9 });
      ideas = scored.ideas;
      expect(scored.updated).toBe(true);
      expect(ideas.find((i) => i.id === 'new_biz')!.scores.revenue).toBe(9);

      // When: advance the idea
      const advanced = advance_stage(ideas, 'new_biz');
      ideas = advanced.ideas;
      expect(advanced.advanced).toBe(true);
      expect(ideas.find((i) => i.id === 'new_biz')!.stage).toBe('validation');

      // When: generate report
      const report = generate_pipeline_report(ideas);
      expect(report.ideas.length).toBe(SEED_IDEAS.length + 1);
      expect(report.summary).toContain('New Business Idea');
    });

    it('should rank seed ideas consistently', () => {
      const top = get_top_ideas(SEED_IDEAS, 3);

      // All should have valid scores
      for (const idea of top) {
        const ws = calculate_weighted_score(idea.scores);
        expect(ws).toBeGreaterThan(0);
      }

      // Top idea should have highest weighted score
      const first_score = calculate_weighted_score(top[0].scores);
      const second_score = calculate_weighted_score(top[1].scores);
      expect(first_score).toBeGreaterThanOrEqual(second_score);
    });
  });
});
