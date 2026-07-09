'use strict';

const logger = require('../../../utils/logger');
const { getPool } = require('../../../config/postgres');

/**
 * GET /api/webapp/live/my-channel
 *
 * Returns the authenticated user's assigned Restreamer channel details,
 * including the derived stream key and public RTMP ingest URL for OBS.
 *
 * The stream key is the RTMP input name extracted from the channel slug:
 * 'pnptv-santino' → 'santino'.
 */
const getMyChannel = async (req, res) => {
  const user = req.session.user;

  try {
    const { rows } = await getPool().query(
      'SELECT live_channel FROM users WHERE id = $1',
      [user.id]
    );

    const channelRef = rows[0]?.live_channel ?? null;

    if (!channelRef) {
      return res.json({ success: true, channel: null });
    }

    // Derive stream key by stripping the 'pnptv-' prefix.
    // E.g. 'pnptv-santino' → 'santino'. For channels without the prefix,
    // the full slug is used as-is (defensive fallback).
    const streamKey = channelRef.startsWith('pnptv-')
      ? channelRef.slice('pnptv-'.length)
      : channelRef;

    // Return the public RTMP URL so creators can configure OBS.
    const restreamerPublicUrl = process.env.RESTREAMER_PUBLIC_URL || 'https://live.pnptv.app';
    const publicHost = restreamerPublicUrl.replace(/^https?:\/\//, '');
    const rtmpUrl = `rtmp://${publicHost}/live`;

    return res.json({
      success: true,
      channel: {
        ref: channelRef,
        streamKey,
        rtmpUrl,
      },
    });
  } catch (err) {
    logger.error('getMyChannel error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve channel info' });
  }
};

module.exports = { getMyChannel };
