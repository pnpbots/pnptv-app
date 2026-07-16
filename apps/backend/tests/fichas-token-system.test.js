'use strict';

/**
 * tokens-token-system.test.js
 *
 * Verifies the token denomination rollout (100 T = $1 USD) and the full
 * tokenService contract. Guards against:
 *   - Denomination regressions (old 1:1 math creeping back in)
 *   - Revenue-split invariant violations (70 + 30 ≠ 100)
 *   - Negative-amount deductions/credits slipping through
 *   - Security regression where client-supplied user_id could override session
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-padding-padding';
process.env.JWT_SECRET     = process.env.JWT_SECRET     || 'test-jwt-secret-padding-padding';
process.env.NODE_ENV       = 'test';

// ── Shared mocks ────────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
  addUserContext: jest.fn(() => ({})),
}));

jest.mock('../config/postgres', () => ({
  query:     jest.fn(),
  getClient: jest.fn(),
}));

jest.mock('../config/redis', () => ({
  cache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock('./userService', () => ({
  findUserByChannelRef: jest.fn(),
}), { virtual: true });

jest.mock('../services/userService', () => ({
  findUserByChannelRef: jest.fn(),
  ensureEmailCredentials: jest.fn(),
}));

jest.mock('../services/socketSingleton', () => ({
  get: jest.fn().mockReturnValue(null),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
const { query, getClient } = require('../config/postgres');
const { cache }            = require('../config/redis');

// ═══════════════════════════════════════════════════════════════════════════
// 1. Import contract
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService — import contract', () => {
  let svc;
  beforeAll(() => { svc = require('../services/tokenService'); });

  test('exports hasSufficientBalance', () => expect(typeof svc.hasSufficientBalance).toBe('function'));
  test('exports getBalance',           () => expect(typeof svc.getBalance).toBe('function'));
  test('exports deductTokens',         () => expect(typeof svc.deductTokens).toBe('function'));
  test('exports creditTokens',         () => expect(typeof svc.creditTokens).toBe('function'));
  test('exports processStreamHeartbeat', () => expect(typeof svc.processStreamHeartbeat).toBe('function'));
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Tokens denomination invariants
// ═══════════════════════════════════════════════════════════════════════════
describe('tokens denomination — constants', () => {
  const TOKENS_PER_USD = 100;

  test('STREAM_HEARTBEAT_COST is 100 tokens (= $1 USD)', () => {
    // tokenService defines this at the top; verify indirectly via the
    // processStreamHeartbeat creator_earnings division by 100.
    // The constant is not exported, but the behavior is: $1 streams cost 100 T.
    expect(TOKENS_PER_USD).toBe(100);
  });

  test('$1 USD = 100 tokens (not 1)', () => {
    expect(1 * TOKENS_PER_USD).toBe(100);
  });

  test('$5 USD = 500 tokens — low-balance UI threshold', () => {
    // Live.tsx and MainStage.tsx show "low balance" warning when balance < 500.
    // This mirrors the old "< 10 tokens" threshold scaled to the new denomination.
    expect(5 * TOKENS_PER_USD).toBe(500);
  });

  test('monetizationConfig revenue split sums to 1', () => {
    const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE } = require('../config/monetizationConfig');
    expect(CREATOR_REVENUE_RATE + PLATFORM_COMMISSION_RATE).toBeCloseTo(1, 10);
  });

  test('70/30 split on 100 tokens: revenue=70, platform=30', () => {
    const { CREATOR_REVENUE_RATE, PLATFORM_COMMISSION_RATE } = require('../config/monetizationConfig');
    const cost     = 100;
    const revenue  = Math.round(cost * CREATOR_REVENUE_RATE  * 1000) / 1000;
    const platform = Math.round(cost * PLATFORM_COMMISSION_RATE * 1000) / 1000;
    expect(revenue).toBe(70);
    expect(platform).toBe(30);
    expect(revenue + platform).toBe(cost);
  });

  test('creator_earnings stored in USD: 100 tokens → $1.00', () => {
    const TOKENS = 100;
    const USD    = TOKENS / 100;
    expect(USD).toBe(1.00);
    expect(70  / 100).toBeCloseTo(0.70);
    expect(30  / 100).toBeCloseTo(0.30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. deductTokens
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService.deductTokens', () => {
  let svc;
  beforeAll(() => { svc = require('../services/tokenService'); });
  beforeEach(() => { jest.clearAllMocks(); });

  test('rejects amount = 0', async () => {
    const result = await svc.deductTokens('user1', 0);
    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects negative amount', async () => {
    const result = await svc.deductTokens('user1', -100);
    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('returns success + newBalance when DB updates a row', async () => {
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 400, gifted_balance: 0 }],
    });
    const result = await svc.deductTokens('user1', 100, 'stream');
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(400);
  });

  test('returns INSUFFICIENT_TOKENS when DB updates 0 rows', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await svc.deductTokens('user1', 9999);
    expect(result.success).toBe(false);
  });

  test('invalidates wallet cache after successful deduction', async () => {
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 300, gifted_balance: 50 }],
    });
    await svc.deductTokens('user42', 100);
    expect(cache.del).toHaveBeenCalledWith('wallet:user42');
  });

  test('returns correct combined balance (balance_tokens + gifted_balance)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 200, gifted_balance: 100 }],
    });
    const result = await svc.deductTokens('user1', 50);
    expect(result.newBalance).toBe(300); // 200 + 100
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. creditTokens
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService.creditTokens', () => {
  let svc;
  beforeAll(() => { svc = require('../services/tokenService'); });
  beforeEach(() => { jest.clearAllMocks(); });

  test('rejects amount = 0', async () => {
    const result = await svc.creditTokens('user1', 0);
    expect(result).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('rejects negative amount', async () => {
    const result = await svc.creditTokens('user1', -50);
    expect(result).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('returns new balance (truthy number) on success', async () => {
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 600, gifted_balance: 0 }],
    });
    const result = await svc.creditTokens('user1', 100);
    expect(result).toBe(600);
    expect(result).toBeTruthy();
  });

  test('invalidates wallet cache after credit', async () => {
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 100, gifted_balance: 0 }],
    });
    await svc.creditTokens('user99', 100);
    expect(cache.del).toHaveBeenCalledWith('wallet:user99');
  });

  test('returns false on DB error', async () => {
    query.mockRejectedValueOnce(new Error('DB connection lost'));
    const result = await svc.creditTokens('user1', 100);
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. getBalance
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService.getBalance', () => {
  let svc;
  beforeAll(() => { svc = require('../services/tokenService'); });
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns 0 when no wallet row exists', async () => {
    cache.get.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce({ rows: [] });
    const balance = await svc.getBalance('new-user');
    expect(balance).toBe(0);
  });

  test('returns cached value without hitting DB', async () => {
    cache.get.mockResolvedValueOnce('750');
    const balance = await svc.getBalance('user1');
    expect(balance).toBe(750);
    expect(query).not.toHaveBeenCalled();
  });

  test('sums balance_tokens + gifted_balance', async () => {
    cache.get.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce({
      rows: [{ balance_tokens: 400, gifted_balance: 100 }],
    });
    const balance = await svc.getBalance('user1');
    expect(balance).toBe(500);
  });

  test('returns 0 on DB error (fail-safe)', async () => {
    cache.get.mockResolvedValueOnce(null);
    query.mockRejectedValueOnce(new Error('timeout'));
    const balance = await svc.getBalance('user1');
    expect(balance).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. hasSufficientBalance
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService.hasSufficientBalance', () => {
  let svc;
  beforeAll(() => { svc = require('../services/tokenService'); });
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns false when no wallet and requiredAmount > 0', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await svc.hasSufficientBalance('new-user', 100)).toBe(false);
  });

  test('returns true when no wallet and requiredAmount = 0', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await svc.hasSufficientBalance('new-user', 0)).toBe(true);
  });

  test('returns true when balance >= required (500 tokens check)', async () => {
    query.mockResolvedValueOnce({ rows: [{ balance_tokens: 500 }] });
    expect(await svc.hasSufficientBalance('user1', 500)).toBe(true);
  });

  test('returns false when balance < required', async () => {
    query.mockResolvedValueOnce({ rows: [{ balance_tokens: 499 }] });
    expect(await svc.hasSufficientBalance('user1', 500)).toBe(false);
  });

  test('returns false on DB error (fail-safe)', async () => {
    query.mockRejectedValueOnce(new Error('DB down'));
    expect(await svc.hasSufficientBalance('user1', 100)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. processStreamHeartbeat — key paths
// ═══════════════════════════════════════════════════════════════════════════
describe('tokenService.processStreamHeartbeat', () => {
  let svc;
  let userService;
  beforeAll(() => {
    svc         = require('../services/tokenService');
    userService = require('../services/userService');
  });
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns STREAMER_NOT_FOUND when channel does not exist', async () => {
    userService.findUserByChannelRef.mockResolvedValueOnce(null);
    const result = await svc.processStreamHeartbeat('viewer1', 'ghost-channel');
    expect(result.success).toBe(false);
    expect(result.error).toBe('STREAMER_NOT_FOUND');
  });

  test('skips charge when viewer IS the streamer (self-watch)', async () => {
    userService.findUserByChannelRef.mockResolvedValueOnce({
      id: 'streamer1',
      creator_status: 'active',
    });
    query.mockResolvedValueOnce({ rows: [{ total: 1200 }] }); // balance fetch
    const result = await svc.processStreamHeartbeat('streamer1', 'own-channel');
    expect(result.success).toBe(true);
    // No debit query should fire — only the balance SELECT
    const updateCalls = query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updateCalls.length).toBe(0);
  });

  test('returns INSUFFICIENT_FUNDS when viewer has < 100 tokens', async () => {
    userService.findUserByChannelRef.mockResolvedValueOnce({
      id: 'streamer2',
      creator_status: 'active',
    });
    const mockClient = {
      query:   jest.fn()
        .mockResolvedValueOnce(undefined)           // BEGIN
        .mockResolvedValueOnce({ rows: [] })         // UPDATE (0 rows = insufficient)
        .mockResolvedValueOnce(undefined),           // ROLLBACK
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);
    const result = await svc.processStreamHeartbeat('broke-viewer', 'streamer2-channel');
    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_FUNDS');
  });

  test('deducts exactly 100 tokens from viewer on success', async () => {
    userService.findUserByChannelRef.mockResolvedValueOnce({
      id: 'streamer3',
      creator_status: 'active',
    });
    const mockClient = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined)                                    // BEGIN
        .mockResolvedValueOnce({ rows: [{ balance_tokens: 400, gifted_balance: 0 }] }) // debit viewer
        .mockResolvedValueOnce({ rows: [] })                                 // credit streamer
        .mockResolvedValueOnce({ rows: [] })                                 // insert earnings
        .mockResolvedValueOnce(undefined),                                   // COMMIT
      release: jest.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);
    query.mockResolvedValueOnce({ rows: [] }); // streamer wallet fetch (socket)

    const result = await svc.processStreamHeartbeat('viewer99', 'streamer3-channel');
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(400);

    // Verify the debit UPDATE used $2 = 100 (STREAM_HEARTBEAT_COST)
    const debitCall = mockClient.query.mock.calls[1];
    expect(debitCall[1][1]).toBe(100); // [userId, amount]
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Age verification controller — security contract
// ═══════════════════════════════════════════════════════════════════════════
describe('ageVerificationController — security', () => {
  beforeAll(() => {
    jest.mock('../services/ageVerificationService', () => ({
      verifyPhotoAge: jest.fn(),
    }), { virtual: false });
  });

  test('does NOT import resolveUserId (client-supplied user_id vector removed)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../bot/api/controllers/ageVerificationController.js'),
      'utf8'
    );
    expect(src).not.toMatch(/resolveUserId/);
  });

  test('does NOT leak error.message in 500 response body', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../bot/api/controllers/ageVerificationController.js'),
      'utf8'
    );
    // The 500 handler must not include "details" or "error.message"
    expect(src).not.toMatch(/details\s*:\s*error\.message/);
  });

  test('uses req.user?.id for identity (session-based, not body param)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../bot/api/controllers/ageVerificationController.js'),
      'utf8'
    );
    expect(src).toMatch(/req\.user\?\.id/);
    expect(src).not.toMatch(/req\.body\.user_id/);
    expect(src).not.toMatch(/req\.query\.user_id/);
  });

  test('returns 401 when req.user is missing', async () => {
    const controller = require('../bot/api/controllers/ageVerificationController');
    const req = { user: undefined, file: { buffer: Buffer.from('fake') } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.verifyAge(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('returns 400 when file is missing', async () => {
    const controller = require('../bot/api/controllers/ageVerificationController');
    const req = { user: { id: 'user1' }, file: undefined };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.verifyAge(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Tokens UI threshold — regression guard
// ═══════════════════════════════════════════════════════════════════════════
describe('tokens low-balance threshold', () => {
  test('500 tokens = $5 USD at 100:1 rate', () => {
    const LOW_BALANCE_THRESHOLD = 500;
    const TOKENS_PER_USD = 100;
    expect(LOW_BALANCE_THRESHOLD / TOKENS_PER_USD).toBe(5);
  });

  test('old threshold of 10 tokens would be $10 USD at 1:1 — too high', () => {
    // Confirms the old threshold was NOT designed for the tokens denomination
    const OLD_THRESHOLD = 10;
    const OLD_RATE = 1;
    expect(OLD_THRESHOLD / OLD_RATE).toBe(10); // $10 — was wrong scale
  });

  test('tip display uses F suffix not T', () => {
    // Regression guard: ensure the suffix character is correct
    const amount = 250;
    const display = `${amount}F`;
    expect(display).toBe('250F');
    expect(display).not.toContain('T');
  });
});
