const axios = require('axios');
const logger = require('../utils/logger');

class SoundCloudService {
  /**
   * Resolve SoundCloud track metadata from URL
   * @param {string} trackUrl - Full SoundCloud track URL
   * @returns {Promise<Object|null>} Metadata object
   */
  static async resolveTrack(trackUrl) {
    try {
      logger.info(`Resolving SoundCloud track: ${trackUrl}`);

      // Resolve short URLs (on.soundcloud.com, snd.sc) to canonical soundcloud.com URLs
      if (/^https?:\/\/(on\.soundcloud\.com|snd\.sc)\//i.test(trackUrl)) {
        try {
          const headResp = await axios.head(trackUrl, { maxRedirects: 5, timeout: 10000 });
          if (headResp.request?.res?.responseUrl) {
            trackUrl = headResp.request.res.responseUrl;
          }
        } catch (redirectErr) {
          // axios may throw on redirect but still resolve — check the response
          if (redirectErr.response?.headers?.location) {
            trackUrl = redirectErr.response.headers.location;
          } else if (redirectErr.request?.res?.responseUrl) {
            trackUrl = redirectErr.request.res.responseUrl;
          } else {
            logger.warn('SoundCloud short URL redirect failed, trying GET fallback', redirectErr.message);
            try {
              const getResp = await axios.get(trackUrl, { maxRedirects: 5, timeout: 10000 });
              if (getResp.request?.res?.responseUrl) {
                trackUrl = getResp.request.res.responseUrl;
              }
            } catch (getErr) {
              if (getErr.request?.res?.responseUrl) {
                trackUrl = getErr.request.res.responseUrl;
              }
            }
          }
        }
        // Strip query params from resolved URL for cleaner OEmbed lookup
        try { trackUrl = trackUrl.split('?')[0]; } catch { /* keep as-is */ }
        logger.info(`Resolved short URL to: ${trackUrl}`);
      }

      // Use SoundCloud's OEmbed API (no API key required for basic info)
      const response = await axios.get('https://soundcloud.com/oembed', {
        params: {
          url: trackUrl,
          format: 'json'
        }
      });

      const data = response.data;

      // Extract metadata
      // OEmbed doesn't provide duration, but it provides enough for the UI
      return {
        title: data.title,
        artist: data.author_name,
        coverUrl: data.thumbnail_url,
        html: data.html, // The widget iframe
        provider: 'soundcloud',
        url: trackUrl,
        // Parse track ID from the iframe HTML if possible
        externalId: this.extractTrackId(data.html)
      };
    } catch (error) {
      logger.error('Error resolving SoundCloud track:', error.message);
      return null;
    }
  }

  /**
   * Extract SoundCloud track ID from OEmbed HTML widget
   * @param {string} html - OEmbed HTML string
   * @returns {string|null} Track ID
   */
  static extractTrackId(html) {
    if (!html) return null;
    // Look for tracks/ID in the src URL
    const match = html.match(/api\.soundcloud\.com\/tracks\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Is this a valid SoundCloud URL?
   * @param {string} url - URL to check
   * @returns {boolean}
   */
  static isSoundCloudUrl(url) {
    return /^(https?:\/\/)?(www\.)?(soundcloud\.com|on\.soundcloud\.com|snd\.sc)\/.*$/.test(url);
  }
}

module.exports = SoundCloudService;
