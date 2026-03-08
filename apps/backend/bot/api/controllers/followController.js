'use strict';

const { query } = require('../../../config/postgres');
const logger = require('../../../utils/logger');
const NotificationEmitter = require('../../services/notificationEmitter');

const { isEnforcedFollow } = require('../../services/followService');
const { validateTierFresh } = require('../../services/accessService');

const authGuard = (req, res) => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  return user;
};

// ── Follow ────────────────────────────────────────────────────────────────────

const followUser = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.body;

  if (!targetId) return res.status(400).json({ error: 'userId required' });
  if (String(targetId) === String(actor.id)) return res.status(400).json({ error: 'Cannot follow yourself' });

  try {
    // Check target exists
    const targetRes = await query('SELECT id, username, first_name FROM users WHERE id = $1', [targetId]);
    if (!targetRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const target = targetRes.rows[0];

    // Insert follow — ON CONFLICT DO NOTHING makes this idempotent
    const { rowCount } = await query(
      'INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [actor.id, targetId]
    );

    if (rowCount > 0) {
      // Increment counters only when a new row was inserted
      await query('UPDATE users SET following_count = following_count + 1 WHERE id = $1', [actor.id]);
      await query('UPDATE users SET followers_count = followers_count + 1 WHERE id = $1', [targetId]);

      // Fire notification (fire-and-forget)
      NotificationEmitter.emit({
        type: 'follow',
        category: 'social',
        priority: 'normal',
        actorId: actor.id,
        targetUserId: String(targetId),
        entityType: 'user',
        entityId: String(actor.id),
        message: `${actor.first_name || actor.firstName || actor.username || 'Someone'} started following you`,
      });
    }

    // Return updated counts for the target profile
    const countsRes = await query(
      'SELECT followers_count, following_count FROM users WHERE id = $1',
      [targetId]
    );
    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: true,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('followUser error', err);
    return res.status(500).json({ error: 'Failed to follow user' });
  }
};

// ── Unfollow ──────────────────────────────────────────────────────────────────

const unfollowUser = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.body;

  if (!targetId) return res.status(400).json({ error: 'userId required' });

  // Block unfollowing enforced accounts
  if (isEnforcedFollow(targetId)) {
    return res.status(403).json({ error: 'This account cannot be unfollowed' });
  }

  try {
    const { rowCount } = await query(
      'DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2',
      [actor.id, targetId]
    );

    if (rowCount > 0) {
      await query('UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1', [actor.id]);
      await query('UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = $1', [targetId]);
    }

    const countsRes = await query(
      'SELECT followers_count, following_count FROM users WHERE id = $1',
      [targetId]
    );
    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: false,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('unfollowUser error', err);
    return res.status(500).json({ error: 'Failed to unfollow user' });
  }
};

// ── Follow Status ─────────────────────────────────────────────────────────────

const getFollowStatus = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;

  if (!targetId) return res.status(400).json({ error: 'userId required' });

  try {
    const [followRes, countsRes] = await Promise.all([
      query(
        'SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2',
        [actor.id, targetId]
      ),
      query('SELECT followers_count, following_count FROM users WHERE id = $1', [targetId]),
    ]);

    const counts = countsRes.rows[0] || { followers_count: 0, following_count: 0 };

    return res.json({
      success: true,
      isFollowing: followRes.rowCount > 0,
      followerCount: counts.followers_count,
      followingCount: counts.following_count,
    });
  } catch (err) {
    logger.error('getFollowStatus error', err);
    return res.status(500).json({ error: 'Failed to get follow status' });
  }
};

// ── Followers List ────────────────────────────────────────────────────────────

const getFollowers = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor || null;

  try {
    const rows = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, uf.created_at AS followed_at
       FROM user_follows uf
       JOIN users u ON u.id = uf.follower_id
       WHERE uf.following_id = $1
         AND ($2::timestamptz IS NULL OR uf.created_at < $2::timestamptz)
       ORDER BY uf.created_at DESC
       LIMIT $3`,
      [targetId, cursor, limit + 1]
    );

    const hasMore = rows.rows.length > limit;
    const users = rows.rows.slice(0, limit).map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_file_id,
      followedAt: r.followed_at,
    }));

    return res.json({
      success: true,
      users,
      nextCursor: hasMore ? rows.rows[limit - 1].followed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error('getFollowers error', err);
    return res.status(500).json({ error: 'Failed to get followers' });
  }
};

// ── Following List ────────────────────────────────────────────────────────────

const getFollowing = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const { userId: targetId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursor = req.query.cursor || null;

  try {
    const rows = await query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.photo_file_id, uf.created_at AS followed_at
       FROM user_follows uf
       JOIN users u ON u.id = uf.following_id
       WHERE uf.follower_id = $1
         AND ($2::timestamptz IS NULL OR uf.created_at < $2::timestamptz)
       ORDER BY uf.created_at DESC
       LIMIT $3`,
      [targetId, cursor, limit + 1]
    );

    const hasMore = rows.rows.length > limit;
    const users = rows.rows.slice(0, limit).map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_file_id,
      followedAt: r.followed_at,
    }));

    return res.json({
      success: true,
      users,
      nextCursor: hasMore ? rows.rows[limit - 1].followed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error('getFollowing error', err);
    return res.status(500).json({ error: 'Failed to get following list' });
  }
};

// ── Following Feed ────────────────────────────────────────────────────────────

const getFollowingFeed = async (req, res) => {
  const actor = authGuard(req, res); if (!actor) return;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const cursorId = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
  const viewerRole = req.session?.user?.role || '';
  const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';
  // HIGH-04: re-validate PRIME tier from DB/cache to prevent stale-session access
  const viewerTier = await validateTierFresh(actor.id, req.session?.user?.tier || 'free');
  if (viewerTier !== (req.session?.user?.tier || 'free').toLowerCase()) {
    req.session.user.tier = viewerTier;
  }

  try {
    // Fetch viewer's blocked list for feed filtering (C-08)
    const blockedRes = await query('SELECT blocked FROM users WHERE id = $1', [actor.id]);
    const blockedIds = (blockedRes.rows[0]?.blocked || []).map(Number);

    // Build parameterized query
    // $1=actor.id, $2=limit+1, [$3=cursorId], $N=blockedIds
    const params = [actor.id, limit + 1];
    if (cursorId) params.push(cursorId);
    const blockedParam = blockedIds.length > 0 ? blockedIds : [];
    params.push(blockedParam);
    const blockedParamIdx = params.length;
    const cursorClause = cursorId ? `AND sp.id < $3` : '';

    const result = await query(
      `SELECT sp.id, sp.content, sp.media_url, sp.media_type, sp.media_urls, sp.video_thumbnail_url,
              sp.video_title, sp.video_description,
              sp.bluesky_uri, sp.bluesky_cid, sp.source_channel,
              sp.reply_to_id, sp.repost_of_id,
              sp.likes_count, sp.reposts_count, sp.replies_count,
              sp.is_exclusive, sp.is_shareable, sp.is_wof, sp.created_at,
              sp.is_promoted, sp.promoted_link, sp.promoted_link_label, sp.promoted_thumbnail,
              COALESCE(sp.content_tier, 'free') AS content_tier,
              u.id AS author_id, u.username AS author_username,
              u.first_name AS author_first_name, u.photo_file_id AS author_photo,
              u.creator_status AS author_creator_status, u.creator_type AS author_creator_type,
              u.creator_verified AS author_creator_verified, u.creator_price_usd AS author_creator_price,
              EXISTS(
                SELECT 1 FROM social_post_likes pl
                WHERE pl.post_id = sp.id AND pl.user_id = $1
              ) AS liked_by_me
       FROM social_posts sp
       JOIN user_follows uf ON sp.user_id = uf.following_id
       JOIN users u ON sp.user_id = u.id
       WHERE uf.follower_id = $1
         AND sp.is_deleted = FALSE
         AND sp.reply_to_id IS NULL
         ${cursorClause}
         AND sp.user_id != ALL($${blockedParamIdx}::text[])
       ORDER BY sp.id DESC
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const rawPosts = result.rows.slice(0, limit);

    // Determine content_locked for exclusive posts the viewer cannot access (H-02)
    const allowedTiers = new Set(['free']);
    if (!isAdmin) {
      if (viewerTier === 'member') allowedTiers.add('member');
      if (viewerTier === 'prime') { allowedTiers.add('member'); allowedTiers.add('prime'); }
    }

    const posts = rawPosts.map((r) => {
      const isValidPhoto = r.author_photo && (r.author_photo.startsWith('/') || r.author_photo.startsWith('http'));
      const postTier = (r.content_tier || 'free').toLowerCase();
      const isExclusivePost = r.is_exclusive === true || postTier === 'prime';
      const isAuthor = String(actor.id) === String(r.author_id);
      const viewerCanSee = isAdmin || isAuthor || allowedTiers.has(postTier) || allowedTiers.has(r.content_tier);
      const contentLocked = isExclusivePost && !viewerCanSee;

      return {
        id: r.id,
        content: contentLocked ? null : r.content,
        media_url: contentLocked ? null : r.media_url,
        media_type: contentLocked ? null : r.media_type,
        media_urls: contentLocked ? null : r.media_urls,
        video_thumbnail_url: r.video_thumbnail_url,
        video_title: r.video_title,
        video_description: r.video_description,
        bluesky_uri: r.bluesky_uri,
        bluesky_cid: r.bluesky_cid,
        source_channel: r.source_channel,
        reply_to_id: r.reply_to_id,
        repost_of_id: r.repost_of_id,
        likes_count: r.likes_count,
        reposts_count: r.reposts_count,
        replies_count: r.replies_count,
        is_exclusive: r.is_exclusive,
        is_shareable: r.is_shareable,
        is_wof: r.is_wof,
        created_at: r.created_at,
        is_promoted: r.is_promoted,
        promoted_link: r.promoted_link,
        promoted_link_label: r.promoted_link_label,
        promoted_thumbnail: r.promoted_thumbnail,
        content_tier: r.content_tier,
        author_id: r.author_id,
        author_username: r.author_username,
        author_first_name: r.author_first_name,
        author_photo: isValidPhoto ? r.author_photo : null,
        author_creator_status: r.author_creator_status,
        author_creator_type: r.author_creator_type,
        author_creator_verified: r.author_creator_verified,
        author_creator_price: r.author_creator_price,
        liked_by_me: r.liked_by_me,
        content_locked: contentLocked,
        blurred: contentLocked,
      };
    });

    return res.json({
      success: true,
      posts,
      nextCursor: hasMore ? String(result.rows[limit - 1].id) : null,
    });
  } catch (err) {
    logger.error('getFollowingFeed error', err);
    return res.status(500).json({ error: 'Failed to load following feed' });
  }
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowStatus,
  getFollowers,
  getFollowing,
  getFollowingFeed,
};
