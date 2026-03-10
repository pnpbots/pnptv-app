'use strict';

/**
 * plan-builder.test.js
 *
 * Tests for planBuilderController:
 *   - createPlan: validation, SKU generation, lifetime, member-only, collision handling
 *   - updatePlan: 404, SKU regen on add_ons change
 *   - deactivatePlan: soft-deactivate, 404 path
 *   - listPlans: returns plans with add-on mappings
 *   - SKU format verification as a standalone unit
 *
 * Run with: jest apps/backend/tests/plan-builder.test.js
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Jest resolves all relative require() paths to absolute paths before matching
// against mocks. So jest.mock('../config/postgres') in this test file intercepts
// the controller's own require('../../../config/postgres') because both resolve
// to the same absolute path: apps/backend/config/postgres.js.

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
}));

const mockCacheDel = jest.fn().mockResolvedValue(true);
jest.mock('../config/redis', () => ({
  cache: { del: (...a) => mockCacheDel(...a) },
  getRedis: () => ({}),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

const planBuilderController = require('../bot/api/controllers/planBuilderController');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal Express-like res mock with chainable status/json */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;   return this; },
  };
  return res;
}

/** Minimal req with body, params, query and a session */
function makeReq({ body = {}, params = {}, query = {} } = {}) {
  return {
    body,
    params,
    query,
    session: { user: { id: 'admin-1' } },
  };
}

/** A minimal add-on row that represents 30-day pnp-member */
const MEMBER_30 = { add_on_id: 'pnp-member', duration_days: 30, is_lifetime: false };
/** A minimal add-on row for 7-day prime */
const PRIME_7   = { add_on_id: 'prime',      duration_days: 7,  is_lifetime: false };
/** Lifetime add-ons */
const MEMBER_LT = { add_on_id: 'pnp-member', duration_days: null, is_lifetime: true };
const PRIME_LT  = { add_on_id: 'prime',      duration_days: null, is_lifetime: true };

/** Stub a created plan row returned by the final SELECT after INSERT */
const STUB_PLAN_ROW = {
  id: 'test-plan-30d',
  sku: 'PNP-030',
  name: 'Test Plan',
  display_name: 'Test Plan',
  tier: 'member',
  price: '15.00',
  currency: 'USD',
  duration_days: 30,
  is_lifetime: false,
  active: true,
  add_ons: [],
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
  mockCacheDel.mockClear();
});

// ── createPlan ────────────────────────────────────────────────────────────────

describe('planBuilderController.createPlan', () => {

  /**
   * Happy-path helper: sets up query mocks for:
   *   1. uniqueness check (no collision)
   *   2. INSERT INTO plans
   *   3. INSERT INTO plan_add_ons (one per add-on)
   *   4. Final SELECT returning stub plan row
   */
  function mockHappyPath(addOnCount = 1) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // uniqueness check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT plans

    for (let i = 0; i < addOnCount; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT plan_add_ons
    }

    mockQuery.mockResolvedValueOnce({ rows: [STUB_PLAN_ROW] }); // final SELECT
  }

  it('creates a plan and returns correct SKU for member + prime (PNP-030-P-007)', async () => {
    mockHappyPath(2);

    const req = makeReq({
      body: {
        name:     'March Deal',
        price:    15,
        add_ons:  [MEMBER_30, PRIME_7],
      },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._body.success).toBe(true);
    expect(res._status).toBe(201);

    // Verify the SKU inserted into plans
    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO plans')
    );
    expect(insertCall).toBeDefined();
    const sku = insertCall[1][1]; // second param after planId
    expect(sku).toBe('PNP-030-P-007');
  });

  it('returns 400 when name is missing', async () => {
    const req = makeReq({ body: { price: 15, add_ons: [MEMBER_30] } });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/name is required/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when name is an empty string', async () => {
    const req = makeReq({ body: { name: '   ', price: 15, add_ons: [MEMBER_30] } });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/name is required/i);
  });

  it('returns 400 when add_ons is an empty array', async () => {
    const req = makeReq({ body: { name: 'Test', price: 15, add_ons: [] } });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/add_ons must be a non-empty array/i);
  });

  it('returns 400 when add_ons contains an invalid add_on_id', async () => {
    const req = makeReq({
      body: {
        name:    'Bad Plan',
        price:   10,
        add_ons: [{ add_on_id: 'nonexistent-addon', duration_days: 30, is_lifetime: false }],
      },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/invalid add_on_id/i);
  });

  it('returns 400 when price is negative', async () => {
    const req = makeReq({ body: { name: 'Free?', price: -5, add_ons: [MEMBER_30] } });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/price must be a positive number/i);
  });

  it('returns 400 when price is zero', async () => {
    const req = makeReq({ body: { name: 'Zero', price: 0, add_ons: [MEMBER_30] } });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/price must be a positive number/i);
  });

  it('generates a lifetime SKU (PNP-000-P-000) for lifetime member + prime', async () => {
    mockHappyPath(2);

    const req = makeReq({
      body: {
        name:        'Lifetime Bundle',
        price:       199,
        is_lifetime: true,
        add_ons:     [MEMBER_LT, PRIME_LT],
      },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._body.success).toBe(true);

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO plans')
    );
    const sku = insertCall[1][1];
    expect(sku).toBe('PNP-000-P-000');
  });

  it('generates a member-only SKU (PNP-030) when no prime add-on is present', async () => {
    mockHappyPath(1);

    const req = makeReq({
      body: {
        name:    'Member Only',
        price:   9,
        add_ons: [MEMBER_30],
      },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._body.success).toBe(true);

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO plans')
    );
    const sku = insertCall[1][1];
    expect(sku).toBe('PNP-030');
  });

  it('handles SKU collision by appending a base36 timestamp suffix', async () => {
    // First uniqueness check returns an existing plan (collision!)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'member-only-30d' }] }) // collision
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // INSERT plans
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })              // INSERT plan_add_ons
      .mockResolvedValueOnce({ rows: [STUB_PLAN_ROW] });             // final SELECT

    const req = makeReq({
      body: { name: 'Member Only', price: 9, add_ons: [MEMBER_30] },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    expect(res._body.success).toBe(true);

    // The plan ID passed to INSERT should end with a base36 timestamp suffix
    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO plans')
    );
    const insertedPlanId = insertCall[1][0];
    // Should be something like "member-only-30d-lxyz123"
    expect(insertedPlanId).toMatch(/^member-only-30d-[0-9a-z]+$/);
  });

  it('invalidates plans cache after successful creation', async () => {
    mockHappyPath(1);

    const req = makeReq({
      body: { name: 'Cache Test', price: 10, add_ons: [MEMBER_30] },
    });
    const res = makeRes();

    await planBuilderController.createPlan(req, res);

    const delKeys = mockCacheDel.mock.calls.map(([k]) => k);
    expect(delKeys).toContain('plans:all');
  });
});

// ── updatePlan ────────────────────────────────────────────────────────────────

describe('planBuilderController.updatePlan', () => {

  it('returns 404 when the plan does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // plan not found

    const req = makeReq({ params: { id: 'ghost-plan' }, body: { price: 20 } });
    const res = makeRes();

    await planBuilderController.updatePlan(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/plan not found/i);
  });

  it('re-generates SKU when add_ons are provided in the update body', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'my-plan' }] })  // existence check
      .mockResolvedValueOnce({ rows: [{                       // current plan fetch
        id: 'my-plan', name: 'Old Plan', price: '10.00',
        tier: 'member', duration_days: 30, duration: 30,
      }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // DELETE plan_add_ons
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })        // INSERT plan_add_ons
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });       // UPDATE plans

    const req = makeReq({
      params: { id: 'my-plan' },
      body:   {
        add_ons: [MEMBER_30, PRIME_7],
      },
    });
    const res = makeRes();

    await planBuilderController.updatePlan(req, res);

    expect(res._body.success).toBe(true);

    // Find the UPDATE plans call and verify it includes the new SKU
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('UPDATE plans SET')
    );
    expect(updateCall).toBeDefined();
    // The new SKU for member-30 + prime-7 is PNP-030-P-007
    const params = updateCall[1];
    expect(params).toContain('PNP-030-P-007');
  });

  it('updates plan price without touching add_ons or SKU when add_ons not in body', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'my-plan' }] })   // existence check
      .mockResolvedValueOnce({ rows: [{                        // current plan fetch
        id: 'my-plan', name: 'My Plan', price: '10.00',
        tier: 'member', duration_days: 30, duration: 30,
      }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });       // UPDATE plans

    const req = makeReq({
      params: { id: 'my-plan' },
      body:   { price: 25 },
    });
    const res = makeRes();

    await planBuilderController.updatePlan(req, res);

    expect(res._body.success).toBe(true);
    // DELETE plan_add_ons must NOT have been called
    const deleteCalls = mockQuery.mock.calls.filter(
      ([sql]) => sql && sql.includes('DELETE FROM plan_add_ons')
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('invalidates cache after successful update', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'my-plan' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'my-plan', name: 'My Plan', price: '10.00',
        tier: 'member', duration_days: 30, duration: 30,
      }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

    const req = makeReq({
      params: { id: 'my-plan' },
      body:   { price: 12 },
    });
    const res = makeRes();

    await planBuilderController.updatePlan(req, res);

    const delKeys = mockCacheDel.mock.calls.map(([k]) => k);
    expect(delKeys).toContain('plans:all');
    expect(delKeys).toContain('plan:my-plan');
  });
});

// ── deactivatePlan ────────────────────────────────────────────────────────────

describe('planBuilderController.deactivatePlan', () => {

  it('soft-deactivates a plan by setting active=false', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE

    const req = makeReq({ params: { id: 'week-plan' }, query: {} });
    const res = makeRes();

    await planBuilderController.deactivatePlan(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.deactivated).toBe(true);
    expect(res._body.deleted).toBe(false);

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('UPDATE plans SET active = false')
    );
    expect(updateCall).toBeDefined();
  });

  it('returns 404 when plan is not found during soft-deactivate', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE matched 0 rows

    const req = makeReq({ params: { id: 'nonexistent' }, query: {} });
    const res = makeRes();

    await planBuilderController.deactivatePlan(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/plan not found/i);
  });

  it('performs hard delete when force=true query param is set', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // DELETE

    const req = makeReq({ params: { id: 'orphan-plan' }, query: { force: 'true' } });
    const res = makeRes();

    await planBuilderController.deactivatePlan(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.deleted).toBe(true);

    const deleteCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('DELETE FROM plans')
    );
    expect(deleteCall).toBeDefined();
  });

  it('falls back to soft-deactivate when force=true but FK constraint blocks hard delete', async () => {
    const fkError = new Error('FK violation');
    fkError.code = '23503';

    mockQuery
      .mockRejectedValueOnce(fkError)                          // DELETE fails
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });       // UPDATE fallback

    const req = makeReq({ params: { id: 'referenced-plan' }, query: { force: 'true' } });
    const res = makeRes();

    await planBuilderController.deactivatePlan(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.deleted).toBe(false);
    expect(res._body.deactivated).toBe(true);
  });

  it('invalidates cache after soft-deactivate', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const req = makeReq({ params: { id: 'cached-plan' }, query: {} });
    const res = makeRes();

    await planBuilderController.deactivatePlan(req, res);

    const delKeys = mockCacheDel.mock.calls.map(([k]) => k);
    expect(delKeys).toContain('plans:all');
    expect(delKeys).toContain('plan:cached-plan');
  });
});

// ── listPlans ─────────────────────────────────────────────────────────────────

describe('planBuilderController.listPlans', () => {

  it('returns plans with add-on mappings from the DB', async () => {
    const fakePlans = [
      {
        id: 'week-pass', sku: 'PNP-007', name: 'Week Pass',
        price: '5.00', active: true,
        add_ons: [{ id: 'pnp-member', add_on_id: 'pnp-member', name: 'Platform Access', duration_days: 7, is_lifetime: false }],
      },
      {
        id: 'month-pass', sku: 'PNP-030-P-030', name: 'Month Prime',
        price: '20.00', active: true,
        add_ons: [
          { id: 'pnp-member', add_on_id: 'pnp-member', name: 'Platform Access', duration_days: 30, is_lifetime: false },
          { id: 'prime',      add_on_id: 'prime',      name: 'PRIME Content',   duration_days: 30, is_lifetime: false },
        ],
      },
    ];

    mockQuery.mockResolvedValueOnce({ rows: fakePlans });

    const req = makeReq();
    const res = makeRes();

    await planBuilderController.listPlans(req, res);

    expect(res._body.success).toBe(true);
    expect(res._body.plans).toHaveLength(2);
    expect(res._body.plans[0].sku).toBe('PNP-007');
    expect(res._body.plans[1].add_ons).toHaveLength(2);
  });

  it('returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB failure'));

    const req = makeReq();
    const res = makeRes();

    await planBuilderController.listPlans(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
  });
});

// ── SKU format unit tests (pure function coverage via createPlan integration) ──

describe('SKU format generation', () => {

  /**
   * createPlan integration allows us to verify the SKU without calling
   * generateSku directly (it's not exported).
   */
  async function getGeneratedSku(addOns) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // uniqueness check (no collision)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    for (let i = 0; i < addOns.length; i++) {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // plan_add_ons INSERT
    }

    mockQuery.mockResolvedValueOnce({ rows: [{ ...STUB_PLAN_ROW }] });

    const req = makeReq({ body: { name: 'SKU Test', price: 1, add_ons: addOns } });
    const res = makeRes();
    await planBuilderController.createPlan(req, res);

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => sql && sql.includes('INSERT INTO plans')
    );
    return insertCall ? insertCall[1][1] : null;
  }

  beforeEach(() => {
    mockQuery.mockReset();
    mockCacheDel.mockClear();
  });

  it('PNP-030-P-007: 30-day member + 7-day prime', async () => {
    const sku = await getGeneratedSku([MEMBER_30, PRIME_7]);
    expect(sku).toBe('PNP-030-P-007');
  });

  it('PNP-000-P-000: lifetime member + lifetime prime', async () => {
    const sku = await getGeneratedSku([MEMBER_LT, PRIME_LT]);
    expect(sku).toBe('PNP-000-P-000');
  });

  it('PNP-030: member-only 30-day', async () => {
    const sku = await getGeneratedSku([MEMBER_30]);
    expect(sku).toBe('PNP-030');
  });

  it('PNP-030-C-030: 30-day member + 30-day creator subscription', async () => {
    const sku = await getGeneratedSku([
      MEMBER_30,
      { add_on_id: 'creator-subscription', duration_days: 30, is_lifetime: false },
    ]);
    expect(sku).toBe('PNP-030-C-030');
  });
});
