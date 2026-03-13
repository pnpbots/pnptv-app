const { query } = require('../../config/postgres');
const { cache, getRedis } = require('../../config/redis');
const logger = require('../../utils/logger');
const NotificationEmitter = require('../../bot/services/notificationEmitter');

/**
 * Notifications Controller — reads from the unified `notifications` table.
 */

const VALID_CATEGORIES = new Set(['social', 'messaging', 'hangouts', 'commerce', 'system', 'announcements']);

// ─── Notification Preferences ─────────────────────────────────────────────────

const ALLOWED_PREF_KEYS = new Set([
  'likes', 'follows', 'replies', 'dms',
  'group_messages', 'group_joins', 'wof',
  'payments', 'announcements', 'hangout_calls',
  'quiet_hours',
]);

const CHANNEL_KEYS = ['inApp', 'bot', 'email', 'push'];
const unreadCountDefaults = { social: 0, messaging: 0, hangouts: 0, commerce: 0, system: 0, total: 0 };

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Canonical defaults — used when a row has no preferences yet, when back-filling
 * newly added keys, or as the "true" target when upgrading old boolean values.
 */
const DEFAULT_PREFS = {
  likes:          { inApp: true,  bot: true,  email: true,  push: true  },
  follows:        { inApp: true,  bot: true,  email: true,  push: true  },
  replies:        { inApp: true,  bot: true,  email: true,  push: true  },
  dms:            { inApp: true,  bot: false, email: false, push: true  },
  group_messages: { inApp: true,  bot: false, email: false, push: true  },
  group_joins:    { inApp: true,  bot: false, email: false, push: false },
  wof:            { inApp: true,  bot: true,  email: true,  push: true  },
  payments:       { inApp: true,  bot: true,  email: true,  push: true  },
  announcements:  { inApp: true,  bot: true,  email: true,  push: true  },
  hangout_calls:  { inApp: true,  bot: true,  email: false, push: true  },
  quiet_hours:    { enabled: false, start: '23:00', end: '08:00' },
};

/**
 * Returns true if the stored prefs object is in the old boolean format,
 * i.e. any non-quiet_hours key holds a primitive instead of an object.
 */
function isLegacyBooleanFormat(prefs) {
  for (const key of ALLOWED_PREF_KEYS) {
    if (key === 'quiet_hours') continue;
    if (key in prefs && typeof prefs[key] !== 'object') return true;
  }
  return false;
}

/**
 * Upgrade a legacy boolean-format prefs object to the new per-channel format.
 *   boolean true  → per-key default object (preserves intended channel defaults)
 *   boolean false → all-channels-off object
 * Keys already in object format are merged with their default (fills channel gaps).
 */
function upgradeLegacyPrefs(prefs) {
  const upgraded = {};
  for (const key of ALLOWED_PREF_KEYS) {
    if (key === 'quiet_hours') {
      const qh = prefs[key];
      if (qh && typeof qh === 'object') {
        upgraded.quiet_hours = {
          enabled: typeof qh.enabled === 'boolean' ? qh.enabled : false,
          start:   HH_MM_RE.test(qh.start) ? qh.start : '23:00',
          end:     HH_MM_RE.test(qh.end)   ? qh.end   : '08:00',
        };
      } else {
        upgraded.quiet_hours = { ...DEFAULT_PREFS.quiet_hours };
      }
      continue;
    }
    if (!(key in prefs)) {
      upgraded[key] = { ...DEFAULT_PREFS[key] };
    } else if (typeof prefs[key] === 'boolean') {
      upgraded[key] = prefs[key] === true
        ? { ...DEFAULT_PREFS[key] }
        : { inApp: false, bot: false, email: false, push: false };
    } else if (typeof prefs[key] === 'object' && prefs[key] !== null) {
      // Already an object — merge with default to fill any missing channel keys
      upgraded[key] = { ...DEFAULT_PREFS[key], ...prefs[key] };
    } else {
      upgraded[key] = { ...DEFAULT_PREFS[key] };
    }
  }
  return upgraded;
}

/**
 * Validate a partial preferences update payload.
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validatePrefsUpdate(body) {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PREF_KEYS.has(key)) {
      return { valid: false, error: `Unknown preference key: "${key}"` };
    }
    if (key === 'quiet_hours') {
      const qh = body[key];
      if (typeof qh !== 'object' || qh === null || Array.isArray(qh)) {
        return { valid: false, error: 'quiet_hours must be an object' };
      }
      if ('enabled' in qh && typeof qh.enabled !== 'boolean') {
        return { valid: false, error: 'quiet_hours.enabled must be a boolean' };
      }
      if ('start' in qh && !HH_MM_RE.test(qh.start)) {
        return { valid: false, error: 'quiet_hours.start must be HH:MM (24-hour)' };
      }
      if ('end' in qh && !HH_MM_RE.test(qh.end)) {
        return { valid: false, error: 'quiet_hours.end must be HH:MM (24-hour)' };
      }
      continue;
    }
    const channelUpdate = body[key];
    if (typeof channelUpdate !== 'object' || channelUpdate === null || Array.isArray(channelUpdate)) {
      return { valid: false, error: `"${key}" must be an object with channel flags` };
    }
    for (const channel of Object.keys(channelUpdate)) {
      if (!CHANNEL_KEYS.includes(channel)) {
        return { valid: false, error: `Unknown channel "${channel}" in "${key}"` };
      }
      if (typeof channelUpdate[channel] !== 'boolean') {
        return { valid: false, error: `"${key}.${channel}" must be a boolean` };
      }
    }
  }
  return { valid: true };
}

// TTL for the unread counts cache (seconds)
const UNREAD_COUNT_TTL = 300; // 5 minutes

/**
 * Build the Redis key for a user's cached unread notification counts.
 * NOTE: ioredis applies the global keyPrefix ('pnptv:') automatically.
 */
function unreadCacheKey(userId) {
  return `notif:unread:${userId}`;
}

/**
 * GET /api/webapp/notifications?limit=50&offset=0&category=social
 */
async function getNotifications(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const rawCategory = req.query.category || null;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? rawCategory : null;

    const params = [userId, limit, offset];
    let categoryFilter = '';
    if (category) {
      categoryFilter = 'AND n.category = $4';
      params.push(category);
    }

    const { rows } = await query(
      `SELECT n.id, n.type, n.category, n.priority,
              n.actor_id, n.target_user_id, n.entity_type, n.entity_id,
              n.message, n.metadata, n.is_read, n.created_at,
              u.username AS actor_username,
              u.first_name AS actor_first_name,
              u.photo_file_id AS actor_photo_url
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.id
       LEFT JOIN blocked_users bk
         ON (bk.user_id = $1 AND bk.blocked_user_id = n.actor_id)
         OR (bk.user_id = n.actor_id AND bk.blocked_user_id = $1)
       WHERE n.target_user_id = $1
         AND bk.id IS NULL
         ${categoryFilter}
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    const countParams = [userId];
    let countCategoryFilter = '';
    if (category) {
      countCategoryFilter = 'AND n.category = $2';
      countParams.push(category);
    }

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM notifications n
       LEFT JOIN blocked_users bk
         ON (bk.user_id = $1 AND bk.blocked_user_id = n.actor_id)
         OR (bk.user_id = n.actor_id AND bk.blocked_user_id = $1)
       WHERE n.target_user_id = $1
         AND bk.id IS NULL
         ${countCategoryFilter}`,
      countParams
    );

    const totalCount = countRows[0]?.total || 0;
    const unreadCounts = await getUnreadCounts(userId);

    res.json({
      success: true,
      notifications: rows.map(formatNotification),
      count: rows.length,
      totalCount,
      unreadCounts,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notifications' });
  }
}

/**
 * Internal: get unread counts grouped by category.
 * Uses Redis as a read-through cache (TTL: 5 minutes).
 */
async function getUnreadCounts(userId) {
  const cacheKey = unreadCacheKey(userId);
  const redisCache = cache || (typeof getRedis === 'function' ? getRedis() : null);

  // Check cache first
  if (redisCache && typeof redisCache.get === 'function') {
    const cached = await redisCache.get(cacheKey);
    if (cached !== null) return cached;
  }

  try {
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS count
       FROM notifications
       WHERE target_user_id = $1 AND is_read = FALSE
       GROUP BY category`,
      [userId]
    );

    const counts = { ...unreadCountDefaults };
    for (const row of rows) {
      if (counts[row.category] !== undefined) {
        counts[row.category] = row.count;
      }
      counts.total += row.count;
    }

    // Populate cache
    if (redisCache && typeof redisCache.set === 'function') {
      await redisCache.set(cacheKey, counts, UNREAD_COUNT_TTL);
    }
    return counts;
  } catch (error) {
    logger.error('Get unread counts error:', error);
    return { ...unreadCountDefaults };
  }
}

/**
 * GET /api/webapp/notifications/counts
 */
async function getNotificationCounts(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const counts = await getUnreadCounts(userId);
    res.json({ success: true, counts });
  } catch (error) {
    logger.error('Get notification counts error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notification counts' });
  }
}

/**
 * PUT /api/webapp/notifications/mark-read
 * Body: { notificationIds?: number[], category?: string, all?: boolean }
 */
async function markAsRead(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { notificationIds } = req.body;
    const rawCategory = req.body.category || null;
    const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? rawCategory : null;

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      const clampedIds = notificationIds.slice(0, 500);
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND id = ANY($2::bigint[])`,
        [userId, clampedIds]
      );
    } else if (category) {
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND category = $2 AND is_read = FALSE`,
        [userId, category]
      );
    } else {
      // Mark all as read (default, or type='all')
      await query(
        `UPDATE notifications SET is_read = TRUE
         WHERE target_user_id = $1 AND is_read = FALSE`,
        [userId]
      );
    }

    // Invalidate the unread count cache so the next poll reflects the change
    NotificationEmitter.invalidateUnreadCache(userId).catch(() => {});

    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    logger.error('Mark notifications as read error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notifications as read' });
  }
}

/**
 * GET /api/webapp/notifications/preferences
 * Returns the user's notification_preferences from the DB.
 * Auto-upgrades legacy boolean format to the new per-channel format on first read.
 */
async function getPreferences(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { rows } = await query(
      'SELECT notification_preferences FROM users WHERE id = $1',
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    let prefs = rows[0].notification_preferences || {};

    // Auto-upgrade on-read for any user still on the old boolean format.
    // We persist the result so this only fires once per user.
    if (isLegacyBooleanFormat(prefs)) {
      prefs = upgradeLegacyPrefs(prefs);
      await query(
        'UPDATE users SET notification_preferences = $1 WHERE id = $2',
        [JSON.stringify(prefs), userId]
      );
      NotificationEmitter.invalidatePrefsCache(userId).catch(() => {});
    }

    // Back-fill any keys missing from the stored object (e.g. new keys added
    // after the user record was last written) without overwriting existing choices.
    let needsBackfill = false;
    for (const key of ALLOWED_PREF_KEYS) {
      if (!(key in prefs)) {
        prefs[key] = { ...DEFAULT_PREFS[key] };
        needsBackfill = true;
      }
    }
    if (needsBackfill) {
      await query(
        'UPDATE users SET notification_preferences = $1 WHERE id = $2',
        [JSON.stringify(prefs), userId]
      );
      NotificationEmitter.invalidatePrefsCache(userId).catch(() => {});
    }

    res.json({ success: true, preferences: prefs });
  } catch (error) {
    logger.error('Get notification preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to get notification preferences' });
  }
}

/**
 * PUT /api/webapp/notifications/preferences
 * Body: partial object — only the keys/channels you want to change.
 * Deep-merges at the channel level so sending { "likes": { "bot": false } }
 * only flips the bot flag without touching inApp/email/push.
 */
async function updatePreferences(req, res) {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'Request body must be a JSON object' });
    }
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ success: false, error: 'Request body must not be empty' });
    }

    const validation = validatePrefsUpdate(body);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    // Fetch current preferences, upgrading from legacy format if necessary
    const { rows } = await query(
      'SELECT notification_preferences FROM users WHERE id = $1',
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    let current = rows[0].notification_preferences || {};
    if (isLegacyBooleanFormat(current)) {
      current = upgradeLegacyPrefs(current);
    }

    // Ensure all canonical keys are present before merging
    for (const key of ALLOWED_PREF_KEYS) {
      if (!(key in current)) {
        current[key] = { ...DEFAULT_PREFS[key] };
      }
    }

    // Deep-merge: channel-level keys are merged individually so callers only
    // need to send the fields they want to change.
    for (const key of Object.keys(body)) {
      if (key === 'quiet_hours') {
        current.quiet_hours = { ...current.quiet_hours, ...body.quiet_hours };
      } else {
        current[key] = { ...current[key], ...body[key] };
      }
    }

    const { rows: updated } = await query(
      `UPDATE users
       SET notification_preferences = $1::jsonb
       WHERE id = $2
       RETURNING notification_preferences`,
      [JSON.stringify(current), userId]
    );

    // Bust the NotificationEmitter Redis prefs cache so the next delivery
    // attempt reads the fresh preferences from the DB.
    await NotificationEmitter.invalidatePrefsCache(userId);

    res.json({ success: true, preferences: updated[0].notification_preferences });
  } catch (error) {
    logger.error('Update notification preferences error:', error);
    res.status(500).json({ success: false, error: 'Failed to update notification preferences' });
  }
}

function formatNotification(row) {
  const meta = row.metadata || {};
  const actorPhotoUrl = typeof row.actor_photo_url === 'string'
    && (row.actor_photo_url.startsWith('/') || /^https?:\/\//i.test(row.actor_photo_url))
    ? row.actor_photo_url
    : null;
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    priority: row.priority,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorFirstName: row.actor_first_name,
    actorPhotoUrl,
    entityType: row.entity_type,
    entityId: row.entity_id,
    message: row.message,
    metadata: row.metadata,
    postId: meta.postId ?? meta.post_id ?? null,
    groupId: meta.groupId ?? meta.group_id ?? null,
    groupName: meta.groupName ?? meta.group_name ?? null,
    content: meta.content ?? null,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

module.exports = {
  getNotifications,
  getNotificationCounts,
  markAsRead,
  getUnreadCounts,
  getPreferences,
  updatePreferences,
};
