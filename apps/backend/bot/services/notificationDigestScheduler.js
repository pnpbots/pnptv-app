'use strict';

/**
 * NotificationDigestScheduler
 *
 * Sends a daily HTML email digest to users who:
 *   1. Have unread notifications from the last 24 hours
 *   2. Have at least one notification_preferences key set to true (opted in)
 *   3. Have a verified email address on their account
 *   4. Were NOT active in the last 2 hours
 *
 * Fires once daily at 10:00 UTC.
 * Delivers in batches of 50 with a 1-second inter-batch delay to avoid SMTP throttling.
 * All per-user errors are caught and logged — the process is never crashed.
 *
 * Activity signal: routes.js writes `last_active:<userId>` (TTL 1 h) into Redis
 * whenever an authenticated request comes in. The SQL query pre-filters using
 * users.last_active < NOW() - INTERVAL '2 hours'. The Redis key then catches
 * users who became active after the query snapshot was taken.
 */

const { query }    = require('../../config/postgres');
const { cache }    = require('../../config/redis');
const logger       = require('../../utils/logger');
const emailService = require('./emailservice');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE        = 50;
const INTER_BATCH_DELAY = 1000; // ms between batches
const DIGEST_HOUR_UTC   = 10;   // 10:00 UTC daily

/**
 * Canonical mapping: notification type -> notification_preferences JSONB key.
 * Mirrors TYPE_TO_PREF in notificationEmitter.js.
 */
const TYPE_TO_PREF = {
  like:                   'likes',
  reply:                  'replies',
  dm:                     'dms',
  group_message:          'group_messages',
  group_join:             'group_joins',
  wof_winner:             'wof',
  payment:                'payments',
  announcement:           'announcements',
  system:                 'announcements',
  follow:                 'follows',
  hangout_call:           'hangout_calls',
  hangout_creator_joined: 'hangout_calls',
  reaction_post:          'reactions',
  reaction_chat:          'reactions',
  mention_post:           'mentions',
  mention_chat:           'mentions',
};

/**
 * Human-readable singular labels per notification type.
 * Pluralisation is handled at render time.
 */
const TYPE_LABELS = {
  like:                   { es: 'like nuevo',                    en: 'new like' },
  reply:                  { es: 'respuesta nueva',               en: 'new reply' },
  dm:                     { es: 'mensaje directo nuevo',         en: 'new direct message' },
  group_message:          { es: 'mensaje de grupo nuevo',        en: 'new group message' },
  group_join:             { es: 'nuevo miembro en grupo',        en: 'new group member' },
  wof_winner:             { es: 'nuevo ganador Wall of Fame',    en: 'new Wall of Fame winner' },
  payment:                { es: 'actualización de pago',         en: 'payment update' },
  announcement:           { es: 'anuncio nuevo',                 en: 'new announcement' },
  system:                 { es: 'aviso del sistema',             en: 'system notice' },
  follow:                 { es: 'nuevo seguidor',                en: 'new follower' },
  hangout_call:           { es: 'llamada de hangout nueva',      en: 'new hangout call' },
  hangout_creator_joined: { es: 'creador se unió al hangout',   en: 'creator joined hangout' },
  reaction_post:          { es: 'reacción a tu post',            en: 'reaction to your post' },
  reaction_chat:          { es: 'reacción en chat',              en: 'chat reaction' },
  mention_post:           { es: 'mención en un post',            en: 'post mention' },
  mention_chat:           { es: 'mención en chat',               en: 'chat mention' },
};

const TYPE_ICON = {
  like:                   '❤️',
  reply:                  '💬',
  dm:                     '✉️',
  group_message:          '👥',
  group_join:             '🙋',
  wof_winner:             '⭐',
  payment:                '💳',
  announcement:           '📢',
  system:                 '🔔',
  follow:                 '👤',
  hangout_call:           '📹',
  hangout_creator_joined: '🎬',
  reaction_post:          '🔥',
  reaction_chat:          '🔥',
  mention_post:           '📣',
  mention_chat:           '📣',
};

// ---------------------------------------------------------------------------
// Private utility functions
// ---------------------------------------------------------------------------

/**
 * Calculate milliseconds until the next occurrence of DIGEST_HOUR_UTC:00:00 UTC.
 * Guarantees at least 60 000 ms to prevent immediate double-fire on startup.
 */
function msUntilNextDigestTime() {
  const now  = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    DIGEST_HOUR_UTC, 0, 0, 0,
  ));

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return Math.max(next.getTime() - now.getTime(), 60_000);
}

/** Promisified sleep. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Basic format check. We rely on email_verified for real deliverability;
 * this just guards against obviously malformed strings slipping through.
 */
function isValidEmail(email) {
  return typeof email === 'string' &&
    email.length > 5 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class NotificationDigestScheduler {

  /**
   * Initialise the scheduler. Call once from bot.js on startup.
   * Schedules the first run at the next 10:00 UTC, then repeats every 24 h.
   */
  static start() {
    const delay    = msUntilNextDigestTime();
    const nextFire = new Date(Date.now() + delay).toISOString();

    logger.info(`NotificationDigestScheduler: first digest scheduled at ${nextFire}`);

    setTimeout(() => {
      NotificationDigestScheduler.runDigest();
      setInterval(() => NotificationDigestScheduler.runDigest(), 24 * 60 * 60 * 1000);
    }, delay);
  }

  /**
   * Execute one full digest run. Fetches qualifying users, sends emails in
   * batches, and logs a summary. Never throws.
   */
  static async runDigest() {
    logger.info('NotificationDigestScheduler: starting daily digest run');

    const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };

    try {
      const users = await NotificationDigestScheduler._fetchQualifyingUsers();
      logger.info(`NotificationDigestScheduler: ${users.length} qualifying users found`);

      if (users.length === 0) {
        logger.info('NotificationDigestScheduler: digest run complete — no qualifying users');
        return;
      }

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        for (const user of batch) {
          stats.processed++;
          try {
            await NotificationDigestScheduler._processUser(user, stats);
          } catch (err) {
            stats.errors++;
            logger.warn('NotificationDigestScheduler: unhandled per-user error', {
              userId: user.id,
              error:  err.message,
            });
          }
        }

        // Apply inter-batch delay after every batch except the last one.
        if (i + BATCH_SIZE < users.length) {
          await sleep(INTER_BATCH_DELAY);
        }
      }
    } catch (fatalErr) {
      logger.error('NotificationDigestScheduler: fatal error in runDigest', {
        error: fatalErr.message,
        stack: fatalErr.stack,
      });
    }

    logger.info('NotificationDigestScheduler: digest run complete', stats);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Query users who qualify for a digest email.
   *
   * Qualification (all conditions required):
   *   - At least one unread notification created in the last 24 hours
   *   - email IS NOT NULL AND email_verified = TRUE
   *   - last_active < NOW() - INTERVAL '2 hours'  (DB-level pre-filter)
   *   - At least one notification_preferences key is explicitly TRUE
   *     (i.e. the user has not disabled every single notification type)
   *
   * The JSONB aggregate type_counts is returned as { type: count, ... } so
   * we avoid a separate per-user query when building the email.
   *
   * @returns {Promise<Array<{
   *   id: string,
   *   first_name: string,
   *   email: string,
   *   language: string,
   *   notification_preferences: Object,
   *   type_counts: Object
   * }>>}
   */
  static async _fetchQualifyingUsers() {
    const sql = `
      SELECT
        u.id,
        u.first_name,
        u.email,
        u.language,
        u.notification_preferences,
        notif_agg.type_counts
      FROM users u
      INNER JOIN (
        SELECT
          target_user_id,
          jsonb_object_agg(type, cnt) AS type_counts
        FROM (
          SELECT
            target_user_id,
            type,
            COUNT(*) AS cnt
          FROM notifications
          WHERE
            is_read    = FALSE
            AND created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY target_user_id, type
        ) counted
        GROUP BY target_user_id
      ) notif_agg ON notif_agg.target_user_id = u.id
      WHERE
        u.email          IS NOT NULL
        AND u.email_verified = TRUE
        AND u.last_active    < NOW() - INTERVAL '2 hours'
        AND EXISTS (
          SELECT 1
          FROM jsonb_each(u.notification_preferences) kv
          WHERE kv.key != 'quiet_hours'
            AND (
              -- Legacy boolean format: key = true
              (jsonb_typeof(kv.value) = 'boolean' AND kv.value::text = 'true')
              -- New per-channel format: at least one channel enabled
              OR (jsonb_typeof(kv.value) = 'object' AND EXISTS (
                SELECT 1 FROM jsonb_each(kv.value) ch
                WHERE ch.value::text = 'true'
              ))
            )
        )
      ORDER BY u.id
    `;

    const { rows } = await query(sql, [], { cache: false });
    return rows;
  }

  /**
   * Handle one user: apply Redis activity guard, filter notification groups
   * against their preferences, generate HTML, and deliver the email.
   *
   * @param {Object} user   - Row from _fetchQualifyingUsers
   * @param {Object} stats  - Mutable stats object (mutated in place)
   */
  static async _processUser(user, stats) {
    // Format guard — defensive against unexpected DB data
    if (!isValidEmail(user.email)) {
      stats.skipped++;
      logger.debug('NotificationDigestScheduler: skipping user with invalid email format', {
        userId: user.id,
      });
      return;
    }

    // Redis activity guard: catches users who became active after the SQL
    // snapshot was taken. Key: `last_active:<userId>` (TTL 1 h set by routes.js).
    // ioredis automatically prepends the configured keyPrefix ('pnptv:').
    const isRecentlyActive = await cache.exists(`last_active:${user.id}`);
    if (isRecentlyActive) {
      stats.skipped++;
      logger.debug('NotificationDigestScheduler: skipping recently active user (Redis)', {
        userId: user.id,
      });
      return;
    }

    // Filter notification groups to types the user has enabled
    const prefs      = user.notification_preferences || {};
    const typeCounts = user.type_counts || {};

    const enabledGroups = Object.entries(typeCounts)
      .reduce((acc, [type, rawCount]) => {
        const prefKey = TYPE_TO_PREF[type];
        // Include the group if: type is unknown (no pref key) OR pref is not explicitly false
        if (!prefKey || prefs[prefKey] !== false) {
          const count = parseInt(rawCount, 10);
          if (count > 0) {
            acc.push({ type, count });
          }
        }
        return acc;
      }, [])
      .sort((a, b) => b.count - a.count); // highest count first

    if (enabledGroups.length === 0) {
      // Every unread type is disabled in this user's preferences
      stats.skipped++;
      return;
    }

    const totalCount = enabledGroups.reduce((sum, g) => sum + g.count, 0);
    const lang       = typeof user.language === 'string' && user.language.startsWith('es') ? 'es' : 'en';
    const isSpanish  = lang === 'es';

    const subject = isSpanish
      ? `PNPtv! — Tienes ${totalCount} notificaci${totalCount !== 1 ? 'ones' : 'ón'} nueva${totalCount !== 1 ? 's' : ''}`
      : `PNPtv! — You have ${totalCount} new notification${totalCount !== 1 ? 's' : ''}`;

    const html = NotificationDigestScheduler.generateDigestHtml(user, enabledGroups, lang);

    // Transporter guard
    if (!emailService.transporters || !emailService.transporters.pnptv) {
      stats.skipped++;
      logger.warn('NotificationDigestScheduler: pnptv SMTP transporter not configured — skipping all digests');
      return;
    }

    try {
      const result = await emailService.transporters.pnptv.sendMail({
        from:    '"PNPtv" <noreply@pnptv.app>',
        to:      user.email,
        subject,
        html,
      });

      stats.sent++;
      logger.debug('NotificationDigestScheduler: digest delivered', {
        userId:    user.id,
        messageId: result.messageId,
        total:     totalCount,
      });
    } catch (sendErr) {
      stats.errors++;
      logger.warn('NotificationDigestScheduler: sendMail failed', {
        userId: user.id,
        error:  sendErr.message,
      });
    }
  }

  /**
   * Generate the full HTML digest email.
   *
   * Visual style matches the existing PNPtv email family (same container
   * dimensions, colour palette, button gradient as emailservice.js).
   *
   * @param {Object}   user          - { first_name, language }
   * @param {Array}    groups        - [{ type, count }, ...] already sorted desc by count
   * @param {string}   lang          - 'es' | 'en'
   * @returns {string}               - Complete HTML document string
   */
  static generateDigestHtml(user, groups, lang) {
    const isSpanish  = lang === 'es';
    const name       = user.first_name || (isSpanish ? 'Miembro' : 'Member');
    const totalCount = groups.reduce((sum, g) => sum + g.count, 0);

    const heroHeading = isSpanish
      ? `Hola ${name}, tienes ${totalCount} notificaci${totalCount !== 1 ? 'ones' : 'ón'} nueva${totalCount !== 1 ? 's' : ''}`
      : `Hi ${name}, you have ${totalCount} new notification${totalCount !== 1 ? 's' : ''}`;

    const summaryLine = isSpanish
      ? 'Esto es lo que te perdiste en las últimas 24 horas'
      : "Here's what you missed in the last 24 hours";

    const sectionTitle  = isSpanish ? 'Resumen de notificaciones:' : 'Notification summary:';
    const ctaLabel      = isSpanish ? 'Abrir PNPtv!' : 'Open PNPtv!';
    const footerAuto    = isSpanish
      ? 'Este es un correo automático, por favor no respondas directamente a este mensaje.'
      : 'This is an automated email, please do not reply directly to this message.';
    const unsubscribe   = isSpanish
      ? 'Para dejar de recibir estos correos, actualiza tus preferencias de notificaciones en Configuración.'
      : 'To stop receiving these emails, update your notification preferences in Settings.';

    // Build the notification group rows
    const groupRows = groups.map(({ type, count }) => {
      const labelMap = TYPE_LABELS[type] || { es: type, en: type };
      const label    = labelMap[lang] || labelMap.en;
      const icon     = TYPE_ICON[type] || '🔔';

      // Build a pluralised count+label string that reads naturally
      let countLabel;
      if (isSpanish) {
        // Spanish: "3 likes nuevos", "1 like nuevo", "2 respuestas nuevas"
        const plural = count !== 1;
        // Pluralise the noun part: ends in vowel → +s, ends in consonant → +es
        let noun = label;
        if (plural) {
          if (/[aeiouáéíóú]$/i.test(noun)) {
            noun = noun + 's';
          } else if (!/s$/i.test(noun)) {
            noun = noun + 'es';
          }
        }
        countLabel = `${count} ${noun}`;
      } else {
        // English: simple +s for plurals, already included in label for known types
        const plural = count !== 1;
        let noun = label;
        if (plural && !/s$/.test(noun)) {
          noun = noun + 's';
        }
        countLabel = `${count} ${noun}`;
      }

      return `
            <tr>
              <td style="padding: 13px 0; border-bottom: 1px solid #f0f0f0; font-size: 15px; color: #333;">
                <span style="margin-right: 10px; font-size: 18px; vertical-align: middle;">${icon}</span>
                <strong style="vertical-align: middle;">${countLabel}</strong>
              </td>
            </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 3px solid #667eea;
    }
    .header h1 {
      color: #667eea;
      margin: 0;
      font-size: 32px;
    }
    .hero-band {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 22px 24px;
      border-radius: 8px;
      text-align: center;
      margin: 20px 0;
    }
    .hero-band h2 {
      margin: 0 0 6px 0;
      font-size: 20px;
      font-weight: bold;
    }
    .hero-band p {
      margin: 0;
      opacity: 0.88;
      font-size: 14px;
    }
    .content {
      padding: 10px 0 0 0;
    }
    .section-title {
      color: #555;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0 0 8px 0;
    }
    .notif-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 28px 0;
    }
    .cta-wrap {
      text-align: center;
      margin: 24px 0 32px 0;
    }
    .button {
      display: inline-block;
      padding: 14px 38px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: bold;
      font-size: 16px;
    }
    .footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #999;
      font-size: 12px;
      line-height: 1.9;
    }
    .footer a {
      color: #667eea;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="header">
      <h1>PNPtv!</h1>
    </div>

    <div class="hero-band">
      <h2>${heroHeading}</h2>
      <p>${summaryLine}</p>
    </div>

    <div class="content">
      <p class="section-title">${sectionTitle}</p>
      <table class="notif-table">
        <tbody>${groupRows}
        </tbody>
      </table>

      <div class="cta-wrap">
        <a href="https://pnptv.app" class="button">${ctaLabel}</a>
      </div>
    </div>

    <div class="footer">
      <p>PNPtv! &mdash; <a href="https://pnptv.app">pnptv.app</a></p>
      <p>${unsubscribe}</p>
      <p style="color: #bbb; margin-top: 4px;">${footerAuto}</p>
    </div>

  </div>
</body>
</html>`;
  }
  /**
   * Send a digest email for a single user immediately (for admin SMTP testing).
   * No time-window filter, no activity guard, no preference filter.
   * @param {string|number} userId
   * @returns {Promise<{sent: boolean, notificationCount?: number, reason?: string}>}
   */
  static async sendDigestForUser(userId) {
    try {
      const { rows: userRows } = await query(
        `SELECT id, email, first_name, language, notification_preferences, email_verified
         FROM users WHERE id = $1`,
        [String(userId)],
      );
      if (!userRows[0]) return { sent: false, reason: 'user_not_found' };
      const user = userRows[0];

      if (!user.email || !user.email_verified) return { sent: false, reason: 'no_verified_email' };
      if (!isValidEmail(user.email)) return { sent: false, reason: 'invalid_email_format' };

      const { rows: notifRows } = await query(
        `SELECT type, COUNT(*) AS cnt
         FROM notifications
         WHERE target_user_id = $1 AND is_read = FALSE
         GROUP BY type ORDER BY cnt DESC LIMIT 20`,
        [String(userId)],
      );
      if (notifRows.length === 0) return { sent: false, reason: 'no_unread_notifications' };

      const typeCounts = {};
      for (const row of notifRows) typeCounts[row.type] = parseInt(row.cnt, 10);

      const enabledGroups = Object.entries(typeCounts)
        .map(([type, count]) => ({ type, count }))
        .filter(({ count }) => count > 0)
        .sort((a, b) => b.count - a.count);

      const totalCount = enabledGroups.reduce((sum, g) => sum + g.count, 0);
      const lang = typeof user.language === 'string' && user.language.startsWith('es') ? 'es' : 'en';
      const isSpanish = lang === 'es';

      const subject = isSpanish
        ? `[TEST] PNPtv! — Tienes ${totalCount} notificaci${totalCount !== 1 ? 'ones' : 'ón'} nueva${totalCount !== 1 ? 's' : ''}`
        : `[TEST] PNPtv! — You have ${totalCount} new notification${totalCount !== 1 ? 's' : ''}`;

      const html = NotificationDigestScheduler.generateDigestHtml(
        { ...user, type_counts: typeCounts },
        enabledGroups,
        lang,
      );

      if (!emailService.transporters || !emailService.transporters.pnptv) {
        return { sent: false, reason: 'smtp_not_configured' };
      }

      await emailService.transporters.pnptv.sendMail({
        from: '"PNPtv" <noreply@pnptv.app>',
        to: user.email,
        subject,
        html,
      });

      logger.info('NotificationDigestScheduler: test digest delivered', {
        userId: user.id, email: user.email, total: totalCount,
      });

      return { sent: true, notificationCount: totalCount };
    } catch (err) {
      logger.error('NotificationDigestScheduler.sendDigestForUser failed', {
        userId, error: err.message,
      });
      return { sent: false, reason: err.message };
    }
  }
}

module.exports = NotificationDigestScheduler;
