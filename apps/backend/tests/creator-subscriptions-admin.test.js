'use strict';

/**
 * creator-subscriptions-admin.test.js
 *
 * Tests for creatorSubscriptionAdminController:
 *   - listCreators: returns creators with subscription stats
 *   - getCreatorDetail: 404, subscriber list, monthly revenue
 *   - processCreatorPayout: marks earnings paid, returns 0 when no pending
 *   - processAllPayouts: batch-processes all creators
 *   - cancelSubscription: sets status to cancelled, 404 on not found/not active
 *   - extendSubscription: extends expiry, validates days param, 404 on missing
 *
 * Run with: jest apps/backend/tests/creator-subscriptions-admin.test.js
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Jest resolves all relative require() paths to absolute paths before matching
// against mocks, so this single declaration intercepts both the test file's
// own imports and the controller's require('../../../config/postgres').

const mockQuery = jest.fn();

jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

const ctrl = require('../bot/api/controllers/creatorSubscriptionAdminController');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;   return this; },
  };
  return res;
}

function makeReq({ params = {}, body = {}, query = {} } = {}) {
  return {
    params,
    body,
    query,
    session: { user: { id: 'admin-1' } },
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

// ── listCreators ──────────────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.listCreators', () => {

  it('returns all active creators with subscription stats', async () => {
    const fakeCreators = [
      {
        creator_id:              'c-1',
        creator_username:        'alice',
        creator_first_name:      'Alice',
        creator_avatar:          null,
        creator_type:            'performer',
        creator_price_usd:       '9.99',
        active_subscribers:      12,
        total_revenue:           '120.00',
        total_creator_earnings:  '90.00',
        pending_payout:          '30.00',
      },
      {
        creator_id:              'c-2',
        creator_username:        'bob',
        creator_first_name:      'Bob',
        creator_avatar:          null,
        creator_type:            'content',
        creator_price_usd:       '4.99',
        active_subscribers:      5,
        total_revenue:           '25.00',
        total_creator_earnings:  '18.75',
        pending_payout:          '0.00',
      },
    ];

    mockQuery.mockResolvedValueOnce({ rows: fakeCreators });

    const req = makeReq();
    const res = makeRes();

    await ctrl.listCreators(req, res);

    expect(res._status).toBeNull(); // 200 implicit
    expect(res._body.success).toBe(true);
    expect(res._body.creators).toHaveLength(2);
    expect(res._body.creators[0].creator_username).toBe('alice');
    expect(res._body.creators[0].active_subscribers).toBe(12);
  });

  it('returns an empty creators array when no active creators exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq();
    const res = makeRes();

    await ctrl.listCreators(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.creators).toHaveLength(0);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection error'));

    const req = makeReq();
    const res = makeRes();

    await ctrl.listCreators(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── getCreatorDetail ──────────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.getCreatorDetail', () => {

  it('returns 404 for a non-existent or inactive creator', async () => {
    // Creator query returns no rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ params: { creatorId: 'ghost-creator' } });
    const res = makeRes();

    await ctrl.getCreatorDetail(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/creator not found/i);
  });

  it('returns creator info, subscriber list, monthly revenue, and payout summary', async () => {
    const creatorRow = {
      id: 'c-1', username: 'alice', first_name: 'Alice',
      avatar_url: null, creator_type: 'performer',
      creator_price_usd: '9.99', creator_subscriber_count: 12,
      creator_wallet_address: '0xABC', payout_method: 'crypto', email: 'alice@test.com',
    };
    const subsRows = [
      {
        id: 'sub-1', subscriber_id: 'u-10',
        subscriber_username: 'fan1', subscriber_first_name: 'Fan',
        subscriber_avatar: null, started_at: '2026-01-01',
        expires_at: '2026-04-01', status: 'active',
        price_usd: '9.99', auto_renew: true, revenue: '9.99',
      },
    ];
    const monthlyRows = [
      {
        month: '2026-03', gross: '19.98', creator_share: '14.99',
        platform_share: '4.99', subscription_count: 2, pending_amount: '14.99',
      },
    ];
    const payoutSummaryRows = [
      { pending_total: '14.99', paid_total: '0.00', pending_count: 1 },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [creatorRow] })     // creator lookup
      .mockResolvedValueOnce({ rows: subsRows })          // subscriptions
      .mockResolvedValueOnce({ rows: monthlyRows })       // monthly revenue
      .mockResolvedValueOnce({ rows: payoutSummaryRows }); // payout summary

    const req = makeReq({ params: { creatorId: 'c-1' } });
    const res = makeRes();

    await ctrl.getCreatorDetail(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.creator.id).toBe('c-1');
    expect(res._body.subscriptions).toHaveLength(1);
    expect(res._body.subscriptions[0].subscriber_username).toBe('fan1');
    expect(res._body.monthlyRevenue).toHaveLength(1);
    expect(res._body.monthlyRevenue[0].month).toBe('2026-03');
    expect(res._body.payoutSummary.pending_total).toBe('14.99');
  });

  it('uses a safe default payout summary when no earnings exist', async () => {
    const creatorRow = {
      id: 'c-2', username: 'bob', first_name: 'Bob',
      avatar_url: null, creator_type: 'content',
      creator_price_usd: '4.99', creator_subscriber_count: 0,
      creator_wallet_address: null, payout_method: null, email: null,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [creatorRow] })
      .mockResolvedValueOnce({ rows: [] })        // no subs
      .mockResolvedValueOnce({ rows: [] })        // no monthly revenue
      .mockResolvedValueOnce({ rows: [] });        // no payout rows

    const req = makeReq({ params: { creatorId: 'c-2' } });
    const res = makeRes();

    await ctrl.getCreatorDetail(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.payoutSummary).toEqual({
      pending_total: 0, paid_total: 0, pending_count: 0,
    });
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    const req = makeReq({ params: { creatorId: 'c-1' } });
    const res = makeRes();

    await ctrl.getCreatorDetail(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── processCreatorPayout ──────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.processCreatorPayout', () => {

  it('marks all unpaid earnings as paid and returns the amount + count', async () => {
    mockQuery
      .mockResolvedValueOnce({           // creator info
        rows: [{
          id: 'c-1', username: 'alice',
          creator_dash_address: '0xABC',
          payout_method: 'crypto',
          email: 'alice@test.com',
        }],
      })
      .mockResolvedValueOnce({           // pending earnings SELECT
        rows: [{ pending: '45.00', count: 5 }],
      })
      .mockResolvedValueOnce({ rowCount: 5, rows: [] }); // UPDATE earnings

    const req = makeReq({ params: { creatorId: 'c-1' } });
    const res = makeRes();

    await ctrl.processCreatorPayout(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.amount).toBe(45);
    expect(res._body.earningsCount).toBe(5);
    expect(res._body.creator).toBe('alice');
    expect(res._body.method).toBe('crypto');
    expect(res._body.walletAddress).toBe('0xABC');

    // Confirm the UPDATE call set status = 'paid_out'
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('UPDATE creator_earnings')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toMatch(/paid_at = NOW/);
  });

  it('returns amount=0 when there are no pending payouts', async () => {
    mockQuery
      .mockResolvedValueOnce({          // creator info
        rows: [{ id: 'c-1', username: 'alice', creator_wallet_address: null, payout_method: null }],
      })
      .mockResolvedValueOnce({          // no pending earnings
        rows: [{ pending: null, count: 0 }],
      });

    const req = makeReq({ params: { creatorId: 'c-1' } });
    const res = makeRes();

    await ctrl.processCreatorPayout(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.amount).toBe(0);
    expect(res._body.earningsCount).toBe(0);
    // No UPDATE should have been issued
    const updateCalls = mockQuery.mock.calls.filter(
      ([sql]) => sql && sql.includes('UPDATE creator_earnings')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('returns 404 when creator is not found or not active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // creator not found

    const req = makeReq({ params: { creatorId: 'ghost' } });
    const res = makeRes();

    await ctrl.processCreatorPayout(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/creator not found/i);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('lock timeout'));

    const req = makeReq({ params: { creatorId: 'c-1' } });
    const res = makeRes();

    await ctrl.processCreatorPayout(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── processAllPayouts ─────────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.processAllPayouts', () => {

  it('processes all creators with pending earnings in batch', async () => {
    const creatorsWithPending = [
      { creator_id: 'c-1', username: 'alice', pending: '45.00' },
      { creator_id: 'c-2', username: 'bob',   pending: '20.00' },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: creatorsWithPending })  // SELECT creators
      .mockResolvedValueOnce({ rowCount: 5 })                // UPDATE c-1
      .mockResolvedValueOnce({ rowCount: 2 });               // UPDATE c-2

    const req = makeReq();
    const res = makeRes();

    await ctrl.processAllPayouts(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.creatorsCount).toBe(2);
    expect(res._body.totalAmount).toBeCloseTo(65, 2);
    expect(res._body.payouts).toHaveLength(2);
    expect(res._body.payouts[0].creatorUsername).toBe('alice');
    expect(res._body.payouts[1].amount).toBeCloseTo(20, 2);
  });

  it('returns message when no pending payouts exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no creators with pending

    const req = makeReq();
    const res = makeRes();

    await ctrl.processAllPayouts(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.message).toMatch(/no pending payouts/i);
    expect(res._body.payouts).toEqual([]);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const req = makeReq();
    const res = makeRes();

    await ctrl.processAllPayouts(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── cancelSubscription ────────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.cancelSubscription', () => {

  it('cancels an active subscription and returns success', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE matched

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
    });
    const res = makeRes();

    await ctrl.cancelSubscription(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.message).toMatch(/cancelled/i);

    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[0]).toMatch(/status = 'cancelled'/);
    expect(updateCall[1]).toEqual(['sub-10', 'c-1']);
  });

  it('returns 404 when subscription is not found or not active', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // UPDATE matched nothing

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-99' },
    });
    const res = makeRes();

    await ctrl.cancelSubscription(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/not found or not active/i);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('deadlock'));

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
    });
    const res = makeRes();

    await ctrl.cancelSubscription(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── extendSubscription ────────────────────────────────────────────────────────

describe('creatorSubscriptionAdminController.extendSubscription', () => {

  it('extends the subscription expiry by the given number of days', async () => {
    const newExpiry = new Date('2026-05-10T00:00:00.000Z');

    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ expires_at: newExpiry }],
    });

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 30 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.newExpiresAt).toEqual(newExpiry);

    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[1]).toEqual([30, 'sub-10', 'c-1']);
  });

  it('returns 400 when days is missing', async () => {
    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   {},
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/days must be between 1 and 365/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when days is 0', async () => {
    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 0 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/days must be between 1 and 365/i);
  });

  it('returns 400 when days exceeds 365', async () => {
    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 400 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/days must be between 1 and 365/i);
  });

  it('returns 400 when days is a non-numeric string', async () => {
    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 'thirty' },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/days must be between 1 and 365/i);
  });

  it('returns 404 when subscription is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-ghost' },
      body:   { days: 7 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/subscription not found/i);
  });

  it('extends exactly 1 day (boundary minimum)', async () => {
    const newExpiry = new Date('2026-04-02T00:00:00.000Z');

    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ expires_at: newExpiry }],
    });

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 1 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._body.success).toBe(true);
    expect(mockQuery.mock.calls[0][1][0]).toBe(1);
  });

  it('extends exactly 365 days (boundary maximum)', async () => {
    const newExpiry = new Date('2027-04-01T00:00:00.000Z');

    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ expires_at: newExpiry }],
    });

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 365 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._body.success).toBe(true);
    expect(mockQuery.mock.calls[0][1][0]).toBe(365);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('query timeout'));

    const req = makeReq({
      params: { creatorId: 'c-1', subscriptionId: 'sub-10' },
      body:   { days: 30 },
    });
    const res = makeRes();

    await ctrl.extendSubscription(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});
