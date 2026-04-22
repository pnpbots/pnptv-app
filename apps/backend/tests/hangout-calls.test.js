'use strict';

process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'test-livekit-api-key';
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'test-livekit-api-secret-min-32-chars-long-xx';

const mockQuery = jest.fn();
const mockGenerateToken = jest.fn(async () => 'test-livekit-token');
const mockReceiverReceive = jest.fn();

jest.mock('../config/postgres', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  getPool: jest.fn(() => ({ query: mockQuery })),
}));

jest.mock('../config/redis', () => ({
  getRedis: jest.fn(() => ({
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
  })),
  cache: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => {}),
  },
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  stream: { write: jest.fn() },
}));

jest.mock('../services/socketSingleton', () => ({
  get: jest.fn(() => null),
}));

jest.mock('../services/livekitService', () => ({
  LIVEKIT_WS_URL: 'wss://livekit.test',
  generateToken: mockGenerateToken,
}));

jest.mock('../services/userService', () => ({}));
jest.mock('../models/videoCallModel', () => ({}));
jest.mock('../services/notificationEmitter', () => ({}));
jest.mock('../services/accessService', () => ({ hasAccess: jest.fn(async () => true) }));
jest.mock('../models/blockedUser', () => ({}));
jest.mock('../../workers/mainStageMediaBroadcaster', () => ({}), { virtual: true });
jest.mock('sharp', () => jest.fn(() => ({ resize: jest.fn(), toBuffer: jest.fn() })));
jest.mock('../services/paymentService', () => ({
  normalizeEpaycoTransactionState: jest.fn((state) => state),
  normalizeEpaycoCurrencyCode: jest.fn((currency) => currency),
}));
jest.mock('../services/paymentSecurityService', () => ({}));
jest.mock('../models/paymentWebhookEventModel', () => ({}));
jest.mock('../validation/schemas/payment.schema', () => ({
  schemas: {
    epaycoWebhook: {
      validate: jest.fn(() => ({ error: null })),
    },
  },
}));
jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({
    receive: mockReceiverReceive,
  })),
}));

const hangoutGroupController = require('../bot/api/controllers/hangoutGroupController');
const webhookController = require('../bot/api/controllers/webhookController');

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('hangout call backend regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('startCall preserves moderator grants when owner joins an already-active call', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ensureMainGroupMembership
      .mockResolvedValueOnce({ rows: [] }) // ensureLanguageGroupMembership select
      .mockResolvedValueOnce({ rows: [{}] }) // isMember
      .mockResolvedValueOnce({ rows: [{ id: 7, is_paid: false, price_usd: 0 }] }) // group
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // rooms-per-day bypass
      .mockResolvedValueOnce({ rows: [] }) // expire stale calls
      .mockResolvedValueOnce({
        rows: [{
          id: 'call-1',
          room_name: 'hangout-7',
          creator_id: 'creator-1',
          creator_role: 'member',
          creator_tier: 'prime',
        }],
      }) // active call
      .mockResolvedValueOnce({ rows: [] }) // already active participant
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // capacity
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // owner/mod join
      .mockResolvedValueOnce({ rows: [] }); // insert participant

    const req = {
      params: { id: '7' },
      session: { user: { id: '42', role: 'member', tier: 'member', language: 'en', firstName: 'Owner', username: 'owner42' } },
    };
    const res = createRes();

    await hangoutGroupController.startCall(req, res);

    expect(mockGenerateToken).toHaveBeenCalledWith(
      'hangout-7',
      '42',
      'Owner',
      true,
      { ttlSeconds: 4 * 3600 }
    );
    expect(res.body).toEqual({
      token: 'test-livekit-token',
      livekitUrl: 'wss://livekit.test',
      roomName: 'hangout-7',
    });
  });

  test('startCall preserves moderator grants on concurrent-start fallback', async () => {
    const uniqueViolation = new Error('duplicate key');
    uniqueViolation.code = '23505';

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ensureMainGroupMembership
      .mockResolvedValueOnce({ rows: [] }) // ensureLanguageGroupMembership select
      .mockResolvedValueOnce({ rows: [{}] }) // isMember
      .mockResolvedValueOnce({ rows: [{ id: 7, is_paid: false, price_usd: 0 }] }) // group
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // rooms-per-day bypass
      .mockResolvedValueOnce({ rows: [] }) // expire stale calls
      .mockResolvedValueOnce({ rows: [] }) // no active call
      .mockRejectedValueOnce(uniqueViolation) // insert new call races
      .mockResolvedValueOnce({ rows: [{ id: 'call-2', room_name: 'hangout-7' }] }) // race winner
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }] }) // owner/mod join
      .mockResolvedValueOnce({ rows: [] }); // insert participant

    const req = {
      params: { id: '7' },
      session: { user: { id: '42', role: 'member', tier: 'member', language: 'en', firstName: 'Owner', username: 'owner42' } },
    };
    const res = createRes();

    await hangoutGroupController.startCall(req, res);

    expect(mockGenerateToken).toHaveBeenCalledWith(
      'hangout-7',
      '42',
      'Owner',
      true,
      { ttlSeconds: 4 * 3600 }
    );
    expect(res.body).toEqual({
      token: 'test-livekit-token',
      livekitUrl: 'wss://livekit.test',
      roomName: 'hangout-7',
    });
  });

  test('LiveKit participant transport events do not mutate participant_count directly', async () => {
    mockReceiverReceive.mockResolvedValue({
      event: 'participant_joined',
      room: { name: 'hangout-7' },
    });

    const req = {
      body: Buffer.from('{}'),
      headers: { authorization: 'Bearer test' },
    };
    const res = createRes();

    await webhookController.handleLiveKitWebhook(req, res);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
  });

  test('LiveKit room_finished still ends the active hangout call', async () => {
    mockReceiverReceive.mockResolvedValue({
      event: 'room_finished',
      room: { name: 'hangout-7' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = {
      body: Buffer.from('{}'),
      headers: { authorization: 'Bearer test' },
    };
    const res = createRes();

    await webhookController.handleLiveKitWebhook(req, res);

    expect(mockQuery).toHaveBeenCalledWith(
      `UPDATE hangout_video_calls
           SET status = 'ended', ended_at = NOW(), participant_count = 0
           WHERE group_id = $1 AND status = 'active'`,
      ['7']
    );
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
  });
});
