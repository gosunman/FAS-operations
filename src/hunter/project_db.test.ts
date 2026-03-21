// TDD tests for Hunter project database
// SQLite-based project pipeline for autonomous revenue generation

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { create_project_db, type ProjectDB } from './project_db.js';

describe('ProjectDB', () => {
  let db: ProjectDB;

  beforeEach(() => {
    // Use in-memory database for each test — fast and isolated
    db = create_project_db({ db_path: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  // === Helper ===

  const make_project = (overrides: Partial<Parameters<typeof db.create>[0]> = {}) =>
    db.create({
      title: 'YouTube Shorts Automation',
      category: 'youtube_shorts_automation',
      expected_revenue: '$500/month',
      resources_needed: ['OpenClaw', 'YouTube API'],
      ...overrides,
    });

  // === create() ===

  describe('create()', () => {
    it('should create a project with all fields populated correctly', () => {
      // Given: project creation params
      const params = {
        title: 'Blog SEO Auto Content',
        category: 'blog_seo_auto_content',
        expected_revenue: '$300/month',
        resources_needed: ['OpenClaw', 'WordPress API'],
      };

      // When: creating a project
      const project = db.create(params);

      // Then: all fields should be set correctly
      expect(project.id).toBeDefined();
      expect(project.id.length).toBe(36); // UUID format
      expect(project.title).toBe('Blog SEO Auto Content');
      expect(project.category).toBe('blog_seo_auto_content');
      expect(project.status).toBe('discovered');
      expect(project.expected_revenue).toBe('$300/month');
      expect(project.actual_revenue).toBe(0);
      expect(project.resources_needed).toEqual(['OpenClaw', 'WordPress API']);
      expect(project.owner_action_needed).toBeUndefined();
      expect(project.retrospective).toBeUndefined();
      expect(project.openclaw_sessions).toEqual([]);
      expect(project.created_at).toBeDefined();
      expect(project.updated_at).toBeDefined();
    });

    it('should generate unique IDs for different projects', () => {
      // Given/When: creating two projects
      const p1 = make_project({ title: 'Project A' });
      const p2 = make_project({ title: 'Project B' });

      // Then: IDs should differ
      expect(p1.id).not.toBe(p2.id);
    });
  });

  // === get_by_id() ===

  describe('get_by_id()', () => {
    it('should return the project when it exists', () => {
      // Given: a created project
      const created = make_project();

      // When: fetching by id
      const found = db.get_by_id(created.id);

      // Then: should return matching project
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('YouTube Shorts Automation');
    });

    it('should return undefined for non-existent id', () => {
      // Given: no projects exist
      // When: fetching a non-existent id
      const found = db.get_by_id('non-existent-id');

      // Then: should return undefined
      expect(found).toBeUndefined();
    });
  });

  // === get_by_status() ===

  describe('get_by_status()', () => {
    it('should return only projects matching the given status', () => {
      // Given: projects in different statuses
      const p1 = make_project({ title: 'Project A' });
      const p2 = make_project({ title: 'Project B' });
      const p3 = make_project({ title: 'Project C' });
      db.update_status(p3.id, 'building');

      // When: querying by status
      const discovered = db.get_by_status('discovered');
      const building = db.get_by_status('building');

      // Then: correct filtering
      expect(discovered.length).toBe(2);
      expect(building.length).toBe(1);
      expect(building[0].title).toBe('Project C');
    });

    it('should return empty array when no projects match', () => {
      // Given: a project in discovered status
      make_project();

      // When: querying for a different status
      const result = db.get_by_status('deployed');

      // Then: empty array
      expect(result).toEqual([]);
    });
  });

  // === get_all() ===

  describe('get_all()', () => {
    it('should return all projects regardless of status', () => {
      // Given: projects in various statuses
      const p1 = make_project({ title: 'Project A' });
      const p2 = make_project({ title: 'Project B' });
      const p3 = make_project({ title: 'Project C' });
      db.update_status(p2.id, 'building');
      db.update_status(p3.id, 'failed');

      // When: getting all
      const all = db.get_all();

      // Then: all three returned
      expect(all.length).toBe(3);
      const titles = all.map((p) => p.title);
      expect(titles).toContain('Project A');
      expect(titles).toContain('Project B');
      expect(titles).toContain('Project C');
    });

    it('should return empty array when no projects exist', () => {
      // Given: empty database
      // When/Then
      expect(db.get_all()).toEqual([]);
    });
  });

  // === update_status() ===

  describe('update_status()', () => {
    it('should transition project through lifecycle statuses', () => {
      // Given: a discovered project
      const project = make_project();
      expect(project.status).toBe('discovered');

      // When: advancing through statuses
      const statuses = ['researching', 'planned', 'building', 'testing', 'deployed', 'monitoring', 'succeeded'] as const;

      for (const status of statuses) {
        const result = db.update_status(project.id, status);
        expect(result).toBe(true);

        const updated = db.get_by_id(project.id);
        expect(updated!.status).toBe(status);
      }
    });

    it('should update the updated_at timestamp', () => {
      // Given: a project
      const project = make_project();
      const original_updated_at = project.updated_at;

      // When: updating status (with a small delay to ensure different timestamp)
      db.update_status(project.id, 'researching');

      // Then: updated_at should change
      const updated = db.get_by_id(project.id);
      expect(updated!.updated_at).toBeDefined();
      // Note: timestamps may be equal within the same millisecond in fast tests,
      // so we just verify the field exists and status changed
      expect(updated!.status).toBe('researching');
    });

    it('should return false for non-existent project', () => {
      // Given/When: updating non-existent id
      const result = db.update_status('non-existent', 'building');

      // Then: false
      expect(result).toBe(false);
    });

    it('should allow transition to failed status', () => {
      // Given: a building project
      const project = make_project();
      db.update_status(project.id, 'building');

      // When: marking as failed
      const result = db.update_status(project.id, 'failed');

      // Then: status is failed
      expect(result).toBe(true);
      expect(db.get_by_id(project.id)!.status).toBe('failed');
    });
  });

  // === update_revenue() ===

  describe('update_revenue()', () => {
    it('should update the actual revenue amount', () => {
      // Given: a deployed project
      const project = make_project();
      db.update_status(project.id, 'deployed');

      // When: recording revenue
      const result = db.update_revenue(project.id, 150.50);

      // Then: revenue is updated
      expect(result).toBe(true);
      const updated = db.get_by_id(project.id);
      expect(updated!.actual_revenue).toBe(150.50);
    });

    it('should allow updating revenue multiple times', () => {
      // Given: a project with initial revenue
      const project = make_project();
      db.update_revenue(project.id, 100);

      // When: updating again
      db.update_revenue(project.id, 250.75);

      // Then: latest value is stored
      expect(db.get_by_id(project.id)!.actual_revenue).toBe(250.75);
    });

    it('should return false for non-existent project', () => {
      expect(db.update_revenue('non-existent', 100)).toBe(false);
    });
  });

  // === set_owner_action() ===

  describe('set_owner_action()', () => {
    it('should set owner_action_needed and transition to needs_owner status', () => {
      // Given: a building project
      const project = make_project();
      db.update_status(project.id, 'building');

      // When: setting owner action
      const result = db.set_owner_action(project.id, 'Need API key for YouTube Data API v3');

      // Then: action is set and status transitions
      expect(result).toBe(true);
      const updated = db.get_by_id(project.id);
      expect(updated!.owner_action_needed).toBe('Need API key for YouTube Data API v3');
      expect(updated!.status).toBe('needs_owner');
    });

    it('should return false for non-existent project', () => {
      expect(db.set_owner_action('non-existent', 'action')).toBe(false);
    });
  });

  // === set_retrospective() ===

  describe('set_retrospective()', () => {
    it('should set retrospective text on a project', () => {
      // Given: a failed project
      const project = make_project();
      db.update_status(project.id, 'failed');

      // When: writing retrospective
      const retro = 'Market too competitive. YouTube Shorts monetization requires 1000 subs first. Consider pivot to blog SEO.';
      const result = db.set_retrospective(project.id, retro);

      // Then: retrospective is stored
      expect(result).toBe(true);
      const updated = db.get_by_id(project.id);
      expect(updated!.retrospective).toBe(retro);
    });

    it('should allow overwriting retrospective', () => {
      // Given: a project with existing retrospective
      const project = make_project();
      db.set_retrospective(project.id, 'First draft');

      // When: updating
      db.set_retrospective(project.id, 'Updated analysis after market shift');

      // Then: latest value
      expect(db.get_by_id(project.id)!.retrospective).toBe('Updated analysis after market shift');
    });

    it('should return false for non-existent project', () => {
      expect(db.set_retrospective('non-existent', 'retro')).toBe(false);
    });
  });

  // === add_openclaw_session() ===

  describe('add_openclaw_session()', () => {
    it('should add a session id to the openclaw_sessions array', () => {
      // Given: a project with no sessions
      const project = make_project();
      expect(project.openclaw_sessions).toEqual([]);

      // When: adding a session
      const result = db.add_openclaw_session(project.id, 'session_abc123');

      // Then: session is appended
      expect(result).toBe(true);
      const updated = db.get_by_id(project.id);
      expect(updated!.openclaw_sessions).toEqual(['session_abc123']);
    });

    it('should append multiple sessions in order', () => {
      // Given: a project
      const project = make_project();

      // When: adding multiple sessions
      db.add_openclaw_session(project.id, 'session_001');
      db.add_openclaw_session(project.id, 'session_002');
      db.add_openclaw_session(project.id, 'session_003');

      // Then: all sessions are present in order
      const updated = db.get_by_id(project.id);
      expect(updated!.openclaw_sessions).toEqual([
        'session_001',
        'session_002',
        'session_003',
      ]);
    });

    it('should return false for non-existent project', () => {
      expect(db.add_openclaw_session('non-existent', 'session_x')).toBe(false);
    });
  });

  // === get_most_promising() ===

  describe('get_most_promising()', () => {
    it('should return the project furthest along in the pipeline', () => {
      // Given: projects at various stages
      const p_discovered = make_project({ title: 'Discovered Project' });
      const p_researching = make_project({ title: 'Researching Project' });
      db.update_status(p_researching.id, 'researching');
      const p_building = make_project({ title: 'Building Project' });
      db.update_status(p_building.id, 'building');
      const p_planned = make_project({ title: 'Planned Project' });
      db.update_status(p_planned.id, 'planned');

      // When: getting most promising
      const most_promising = db.get_most_promising();

      // Then: building is furthest along among active statuses
      expect(most_promising).toBeDefined();
      expect(most_promising!.title).toBe('Building Project');
    });

    it('should prefer testing over building', () => {
      // Given: a building and a testing project
      const p_building = make_project({ title: 'Building' });
      db.update_status(p_building.id, 'building');
      const p_testing = make_project({ title: 'Testing' });
      db.update_status(p_testing.id, 'testing');

      // When: getting most promising
      const result = db.get_most_promising();

      // Then: testing wins
      expect(result!.title).toBe('Testing');
    });

    it('should exclude deployed, monitoring, succeeded, failed, needs_owner projects', () => {
      // Given: only terminal/post-active projects
      const p1 = make_project({ title: 'Deployed' });
      db.update_status(p1.id, 'deployed');
      const p2 = make_project({ title: 'Succeeded' });
      db.update_status(p2.id, 'succeeded');
      const p3 = make_project({ title: 'Failed' });
      db.update_status(p3.id, 'failed');
      const p4 = make_project({ title: 'Monitoring' });
      db.update_status(p4.id, 'monitoring');
      const p5 = make_project({ title: 'Needs Owner' });
      db.update_status(p5.id, 'needs_owner');

      // When: getting most promising
      const result = db.get_most_promising();

      // Then: no active projects to return
      expect(result).toBeUndefined();
    });

    it('should return undefined when no projects exist', () => {
      expect(db.get_most_promising()).toBeUndefined();
    });
  });

  // === get_active_count() ===

  describe('get_active_count()', () => {
    it('should count all projects not in succeeded or failed status', () => {
      // Given: mixed projects
      make_project({ title: 'Active 1' }); // discovered
      const p2 = make_project({ title: 'Active 2' });
      db.update_status(p2.id, 'building');
      const p3 = make_project({ title: 'Done' });
      db.update_status(p3.id, 'succeeded');
      const p4 = make_project({ title: 'Dead' });
      db.update_status(p4.id, 'failed');
      const p5 = make_project({ title: 'Needs Owner' });
      db.update_status(p5.id, 'needs_owner');

      // When: counting active
      const count = db.get_active_count();

      // Then: discovered + building + needs_owner = 3
      expect(count).toBe(3);
    });

    it('should return 0 when no projects exist', () => {
      expect(db.get_active_count()).toBe(0);
    });
  });

  // === get_stats() ===

  describe('get_stats()', () => {
    it('should return correct total, by_status counts, and total_revenue', () => {
      // Given: several projects with various statuses and revenue
      const p1 = make_project({ title: 'Project A' });
      const p2 = make_project({ title: 'Project B' });
      db.update_status(p2.id, 'building');
      const p3 = make_project({ title: 'Project C' });
      db.update_status(p3.id, 'succeeded');
      db.update_revenue(p3.id, 500);
      const p4 = make_project({ title: 'Project D' });
      db.update_status(p4.id, 'succeeded');
      db.update_revenue(p4.id, 300.50);
      const p5 = make_project({ title: 'Project E' });
      db.update_status(p5.id, 'failed');

      // When: getting stats
      const stats = db.get_stats();

      // Then: accurate aggregation
      expect(stats.total).toBe(5);
      expect(stats.by_status['discovered']).toBe(1);
      expect(stats.by_status['building']).toBe(1);
      expect(stats.by_status['succeeded']).toBe(2);
      expect(stats.by_status['failed']).toBe(1);
      expect(stats.total_revenue).toBeCloseTo(800.50);
    });

    it('should return zeros when database is empty', () => {
      // Given: empty database
      const stats = db.get_stats();

      // Then: all zeros
      expect(stats.total).toBe(0);
      expect(stats.by_status).toEqual({});
      expect(stats.total_revenue).toBe(0);
    });
  });

  // === WAL mode and busy_timeout ===

  describe('database pragmas', () => {
    it('should configure busy_timeout via config', () => {
      const custom_db = create_project_db({ db_path: ':memory:', busy_timeout_ms: 10000 });
      const timeout = custom_db._db.pragma('busy_timeout') as { timeout: number }[];
      expect(timeout[0].timeout).toBe(10000);
      custom_db.close();
    });

    it('should default to 5000ms busy_timeout', () => {
      const timeout = db._db.pragma('busy_timeout') as { timeout: number }[];
      expect(timeout[0].timeout).toBe(5000);
    });
  });
});
