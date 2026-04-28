'use strict';

/**
 * MetricsService
 *
 * Minimal Prometheus-format metric surface for the payment pipeline.
 * Designed to be scraped by Grafana Cloud (remote_write) or any
 * Prometheus-compatible collector. Internal /metrics endpoint is
 * admin-gated; not exposed to the public internet.
 *
 * Why this exists: the Apr-2026 Dash webhook misconfiguration was
 * undetected for 7+ weeks. A single alert on
 * `pnptv_pending_dash_invoices_age_max_minutes > 30` would have
 * fired within the first hour of the misconfig.
 *
 * Metrics emitted:
 *   pnptv_payment_webhook_received_total{provider,event_type}
 *     — counter, +1 on every received webhook (successful sig included)
 *   pnptv_payment_webhook_failed_total{provider,reason}
 *     — counter, +1 on signature/handler/grant failures
 *   pnptv_payment_grant_succeeded_total{provider,plan_id}
 *     — counter, +1 on every successful entitlement grant
 *   pnptv_payment_grant_failed_total{provider,reason}
 *     — counter, +1 on entitlement grant failures
 *   pnptv_pending_dash_invoices_age_max_minutes
 *     — gauge, age of the oldest pending Dash invoice (refreshed by reconciler)
 *   pnptv_pending_dash_invoices_count
 *     — gauge, number of pending Dash invoices >10min old
 */

const promClient = require('prom-client');
const logger = require('../utils/logger');

// Collect Node.js default metrics (heap, GC, event-loop lag, etc.)
const defaultRegister = promClient.register;
promClient.collectDefaultMetrics({ register: defaultRegister, prefix: 'pnptv_node_' });

const webhookReceivedTotal = new promClient.Counter({
  name: 'pnptv_payment_webhook_received_total',
  help: 'Payment webhook deliveries received (signature already validated)',
  labelNames: ['provider', 'event_type'],
});

const webhookFailedTotal = new promClient.Counter({
  name: 'pnptv_payment_webhook_failed_total',
  help: 'Payment webhook deliveries that failed processing',
  labelNames: ['provider', 'reason'],
});

const grantSucceededTotal = new promClient.Counter({
  name: 'pnptv_payment_grant_succeeded_total',
  help: 'Successful entitlement grants',
  labelNames: ['provider', 'plan_id'],
});

const grantFailedTotal = new promClient.Counter({
  name: 'pnptv_payment_grant_failed_total',
  help: 'Failed entitlement grants',
  labelNames: ['provider', 'reason'],
});

const pendingDashAgeMaxMinutes = new promClient.Gauge({
  name: 'pnptv_pending_dash_invoices_age_max_minutes',
  help: 'Age in minutes of the oldest pending Dash invoice. >30 = pipeline likely broken.',
});

const pendingDashCount = new promClient.Gauge({
  name: 'pnptv_pending_dash_invoices_count',
  help: 'Number of Dash invoices stuck pending >10 minutes',
});

class MetricsService {
  static recordWebhookReceived(provider, eventType) {
    try { webhookReceivedTotal.inc({ provider, event_type: eventType || 'unknown' }); }
    catch (err) { logger.warn(`metrics.recordWebhookReceived failed: ${err.message}`); }
  }

  static recordWebhookFailed(provider, reason) {
    try { webhookFailedTotal.inc({ provider, reason: reason || 'unknown' }); }
    catch (err) { logger.warn(`metrics.recordWebhookFailed failed: ${err.message}`); }
  }

  static recordGrantSucceeded(provider, planId) {
    try { grantSucceededTotal.inc({ provider, plan_id: planId || 'unknown' }); }
    catch (err) { logger.warn(`metrics.recordGrantSucceeded failed: ${err.message}`); }
  }

  static recordGrantFailed(provider, reason) {
    try { grantFailedTotal.inc({ provider, reason: reason || 'unknown' }); }
    catch (err) { logger.warn(`metrics.recordGrantFailed failed: ${err.message}`); }
  }

  static setPendingDashStats({ ageMaxMinutes, count }) {
    try {
      if (typeof ageMaxMinutes === 'number') pendingDashAgeMaxMinutes.set(ageMaxMinutes);
      if (typeof count === 'number') pendingDashCount.set(count);
    } catch (err) {
      logger.warn(`metrics.setPendingDashStats failed: ${err.message}`);
    }
  }

  static async render() {
    return defaultRegister.metrics();
  }

  static contentType() {
    return defaultRegister.contentType;
  }
}

module.exports = MetricsService;
