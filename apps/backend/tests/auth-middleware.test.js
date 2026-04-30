'use strict';

/**
 * auth-middleware.test.js
 *
 * Regression tests for:
 *   - authGuard.js      — session presence guard
 *   - roleGuard.js      — role-based access control
 *   - auth.js           — dual-mode auth (session OR JWT Bearer)
 *
 * Run with: jest apps/backend/tests/auth-middleware.test.js
 *
 * Mocks: Redis (Map-based in-memory stub), pg query mock.
 * No real DB or Redis connections are made.
 */

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

// ── Canonical mock block (matches existing test files) ────────────────────────

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
    _store: store,
    _reset: () => store.clear(),
  };
  return { getRedis: () => redis };
});

const mockQuery = jest.fn();
jest.mock('../config/postgres', () => ({
  query: mockQuery,
  getPool: () => ({ query: mockQuery }),
}));

jest.mock('../services/platformBanService', () => ({
  isBanned: jest.fn(async () => false),
}));

jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockResolveEffectiveRole = jest.fn(async ({ dbRole }) => dbRole || 'user');
jest.mock('../services/authentikService', () => ({
  resolveEffectiveRole: mockResolveEffectiveRole,
}));

// ── Constants ──────────────────────────────────────────────────────────────────

// auth.js uses this value when NODE_ENV === 'test' and no JWT_SECRET env var is set.
const TEST_JWT_SECRET = 'test-jwt-secret';

const USER_ID   = 'user-uuid-alice';
const USER_ID_B = 'user-uuid-bob';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app that injects a session and mounts a single route.
 * sessionData === null → req.session is undefined (simulates no session at all).
 */
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

function configureSecurityMocks(sessionData) {
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('SELECT is_active, is_deleted FROM users')) {
      return { rows: [{ is_active: true, is_deleted: false }] };
    }
    if (sql.includes('SELECT role, pnptv_id FROM users')) {
      return {
        rows: [{
          role: sessionData?.user?.role ?? 'user',
          pnptv_id: sessionData?.user?.pnptvId ?? sessionData?.user?.pnptv_id ?? null,
        }],
      };
    }
    if (sql.includes('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT role FROM users')) {
      return { rows: [{ role: sessionData?.user?.role ?? 'user' }] };
    }
    return { rows: [] };
  });
}

/** Make a minimal valid session object. */
function makeSession(userId, role = 'user', tier = 'prime') {
  return {
    user: {
      id:        userId,
      username:  'testuser',
      firstName: 'Test',
      tier,
      role,
    },
  };
}

/** Sign a JWT with the test secret and optional custom claims. */
function signToken(claims, secret = TEST_JWT_SECRET, options = {}) {
  return jwt.sign(claims, secret, { expiresIn: '1h', ...options });
}

// ── Load modules AFTER mocks are registered ────────────────────────────────────

let authGuard;
let roleGuard;
let authenticateUser;

beforeAll(() => {
  authGuard = require('../bot/api/middleware/authGuard');
  roleGuard = require('../bot/api/middleware/roleGuard');
  ({ authenticateUser } = require('../bot/api/middleware/auth'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockResolveEffectiveRole.mockReset();
  mockResolveEffectiveRole.mockImplementation(async ({ dbRole }) => dbRole || 'user');
  const logger = require('../utils/logger');
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
  logger.debug.mockClear();
  const { getRedis } = require('../config/redis');
  getRedis()._reset();
});

// =============================================================================
// SECTION 1: authGuard
// =============================================================================

describe('authGuard', () => {
  function buildGuardApp(sessionData) {
    configureSecurityMocks(sessionData);
    return buildApp(sessionData, (app) => {
      app.get('/protected', authGuard, (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
  }

  it('returns 401 when session is entirely absent (req.session undefined)', async () => {
    const app = buildGuardApp(null);
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when session exists but has no user property', async () => {
    const app = buildGuardApp({});
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when session.user is null', async () => {
    const app = buildGuardApp({ user: null });
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('passes through and calls next() when session.user is present', async () => {
    const app = buildGuardApp(makeSession(USER_ID));
    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('attaches session user to req.user on success', async () => {
    const app = buildGuardApp(makeSession(USER_ID));
    const res = await request(app).get('/protected');
    expect(res.body.userId).toBe(USER_ID);
  });

  it('logs a warning on unauthorized access attempt', async () => {
    const logger = require('../utils/logger');
    const app = buildGuardApp({});
    await request(app).get('/protected');
    expect(logger.warn).toHaveBeenCalledWith(
      'Unauthorized access attempt',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('does not call next() when session is missing (no double-response)', async () => {
    const nextSpy = jest.fn();
    const req = { session: undefined, path: '/protected', method: 'GET', ip: '127.0.0.1' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    authGuard(req, res, nextSpy);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(nextSpy).not.toHaveBeenCalled();
  });

  it('SECURITY: does not trust a user object injected via body instead of session', async () => {
    const app = buildApp({}, (app) => {
      app.post('/protected', authGuard, (req, res) => {
        res.json({ success: true });
      });
    });
    const res = await request(app)
      .post('/protected')
      .send({ user: { id: 'attacker', role: 'admin' } });
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// SECTION 2: roleGuard
// =============================================================================

describe('roleGuard', () => {
  function buildRoleApp(sessionData, ...allowedRoles) {
    configureSecurityMocks(sessionData);
    return buildApp(sessionData, (app) => {
      app.get('/admin', roleGuard(...allowedRoles), (req, res) => {
        res.json({ success: true });
      });
    });
  }

  it('returns 401 when session is absent', async () => {
    const app = buildRoleApp({}, 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when session exists but has no user', async () => {
    const app = buildRoleApp({ user: null }, 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user role is not in the allowed list', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'user'), 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 for a different non-matching role', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'creator'), 'admin', 'superadmin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(403);
  });

  it('passes through for an allowed single role', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'admin'), 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
  });

  it('passes through when user role matches one of multiple allowed roles', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'superadmin'), 'admin', 'superadmin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
  });

  it('passes through for each role in a multi-role allowlist independently', async () => {
    const allowedRoles = ['admin', 'superadmin', 'moderator'];
    for (const role of allowedRoles) {
      const app = buildRoleApp(makeSession(USER_ID, role), ...allowedRoles);
      const res = await request(app).get('/admin');
      expect(res.status).toBe(200);
    }
  });

  it('403 message includes the required roles', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'user'), 'admin', 'superadmin');
    const res = await request(app).get('/admin');
    expect(res.body.error.message).toContain('admin');
    expect(res.body.error.message).toContain('superadmin');
  });

  it('SECURITY: role comparison is case-sensitive — "Admin" does not match "admin"', async () => {
    const app = buildRoleApp(makeSession(USER_ID, 'Admin'), 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(403);
  });

  it('SECURITY: undefined role does not accidentally match any allowlist entry', async () => {
    const sess = { user: { id: USER_ID /* no role property */ } };
    const app = buildRoleApp(sess, 'admin');
    const res = await request(app).get('/admin');
    expect(res.status).toBe(403);
  });

  it('logs a warning on forbidden access with the user ID and required roles', async () => {
    const logger = require('../utils/logger');
    const app = buildRoleApp(makeSession(USER_ID, 'user'), 'admin');
    await request(app).get('/admin');
    expect(logger.warn).toHaveBeenCalledWith(
      'Forbidden access attempt',
      expect.objectContaining({
        userId:        USER_ID,
        requiredRoles: ['admin'],
        userRole:      'user',
      })
    );
  });

  it('demotes DB-backed admin access when Authentik no longer grants admin', async () => {
    mockResolveEffectiveRole.mockResolvedValueOnce('user');
    const app = buildRoleApp({
      user: {
        id: USER_ID,
        role: 'admin',
        pnptvId: 'authentik-sub-1',
      },
    }, 'admin', 'superadmin');

    const res = await request(app).get('/admin');

    expect(res.status).toBe(403);
    expect(mockResolveEffectiveRole).toHaveBeenCalledWith({
      authentikSub: 'authentik-sub-1',
      dbRole: 'admin',
    });
    expect(mockQuery).toHaveBeenCalledWith(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
      ['user', USER_ID]
    );
  });
});

// =============================================================================
// SECTION 3: authenticateUser
// =============================================================================

describe('authenticateUser — session path', () => {
  function buildAuthApp(sessionData) {
    return buildApp(sessionData, (app) => {
      app.get('/me', authenticateUser, (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
  }

  it('passes through with valid session — no Authorization header needed', async () => {
    const app = buildAuthApp(makeSession(USER_ID));
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('attaches req.user.id and req.user.userId from session', async () => {
    const app = buildAuthApp(makeSession(USER_ID));
    const res = await request(app).get('/me');
    expect(res.body.userId).toBe(USER_ID);
  });

  it('session auth takes precedence over Authorization header', async () => {
    const app = buildApp(makeSession(USER_ID), (app) => {
      app.get('/me', authenticateUser, (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
    const token = signToken({ userId: USER_ID_B });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });
});

describe('authenticateUser — JWT Bearer path', () => {
  function buildAuthApp() {
    return buildApp({}, (app) => {
      app.get('/me', authenticateUser, (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
  }

  it('returns 401 when Authorization header is absent entirely', async () => {
    const app = buildAuthApp();
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header does not start with "Bearer "', async () => {
    const app = buildAuthApp();
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed JWT', async () => {
    const app = buildAuthApp();
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer this.is.notvalid');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_TOKEN');
  });

  it('returns 401 with TOKEN_EXPIRED for an expired JWT', async () => {
    const app = buildAuthApp();
    const expiredToken = signToken({ userId: USER_ID }, TEST_JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for a JWT signed with a wrong secret', async () => {
    const app = buildAuthApp();
    const wrongToken = signToken({ userId: USER_ID }, 'wrong-secret-entirely');
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${wrongToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_TOKEN');
  });

  it('passes when userId claim is in token.userId', async () => {
    const app = buildAuthApp();
    const token = signToken({ userId: USER_ID });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('passes when userId comes from token.sub', async () => {
    const app = buildAuthApp();
    const token = signToken({ sub: USER_ID });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('passes when userId comes from token.id', async () => {
    const app = buildAuthApp();
    const token = signToken({ id: USER_ID });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('token.userId takes precedence over token.sub and token.id', async () => {
    const app = buildAuthApp();
    const token = signToken({ userId: USER_ID, sub: USER_ID_B, id: 'should-not-be-used' });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('returns 401 when token has no recognized userId claim', async () => {
    const app = buildAuthApp();
    const token = signToken({ email: 'user@example.com', someOtherField: 'x' });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(res.body.message).toContain('Invalid token format');
  });

  it('req.user has both .id and .userId set to the same value', async () => {
    const app = buildApp({}, (app) => {
      app.get('/me', authenticateUser, (req, res) => {
        res.json({ id: req.user.id, userId: req.user.userId });
      });
    });
    const token = signToken({ userId: USER_ID });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.id).toBe(USER_ID);
    expect(res.body.userId).toBe(USER_ID);
    expect(res.body.id).toBe(res.body.userId);
  });
});

describe('authenticateUser — JWT_SECRET not configured', () => {
  it('returns 500 when JWT_SECRET is not set and there is no session', async () => {
    const savedNodeEnv       = process.env.NODE_ENV;
    const savedJwtSecret     = process.env.JWT_SECRET;
    const savedSessionSecret = process.env.SESSION_SECRET;

    let localAuthenticateUser;

    jest.isolateModules(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      delete process.env.SESSION_SECRET;

      jest.mock('../utils/logger', () => ({
        info:  jest.fn(),
        warn:  jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }));

      ({ authenticateUser: localAuthenticateUser } = require('../bot/api/middleware/auth'));
    });

    process.env.NODE_ENV = savedNodeEnv;
    if (savedJwtSecret     !== undefined) process.env.JWT_SECRET      = savedJwtSecret;
    if (savedSessionSecret !== undefined) process.env.SESSION_SECRET   = savedSessionSecret;

    const app = buildApp({}, (app) => {
      app.get('/me', localAuthenticateUser, (req, res) => {
        res.json({ success: true });
      });
    });

    const res = await request(app).get('/me');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('AUTH_CONFIG_ERROR');
  });

  it('does NOT return 500 when session is valid even if JWT_SECRET is missing', async () => {
    const app = buildApp(makeSession(USER_ID), (app) => {
      app.get('/me', authenticateUser, (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });
});

// =============================================================================
// SECTION 4: authGuard + roleGuard composition
// =============================================================================

describe('authGuard + roleGuard in series', () => {
  function buildComposedApp(sessionData, ...allowedRoles) {
    configureSecurityMocks(sessionData);
    return buildApp(sessionData, (app) => {
      app.get('/admin-only', authGuard, roleGuard(...allowedRoles), (req, res) => {
        res.json({ success: true, userId: req.user.id });
      });
    });
  }

  it('returns 401 from authGuard before roleGuard is even evaluated', async () => {
    const logger = require('../utils/logger');
    const app = buildComposedApp({}, 'admin');
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
    const warnCalls = logger.warn.mock.calls;
    const roleWarnCalled = warnCalls.some((args) =>
      args[0] === 'Forbidden access attempt'
    );
    expect(roleWarnCalled).toBe(false);
  });

  it('returns 403 from roleGuard when user is authenticated but wrong role', async () => {
    const app = buildComposedApp(makeSession(USER_ID, 'user'), 'admin');
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(403);
  });

  it('passes when user is authenticated and has the required role', async () => {
    const app = buildComposedApp(makeSession(USER_ID, 'admin'), 'admin');
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });
});

// =============================================================================
// SECTION 5: Middleware resilience — Redis-independent
// =============================================================================

describe('Auth middleware resilience when Redis throws', () => {
  it('authGuard operates correctly when Redis throws on get', async () => {
    const { getRedis } = require('../config/redis');
    getRedis().get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    configureSecurityMocks(makeSession(USER_ID));
    const app = buildApp(makeSession(USER_ID), (app) => {
      app.get('/protected', authGuard, (req, res) => res.json({ success: true }));
    });
    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
  });

  it('authenticateUser operates correctly when Redis throws', async () => {
    const { getRedis } = require('../config/redis');
    getRedis().get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const token = signToken({ userId: USER_ID });
    const app = buildApp({}, (app) => {
      app.get('/me', authenticateUser, (req, res) => res.json({ success: true }));
    });
    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
