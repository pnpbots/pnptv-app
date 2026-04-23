'use strict';

const { query, getClient } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const { getRedis } = require('../../../config/redis');
const socketSingleton = require('../../../services/socketSingleton');
const userService = require('../../../services/userService');
const NotificationEmitter = require('../../../services/notificationEmitter');
const { hasAccess } = require('../../../services/accessService');
// Matrix removed — no-op stub; fire-and-forget calls silently resolve
const _noop = () => Promise.resolve();
const matrixService = new Proxy({}, { get: () => _noop });
const BlockedUser = require('../../../models/blockedUser');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
// getBotInstance is lazy-required inside getVideoChatStatus to avoid circular dependency
const { invalidateLinkedCache } = require('../../core/middleware/groupSecurityEnforcement');

// In-memory cache for Telegram video chat status (30s TTL)
const _videoChatCache = new Map();
const VIDEO_CHAT_CACHE_TTL = 30 * 1000;

// Check if a photo path is a valid web URL (not a Telegram file ID)
const isValidPhotoUrl = (p) => p && typeof p === 'string' && (p.startsWith('/') || p.startsWith('http'));

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// Check if user is a non-banned member of the group
const isMember = async (groupId, userId) => {
  const { rows } = await query(
    'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned = false OR is_banned IS NULL)',
    [groupId, userId]
  );
  return rows.length > 0;
};

// Auto-join the main community group for everyone
const ensureMainGroupMembership = async (userId) => {
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     SELECT id, $1, 'member' FROM hangout_groups WHERE is_main = true
     ON CONFLICT DO NOTHING`,
    [userId]
  );
};

// Auto-join the language-specific group (EN or ES) matching the user's preferred language.
// Admins must configure groups by setting hangout_groups.language_code = 'en' or 'es'
// on the desired group via SQL or the admin UI. No group is created automatically.
// If no group with the matching language_code exists, this is a silent no-op.
const ensureLanguageGroupMembership = async (userId, languageCode) => {
  if (!languageCode) return;
  const lc = String(languageCode).toLowerCase().slice(0, 2);
  if (!['en', 'es'].includes(lc)) return;
  const { rows } = await query(
    `SELECT id FROM hangout_groups WHERE language_code = $1 ORDER BY id ASC LIMIT 1`,
    [lc]
  );
  if (rows.length === 0) return;
  await query(
    `INSERT INTO hangout_group_members (group_id, user_id, role)
     VALUES ($1, $2, 'member') ON CONFLICT (group_id, user_id) DO NOTHING`,
    [rows[0].id, userId]
  );
};

// Normalize a message row: strip invalid photo_urls, include all media fields
const normalizeMessage = (m) => ({
  ...m,
  photo_url: isValidPhotoUrl(m.photo_url) ? m.photo_url : null,
});

const buildReplyPreviewText = (row) => {
  if (!row || row.is_deleted) return '[deleted]';
  if (row.message_type === 'post_card') {
    const snap = row.meta?.snapshot || null;
    const note = typeof snap?.note === 'string' ? snap.note.trim() : '';
    const preview = typeof snap?.content === 'string' ? snap.content.trim() : '';
    if (note) return note.slice(0, 100);
    if (preview) return preview.slice(0, 100);
    if (snap?.mediaType === 'image') return '[shared photo]';
    if (snap?.mediaType === 'video') return '[shared video]';
    if (snap?.mediaType === 'audio') return '[shared audio]';
    return '[shared post]';
  }
  if (typeof row.content === 'string' && row.content.trim()) return row.content.trim().slice(0, 100);
  if (row.media_type === 'image') return '[photo]';
  if (row.media_type === 'video') return '[video]';
  if (row.media_type === 'audio') return '[voice]';
  return '[media]';
};

/**
 * Send a Cristina welcome message into the hangout chat and optionally DM the user via Telegram.
 * Fire-and-forget — never throws, never blocks the caller.
 */
async function sendHangoutWelcome(groupId, groupName, groupRules, userId, firstName) {
  try {
    const rulesBlockEn = groupRules
      ? `📋 *Group rules:*\n${groupRules}`
      : `No special rules set yet — just respect and good vibes! 🌈`;

    const welcomeText = `🧜‍♀️ *Cristina AI agent says:*\n\nWelcome to *${groupName}*, ${firstName || 'friend'}! 🎉\n\nI'm Cristina, your PNPtv AI guide. Here's what you need to know:\n\n📱 *Use the PNPtv app* for the full experience — live chat, media feed, video calls, and more. This Telegram group mirrors the conversation, but the full features are in the app.\n\n💡 *Tip:* Photos and videos shared here automatically appear in the group's media feed. Text messages stay in chat. Everything is only visible to members.\n\n${rulesBlockEn}\n\nQuestions? Say "Hey Cristina" in the app anytime.`;

    // Insert into chat_messages for the in-app chat feed
    await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, content)
       VALUES ($1, 'cristina-ai', 'cristina', 'Cristina', $2)`,
      [`hangout:${groupId}`, welcomeText]
    );

    // Emit via Socket.IO to live clients in the hangout room
    const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
    if (io) {
      io.to(`hangout:${groupId}`).emit('chat:message', {
        room: `hangout:${groupId}`,
        user_id: 'cristina-ai',
        username: 'cristina',
        first_name: 'Cristina',
        content: welcomeText,
        created_at: new Date().toISOString(),
        id: Date.now(),
      });
    }

    // DM the user on Telegram if they have a linked account (fire-and-forget)
    if (userId) {
      (async () => {
        try {
          const { rows: userRows } = await query('SELECT telegram FROM users WHERE id = $1', [userId]);
          if (userRows[0]?.telegram) {
            const { getBotInstance } = require('../../core/bot');
            const bot = getBotInstance();
            if (bot) {
              await bot.telegram.sendMessage(userRows[0].telegram, welcomeText, { parse_mode: 'Markdown' });
            }
          }
        } catch (_e) { /* silent */ }
      })();
    }
  } catch (err) {
    logger.warn('sendHangoutWelcome failed (non-critical):', err.message);
  }
}

// GET /api/webapp/hangouts/groups
// Unread counts are tracked via Redis (set by matrixMessageController + hangoutMediaController).
// Messages live in Matrix — no chat_messages dependency.
const listGroups = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    // Auto-join main group
    await ensureMainGroupMembership(user.id);
    await ensureLanguageGroupMembership(user.id, user.language);

    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.creator_id,
              g.is_main, g.is_wall_of_fame, g.is_public, g.max_members, g.created_at, g.feed_visibility,
              g.is_read_only, g.slow_mode_seconds, g.tags, g.rules,
              g.telegram_chat_id, g.telegram_invite_link, g.is_paid, g.price_usd, g.channel_id,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (
                (SELECT COUNT(*)::int FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active') > 0
              ) as has_active_call,
              (SELECT hvc.id::text FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active' ORDER BY hvc.created_at DESC LIMIT 1) as active_call_id,
              cc.access_type as channel_access_type,
              cc.price_usd as channel_price_usd,
              cc.name as channel_name
       FROM hangout_groups g
       JOIN hangout_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       LEFT JOIN creator_channels cc ON cc.id = g.channel_id
       ORDER BY g.is_main DESC, g.created_at DESC`,
      [user.id]
    );

    // Fetch unread counts from Redis using MGET (single round-trip)
    const redis = getRedis();
    const unreadKeys = rows.map(r => `hangout:unread:${r.id}:${user.id}`);
    const unreadValues = unreadKeys.length > 0
      ? await redis.mget(...unreadKeys).catch(() => unreadKeys.map(() => null))
      : [];

    // Fetch active call cache using MGET (single round-trip, 60s TTL set on startCall)
    const activeCallKeys = rows.map(r => `hangout:active_call:${r.id}`);
    const activeCallValues = activeCallKeys.length > 0
      ? await redis.mget(...activeCallKeys).catch(() => activeCallKeys.map(() => null))
      : [];

    const groups = rows.map((r, i) => {
      // Parse cached active call (if present, skip DB-computed value)
      let hasActiveCall = r.has_active_call;
      let activeCallId = r.active_call_id;
      if (activeCallValues[i]) {
        try {
          const cached = JSON.parse(activeCallValues[i]);
          hasActiveCall = true;
          activeCallId = cached.id ? String(cached.id) : activeCallId;
        } catch {
          // cache parse failure — fall back to DB-computed value
        }
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        avatarUrl: r.avatar_url,
        creatorId: r.creator_id,
        isMain: r.is_main,
        isWallOfFame: r.is_wall_of_fame,
        isPublic: r.is_public,
        maxMembers: r.max_members,
        memberCount: r.member_count,
        createdAt: r.created_at,
        hasActiveCall,
        activeCallId,
        lastMessage: null,
        unreadCount: parseInt(unreadValues[i], 10) || 0,
        feedVisibility: r.feed_visibility || 'public',
        isReadOnly: !!r.is_read_only,
        slowModeSeconds: r.slow_mode_seconds || 0,
        tags: r.tags || [],
        rules: r.rules || null,
        telegramChatId: r.telegram_chat_id || null,
        telegramInviteLink: r.telegram_invite_link || null,
        isPaid: !!r.is_paid,
        priceUsd: Number(r.price_usd) || 0,
        channelId: r.channel_id || null,
        channelAccessType: r.channel_access_type || null,
        channelPriceUsd: r.channel_price_usd != null ? Number(r.channel_price_usd) : null,
        channelName: r.channel_name || null,
      };
    });

    return res.json({ success: true, groups });
  } catch (err) {
    logger.error('listGroups error', err);
    return res.status(500).json({ error: 'Failed to load groups' });
  }
};

// POST /api/webapp/hangouts/groups
const createGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { name, description = '', isPublic = true, isPaid = false, priceUsd = 0, rules, channelId: rawChannelId } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });

  try {
    const { assertCleanText } = require('../../../services/contentModerationFilter');
    assertCleanText(name, 'name');
    assertCleanText(description, 'description');
    assertCleanText(rules, 'rules');
  } catch (err) {
    if (err.code === 'FORBIDDEN_CONTENT') {
      return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
    }
    throw err;
  }

  const sanitizedRules = rules ? String(rules).trim().slice(0, 1000) || null : null;
  const channelId = rawChannelId ? parseInt(rawChannelId, 10) : null;

  try {
    // If linking to a channel, validate it first — pricing rules come from the channel
    let linkedChannel = null;
    if (channelId && Number.isFinite(channelId)) {
      const chRes = await query(
        `SELECT id, creator_id, access_type, price_usd, is_active, hangout_group_id FROM creator_channels WHERE id = $1`,
        [channelId]
      );
      if (!chRes.rows.length || !chRes.rows[0].is_active) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      if (String(chRes.rows[0].creator_id) !== String(user.id)) {
        return res.status(403).json({ error: 'You do not own that channel' });
      }
      if (chRes.rows[0].hangout_group_id !== null) {
        return res.status(409).json({ error: 'That channel is already linked to a hangout group' });
      }
      linkedChannel = chRes.rows[0];
    }

    // Standalone hangout price validation: only free or $5 allowed
    let sanitizedPrice = 0;
    if (!linkedChannel) {
      if (isPaid) {
        const parsedPrice = Number(priceUsd) || 0;
        if (parsedPrice !== 0 && parsedPrice !== 5) {
          return res.status(400).json({ error: 'Standalone hangout price must be $0 or $5' });
        }
        sanitizedPrice = parsedPrice;
      }
    }
    // Linked hangouts inherit channel pricing — don't store redundant price
    const finalIsPaid = linkedChannel ? false : !!isPaid;
    const finalPrice = linkedChannel ? 0 : sanitizedPrice;

    // Hangout creation is open to all authenticated users
    const { rows } = await query(
      `INSERT INTO hangout_groups (name, description, creator_id, is_main, is_public, max_members, rules, is_paid, price_usd)
       VALUES ($1, $2, $3, false, $4, 200000, $5, $6, $7)
       RETURNING *`,
      [name.trim().slice(0, 100), description.trim().slice(0, 500), user.id, isPublic !== false, sanitizedRules, finalIsPaid, finalPrice]
    );

    const group = rows[0];

    // Add creator as owner
    await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [group.id, user.id]
    );

    // Link to channel if requested (update both FKs)
    if (linkedChannel) {
      await Promise.all([
        query(`UPDATE hangout_groups SET channel_id = $1 WHERE id = $2`, [channelId, group.id]),
        query(`UPDATE creator_channels SET hangout_group_id = $1 WHERE id = $2`, [group.id, channelId]),
      ]);
      group.channel_id = channelId;
    }

    // Eagerly create Matrix room so it's ready when the user opens chat
    try {
      const userRow = await query(
        `SELECT id, telegram, username, first_name, matrix_user_id, matrix_access_token
         FROM users WHERE id = $1 AND is_deleted = false`,
        [user.id]
      );
      if (userRow.rows[0]) {
        await matrixService.getOrCreateHangoutRoom(group.id, userRow.rows[0], group.name);
      }
    } catch (matrixErr) {
      logger.warn('createGroup: Matrix room creation failed (will retry on first chat open)', { groupId: group.id, error: matrixErr.message });
    }

    // Send Cristina welcome message to the creator (fire-and-forget)
    sendHangoutWelcome(group.id, group.name, group.rules, user.id, user.firstName || user.first_name || user.username);

    return res.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        avatarUrl: group.avatar_url,
        creatorId: group.creator_id,
        isMain: group.is_main,
        isPublic: group.is_public,
        maxMembers: group.max_members,
        memberCount: 1,
        createdAt: group.created_at,
        hasActiveCall: false,
        activeCallId: null,
        telegramChatId: null,
        telegramInviteLink: null,
        rules: group.rules || null,
        channelId: group.channel_id || null,
      },
    });
  } catch (err) {
    logger.error('createGroup error', err);
    return res.status(500).json({ error: 'Failed to create group' });
  }
};

// GET /api/webapp/hangouts/groups/:id
const getGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Auto-join main group if not already a member
    await ensureMainGroupMembership(user.id);
    await ensureLanguageGroupMembership(user.id, user.language);
    const { rows: groupRows } = await query(
      `SELECT g.*,
              g.slow_mode_seconds, g.is_read_only, g.allow_media, g.allow_member_invites,
              g.auto_delete_hours, g.tags, g.invite_code, g.channel_id,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (
                (SELECT COUNT(*)::int FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true) > 0
                OR
                (SELECT COUNT(*)::int FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active') > 0
              ) as has_active_call,
              COALESCE(
                (SELECT hvc.id::text FROM hangout_video_calls hvc WHERE hvc.group_id = g.id AND hvc.status = 'active' ORDER BY hvc.created_at DESC LIMIT 1),
                (SELECT v.id::text FROM video_calls v WHERE v.group_id = g.id AND v.is_active = true ORDER BY v.created_at DESC LIMIT 1)
              ) as active_call_id,
              cc.access_type as channel_access_type,
              cc.price_usd as channel_price_usd,
              cc.name as channel_name
       FROM hangout_groups g
       LEFT JOIN creator_channels cc ON cc.id = g.channel_id
       WHERE g.id = $1`,
      [groupId]
    );

    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const g = groupRows[0];
    const member = await isMember(groupId, user.id);

    // Non-members cannot view private groups
    if (!g.is_public && !member) {
      return res.status(403).json({ error: 'This group is invite-only' });
    }

    const { rows: members } = await query(
      `SELECT gm.user_id, gm.role, gm.joined_at, gm.is_muted, gm.muted_until, gm.is_banned, gm.notification_mode,
              u.username, u.first_name, u.photo_file_id as photo_url
       FROM hangout_group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.role = 'owner' DESC, gm.role = 'moderator' DESC, gm.joined_at ASC
       LIMIT 100`,
      [groupId]
    );

    return res.json({
      success: true,
      group: {
        id: g.id,
        name: g.name,
        description: g.description,
        avatarUrl: g.avatar_url,
        creatorId: g.creator_id,
        isMain: g.is_main,
        isPublic: g.is_public,
        maxMembers: g.max_members,
        memberCount: g.member_count,
        createdAt: g.created_at,
        hasActiveCall: g.has_active_call,
        activeCallId: g.active_call_id,
        slowModeSeconds: g.slow_mode_seconds,
        isReadOnly: g.is_read_only,
        allowMedia: g.allow_media,
        allowMemberInvites: g.allow_member_invites,
        autoDeleteHours: g.auto_delete_hours,
        tags: g.tags || [],
        inviteCode: g.invite_code,
        feedVisibility: g.feed_visibility || 'public',
        telegramChatId: g.telegram_chat_id || null,
        telegramInviteLink: g.telegram_invite_link || null,
        isPaid: !!g.is_paid,
        priceUsd: Number(g.price_usd) || 0,
        rules: g.rules || null,
        channelId: g.channel_id || null,
        channelAccessType: g.channel_access_type || null,
        channelPriceUsd: g.channel_price_usd != null ? Number(g.channel_price_usd) : null,
        channelName: g.channel_name || null,
      },
      members: members.map(m => ({ ...m, photo_url: isValidPhotoUrl(m.photo_url) ? m.photo_url : null })),
    });
  } catch (err) {
    logger.error('getGroup error', err);
    return res.status(500).json({ error: 'Failed to load group' });
  }
};

// POST /api/webapp/hangouts/groups/:id/join
const joinGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows } = await query(
      `SELECT g.*, cc.access_type as channel_access_type, cc.price_usd as channel_price_usd, cc.creator_id as channel_creator_id
       FROM hangout_groups g
       LEFT JOIN creator_channels cc ON cc.id = g.channel_id
       WHERE g.id = $1`,
      [groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (!rows[0].is_public) return res.status(403).json({ error: 'This group is invite-only' });

    const group = rows[0];
    const isOwner = String(group.creator_id) === String(user.id);

    // Access gate — channel-linked hangouts use channel access rules; standalone use is_paid
    if (!isOwner) {
      if (group.channel_id) {
        // Channel-linked: delegate to checkChannelAccess
        const { checkChannelAccess } = require('../../../services/accessService');
        const channelObj = {
          id: group.channel_id,
          access_type: group.channel_access_type || 'free',
          price_usd: group.channel_price_usd || 0,
          creator_id: group.channel_creator_id || group.creator_id,
        };
        const access = await checkChannelAccess(user.id, channelObj);
        if (!access.allowed) {
          return res.status(402).json({
            error: 'Access required',
            accessType: access.accessType || channelObj.access_type,
            requiresPayment: access.requiresPayment || false,
            priceUsd: access.priceUsd ?? Number(channelObj.price_usd),
            groupName: group.name,
            channelId: group.channel_id,
          });
        }
      } else if (group.is_paid && Number(group.price_usd) > 0) {
        // Standalone paid hangout — check membership (paid = already in members table)
        const { rows: existingMember } = await query(
          'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND is_banned = false',
          [groupId, user.id]
        );
        if (existingMember.length === 0) {
          return res.status(402).json({
            error: 'Payment required',
            isPaid: true,
            priceUsd: Number(group.price_usd),
            groupName: group.name,
          });
        }
      }
    }

    // Ban check
    const { rows: banCheck } = await query(
      'SELECT is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND is_banned = true',
      [groupId, user.id]
    );
    if (banCheck.length > 0) return res.status(403).json({ error: 'You are banned from this group' });

    // Block check: creator blocked joiner OR joiner blocked creator
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot join this group' });
      }
    }

    // Serialise concurrent joins with a row lock to prevent capacity overshoot
    const txClient = await getClient();
    try {
      await txClient.query('BEGIN');
      const { rows: lockedGroup } = await txClient.query(
        'SELECT id, max_members FROM hangout_groups WHERE id = $1 FOR UPDATE',
        [groupId]
      );
      if (!lockedGroup[0]) {
        await txClient.query('ROLLBACK');
        return res.status(404).json({ error: 'Group not found' });
      }
      const { rows: [{ count }] } = await txClient.query(
        'SELECT COUNT(*)::int AS count FROM hangout_group_members WHERE group_id = $1',
        [groupId]
      );
      const { rows: alreadyMember } = await txClient.query(
        'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
        [groupId, user.id]
      );
      if (alreadyMember.length === 0 && count >= lockedGroup[0].max_members) {
        await txClient.query('ROLLBACK');
        return res.status(409).json({ error: 'Group is full' });
      }
      await txClient.query(
        `INSERT INTO hangout_group_members (group_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, user.id]
      );
      await txClient.query('COMMIT');
    } catch (txErr) {
      await txClient.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Notify group creator about new member
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      NotificationEmitter.emit({
        type: 'group_join', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: group.creator_id,
        entityType: 'group', entityId: String(groupId),
        message: `${user.firstName || user.first_name || user.username} joined ${group.name}`,
        metadata: { groupName: group.name },
      });
    }

    // Send Cristina welcome message (fire-and-forget)
    {
      const { rows: wRows } = await query('SELECT name, rules FROM hangout_groups WHERE id = $1', [groupId]).catch(() => ({ rows: [] }));
      if (wRows[0]) {
        sendHangoutWelcome(groupId, wRows[0].name, wRows[0].rules || null, user.id, user.firstName || user.first_name || user.username);
      }
    }

    // Sync Matrix room membership — fire-and-forget (non-blocking, non-fatal)
    matrixService.inviteToHangoutRoom(groupId, {
      id:                  user.id,
      telegram:            user.telegram || String(user.id),
      username:            user.username || null,
      first_name:          user.firstName || user.first_name || null,
      matrix_user_id:      user.matrix_user_id      || null,
      matrix_access_token: user.matrix_access_token || null,
      matrix_device_id:    user.matrix_device_id    || null,
    }).catch((matrixErr) => {
      logger.error(`[Matrix] joinGroup sync failed for user ${user.id} / group ${groupId}`, { error: matrixErr.message, groupId, userId: user.id });
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('joinGroup error', err);
    return res.status(500).json({ error: 'Failed to join group' });
  }
};

// POST /api/webapp/hangouts/groups/:id/leave
const leaveGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Can't leave the main community group
    const { rows } = await query('SELECT is_main, is_public FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot leave the main community group' });

    await query(
      'DELETE FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id]
    );

    // Sync Matrix room membership — fire-and-forget (non-blocking, non-fatal)
    matrixService.removeFromHangoutRoom(groupId, {
      id:             user.id,
      matrix_user_id: user.matrix_user_id || null,
    }).catch((matrixErr) => {
      logger.error(`[Matrix] leaveGroup sync failed for user ${user.id} / group ${groupId}`, { error: matrixErr.message, groupId, userId: user.id });
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('leaveGroup error', err);
    return res.status(500).json({ error: 'Failed to leave group' });
  }
};

// DELETE /api/webapp/hangouts/groups/:id
const deleteGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (rows[0].is_main) return res.status(400).json({ error: 'Cannot delete the main community group' });
    if (rows[0].creator_id !== String(user.id)) {
      return res.status(403).json({ error: 'Only the creator can delete this group' });
    }

    // End active calls (both legacy and new tables)
    await query(
      `UPDATE video_calls SET is_active=false, ended_at=NOW() WHERE group_id=$1 AND is_active=true`,
      [groupId]
    );
    await query(
      `UPDATE hangout_video_calls SET status='ended', ended_at=NOW() WHERE group_id=$1 AND status='active'`,
      [groupId]
    );

    // Clean up chat messages for this group before deleting (not covered by cascade)
    await query('DELETE FROM chat_messages WHERE room = $1', [`hangout:${groupId}`]);

    // Delete group (cascade deletes members, participants, join requests)
    await query('DELETE FROM hangout_groups WHERE id=$1', [groupId]);

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteGroup error', err);
    return res.status(500).json({ error: 'Failed to delete group' });
  }
};

// PATCH /api/webapp/hangouts/groups/:id
const updateGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    if (group.is_main) return res.status(400).json({ error: 'Cannot modify the main community group' });

    // Only creator/owner can update group details
    const { rows: memberRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    if (memberRows.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
    const role = memberRows[0].role;
    if (role !== 'owner' && String(group.creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group owner can update group details' });
    }

    const { name, description, is_public, is_paid, price_usd } = req.body;

    try {
      const { assertCleanText } = require('../../../services/contentModerationFilter');
      if (name !== undefined) assertCleanText(name, 'name');
      if (description !== undefined) assertCleanText(description, 'description');
      if (req.body.rules !== undefined) assertCleanText(req.body.rules, 'rules');
    } catch (err) {
      if (err.code === 'FORBIDDEN_CONTENT') {
        return res.status(400).json({ error: err.message, code: err.code, field: err.field, categories: err.categories });
      }
      throw err;
    }

    // Build update dynamically — only touch provided fields
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Group name cannot be empty' });
      if (trimmed.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or fewer' });
      updates.push(`name = $${idx++}`);
      values.push(trimmed);
    }

    if (description !== undefined) {
      const trimmed = String(description).trim().slice(0, 500);
      updates.push(`description = $${idx++}`);
      values.push(trimmed);
    }

    if (is_public !== undefined) {
      updates.push(`is_public = $${idx++}`);
      values.push(is_public === true || is_public === 'true');
    }

    if (is_paid !== undefined) {
      updates.push(`is_paid = $${idx++}`);
      values.push(is_paid === true || is_paid === 'true');
    }

    if (price_usd !== undefined) {
      const price = Math.max(0, Math.min(9999.99, Number(price_usd) || 0));
      updates.push(`price_usd = $${idx++}`);
      values.push(price);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(groupId);

    const { rows } = await query(
      `UPDATE hangout_groups SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const g = rows[0];
    return res.json({
      success: true,
      group: {
        id: g.id,
        name: g.name,
        description: g.description,
        avatarUrl: g.avatar_url,
        creatorId: g.creator_id,
        isMain: g.is_main,
        isPublic: g.is_public,
        maxMembers: g.max_members,
        createdAt: g.created_at,
        updatedAt: g.updated_at,
        isPaid: !!g.is_paid,
        priceUsd: Number(g.price_usd) || 0,
      },
    });
  } catch (err) {
    logger.error('updateGroup error', err);
    return res.status(500).json({ error: 'Failed to update group' });
  }
};

// POST /api/webapp/hangouts/groups/:id/avatar
const updateGroupAvatar = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    if (group.is_main) return res.status(400).json({ error: 'Cannot modify the main community group' });

    // Only creator/owner can update avatar
    const { rows: memberRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    if (memberRows.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
    const role = memberRows[0].role;
    if (role !== 'owner' && String(group.creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group owner can update the group avatar' });
    }

    const filename = `group-${groupId}-${Date.now()}.webp`;
    const uploadDir = path.join(__dirname, '../../../../../public/uploads/hangouts/avatars');
    const filePath = path.join(uploadDir, filename);
    const relativeUrl = `/uploads/hangouts/avatars/${filename}`;

    await fs.mkdir(uploadDir, { recursive: true });

    // Process with sharp: resize to 400x400, convert to WebP
    await sharp(req.file.buffer)
      .resize(400, 400, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toFile(filePath);

    await query(
      'UPDATE hangout_groups SET avatar_url=$1, updated_at=NOW() WHERE id=$2',
      [relativeUrl, groupId]
    );

    return res.json({ success: true, avatarUrl: relativeUrl });
  } catch (err) {
    logger.error('updateGroupAvatar error', err);
    return res.status(500).json({ error: 'Failed to update group avatar' });
  }
};

// POST /api/webapp/hangouts/groups/:id/kick
const kickMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  const { userId: targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'userId is required' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    if (group.is_main) return res.status(400).json({ error: 'Cannot kick members from the main community group' });

    // Only creator/owner can kick
    const { rows: actorRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    if (actorRows.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
    const actorRole = actorRows[0].role;
    if (actorRole !== 'owner' && String(group.creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group owner can kick members' });
    }

    // Cannot kick yourself
    if (String(targetUserId) === String(user.id)) {
      return res.status(400).json({ error: 'You cannot kick yourself — use leave instead' });
    }

    // Confirm target is actually a member
    const { rows: targetRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, targetUserId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User is not a member of this group' });

    // Cannot kick another owner
    if (targetRows[0].role === 'owner') {
      return res.status(403).json({ error: 'Cannot kick the group owner' });
    }

    await query(
      'DELETE FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetUserId]
    );

    auditModeration(groupId, user.id, targetUserId, 'kick', req.body.reason || null, null);

    // Sync Matrix room membership — fire-and-forget (non-blocking, non-fatal)
    matrixService.removeFromHangoutRoom(groupId, {
      id: targetUserId,
      matrix_user_id: null,
    }).catch((matrixErr) => {
      logger.warn(`[Matrix] kickMember sync failed for user ${targetUserId} / group ${groupId}: ${matrixErr.message}`);
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('kickMember error', err);
    return res.status(500).json({ error: 'Failed to kick member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/members/:userId/role
const updateMemberRole = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const targetUserId = req.params.userId;
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });
  if (!targetUserId) return res.status(400).json({ error: 'Invalid target user ID' });

  const { role: newRole } = req.body;
  const ALLOWED_ROLES = ['admin', 'moderator', 'member'];
  if (!ALLOWED_ROLES.includes(newRole)) {
    return res.status(400).json({ error: `Role must be one of: ${ALLOWED_ROLES.join(', ')}` });
  }

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    // Only creator/owner can change roles
    const { rows: actorRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    if (actorRows.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
    const actorRole = actorRows[0].role;
    if (actorRole !== 'owner' && String(group.creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group owner can change member roles' });
    }

    // Cannot change your own role
    if (String(targetUserId) === String(user.id)) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    // Confirm target is a member
    const { rows: targetRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, targetUserId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User is not a member of this group' });

    // Cannot demote the owner role
    if (targetRows[0].role === 'owner') {
      return res.status(403).json({ error: 'Cannot change the role of the group owner' });
    }

    await query(
      `UPDATE hangout_group_members SET role=$1 WHERE group_id=$2 AND user_id=$3`,
      [newRole, groupId, targetUserId]
    );

    return res.json({ success: true, userId: targetUserId, role: newRole });
  } catch (err) {
    logger.error('updateMemberRole error', err);
    return res.status(500).json({ error: 'Failed to update member role' });
  }
};

// GET /api/webapp/hangouts/groups/:id/messages
// Now returns all media fields so clients can render attachments inline.
const getMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { cursor } = req.query;

  // Validate cursor format if provided
  if (cursor !== undefined && isNaN(Date.parse(cursor))) {
    return res.status(400).json({ error: 'Invalid cursor format' });
  }

  try {
    // Auto-join main group if not already a member
    await ensureMainGroupMembership(user.id);
    await ensureLanguageGroupMembership(user.id, user.language);

    // Check membership
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const room = `hangout:${groupId}`;
    const { rows } = await query(
      `SELECT cm.id, cm.room, cm.user_id, cm.username, cm.first_name,
              COALESCE(u.photo_file_id, cm.photo_url) as photo_url,
              cm.content,
              cm.media_url, cm.media_type, cm.media_mime,
              cm.media_thumb_url, cm.media_width, cm.media_height,
              cm.media_metadata, cm.reply_to_id,
              r.first_name AS reply_name, r.username AS reply_username, r.content AS reply_content,
              r.media_type AS reply_media_type, r.message_type AS reply_message_type, r.meta AS reply_meta,
              cm.created_at, cm.edited_at, cm.edit_count, cm.is_pinned,
              rxn.reactions
       FROM chat_messages cm
       LEFT JOIN users u ON u.id = cm.user_id
       LEFT JOIN chat_messages r ON r.id = cm.reply_to_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'emoji', sub.emoji,
           'count', sub.cnt,
           'users', sub.users
         )) AS reactions
         FROM (
           SELECT emoji, COUNT(*)::int AS cnt, array_agg(cr.user_id) AS users
           FROM chat_message_reactions cr
           WHERE cr.message_id = cm.id
           GROUP BY emoji
         ) sub
       ) rxn ON true
       WHERE cm.room=$1 AND cm.is_deleted=false
         ${cursor ? 'AND cm.created_at < $2' : ''}
       ORDER BY cm.created_at DESC LIMIT 50`,
      cursor ? [room, cursor] : [room]
    );

    const currentUserId = String(user.id);

    // Attach reply_to object, reacted_by_me flag, and clean up helper columns
    for (const msg of rows) {
      if (msg.reply_to_id && (msg.reply_name || msg.reply_username)) {
        msg.reply_to = {
          name: msg.reply_name || msg.reply_username || 'User',
          content: buildReplyPreviewText({
            content: msg.reply_content,
            media_type: msg.reply_media_type,
            message_type: msg.reply_message_type,
            meta: msg.reply_meta,
          }),
        };
      }
      delete msg.reply_name; delete msg.reply_username; delete msg.reply_content;
      delete msg.reply_media_type; delete msg.reply_message_type; delete msg.reply_meta;

      if (Array.isArray(msg.reactions)) {
        msg.reactions = msg.reactions.map((r) => ({
          emoji: r.emoji,
          count: r.count,
          users: Array.isArray(r.users) ? r.users.map(String) : [],
          reacted_by_me: Array.isArray(r.users) && r.users.map(String).includes(currentUserId),
        }));
      } else {
        msg.reactions = [];
      }
    }

    return res.json({ success: true, messages: rows.reverse().map(normalizeMessage) });
  } catch (err) {
    logger.error('getMessages error', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
};

// POST /api/webapp/hangouts/groups/:id/messages
// Sends a text-only message. For media, use sendMediaMessage below.
const sendMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { content, replyToId } = req.body;
  const parsedReplyToId = replyToId ? parseInt(replyToId, 10) : null;

  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

  try {
    // Auto-join main group if not already a member
    await ensureMainGroupMembership(user.id);
    await ensureLanguageGroupMembership(user.id, user.language);

    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Enforce read-only, mute, and slow mode
    const { rows: groupSettingsRows } = await query(
      'SELECT is_read_only, slow_mode_seconds FROM hangout_groups WHERE id = $1', [groupId]
    );
    const gs = groupSettingsRows[0];
    if (gs) {
      const isModOrOwner = await isOwnerOrMod(groupId, user.id);

      // Read-only: only mods/owner can send
      if (gs.is_read_only && !isModOrOwner) {
        return res.status(403).json({ error: 'This group is read-only' });
      }

      // Ban + mute check
      const { rows: memberRows } = await query(
        'SELECT is_banned, is_muted, muted_until FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
        [groupId, user.id]
      );
      if (memberRows[0]?.is_banned) {
        return res.status(403).json({ error: 'You are banned from this group' });
      }
      if (memberRows[0]?.is_muted) {
        if (!memberRows[0].muted_until || new Date(memberRows[0].muted_until) > new Date()) {
          return res.status(403).json({ error: 'You are muted in this group' });
        }
        // Mute expired — clear it
        await query('UPDATE hangout_group_members SET is_muted = false, muted_until = NULL WHERE group_id=$1 AND user_id=$2', [groupId, user.id]);
      }

      // Slow mode: enforce for non-mods
      if (gs.slow_mode_seconds > 0 && !isModOrOwner) {
        const { rows: lastMsgRows } = await query(
          `SELECT created_at FROM chat_messages WHERE room = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [`hangout:${groupId}`, user.id]
        );
        if (lastMsgRows.length > 0) {
          const elapsed = (Date.now() - new Date(lastMsgRows[0].created_at).getTime()) / 1000;
          if (elapsed < gs.slow_mode_seconds) {
            return res.status(429).json({ error: `Slow mode: wait ${Math.ceil(gs.slow_mode_seconds - elapsed)}s` });
          }
        }
      }
    }

    // Block check: group creator blocked sender OR sender blocked group creator
    const { rows: groupCreatorRows } = await query(
      'SELECT creator_id FROM hangout_groups WHERE id = $1',
      [groupId]
    );
    const creatorId = groupCreatorRows[0]?.creator_id;
    if (creatorId && String(creatorId) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(creatorId, user.id),
        BlockedUser.isBlocked(user.id, creatorId),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot send message in this group' });
      }
    }

    const room = `hangout:${groupId}`;
    const text = content.trim().slice(0, 2000);

    // Look up fresh photo from DB for storage and response (only use valid web URLs)
    const photoResult = await query('SELECT photo_file_id FROM users WHERE id = $1', [user.id]);
    const rawPhoto = photoResult.rows[0]?.photo_file_id || user.photoUrl || null;
    const photoUrl = isValidPhotoUrl(rawPhoto) ? rawPhoto : null;

    const { rows } = await query(
      `INSERT INTO chat_messages (room, user_id, username, first_name, photo_url, content, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, room, user_id, username, first_name, photo_url, content,
                 media_url, media_type, media_mime, media_thumb_url,
                 media_width, media_height, media_metadata, reply_to_id, created_at`,
      [room, user.id, user.username || null, user.firstName || user.first_name || null, photoUrl, text, parsedReplyToId]
    );

    const msg = normalizeMessage(rows[0]);

    // Attach reply_to preview if replying
    if (parsedReplyToId) {
      const { rows: replyRows } = await query(
        'SELECT first_name, username, content, media_type, message_type, meta FROM chat_messages WHERE id = $1 AND room = $2',
        [parsedReplyToId, room]
      );
      if (replyRows[0]) {
        msg.reply_to = {
          name: replyRows[0].first_name || replyRows[0].username || 'User',
          content: buildReplyPreviewText(replyRows[0]),
        };
      }
    }

    // Touch activity timestamp
    await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [groupId]);

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', msg);
    }

    // ── Webapp → Telegram bridge: forward text to linked Telegram group ──
    (async () => {
      try {
        const { rows: tgRows } = await query(
          'SELECT telegram_chat_id FROM hangout_groups WHERE id = $1 AND telegram_chat_id IS NOT NULL',
          [groupId]
        );
        if (tgRows.length === 0) return;
        const tgChatId = tgRows[0].telegram_chat_id;
        const { getBotInstance } = require('../../core/bot');
        const bot = getBotInstance();
        if (!bot) return;
        const senderName = user.firstName || user.first_name || user.username || 'User';
        await bot.telegram.sendMessage(tgChatId, `${senderName}: ${text}`, { parse_mode: undefined });
      } catch (bridgeErr) {
        logger.warn('[App→TG Bridge] REST text forward failed', { error: bridgeErr.message, groupId });
      }
    })();

    return res.json({ success: true, message: msg });
  } catch (err) {
    logger.error('sendMessage hangout error', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
};

// POST /api/webapp/hangouts/groups/:id/read
const markAsRead = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });
  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    await query(
      'UPDATE hangout_group_members SET last_read_at = NOW() WHERE group_id = $1 AND user_id = $2',
      [groupId, user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('markAsRead error', err);
    return res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// GET /api/webapp/hangouts/groups/discover
const discoverGroups = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  try {
    const { rows } = await query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.creator_id,
              g.is_public, g.is_paid, g.price_usd, g.created_at,
              (SELECT COUNT(*)::int FROM hangout_group_members m WHERE m.group_id = g.id) as member_count,
              (SELECT jr.status FROM hangout_join_requests jr
               WHERE jr.group_id = g.id AND jr.user_id = $1
               ORDER BY jr.created_at DESC LIMIT 1) as my_request_status
       FROM hangout_groups g
       WHERE g.is_main = false
         AND g.is_wall_of_fame = false
         AND NOT EXISTS (
           SELECT 1 FROM hangout_group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1
         )
       ORDER BY g.created_at DESC
       LIMIT 50`,
      [user.id]
    );

    const groups = rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      avatarUrl: r.avatar_url,
      creatorId: r.creator_id,
      isPublic: r.is_public,
      memberCount: r.member_count,
      createdAt: r.created_at,
      myRequestStatus: r.my_request_status || null,
      isPaid: !!r.is_paid,
      priceUsd: Number(r.price_usd) || 0,
    }));

    return res.json({ success: true, groups });
  } catch (err) {
    logger.error('discoverGroups error', err);
    return res.status(500).json({ error: 'Failed to discover groups' });
  }
};

// POST /api/webapp/hangouts/groups/:id/request-join
const requestJoinGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    const group = groupRows[0];

    if (group.is_public) return res.status(400).json({ error: 'This group is public, use join instead' });
    if (await isMember(groupId, user.id)) return res.status(409).json({ error: 'Already a member' });

    // Block check: creator blocked requester OR requester blocked creator
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [blockedByCreator, blockedByUser] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (blockedByCreator || blockedByUser) {
        return res.status(403).json({ error: 'Cannot request to join this group' });
      }
    }

    // Upsert: reset rejected requests to pending
    const { rows } = await query(
      `INSERT INTO hangout_join_requests (group_id, user_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (group_id, user_id) DO UPDATE
         SET status = 'pending', created_at = NOW(), resolved_at = NULL, resolved_by = NULL
         WHERE hangout_join_requests.status = 'rejected'
       RETURNING *`,
      [groupId, user.id]
    );

    if (rows.length === 0) {
      return res.status(409).json({ error: 'Request already pending' });
    }

    // Notify group creator
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      NotificationEmitter.emit({
        type: 'group_join_request', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: group.creator_id,
        entityType: 'group', entityId: String(groupId),
        message: `${user.firstName || user.first_name || user.username} requested to join ${group.name}`,
        metadata: { groupName: group.name },
      });
    }

    return res.json({ success: true, request: rows[0] });
  } catch (err) {
    logger.error('requestJoinGroup error', err);
    return res.status(500).json({ error: 'Failed to submit join request' });
  }
};

// GET /api/webapp/hangouts/groups/:id/requests
const getJoinRequests = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Only creator can view requests
    const { rows: groupRows } = await query('SELECT creator_id FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (String(groupRows[0].creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group creator can view requests' });
    }

    const { rows } = await query(
      `SELECT jr.id, jr.user_id, jr.status, jr.created_at,
              u.username, u.first_name, u.photo_file_id as photo_url
       FROM hangout_join_requests jr
       JOIN users u ON u.id = jr.user_id
       WHERE jr.group_id = $1 AND jr.status = 'pending'
       ORDER BY jr.created_at ASC`,
      [groupId]
    );

    return res.json({
      success: true,
      requests: rows.map(r => ({
        ...r,
        photo_url: isValidPhotoUrl(r.photo_url) ? r.photo_url : null,
      })),
    });
  } catch (err) {
    logger.error('getJoinRequests error', err);
    return res.status(500).json({ error: 'Failed to load requests' });
  }
};

// POST /api/webapp/hangouts/groups/:id/requests/:requestId/:action
const handleJoinRequest = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const requestId = parseInt(req.params.requestId);
  const action = req.params.action;

  if (!Number.isFinite(groupId) || !Number.isFinite(requestId)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  if (action !== 'accept' && action !== 'reject') {
    return res.status(400).json({ error: 'Action must be accept or reject' });
  }

  try {
    // Only creator can handle requests
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (String(groupRows[0].creator_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Only the group creator can manage requests' });
    }

    // Update request
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    const { rows } = await query(
      `UPDATE hangout_join_requests
       SET status = $1, resolved_at = NOW(), resolved_by = $2
       WHERE id = $3 AND group_id = $4 AND status = 'pending'
       RETURNING *`,
      [newStatus, user.id, requestId, groupId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already handled' });
    }

    const joinRequest = rows[0];

    // On accept, re-check block status in case a block was placed after the request
    if (action === 'accept') {
      if (joinRequest.user_id && String(joinRequest.user_id) !== String(user.id)) {
        const [blockedByCreator, blockedByRequester] = await Promise.all([
          BlockedUser.isBlocked(user.id, joinRequest.user_id),
          BlockedUser.isBlocked(joinRequest.user_id, user.id),
        ]);
        if (blockedByCreator || blockedByRequester) {
          // Silently reject: revert the accept we just wrote
          await query(
            `UPDATE hangout_join_requests
             SET status = 'rejected', resolved_at = NOW(), resolved_by = $1
             WHERE id = $2`,
            [user.id, requestId]
          );
          return res.status(403).json({ error: 'Cannot accept this request' });
        }
      }

      const { rowCount } = await query(
        `INSERT INTO hangout_group_members (group_id, user_id, role)
         SELECT $1, $2, 'member'
         WHERE (SELECT COUNT(*) FROM hangout_group_members WHERE group_id = $1) < (
           SELECT max_members FROM hangout_groups WHERE id = $1
         )
         ON CONFLICT DO NOTHING`,
        [groupId, joinRequest.user_id]
      );
      if (rowCount === 0) {
        return res.status(409).json({ error: 'Group is full or user is already a member' });
      }

      // Notify the requester
      NotificationEmitter.emit({
        type: 'group_request_accepted', category: 'hangouts', priority: 'normal',
        actorId: user.id, targetUserId: joinRequest.user_id,
        entityType: 'group', entityId: String(groupId),
        message: `Your request to join ${groupRows[0].name} was accepted`,
        metadata: { groupName: groupRows[0].name },
      });
    }

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    logger.error('handleJoinRequest error', err);
    return res.status(500).json({ error: 'Failed to handle request' });
  }
};

// Helper: write a moderation audit record — never throws, never blocks the caller
async function auditModeration(groupId, actorId, targetId, action, reason = null, metadata = null) {
  try {
    await query(
      `INSERT INTO hangout_moderation_audit (group_id, actor_id, target_id, action, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [groupId, String(actorId), targetId != null ? String(targetId) : null, action, reason, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    logger.warn('auditModeration failed', { groupId, action, err: err.message });
  }
}

// Helper: check if user is owner or moderator (banned moderators are excluded)
const isOwnerOrMod = async (groupId, userId) => {
  const { rows } = await query(
    "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND is_banned = FALSE AND role IN ('owner','moderator')",
    [groupId, userId]
  );
  return rows.length > 0;
};

// POST /api/webapp/hangouts/groups/:id/ban
const banMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    const { rows: targetRows } = await query(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not in group' });
    if (targetRows[0].role === 'owner') return res.status(403).json({ error: 'Cannot ban the owner' });

    await query(
      'UPDATE hangout_group_members SET is_banned = true WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    auditModeration(groupId, user.id, targetId, 'ban', req.body.reason || null, null);
    matrixService.removeFromHangoutRoom(groupId, { id: targetId, matrix_user_id: null }).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    logger.error('banMember error', err);
    return res.status(500).json({ error: 'Failed to ban member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/unban
const unbanMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query(
      'UPDATE hangout_group_members SET is_banned = false WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    auditModeration(groupId, user.id, targetId, 'unban', null, null);
    return res.json({ success: true });
  } catch (err) {
    logger.error('unbanMember error', err);
    return res.status(500).json({ error: 'Failed to unban member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/mute
const muteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId, durationMinutes = 60 } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    const { rows: targetRows } = await query(
      'SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    if (targetRows.length === 0) return res.status(404).json({ error: 'User not in group' });
    if (targetRows[0].role === 'owner') return res.status(403).json({ error: 'Cannot mute the owner' });

    const mutedUntil = new Date(Date.now() + Math.min(durationMinutes, 10080) * 60000); // max 7 days
    await query(
      'UPDATE hangout_group_members SET is_muted = true, muted_until = $3 WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId, mutedUntil]
    );
    auditModeration(groupId, user.id, targetId, 'mute', req.body.reason || null, { durationSeconds: Math.min(durationMinutes, 10080) * 60 });
    return res.json({ success: true, mutedUntil });
  } catch (err) {
    logger.error('muteMember error', err);
    return res.status(500).json({ error: 'Failed to mute member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/unmute
const unmuteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query(
      'UPDATE hangout_group_members SET is_muted = false, muted_until = NULL WHERE group_id=$1 AND user_id=$2',
      [groupId, targetId]
    );
    auditModeration(groupId, user.id, targetId, 'unmute', null, null);
    return res.json({ success: true });
  } catch (err) {
    logger.error('unmuteMember error', err);
    return res.status(500).json({ error: 'Failed to unmute member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/promote
const promoteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Only owner can promote
    const { rows: callerRows } = await query(
      "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'",
      [groupId, user.id]
    );
    if (callerRows.length === 0) return res.status(403).json({ error: 'Only the owner can promote members' });

    const { rowCount } = await query(
      "UPDATE hangout_group_members SET role = 'moderator' WHERE group_id=$1 AND user_id=$2 AND role='member'",
      [groupId, targetId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Member not found or already a moderator' });

    auditModeration(groupId, user.id, targetId, 'promote_moderator', null, { previousRole: 'member' });

    // Set Matrix power level to 50 (moderator)
    const matrixUserId = `@pnptv_${targetId}:${process.env.MATRIX_SERVER_NAME || 'matrix.pnptv.app'}`;
    matrixService.setUserPowerLevel(groupId, matrixUserId, 50).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    logger.error('promoteMember error', err);
    return res.status(500).json({ error: 'Failed to promote member' });
  }
};

// POST /api/webapp/hangouts/groups/:id/demote
const demoteMember = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: targetId } = req.body;
  if (!Number.isFinite(groupId) || !targetId) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { rows: callerRows } = await query(
      "SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'",
      [groupId, user.id]
    );
    if (callerRows.length === 0) return res.status(403).json({ error: 'Only the owner can demote moderators' });

    const { rowCount } = await query(
      "UPDATE hangout_group_members SET role = 'member' WHERE group_id=$1 AND user_id=$2 AND role='moderator'",
      [groupId, targetId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Moderator not found' });

    auditModeration(groupId, user.id, targetId, 'demote_member', null, { previousRole: 'moderator' });

    // Set Matrix power level back to 0 (regular member)
    const matrixUserId = `@pnptv_${targetId}:${process.env.MATRIX_SERVER_NAME || 'matrix.pnptv.app'}`;
    matrixService.setUserPowerLevel(groupId, matrixUserId, 0).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    logger.error('demoteMember error', err);
    return res.status(500).json({ error: 'Failed to demote member' });
  }
};

// GET /api/webapp/hangouts/groups/:id/moderation/audit
const getModerationAudit = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });

    const before = req.query.before ? new Date(req.query.before) : null;
    const { rows } = await query(
      `SELECT id, group_id, actor_id, target_id, action, reason, metadata, created_at
       FROM hangout_moderation_audit
       WHERE group_id = $1
         AND ($2::timestamptz IS NULL OR created_at < $2)
       ORDER BY created_at DESC
       LIMIT 100`,
      [groupId, before]
    );
    return res.json({ entries: rows });
  } catch (err) {
    logger.error('getModerationAudit error', err);
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
};

// POST /api/webapp/hangouts/groups/:id/pin
const pinMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId, body } = req.body;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });

    const { rows } = await query(
      `INSERT INTO hangout_pinned_messages (group_id, matrix_event_id, message_body, pinned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, matrix_event_id) DO NOTHING
       RETURNING *`,
      [groupId, eventId, (body || '').slice(0, 500), user.id]
    );
    return res.json({ success: true, pin: rows[0] || null });
  } catch (err) {
    logger.error('pinMessage error', err);
    return res.status(500).json({ error: 'Failed to pin message' });
  }
};

// DELETE /api/webapp/hangouts/groups/:id/pin/:eventId
const unpinMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId } = req.params;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    await query('DELETE FROM hangout_pinned_messages WHERE group_id=$1 AND matrix_event_id=$2', [groupId, eventId]);
    return res.json({ success: true });
  } catch (err) {
    logger.error('unpinMessage error', err);
    return res.status(500).json({ error: 'Failed to unpin message' });
  }
};

// GET /api/webapp/hangouts/groups/:id/pins
const getPinnedMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    const { rows } = await query(
      `SELECT p.*, u.first_name AS pinned_by_name
       FROM hangout_pinned_messages p
       LEFT JOIN users u ON u.id = p.pinned_by
       WHERE p.group_id = $1
       ORDER BY p.pinned_at DESC
       LIMIT 20`,
      [groupId]
    );
    return res.json({ success: true, pins: rows });
  } catch (err) {
    logger.error('getPinnedMessages error', err);
    return res.status(500).json({ error: 'Failed to load pins' });
  }
};

// PUT /api/webapp/hangouts/groups/:id/settings
const updateGroupSettings = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });

    const { slowModeSeconds, isReadOnly, allowMedia, allowMemberInvites, autoDeleteHours, tags, isPublic, name, description, feedVisibility, rules } = req.body;

    const sets = [];
    const vals = [];
    let idx = 1;

    if (slowModeSeconds !== undefined) { sets.push(`slow_mode_seconds = $${idx++}`); vals.push(Math.max(0, Math.min(slowModeSeconds, 3600))); }
    if (isReadOnly !== undefined) { sets.push(`is_read_only = $${idx++}`); vals.push(!!isReadOnly); }
    if (allowMedia !== undefined) { sets.push(`allow_media = $${idx++}`); vals.push(!!allowMedia); }
    if (allowMemberInvites !== undefined) { sets.push(`allow_member_invites = $${idx++}`); vals.push(!!allowMemberInvites); }
    if (autoDeleteHours !== undefined) { sets.push(`auto_delete_hours = $${idx++}`); vals.push(Math.max(0, Math.min(autoDeleteHours, 8760))); }
    if (tags !== undefined && Array.isArray(tags)) { sets.push(`tags = $${idx++}`); vals.push(tags.slice(0, 5).map(t => String(t).slice(0, 30))); }
    if (isPublic !== undefined) { sets.push(`is_public = $${idx++}`); vals.push(!!isPublic); }
    if (name !== undefined && name.trim()) { sets.push(`name = $${idx++}`); vals.push(name.trim().slice(0, 100)); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push((description || '').trim().slice(0, 500)); }
    if (feedVisibility !== undefined && ['public', 'shadow', 'ghost'].includes(feedVisibility)) { sets.push(`feed_visibility = $${idx++}`); vals.push(feedVisibility); }
    if (rules !== undefined) { sets.push(`rules = $${idx++}`); vals.push(rules ? String(rules).trim().slice(0, 1000) || null : null); }

    if (sets.length === 0) return res.status(400).json({ error: 'No settings to update' });

    vals.push(groupId);
    const { rows } = await query(
      `UPDATE hangout_groups SET ${sets.join(', ')} WHERE id = $${idx} AND is_main = false
       RETURNING id, name, description, is_public, slow_mode_seconds, is_read_only, allow_media, allow_member_invites, auto_delete_hours, tags, feed_visibility, rules`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Group not found or is main' });

    // Sync relevant settings to Matrix room (non-blocking)
    matrixService.syncRoomSettings(groupId, {
      isReadOnly: isReadOnly !== undefined ? !!isReadOnly : undefined,
      allowMedia: allowMedia !== undefined ? !!allowMedia : undefined,
      allowMemberInvites: allowMemberInvites !== undefined ? !!allowMemberInvites : undefined,
      name: name !== undefined ? name.trim().slice(0, 100) : undefined,
      description: description !== undefined ? (description || '').trim().slice(0, 500) : undefined,
    }).catch(err => logger.warn('syncRoomSettings failed (non-critical):', err.message));

    // Invalidate tg-hangout-full cache for any linked Telegram group so rules propagate immediately
    if (rules !== undefined || name !== undefined) {
      try {
        const { getRedis } = require('../../../config/redis');
        const redis = getRedis();
        const { rows: tgRows } = await query('SELECT telegram_chat_id FROM hangout_groups WHERE id = $1', [groupId]);
        if (tgRows[0]?.telegram_chat_id) {
          await redis.del(`tg-hangout-full:${tgRows[0].telegram_chat_id}`);
        }
      } catch (_e) { /* non-critical */ }
    }

    return res.json({ success: true, settings: rows[0] });
  } catch (err) {
    logger.error('updateGroupSettings error', err);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

// POST /api/webapp/hangouts/groups/:id/transfer
const transferOwnership = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { userId: newOwnerId } = req.body;
  if (!Number.isFinite(groupId) || !newOwnerId) return res.status(400).json({ error: 'Missing fields' });

  try {
    // Only current owner
    const { rows: groupRows } = await query('SELECT creator_id, is_main FROM hangout_groups WHERE id=$1', [groupId]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (groupRows[0].is_main) return res.status(400).json({ error: 'Cannot transfer main group' });
    if (String(groupRows[0].creator_id) !== String(user.id)) return res.status(403).json({ error: 'Only the owner can transfer' });

    // Verify target is a member
    if (!(await isMember(groupId, newOwnerId))) return res.status(404).json({ error: 'Target user is not a member' });

    // Transfer
    await query('UPDATE hangout_groups SET creator_id = $1 WHERE id = $2', [newOwnerId, groupId]);
    await query("UPDATE hangout_group_members SET role = 'member' WHERE group_id=$1 AND user_id=$2", [groupId, user.id]);
    await query("UPDATE hangout_group_members SET role = 'owner' WHERE group_id=$1 AND user_id=$2", [groupId, newOwnerId]);

    return res.json({ success: true });
  } catch (err) {
    logger.error('transferOwnership error', err);
    return res.status(500).json({ error: 'Failed to transfer ownership' });
  }
};

// GET /api/webapp/hangouts/groups/:id/invite-link
const getInviteLink = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const isOwnerMod = await isOwnerOrMod(groupId, user.id);

    if (!isOwnerMod) {
      const { rows: gs } = await query('SELECT is_public, allow_member_invites FROM hangout_groups WHERE id=$1', [groupId]);
      if (!gs[0]) return res.status(404).json({ error: 'Group not found' });
      // Private groups: only owners/moderators may generate the link
      if (!gs[0].is_public) {
        return res.status(403).json({ error: 'Only owners and moderators can generate invite links for private groups' });
      }
      if (!gs[0].allow_member_invites) return res.status(403).json({ error: 'Not authorized' });
      if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    }

    // Get or generate invite code
    let { rows } = await query('SELECT invite_code FROM hangout_groups WHERE id=$1', [groupId]);
    if (!rows[0]?.invite_code) {
      const code = require('crypto').randomBytes(6).toString('hex');
      const result = await query(
        'UPDATE hangout_groups SET invite_code = $1 WHERE id = $2 RETURNING invite_code',
        [code, groupId]
      );
      rows = result.rows;
    }
    return res.json({ success: true, inviteCode: rows[0].invite_code, inviteUrl: `https://pnptv.app/hangouts/invite/${rows[0].invite_code}` });
  } catch (err) {
    logger.error('getInviteLink error', err);
    return res.status(500).json({ error: 'Failed to generate invite link' });
  }
};

// POST /api/webapp/hangouts/groups/join-by-invite/:code
const joinByInvite = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: 'Missing invite code' });

  try {
    const { rows: groupRows } = await query('SELECT * FROM hangout_groups WHERE invite_code = $1', [code]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'Invalid invite link' });
    const group = groupRows[0];

    // Block check
    if (group.creator_id && String(group.creator_id) !== String(user.id)) {
      const [b1, b2] = await Promise.all([
        BlockedUser.isBlocked(group.creator_id, user.id),
        BlockedUser.isBlocked(user.id, group.creator_id),
      ]);
      if (b1 || b2) return res.status(403).json({ error: 'Cannot join this group' });
    }

    // Ban check
    const { rows: memberCheck } = await query(
      'SELECT is_banned FROM hangout_group_members WHERE group_id=$1 AND user_id=$2',
      [group.id, user.id]
    );
    if (memberCheck.length > 0 && memberCheck[0].is_banned) return res.status(403).json({ error: 'You are banned from this group' });
    if (memberCheck.length > 0) return res.json({ success: true, groupId: group.id }); // already member

    // Capacity check + insert
    const { rowCount } = await query(
      `INSERT INTO hangout_group_members (group_id, user_id, role)
       SELECT $1, $2, 'member'
       WHERE (SELECT COUNT(*) FROM hangout_group_members WHERE group_id=$1) < $3
       ON CONFLICT DO NOTHING`,
      [group.id, user.id, group.max_members]
    );
    if (rowCount === 0) return res.status(409).json({ error: 'Group is full' });

    matrixService.inviteToHangoutRoom(group.id, {
      id: user.id, telegram: user.telegram || String(user.id),
      username: user.username || null, first_name: user.firstName || user.first_name || null,
      matrix_user_id: null, matrix_access_token: null, matrix_device_id: null,
    }).catch(() => {});

    return res.json({ success: true, groupId: group.id });
  } catch (err) {
    logger.error('joinByInvite error', err);
    return res.status(500).json({ error: 'Failed to join group' });
  }
};

// PUT /api/webapp/hangouts/groups/:id/notification
const updateNotificationMode = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { mode } = req.body;
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });
  const validModes = ['all', 'mentions', 'muted'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: 'Invalid mode. Use: all, mentions, muted' });

  try {
    if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member' });
    await query(
      'UPDATE hangout_group_members SET notification_mode = $3 WHERE group_id=$1 AND user_id=$2',
      [groupId, user.id, mode]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('updateNotificationMode error', err);
    return res.status(500).json({ error: 'Failed to update notification mode' });
  }
};

// POST /api/webapp/hangouts/groups/:id/delete-message
const adminDeleteMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id);
  const { eventId } = req.body;
  if (!Number.isFinite(groupId) || !eventId) return res.status(400).json({ error: 'Missing fields' });

  try {
    if (!(await isOwnerOrMod(groupId, user.id))) return res.status(403).json({ error: 'Not authorized' });
    // Look up the Matrix room for this group
    const { rows: roomRows } = await query(
      'SELECT matrix_room_id FROM hangout_matrix_rooms WHERE hangout_group_id = $1',
      [groupId]
    );
    if (roomRows.length === 0) return res.status(404).json({ error: 'Matrix room not found' });

    await matrixService.redactRoomEvent(roomRows[0].matrix_room_id, eventId, 'Deleted by moderator');
    return res.json({ success: true });
  } catch (err) {
    logger.error('adminDeleteMessage error', err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
};

// ── Helper: aggregated reactions for a message, annotated with reacted_by_me ──
const fetchReactions = async (messageId, currentUserId) => {
  const { rows } = await query(
    `SELECT emoji, COUNT(*)::int AS count, array_agg(user_id) AS users
     FROM chat_message_reactions
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId]
  );
  const uid = String(currentUserId);
  return rows.map((r) => ({
    emoji: r.emoji,
    count: r.count,
    users: Array.isArray(r.users) ? r.users.map(String) : [],
    reacted_by_me: Array.isArray(r.users) && r.users.map(String).includes(uid),
  }));
};

// PATCH /api/webapp/hangouts/groups/:id/messages/:msgId
const editMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const msgId   = parseInt(req.params.msgId, 10);
  if (!Number.isFinite(groupId) || !Number.isFinite(msgId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const content = req.body.content?.trim();
  if (!content) return res.status(400).json({ error: 'Content required' });
  if (content.length > 2000) return res.status(400).json({ error: 'Content too long' });

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const { rows: msgRows } = await query(
      `SELECT id, user_id, created_at, is_deleted FROM chat_messages WHERE id=$1 AND room='hangout:'||$2`,
      [msgId, groupId]
    );
    if (msgRows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const msg = msgRows[0];
    if (String(msg.user_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Cannot edit another user\'s message' });
    }
    if (msg.is_deleted) return res.status(409).json({ error: 'Cannot edit a deleted message' });

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (ageMs > 48 * 60 * 60 * 1000) {
      return res.status(409).json({ error: 'Message too old to edit (48-hour limit)' });
    }

    const { rows: updated } = await query(
      `UPDATE chat_messages
       SET content = $1,
           edited_at = NOW(),
           edit_count = edit_count + 1,
           original_content = COALESCE(original_content, content)
       WHERE id = $2
       RETURNING id, content, edited_at, edit_count`,
      [content, msgId]
    );

    const result = updated[0];
    const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
    if (io) {
      io.to(`hangout:${groupId}`).emit('hangout:message:edited', {
        messageId: result.id,
        content:   result.content,
        editedAt:  result.edited_at,
        editCount: result.edit_count,
      });
    }

    return res.json({ success: true, message: result });
  } catch (err) {
    logger.error('editMessage error', err);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
};

// DELETE /api/webapp/hangouts/groups/:id/messages/:msgId
const deleteMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const msgId   = parseInt(req.params.msgId, 10);
  if (!Number.isFinite(groupId) || !Number.isFinite(msgId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  // Accept forAll from both query-string and body
  const forAll = (req.query.forAll ?? req.body?.forAll) === 'true';

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const { rows: msgRows } = await query(
      `SELECT id, user_id, is_deleted FROM chat_messages WHERE id=$1 AND room='hangout:'||$2`,
      [msgId, groupId]
    );
    if (msgRows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const msg = msgRows[0];
    if (msg.is_deleted) return res.status(409).json({ error: 'Message already deleted' });

    const isOwnMessage = String(msg.user_id) === String(user.id);

    if (forAll && !isOwnMessage) {
      // Only mods/owner may delete others' messages for everyone
      if (!(await isOwnerOrMod(groupId, user.id))) {
        return res.status(403).json({ error: 'Not authorized to delete this message for all' });
      }
    } else if (!forAll && !isOwnMessage) {
      // Cannot delete someone else's message (even for self only)
      return res.status(403).json({ error: 'Cannot delete another user\'s message' });
    }

    await query(
      `UPDATE chat_messages
       SET is_deleted = true, deleted_by = $1, deleted_for_all = $2
       WHERE id = $3`,
      [String(user.id), forAll, msgId]
    );

    if (forAll && !isOwnMessage) {
      auditModeration(groupId, user.id, msg.user_id, 'delete_message', null, { messageId: msgId });
    }

    const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
    if (io) {
      io.to(`hangout:${groupId}`).emit('hangout:message:deleted', {
        messageId: msgId,
        deletedBy: user.id,
        forAll,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteMessage error', err);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
};

// GET /api/webapp/hangouts/groups/:id/messages/search?q=
const searchMessages = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

  const q = req.query.q?.trim();
  if (!q || q.length < 2) return res.status(400).json({ error: 'Query must be at least 2 characters' });

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const room = `hangout:${groupId}`;
    const { rows } = await query(
      `SELECT cm.id, cm.room, cm.user_id, cm.username, cm.first_name,
              COALESCE(u.photo_file_id, cm.photo_url) AS photo_url,
              cm.content,
              cm.media_url, cm.media_type, cm.media_mime,
              cm.media_thumb_url, cm.media_width, cm.media_height,
              cm.media_metadata, cm.reply_to_id,
              r.first_name AS reply_name, r.username AS reply_username, r.content AS reply_content,
              r.media_type AS reply_media_type, r.message_type AS reply_message_type, r.meta AS reply_meta,
              cm.created_at, cm.edited_at, cm.edit_count, cm.is_pinned
       FROM chat_messages cm
       LEFT JOIN users u ON u.id = cm.user_id
       LEFT JOIN chat_messages r ON r.id = cm.reply_to_id
       WHERE cm.room = $1
         AND cm.is_deleted = false
         AND to_tsvector('english', COALESCE(cm.content, '')) @@ plainto_tsquery('english', $2)
       ORDER BY cm.created_at DESC
       LIMIT 30`,
      [room, q]
    );

    for (const msg of rows) {
      if (msg.reply_to_id && (msg.reply_name || msg.reply_username)) {
        msg.reply_to = {
          name: msg.reply_name || msg.reply_username || 'User',
          content: buildReplyPreviewText({
            content: msg.reply_content,
            media_type: msg.reply_media_type,
            message_type: msg.reply_message_type,
            meta: msg.reply_meta,
          }),
        };
      }
      delete msg.reply_name; delete msg.reply_username; delete msg.reply_content;
      delete msg.reply_media_type; delete msg.reply_message_type; delete msg.reply_meta;
      msg.reactions = [];
    }

    return res.json({ success: true, messages: rows.map(normalizeMessage) });
  } catch (err) {
    logger.error('searchMessages error', err);
    return res.status(500).json({ error: 'Failed to search messages' });
  }
};

// POST /api/webapp/hangouts/groups/:id/messages/:msgId/react
const toggleReaction = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const msgId   = parseInt(req.params.msgId, 10);
  if (!Number.isFinite(groupId) || !Number.isFinite(msgId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const emoji = req.body.emoji?.trim();
  const { isAllowedReaction } = require('../../../services/reactionService');
  if (!isAllowedReaction(emoji)) return res.status(400).json({ error: 'Emoji not allowed', code: 'EMOJI_NOT_ALLOWED' });

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Verify message belongs to this group
    const { rows: msgRows } = await query(
      `SELECT id FROM chat_messages WHERE id=$1 AND room='hangout:'||$2 AND is_deleted=false`,
      [msgId, groupId]
    );
    if (msgRows.length === 0) return res.status(404).json({ error: 'Message not found' });

    // Check if reaction already exists
    const { rows: existing } = await query(
      `SELECT id FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
      [msgId, String(user.id), emoji]
    );

    if (existing.length > 0) {
      // Remove the reaction
      await query(
        `DELETE FROM chat_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
        [msgId, String(user.id), emoji]
      );
    } else {
      // Enforce max 20 unique emojis per message
      const { rows: uniqueEmojiRows } = await query(
        `SELECT COUNT(DISTINCT emoji)::int AS cnt FROM chat_message_reactions WHERE message_id=$1`,
        [msgId]
      );
      if (uniqueEmojiRows[0].cnt >= 20) {
        return res.status(409).json({ error: 'Maximum of 20 unique emoji reactions reached for this message' });
      }
      await query(
        `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [msgId, String(user.id), emoji]
      );
    }

    const reactions = await fetchReactions(msgId, user.id);

    // reacted_by_me is per-viewer — strip it from the broadcast so each client
    // derives their own from users[]. The HTTP response keeps it for the actor.
    const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
    if (io) {
      const broadcastReactions = reactions.map(({ reacted_by_me, ...rest }) => rest);
      io.to(`hangout:${groupId}`).emit('hangout:reaction:updated', {
        messageId: msgId,
        reactions: broadcastReactions,
      });
    }

    return res.json({ success: true, reactions });
  } catch (err) {
    logger.error('toggleReaction error', err);
    return res.status(500).json({ error: 'Failed to toggle reaction' });
  }
};

// GET /api/webapp/hangouts/groups/:id/messages/:msgId/reactions
const getReactions = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const msgId   = parseInt(req.params.msgId, 10);
  if (!Number.isFinite(groupId) || !Number.isFinite(msgId)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  try {
    if (!(await isMember(groupId, user.id))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Verify message belongs to this group
    const { rows: msgRows } = await query(
      `SELECT id FROM chat_messages WHERE id=$1 AND room='hangout:'||$2 AND is_deleted=false`,
      [msgId, groupId]
    );
    if (msgRows.length === 0) return res.status(404).json({ error: 'Message not found' });

    const reactions = await fetchReactions(msgId, user.id);
    return res.json({ success: true, reactions });
  } catch (err) {
    logger.error('getReactions error', err);
    return res.status(500).json({ error: 'Failed to load reactions' });
  }
};

// ── Per-user hangout thread state: pin / mute / read-message ────────────────
// All use PUT with schema columns on hangout_group_members:
//   is_pinned, is_user_muted, last_read_message_id
// (is_archived/archived_at remain on the table but are unused.)

// PUT /api/webapp/hangouts/groups/:id/pin  body: { pinned: boolean }
const pinGroup = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  const pinned = req.body?.pinned === true;

  const { rowCount } = await query(
    `UPDATE hangout_group_members
        SET is_pinned = $3
      WHERE group_id = $1 AND user_id = $2`,
    [groupId, user.id, pinned]
  );
  if (rowCount === 0) return res.status(403).json({ error: 'Not a member of this group' });
  return res.json({ success: true, pinned });
};

// PUT /api/webapp/hangouts/groups/:id/mute  body: { until: ISOString | "forever" | null }
const muteGroupForUser = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  const until = req.body?.until;

  let mutedUntil = null;
  let isMuted = false;
  if (until === 'forever') {
    isMuted = true;
    mutedUntil = null; // muted indefinitely
  } else if (typeof until === 'string' && until.length > 0) {
    const d = new Date(until);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid until timestamp' });
    isMuted = d > new Date();
    mutedUntil = d.toISOString();
  } else if (until === null) {
    isMuted = false;
    mutedUntil = null;
  } else {
    return res.status(400).json({ error: 'until must be ISO string, "forever", or null' });
  }

  const { rowCount } = await query(
    `UPDATE hangout_group_members
        SET is_user_muted  = $3,
            user_mute_until = $4
      WHERE group_id = $1 AND user_id = $2`,
    [groupId, user.id, isMuted, mutedUntil]
  );
  if (rowCount === 0) return res.status(403).json({ error: 'Not a member of this group' });
  return res.json({ success: true, mutedUntil });
};

// PUT /api/webapp/hangouts/groups/:id/read-message  body: { messageId: number }
const markMessageRead = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  const messageId = parseInt(req.body?.messageId, 10);
  if (!Number.isFinite(groupId) || !Number.isFinite(messageId) || messageId <= 0) {
    return res.status(400).json({ error: 'Invalid group id or messageId' });
  }

  // Only advance the pointer forward — never rewind
  const { rowCount } = await query(
    `UPDATE hangout_group_members
        SET last_read_message_id = $3,
            last_read_at         = NOW()
      WHERE group_id = $1 AND user_id = $2
        AND (last_read_message_id IS NULL OR last_read_message_id < $3)`,
    [groupId, user.id, messageId]
  );
  return res.json({ success: true, lastReadMessageId: messageId, updated: rowCount > 0 });
};

// ── Forward a hangout chat message to DMs and/or other hangouts ──────────────
// POST /api/webapp/hangouts/messages/:messageId/forward
// Body: { targets: Array<{type:'dm', userId}|{type:'hangout', groupId}>, note?: string }
// Response: { success, results: [{ target, status:'sent'|'skipped', messageId?, reason? }] }
const forwardMessage = async (req, res) => {
  const user = authGuard(req, res); if (!user) return;
  const messageId = parseInt(req.params.messageId, 10);
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return res.status(400).json({ error: 'Invalid messageId' });
  }

  const rawTargets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  if (rawTargets.length === 0) return res.status(400).json({ error: 'targets required' });
  if (rawTargets.length > 10) return res.status(400).json({ error: 'Max 10 targets per forward' });
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  // Normalize + dedupe targets
  const seen = new Set();
  const targets = [];
  for (const t of rawTargets) {
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'dm' && t.userId) {
      const key = `dm:${t.userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ type: 'dm', userId: String(t.userId) });
    } else if (t.type === 'hangout' && Number.isFinite(parseInt(t.groupId, 10))) {
      const gid = parseInt(t.groupId, 10);
      const key = `hg:${gid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ type: 'hangout', groupId: gid });
    }
  }
  if (targets.length === 0) return res.status(400).json({ error: 'No valid targets' });

  // Fetch source message — must be in a hangout room and sender must belong there
  const { rows: srcRows } = await query(
    `SELECT id, room, user_id, username, first_name, content, media_url, media_type,
            media_mime, media_thumb_url, message_type, meta, is_deleted
       FROM chat_messages WHERE id = $1 LIMIT 1`,
    [messageId]
  );
  const src = srcRows[0];
  if (!src || src.is_deleted) return res.status(404).json({ error: 'Message not found' });
  if (!src.room || !src.room.startsWith('hangout:')) {
    return res.status(400).json({ error: 'Not a hangout message' });
  }
  const srcGroupId = parseInt(src.room.split(':')[1], 10);
  // Sender must be a member of the source hangout to forward from it
  const { rows: srcMemberRows } = await query(
    `SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND COALESCE(is_banned,false)=false`,
    [srcGroupId, user.id]
  );
  if (srcMemberRows.length === 0) {
    return res.status(403).json({ error: 'Not a member of the source hangout' });
  }

  // Sender profile for hangout destination inserts
  const { rows: senderRows } = await query(
    `SELECT photo_file_id, username, first_name FROM users WHERE id = $1`,
    [user.id]
  );
  const senderPhoto = senderRows[0]?.photo_file_id && isValidPhotoUrl(senderRows[0].photo_file_id)
    ? senderRows[0].photo_file_id : null;
  const senderUsername = senderRows[0]?.username || user.username || null;
  const senderFirstName = senderRows[0]?.first_name || user.firstName || user.first_name || null;

  // Build forwarded content (prepend note if provided)
  const baseContent = src.content || '';
  const content = note ? (baseContent ? `${note}\n\n${baseContent}` : note) : baseContent;
  // Preserve post_card meta + text fallback so shared-post forwards keep working
  const messageType = src.message_type === 'post_card' ? 'post_card' : 'text';
  const meta = src.message_type === 'post_card'
    ? {
        ...(src.meta || {}),
        snapshot: {
          ...((src.meta && src.meta.snapshot) || {}),
          note: note || src.meta?.snapshot?.note || null,
        },
      }
    : (src.meta || null);

  const io = req.app.get('io');
  const DmService = require('../../../services/dmService');
  const { resolveUserId } = require('../utils/helpers');
  const results = [];

  for (const target of targets) {
    try {
      if (target.type === 'dm') {
        const resolvedRid = (await resolveUserId(target.userId)) || target.userId;
        if (String(resolvedRid) === String(user.id)) {
          results.push({ target, status: 'skipped', reason: 'self' });
          continue;
        }
        // For post_card sources, promote the snapshot's media into DM columns
        // so the media preview renders via the existing DM renderer even if the
        // recipient's client doesn't yet understand post_card meta.
        const srcSnap = (src.meta && src.meta.snapshot) || null;
        const dmMediaUrl = src.media_url || (src.message_type === 'post_card' ? (srcSnap?.mediaUrl || null) : null);
        const dmMediaType = src.media_type || (src.message_type === 'post_card' ? (srcSnap?.mediaType || null) : null);
        const msg = await DmService.sendMessage(
          user.id,
          resolvedRid,
          {
            content: content || null,
            mediaUrl: dmMediaUrl,
            mediaType: dmMediaType,
            mediaMime: src.media_mime || null,
            mediaThumbUrl: src.media_thumb_url || null,
            messageType: src.message_type === 'post_card' ? 'post_card' : 'text',
            meta: src.message_type === 'post_card' ? src.meta : null,
          },
          {}
        );
        if (io) {
          try { io.to(`user:${resolvedRid}`).emit('dm:message', { id: msg.id }); } catch (_) {}
        }
        results.push({ target, status: 'sent', messageId: msg.id });
      } else {
        // hangout target
        const gid = target.groupId;
        const { rows: memberRows } = await query(
          `SELECT is_banned, is_muted, muted_until FROM hangout_group_members
            WHERE group_id=$1 AND user_id=$2`,
          [gid, user.id]
        );
        if (memberRows.length === 0) { results.push({ target, status: 'skipped', reason: 'not_a_member' }); continue; }
        if (memberRows[0].is_banned) { results.push({ target, status: 'skipped', reason: 'banned' }); continue; }
        if (memberRows[0].is_muted && (!memberRows[0].muted_until || new Date(memberRows[0].muted_until) > new Date())) {
          results.push({ target, status: 'skipped', reason: 'muted' }); continue;
        }
        const { rows: gsRows } = await query(
          `SELECT hg.is_read_only,
                  (EXISTS(SELECT 1 FROM hangout_group_members m
                           WHERE m.group_id = hg.id AND m.user_id = $2
                             AND m.role IN ('owner','mod'))) AS is_mod_or_owner
             FROM hangout_groups hg WHERE hg.id = $1`,
          [gid, user.id]
        );
        if (gsRows[0]?.is_read_only && !gsRows[0].is_mod_or_owner) {
          results.push({ target, status: 'skipped', reason: 'read_only' }); continue;
        }

        const room = `hangout:${gid}`;
        const { rows: insRows } = await query(
          `INSERT INTO chat_messages
             (room, user_id, username, first_name, photo_url, content,
              media_url, media_type, media_mime, media_thumb_url, message_type, meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
           RETURNING id, room, user_id, username, first_name, photo_url, content,
                     media_url, media_type, media_mime, media_thumb_url,
                     message_type, meta, created_at`,
          [
            room, user.id, senderUsername, senderFirstName, senderPhoto,
            content || null,
            src.media_url || null, src.media_type || null,
            src.media_mime || null, src.media_thumb_url || null,
            messageType, meta ? JSON.stringify(meta) : null,
          ]
        );
        const newMsg = insRows[0];
        await query('UPDATE hangout_groups SET last_activity_at = NOW() WHERE id = $1', [gid]);
        if (io) io.to(room).emit('chat:message', newMsg);
        results.push({ target, status: 'sent', messageId: newMsg.id });
      }
    } catch (err) {
      logger.warn('forwardMessage per-target failed', { target, error: err.message });
      results.push({ target, status: 'skipped', reason: 'server_error' });
    }
  }

  return res.json({ success: true, results });
};

module.exports = {
  listGroups,
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  deleteGroup,
  updateGroup,
  updateGroupAvatar,
  kickMember,
  updateMemberRole,
  getMessages,
  sendMessage,

  markAsRead,
  discoverGroups,
  requestJoinGroup,
  getJoinRequests,
  handleJoinRequest,
  kickMember,
  banMember,
  unbanMember,
  muteMember,
  unmuteMember,
  promoteMember,
  demoteMember,
  getModerationAudit,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  updateGroupSettings,
  transferOwnership,
  getInviteLink,
  joinByInvite,
  updateNotificationMode,
  adminDeleteMessage,
  editMessage,
  deleteMessage,
  searchMessages,
  toggleReaction,
  getReactions,
  linkTelegramGroup,
  unlinkTelegramGroup,
  getVideoChatStatus,
  startCall,
  joinCall,
  endCall,
  leaveCall,
  forwardMessage,
  pinGroup,
  muteGroupForUser,
  markMessageRead,
};

// ── LiveKit video calls ──────────────────────────────────────────────────────

const livekitService = require('../../../services/livekitService');

// Per-tier video-call caps. Admins bypass almost everything. Free users can't
// start or join. Override at runtime via env var HANGOUT_CALL_LIMITS_BY_TIER
// (JSON map of tier → { maxParticipants, maxRoomsPerDay }).
const CALL_LIMITS_DEFAULTS = {
  admin:      { maxParticipants: 1000, maxRoomsPerDay: 999 },
  superadmin: { maxParticipants: 1000, maxRoomsPerDay: 999 },
  prime:      { maxParticipants: 50,   maxRoomsPerDay: 5 },
  member:     { maxParticipants: 10,   maxRoomsPerDay: 3 },
  free:       { maxParticipants: 0,    maxRoomsPerDay: 0 },
};
const CALL_LIMITS_OVERRIDE = (() => {
  try { return JSON.parse(process.env.HANGOUT_CALL_LIMITS_BY_TIER || '{}'); }
  catch { return {}; }
})();
function effectiveCallLimits(userRole, userTier) {
  const role = String(userRole || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') {
    return CALL_LIMITS_OVERRIDE[role] || CALL_LIMITS_DEFAULTS[role];
  }
  const tier = String(userTier || 'free').toLowerCase();
  return CALL_LIMITS_OVERRIDE[tier] || CALL_LIMITS_DEFAULTS[tier] || CALL_LIMITS_DEFAULTS.free;
}

// ── Video-call shared helpers ─────────────────────────────────────────────────

function emitToHangoutGroup(groupId, event, data) {
  const io = socketSingleton.get ? socketSingleton.get() : socketSingleton;
  if (io) io.to(`hangout:${groupId}`).emit(event, data);
}

async function getActiveParticipantCount(callId) {
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*)::int AS count FROM hangout_call_participants WHERE call_id = $1 AND left_at IS NULL',
    [callId]
  );
  return count;
}

async function validateUserGroupAccess(userId, groupId, language, res) {
  await ensureMainGroupMembership(userId);
  await ensureLanguageGroupMembership(userId, language);
  const member = await isMember(groupId, userId);
  if (!member) { res.status(403).json({ error: 'Not a member of this group' }); return false; }
  return true;
}

async function checkPaidHangoutAccess(groupId, user, res) {
  const { rows: [grp] } = await query(
    `SELECT id, is_paid, price_usd FROM hangout_groups WHERE id = $1`,
    [groupId]
  );
  if (!grp) { res.status(404).json({ error: 'Group not found' }); return false; }
  if (grp.is_paid && parseFloat(grp.price_usd || 0) > 0) {
    const ownerMod = await isOwnerOrMod(groupId, user.id);
    if (!ownerMod) {
      const EntitlementAccessService = require('../../../services/entitlementAccessService');
      const result = await EntitlementAccessService.hasResourceAccess(String(user.id), 'hangout', String(groupId));
      if (!result.allowed) {
        res.status(402).json({ error: 'Paid hangout — access required to join call', code: 'PAID_ACCESS_REQUIRED' });
        return false;
      }
    }
  }
  return true;
}

// Generates a LiveKit token, upserts the participant row, and returns the call response payload.
// Does NOT handle capacity checks — callers must do that before invoking.
async function generateCallAccess(groupId, callId, roomName, user) {
  const displayName = user.firstName || user.first_name || user.username || 'User';
  const isOwnerMod = await isOwnerOrMod(groupId, user.id);
  const ttl = isOwnerMod ? 4 * 3600 : 2 * 3600;
  const token = await livekitService.generateToken(roomName, String(user.id), displayName, isOwnerMod, { ttlSeconds: ttl });
  await query(
    `INSERT INTO hangout_call_participants (call_id, user_id, display_name, joined_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL, joined_at = EXCLUDED.joined_at`,
    [callId, user.id, displayName]
  );
  return { token, livekitUrl: livekitService.LIVEKIT_WS_URL, roomName };
}

// ── Video-call controllers ────────────────────────────────────────────────────

// POST /api/webapp/hangouts/groups/:id/call/start
async function startCall(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await validateUserGroupAccess(user.id, groupId, user.language, res))) return;

    const starterLimits = effectiveCallLimits(user.role, user.tier);
    if (starterLimits.maxRoomsPerDay === 0) {
      return res.status(403).json({ error: 'Your tier cannot start video calls', code: 'TIER_NOT_ELIGIBLE_FOR_CALLS' });
    }

    if (!(await checkPaidHangoutAccess(groupId, user, res))) return;

    // Rooms-per-day cap — owner/mods of THIS group bypass so hosts aren't
    // blocked; admins bypass via their limit being 999.
    const isOwnerModForGroup = await isOwnerOrMod(groupId, user.id);
    if (!isOwnerModForGroup && starterLimits.maxRoomsPerDay < 999) {
      const { rows: [rpd] } = await query(
        `SELECT COUNT(*)::int AS count FROM hangout_video_calls
         WHERE creator_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [user.id]
      );
      if ((rpd?.count || 0) >= starterLimits.maxRoomsPerDay) {
        return res.status(429).json({
          error: `Daily call limit reached (${starterLimits.maxRoomsPerDay} rooms/day)`,
          code: 'CALL_ROOMS_PER_DAY_EXCEEDED',
        });
      }
    }

    const roomName = `hangout-${groupId}`;

    await query(
      `UPDATE hangout_video_calls SET status = 'ended', ended_at = NOW()
       WHERE group_id = $1 AND status = 'active'
         AND created_at < NOW() - INTERVAL '6 hours'`,
      [groupId]
    );

    // If an active call already exists, join it instead of creating a new one
    const { rows: existing } = await query(
      `SELECT hvc.id, hvc.room_name, hvc.creator_id, u.role AS creator_role, u.tier AS creator_tier
       FROM hangout_video_calls hvc LEFT JOIN users u ON u.id = hvc.creator_id
       WHERE hvc.group_id=$1 AND hvc.status='active' ORDER BY hvc.created_at DESC LIMIT 1`,
      [groupId]
    );

    if (existing.length > 0) {
      const { id: existingCallId, room_name: activeRoomName } = existing[0];
      // Capacity check — skip if user is already an active participant (re-fetching token)
      const { rows: [already] } = await query(
        `SELECT 1 FROM hangout_call_participants WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [existingCallId, user.id]
      );
      if (!already) {
        const creatorLimits = effectiveCallLimits(existing[0].creator_role, existing[0].creator_tier);
        const count = await getActiveParticipantCount(existingCallId);
        if (count >= creatorLimits.maxParticipants) {
          return res.status(409).json({
            error: `Call is full (${creatorLimits.maxParticipants} participants max)`,
            code: 'CALL_PARTICIPANT_LIMIT_REACHED',
          });
        }
      }
      return res.json(await generateCallAccess(groupId, existingCallId, activeRoomName, user));
    }

    let callId;
    try {
      // Create a new call record — participant_count starts at 0 (trigger will increment after participant insert)
      const { rows: created } = await query(
        `INSERT INTO hangout_video_calls (group_id, creator_id, room_name, status, participant_count)
         VALUES ($1, $2, $3, 'active', 0)
         RETURNING id`,
        [groupId, user.id, roomName]
      );
      callId = created[0].id;
    } catch (insertErr) {
      if (insertErr.code === '23505') {
        // Unique-index collision: concurrent startCall won the race — join the existing call
        const { rows: race } = await query(
          `SELECT id, room_name FROM hangout_video_calls WHERE group_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
          [groupId]
        );
        if (race.length > 0) {
          return res.json(await generateCallAccess(groupId, race[0].id, race[0].room_name, user));
        }
      }
      throw insertErr;
    }

    const displayName = user.firstName || user.first_name || user.username || 'User';
    // Insert creator as first participant — trigger sets participant_count to 1
    await query(
      `INSERT INTO hangout_call_participants (call_id, user_id, display_name, joined_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (call_id, user_id) DO UPDATE SET left_at = NULL, joined_at = EXCLUDED.joined_at`,
      [callId, user.id, displayName]
    );
    // Creator of a new call is always owner/mod — use 4h TTL
    const token = await livekitService.generateToken(roomName, String(user.id), displayName, true, { ttlSeconds: 4 * 3600 });

    emitToHangoutGroup(groupId, 'hangout:call:started', {
      groupId,
      callId,
      startedBy: { firstName: user.firstName || user.first_name, username: user.username },
    });

    // Cache active call for 60s so listGroups can skip the DB sub-query
    getRedis().set(`hangout:active_call:${groupId}`, JSON.stringify({ id: callId, roomName, participantCount: 1 }), 'EX', 60).catch(() => {});

    logger.info(`startCall: group=${groupId} call=${callId} user=${user.id}`);
    return res.json({ token, livekitUrl: livekitService.LIVEKIT_WS_URL, roomName });
  } catch (err) {
    logger.error('startCall error', err);
    return res.status(500).json({ error: 'Failed to start call' });
  }
}

// POST /api/webapp/hangouts/groups/:id/call/join
async function joinCall(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await validateUserGroupAccess(user.id, groupId, user.language, res))) return;

    const joinerLimits = effectiveCallLimits(user.role, user.tier);
    if (joinerLimits.maxParticipants === 0) {
      return res.status(403).json({ error: 'Your tier cannot join video calls', code: 'TIER_NOT_ELIGIBLE_FOR_CALLS' });
    }

    if (!(await checkPaidHangoutAccess(groupId, user, res))) return;

    const { rows } = await query(
      `SELECT hvc.id, hvc.room_name, u.role AS creator_role, u.tier AS creator_tier
       FROM hangout_video_calls hvc LEFT JOIN users u ON u.id = hvc.creator_id
       WHERE hvc.group_id=$1 AND hvc.status='active' ORDER BY hvc.created_at DESC LIMIT 1`,
      [groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No active call for this group' });

    const { id: callId, room_name: roomName } = rows[0];
    const creatorLimits = effectiveCallLimits(rows[0].creator_role, rows[0].creator_tier);

    // Capacity check — skip if user already active (re-fetching token)
    const { rows: [already] } = await query(
      `SELECT 1 FROM hangout_call_participants WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [callId, user.id]
    );
    if (!already) {
      const count = await getActiveParticipantCount(callId);
      if (count >= creatorLimits.maxParticipants) {
        return res.status(409).json({
          error: `Call is full (${creatorLimits.maxParticipants} participants max)`,
          code: 'CALL_PARTICIPANT_LIMIT_REACHED',
        });
      }
    }

    const result = await generateCallAccess(groupId, callId, roomName, user);

    emitToHangoutGroup(groupId, 'hangout:call:participant-joined', {
      groupId,
      callId,
      user: { id: user.id, firstName: user.firstName || user.first_name, username: user.username },
    });

    return res.json(result);
  } catch (err) {
    logger.error('joinCall error', err);
    return res.status(500).json({ error: 'Failed to join call' });
  }
}

// POST /api/webapp/hangouts/groups/:id/call/end
async function endCall(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';

    const { rows } = await query(
      `SELECT id, creator_id FROM hangout_video_calls WHERE group_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
      [groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No active call to end' });

    const { id: callId, creator_id } = rows[0];
    const isCallCreator = String(creator_id) === String(user.id);
    const isGroupOwnerOrMod = await isOwnerOrMod(groupId, user.id);
    if (!isAdminRole && !isCallCreator && !isGroupOwnerOrMod) {
      return res.status(403).json({ error: 'Only the call creator, group owner/moderator, or an admin can end the call' });
    }

    await query(
      `UPDATE hangout_video_calls SET status='ended', ended_at=NOW(), ended_by=$1 WHERE id=$2`,
      [user.id, callId]
    );

    getRedis().del(`hangout:active_call:${groupId}`).catch(() => {});
    emitToHangoutGroup(groupId, 'hangout:call:ended', { groupId, callId });

    logger.info(`endCall: group=${groupId} call=${callId} endedBy=${user.id}`);
    return res.json({ success: true });
  } catch (err) {
    logger.error('endCall error', err);
    return res.status(500).json({ error: 'Failed to end call' });
  }
}

// POST /api/webapp/hangouts/groups/:id/call/leave
async function leaveCall(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    if (!(await isMember(groupId, user.id))) return res.status(403).json({ error: 'Not a member of this group' });

    const { rows: callRows } = await query(
      `SELECT id FROM hangout_video_calls WHERE group_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
      [groupId]
    );
    if (callRows.length === 0) return res.status(404).json({ error: 'No active call for this group' });

    const callId = callRows[0].id;
    await query(
      `UPDATE hangout_call_participants SET left_at = NOW()
       WHERE call_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [callId, user.id]
    );

    const count = await getActiveParticipantCount(callId);
    getRedis().del(`hangout:active_call:${groupId}`).catch(() => {});
    emitToHangoutGroup(groupId, 'hangout:call:participant-left', {
      callId,
      userId: user.id,
      participantCount: count,
    });

    return res.json({ ok: true, participantCount: count });
  } catch (err) {
    logger.error('leaveCall error', err);
    return res.status(500).json({ error: 'Failed to leave call' });
  }
}

// POST /api/webapp/hangouts/groups/:id/link-telegram
async function linkTelegramGroup(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  const { telegramChatId, telegramInviteLink } = req.body;
  if (!telegramChatId) return res.status(400).json({ error: 'telegramChatId is required' });

  try {
    // Only owner or admin can link
    const { rows: memberRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';
    if (!isAdminRole && (!memberRows[0] || memberRows[0].role !== 'owner')) {
      return res.status(403).json({ error: 'Only the group owner can link a Telegram group' });
    }

    await query(
      `UPDATE hangout_groups SET telegram_chat_id = $1, telegram_invite_link = $2 WHERE id = $3`,
      [telegramChatId, telegramInviteLink || null, groupId]
    );

    // Invalidate security cache so newly linked group is recognized immediately
    invalidateLinkedCache();

    return res.json({ success: true });
  } catch (err) {
    logger.error('linkTelegramGroup error', err);
    return res.status(500).json({ error: 'Failed to link Telegram group' });
  }
}

// GET /api/webapp/hangouts/groups/:id/video-chat-status
async function getVideoChatStatus(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    const { rows } = await query(
      `SELECT telegram_chat_id, telegram_invite_link FROM hangout_groups WHERE id = $1`,
      [groupId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    // CRIT-02: membership gate — Telegram invite links must not leak to non-members
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'superadmin') {
      const { rows: memberCheck } = await query(
        'SELECT 1 FROM hangout_group_members WHERE group_id=$1 AND user_id=$2 AND (is_banned IS NULL OR is_banned=false)',
        [groupId, user.id]
      );
      if (memberCheck.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
    }

    const { telegram_chat_id, telegram_invite_link } = rows[0];

    if (!telegram_chat_id) {
      return res.json({ active: false, inviteLink: null });
    }

    // Check in-memory cache first (30s TTL)
    const cacheKey = String(telegram_chat_id);
    const cached = _videoChatCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < VIDEO_CHAT_CACHE_TTL) {
      return res.json({ active: cached.active, inviteLink: telegram_invite_link || null });
    }

    let active = false;
    try {
      const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram_chat_id }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      active = !!(data.ok && data.result && data.result.video_chat && data.result.video_chat.has_participants);
    } catch (tgErr) {
      logger.warn(`getVideoChatStatus: Telegram getChat failed for ${telegram_chat_id}: ${tgErr.message}`);
      active = false;
    }

    _videoChatCache.set(cacheKey, { active, ts: Date.now() });
    return res.json({ active, inviteLink: telegram_invite_link || null });
  } catch (err) {
    logger.error('getVideoChatStatus error', err);
    return res.status(500).json({ error: 'Failed to get video chat status' });
  }
}

// POST /api/webapp/hangouts/groups/:id/unlink-telegram
async function unlinkTelegramGroup(req, res) {
  const user = authGuard(req, res); if (!user) return;
  const groupId = parseInt(req.params.id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ error: 'Invalid group ID' });

  try {
    // Only owner or admin can unlink
    const { rows: memberRows } = await query(
      `SELECT role FROM hangout_group_members WHERE group_id=$1 AND user_id=$2`,
      [groupId, user.id]
    );
    const isAdminRole = (user.role || '').toLowerCase() === 'admin' || (user.role || '').toLowerCase() === 'superadmin';
    if (!isAdminRole && (!memberRows[0] || memberRows[0].role !== 'owner')) {
      return res.status(403).json({ error: 'Only the group owner can unlink a Telegram group' });
    }

    // Fetch old telegram_chat_id before clearing so we can invalidate the correct cache key
    const { rows: oldRows } = await query(
      `SELECT telegram_chat_id FROM hangout_groups WHERE id = $1`, [groupId]
    );
    await query(
      `UPDATE hangout_groups SET telegram_chat_id = NULL, telegram_invite_link = NULL WHERE id = $1`,
      [groupId]
    );

    invalidateLinkedCache();
    if (oldRows[0]?.telegram_chat_id) {
      _videoChatCache.delete(String(oldRows[0].telegram_chat_id));
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error('unlinkTelegramGroup error', err);
    return res.status(500).json({ error: 'Failed to unlink Telegram group' });
  }
}
