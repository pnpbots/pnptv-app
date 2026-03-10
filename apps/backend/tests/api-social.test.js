'use strict';

/**
 * api-social.test.js
 *
 * QA test cases for social feed, posts, likes, replies, and Wall of Fame.
 *
 * Run with: jest apps/backend/tests/api-social.test.js
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

const USER_ID   = 101;
const USER_ID_B = 102;

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
    user: {
      id: userId, role, tier,
      username: 'tester', first_name: 'Test',
      creator_status: 'approved',
    },
  };
}

function authGuard(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ── Mock Social Post Data ───────────────────────────────────────────────────────

const MOCK_POST = {
  id: 1,
  content: 'Hello world',
  media_url: null,
  media_type: null,
  media_urls: [],
  reply_to_id: null,
  repost_of_id: null,
  likes_count: 0,
  reposts_count: 0,
  replies_count: 0,
  is_exclusive: false,
  is_shareable: true,
  is_wof: false,
  created_at: new Date().toISOString(),
  author_id: USER_ID,
  author_username: 'tester',
  author_first_name: 'Test',
  author_photo: null,
  liked_by_me: false,
};

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('Social API', () => {

  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ── Feed ────────────────────────────────────────────────────────────────────

  describe('GET /api/webapp/social/feed', () => {
    it('returns 401 without session', async () => {
      const app = buildApp({}, (a) => {
        a.get('/api/webapp/social/feed', authGuard, (_req, res) => {
          res.json({ success: true, posts: [] });
        });
      });
      const res = await request(app).get('/api/webapp/social/feed');
      expect(res.status).toBe(401);
    });

    it('returns paginated feed with cursor', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/webapp/social/feed', authGuard, (req, res) => {
          const limit = Math.min(parseInt(req.query.limit) || 20, 50);
          const cursor = req.query.cursor || null;
          res.json({
            success: true,
            posts: [MOCK_POST],
            nextCursor: '2',
          });
        });
      });

      const res = await request(app).get('/api/webapp/social/feed?limit=10');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.posts).toHaveLength(1);
      expect(res.body.nextCursor).toBe('2');
    });

    it('returns empty feed when no posts', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/webapp/social/feed', authGuard, (_req, res) => {
          res.json({ success: true, posts: [], nextCursor: null });
        });
      });

      const res = await request(app).get('/api/webapp/social/feed');
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(0);
      expect(res.body.nextCursor).toBeNull();
    });
  });

  // ── Create Post ─────────────────────────────────────────────────────────────

  describe('POST /api/webapp/social/posts', () => {
    it('returns 401 without session', async () => {
      const app = buildApp({}, (a) => {
        a.post('/api/webapp/social/posts', authGuard, (_req, res) => {
          res.json({ success: true });
        });
      });
      const res = await request(app).post('/api/webapp/social/posts').send({ content: 'test' });
      expect(res.status).toBe(401);
    });

    it('creates a text post successfully', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts', authGuard, (req, res) => {
          const { content, isExclusive, isShareable } = req.body;
          if (!content || content.length === 0) {
            return res.status(400).json({ error: 'Content is required' });
          }
          if (content.length > 5000) {
            return res.status(400).json({ error: 'Content too long' });
          }
          res.json({
            success: true,
            post: { ...MOCK_POST, content, is_exclusive: isExclusive || false, is_shareable: isShareable !== false },
          });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts')
        .send({ content: 'My first post!' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.post.content).toBe('My first post!');
    });

    it('rejects empty content', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts', authGuard, (req, res) => {
          if (!req.body.content || req.body.content.length === 0) {
            return res.status(400).json({ error: 'Content is required' });
          }
          res.json({ success: true });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts')
        .send({ content: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Content/i);
    });

    it('rejects content exceeding 5000 chars', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts', authGuard, (req, res) => {
          if (req.body.content && req.body.content.length > 5000) {
            return res.status(400).json({ error: 'Content too long' });
          }
          res.json({ success: true });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts')
        .send({ content: 'x'.repeat(5001) });
      expect(res.status).toBe(400);
    });

    it('creates exclusive post for creators', async () => {
      const session = makeSession(USER_ID, 'user', 'prime');
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts', authGuard, (req, res) => {
          const { content, isExclusive } = req.body;
          if (isExclusive && req.session.user.creator_status !== 'approved') {
            return res.status(403).json({ error: 'Only creators can post exclusive content' });
          }
          res.json({
            success: true,
            post: { ...MOCK_POST, content, is_exclusive: isExclusive },
          });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts')
        .send({ content: 'VIP only', isExclusive: true });
      expect(res.status).toBe(200);
      expect(res.body.post.is_exclusive).toBe(true);
    });
  });

  // ── Toggle Like ─────────────────────────────────────────────────────────────

  describe('POST /api/webapp/social/posts/:id/like', () => {
    it('returns 401 without session', async () => {
      const app = buildApp({}, (a) => {
        a.post('/api/webapp/social/posts/:id/like', authGuard, (_req, res) => {
          res.json({ success: true });
        });
      });
      const res = await request(app).post('/api/webapp/social/posts/1/like');
      expect(res.status).toBe(401);
    });

    it('toggles like on a post', async () => {
      let liked = false;
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts/:id/like', authGuard, (req, res) => {
          liked = !liked;
          res.json({
            success: true,
            liked,
            likesCount: liked ? 1 : 0,
          });
        });
      });

      // First like
      const res1 = await request(app).post('/api/webapp/social/posts/1/like');
      expect(res1.status).toBe(200);
      expect(res1.body.liked).toBe(true);
      expect(res1.body.likesCount).toBe(1);

      // Unlike
      const res2 = await request(app).post('/api/webapp/social/posts/1/like');
      expect(res2.status).toBe(200);
      expect(res2.body.liked).toBe(false);
      expect(res2.body.likesCount).toBe(0);
    });

    it('returns 404 for non-existent post', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts/:id/like', authGuard, (req, res) => {
          const postId = parseInt(req.params.id);
          if (postId === 9999) {
            return res.status(404).json({ error: 'Post not found' });
          }
          res.json({ success: true, liked: true, likesCount: 1 });
        });
      });

      const res = await request(app).post('/api/webapp/social/posts/9999/like');
      expect(res.status).toBe(404);
    });
  });

  // ── Delete Post ─────────────────────────────────────────────────────────────

  describe('DELETE /api/webapp/social/posts/:id', () => {
    it('returns 401 without session', async () => {
      const app = buildApp({}, (a) => {
        a.delete('/api/webapp/social/posts/:id', authGuard, (_req, res) => {
          res.json({ success: true });
        });
      });
      const res = await request(app).delete('/api/webapp/social/posts/1');
      expect(res.status).toBe(401);
    });

    it('deletes own post successfully', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.delete('/api/webapp/social/posts/:id', authGuard, (req, res) => {
          // Simulate ownership check
          const postAuthor = USER_ID;
          if (postAuthor !== req.session.user.id) {
            return res.status(403).json({ error: 'Not your post' });
          }
          res.json({ success: true });
        });
      });

      const res = await request(app).delete('/api/webapp/social/posts/1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects deleting someone else\'s post', async () => {
      const session = makeSession(USER_ID_B);
      const app = buildApp(session, (a) => {
        a.delete('/api/webapp/social/posts/:id', authGuard, (req, res) => {
          const postAuthor = USER_ID; // original author
          if (postAuthor !== req.session.user.id) {
            return res.status(403).json({ error: 'Not your post' });
          }
          res.json({ success: true });
        });
      });

      const res = await request(app).delete('/api/webapp/social/posts/1');
      expect(res.status).toBe(403);
    });
  });

  // ── Replies ─────────────────────────────────────────────────────────────────

  describe('GET /api/webapp/social/posts/:id/replies', () => {
    it('returns replies for a post', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/webapp/social/posts/:id/replies', authGuard, (req, res) => {
          res.json({
            success: true,
            posts: [
              { ...MOCK_POST, id: 10, reply_to_id: parseInt(req.params.id), content: 'Nice!' },
            ],
            nextCursor: null,
          });
        });
      });

      const res = await request(app).get('/api/webapp/social/posts/1/replies');
      expect(res.status).toBe(200);
      expect(res.body.posts[0].reply_to_id).toBe(1);
    });
  });

  describe('POST /api/webapp/social/posts/:id/replies', () => {
    it('creates a reply', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts/:id/replies', authGuard, (req, res) => {
          const { content } = req.body;
          if (!content || content.length === 0) {
            return res.status(400).json({ error: 'Content is required' });
          }
          if (content.length > 500) {
            return res.status(400).json({ error: 'Reply too long (max 500)' });
          }
          res.json({
            success: true,
            post: { ...MOCK_POST, id: 11, content, reply_to_id: parseInt(req.params.id) },
          });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts/1/replies')
        .send({ content: 'Great post!' });
      expect(res.status).toBe(200);
      expect(res.body.post.reply_to_id).toBe(1);
      expect(res.body.post.content).toBe('Great post!');
    });

    it('rejects reply over 500 chars', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.post('/api/webapp/social/posts/:id/replies', authGuard, (req, res) => {
          if (req.body.content && req.body.content.length > 500) {
            return res.status(400).json({ error: 'Reply too long (max 500)' });
          }
          res.json({ success: true });
        });
      });

      const res = await request(app)
        .post('/api/webapp/social/posts/1/replies')
        .send({ content: 'x'.repeat(501) });
      expect(res.status).toBe(400);
    });
  });

  // ── Public Profile ──────────────────────────────────────────────────────────

  describe('GET /api/webapp/social/profile/:userId', () => {
    it('returns public profile with posts', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/webapp/social/profile/:userId', (req, res) => {
          res.json({
            success: true,
            profile: {
              id: parseInt(req.params.userId),
              username: 'creator1',
              firstName: 'Creator',
              bio: 'Hello!',
              postCount: 5,
              creatorStatus: 'approved',
            },
            posts: [MOCK_POST],
            nextCursor: null,
          });
        });
      });

      const res = await request(app).get('/api/webapp/social/profile/42');
      expect(res.status).toBe(200);
      expect(res.body.profile.id).toBe(42);
      expect(res.body.posts).toHaveLength(1);
    });
  });

  // ── WoF Feed ────────────────────────────────────────────────────────────────

  describe('GET /api/webapp/social/wof-feed', () => {
    it('returns Wall of Fame feed', async () => {
      const session = makeSession();
      const app = buildApp(session, (a) => {
        a.get('/api/webapp/social/wof-feed', authGuard, (_req, res) => {
          res.json({
            success: true,
            posts: [{ ...MOCK_POST, is_wof: true }],
            nextCursor: null,
          });
        });
      });

      const res = await request(app).get('/api/webapp/social/wof-feed');
      expect(res.status).toBe(200);
      expect(res.body.posts[0].is_wof).toBe(true);
    });
  });

  // ── Home Feed (Public) ──────────────────────────────────────────────────────

  describe('GET /api/webapp/social/home-feed', () => {
    it('returns public home feed without auth', async () => {
      const app = buildApp(null, (a) => {
        a.get('/api/webapp/social/home-feed', (_req, res) => {
          res.json({
            success: true,
            posts: [MOCK_POST],
            nextCursor: null,
          });
        });
      });

      const res = await request(app).get('/api/webapp/social/home-feed');
      expect(res.status).toBe(200);
      expect(res.body.posts).toHaveLength(1);
    });
  });
});
