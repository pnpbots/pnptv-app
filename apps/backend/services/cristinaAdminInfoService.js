const logger = require('../utils/logger');
const sanitize = require('../utils/sanitizer');
const PlanModel = require('../models/planModel');
const CristinaAdminBriefModel = require('../models/cristinaAdminBriefModel');
const { getBroadcastQueueIntegration } = require('../bot/services/broadcastQueueIntegration');

const SECTION_KEYS = {
  LEX_PLAN: 'lex_plan',
  CHANNEL_PLAN: 'channel_plan',
  PRICING_UPDATES: 'pricing_updates',
  BOT_STATUS: 'bot_status',
};

const SECTION_KEY_MAP = {
  lex: SECTION_KEYS.LEX_PLAN,
  channel: SECTION_KEYS.CHANNEL_PLAN,
  pricing: SECTION_KEYS.PRICING_UPDATES,
  bot: SECTION_KEYS.BOT_STATUS,
};

const MAX_PARAGRAPH_LENGTH = 1000;
const BRIEF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let briefCache = null;
let briefCacheTimestamp = 0;

function formatCurrency(plan) {
  const price = typeof plan.price === 'number' ? plan.price.toFixed(2) : plan.price;
  if (!price) return plan.name;
  const currency = plan.currency || 'USD';
  return `${plan.name} — ${currency} ${price}${plan.isPromo ? ' (Promo)' : ''}`;
}

function formatQueueStatus(status) {
  if (!status || status.error) {
    return status?.error ? `Cola: ${status.error}` : 'Cola: estado no disponible';
  }
  const running = status.running ? 'Activa' : 'En pausa';
  const activeJobs = status.activeJobs ?? status.statistics?.activeJobs ?? 0;
  const nextJobs = status.statistics?.totalPending ?? 0;
  return `Cola: ${running} • Trabajos activos: ${activeJobs} • Pendientes: ${nextJobs}`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return 'Uptime desconocido';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

async function getBrief() {
  const now = Date.now();
  if (briefCache && now - briefCacheTimestamp < BRIEF_CACHE_TTL_MS) {
    return briefCache;
  }
  const records = await CristinaAdminBriefModel.getAll();
  briefCache = {
    lexPlan: records[SECTION_KEYS.LEX_PLAN] || '',
    channelPlan: records[SECTION_KEYS.CHANNEL_PLAN] || '',
    pricingUpdates: records[SECTION_KEYS.PRICING_UPDATES] || '',
    botStatus: records[SECTION_KEYS.BOT_STATUS] || '',
  };
  briefCacheTimestamp = now;
  return briefCache;
}

function invalidateBriefCache() {
  briefCache = null;
  briefCacheTimestamp = 0;
}

async function updateSection(section, text) {
  const key = SECTION_KEY_MAP[section];
  if (!key) {
    throw new Error(`Unknown Cristina section: ${section}`);
  }
  const sanitized = sanitize.text(text, { maxLength: MAX_PARAGRAPH_LENGTH });
  if (!sanitized) {
    throw new Error('El texto debe contener al menos un carácter válido.');
  }
  await CristinaAdminBriefModel.upsert({ key, value: sanitized });
  invalidateBriefCache();
  return sanitized;
}

async function refreshSystemInfo() {
  let pricingText = 'Sin planes disponibles en este momento.';
  let botText = 'Estado del bot no disponible.';

  try {
    const plans = await PlanModel.getAdminPlans();
    if (plans && plans.length > 0) {
      pricingText = plans
        .slice(0, 6)
        .map((plan) => formatCurrency(plan))
        .join('\n');
    }
  } catch (error) {
    logger.error('Error preparando resumen de planes para Cristina', { error: error.message });
    pricingText = `Error cargando planes: ${error.message}`;
  }

  try {
    const queueIntegration = getBroadcastQueueIntegration();
    const queueStatus = await queueIntegration.getStatus();
    const queueDescription = formatQueueStatus(queueStatus);
    const uptimeText = formatUptime(process.uptime());
    botText = `Uptime: ${uptimeText}\n${queueDescription}`;
  } catch (error) {
    logger.error('Error preparando resumen del bot para Cristina', { error: error.message });
    botText = `Error obteniendo estado del bot: ${error.message}`;
  }

  await CristinaAdminBriefModel.upsert({ key: SECTION_KEYS.PRICING_UPDATES, value: pricingText });
  await CristinaAdminBriefModel.upsert({ key: SECTION_KEYS.BOT_STATUS, value: botText });
  invalidateBriefCache();

  return {
    pricing: pricingText,
    botStatus: botText,
  };
}

module.exports = {
  SECTION_KEYS,
  SECTION_KEY_MAP,
  getBrief,
  updateSection,
  refreshSystemInfo,
};
