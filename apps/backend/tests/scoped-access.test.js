'use strict';

/**
 * scoped-access.test.js
 *
 * Tests for EntitlementAccessService.hasResourceAccess — the unified resolver
 * that decides whether a user can use a specific channel, hangout, or creator.
 *
 * Covers the core policy:
 *   - Scoped entitlements are standalone (channel-access survives pnp-member expiry).
 *   - PRIME is a global override.
 *   - Bans always deny.
 *   - Resource-type-specific rules (free/prime/subscription/paid channels,
 *     channel-linked vs standalone paid hangouts, creator subscriptions).
 *
 * Run with: jest apps/backend/tests/scoped-access.test.js
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

const redisMem = {};
const mockRedis = {
  get: jest.fn(async (k) => redisMem[k] ?? null),
  set: jest.fn(async (k, v) => { redisMem[k] = v; return 'OK'; }),
  del: jest.fn(async (...keys) => {
    let count = 0;
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(redisMem, k)) {
        delete redisMem[k];
        count++;
      }
    }
    return count;
  }),
  scan: jest.fn(async (_cursor, _match, pattern) => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return ['0', Object.keys(redisMem).filter((k) => regex.test(k))];
  }),
};

jest.mock('../config/redis', () => ({
  getRedis: () => mockRedis,
  cache: mockRedis,
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const EntitlementAccessService = require('../services/entitlementAccessService');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set up a sequence of DB responses for a hasResourceAccess call. The resolver
 * does:
 *   1) isBanned → one SELECT
 *   2) _loadResource → one SELECT
 *   3) hasEntitlement for scoped add-on → one SELECT
 *   4) hasEntitlement for 'prime' → one SELECT (global override)
 *   5) kind-specific SELECTs (subscription check, etc.)
 *   6) final pnp-member fallback SELECT
 *
 * We queue responses with `queueDb([...rows])`.
 */
function queueDb(...responses) {
  for (const r of responses) {
    mockQuery.mockResolvedValueOnce({ rows: r });
  }
}

beforeEach(() => {
  for (const k of Object.keys(redisMem)) delete redisMem[k];
  mockQuery.mockReset();
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
});

// ── Banned / unauthenticated ────────────────────────────────────────────────

describe('hasResourceAccess — ban + auth checks', () => {
  it('denies when userId is falsy', async () => {
    const result = await EntitlementAccessService.hasResourceAccess(null, 'channel', 'c-1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('AUTH_REQUIRED');
  });

  it('denies a banned user even if entitlements exist', async () => {
    // isBanned → 1 row → banned
    queueDb([{ 1: 1 }]);
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('ACCOUNT_SUSPENDED');
  });
});

// ── Channel access ──────────────────────────────────────────────────────────

describe('hasResourceAccess — channel', () => {
  it('returns not_found when the channel row is missing', async () => {
    queueDb([], []); // isBanned=false, _loadResource=empty
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-missing');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('allows free channels without any entitlement', async () => {
    queueDb(
      [],                                           // isBanned=false
      [{ id: 'c-free', access_type: 'free', creator_id: 'u-1' }], // loadResource
      [],                                           // scoped channel-access lookup (no row)
      [],                                           // prime lookup (no row)
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-free');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('free');
  });

  it('allows a user with channel-access entitlement for this channel (scoped)', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-paid', access_type: 'paid', creator_id: 'u-1', price_usd: 5 }], // resource
      [{ 1: 1 }],                                  // channel-access entitlement EXISTS
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-paid');
    expect(result.allowed).toBe(true);
    expect(result.scoped).toBe(true);
    expect(result.reason).toBe('scoped_channel_access');
  });

  it('denies paid channel with payment required when no scoped entitlement + no prime', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-paid', access_type: 'paid', creator_id: 'u-1', price_usd: 5 }],
      [],                                          // no channel-access
      [],                                          // no prime
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-paid');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PAYMENT_REQUIRED');
    expect(result.accessType).toBe('paid');
    expect(result.priceUsd).toBe(5);
  });

  it('allows paid channel when user has prime (global override)', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-paid', access_type: 'paid', creator_id: 'u-1', price_usd: 5 }],
      [],                                          // no channel-access
      [{ 1: 1 }],                                  // prime EXISTS
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-paid');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('prime_override');
  });

  it('requires prime on a prime-gated channel', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-prime', access_type: 'prime', creator_id: 'u-1' }],
      [],                                          // no channel-access scoped row
      [],                                          // no prime
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-prime');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PRIME_REQUIRED');
  });

  it('allows a subscription channel when user has creator-subscription entitlement', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-sub', access_type: 'subscription', creator_id: 'u-creator' }],
      [],                                          // no direct channel-access
      [],                                          // no prime
      [{ 1: 1 }],                                  // creator-subscription:u-creator EXISTS
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-sub');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('creator_subscriber');
    expect(result.scoped).toBe(true);
  });

  it('denies a subscription channel when user has no subscription and no prime', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-sub', access_type: 'subscription', creator_id: 'u-creator' }],
      [],                                          // no direct channel-access
      [],                                          // no prime
      [],                                          // no creator-subscription
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-sub');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CREATOR_SUBSCRIPTION_REQUIRED');
    expect(result.creatorId).toBe('u-creator');
  });
});

// ── Hangout access ──────────────────────────────────────────────────────────

describe('hasResourceAccess — hangout', () => {
  it('allows standalone paid hangout with hangout-access entitlement', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'h-1', is_paid: true, channel_id: null, price_usd: 3 }],
      [{ 1: 1 }],                                  // hangout-access:h-1 EXISTS
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-1');
    expect(result.allowed).toBe(true);
    expect(result.scoped).toBe(true);
    expect(result.reason).toBe('scoped_hangout_access');
  });

  it('denies standalone paid hangout with payment required when no scoped access', async () => {
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'h-1', is_paid: true, channel_id: null, creator_id: 'u-1', price_usd: 3 }],
      [],                                          // no hangout-access
      [],                                          // no prime
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PAYMENT_REQUIRED');
    expect(result.priceUsd).toBe(3);
  });

  it('allows channel-linked hangout when user has channel-access for the linked channel', async () => {
    // Resolution:
    //  1) isBanned=false
    //  2) load hangout → {channel_id:'c-linked'}
    //  3) hangout-access:h-2 → no
    //  4) channel-access:c-linked → YES
    queueDb(
      [],                                                      // isBanned
      [{ id: 'h-2', is_paid: true, channel_id: 'c-linked' }], // hangout
      [],                                                      // hangout-access no
      [{ 1: 1 }],                                              // channel-access on linked channel YES
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-2');
    expect(result.allowed).toBe(true);
    expect(result.scoped).toBe(true);
    expect(result.reason).toBe('scoped_via_channel');
  });

  it('falls back to pnp-member for free community hangout (non-member)', async () => {
    // For free community hangouts without an existing hangout_group_members row,
    // fall through to the pnp-member gate.
    queueDb(
      [],                                                      // isBanned
      [{ id: 'h-3', is_paid: false, channel_id: null }],      // standalone free
      [],                                                      // no hangout-access
      [],                                                      // no membership row
      [],                                                      // no prime
      [{ 1: 1 }],                                              // pnp-member YES
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-3');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('pnp_member');
  });

  it('allows existing hangout members regardless of tier (grandfather rule)', async () => {
    // A free user who previously joined a free community hangout must keep
    // chat access — pre-refactor behaviour that the unified resolver must preserve.
    queueDb(
      [],                                                      // isBanned
      [{ id: 'h-3', is_paid: false, channel_id: null }],      // free community
      [],                                                      // no hangout-access
      [{ 1: 1 }],                                              // hangout_group_members MATCH
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-3');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('existing_member');
  });

  it('does NOT grandfather existing members of a paid hangout (scope required)', async () => {
    // When scoped access expires, hangout_group_members rows persist — the
    // resolver must enforce the scope entitlement, not fall back to member status.
    queueDb(
      [],                                                      // isBanned
      [{ id: 'h-4', is_paid: true, channel_id: null, creator_id: 'u-1', price_usd: 10 }],
      [],                                                      // no hangout-access (expired)
      [],                                                      // no prime
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-4');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PAYMENT_REQUIRED');
  });

  it('does NOT grandfather existing members of a channel-linked hangout (scope required)', async () => {
    // For channel-linked hangouts, the channel-access scope is authoritative.
    // When it expires, a lingering hangout_group_members row must not keep the user in.
    // The hangout kind delegates to the channel kind when channel_id is set, which
    // re-runs the full ladder (isBanned + loadResource + scope + prime + kind rules).
    queueDb(
      [],                                                      // isBanned (hangout call)
      [{ id: 'h-5', is_paid: false, channel_id: 'c-linked' }], // loadResource hangout
      [],                                                      // no hangout-access
      [],                                                      // no channel-access on linked channel (pre-delegation shortcut)
      [],                                                      // no prime (global override — hangout path)
      // Hangout kind is_paid=false so PAYMENT_REQUIRED branch is skipped.
      // Delegates to channel kind → recursive hasResourceAccess('channel', 'c-linked').
      // Note: recursive isBanned hits Redis cache (set during the outer call) — no DB query.
      [{ id: 'c-linked', access_type: 'paid', creator_id: 'u-1', price_usd: 10 }], // recursive loadResource channel
      [],                                                      // recursive no channel-access
      [],                                                      // recursive no prime
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'hangout', 'h-5');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('PAYMENT_REQUIRED');
  });
});

// ── Standalone policy: scoped access survives pnp-member expiry ─────────────

describe('hasResourceAccess — scoped access survives membership expiry', () => {
  it('allows channel-access holder even when pnp-member has lapsed', async () => {
    // Note: the resolver only touches the scoped entitlement first and
    // short-circuits before ever checking pnp-member. That IS the point.
    queueDb(
      [],                                          // isBanned=false
      [{ id: 'c-paid', access_type: 'paid', creator_id: 'u-1', price_usd: 5 }],
      [{ 1: 1 }],                                  // channel-access YES (even though pnp-member is gone)
    );
    const result = await EntitlementAccessService.hasResourceAccess('42', 'channel', 'c-paid');
    expect(result.allowed).toBe(true);
    expect(result.scoped).toBe(true);
    // Crucially, we should NOT have issued a pnp-member lookup at all.
    // (3 queries total: isBanned + load + scoped entitlement match.)
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});
