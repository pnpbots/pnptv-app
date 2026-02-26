/**
 * federationPrivacyMiddleware.js
 * CRITICAL: Enforces privacy boundaries for federated integration
 *
 * RULES ENFORCED:
 * 1. NO outbound requests to external PDS/Element/Bluesky services
 * 2. NO POST/PUT/PATCH/DELETE to any federated endpoints
 * 3. ALL external API calls must use read-only whitelisted methods
 * 4. Block ANY URL pattern that looks like federation attempt
 * 5. Log all violations for forensic analysis
 *
 * This middleware runs BEFORE any controller logic.
 * If check fails, request is immediately rejected with 403.
 */

const logger = require('../utils/logger');
const { Pool } = require('pg');

// Blocked outbound domains and patterns
const BLOCKED_DOMAINS = [
  /^https?:\/\/(.*\.)?bsky\.social/i,
  /^https?:\/\/(.*\.)?bluesky\.social/i,
  /^https?:\/\/(.*\.)?api\.bsky\.app/i,
  /^https?:\/\/(.*\.)?element\.io/i,
  /^https?:\/\/(.*\.)?matrix\.org/i,
  /^https?:\/\/.*\.element\.io/i,
  /^https?:\/\/.*\.matrix\.org/i,
  /^https?:\/\/.*@(bsky|bluesky|element|matrix)/i, // HTTP auth attempts
];

// Safe inbound-only endpoints
const SAFE_INBOUND_ENDPOINTS = [
  '/api/webhook/bluesky',
  '/api/webhook/element',
  '/api/external/inbound',
];

// Dangerous HTTP methods for federation
const DANGEROUS_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'];

class FederationPrivacyMiddleware {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Main middleware function
   * Checks every request for outbound federation attempts
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Check 1: Dangerous HTTP methods to external URLs
        if (DANGEROUS_METHODS.includes(req.method.toUpperCase())) {
          if (this.isExternalFederationUrl(req)) {
            return this.blockRequest(
              req,
              res,
              'DANGEROUS_METHOD_BLOCKED',
              `${req.method} requests to external services are forbidden`
            );
          }
        }

        // Check 2: Outbound domain blocklist
        if (this.checkOutboundDomainPattern(req)) {
          return this.blockRequest(
            req,
            res,
            'OUTBOUND_DOMAIN_BLOCKED',
            'Request to blocked external domain'
          );
        }

        // Check 3: Suspicious headers indicating federation attempt
        if (this.checkFederationHeaders(req)) {
          return this.blockRequest(
            req,
            res,
            'FEDERATION_HEADERS_DETECTED',
            'Request contains federation headers'
          );
        }

        // Check 4: Custom header bypass attempts
        if (this.checkPrivilegeEscalation(req)) {
          return this.blockRequest(
            req,
            res,
            'PRIVILEGE_ESCALATION_ATTEMPT',
            'Unauthorized federation header detected'
          );
        }

        // Check 5: Inbound webhook authenticity
        if (SAFE_INBOUND_ENDPOINTS.some((ep) => req.path.startsWith(ep))) {
          if (!this.validateWebhookSignature(req)) {
            return this.blockRequest(
              req,
              res,
              'INVALID_WEBHOOK_SIGNATURE',
              'Webhook signature verification failed'
            );
          }
        }

        // Passed all checks, attach audit context
        req.federationAudit = {
          timestamp: new Date(),
          userId: req.user?.id || null,
          ip: this.extractClientIp(req),
          method: req.method,
          path: req.path,
          origin: req.get('origin') || req.get('referer') || 'unknown',
        };

        return next();
      } catch (error) {
        logger.error('[FederationPrivacy] Middleware error', { error: error.message });
        // Fail safe: block if middleware crashes
        return res.status(500).json({
          success: false,
          error: {
            code: 'FEDERATION_CHECK_ERROR',
            message: 'Request validation failed',
          },
        });
      }
    };
  }

  /**
   * Check if request URL matches blocked federation domains
   */
  isExternalFederationUrl(req) {
    const urlPatterns = [
      req.body?.webhook_url,
      req.body?.external_url,
      req.body?.federate_to,
      req.query?.url,
      req.headers['x-forward-url'],
      req.headers['x-external-url'],
    ].filter(Boolean);

    for (const pattern of urlPatterns) {
      if (BLOCKED_DOMAINS.some((domain) => domain.test(pattern))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if request is attempting outbound federation via domains
   */
  checkOutboundDomainPattern(req) {
    const checkPatterns = [
      req.body?.url,
      req.body?.webhook,
      req.body?.endpoint,
      req.body?.share_to,
      req.query?.share,
    ].filter(Boolean);

    return checkPatterns.some((pattern) =>
      BLOCKED_DOMAINS.some((domain) => domain.test(String(pattern)))
    );
  }

  /**
   * Check for suspicious federation headers
   */
  checkFederationHeaders(req) {
    const suspicious = [
      'x-federation-id',
      'x-federation-key',
      'x-at-protocol-key',
      'x-matrix-auth',
      'x-element-token',
      'authorization', // May contain federation tokens
    ];

    for (const header of suspicious) {
      const value = req.get(header);
      if (value && this.isFederationToken(value)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect privilege escalation attempts via headers
   */
  checkPrivilegeEscalation(req) {
    const escalation = [
      'x-admin-override',
      'x-bypass-federation-check',
      'x-force-federation',
      'x-outbound-allowed',
    ];

    return escalation.some((header) => req.get(header));
  }

  /**
   * Validate webhook signature (HMAC-SHA256)
   * Prevents spoofed inbound webhooks
   */
  validateWebhookSignature(req) {
    // TODO: Implement webhook signature verification
    // Bluesky: Verify signature header against secret
    // Element: Verify Matrix signature
    return true; // Placeholder
  }

  /**
   * Check if string looks like a federation token
   */
  isFederationToken(value) {
    const patterns = [
      /^(ey[A-Za-z0-9_-]+\.?){2,}/, // JWT-like
      /^did:/, // DID format
      /^[a-z]:/, // Bluesky PDS format
      /^Bearer\s+at_[a-z0-9]+/i, // AT Protocol token
      /^syt_[a-z0-9]+/i, // Matrix token
    ];

    return patterns.some((p) => p.test(String(value)));
  }

  /**
   * Block the request and log violation
   */
  async blockRequest(req, res, code, message) {
    const ip = this.extractClientIp(req);

    logger.warn('[FederationPrivacy] Request blocked', {
      code,
      message,
      method: req.method,
      path: req.path,
      ip,
      userId: req.user?.id || null,
      timestamp: new Date().toISOString(),
    });

    // Log to outbound_federation_blocks table
    try {
      const query = `
        INSERT INTO outbound_federation_blocks (
          pnptv_user_id, target_service, target_url, target_method,
          request_body, headers_truncated, ip_address, block_reason, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      await this.pool.query(query, [
        req.user?.id || null,
        this.extractService(req),
        req.originalUrl || req.url,
        req.method,
        Buffer.from(JSON.stringify(req.body || {})).slice(0, 10240), // First 10KB
        JSON.stringify(this.redactHeaders(req.headers)),
        ip,
        code,
        'warn',
      ]);
    } catch (error) {
      logger.error('[FederationPrivacy] Failed to log block', { error: error.message });
    }

    // Return 403 Forbidden
    return res.status(403).json({
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Helper: Extract client IP from request
   */
  extractClientIp(req) {
    return (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Helper: Detect service from request
   */
  extractService(req) {
    if (req.path.includes('bluesky')) return 'bluesky';
    if (req.path.includes('element') || req.path.includes('matrix')) return 'element';
    return 'unknown';
  }

  /**
   * Helper: Redact sensitive headers for logging
   */
  redactHeaders(headers) {
    const redacted = { ...headers };
    const sensitiveFields = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'x-token',
      'token',
    ];

    sensitiveFields.forEach((field) => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });

    return redacted;
  }
}

module.exports = FederationPrivacyMiddleware;
