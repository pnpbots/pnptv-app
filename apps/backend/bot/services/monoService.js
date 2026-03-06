/**
 * Mono — Personal AI Business Assistant for PNPtv owner
 * Speaks the owner's language, knows the platform inside out.
 */
const logger = require('../../utils/logger');
const { getPool } = require('../../config/postgres');
const { getRedis } = require('../../config/redis');

const REDIS_PREFIX = 'mono:chat:';
const REDIS_TTL = 14400; // 4 hours
const MAX_HISTORY = 30;  // 15 pairs

function getGrokCfg() {
  return {
    apiKey: process.env.GROK_API_KEY,
    model: process.env.GROK_MODEL || 'grok-2-latest',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    timeoutMs: Number(process.env.GROK_TIMEOUT_MS || 45000),
  };
}

// ── Live platform context ─────────────────────────────────────────────────────
async function buildMonoContext() {
  const pool = getPool();
  const lines = [];

  try {
    // User totals
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

    // PWA installs
    const { rows: [inst] } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active=true)::int AS active FROM push_subscriptions`
    ).catch(() => ({ rows: [{ total: 0, active: 0 }] }));
    lines.push(`App installs (PWA): ${inst.active} active / ${inst.total} total`);

    // Top members — model candidates
    const { rows: top } = await pool.query(`
      SELECT u.username, u.first_name, u.telegram, u.twitter, u.tier,
             COUNT(DISTINCT sp.id)::int AS posts,
             COALESCE(SUM(sp.likes_count),0)::int AS likes,
             COUNT(DISTINCT uf.follower_id)::int AS followers
      FROM users u
      LEFT JOIN social_posts sp ON sp.user_id = u.id AND sp.is_deleted = false
      LEFT JOIN user_follows uf ON uf.following_id = u.id
      WHERE u.is_active = true AND u.role = 'user'
      GROUP BY u.id
      HAVING COUNT(DISTINCT sp.id) > 0
      ORDER BY followers DESC, likes DESC LIMIT 20`);

    lines.push('\n=== TOP MEMBERS — MODEL CANDIDATES (followers > likes > posts) ===');
    top.forEach((m, i) => {
      const h = m.username || m.first_name || 'unknown';
      const tg = m.telegram ? ` TG:@${m.telegram}` : '';
      const tw = m.twitter ? ` X:@${m.twitter}` : '';
      lines.push(`${i + 1}. @${h} [${m.tier}] ${m.followers} followers / ${m.likes} likes / ${m.posts} posts${tg}${tw}`);
    });

    // Most active creators last 30d
    const { rows: creators } = await pool.query(`
      SELECT u.username, u.first_name, u.telegram,
             COUNT(sp.id)::int AS posts_30d,
             COALESCE(SUM(sp.likes_count),0)::int AS likes_30d
      FROM social_posts sp JOIN users u ON sp.user_id = u.id
      WHERE sp.created_at > NOW() - INTERVAL '30 days' AND sp.is_deleted = false
      GROUP BY u.id, u.username, u.first_name, u.telegram
      ORDER BY posts_30d DESC LIMIT 10`);

    lines.push('\n=== MOST ACTIVE POSTERS (last 30 days) ===');
    creators.forEach((c, i) => {
      const h = c.username || c.first_name || 'unknown';
      const tg = c.telegram ? ` @${c.telegram}` : '';
      lines.push(`${i + 1}. @${h}${tg} — ${c.posts_30d} posts, ${c.likes_30d} likes`);
    });

    // Revenue
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

    // Growth trend last 14d
    const { rows: growth } = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*)::int AS n
      FROM users WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY DATE(created_at) ORDER BY day DESC`);
    lines.push('\n=== NEW USERS TREND (last 14 days) ===');
    growth.forEach(g => lines.push(`  ${g.day}: +${g.n}`));

    // Language distribution
    const { rows: langs } = await pool.query(`
      SELECT COALESCE(language,'unknown') AS lang, COUNT(*)::int AS n
      FROM users WHERE is_active=true GROUP BY language ORDER BY n DESC LIMIT 8`);
    lines.push('\n=== LANGUAGE BREAKDOWN ===');
    langs.forEach(l => lines.push(`  ${l.lang}: ${l.n}`));

    // X campaigns
    const { rows: camps } = await pool.query(`
      SELECT c.name, a.handle, c.status, c.language,
             c.total_posted, c.total_failed, c.interval_minutes,
             c.active_hours_start, c.active_hours_end
      FROM x_auto_campaigns c JOIN x_accounts a ON c.account_id = a.account_id
      ORDER BY c.created_at DESC`);
    if (camps.length) {
      lines.push('\n=== X CAMPAIGNS ===');
      camps.forEach(c => lines.push(
        `  [${c.status}] "${c.name}" @${c.handle} (${c.language}) posted:${c.total_posted} failed:${c.total_failed} every ${c.interval_minutes}min UTC${c.active_hours_start}-${c.active_hours_end}`
      ));
    }

    // Hangouts today
    const { rows: [hang] } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='active')::int AS active
      FROM hangout_video_calls WHERE created_at > NOW() - INTERVAL '24 hours'`
    ).catch(() => ({ rows: [{ total: 0, active: 0 }] }));
    lines.push(`\nHangouts last 24h: ${hang.total} total, ${hang.active} active now`);

  } catch (err) {
    logger.warn('Mono context error', { error: err.message });
    lines.push('[partial data — some queries failed]');
  }

  lines.push(`\nUTC now: ${new Date().toISOString()}`);
  return lines.join('\n');
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(ctx) {
  return `You are Mono, the personal business intelligence assistant for the founder of PNPtv (pnptv.app) — a private queer PNP community platform.

PERSONALITY:
- Casual, direct, sharp, loyal — like a smart right-hand operator
- Respond in the SAME LANGUAGE the owner writes in (Spanish or English)
- Use line breaks and occasional emojis for Telegram readability — no corporate fluff
- Be proactive: if you spot something interesting in the data, flag it unprompted

YOUR JOB:
- Answer any business question: growth, revenue, engagement, installs, campaigns
- Identify top members who should become models/creators (give names + contact handles)
- Track who is most active, most loved, most followed
- Summarize campaign and content performance
- Suggest concrete next steps based on the data

LIVE DATA (just pulled from the database):
${ctx}

RULES:
- Always cite real numbers from the data above
- For model recruitment: prioritize high followers + active posters + no model role yet
- Keep answers tight and scannable (bullet points when listing people or metrics)
- If asked about something not in the data, say so and suggest where to find it`;
}

// ── Main chat function ────────────────────────────────────────────────────────
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

  const { AbortController, fetch: globalFetch } = global;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let reply;
  try {
    const res = await globalFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.65,
        max_tokens: 1000,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Grok ${res.status}: ${txt}`);
    }
    const data = await res.json();
    reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Empty response');
    reply = String(reply).trim();
  } finally {
    clearTimeout(timer);
  }

  const updated = [...messages, { role: 'assistant', content: reply }].slice(-MAX_HISTORY);
  await redis.set(redisKey, JSON.stringify(updated), 'EX', REDIS_TTL).catch(() => {});

  return reply;
}

module.exports = { chatWithMono, buildMonoContext };
