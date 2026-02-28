'use strict';

/**
 * atprotoController.js
 *
 * HTTP handlers for ATProto / Bluesky integration:
 *   GET  /api/atproto/profile        — fetch linked Bluesky profile data
 *   POST /api/webapp/auth/atproto/unlink — unlink Bluesky account
 *   POST /api/webapp/social/posts/:postId/crosspost-bluesky — cross-post to Bluesky
 */

const logger = require('../../../utils/logger');
const { query } = require('../../../config/postgres');
const atproto = require('../../services/atprotoOAuthService');

// ---------------------------------------------------------------------------
// GET /api/atproto/profile
//
// Returns the authenticated user's linked Bluesky profile, fetched live from
// the ATProto network via the stored OAuth session (DPoP-bound).
//
// Response:
//   { success: true,  linked: true,  profile: { did, handle, displayName, ... } }
//   { success: true,  linked: false, profile: null }
//   { success: false, error: "..." }  on 401 / 500
// ---------------------------------------------------------------------------

const getAtprotoProfile = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;

  if (!did) {
    return res.json({ success: true, linked: false, profile: null });
  }

  try {
    const agent = await atproto.restoreSession(did);
    const profileRes = await agent.getProfile({ actor: did });
    const p = profileRes.data;

    return res.json({
      success: true,
      linked: true,
      profile: {
        did: p.did,
        handle: p.handle,
        displayName: p.displayName || null,
        description: p.description || null,
        avatar: p.avatar || null,
        banner: p.banner || null,
        followersCount: p.followersCount ?? 0,
        followsCount: p.followsCount ?? 0,
        postsCount: p.postsCount ?? 0,
        profileUrl: `https://bsky.app/profile/${p.handle}`,
        indexedAt: p.indexedAt || null,
      },
    });
  } catch (err) {
    // Session expired / revoked — clear it from the DB and session
    if (
      err.message?.includes('Token') ||
      err.message?.includes('token') ||
      err.message?.includes('session') ||
      err.status === 401 ||
      err.status === 400
    ) {
      logger.warn('[ATProto] Stored session invalid, clearing', { did, err: err.message });

      // Clear from DB
      try {
        await query('DELETE FROM atproto_oauth_sessions WHERE did = $1', [did], { cache: false });
        await query(
          'UPDATE users SET atproto_did = NULL, atproto_handle = NULL, atproto_pds_url = NULL WHERE id = $1',
          [sessionUser.id],
          { cache: false }
        );
      } catch (cleanupErr) {
        logger.error('[ATProto] Cleanup error:', cleanupErr);
      }

      // Clear from session
      if (req.session.user) {
        req.session.user.atproto_did = null;
        req.session.user.atproto_handle = null;
        req.session.user.atproto_pds_url = null;
        if (req.session.user.auth_methods) {
          req.session.user.auth_methods.atproto = false;
        }
        req.session.save(() => {});
      }

      return res.json({
        success: true,
        linked: false,
        profile: null,
        message: 'Bluesky session expired. Please re-link your account.',
      });
    }

    logger.error('[ATProto] getAtprotoProfile error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Bluesky profile' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/auth/atproto/unlink
//
// Removes the ATProto/Bluesky identity from the user's account.
// If Telegram or X is still linked, the session is preserved. If Bluesky was
// the only auth method, the session is destroyed.
// ---------------------------------------------------------------------------

const unlinkAtproto = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;

  try {
    // Attempt to revoke the OAuth session at the PDS (best-effort)
    if (did) {
      try {
        const client = await atproto.getClient();
        const oauthSession = await client.restore(did);
        if (oauthSession && typeof oauthSession.signOut === 'function') {
          await oauthSession.signOut();
        }
      } catch (revokeErr) {
        // Session may already be expired — log and continue
        logger.debug('[ATProto] Revocation during unlink (non-fatal):', revokeErr.message);
      }

      // Remove ATProto session from DB
      await query('DELETE FROM atproto_oauth_sessions WHERE did = $1', [did], { cache: false });
    }

    // Clear columns from users table
    await query(
      'UPDATE users SET atproto_did = NULL, atproto_handle = NULL, atproto_pds_url = NULL WHERE id = $1',
      [sessionUser.id],
      { cache: false }
    );

    logger.info('[ATProto] Unlinked Bluesky account for user', { userId: sessionUser.id, did });

    // Update the express session
    const hasTelegram = !!req.session.user?.auth_methods?.telegram;
    const hasX = !!req.session.user?.auth_methods?.x;

    if (!hasTelegram && !hasX) {
      // Bluesky was the only auth method — destroy the session
      req.session.destroy((err) => {
        if (err) logger.error('[ATProto] Session destroy error during unlink:', err);
      });
      res.clearCookie('__pnptv_sid');
      return res.json({ success: true, message: 'Bluesky account unlinked. You have been logged out.' });
    }

    // Preserve session, just clear the ATProto fields
    req.session.user.atproto_did = null;
    req.session.user.atproto_handle = null;
    req.session.user.atproto_pds_url = null;
    if (req.session.user.auth_methods) {
      req.session.user.auth_methods.atproto = false;
    }

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.json({ success: true, message: 'Bluesky account unlinked successfully.' });
  } catch (err) {
    logger.error('[ATProto] unlinkAtproto error:', err);
    return res.status(500).json({ success: false, error: 'Failed to unlink Bluesky account' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/webapp/social/posts/:postId/crosspost-bluesky
//
// Publishes an existing PNPtv social post to the user's Bluesky account.
// Requires the user to have a linked ATProto session.
// Stores the resulting AT URI + CID back on the social_posts row.
// ---------------------------------------------------------------------------

const crossPostToBluesky = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const postId = parseInt(req.params.postId, 10);
  if (!postId || isNaN(postId)) {
    return res.status(400).json({ success: false, error: 'Invalid post ID' });
  }

  const did = sessionUser.atproto_did;
  if (!did) {
    return res.status(400).json({
      success: false,
      error: 'No Bluesky account linked. Link your account first.',
    });
  }

  try {
    // Fetch the post — only the author can cross-post it
    const postResult = await query(
      `SELECT id, user_id, content, bluesky_uri FROM social_posts WHERE id = $1 AND is_deleted = false`,
      [postId],
      { cache: false }
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const post = postResult.rows[0];

    if (post.user_id !== sessionUser.id) {
      return res.status(403).json({ success: false, error: 'You can only cross-post your own posts' });
    }

    if (post.bluesky_uri) {
      return res.json({
        success: true,
        already_posted: true,
        uri: post.bluesky_uri,
        message: 'This post has already been shared to Bluesky.',
      });
    }

    // Restore the ATProto OAuth agent for this user
    const agent = await atproto.restoreSession(did);

    // Bluesky posts are limited to 300 characters
    const MAX_BSKY_LENGTH = 300;
    let text = post.content;

    if (text.length > MAX_BSKY_LENGTH) {
      // Truncate with a notice
      const truncated = text.slice(0, MAX_BSKY_LENGTH - 25);
      text = `${truncated}… [continued on PNPtv!]`;
    }

    // Create the post record on Bluesky
    const bskyResponse = await agent.post({
      text,
      createdAt: new Date().toISOString(),
    });

    const uri = bskyResponse.uri;
    const cid = bskyResponse.cid;

    // Persist the Bluesky URI + CID back to the social_posts row
    await query(
      'UPDATE social_posts SET bluesky_uri = $1, bluesky_cid = $2 WHERE id = $3',
      [uri, cid, postId],
      { cache: false }
    );

    logger.info('[ATProto] Cross-posted to Bluesky', { postId, userId: sessionUser.id, uri });

    return res.json({ success: true, uri, cid });
  } catch (err) {
    // Token / session errors — handle gracefully
    if (err.status === 401 || err.message?.includes('token') || err.message?.includes('session')) {
      return res.status(401).json({
        success: false,
        error: 'Bluesky session expired. Please re-link your account.',
        reauth_required: true,
      });
    }

    // Rate limit from Bluesky
    if (err.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'Bluesky rate limit reached. Please try again in a few minutes.',
      });
    }

    logger.error('[ATProto] crossPostToBluesky error:', err);
    return res.status(500).json({ success: false, error: 'Failed to post to Bluesky' });
  }
};

// ---------------------------------------------------------------------------
// GET /api/atproto/feed
//
// Returns the authenticated user's Bluesky home timeline.
// Fetched live via the stored OAuth session (DPoP-bound).
// ---------------------------------------------------------------------------

const getAtprotoFeed = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;
  if (!did) {
    return res.json({ success: true, linked: false, feed: [] });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const cursor = req.query.cursor || undefined;

  try {
    const agent = await atproto.restoreSession(did);
    const result = await agent.getTimeline({ limit, cursor });

    const feed = (result.data.feed || []).map((item) => {
      const post = item.post;
      return {
        uri: post.uri,
        cid: post.cid,
        source: 'bluesky',
        author: {
          did: post.author.did,
          handle: post.author.handle,
          displayName: post.author.displayName || null,
          avatar: post.author.avatar || null,
        },
        text: post.record?.text || '',
        createdAt: post.record?.createdAt || post.indexedAt || null,
        likeCount: post.likeCount ?? 0,
        repostCount: post.repostCount ?? 0,
        replyCount: post.replyCount ?? 0,
        indexedAt: post.indexedAt || null,
        embed: post.embed || null,
        reason: item.reason || null,
      };
    });

    return res.json({
      success: true,
      linked: true,
      feed,
      cursor: result.data.cursor || null,
    });
  } catch (err) {
    if (err.status === 401 || err.message?.includes('token') || err.message?.includes('session')) {
      return res.json({ success: true, linked: false, feed: [], expired: true });
    }
    logger.error('[ATProto] getAtprotoFeed error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch Bluesky feed' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/atproto/like/:uri/:cid
//
// Like a Bluesky post by its AT Protocol URI + CID.
// ---------------------------------------------------------------------------

const likeBlueskyPost = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;
  if (!did) {
    return res.status(400).json({ success: false, error: 'No Bluesky account linked' });
  }

  const { uri, cid } = req.body;
  if (!uri || !cid) {
    return res.status(400).json({ success: false, error: 'uri and cid are required' });
  }

  // Basic AT URI validation
  if (!uri.startsWith('at://')) {
    return res.status(400).json({ success: false, error: 'Invalid AT Protocol URI' });
  }

  try {
    const agent = await atproto.restoreSession(did);
    const result = await agent.like(uri, cid);

    return res.json({ success: true, uri: result.uri, cid: result.cid });
  } catch (err) {
    if (err.status === 401 || err.message?.includes('token')) {
      return res.status(401).json({ success: false, error: 'Bluesky session expired', reauth_required: true });
    }
    logger.error('[ATProto] likeBlueskyPost error:', err);
    return res.status(500).json({ success: false, error: 'Failed to like post on Bluesky' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/atproto/repost/:uri/:cid
//
// Repost a Bluesky post.
// ---------------------------------------------------------------------------

const repostBlueskyPost = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;
  if (!did) {
    return res.status(400).json({ success: false, error: 'No Bluesky account linked' });
  }

  const { uri, cid } = req.body;
  if (!uri || !cid) {
    return res.status(400).json({ success: false, error: 'uri and cid are required' });
  }

  if (!uri.startsWith('at://')) {
    return res.status(400).json({ success: false, error: 'Invalid AT Protocol URI' });
  }

  try {
    const agent = await atproto.restoreSession(did);
    const result = await agent.repost(uri, cid);

    return res.json({ success: true, uri: result.uri, cid: result.cid });
  } catch (err) {
    if (err.status === 401 || err.message?.includes('token')) {
      return res.status(401).json({ success: false, error: 'Bluesky session expired', reauth_required: true });
    }
    logger.error('[ATProto] repostBlueskyPost error:', err);
    return res.status(500).json({ success: false, error: 'Failed to repost on Bluesky' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/atproto/follow
//
// Follow a Bluesky user by DID.
// ---------------------------------------------------------------------------

const followBlueskyUser = async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser?.id) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const did = sessionUser.atproto_did;
  if (!did) {
    return res.status(400).json({ success: false, error: 'No Bluesky account linked' });
  }

  const { targetDid } = req.body;
  if (!targetDid || !targetDid.startsWith('did:')) {
    return res.status(400).json({ success: false, error: 'Valid targetDid is required (must start with "did:")' });
  }

  // Prevent self-follow
  if (targetDid === did) {
    return res.status(400).json({ success: false, error: 'Cannot follow yourself' });
  }

  try {
    const agent = await atproto.restoreSession(did);
    const result = await agent.follow(targetDid);

    return res.json({ success: true, uri: result.uri, cid: result.cid });
  } catch (err) {
    if (err.status === 401 || err.message?.includes('token')) {
      return res.status(401).json({ success: false, error: 'Bluesky session expired', reauth_required: true });
    }
    logger.error('[ATProto] followBlueskyUser error:', err);
    return res.status(500).json({ success: false, error: 'Failed to follow user on Bluesky' });
  }
};

module.exports = {
  getAtprotoProfile,
  unlinkAtproto,
  crossPostToBluesky,
  getAtprotoFeed,
  likeBlueskyPost,
  repostBlueskyPost,
  followBlueskyUser,
};
