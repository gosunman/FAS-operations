// TDD tests for time_classifier module
// Tests cover: is_process_running, get_current_cpu, check_hunter_heartbeat,
// classify_captain_state, classify_hunter_state, create_time_classifier

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing module under test
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import {
  is_process_running,
  get_current_cpu,
  check_hunter_heartbeat,
  classify_captain_state,
  classify_hunter_state,
  create_time_classifier,
  type ClassifyResult,
  type TimeClassifierConfig,
} from './time_classifier.js';

const mocked_exec = vi.mocked(execSync);

// === Sample outputs ===

const SAMPLE_TOP_OUTPUT = [
  'Processes: 450 total, 3 running, 447 sleeping, 2000 threads',
  'Load Avg: 3.12, 2.85, 2.50',
  'CPU usage: 45.2% user, 12.3% sys, 42.5% idle',
  'SharedLibs: 600M resident, 80M data, 50M linkedit.',
].join('\n');

const SAMPLE_TOP_LOW_CPU = [
  'Processes: 200 total, 1 running, 199 sleeping, 800 threads',
  'Load Avg: 0.10, 0.15, 0.20',
  'CPU usage: 2.1% user, 1.5% sys, 96.4% idle',
].join('\n');

// === Helper: build mock fetch for hunter heartbeat ===

const make_mock_fetch = (response: {
  ok: boolean;
  json_data?: unknown;
  should_throw?: boolean;
}): typeof fetch => {
  if (response.should_throw) {
    return vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;
  }
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    json: async () => response.json_data,
  }) as unknown as typeof fetch;
};

describe('is_process_running', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when pgrep finds a matching process', () => {
    // pgrep returns output (exit 0) when process is found
    mocked_exec.mockReturnValue('12345\n' as unknown as Buffer);
    expect(is_process_running(['node'])).toBe(true);
  });

  it('returns false when pgrep finds no matching process', () => {
    // pgrep throws (exit 1) when no match
    mocked_exec.mockImplementation(() => {
      throw new Error('exit code 1');
    });
    expect(is_process_running(['__totally_fake_process_xyz__'])).toBe(false);
  });

  it('returns true if any of multiple process names matches', () => {
    let call_count = 0;
    mocked_exec.mockImplementation(() => {
      call_count++;
      if (call_count === 1) throw new Error('exit code 1'); // first name not found
      return '99999\n' as unknown as Buffer; // second name found
    });
    expect(is_process_running(['fake_process', 'node'])).toBe(true);
  });

  it('returns false for empty process name array', () => {
    expect(is_process_running([])).toBe(false);
  });
});

describe('get_current_cpu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses CPU usage from top output', () => {
    mocked_exec.mockReturnValue(SAMPLE_TOP_OUTPUT as unknown as Buffer);
    const cpu = get_current_cpu();
    // 45.2 + 12.3 = 57.5
    expect(cpu).toBeCloseTo(57.5, 1);
  });

  it('returns 0 when top output has unexpected format', () => {
    mocked_exec.mockReturnValue('garbage output' as unknown as Buffer);
    expect(get_current_cpu()).toBe(0);
  });

  it('returns 0 when top command throws', () => {
    mocked_exec.mockImplementation(() => {
      throw new Error('command failed');
    });
    expect(get_current_cpu()).toBe(0);
  });

  it('parses low CPU usage correctly', () => {
    mocked_exec.mockReturnValue(SAMPLE_TOP_LOW_CPU as unknown as Buffer);
    const cpu = get_current_cpu();
    // 2.1 + 1.5 = 3.6
    expect(cpu).toBeCloseTo(3.6, 1);
  });
});

describe('check_hunter_heartbeat', () => {
  it('returns true when hunter heartbeat is fresh', async () => {
    const fresh_heartbeat = new Date().toISOString();
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'openclaw',
          status: 'running',
          last_heartbeat: fresh_heartbeat,
        }],
      },
    });

    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(true);
  });

  it('returns false when heartbeat is stale (>2 minutes)', async () => {
    const stale_heartbeat = new Date(Date.now() - 300_000).toISOString(); // 5 min ago
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'openclaw',
          status: 'running',
          last_heartbeat: stale_heartbeat,
        }],
      },
    });

    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(false);
  });

  it('returns false when gateway returns non-ok response', async () => {
    const mock_fetch = make_mock_fetch({ ok: false });
    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(false);
  });

  it('returns false when fetch throws (connection refused)', async () => {
    const mock_fetch = make_mock_fetch({ ok: false, should_throw: true });
    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(false);
  });

  it('returns false when openclaw agent is not in the list', async () => {
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'gemini',
          status: 'running',
          last_heartbeat: new Date().toISOString(),
        }],
      },
    });

    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(false);
  });

  it('returns false when last_heartbeat is null', async () => {
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'openclaw',
          status: 'stopped',
          last_heartbeat: null,
        }],
      },
    });

    const result = await check_hunter_heartbeat('http://localhost:3100', mock_fetch);
    expect(result).toBe(false);
  });

  it('calls the correct gateway URL', async () => {
    const mock_fn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [{ name: 'openclaw', status: 'running', last_heartbeat: new Date().toISOString() }],
      }),
    });
    await check_hunter_heartbeat('http://10.0.0.5:3100', mock_fn as unknown as typeof fetch);
    expect(mock_fn).toHaveBeenCalledWith(
      'http://10.0.0.5:3100/api/agents/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('classify_captain_state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "working" when process is active and CPU > threshold', () => {
    // First call: pgrep (process running)
    // Second call: top (high CPU)
    let call_count = 0;
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      call_count++;
      if (command.startsWith('pgrep')) return '12345\n' as unknown as Buffer;
      if (command.startsWith('top')) return SAMPLE_TOP_OUTPUT as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = classify_captain_state(10, ['claude']);
    expect(result.state).toBe('working');
    expect(result.process_active).toBe(true);
    expect(result.cpu_percent).toBeGreaterThan(10);
  });

  it('returns "idle" when process is active but CPU <= threshold', () => {
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) return '12345\n' as unknown as Buffer;
      if (command.startsWith('top')) return SAMPLE_TOP_LOW_CPU as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = classify_captain_state(10, ['node']);
    expect(result.state).toBe('idle');
    expect(result.process_active).toBe(true);
    expect(result.cpu_percent).toBeLessThanOrEqual(10);
  });

  it('returns "down" when no process is running', () => {
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) throw new Error('exit code 1');
      if (command.startsWith('top')) return SAMPLE_TOP_OUTPUT as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = classify_captain_state(10, ['claude']);
    expect(result.state).toBe('down');
    expect(result.process_active).toBe(false);
  });

  it('uses default threshold of 10 when not specified', () => {
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) return '12345\n' as unknown as Buffer;
      if (command.startsWith('top')) return SAMPLE_TOP_LOW_CPU as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    // CPU is ~3.6, default threshold is 10 → should be idle
    const result = classify_captain_state();
    expect(result.state).toBe('idle');
  });

  it('always includes cpu_percent in result', () => {
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) throw new Error('exit code 1');
      if (command.startsWith('top')) return SAMPLE_TOP_OUTPUT as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const result = classify_captain_state();
    expect(typeof result.cpu_percent).toBe('number');
    expect(result.cpu_percent).toBeGreaterThanOrEqual(0);
  });
});

describe('classify_hunter_state', () => {
  it('returns "down" when gateway is unreachable', async () => {
    const mock_fetch = make_mock_fetch({ ok: false, should_throw: true });
    const result = await classify_hunter_state('http://localhost:0', mock_fetch);
    expect(result.state).toBe('down');
    expect(result.process_active).toBe(false);
    expect(result.cpu_percent).toBe(0);
  });

  it('returns "working" when hunter heartbeat is fresh', async () => {
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'openclaw',
          status: 'running',
          last_heartbeat: new Date().toISOString(),
        }],
      },
    });

    const result = await classify_hunter_state('http://localhost:3100', mock_fetch);
    expect(result.state).toBe('working');
    expect(result.process_active).toBe(true);
  });

  it('returns "down" when heartbeat is stale', async () => {
    const stale = new Date(Date.now() - 300_000).toISOString();
    const mock_fetch = make_mock_fetch({
      ok: true,
      json_data: {
        agents: [{
          name: 'openclaw',
          status: 'running',
          last_heartbeat: stale,
        }],
      },
    });

    const result = await classify_hunter_state('http://localhost:3100', mock_fetch);
    expect(result.state).toBe('down');
    expect(result.process_active).toBe(false);
  });

  it('returns "down" when response is not ok', async () => {
    const mock_fetch = make_mock_fetch({ ok: false });
    const result = await classify_hunter_state('http://localhost:3100', mock_fetch);
    expect(result.state).toBe('down');
  });
});

describe('create_time_classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: set up mocks for captain classification
  const setup_captain_mocks = (state: 'working' | 'idle' | 'down') => {
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) {
        if (state === 'down') throw new Error('exit code 1');
        return '12345\n' as unknown as Buffer;
      }
      if (command.startsWith('top')) {
        if (state === 'working') return SAMPLE_TOP_OUTPUT as unknown as Buffer;
        return SAMPLE_TOP_LOW_CPU as unknown as Buffer;
      }
      return '' as unknown as Buffer;
    });
  };

  it('creates a classifier for captain device', () => {
    const classifier = create_time_classifier({ device: 'captain' });
    expect(classifier).toBeDefined();
    expect(typeof classifier.classify).toBe('function');
    expect(typeof classifier.get_history).toBe('function');
    expect(typeof classifier.get_summary).toBe('function');
    expect(typeof classifier.start).toBe('function');
    expect(typeof classifier.stop).toBe('function');
    expect(typeof classifier.reset).toBe('function');
  });

  it('classify returns a valid ClassifyResult for captain', async () => {
    setup_captain_mocks('working');
    const classifier = create_time_classifier({ device: 'captain' });
    const result = await classifier.classify();
    expect(['working', 'idle', 'down']).toContain(result.state);
    expect(typeof result.cpu_percent).toBe('number');
    expect(typeof result.process_active).toBe('boolean');
  });

  it('tracks history after start/stop cycle', async () => {
    setup_captain_mocks('working');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 100,
    });

    classifier.start();

    // Allow initial classification promise to resolve
    await vi.advanceTimersByTimeAsync(10);

    // Advance past one interval to trigger a second classification
    await vi.advanceTimersByTimeAsync(100);

    classifier.stop();

    const history = classifier.get_history();
    // At least 1 entry: the initial state recorded after first interval fires
    expect(history.length).toBeGreaterThanOrEqual(1);

    // Each history entry should have valid fields
    for (const entry of history) {
      expect(['working', 'idle', 'down']).toContain(entry.state);
      expect(typeof entry.duration_ms).toBe('number');
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
      expect(entry.timestamp).toBeTruthy();
    }
  });

  it('summary accumulates time by state', async () => {
    setup_captain_mocks('working');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 100,
    });

    classifier.start();
    await vi.advanceTimersByTimeAsync(10); // initial classify
    await vi.advanceTimersByTimeAsync(100); // first interval
    await vi.advanceTimersByTimeAsync(100); // second interval
    classifier.stop();

    const summary = classifier.get_summary();
    expect(summary.working_ms + summary.idle_ms + summary.down_ms).toBeGreaterThan(0);
  });

  it('reset clears history and summary', async () => {
    setup_captain_mocks('idle');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 100,
    });

    classifier.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    classifier.stop();

    // Should have some history
    expect(classifier.get_history().length).toBeGreaterThan(0);

    classifier.reset();

    expect(classifier.get_history()).toHaveLength(0);
    const summary = classifier.get_summary();
    expect(summary).toEqual({ working_ms: 0, idle_ms: 0, down_ms: 0 });
  });

  it('start is idempotent (calling twice does not create duplicate timers)', async () => {
    setup_captain_mocks('working');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 100,
    });

    classifier.start();
    classifier.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    classifier.stop();

    // Should have normal history, not doubled
    const history = classifier.get_history();
    expect(history.length).toBeGreaterThanOrEqual(1);
    // Should be at most 3 entries (initial + 1 interval + stop final)
    expect(history.length).toBeLessThanOrEqual(3);
  });

  it('stop records final state duration', async () => {
    setup_captain_mocks('idle');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 1000,
    });

    classifier.start();
    await vi.advanceTimersByTimeAsync(10); // initial classify resolves
    await vi.advanceTimersByTimeAsync(500); // wait 500ms without interval firing
    classifier.stop();

    const history = classifier.get_history();
    // stop() should push one final entry for the current state
    expect(history.length).toBeGreaterThanOrEqual(1);
    const last = history[history.length - 1];
    expect(last.state).toBe('idle');
    expect(last.duration_ms).toBeGreaterThan(0);
  });

  it('uses hunter classification when device is hunter with gateway URL', async () => {
    // We need to test that create_time_classifier routes to hunter logic
    // Since classify_hunter_state uses fetch, we test through the factory
    const mock_fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [{
          name: 'openclaw',
          status: 'running',
          last_heartbeat: new Date().toISOString(),
        }],
      }),
    });

    // Override global fetch for this test
    const original_fetch = globalThis.fetch;
    globalThis.fetch = mock_fetch as unknown as typeof fetch;

    try {
      const classifier = create_time_classifier({
        device: 'hunter',
        hunter_gateway_url: 'http://10.0.0.5:3100',
      });

      const result = await classifier.classify();
      // Hunter with a fresh heartbeat should be working
      expect(result.state).toBe('working');
    } finally {
      globalThis.fetch = original_fetch;
    }
  });

  it('uses custom process names when provided', async () => {
    const custom_names = ['my_custom_agent'];
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) {
        // Verify custom process name is used
        if (command.includes('my_custom_agent')) return '99999\n' as unknown as Buffer;
        throw new Error('exit code 1');
      }
      if (command.startsWith('top')) return SAMPLE_TOP_OUTPUT as unknown as Buffer;
      return '' as unknown as Buffer;
    });

    const classifier = create_time_classifier({
      device: 'captain',
      process_names: custom_names,
    });

    const result = await classifier.classify();
    expect(result.state).toBe('working');
    expect(result.process_active).toBe(true);
  });

  it('uses custom CPU threshold', async () => {
    // With a very high threshold (99%), even high CPU should be "idle"
    mocked_exec.mockImplementation((cmd: string) => {
      const command = String(cmd);
      if (command.startsWith('pgrep')) return '12345\n' as unknown as Buffer;
      if (command.startsWith('top')) return SAMPLE_TOP_OUTPUT as unknown as Buffer; // ~57.5% CPU
      return '' as unknown as Buffer;
    });

    const classifier = create_time_classifier({
      device: 'captain',
      cpu_idle_threshold: 99,
    });

    const result = await classifier.classify();
    expect(result.state).toBe('idle'); // 57.5% < 99% → idle
  });

  it('get_summary includes current state duration even before stop', async () => {
    setup_captain_mocks('working');
    const classifier = create_time_classifier({
      device: 'captain',
      check_interval_ms: 10_000,
    });

    classifier.start();
    await vi.advanceTimersByTimeAsync(10); // initial classify

    // Advance some time but don't stop
    vi.advanceTimersByTime(5000);

    const summary = classifier.get_summary();
    // Should include current state's accumulated time
    expect(summary.working_ms).toBeGreaterThan(0);

    classifier.stop();
  });
});
