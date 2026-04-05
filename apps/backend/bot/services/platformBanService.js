'use strict';

/**
 * PlatformBanService
 *
 * Comprehensive platform-wide ban that covers every identity vector a user
 * could have registered — Telegram ID, pnptv_id, email, X/Twitter, Bluesky,
 * ATProto — plus all IPs seen during their sessions.
 *
 * When someone is banned:
 *   1. All identity vectors are captured and stored in `platform_bans`
 *   2. The `users` table is hard-set (superadmin bypass) to tier='banned'
 *   3. All user entitlements are revoked
 *   4. The user's plan/subscription is cleared
 *   5. A firm but humane Telegram message is sent to the user
 *   6. The bot admin group is notified
 */

const { query } = require('../../config/postgres');
const { getRedis } = require('../../config/redis');
const logger = require('../../utils/logger');

const BOT_MESSAGE = (username, reason) =>
  `🚫 *Cuenta Suspendida Permanentemente*\n\n` +
  `Hola${username ? ` @${username}` : ''},\n\n` +
  `Después de una revisión de seguridad tu cuenta ha sido *suspendida permanentemente* de la plataforma PNPtv.\n\n` +
  `💛 Valoramos profundamente a nuestra comunidad y trabajamos cada día para mantenerla segura, ` +
  `respetuosa e íntegra para todos nuestros miembros.\n\n` +
  `📋 *Motivo:* ${reason}\n\n` +
  `⚠️ Esta decisión es *definitiva y sin apelación*. No existen segundas oportunidades para quienes comprometen la seguridad o la confianza de nuestra comunidad.\n\n` +
  `Todos los accesos asociados a tu cuenta — incluyendo sesiones activas, códigos de activación y métodos de inicio de sesión — han sido revocados.\n\n` +
  `_PNPtv Team_ 🏳️‍🌈`;

class PlatformBanService {
  /**
   * Perform a full platform ban on a user.
   *
   * @param {object} opts
   * @param {string}  opts.userId        - Internal DB user ID (required)
   * @param {string}  opts.reason        - Human-readable ban reason (required)
   * @param {object}  [opts.evidence]    - JSON evidence payload (e.g. code reuse log)
   * @param {string}  [opts.bannedBy]    - Admin user ID or 'system'
   * @param {object}  [opts.botContext]  - Telegraf ctx OR { telegram } object for sending messages
   * @returns {Promise<{success: boolean, banId: string|null}>}
   */
  static async ban({ userId, reason, evidence = {}, bannedBy = 'system', botContext = null }) {
    try {
      logger.warn('PlatformBanService.ban — initiating', { userId, reason, bannedBy });

      // ── 1. Fetch full user record ────────────────────────────────────────────
      const userRes = await query(
        `SELECT id, telegram, pnptv_id, email, username, x_id, first_name
         FROM users WHERE id = $1`,
        [String(userId)]
      );

      if (userRes.rows.length === 0) {
        logger.error('PlatformBanService.ban — user not found', { userId });
        return { success: false, banId: null };
      }

      const u = userRes.rows[0];

      // ── 2. Collect all known IPs from access logs ────────────────────────────
      const ipRes = await query(
        `SELECT DISTINCT ip_address FROM user_access_logs
         WHERE user_id = $1 AND ip_address IS NOT NULL
         ORDER BY ip_address`,
        [String(userId)]
      );
      const knownIps = ipRes.rows.map((r) => r.ip_address);

      // ── 3. Insert platform ban record ────────────────────────────────────────
      const banRes = await query(
        `INSERT INTO platform_bans
           (user_id, telegram_id, pnptv_id, email, username,
            x_id, known_ips, reason, evidence, banned_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          String(u.id),
          u.telegram   || null,
          u.pnptv_id   || null,
          u.email      || null,
          u.username   || null,
          u.x_id       || null,
          knownIps.length ? knownIps : null,
          reason,
          JSON.stringify(evidence),
          String(bannedBy),
        ]
      );

      const banId = banRes.rows[0]?.id || null;

      // ── 4. Hard-set user to banned (superadmin bypass trigger) ───────────────
      await query(`SET LOCAL pnptv.superadmin_bypass = 'true'`);
      await query(
        `UPDATE users SET
           tier                = 'banned',
           subscription_status = 'banned',
           plan_id             = NULL,
           plan_expiry         = NULL,
           is_active           = FALSE,
           updated_at          = NOW()
         WHERE id = $1`,
        [String(userId)]
      );

      // ── 5. Revoke all entitlements ───────────────────────────────────────────
      await query(
        `DELETE FROM user_entitlements WHERE user_id = $1`,
        [String(userId)]
      );

      // ── 6. Invalidate Redis session cache ────────────────────────────────────
      try {
        const redis = getRedis();
        await redis.del(`session:${userId}`);
        await redis.del(`user:${userId}`);
        if (u.telegram) {
          await redis.del(`session:${u.telegram}`);
          await redis.del(`user:${u.telegram}`);
        }
      } catch (redisErr) {
        logger.warn('PlatformBanService — failed to clear Redis cache', { userId, error: redisErr.message });
      }

      // ── 7. Send Telegram message to the user ─────────────────────────────────
      const telegramId = u.telegram || String(userId);
      if (botContext) {
        try {
          const tg = botContext.telegram || botContext;
          await tg.sendMessage(telegramId, BOT_MESSAGE(u.username, reason), { parse_mode: 'Markdown' });
          logger.info('PlatformBanService — ban message sent', { telegramId });
        } catch (msgErr) {
          logger.warn('PlatformBanService — could not send ban message', { telegramId, error: msgErr.message });
        }
      } else {
        // Fire-and-forget via raw Telegram Bot API
        const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramId,
              text: BOT_MESSAGE(u.username, reason),
              parse_mode: 'Markdown',
            }),
          }).catch(() => {});
        }
      }

      // ── 8. Notify admin group ────────────────────────────────────────────────
      const adminGroupId = process.env.ADMIN_GROUP_ID || process.env.SUPPORT_GROUP_ID;
      if (adminGroupId) {
        const ipList = knownIps.length ? knownIps.join(', ') : 'N/A';
        const adminMsg =
          `🚫 *PLATAFORMA — USUARIO BANEADO*\n\n` +
          `👤 @${u.username || 'N/A'} (ID: \`${u.id}\`)\n` +
          `🔒 Motivo: ${reason}\n` +
          `🌐 IPs conocidas: \`${ipList}\`\n` +
          `🤖 Ejecutado por: ${bannedBy}\n` +
          `🆔 Ban ID: \`${banId}\``;
        try {
          const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
          if (botToken) {
            fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: adminGroupId, text: adminMsg, parse_mode: 'Markdown' }),
            }).catch(() => {});
          }
        } catch (_) {}
      }

      logger.warn('PlatformBanService.ban — completed', { userId, banId, knownIps });
      return { success: true, banId };
    } catch (err) {
      logger.error('PlatformBanService.ban — fatal error', { userId, error: err.message, stack: err.stack });
      return { success: false, banId: null };
    }
  }

  /**
   * Check if ANY of the provided identity vectors are platform-banned.
   * Returns the ban record if found, null otherwise.
   *
   * @param {object} ids
   * @param {string} [ids.userId]
   * @param {string} [ids.telegramId]
   * @param {string} [ids.pnptvId]
   * @param {string} [ids.email]
   * @param {string} [ids.xId]
   */
  static async isBanned({ userId, telegramId, pnptvId, email, xId } = {}) {
    try {
      const conditions = [];
      const values = [];
      let i = 1;

      const add = (col, val) => {
        if (val) {
          conditions.push(`${col} = $${i++}`);
          values.push(String(val));
        }
      };

      add('user_id',     userId);
      add('telegram_id', telegramId);
      add('pnptv_id',    pnptvId);
      add('email',       email);
      add('x_id',        xId);

      if (conditions.length === 0) return null;

      const res = await query(
        `SELECT id, reason, banned_at FROM platform_bans
         WHERE is_active = TRUE AND (${conditions.join(' OR ')})
         LIMIT 1`,
        values
      );

      return res.rows[0] || null;
    } catch (err) {
      logger.error('PlatformBanService.isBanned error', { error: err.message });
      return null; // fail open — don't block legitimate users on DB error
    }
  }

  /**
   * Check if an IP address is in any active platform ban's known_ips list.
   * Used at registration to block banned users from creating new accounts.
   *
   * @param {string} ip
   * @returns {Promise<object|null>} ban record or null
   */
  static async isIpBanned(ip) {
    if (!ip) return null;
    try {
      const res = await query(
        `SELECT id, reason, banned_at FROM platform_bans
         WHERE is_active = TRUE AND $1 = ANY(known_ips)
         LIMIT 1`,
        [ip]
      );
      return res.rows[0] || null;
    } catch (err) {
      logger.error('PlatformBanService.isIpBanned error', { error: err.message });
      return null; // fail open
    }
  }
}

module.exports = PlatformBanService;
