// CSRF Protection Middleware for HM Herbs
// Prevents Cross-Site Request Forgery attacks

const crypto = require('crypto');

class CSRFProtection {
  constructor() {
    this.tokens = new Map(); // In production, use Redis or database
    this.tokenExpiry = 60 * 60 * 1000; // 1 hour
    
    // Clean up expired tokens every 10 minutes
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 10 * 60 * 1000);
  }

  // Generate a new CSRF token
  generateToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + this.tokenExpiry;
    
    this.tokens.set(token, {
      sessionId,
      expiry,
      used: false
    });
    
    return token;
  }

  // Validate CSRF token
  validateToken(token, sessionId) {
    const tokenData = this.tokens.get(token);
    
    if (!tokenData) {
      return false; // Token doesn't exist
    }
    
    if (tokenData.expiry < Date.now()) {
      this.tokens.delete(token);
      return false; // Token expired
    }
    
    if (tokenData.sessionId !== sessionId) {
      return false; // Token doesn't match session
    }
    
    if (tokenData.used) {
      return false; // Token already used (optional: implement one-time use)
    }
    
    // Mark token as used (optional: for one-time use tokens)
    // tokenData.used = true;
    
    return true;
  }

  // Clean up expired tokens
  cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, data] of this.tokens.entries()) {
      if (data.expiry < now) {
        this.tokens.delete(token);
      }
    }
  }

  // Middleware to generate CSRF token
  generateTokenMiddleware() {
    return (req, res, next) => {
      // Get session ID (from JWT token or session)
      const sessionId = req.user?.id || req.admin?.id || req.sessionID || 'anonymous';
      
      // Generate token
      const csrfToken = this.generateToken(sessionId);
      
      // Add token to response
      res.locals.csrfToken = csrfToken;
      
      // Add token to response headers
      res.setHeader('X-CSRF-Token', csrfToken);
      
      next();
    };
  }

  // Middleware to validate CSRF token
  validateTokenMiddleware() {
    return (req, res, next) => {
      // Skip validation for GET, HEAD, OPTIONS requests
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }

      // Get session ID
      const sessionId = req.user?.id || req.admin?.id || req.sessionID || 'anonymous';
      
      // Get token from various sources
      const token = req.headers['x-csrf-token'] || 
                   req.headers['csrf-token'] ||
                   req.body._csrf ||
                   req.query._csrf;

      if (!token) {
        return res.status(403).json({
          error: 'CSRF token missing',
          code: 'CSRF_TOKEN_MISSING'
        });
      }

      if (!this.validateToken(token, sessionId)) {
        return res.status(403).json({
          error: 'Invalid CSRF token',
          code: 'CSRF_TOKEN_INVALID'
        });
      }

      next();
    };
  }

  // Get token for a session (for API endpoints)
  getTokenForSession(sessionId) {
    return this.generateToken(sessionId);
  }
}

// Create singleton instance
const csrfProtection = new CSRFProtection();

module.exports = {
  csrfProtection,
  generateToken: csrfProtection.generateTokenMiddleware(),
  validateToken: csrfProtection.validateTokenMiddleware(),
  getToken: (sessionId) => csrfProtection.getTokenForSession(sessionId)
};
