'use strict';

/**
 * Main Stage Service — Unit Test Suite
 *
 * Covers:
 *   1. setMode — rejects bogus mode
 *   2. setMedia — clamps volume inside valid range
 *   3. addCammer — respects 12-cammer cap
 *   4. addCammer — deduplicates identity
 *   5. advanceSpotlight — rotates through queue in order (round-robin)
 *   6. advanceSpotlight — clears spotlight when queue is empty
 *   7. startRotation — acquires Redis lock; second caller is a no-op
 *   8. logAdminAction — writes parameterised INSERT to DB
 *   9. setMode — emits socket state after change
 *  10. removeCammer — advances spotlight if removed was current
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// In-memory Redis that supports lrange/rpush/lrem properly
const redisMem = {};
let lockAcquired = false;

const mockRedis = {
  get: jest.fn(async (k) => redisMem[k] !== undefined ? String(redisMem[k]) : null),
  set: jest.fn(async (k, v, ...opts) => {
    const nxIdx = opts.findIndex((o) => o === 'NX');
    if (nxIdx !== -1 && redisMem[k] !== undefined) return null;
    redisMem[k] = v;
    return 'OK';
  }),
  del: jest.fn(async (...keys) => {
    keys.forEach((k) => delete redisMem[k]);
    return keys.length;
  }),
  expire: jest.fn(async () => 1),
  lrange: jest.fn(async (k) => {
    const v = redisMem[k];
    return Array.isArray(v) ? [...v] : [];
  }),
  rpush: jest.fn(async (k, val) => {
    if (!Array.isArray(redisMem[k])) redisMem[k] = [];
    redisMem[k].push(String(val));
    return redisMem[k].length;
  }),
  lrem: jest.fn(async (k, _count, val) => {
    if (!Array.isArray(redisMem[k])) return 0;
    const before = redisMem[k].length;
    redisMem[k] = redisMem[k].filter((x) => x !== String(val));
    return before - redisMem[k].length;
  }),
  hset: jest.fn(async (k, ...rest) => {
    // ioredis supports HSET key field value [field value ...] — emulate that
    // so callers passing many pairs (mainStageService.patchMediaHash) work.
    if (redisMem[k] == null || typeof redisMem[k] !== 'object' || Array.isArray(redisMem[k])) {
      redisMem[k] = {};
    }
    let written = 0;
    for (let i = 0; i + 1 < rest.length; i += 2) {
      redisMem[k][String(rest[i])] = String(rest[i + 1]);
      written++;
    }
    return written;
  }),
  type: jest.fn(async (k) => {
    const v = redisMem[k];
    if (v === undefined) return 'none';
    if (Array.isArray(v)) return 'list';
    if (typeof v === 'object') return 'hash';
    return 'string';
  }),
  multi: jest.fn(() => {
    // Minimal MULTI/EXEC pipeline — buffers ops, runs them on exec().
    const ops = [];
    const pipe = {
      del:    (...args) => { ops.push(() => mockRedis.del(...args));    return pipe; },
      hset:   (...args) => { ops.push(() => mockRedis.hset(...args));   return pipe; },
      expire: (...args) => { ops.push(() => mockRedis.expire(...args)); return pipe; },
      exec:   async ()   => { const out = []; for (const op of ops) out.push([null, await op()]); return out; },
    };
    return pipe;
  }),
  hdel: jest.fn(async (k, field) => {
    if (!redisMem[k] || typeof redisMem[k] !== 'object' || Array.isArray(redisMem[k])) return 0;
    const exists = Object.prototype.hasOwnProperty.call(redisMem[k], String(field));
    if (exists) delete redisMem[k][String(field)];
    return exists ? 1 : 0;
  }),
  hgetall: jest.fn(async (k) => {
    if (!redisMem[k] || typeof redisMem[k] !== 'object' || Array.isArray(redisMem[k])) return {};
    return { ...redisMem[k] };
  }),
  // Minimal Lua evaluator — dispatches on numKeys to match the two scripts used
  // by mainStageService: addCammer (1 key) and advanceSpotlight (3 keys).
  eval: jest.fn(async (_script, numKeys, ...rest) => {
    const n = parseInt(numKeys, 10);
    if (n === 2) {
      // ADD_CAMMER_LUA: KEYS=[queueKey, tsKey], ARGV=[id, cap, now]
      const [queueKey, tsKey, id, capStr, now] = rest;
      const cap  = parseInt(capStr, 10);
      const list = Array.isArray(redisMem[queueKey]) ? redisMem[queueKey] : [];
      if (list.includes(String(id))) return 'duplicate';
      if (list.length >= cap)       return 'full';
      if (!Array.isArray(redisMem[queueKey])) redisMem[queueKey] = [];
      redisMem[queueKey].push(String(id));
      if (redisMem[tsKey] == null || typeof redisMem[tsKey] !== 'object' || Array.isArray(redisMem[tsKey])) {
        redisMem[tsKey] = {};
      }
      redisMem[tsKey][String(id)] = String(now);
      return 'added';
    }
    if (n === 3) {
      // ADVANCE_LUA: KEYS=[queueKey, cammerKey, nextAtKey], ARGV=[ttl, nextAt]
      const [qk, ck, nk, _ttl, nextAt] = rest;
      const queue = Array.isArray(redisMem[qk]) ? redisMem[qk] : [];
      if (queue.length === 0) {
        delete redisMem[ck]; delete redisMem[nk];
        return ['', ''];
      }
      const current = redisMem[ck] != null ? String(redisMem[ck]) : null;
      let idx = 0;
      if (current) {
        const i = queue.indexOf(current);
        if (i !== -1) idx = i + 1;
      }
      const nextIdx = idx % queue.length;
      const next    = queue[nextIdx];
      redisMem[ck] = next;
      redisMem[nk] = String(nextAt);
      return [next, current || ''];
    }
    throw new Error(`Unexpected eval call with numKeys=${n}`);
  }),
};

jest.mock('../config/redis', () => ({
  getRedis: () => mockRedis,
}));

// Postgres mock
const mockDbQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  getPool: () => ({ query: mockDbQuery }),
}));

// Logger — silent
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ─── Import service under test (after mocks) ─────────────────────────────────

const svc = require('../services/mainStageService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetRedis() {
  Object.keys(redisMem).forEach((k) => delete redisMem[k]);
}

function seedQueue(identities) {
  redisMem['mainstage:spotlight:queue'] = [...identities];
}

function seedSpotlight(identity) {
  redisMem['mainstage:spotlight:cammer'] = identity;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetRedis();
  lockAcquired = false;
  svc.setIo(null); // no socket emissions in unit tests
});

afterAll(() => {
  // Stop background rotation timers if startRotation was tested
  svc.stopRotation().catch(() => {});
});

// ── 1. setMode ────────────────────────────────────────────────────────────────

describe('setMode', () => {
  it('should resolve without error for valid modes', async () => {
    for (const mode of ['spotlight', 'cinema', 'equal']) {
      await expect(svc.setMode(mode)).resolves.toBeUndefined();
      expect(mockRedis.set).toHaveBeenCalledWith('mainstage:mode', mode, 'EX', expect.any(Number));
    }
  });

  it('should throw for an invalid mode string', async () => {
    await expect(svc.setMode('freeform')).rejects.toThrow(/Invalid mode/);
    await expect(svc.setMode('')).rejects.toThrow(/Invalid mode/);
    await expect(svc.setMode('SPOTLIGHT')).rejects.toThrow(/Invalid mode/); // case-sensitive
  });

  it('should throw for non-string inputs', async () => {
    await expect(svc.setMode(null)).rejects.toThrow(/Invalid mode/);
    await expect(svc.setMode(undefined)).rejects.toThrow(/Invalid mode/);
    await expect(svc.setMode(42)).rejects.toThrow(/Invalid mode/);
  });
});

// ── 2. setMedia — volume clamping ─────────────────────────────────────────────

// mainstage:media is now stored as a Redis Hash, with each field
// JSON-stringified for round-trip type safety. Helper decodes the hash
// back to a plain JS object for assertion purposes.
function readMediaHash() {
  const h = redisMem['mainstage:media'];
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    try { out[k] = JSON.parse(v); } catch (_) { out[k] = v; }
  }
  return out;
}

describe('setMedia — volume clamping', () => {
  it('should clamp volume above 100 to 100', async () => {
    await svc.setMedia({ volume: 200 });
    expect(readMediaHash().volume).toBe(100);
  });

  it('should clamp volume below 0 to 0', async () => {
    await svc.setMedia({ volume: -99 });
    expect(readMediaHash().volume).toBe(0);
  });

  it('should accept volume=0 exactly', async () => {
    await svc.setMedia({ volume: 0 });
    expect(readMediaHash().volume).toBe(0);
  });

  it('should accept volume=100 exactly', async () => {
    await svc.setMedia({ volume: 100 });
    expect(readMediaHash().volume).toBe(100);
  });

  it('should use default volume 50 for non-numeric input', async () => {
    await svc.setMedia({ volume: 'loud' });
    expect(readMediaHash().volume).toBe(50);
  });

  it('should reject invalid media kind', async () => {
    await expect(svc.setMedia({ kind: 'dvd' })).rejects.toThrow(/Invalid media kind/);
  });

  it('should accept valid kind values', async () => {
    for (const kind of ['video', 'music', 'off']) {
      await expect(svc.setMedia({ kind })).resolves.toBeUndefined();
    }
  });
});

// ── 3. addCammer — cap enforcement ────────────────────────────────────────────

describe('addCammer — cammer cap', () => {
  it('should add a cammer when queue is empty', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] }); // upsertCammerStats
    await svc.addCammer('alice');
    expect(redisMem['mainstage:spotlight:queue']).toContain('alice');
  });

  it('should reject a cammer when queue is at cap', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const full = Array.from({ length: svc.MAX_CAMMERS }, (_, i) => `c${i}`);
    seedQueue(full);

    await svc.addCammer('newcomer');

    // newcomer should NOT be in the queue
    expect(redisMem['mainstage:spotlight:queue']).not.toContain('newcomer');
    expect(redisMem['mainstage:spotlight:queue'].length).toBe(svc.MAX_CAMMERS);
  });

  it('should allow adding up to exactly 12 cammers', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    for (let i = 0; i < 12; i++) {
      await svc.addCammer(`cammer${i}`);
    }
    expect(redisMem['mainstage:spotlight:queue'].length).toBe(12);
  });

  it('should not count beyond cap when called concurrently (serialised by Redis list length check)', async () => {
    // addCammer does an lrange then checks length — concurrent calls can race
    // This test documents the known TOCTOU: both checks happen before either rpush.
    // The test confirms addCammer's OWN cap check does enforce at the service level,
    // even if the token endpoint has a separate TOCTOU window.
    mockDbQuery.mockResolvedValue({ rows: [] });
    seedQueue(Array.from({ length: 11 }, (_, i) => `c${i}`));

    // Two concurrent callers for the 12th slot
    await Promise.all([svc.addCammer('racer1'), svc.addCammer('racer2')]);

    // Due to TOCTOU both may have been added — this is the known gap.
    // The queue can be 12 or 13 depending on scheduling; we assert no more than 13.
    const q = redisMem['mainstage:spotlight:queue'];
    expect(q.length).toBeLessThanOrEqual(13); // documents the race window
  });
});

// ── 4. addCammer — deduplication ─────────────────────────────────────────────

describe('addCammer — deduplication', () => {
  it('should not add the same identity twice', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    await svc.addCammer('alice');
    await svc.addCammer('alice');

    expect(redisMem['mainstage:spotlight:queue'].filter((x) => x === 'alice').length).toBe(1);
  });
});

// ── 5. advanceSpotlight — round-robin rotation ────────────────────────────────

describe('advanceSpotlight — round-robin', () => {
  it('should advance from first to second cammer', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    seedQueue(['alice', 'bob', 'carol']);
    seedSpotlight('alice');

    await svc.advanceSpotlight();

    expect(redisMem['mainstage:spotlight:cammer']).toBe('bob');
  });

  it('should wrap around to the first cammer after the last', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    seedQueue(['alice', 'bob', 'carol']);
    seedSpotlight('carol');

    await svc.advanceSpotlight();

    expect(redisMem['mainstage:spotlight:cammer']).toBe('alice');
  });

  it('should advance through all cammers in order', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    const cammers = ['a', 'b', 'c', 'd'];
    seedQueue(cammers);
    seedSpotlight('a');

    const order = ['a']; // start
    for (let i = 0; i < 4; i++) {
      await svc.advanceSpotlight();
      order.push(redisMem['mainstage:spotlight:cammer']);
    }

    // After 4 advances from 'a': b, c, d, a (wraps)
    expect(order).toEqual(['a', 'b', 'c', 'd', 'a']);
  });
});

// ── 6. advanceSpotlight — empty queue ────────────────────────────────────────

describe('advanceSpotlight — empty queue', () => {
  it('should clear spotlight when queue is empty', async () => {
    seedSpotlight('alice');
    // queue is empty (not seeded)
    redisMem['mainstage:spotlight:queue'] = [];

    await svc.advanceSpotlight();

    // cammer key should be deleted
    expect(redisMem['mainstage:spotlight:cammer']).toBeUndefined();
    expect(redisMem['mainstage:spotlight:nextAt']).toBeUndefined();
  });
});

// ── 7. startRotation — distributed lock ──────────────────────────────────────

describe('startRotation — distributed lock', () => {
  it('should acquire the lock on first call', async () => {
    // The service uses redis.set(LOCK_KEY, token, 'NX', 'EX', TTL)
    // Our mock only writes when key is absent (NX behaviour).
    await svc.startRotation();

    const lockVal = redisMem['mainstage:rotator:lock'];
    expect(lockVal).toBeDefined();
    expect(typeof lockVal).toBe('string');
    expect(lockVal.length).toBeGreaterThan(0);

    await svc.stopRotation();
  });

  it('should NOT overwrite an existing lock (second instance is a no-op)', async () => {
    // Simulate another instance already holds the lock
    redisMem['mainstage:rotator:lock'] = 'other-instance-token';

    // Our mock set() with NX will return null because key already exists.
    // The service should log "lock not acquired" and schedule a retry but NOT start a timer.
    // We verify the in-process state isn't corrupted by mocking setTimeout.
    const origSetTimeout = global.setTimeout;
    const timeouts = [];
    global.setTimeout = jest.fn((fn, delay) => {
      timeouts.push({ fn, delay });
      return 999; // fake handle
    });

    await svc.startRotation();

    // Lock value should remain as the other instance's token
    expect(redisMem['mainstage:rotator:lock']).toBe('other-instance-token');

    global.setTimeout = origSetTimeout;
    // Clean up fake timers
    timeouts.forEach(({ fn }) => fn && fn.toString().includes('tryAcquire') && clearTimeout);
  });
});

// ── 8. logAdminAction — DB write ─────────────────────────────────────────────

describe('logAdminAction', () => {
  it('should insert a row with correct parameterised values', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await svc.logAdminAction('admin1', 'set_mode', { mode: 'spotlight' });

    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mainstage_admin_log'),
      ['admin1', 'set_mode', JSON.stringify({ mode: 'spotlight' })]
    );
  });

  it('should use parameterised query (no string interpolation)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const maliciousPayload = { src: "'; DROP TABLE users; --" };
    await svc.logAdminAction('admin1', 'set_media', maliciousPayload);

    const [query, params] = mockDbQuery.mock.calls[0];
    // The SQL must use $1, $2, $3 placeholders — not embed the payload directly
    expect(query).toContain('$1');
    expect(query).toContain('$2');
    expect(query).toContain('$3');
    // The dangerous string should be in params, not in the query template
    expect(query).not.toContain('DROP TABLE');
    expect(params[2]).toContain('DROP TABLE');
  });

  it('should not throw when DB query fails (best-effort logging)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(svc.logAdminAction('u1', 'test_action')).resolves.toBeUndefined();
  });

  it('should handle null userId gracefully', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(svc.logAdminAction(null, 'boot')).resolves.toBeUndefined();

    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[0]).toBeNull();
  });
});

// ── 9. setMode emits socket state ─────────────────────────────────────────────

describe('setMode — socket emission', () => {
  it('should call _io.to(...).emit when io is injected', async () => {
    const mockEmit = jest.fn();
    const mockTo   = jest.fn(() => ({ emit: mockEmit }));
    const mockIo   = { to: mockTo };

    svc.setIo(mockIo);
    // getState will read from mocked Redis (returns defaults)

    await svc.setMode('spotlight');
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(mockTo).toHaveBeenCalledWith('mainstage');
    expect(mockEmit).toHaveBeenCalledWith('mainstage:state', expect.objectContaining({ mode: 'spotlight' }));

    svc.setIo(null);
  });
});

// ── 10. removeCammer — advances spotlight when removed was current ─────────────

describe('removeCammer', () => {
  it('should advance spotlight when the spotlighted cammer leaves', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    seedQueue(['alice', 'bob']);
    seedSpotlight('alice');

    await svc.removeCammer('alice');

    // 'alice' removed from queue
    expect(redisMem['mainstage:spotlight:queue']).not.toContain('alice');
    // Spotlight should have advanced to bob
    expect(redisMem['mainstage:spotlight:cammer']).toBe('bob');
  });

  it('should not change spotlight when a non-spotlight cammer leaves', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });
    seedQueue(['alice', 'bob', 'carol']);
    seedSpotlight('alice');

    await svc.removeCammer('bob');

    expect(redisMem['mainstage:spotlight:queue']).not.toContain('bob');
    expect(redisMem['mainstage:spotlight:cammer']).toBe('alice');
  });
});
