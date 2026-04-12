'use strict';

/**
 * Bogota Daily Analysis Scheduler
 *
 * Runs at 10:00 AM America/Bogota every day.
 * Fetches top-performing posts from the last 7 days, generates a strategic
 * summary via Grok, and logs it for operator review.
 *
 * The analysis is lightweight: reads from x_post_analytics + x_auto_campaigns,
 * generates a Grok summary, then broadcasts it to the ops channel (Telegram bot)
 * if BOT_OPS_CHAT_ID is set.
 */

const cron = require('node-cron');
const db = require('../../../utils/db');
const logger = require('../../../utils/logger');
const GrokService = require('../../../services/grokService');

const ANALYSIS_CRON = '0 10 * * *'; // 10:00 AM every day
const BOGOTA_TZ = 'America/Bogota';

async function runBogotaAnalysis() {
  logger.info('[BogotaAnalysis] Starting daily X campaign analysis');

  try {
    // Fetch top performing posts (last 7 days, by engagement score)
    const topPostsResult = await db.query(`
      SELECT
        j.text,
        j.sent_at,
        a.engagement_score,
        a.likes,
        a.retweets,
        a.replies,
        a.link_clicks,
        c.name AS campaign_name,
        c.persona_type,
        c.grok_mode,
        c.language
      FROM x_post_analytics a
      JOIN x_post_jobs j ON j.post_id = a.post_id
      LEFT JOIN x_auto_campaigns c ON c.campaign_id = a.campaign_id
      WHERE j.sent_at >= NOW() - INTERVAL '7 days'
        AND a.engagement_score > 0
      ORDER BY a.engagement_score DESC
      LIMIT 10
    `);

    // Fetch campaign summary stats (last 7 days)
    const statsResult = await db.query(`
      SELECT
        c.name,
        c.persona_type,
        c.language,
        c.grok_mode,
        c.status,
        c.total_posted,
        c.total_failed,
        CASE WHEN c.total_generated > 0
          THEN ROUND((c.total_posted::numeric / c.total_generated) * 100, 1)
          ELSE 0
        END AS success_rate
      FROM x_auto_campaigns c
      WHERE c.updated_at >= NOW() - INTERVAL '7 days'
         OR c.status = 'active'
      ORDER BY success_rate DESC
      LIMIT 10
    `);

    const topPosts = topPostsResult.rows;
    const stats = statsResult.rows;

    if (topPosts.length === 0 && stats.length === 0) {
      logger.info('[BogotaAnalysis] No data available for analysis — skipping');
      return;
    }

    // Build analysis prompt
    const topPostsSummary = topPosts.length > 0
      ? topPosts.map((p, i) =>
          `${i + 1}. [${p.campaign_name || 'unknown'} / ${p.persona_type || 'generic'} / ${p.language || 'es'}] ` +
          `Score: ${p.engagement_score?.toFixed(1)} (❤️${p.likes} 🔁${p.retweets} 💬${p.replies} 🔗${p.link_clicks})\n` +
          `"${(p.text || '').substring(0, 120)}..."`
        ).join('\n\n')
      : 'No posts with engagement data in the last 7 days.';

    const campaignsSummary = stats.length > 0
      ? stats.map((c) =>
          `• ${c.name} [${c.persona_type}/${c.language}] — ` +
          `${c.status} | ${c.total_posted} posted | ${c.total_failed} failed | ${c.success_rate}% success`
        ).join('\n')
      : 'No campaign activity in the last 7 days.';

    const analysisPrompt = `Aquí están los datos de rendimiento de las campañas de X de pnptv.app de los últimos 7 días.

TOP 10 POSTS POR ENGAGEMENT (últimos 7 días):
${topPostsSummary}

RESUMEN DE CAMPAÑAS ACTIVAS:
${campaignsSummary}

Por favor proporciona:
1. ¿Qué tipo de contenido, persona y idioma están generando más engagement?
2. ¿Qué patrones observas en los posts de mayor rendimiento?
3. 3 recomendaciones concretas para las próximas 24-48 horas
4. ¿Alguna campaña que debería pausarse, optimizarse o duplicarse?

Respuesta concisa (máx 400 palabras), orientada a acción.`;

    const analysis = await GrokService.chat({
      mode: 'post',
      language: 'Spanish',
      prompt: analysisPrompt,
      maxTokens: 600,
    });

    logger.info('[BogotaAnalysis] Daily analysis complete', {
      topPostsAnalyzed: topPosts.length,
      campaignsAnalyzed: stats.length,
      analysisLength: analysis.length,
    });

    // Broadcast to ops channel if configured
    const opsChat = process.env.BOT_OPS_CHAT_ID;
    if (opsChat) {
      try {
        const { bot } = require('../bot');
        const msg = `📊 *Bogota Daily X Analysis — ${new Date().toISOString().split('T')[0]}*\n\n${analysis}`;
        await bot.telegram.sendMessage(opsChat, msg, { parse_mode: 'Markdown' });
        logger.info('[BogotaAnalysis] Analysis sent to ops channel', { opsChat });
      } catch (sendErr) {
        logger.warn('[BogotaAnalysis] Failed to send to ops channel', { error: sendErr.message });
      }
    }

  } catch (err) {
    logger.error('[BogotaAnalysis] Daily analysis failed', { error: err.message, stack: err.stack });
  }
}

function startBogotaAnalysisScheduler() {
  if (!cron.validate(ANALYSIS_CRON)) {
    logger.error('[BogotaAnalysis] Invalid cron expression', { cron: ANALYSIS_CRON });
    return;
  }

  cron.schedule(ANALYSIS_CRON, runBogotaAnalysis, {
    timezone: BOGOTA_TZ,
  });

  logger.info('[BogotaAnalysis] Scheduler started', {
    cron: ANALYSIS_CRON,
    timezone: BOGOTA_TZ,
    nextRun: '10:00 AM America/Bogota daily',
  });
}

module.exports = { startBogotaAnalysisScheduler, runBogotaAnalysis };
