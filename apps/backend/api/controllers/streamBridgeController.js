'use strict';

const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');

/**
 * GET /api/webapp/live/my-channel
 *
 * Returns the authenticated user's assigned Restreamer channel details,
 * including the derived stream key and internal RTMP ingest URL for browser
 * streaming via the WebSocket bridge.
 *
 * The stream key is the RTMP input name extracted from the channel slug:
 * 'pnptv-santino' → 'santino'. The RTMP URL uses the internal Docker
 * hostname so the backend FFmpeg process can reach Restreamer directly.
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

    const rtmpToken = process.env.RESTREAMER_RTMP_TOKEN;
    const rtmpUrl = rtmpToken
      ? `rtmp://restreamer:1935/live/${streamKey}?token=${rtmpToken}`
      : `rtmp://restreamer:1935/live/${streamKey}`;

    return res.json({
      success: true,
      channel: {
        ref: channelRef,
        streamKey,
        // rtmpUrl intentionally omitted — contains RESTREAMER_RTMP_TOKEN and is
        // only needed by the backend FFmpeg bridge, never by the browser client.
      },
    });
  } catch (err) {
    logger.error('getMyChannel error', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve channel info' });
  }
};

module.exports = { getMyChannel };
