const crypto = require('crypto');
const logger = require('../../../utils/logger');

const AUTH_SECRET = process.env.JWT_SECRET
  || process.env.SESSION_SECRET
  || (process.env.NODE_ENV === 'test' ? 'test-jwt-secret' : null);

/**
 * Generate JWT Token
 * Format: header.payload.signature
 */
function generateJWT(payload, secret = AUTH_SECRET) {
  if (!secret) {
    throw new Error('JWT secret is not configured');
  }

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${encodedPayload}`)
    .digest('base64url');
  
  return `${header}.${encodedPayload}.${signature}`;
}

/**
 * Verify and Decode JWT Token
 */
function verifyJWT(token, secret = AUTH_SECRET) {
  try {
    if (!secret) {
      logger.error('JWT secret is not configured');
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signatureB64 !== expectedSignature) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    
    // Check expiration (24 hours from issue)
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 24 * 60 * 60; // 24 hours
    if (payload.iat && (now - payload.iat) > maxAge) {
      return null;
    }

    return payload;
  } catch (err) {
    logger.error('JWT verification error:', err);
    return null;
  }
}

/**
 * JWT verification middleware for API endpoints
 */
function verifyJWTMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-access-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload;
  next();
}

/**
 * Admin-specific JWT middleware
 */
function verifyAdminJWT(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-access-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const role = payload.role || 'user';
  if (!['admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ error: 'Not authorized - admin access required' });
  }

  req.user = payload;
  next();
}

module.exports = {
  generateJWT,
  verifyJWT,
  verifyJWTMiddleware,
  verifyAdminJWT
};
