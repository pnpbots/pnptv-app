/**
 * Mono — Personal AI Business Assistant for PNPtv owner
 * Speaks the owner's language, knows the platform inside out.
 * Can query the database directly to answer any question about users, payments, memberships, etc.
 */
const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');
const { getRedis } = require('../../config/redis');

const REDIS_PREFIX = 'mono:chat:';
const REDIS_TTL = 14400; // 4 hours
const MAX_HISTORY = 30;  // 15 pairs
const MAX_TOOL_ROUNDS = 5; // max DB query rounds per message

function getGrokCfg() {
  return {
    apiKey: process.env.GROK_API_KEY,
    model: process.env.GROK_MODEL || 'grok-2-latest',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    timeoutMs: Number(process.env.GROK_TIMEOUT_MS || 60000),
  };
}

// ── Database schema for the LLM ──────────────────────────────────────────────
const DB_SCHEMA = `
TABLE: users
  id VARCHAR PK (Telegram ID or UUID), username, first_name, last_name, email, phone, telegram,
  tier ('free'|'member'|'PRIME'), subscription_status ('active'|'cancelled'|'churned'|'expired'),
  plan_id VARCHAR (FK to plans.id), plan_expiry TIMESTAMP,
  role ('user'|'admin'|'superadmin'), is_active BOOLEAN, status ('active'|'inactive'|'banned'),
  bio TEXT, language VARCHAR, date_of_birth DATE, country VARCHAR, city VARCHAR,
  creator_status ('none'|'pending'|'approved'|'rejected'), creator_type, creator_verified BOOLEAN,
  creator_featured BOOLEAN, creator_price_usd NUMERIC, creator_strikes INT,
  x_user_id, x_username, twitter VARCHAR, atproto_did, atproto_handle,
  followers_count INT, following_count INT, profile_private BOOLEAN,
  onboarding_complete BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP

TABLE: plans
  id VARCHAR PK, sku, name, display_name, tier, price NUMERIC, currency, duration_days INT,
  is_lifetime BOOLEAN, is_recurring BOOLEAN, billing_interval, active BOOLEAN,
  description TEXT, features JSONB, payment_method, icon, created_at TIMESTAMP

TABLE: payments
  id SERIAL PK, user_id VARCHAR (FK users.id), plan_id VARCHAR, amount NUMERIC, currency VARCHAR,
  status ('pending'|'completed'|'failed'|'refunded'), payment_method VARCHAR,
  transaction_id VARCHAR, metadata JSONB, created_at TIMESTAMP, updated_at TIMESTAMP

TABLE: invoices
  id SERIAL PK, user_id VARCHAR, plan_id VARCHAR, amount NUMERIC, currency VARCHAR,
  status VARCHAR, payment_method VARCHAR, created_at TIMESTAMP

TABLE: tips
  id SERIAL PK, sender_id VARCHAR, recipient_id VARCHAR, performer_id VARCHAR,
  amount NUMERIC, currency VARCHAR, message TEXT, is_anonymous BOOLEAN, created_at TIMESTAMP

TABLE: social_posts
  id SERIAL PK, user_id VARCHAR, content TEXT, media_url, media_type, reply_to_id INT,
  repost_of_id INT, likes_count INT, reposts_count INT, replies_count INT,
  is_exclusive BOOLEAN, content_tier VARCHAR, is_deleted BOOLEAN, created_at TIMESTAMP

TABLE: social_post_likes
  post_id INT, user_id VARCHAR — composite PK

TABLE: user_follows
  follower_id VARCHAR, following_id VARCHAR — composite PK, created_at TIMESTAMP

TABLE: chat_messages
  id SERIAL PK, room VARCHAR, user_id VARCHAR, content TEXT, media_url, media_type,
  is_deleted BOOLEAN, created_at TIMESTAMP

TABLE: direct_messages
  id SERIAL PK, sender_id VARCHAR, recipient_id VARCHAR, content TEXT, media_url, media_type,
  is_deleted BOOLEAN, is_read BOOLEAN, created_at TIMESTAMP

TABLE: hangout_groups
  id SERIAL PK, name VARCHAR, description TEXT, owner_id VARCHAR, privacy ('public'|'private'),
  icon_url, cover_url, created_at TIMESTAMP

TABLE: hangout_members
  id SERIAL PK, group_id INT, user_id VARCHAR, role ('member'|'moderator'|'owner'), is_banned BOOLEAN

TABLE: hangout_video_calls
  id SERIAL PK, group_id INT, creator_id VARCHAR, room_name VARCHAR, status ('active'|'ended'),
  participant_count INT, created_at TIMESTAMP, ended_at TIMESTAMP

TABLE: hangout_call_participants
  id SERIAL PK, call_id INT, user_id VARCHAR, display_name VARCHAR,
  joined_at TIMESTAMP, left_at TIMESTAMP, total_duration_seconds INT

TABLE: notifications
  id SERIAL PK, type VARCHAR, category VARCHAR, priority VARCHAR,
  actor_id VARCHAR, target_user_id VARCHAR, entity_type VARCHAR, entity_id VARCHAR,
  message TEXT, metadata JSONB, is_read BOOLEAN, created_at TIMESTAMP

TABLE: model_applications
  id SERIAL PK, user_id VARCHAR, requested_price_usd NUMERIC, status VARCHAR,
  reviewed_at TIMESTAMP, created_at TIMESTAMP

TABLE: creator_subscriptions
  id SERIAL PK, creator_id VARCHAR, subscriber_id VARCHAR, status VARCHAR,
  price_usd NUMERIC, auto_renew BOOLEAN, expires_at TIMESTAMP, created_at TIMESTAMP

TABLE: creator_earnings
  id SERIAL PK, creator_id VARCHAR, amount_gross NUMERIC, amount_creator NUMERIC,
  amount_platform NUMERIC, status ('pending'|'available'|'paid_out'), created_at TIMESTAMP

TABLE: push_subscriptions
  id SERIAL PK, user_id VARCHAR, endpoint TEXT, is_active BOOLEAN, created_at TIMESTAMP

TABLE: x_auto_campaigns
  id SERIAL PK, account_id VARCHAR, name VARCHAR, status VARCHAR, language VARCHAR,
  total_posted INT, total_failed INT, interval_minutes INT,
  active_hours_start INT, active_hours_end INT, created_at TIMESTAMP

TABLE: x_accounts
  account_id VARCHAR PK, handle VARCHAR, created_at TIMESTAMP

TABLE: venues
  id SERIAL PK, name VARCHAR, type VARCHAR, city VARCHAR, country VARCHAR,
  latitude NUMERIC, longitude NUMERIC, created_at TIMESTAMP

TABLE: promos
  id SERIAL PK, code VARCHAR, discount_percent INT, max_uses INT, used_count INT,
  expires_at TIMESTAMP, created_at TIMESTAMP

TABLE: creator_strike_log
  id SERIAL PK, creator_id VARCHAR, strike_number INT, reason TEXT, issued_by VARCHAR, created_at TIMESTAMP
`.trim();

// ── Tool definition for Grok function calling ────────────────────────────────
const QUERY_TOOL = {
  type: 'function',
  function: {
    name: 'query_database',
    description: 'Execute a read-only SQL SELECT query against the PNPtv PostgreSQL database. Use this to look up specific users, payments, memberships, historical data, aggregates, etc. Only SELECT queries are allowed.',
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A PostgreSQL SELECT query. Must start with SELECT. Use ILIKE for case-insensitive text matching. Limit results to 50 rows max unless aggregating.',
        },
        purpose: {
          type: 'string',
          description: 'Brief explanation of what this query is looking for.',
        },
      },
      required: ['sql', 'purpose'],
    },
  },
};

// ── SQL safety check ─────────────────────────────────────────────────────────
function isSafeQuery(sql) {
  const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!normalized.startsWith('SELECT')) return false;
  const forbidden = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'TRUNCATE ', 'CREATE ', 'GRANT ', 'REVOKE ', 'EXECUTE ', 'COPY ', 'DO '];
  for (const kw of forbidden) {
    if (normalized.includes(kw)) return false;
  }
  // Block semicolons (prevent multi-statement injection)
  if (sql.replace(/;[\s]*$/, '').includes(';')) return false;
  return true;
}

// ── Execute a safe read-only query ───────────────────────────────────────────
async function executeMonoQuery(sql) {
  if (!isSafeQuery(sql)) {
    return { error: 'Query rejected: only SELECT queries are allowed.' };
  }

  const pool = getPool();
  try {
    // Add LIMIT if not present
    const upper = sql.toUpperCase();
    let safeSql = sql.replace(/;\s*$/, '');
    if (!upper.includes('LIMIT')) {
      safeSql += ' LIMIT 50';
    }

    const { rows } = await pool.query(safeSql);
    return { rows, rowCount: rows.length };
  } catch (err) {
    return { error: `SQL error: ${err.message}` };
  }
}

// ── Live platform context (kept for baseline stats) ──────────────────────────
async function buildMonoContext() {
  const pool = getPool();
  const lines = [];

  try {
    const { rows: [u] } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tier = 'PRIME')::int AS prime,
        COUNT(*) FILTER (WHERE tier = 'member')::int AS member,
        COUNT(*) FILTER (WHERE tier = 'free' OR tier IS NULL)::int AS free,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_7d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS new_30d
      FROM users WHERE is_active = true`);

    const conv = u.total > 0 ? (((u.prime + u.member) / u.total) * 100).toFixed(1) : '0';
    lines.push('=== USERS ===');
    lines.push(`Total: ${u.total} | PRIME: ${u.prime} | Member: ${u.member} | Free: ${u.free}`);
    lines.push(`New last 7d: ${u.new_7d} | New last 30d: ${u.new_30d} | Paid conversion: ${conv}%`);

    const { rows: [inst] } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active=true)::int AS active FROM push_subscriptions`
    ).catch(() => ({ rows: [{ total: 0, active: 0 }] }));
    lines.push(`App installs (PWA): ${inst.active} active / ${inst.total} total`);

    const { rows: [rev30] } = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END),0)::numeric(10,2) AS usd,
             COUNT(*) FILTER (WHERE status='completed')::int AS txns
      FROM payments WHERE status='completed' AND created_at > NOW() - INTERVAL '30 days'`
    ).catch(() => ({ rows: [{ usd: 0, txns: 0 }] }));
    const { rows: [rev7] } = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END),0)::numeric(10,2) AS usd
      FROM payments WHERE status='completed' AND created_at > NOW() - INTERVAL '7 days'`
    ).catch(() => ({ rows: [{ usd: 0 }] }));

    lines.push('\n=== REVENUE ===');
    lines.push(`Last 30 days: $${rev30.usd} USD (${rev30.txns} transactions)`);
    lines.push(`Last 7 days: $${rev7.usd} USD`);

    const { rows: growth } = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS n
      FROM users WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY DATE(created_at) ORDER BY day DESC`);
    lines.push('\n=== NEW USERS TREND (last 14 days) ===');
    growth.forEach(g => lines.push(`  ${g.day}: +${g.n}`));

  } catch (err) {
    logger.warn('Mono context error', { error: err.message });
    lines.push('[partial data - some queries failed]');
  }

  lines.push(`\nUTC now: ${new Date().toISOString()}`);
  return lines.join('\n');
}

// ── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  return `You are Mono, the personal business intelligence assistant for the founder of PNPtv (pnptv.app) — a private queer PNP community platform.

PERSONALITY:
- Casual, direct, sharp, loyal — like a smart right-hand operator
- Respond in the SAME LANGUAGE the owner writes in (Spanish or English)
- Use line breaks for readability — no corporate fluff
- Be proactive: if you spot something interesting in the data, flag it unprompted

YOUR JOB:
- Answer ANY question about the platform: users, payments, memberships, plans, content, hangouts, campaigns
- You can query the database directly using the query_database tool
- Look up specific users by username, name, ID, or any field
- Pull payment history, membership changes, plan details for any user
- Generate reports, find patterns, compare time periods
- Identify top members who should become models/creators

DATABASE SCHEMA:
${DB_SCHEMA}

TIPS FOR QUERYING:
- User IDs are VARCHAR (Telegram IDs like '1234567890' or UUIDs)
- Search users by: username ILIKE '%term%' OR first_name ILIKE '%term%' OR telegram ILIKE '%term%'
- For user history: join payments, invoices tables on user_id
- plan_id links to plans.id (e.g. 'lifetime100', 'member-monthly', 'diamond-pass')
- tier values: 'free', 'member', 'PRIME' (case sensitive!)
- Always LIMIT results unless aggregating
- Use COUNT, SUM, AVG for aggregate queries
- Cast timestamps for readable output: created_at::date or to_char(created_at, 'YYYY-MM-DD HH24:MI')

LIVE DASHBOARD (refreshed each message):
${ctx}

RULES:
- Always cite real numbers from data or query results
- For model recruitment: prioritize high followers + active posters + no model role yet
- Keep answers tight and scannable (bullet points when listing people or metrics)
- When you need specific data not in the dashboard, USE the query_database tool — don't guess
- You can run multiple queries in sequence to build a complete answer
- If a query fails, try a different approach or simpler query`;
}

// ── Call Grok API ────────────────────────────────────────────────────────────
async function callGrok(cfg, systemPrompt, messages, tools) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const body = {
      model: cfg.model,
      temperature: 0.65,
      max_tokens: 1500,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Grok ${res.status}: ${txt}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Main chat function ───────────────────────────────────────────────────────
async function chatWithMono({ message, historyKey = 'default', reset = false }) {
  const redis = getRedis();
  const redisKey = `${REDIS_PREFIX}${historyKey}`;

  if (reset) {
    await redis.del(redisKey).catch(() => {});
    return null;
  }

  let history = [];
  try {
    const stored = await redis.get(redisKey);
    if (stored) history = JSON.parse(stored);
  } catch { /* ignore */ }

  const contextBlock = await buildMonoContext();
  const systemPrompt = buildSystemPrompt(contextBlock);
  const cfg = getGrokCfg();
  if (!cfg.apiKey) throw new Error('GROK_API_KEY not configured');

  const userMsg = { role: 'user', content: String(message).trim().substring(0, 2000) };
  const messages = [...history, userMsg];

  // Multi-turn tool calling loop
  let currentMessages = [...messages];
  let reply = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callGrok(cfg, systemPrompt, currentMessages, [QUERY_TOOL]);
    const choice = data?.choices?.[0];
    if (!choice) throw new Error('Empty response from Grok');

    const msg = choice.message;

    // If the model wants to call a tool
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        let result;
        if (tc.function.name === 'query_database') {
          try {
            const args = JSON.parse(tc.function.arguments);
            logger.info('Mono DB query', { purpose: args.purpose, sql: args.sql?.substring(0, 200) });
            result = await executeMonoQuery(args.sql);
          } catch (err) {
            result = { error: `Failed to parse tool arguments: ${err.message}` };
          }
        } else {
          result = { error: `Unknown tool: ${tc.function.name}` };
        }

        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).substring(0, 8000),
        });
      }

      // Continue loop — let the model process tool results
      continue;
    }

    // No tool call — we have the final text response
    reply = msg.content;
    break;
  }

  if (!reply) throw new Error('Mono could not produce a response after tool calls');
  reply = String(reply).trim();

  // Save history (only user message + final reply, not intermediate tool calls)
  const updated = [...messages, { role: 'assistant', content: reply }].slice(-MAX_HISTORY);
  await redis.set(redisKey, JSON.stringify(updated), 'EX', REDIS_TTL).catch(() => {});

  return reply;
}

module.exports = { chatWithMono, buildMonoContext };
