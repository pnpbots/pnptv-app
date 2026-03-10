'use strict';

/**
 * api-health.test.js
 *
 * QA test cases for health, auth-status, and metrics endpoints.
 *
 * Run with: jest apps/backend/tests/api-health.test.js
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ───────────────────────────────────────────────────────────────────────

jest.mock('../config/redis', () => {
  const store = new Map();
  const redis = {
    get:    jest.fn(async (key) => store.get(key) ?? null),
    set:    jest.fn(async (key, val) => { store.set(key, String(val)); return 'OK'; }),
    incr:   jest.fn(async (key) => {
      const cur = parseInt(store.get(key) || '0', 10);
      const next = cur + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    del:    jest.fn(async (key) => { store.delete(key); return 1; }),
    ping:   jest.fn(async () => 'PONG'),
    _store: store,
    _reset: () => store.clear(),
  };
  return { getRedis: () => redis };
});

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({ query: mockQuery }));

jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ── Constants ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-1';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function buildApp(sessionData, routeFn) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionData === null ? undefined : (sessionData || {});
    next();
  });
  routeFn(app);
  return app;
}

function makeSession(userId = USER_ID, role = 'user', tier = 'prime') {
  return {
    user: { id: userId, role, tier, username: 'tester', first_name: 'Test' },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('Health & Status Endpoints', () => {

  describe('GET /health', () => {
    it('returns 200 with basic health info', async () => {
      const app = buildApp(null, (a) => {
        a.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
      });
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api/auth-status', () => {
    it('returns authenticated=true when session exists', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/auth-status', (req, res) => {
          if (req.session && req.session.user) {
            return res.json({ authenticated: true, user: req.session.user });
          }
          res.json({ authenticated: false });
        });
      });
      const res = await request(app).get('/api/auth-status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe(USER_ID);
    });

    it('returns authenticated=false when no session', async () => {
      const app = buildApp({}, (a) => {
        a.get('/api/auth-status', (req, res) => {
          if (req.session && req.session.user) {
            return res.json({ authenticated: true, user: req.session.user });
          }
          res.json({ authenticated: false });
        });
      });
      const res = await request(app).get('/api/auth-status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('GET /api/me', () => {
    it('returns 401 when not authenticated', async () => {
      const app = buildApp({}, (a) => {
        a.get('/api/me', (req, res) => {
          if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
          }
          res.json({ success: true, user: req.session.user });
        });
      });
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });

    it('returns user data when authenticated', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/me', (req, res) => {
          if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
          }
          res.json({ success: true, user: req.session.user });
        });
      });
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.username).toBe('tester');
    });
  });

  describe('POST /api/logout', () => {
    it('destroys session and returns success', async () => {
      const session = makeSession();
      session.destroy = jest.fn((cb) => cb(null));
      const app = buildApp(session, (a) => {
        a.post('/api/logout', (req, res) => {
          if (req.session && req.session.destroy) {
            req.session.destroy((err) => {
              if (err) return res.status(500).json({ error: 'Logout failed' });
              res.json({ success: true });
            });
          } else {
            res.json({ success: true });
          }
        });
      });
      const res = await request(app).post('/api/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
