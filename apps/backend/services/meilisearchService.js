'use strict';

const { query } = require('../config/postgres');
const logger = require('../utils/logger');

const MEILI_URL = process.env.MEILI_URL || 'http://meilisearch:7700';
const MEILI_MASTER_KEY = process.env.MEILISEARCH_MASTER_KEY || '';

let _client = null;

async function getClient() {
  if (!_client) {
    const { Meilisearch } = await import('meilisearch');
    _client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_MASTER_KEY });
  }
  return _client;
}

// ── Index configuration ────────────────────────────────────────────────────

const INDEX_USERS = 'users';
const INDEX_CREATORS = 'creators';
const INDEX_POSTS = 'posts';

async function ensureIndexes() {
  const client = await getClient();
  await Promise.all([
    client.index(INDEX_USERS).updateSettings({
      searchableAttributes: ['username', 'first_name', 'last_name', 'pnptv_id', 'bio'],
      displayedAttributes: ['id', 'username', 'first_name', 'last_name', 'photo_file_id', 'pnptv_id'],
      filterableAttributes: ['is_deleted'],
      sortableAttributes: ['created_at'],
    }),
    client.index(INDEX_CREATORS).updateSettings({
      searchableAttributes: ['display_name', 'username', 'bio', 'category'],
      displayedAttributes: ['id', 'user_id', 'display_name', 'username', 'photo_url', 'category', 'verified'],
      filterableAttributes: ['verified', 'active'],
      sortableAttributes: ['follower_count'],
    }),
    client.index(INDEX_POSTS).updateSettings({
      searchableAttributes: ['content', 'author_username', 'author_name'],
      displayedAttributes: ['id', 'content', 'author_id', 'author_username', 'author_name', 'author_photo', 'created_at', 'media_count'],
      filterableAttributes: ['is_deleted'],
      sortableAttributes: ['created_at'],
    }),
  ]);
}

// ── Indexing ───────────────────────────────────────────────────────────────

async function indexUsers() {
  const { rows } = await query(
    `SELECT id::text, username, first_name, last_name, photo_file_id, pnptv_id,
            bio, is_deleted, created_at
     FROM users
     WHERE is_deleted = false
     LIMIT 50000`
  );
  if (rows.length === 0) return 0;
  const client = await getClient();
  const task = await client.index(INDEX_USERS).addDocuments(rows, { primaryKey: 'id' });
  logger.info('[Meilisearch] Indexed users', { count: rows.length, taskUid: task.taskUid });
  return rows.length;
}

async function indexCreators() {
  const { rows } = await query(
    `SELECT ce.id::text, ce.user_id::text,
            COALESCE(u.first_name, u.username) AS display_name,
            u.bio, ce.tier AS category,
            (ce.status = 'approved') AS verified,
            (ce.status = 'approved') AS active,
            0 AS follower_count,
            u.username, u.photo_file_id AS photo_url
     FROM creator_enrollments ce
     JOIN users u ON u.id::text = ce.user_id
     WHERE ce.status = 'approved'
     LIMIT 10000`
  );
  if (rows.length === 0) return 0;
  const client = await getClient();
  const task = await client.index(INDEX_CREATORS).addDocuments(rows, { primaryKey: 'id' });
  logger.info('[Meilisearch] Indexed creators', { count: rows.length, taskUid: task.taskUid });
  return rows.length;
}

async function indexPosts() {
  const { rows } = await query(
    `SELECT p.id::text, p.content, p.user_id::text AS author_id,
            u.username AS author_username,
            u.first_name AS author_name,
            u.photo_file_id AS author_photo,
            p.created_at,
            CASE WHEN p.media_url IS NOT NULL THEN 1 ELSE 0 END AS media_count,
            p.is_deleted
     FROM social_posts p
     JOIN users u ON u.id::text = p.user_id
     WHERE p.is_deleted = false
       AND p.created_at > NOW() - INTERVAL '90 days'
     ORDER BY p.created_at DESC
     LIMIT 100000`
  );
  if (rows.length === 0) return 0;
  const client = await getClient();
  const task = await client.index(INDEX_POSTS).addDocuments(rows, { primaryKey: 'id' });
  logger.info('[Meilisearch] Indexed posts', { count: rows.length, taskUid: task.taskUid });
  return rows.length;
}

async function reindexAll() {
  await ensureIndexes();
  const [users, creators, posts] = await Promise.all([
    indexUsers(),
    indexCreators(),
    indexPosts(),
  ]);
  return { users, creators, posts };
}

// ── Search ─────────────────────────────────────────────────────────────────

async function search(q, { limit = 10, indexes = [INDEX_USERS, INDEX_CREATORS, INDEX_POSTS] } = {}) {
  const client = await getClient();

  const queries = indexes.map((indexUid) => ({
    indexUid,
    q,
    limit,
    filter: indexUid === INDEX_USERS ? 'is_deleted = false' : undefined,
  }));

  const { results } = await client.multiSearch({ queries });

  const out = { users: [], creators: [], posts: [] };
  for (const r of results) {
    if (r.indexUid === INDEX_USERS) out.users = r.hits;
    else if (r.indexUid === INDEX_CREATORS) out.creators = r.hits;
    else if (r.indexUid === INDEX_POSTS) out.posts = r.hits;
  }
  return out;
}

// ── Incremental updates ────────────────────────────────────────────────────

async function upsertUser(userId) {
  const { rows } = await query(
    `SELECT id::text, username, first_name, last_name, photo_file_id, pnptv_id,
            bio, is_deleted, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) return;
  const client = await getClient();
  await client.index(INDEX_USERS).addDocuments(rows, { primaryKey: 'id' });
}

async function deleteUser(userId) {
  const client = await getClient();
  await client.index(INDEX_USERS).deleteDocument(String(userId));
}

async function upsertPost(postId) {
  const { rows } = await query(
    `SELECT p.id::text, p.content, p.user_id::text AS author_id,
            u.username AS author_username,
            u.first_name AS author_name,
            u.photo_file_id AS author_photo,
            p.created_at,
            CASE WHEN p.media_url IS NOT NULL THEN 1 ELSE 0 END AS media_count,
            p.is_deleted
     FROM social_posts p JOIN users u ON u.id::text = p.user_id WHERE p.id = $1`,
    [postId]
  );
  if (rows.length === 0) return;
  const client = await getClient();
  if (rows[0].is_deleted) {
    await client.index(INDEX_POSTS).deleteDocument(String(postId));
  } else {
    await client.index(INDEX_POSTS).addDocuments(rows, { primaryKey: 'id' });
  }
}

module.exports = {
  getClient,
  ensureIndexes,
  reindexAll,
  indexUsers,
  indexCreators,
  indexPosts,
  search,
  upsertUser,
  deleteUser,
  upsertPost,
};
