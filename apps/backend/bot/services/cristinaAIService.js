const logger = require('../../utils/logger');
const { AbortController, fetch } = global;

function getCristinaConfig() {
  return {
    apiKey: process.env.GROK_API_KEY || process.env.MISTRAL_API_KEY,
    model: process.env.CRISTINA_GROK_MODEL || process.env.GROK_MODEL || 'grok-2-latest',
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

module.exports = {
  chatWithCristina,
  isCristinaAIAvailable,
};
