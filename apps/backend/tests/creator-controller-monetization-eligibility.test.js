'use strict';

const mockQuery = jest.fn();

jest.mock('../config/postgres', () => ({
  query: (...args) => mockQuery(...args),
  getPool: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../services/creatorService', () => ({}));
jest.mock('../services/identityVerificationService', () => ({}));
jest.mock('../services/notificationEmitter', () => ({}));
jest.mock('../services/accessService', () => ({ hasAccess: jest.fn() }));
jest.mock('../bot/utils/helpers', () => ({ resolveUserId: jest.fn() }));
jest.mock('../services/xAutoCampaignService', () => ({}));
jest.mock('../services/contentModerationFilter', () => ({
  assertCleanText: jest.fn(),
}));
jest.mock('../bot/api/controllers/cmsCreatorController', () => ({
  uploadBufferToCreatorFolder: jest.fn(),
  uploadStreamToCreatorFolder: jest.fn(),
}));

const ctrl = require('../bot/api/controllers/creatorController');

function makeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

function makeReq({ body = {}, params = {} } = {}) {
  return {
    body,
    params,
    user: { id: 'creator-1' },
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('creatorController monetization eligibility', () => {
  it('blocks unpausing creator profile memberships before 5 eligible videos', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ creator_status: 'active', creator_subscription_paused: true }] })
      .mockResolvedValueOnce({ rows: [{ eligible_count: 4 }] });

    const res = makeRes();
    await ctrl.toggleSubscription(makeReq(), res);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CREATOR_MONETIZATION_CONTENT_REQUIRED');
    expect(res._body.eligibleVideoCount).toBe(4);
    expect(res._body.requiredVideoCount).toBe(5);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('allows pausing creator profile memberships without checking video count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ creator_status: 'active', creator_subscription_paused: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await ctrl.toggleSubscription(makeReq(), res);

    expect(res._status).toBeNull();
    expect(res._body).toEqual({ success: true, subscriptionPaused: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE users SET creator_subscription_paused/);
  });

  it('allows unpausing creator profile memberships after 5 eligible videos', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ creator_status: 'active', creator_subscription_paused: true }] })
      .mockResolvedValueOnce({ rows: [{ eligible_count: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await ctrl.toggleSubscription(makeReq(), res);

    expect(res._status).toBeNull();
    expect(res._body).toEqual({ success: true, subscriptionPaused: false });
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('blocks creating a paid channel before 5 eligible videos', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ creator_status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ eligible_count: 4 }] });

    const res = makeRes();
    await ctrl.createChannel(makeReq({
      body: {
        name: 'Premium Room',
        accessType: 'paid',
        priceUsd: 9.99,
      },
    }), res);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CREATOR_MONETIZATION_CONTENT_REQUIRED');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('blocks changing a free channel to paid before 5 eligible videos', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 12,
          creator_id: 'creator-1',
          access_type: 'free',
          price_usd: '0.00',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ eligible_count: 4 }] });

    const res = makeRes();
    await ctrl.updateChannel(makeReq({
      params: { id: '12' },
      body: {
        accessType: 'paid',
        priceUsd: 12,
      },
    }), res);

    expect(res._status).toBe(403);
    expect(res._body.code).toBe('CREATOR_MONETIZATION_CONTENT_REQUIRED');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
