'use strict';

const { query } = require('../config/postgres');

/**
 * Discover Service
 * Tag-based + full-text discovery across members, creators, channels, videos, and hangouts.
 */

/**
 * Returns the tag taxonomy grouped by group_name, sorted by sort_order.
 * Shape: { [group_name]: [{ name, emoji }] }
 */
async function getTagTaxonomy() {
  const res = await query(
    `SELECT name, emoji, group_name
       FROM tag_taxonomy
      WHERE is_active = TRUE
      ORDER BY group_name, sort_order`
  );

  const groups = {};
  for (const row of res.rows) {
    if (!groups[row.group_name]) groups[row.group_name] = [];
    groups[row.group_name].push({ name: row.name, emoji: row.emoji });
  }
  return groups;
}

/**
 * Discover entities by tags and/or free-text query.
 *
 * @param {string[]} tags      - Tag names to match (OR logic via && operator)
 * @param {string}   textQuery - Optional ILIKE search string
 * @param {string}   entity    - 'all' | 'members' | 'creators' | 'channels' | 'videos' | 'hangouts'
 * @param {number}   page      - 1-based page number
 * @param {number}   limit     - Results per entity (max 24)
 * @returns {object} Keys matching requested entities, each an array of rows
 */
async function discoverByTags(tags = [], textQuery = '', entity = 'all', page = 1, limit = 12) {
  const hasTags = Array.isArray(tags) && tags.length > 0;
  const hasText = typeof textQuery === 'string' && textQuery.trim().length > 0;

  // Nothing to search — return empty result sets for requested entities
  if (!hasTags && !hasText) {
    return buildEmptyResult(entity);
  }

  const offset = (page - 1) * limit;
  const likePattern = hasText ? `%${textQuery.replace(/[%_\\]/g, '\\$&')}%` : null;

  const queries = {};

  const shouldQuery = (name) => entity === 'all' || entity === name;

  // --- members ---
  if (shouldQuery('members')) {
    queries.members = queryMembers(hasTags, tags, hasText, likePattern, limit, offset);
  }

  // --- creators ---
  if (shouldQuery('creators')) {
    queries.creators = queryCreators(hasTags, tags, hasText, likePattern, limit, offset);
  }

  // --- channels ---
  if (shouldQuery('channels')) {
    queries.channels = queryChannels(hasTags, tags, hasText, likePattern, limit, offset);
  }

  // --- videos ---
  if (shouldQuery('videos')) {
    queries.videos = queryVideos(hasTags, tags, hasText, likePattern, limit, offset);
  }

  // --- hangouts ---
  if (shouldQuery('hangouts')) {
    queries.hangouts = queryHangouts(hasTags, tags, hasText, likePattern, limit, offset);
  }

  // Execute all sub-queries in parallel
  const keys = Object.keys(queries);
  const results = await Promise.all(keys.map((k) => queries[k]));

  const output = {};
  keys.forEach((k, i) => {
    output[k] = results[i].rows;
  });

  return output;
}

// ---------------------------------------------------------------------------
// Sub-query builders — each returns a pg query promise
// ---------------------------------------------------------------------------

function queryMembers(hasTags, tags, hasText, likePattern, limit, offset) {
  const conditions = ['u.is_deleted = FALSE'];
  const params = [];
  let idx = 1;

  if (hasTags) {
    params.push(tags);
    conditions.push(`u.interests && $${idx++}::text[]`);
  }

  if (hasText) {
    params.push(likePattern, likePattern, likePattern);
    conditions.push(
      `(u.username ILIKE $${idx} OR u.first_name ILIKE $${idx + 1} OR u.last_name ILIKE $${idx + 2})`
    );
    idx += 3;
  }

  params.push(limit, offset);

  return query(
    `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, u.pnptv_id
       FROM users u
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.username
      LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
}

function queryCreators(hasTags, tags, hasText, likePattern, limit, offset) {
  const conditions = ["u.role IN ('creator', 'model') AND u.is_deleted = FALSE"];
  const params = [];
  let idx = 1;

  if (hasTags) {
    params.push(tags);
    conditions.push(`cc.tags && $${idx++}::text[]`);
  }

  if (hasText) {
    params.push(likePattern, likePattern, likePattern);
    conditions.push(
      `(u.username ILIKE $${idx} OR u.first_name ILIKE $${idx + 1} OR u.last_name ILIKE $${idx + 2})`
    );
    idx += 3;
  }

  params.push(limit, offset);

  return query(
    `SELECT DISTINCT ON (u.id)
            u.id, u.id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.username) AS display_name,
            u.username, u.photo_file_id AS photo_url,
            NULL AS category, FALSE AS verified
       FROM users u
       LEFT JOIN creator_channels cc ON cc.creator_id = u.id::text
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.id, u.username
      LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
}

function queryChannels(hasTags, tags, hasText, likePattern, limit, offset) {
  const conditions = ['cc.is_active = TRUE'];
  const params = [];
  let idx = 1;

  if (hasTags) {
    params.push(tags);
    conditions.push(`cc.tags && $${idx++}::text[]`);
  }

  if (hasText) {
    params.push(likePattern, likePattern);
    conditions.push(
      `(cc.name ILIKE $${idx} OR cc.description ILIKE $${idx + 1})`
    );
    idx += 2;
  }

  params.push(limit, offset);

  return query(
    `SELECT cc.id, cc.name, cc.description, cc.cover_image_url,
            cc.tags, cc.access_type, cc.price_usd, cc.creator_id
       FROM creator_channels cc
      WHERE ${conditions.join(' AND ')}
      ORDER BY cc.name
      LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
}

function queryVideos(hasTags, tags, hasText, likePattern, limit, offset) {
  const conditions = ["cv.status = 'ready'"];
  const params = [];
  let idx = 1;

  if (hasTags) {
    params.push(tags);
    conditions.push(`cv.tags && $${idx++}::text[]`);
  }

  if (hasText) {
    params.push(likePattern);
    conditions.push(`cv.title ILIKE $${idx++}`);
  }

  params.push(limit, offset);

  return query(
    `SELECT cv.id, cv.title, cv.thumbnail_url, cv.tags,
            cv.channel_id, cc.name AS channel_name
       FROM channel_videos cv
       JOIN creator_channels cc ON cc.id = cv.channel_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY cv.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
}

function queryHangouts(hasTags, tags, hasText, likePattern, limit, offset) {
  const conditions = ['hg.is_public = TRUE AND hg.is_main = FALSE AND hg.is_wall_of_fame = FALSE'];
  const params = [];
  let idx = 1;

  if (hasTags) {
    params.push(tags);
    conditions.push(`hg.tags && $${idx++}::text[]`);
  }

  if (hasText) {
    params.push(likePattern, likePattern);
    conditions.push(
      `(hg.name ILIKE $${idx} OR hg.description ILIKE $${idx + 1})`
    );
    idx += 2;
  }

  params.push(limit, offset);

  return query(
    `SELECT hg.id, hg.name, hg.avatar_url, hg.tags, hg.description
       FROM hangout_groups hg
      WHERE ${conditions.join(' AND ')}
      ORDER BY hg.name
      LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEmptyResult(entity) {
  const all = ['members', 'creators', 'channels', 'videos', 'hangouts'];
  const keys = entity === 'all' ? all : all.includes(entity) ? [entity] : all;
  return Object.fromEntries(keys.map((k) => [k, []]));
}

module.exports = { getTagTaxonomy, discoverByTags };
