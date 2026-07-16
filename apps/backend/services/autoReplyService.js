'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

const IMAP_HOST = process.env.IMAP_HOST || 'imap.hostinger.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const INBOX_USER = process.env.HELLO_EMAIL_USER;
const INBOX_PASS = process.env.HELLO_EMAIL_PASS;
const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — prevents double-replies

const SKIP_PATTERNS = [
  /^noreply@/i, /^no-reply@/i, /^mailer-daemon@/i, /^postmaster@/i,
  /^bounce[^@]*@/i, /^notifications?@/i, /^do-not-reply@/i, /^auto@/i,
];

// support@ and legal@ are aliases of hello@ — single IMAP connection,
// pick template based on which address appears in the To/Delivered-To header.
const ALIAS_TEMPLATES = {
  'support@pnptv.app': {
    fromName: 'PNPtv! Support',
    fromAddress: 'support@pnptv.app',
    replySubject: (orig) => `[Support Received] Re: ${orig}`,
    body: (_orig, ref) =>
      `Hi,\n\nWe've received your support request and will respond within 24 hours.\n\nFor urgent account or payment issues, reach us via chat at pnptv.app.\n\nReference: ${ref}\n\n— PNPtv! Support\nsupport@pnptv.app`,
  },
  'legal@pnptv.app': {
    fromName: 'PNPtv! Legal Affairs',
    fromAddress: 'legal@pnptv.app',
    replySubject: (orig) => `[Received] Re: ${orig}`,
    body: (_orig, _ref) =>
      `This message confirms receipt of your correspondence sent to legal@pnptv.app.\n\nOur legal team will review your inquiry and respond within 72 business hours.\n\nPlease retain this message for your records. Do not reply to this automated confirmation.\n\nPNPtv! Legal Affairs\nlegal@pnptv.app`,
  },
  'hello@pnptv.app': {
    fromName: 'PNPtv!',
    fromAddress: 'hello@pnptv.app',
    replySubject: (orig) => `Re: ${orig}`,
    body: (_orig, _ref) =>
      `Hi there!\n\nThanks for reaching out to PNPtv! We received your message and will get back to you within 24–48 hours.\n\nYou're also welcome to visit pnptv.app — the home of Latin America's queer community platform.\n\nWarmly,\nThe PNPtv! Team\nhello@pnptv.app`,
  },
};

const TRANSPORTER = nodemailer.createTransport({
  host: process.env.PNPTV_SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.PNPTV_SMTP_PORT || '587', 10),
  secure: process.env.PNPTV_SMTP_SECURE === 'true',
  auth: { user: INBOX_USER, pass: INBOX_PASS },
});

function resolveTemplate(parsed) {
  // Check To, Delivered-To, and X-Original-To headers for the alias address
  const candidates = [];

  const toHeader = parsed.to?.value || [];
  for (const addr of toHeader) candidates.push((addr.address || '').toLowerCase());

  const deliveredTo = parsed.headers.get('delivered-to');
  if (deliveredTo && typeof deliveredTo === 'string') candidates.push(deliveredTo.toLowerCase().trim());

  const xOrigTo = parsed.headers.get('x-original-to');
  if (xOrigTo) candidates.push(xOrigTo.toLowerCase().trim());

  for (const addr of candidates) {
    if (ALIAS_TEMPLATES[addr]) return ALIAS_TEMPLATES[addr];
  }

  // Default to hello@ template if no alias matched
  return ALIAS_TEMPLATES['hello@pnptv.app'];
}

function shouldSkip(parsed) {
  const from = parsed.from;
  if (!from?.value?.length) return true;

  const senderEmail = (from.value[0].address || '').toLowerCase();
  if (!senderEmail) return true;

  // Skip self (any of our own addresses)
  if (Object.keys(ALIAS_TEMPLATES).includes(senderEmail)) return true;
  if (SKIP_PATTERNS.some((p) => p.test(senderEmail))) return true;

  const autoSubmitted = parsed.headers.get('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (parsed.headers.get('x-auto-response-suppress')) return true;

  const precedence = parsed.headers.get('precedence');
  if (precedence === 'bulk' || precedence === 'list') return true;

  return false;
}

async function startAutoReplyPolling() {
  if (!INBOX_USER || !INBOX_PASS) {
    logger.warn('[autoReply] HELLO_EMAIL_USER/PASS not configured — skipping poll');
    return;
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: INBOX_USER, pass: INBOX_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const redis = getRedis();
      const uids = await client.search({ unseen: true });
      if (!uids.length) return;

      let replied = 0;

      for await (const msg of client.fetch(uids, { source: true })) {
        try {
          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId;
          if (!messageId) continue;

          const redisKey = `autoreply:${messageId}`;
          if (await redis.get(redisKey)) continue;

          if (shouldSkip(parsed)) continue;

          const template = resolveTemplate(parsed);
          const senderEmail = parsed.from.value[0].address;
          const origSubject = parsed.subject || '(no subject)';
          const ref = crypto
            .createHash('sha256')
            .update(messageId)
            .digest('hex')
            .slice(0, 7)
            .toUpperCase();

          await TRANSPORTER.sendMail({
            from: `"${template.fromName}" <${template.fromAddress}>`,
            to: senderEmail,
            subject: template.replySubject(origSubject),
            text: template.body(origSubject, ref),
            headers: {
              'In-Reply-To': messageId,
              References: messageId,
              'Auto-Submitted': 'auto-replied',
            },
          });

          await redis.set(redisKey, '1', 'EX', REDIS_TTL_SECONDS);
          replied++;
          logger.info(`[autoReply] replied to ${senderEmail} via ${template.fromAddress} (ref: ${ref})`);
        } catch (msgErr) {
          logger.error('[autoReply] Error processing message', { error: msgErr.message });
        }
      }

      if (replied > 0) {
        logger.info(`[autoReply] sent ${replied} reply/replies this tick`);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error('[autoReply] IMAP error', { error: err.message });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

module.exports = { startAutoReplyPolling };
