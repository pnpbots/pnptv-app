const axios = require('axios');
const logger = require('../utils/logger');

// SSRF defense — allowed hostnames for SoundCloud requests
const ALLOWED_INPUT_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com', 'snd.sc']);
const SHORT_URL_HOSTS = new Set(['on.soundcloud.com', 'snd.sc']);
// RFC1918, link-local, and loopback CIDR ranges (string-prefix checks — no external library needed)
const PRIVATE_PREFIXES = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '127.', '0.', '169.254.', '::1', 'fc', 'fd'];

/**
 * Reject URLs that resolve to private/loopback IPs.
 * axios doesn't automatically block RFC1918 destinations; we do it here
 * as a defensive layer even though the allowlist should catch SSRF first.
 */
function isPrivateHostname(hostname) {
  // Numeric IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return PRIVATE_PREFIXES.some(p => hostname.startsWith(p));
  }
  // IPv6
  if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('[::1]')) {
    return true;
  }
  return false;
}

/**
 * Parse a URL string and validate it is an allowed SoundCloud host.
 * Throws if invalid or disallowed.
 */
function assertAllowedUrl(rawUrl, allowedHosts = ALLOWED_INPUT_HOSTS) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(host)) {
    throw new Error(`Disallowed hostname: ${host}`);
  }
  if (isPrivateHostname(host)) {
    throw new Error(`Hostname resolves to private IP range: ${host}`);
  }
}

// Canonical SoundCloud hostnames allowed after redirect resolution
const CANONICAL_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);

class SoundCloudService {
  /**
   * Resolve SoundCloud track metadata from URL
   * @param {string} trackUrl - Full SoundCloud track URL
   * @returns {Promise<Object|null>} Metadata object
   */
  static async resolveTrack(trackUrl) {
    try {
      logger.info(`Resolving SoundCloud track: ${trackUrl}`);

      // SSRF fix: validate input URL BEFORE any outbound request
      assertAllowedUrl(trackUrl, ALLOWED_INPUT_HOSTS);

      // Resolve short URLs (on.soundcloud.com, snd.sc) to canonical soundcloud.com URLs
      let parsedInput;
      try { parsedInput = new URL(trackUrl); } catch { parsedInput = null; }
      if (parsedInput && SHORT_URL_HOSTS.has(parsedInput.hostname.toLowerCase())) {
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

        // SSRF fix: re-validate the resolved URL — must be canonical soundcloud.com
        assertAllowedUrl(trackUrl, CANONICAL_HOSTS);
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

  /**
   * Extract the artist profile URL from a SoundCloud track URL.
   * e.g. https://soundcloud.com/artist-name/track-name → https://soundcloud.com/artist-name
   * Works with or without trailing slashes and with query strings.
   * Returns null if the URL doesn't look like a track URL (i.e. already an artist page).
   *
   * @param {string} trackUrl - Full SoundCloud track URL
   * @returns {string|null} Artist profile URL, or null if it cannot be determined
   */
  static extractArtistUrl(trackUrl) {
    try {
      const clean = trackUrl.split('?')[0].replace(/\/$/, '');
      // Must be soundcloud.com/<artist>/<track> — exactly two path segments after the host
      const match = clean.match(/^(https?:\/\/(?:www\.)?soundcloud\.com\/([^/]+))\/[^/]+$/);
      if (!match) return null;
      return match[1]; // https://soundcloud.com/<artist>
    } catch {
      return null;
    }
  }

  /**
   * Fetch all (up to 20) tracks from an artist profile URL.
   *
   * Strategy:
   *  1. Fetch the artist page HTML.
   *  2. Try to parse the `window.__sc_hydration` JSON blob that SoundCloud
   *     injects into every server-rendered page — it contains full track objects
   *     with `permalink_url` fields.
   *  3. Fall back to regex-scraping `soundcloud.com/<artist>/<track>` href
   *     patterns from the raw HTML.
   *  4. Deduplicate, limit to 20 URLs, then call resolveTrack() on each one
   *     (resolveTrack uses the public OEmbed API — no key needed).
   *
   * @param {string} artistUrl - Artist profile URL, e.g. https://soundcloud.com/artist-name
   * @returns {Promise<Array<Object>>} Array of track metadata objects (same shape as resolveTrack)
   */
  static async getArtistTracks(artistUrl) {
    try {
      logger.info(`Fetching artist tracks from SoundCloud: ${artistUrl}`);

      // Normalize: strip trailing slash and query string
      const baseArtistUrl = artistUrl.split('?')[0].replace(/\/$/, '');

      // Extract the artist slug from the URL for later path filtering
      const slugMatch = baseArtistUrl.match(/soundcloud\.com\/([^/]+)$/);
      if (!slugMatch) {
        logger.warn(`getArtistTracks: cannot extract artist slug from "${artistUrl}"`);
        return [];
      }
      const artistSlug = slugMatch[1];

      // Fetch the artist page HTML
      let html;
      try {
        const resp = await axios.get(baseArtistUrl, {
          timeout: 15000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          maxRedirects: 5
        });
        html = resp.data;
      } catch (fetchErr) {
        logger.error(`getArtistTracks: failed to fetch artist page for "${artistSlug}":`, fetchErr.message);
        return [];
      }

      if (typeof html !== 'string' || html.length === 0) {
        logger.warn(`getArtistTracks: empty HTML body for "${artistSlug}"`);
        return [];
      }

      // --- Strategy 1: parse window.__sc_hydration ---
      const trackUrls = new Set();

      const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
      if (hydrationMatch) {
        try {
          const hydration = JSON.parse(hydrationMatch[1]);
          for (const entry of hydration) {
            // Each entry is { hydratable: string, data: {...} }
            const data = entry && entry.data;
            if (!data) continue;

            // Top-level track object
            if (data.kind === 'track' && data.permalink_url) {
              trackUrls.add(data.permalink_url.split('?')[0]);
              continue;
            }

            // Collection of tracks (e.g. a user's track list page)
            if (Array.isArray(data.collection)) {
              for (const item of data.collection) {
                if (item && item.kind === 'track' && item.permalink_url) {
                  trackUrls.add(item.permalink_url.split('?')[0]);
                }
              }
            }

            // Nested tracks inside playlists / likes
            if (data.tracks && Array.isArray(data.tracks)) {
              for (const item of data.tracks) {
                if (item && item.kind === 'track' && item.permalink_url) {
                  trackUrls.add(item.permalink_url.split('?')[0]);
                }
              }
            }
          }
          logger.info(`getArtistTracks: hydration parse found ${trackUrls.size} track URL(s) for "${artistSlug}"`);
        } catch (parseErr) {
          logger.warn(`getArtistTracks: hydration JSON parse failed for "${artistSlug}":`, parseErr.message);
        }
      }

      // --- Strategy 2: regex scrape as fallback ---
      if (trackUrls.size === 0) {
        logger.info(`getArtistTracks: falling back to regex scrape for "${artistSlug}"`);
        // Match href="https://soundcloud.com/<artist>/<track>" patterns
        // Exclude: sets, albums, reposts, profile sub-pages (likes, following, etc.)
        const hrefRegex = new RegExp(
          `https://soundcloud\\.com/${escapeRegExp(artistSlug)}/(?!sets/|albums/|reposts/|likes/|following/|followers/)[^/"'?#]+`,
          'g'
        );
        let m;
        while ((m = hrefRegex.exec(html)) !== null) {
          trackUrls.add(m[0].split('?')[0]);
          if (trackUrls.size >= 20) break;
        }
        logger.info(`getArtistTracks: regex scrape found ${trackUrls.size} track URL(s) for "${artistSlug}"`);
      }

      if (trackUrls.size === 0) {
        logger.warn(`getArtistTracks: no tracks found for "${artistSlug}" — page may require JS rendering`);
        return [];
      }

      // Limit to 20 and resolve metadata for each track
      const limitedUrls = Array.from(trackUrls).slice(0, 20);
      logger.info(`getArtistTracks: resolving metadata for ${limitedUrls.length} track(s) for "${artistSlug}"`);

      // Resolve concurrently but cap parallelism at 5 to avoid hammering OEmbed
      const results = [];
      const CONCURRENCY = 5;
      for (let i = 0; i < limitedUrls.length; i += CONCURRENCY) {
        const batch = limitedUrls.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(batch.map((url) => SoundCloudService.resolveTrack(url)));
        for (const outcome of settled) {
          if (outcome.status === 'fulfilled' && outcome.value !== null) {
            results.push(outcome.value);
          }
        }
      }

      logger.info(`getArtistTracks: resolved ${results.length} track(s) for "${artistSlug}"`);
      return results;
    } catch (error) {
      logger.error('getArtistTracks: unexpected error:', error.message);
      return [];
    }
  }
}

/**
 * Escape a string for use inside a RegExp character class / pattern.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = SoundCloudService;
