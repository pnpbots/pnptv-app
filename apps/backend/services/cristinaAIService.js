const logger = require('../utils/logger');
const { AbortController, fetch } = global;

function getCristinaConfig() {
  return {
    apiKey: process.env.GROK_API_KEY || process.env.MISTRAL_API_KEY,
    model: process.env.CRISTINA_GROK_MODEL || process.env.GROK_MODEL || 'grok-3-mini',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    timeoutMs: Number(process.env.GROK_TIMEOUT_MS || 45000),
    maxTokens: Number(process.env.CRISTINA_MAX_TOKENS || 500),
  };
}

function isCristinaAIAvailable() {
  const { apiKey } = getCristinaConfig();
  return Boolean(apiKey);
}

async function chatWithCristina({ systemPrompt, messages, temperature = 0.7, maxTokens }) {
  const cfg = getCristinaConfig();
  if (!cfg.apiKey) {
    const err = new Error('Cristina AI API key not configured');
    logger.error('Cristina AI config error', { error: err.message });
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const resolvedMaxTokens = Number(maxTokens || cfg.maxTokens || 500);
    logger.info('Calling Cristina AI via Grok', {
      model: cfg.model,
      maxTokens: resolvedMaxTokens,
    });

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        max_tokens: resolvedMaxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const errorMsg = `Cristina AI Grok error ${res.status}: ${txt || res.statusText}`;
      logger.error('Cristina AI Grok API error', { status: res.status, response: txt });
      throw new Error(errorMsg);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.error('Cristina AI Grok returned empty response', { data });
      throw new Error('Cristina AI Grok returned empty response');
    }

    return String(content).trim();
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('Cristina AI Grok timeout', { timeoutMs: cfg.timeoutMs, error: error.message });
      throw new Error('Cristina AI request timed out');
    }
    logger.error('Cristina AI Grok chat failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Analyze payment evidence using Grok AI.
 * Queries DB for matching payment records and webhook events, then asks Grok
 * to determine whether the payment is valid.
 *
 * @param {object} params
 * @param {string} params.userId - Target user ID
 * @param {string} params.provider - Payment provider (epayco, daimo, btcpay)
 * @param {string} params.reference - Transaction reference / ID
 * @param {number} params.amount - Expected amount
 * @param {string} params.planId - Plan to activate
 * @param {string} [params.notes] - Extra admin notes / context
 * @returns {Promise<{valid: boolean, confidence: string, reason: string, recommendation: string}>}
 */
async function analyzePayment({ userId, provider, reference, amount, planId, notes }) {
  const { query: dbQuery } = require('../config/postgres');

  // 1. Fetch matching payment records
  let paymentRows = [];
  try {
    const res = await dbQuery(
      `SELECT id, reference, user_id, plan_id, provider, amount, currency, status,
              transaction_id, payment_method, completed_at, manual_completion,
              created_at, metadata
       FROM payments
       WHERE (user_id = $1 OR reference = $2 OR transaction_id = $2)
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId, reference]
    );
    paymentRows = res.rows;
  } catch (e) {
    logger.warn('analyzePayment: failed to query payments', { error: e.message });
  }

  // 2. Fetch matching webhook events
  let webhookRows = [];
  try {
    const res = await dbQuery(
      `SELECT provider, event_id, payment_id, status, state_code,
              is_valid_signature, created_at
       FROM payment_webhook_events
       WHERE event_id = $1 OR payment_id::text = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [reference]
    );
    webhookRows = res.rows;
  } catch (e) {
    logger.warn('analyzePayment: failed to query webhook events', { error: e.message });
  }

  // 3. Fetch user info
  let userInfo = null;
  try {
    const res = await dbQuery(
      `SELECT id, username, first_name, tier, subscription_status, plan_id, plan_expiry, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    userInfo = res.rows[0] || null;
  } catch (e) {
    logger.warn('analyzePayment: failed to query user', { error: e.message });
  }

  // 4. Fetch plan info
  let planInfo = null;
  try {
    const res = await dbQuery(
      `SELECT id, name, display_name, tier, price, currency, duration_days, is_lifetime
       FROM plans WHERE id = $1`,
      [planId]
    );
    planInfo = res.rows[0] || null;
  } catch (e) {
    logger.warn('analyzePayment: failed to query plan', { error: e.message });
  }

  // 5. Build Grok prompt
  const systemPrompt = `You are Cristina's Payment Verification Agent — a strict financial auditor for the PNPtv platform.

Your job: analyze payment evidence provided by an admin and determine whether it represents a valid, completed payment that should activate a membership.

PAYMENT PROVIDER RULES:
- ePayco: state code 1 = Accepted/Approved ("Aceptada"/"Aprobada"), 2 = Rejected, 3 = Pending, 4 = Failed
- Daimo: "payment_completed" = valid, "payment_bounced" = failed, "payment_refunded" = refunded
- BTCPay: "Settled" or "Confirmed" = valid

VALIDATION CHECKS (apply ALL):
1. Does a payment record exist in the database for this reference/transaction?
2. Does the payment amount match the plan price (allow small rounding differences up to $0.50)?
3. Does the provider match what was claimed?
4. Is the payment status "completed" or the webhook state code indicate approval?
5. Was the webhook signature valid (is_valid_signature = true)?
6. Does the user_id on the payment match the target user?
7. Is the plan_id on the payment consistent with the requested plan?
8. Has this payment already been used to grant entitlements (check completed_at)?

RESPOND ONLY with valid JSON (no markdown, no code fences):
{
  "valid": true/false,
  "confidence": "high" | "medium" | "low",
  "reason": "1-3 sentence explanation of your verdict",
  "recommendation": "activate" | "reject" | "manual_review",
  "warnings": ["any concerns even if valid"]
}

If no matching records exist at all, set valid=false, confidence="high", reason explaining no records found.
If records exist but data is inconsistent, set valid=false with detailed reason.
If records exist and everything checks out, set valid=true.`;

  const userMessage = `PAYMENT VERIFICATION REQUEST:

Admin wants to verify and activate membership for:
- Target User ID: ${userId}
- User Info: ${userInfo ? JSON.stringify(userInfo, null, 2) : 'NOT FOUND IN DATABASE'}
- Provider claimed: ${provider}
- Reference/Transaction ID: ${reference}
- Amount claimed: ${amount}
- Plan to activate: ${planId}
- Plan Info: ${planInfo ? JSON.stringify(planInfo, null, 2) : 'NOT FOUND IN DATABASE'}
${notes ? `- Admin Notes: ${notes}` : ''}

DATABASE PAYMENT RECORDS FOUND (${paymentRows.length}):
${paymentRows.length > 0 ? JSON.stringify(paymentRows, null, 2) : 'NONE'}

WEBHOOK EVENTS FOUND (${webhookRows.length}):
${webhookRows.length > 0 ? JSON.stringify(webhookRows, null, 2) : 'NONE'}

Analyze this evidence and return your verdict as JSON.`;

  const rawResponse = await chatWithCristina({
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0.1,
    maxTokens: 800,
  });

  // 6. Parse Grok's JSON response
  try {
    // Strip potential markdown fences
    const cleaned = rawResponse.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      valid: Boolean(parsed.valid),
      confidence: parsed.confidence || 'low',
      reason: parsed.reason || 'No reason provided',
      recommendation: parsed.recommendation || 'manual_review',
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch (parseErr) {
    logger.error('analyzePayment: failed to parse Grok response', {
      raw: rawResponse,
      error: parseErr.message,
    });
    return {
      valid: false,
      confidence: 'low',
      reason: `AI analysis returned unparseable response: ${rawResponse.substring(0, 200)}`,
      recommendation: 'manual_review',
      warnings: ['Grok response could not be parsed as JSON'],
    };
  }
}

module.exports = {
  chatWithCristina,
  isCristinaAIAvailable,
  analyzePayment,
};
