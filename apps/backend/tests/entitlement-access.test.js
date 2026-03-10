'use strict';

/**
 * entitlement-access.test.js
 *
 * Tests for EntitlementAccessService:
 *   - hasEntitlement: active, expired, lifetime, consumed, cache hit, DB error, creatorId
 *   - getUserLabel: PRIME, BASIC, FREE, cache hit
 *   - invalidateCache: deletes all related keys
 *   - requireEntitlement middleware: 401, 403-banned, 403-missing, next(), admin bypass
 *   - isBanned: true, false
 *
 * Run with: jest apps/backend/tests/entitlement-access.test.js
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

// In-memory Redis store for tests — supports variadic del(k1, k2, ...)
const redisMem = {};
const mockRedis = {
  get:  jest.fn(async (k) => redisMem[k] ?? null),
  set:  jest.fn(async (k, v, _ex, _ttl) => { redisMem[k] = v; return 'OK'; }),
  del:  jest.fn(async (...keys) => {
    let count = 0;
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(redisMem, k)) {
        delete redisMem[k];
        count++;
      }
    }
    return count;
  }),
  keys: jest.fn(async (pattern) => {
    // Minimal glob: replace * with wildcard match
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Object.keys(redisMem).filter(k => regex.test(k));
  }),
  scan: jest.fn(async (_cursor, _match, pattern, _count, _n) => {
    // Simulate SCAN returning all matching keys in one pass
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const matched = Object.keys(redisMem).filter(k => regex.test(k));
    return ['0', matched]; // cursor '0' = done
  }),
};

jest.mock('../config/redis', () => ({
  getRedis: () => mockRedis,
  cache: mockRedis,
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

const EntitlementAccessService = require('../bot/services/entitlementAccessService');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Express req with an authenticated session user. */
function makeReq({ userId = '42', role = 'user', tier = 'PRIME' } = {}) {
  return {
    session: {
      user: { id: userId, role, tier },
    },
  };
}

/** Build a mock Express res with chainable status/json helpers. */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Wipe in-memory Redis store
  for (const k of Object.keys(redisMem)) delete redisMem[k];

  // Reset all mock call history
  mockQuery.mockReset();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRedis.del.mockClear();
  mockRedis.keys.mockClear();
});

// ── hasEntitlement ────────────────────────────────────────────────────────────

describe('EntitlementAccessService.hasEntitlement', () => {

  it('returns true for an active non-expired entitlement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await EntitlementAccessService.hasEntitlement('42', 'prime');

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns false for an expired entitlement (DB returns no rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await EntitlementAccessService.hasEntitlement('42', 'prime');

    expect(result).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns true for a lifetime entitlement (is_lifetime=true, expires_at=NULL)', async () => {
    // The SQL WHERE clause covers lifetime; as long as DB returns a row the service says true.
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await EntitlementAccessService.hasEntitlement('42', 'pnp-member');

    expect(result).toBe(true);
  });

  it('returns false for a consumed entitlement (DB returns no rows due to is_consumed filter)', async () => {
    // is_consumed=true rows are excluded by the WHERE clause; DB returns empty.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await EntitlementAccessService.hasEntitlement('42', 'prime');

    expect(result).toBe(false);
  });

  it('uses Redis cache on second call and does not hit DB again', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    // First call — populates cache
    const first = await EntitlementAccessService.hasEntitlement('42', 'prime');
    expect(first).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Second call — should read from in-memory redisMem ('1' is cached)
    const second = await EntitlementAccessService.hasEntitlement('42', 'prime');
    expect(second).toBe(true);
    // DB must not have been called a second time
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns false on DB error (fail closed)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await EntitlementAccessService.hasEntitlement('42', 'prime');

    expect(result).toBe(false);
  });

  it('checks creator-subscription correctly when creatorId is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await EntitlementAccessService.hasEntitlement(
      '42',
      'creator-subscription',
      { creatorId: 'creator-99' }
    );

    expect(result).toBe(true);
    // Verify the creatorId was threaded into the query params
    const callArgs = mockQuery.mock.calls[0][1];
    expect(callArgs).toContain('creator-99');
  });

  it('returns false for a non-existent creatorId (DB returns no rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await EntitlementAccessService.hasEntitlement(
      '42',
      'creator-subscription',
      { creatorId: 'nonexistent-creator' }
    );

    expect(result).toBe(false);
  });

  it('returns false when userId is falsy', async () => {
    const result = await EntitlementAccessService.hasEntitlement(null, 'prime');
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns false when addOnId is falsy', async () => {
    const result = await EntitlementAccessService.hasEntitlement('42', '');
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── getUserLabel ──────────────────────────────────────────────────────────────

describe('EntitlementAccessService.getUserLabel', () => {

  it('returns PRIME when user has prime entitlement', async () => {
    // hasEntitlement('42', 'prime') → true
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const label = await EntitlementAccessService.getUserLabel('42');

    expect(label).toBe('PRIME');
  });

  it('returns BASIC when user has pnp-member but not prime', async () => {
    // hasEntitlement('42', 'prime') → false
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // hasEntitlement('42', 'pnp-member') → true
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const label = await EntitlementAccessService.getUserLabel('42');

    expect(label).toBe('BASIC');
  });

  it('returns FREE when user has no active entitlements', async () => {
    // hasEntitlement('42', 'prime') → false
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // hasEntitlement('42', 'pnp-member') → false
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const label = await EntitlementAccessService.getUserLabel('42');

    expect(label).toBe('FREE');
  });

  it('returns FREE for null userId without touching DB', async () => {
    const label = await EntitlementAccessService.getUserLabel(null);
    expect(label).toBe('FREE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('uses Redis cache on second getUserLabel call', async () => {
    // First call: prime check → true → cache 'PRIME'
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    const first = await EntitlementAccessService.getUserLabel('42');
    expect(first).toBe('PRIME');

    // The user_label:42 key should now be in redisMem
    expect(redisMem['user_label:42']).toBe('PRIME');

    // Second call should read from Redis and not touch DB
    mockQuery.mockClear();
    const second = await EntitlementAccessService.getUserLabel('42');
    expect(second).toBe('PRIME');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns FREE on DB error (fail closed)', async () => {
    // Both hasEntitlement calls will fail via DB error
    mockQuery.mockRejectedValue(new Error('DB unavailable'));

    const label = await EntitlementAccessService.getUserLabel('42');

    expect(label).toBe('FREE');
  });
});

// ── invalidateCache ───────────────────────────────────────────────────────────

describe('EntitlementAccessService.invalidateCache', () => {

  it('deletes per-add-on entitlement keys and the label key', async () => {
    // Pre-populate redisMem with some keys for user 42
    redisMem['ent:42:prime']          = '1';
    redisMem['ent:42:pnp-member']     = '0';
    redisMem['ent:42:private-calls']  = '1';
    redisMem['user_label:42']         = 'PRIME';
    redisMem['tier_check:42']         = 'PRIME';
    // Key for a different user — must NOT be deleted
    redisMem['ent:99:prime']          = '1';

    await EntitlementAccessService.invalidateCache('42');

    expect(redisMem['ent:42:prime']).toBeUndefined();
    expect(redisMem['ent:42:pnp-member']).toBeUndefined();
    expect(redisMem['ent:42:private-calls']).toBeUndefined();
    expect(redisMem['user_label:42']).toBeUndefined();
    expect(redisMem['tier_check:42']).toBeUndefined();
    // Other user untouched
    expect(redisMem['ent:99:prime']).toBe('1');
  });

  it('does nothing when userId is falsy', async () => {
    redisMem['ent:42:prime'] = '1';

    await EntitlementAccessService.invalidateCache(null);

    // No Redis calls
    expect(mockRedis.keys).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('does not throw when there are no keys to delete', async () => {
    // redisMem is empty
    await expect(EntitlementAccessService.invalidateCache('42')).resolves.toBeUndefined();
  });
});

// ── requireEntitlement middleware ─────────────────────────────────────────────

describe('EntitlementAccessService.requireEntitlement middleware', () => {

  it('calls next() when user holds the required entitlement', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('pnp-member');
    const req  = makeReq({ role: 'user' });
    const res  = makeRes();
    const next = jest.fn();

    // isBanned → not banned
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // hasEntitlement → has it
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status).toBeNull();
  });

  it('returns 401 when req.session.user is missing (not authenticated)', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('prime');
    const req  = { session: {} }; // no user
    const res  = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.session is absent entirely', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('prime');
    const req  = {};
    const res  = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/authentication required/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('admin role bypasses entitlement check and calls next()', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('prime');
    const req  = makeReq({ role: 'admin' });
    const res  = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // No DB queries — admin skips both isBanned and hasEntitlement
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('superadmin role bypasses entitlement check and calls next()', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('prime');
    const req  = makeReq({ role: 'superadmin' });
    const res  = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 403 ACCOUNT_SUSPENDED for banned user even with entitlement in Redis', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('pnp-member');
    const req  = makeReq({ role: 'user' });
    const res  = makeRes();
    const next = jest.fn();

    // isBanned → banned
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    // hasEntitlement would say true too (cached from previous test scenario),
    // but we should never reach it.

    await middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('ACCOUNT_SUSPENDED');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 MEMBER_REQUIRED when user lacks pnp-member and is not banned', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('pnp-member');
    const req  = makeReq({ role: 'user' });
    const res  = makeRes();
    const next = jest.fn();

    // isBanned → not banned
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // hasEntitlement('pnp-member') → false
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('MEMBER_REQUIRED');
    expect(res._body.upgradeUrl).toBe('/subscribe');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 PRIME_REQUIRED when user lacks prime and is not banned', async () => {
    const middleware = EntitlementAccessService.requireEntitlement('prime');
    const req  = makeReq({ role: 'user' });
    const res  = makeRes();
    const next = jest.fn();

    // isBanned → not banned
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // hasEntitlement('prime') → false
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('PRIME_REQUIRED');
    expect(res._body.upgradeUrl).toBe('/subscribe');
    expect(next).not.toHaveBeenCalled();
  });
});

// ── isBanned ──────────────────────────────────────────────────────────────────

describe('EntitlementAccessService.isBanned', () => {

  it('returns true when users.tier = banned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

    const result = await EntitlementAccessService.isBanned('42');

    expect(result).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual(['42']);
  });

  it('returns false for a non-banned user (no matching row)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await EntitlementAccessService.isBanned('42');

    expect(result).toBe(false);
  });

  it('returns false when userId is falsy', async () => {
    const result = await EntitlementAccessService.isBanned(null);
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns false on DB error (fail closed)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    const result = await EntitlementAccessService.isBanned('42');

    expect(result).toBe(false);
  });
});

// ── labelToDisplayTier ────────────────────────────────────────────────────────

describe('EntitlementAccessService.labelToDisplayTier', () => {

  it('maps PRIME → PRIME', () => {
    expect(EntitlementAccessService.labelToDisplayTier('PRIME')).toBe('PRIME');
  });

  it('maps BASIC → member', () => {
    expect(EntitlementAccessService.labelToDisplayTier('BASIC')).toBe('member');
  });

  it('maps FREE → free', () => {
    expect(EntitlementAccessService.labelToDisplayTier('FREE')).toBe('free');
  });

  it('maps unknown → free (default)', () => {
    expect(EntitlementAccessService.labelToDisplayTier('UNKNOWN')).toBe('free');
  });
});
