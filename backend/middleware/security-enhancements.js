// Security Enhancements for HM Herbs
// Additional security measures beyond helmet.js

const rateLimit = require('express-rate-limit');

// Enhanced rate limiting for different endpoints
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// Strict rate limiting for authentication endpoints
const authRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 attempts
  'Too many authentication attempts, please try again later'
);

// Moderate rate limiting for API endpoints
const apiRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests
  'Too many API requests, please try again later'
);

// Strict rate limiting for password reset
const passwordResetRateLimit = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 attempts
  'Too many password reset attempts, please try again later'
);

// File upload rate limiting
const uploadRateLimit = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 uploads
  'Too many file uploads, please try again later'
);

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Additional security headers beyond helmet
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
};

// Request sanitization middleware
const sanitizeRequest = (req, res, next) => {
  // Remove null bytes from all string inputs
  const sanitizeString = (str) => {
    if (typeof str === 'string') {
      return str.replace(/\0/g, '');
    }
    return str;
  };

  const sanitizeObject = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = sanitizeString(obj[key]);
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    }
  };

  // Sanitize request body, query, and params
  sanitizeObject(req.body);
  sanitizeObject(req.query);
  sanitizeObject(req.params);

  next();
};

// IP whitelist middleware (for admin endpoints)
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (allowedIPs.length === 0) {
      return next(); // No whitelist configured, allow all
    }

    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    if (allowedIPs.includes(clientIP)) {
      next();
    } else {
      res.status(403).json({
        error: 'Access denied from this IP address'
      });
    }
  };
};

// Request size limiting middleware
const requestSizeLimit = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('Content-Length') || '0');
    const maxSizeBytes = typeof maxSize === 'string' 
      ? parseInt(maxSize.replace(/[^\d]/g, '')) * (maxSize.includes('mb') ? 1024 * 1024 : 1024)
      : maxSize;

    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        error: 'Request entity too large',
        maxSize: maxSize
      });
    }

    next();
  };
};

// Suspicious activity detection
const suspiciousActivityDetection = (req, res, next) => {
  const suspiciousPatterns = [
    /(<script|javascript:|vbscript:|onload=|onerror=)/i,
    /(union\s+select|drop\s+table|insert\s+into)/i,
    /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c)/i,
    /(\||\;|\&|\$|\`)/,
    /(eval\(|exec\(|system\()/i
  ];

  const checkForSuspiciousContent = (obj) => {
    if (typeof obj === 'string') {
      return suspiciousPatterns.some(pattern => pattern.test(obj));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (checkForSuspiciousContent(obj[key])) {
          return true;
        }
      }
    }
    
    return false;
  };

  // Check URL, query params, and body for suspicious content
  const url = req.url;
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(url)) ||
                     checkForSuspiciousContent(req.query) ||
                     checkForSuspiciousContent(req.body);

  if (isSuspicious) {
    console.warn(`Suspicious activity detected from IP ${req.ip}: ${req.method} ${req.url}`);
    return res.status(400).json({
      error: 'Request contains suspicious content'
    });
  }

  next();
};

// Brute force protection for specific endpoints
const bruteForceProtection = () => {
  const attempts = new Map();
  const maxAttempts = 5;
  const windowMs = 15 * 60 * 1000; // 15 minutes

  return (req, res, next) => {
    const key = `${req.ip}-${req.path}`;
    const now = Date.now();
    
    if (!attempts.has(key)) {
      attempts.set(key, { count: 1, firstAttempt: now });
      return next();
    }

    const attemptData = attempts.get(key);
    
    // Reset if window has passed
    if (now - attemptData.firstAttempt > windowMs) {
      attempts.set(key, { count: 1, firstAttempt: now });
      return next();
    }

    // Increment attempt count
    attemptData.count++;

    if (attemptData.count > maxAttempts) {
      return res.status(429).json({
        error: 'Too many failed attempts, please try again later',
        retryAfter: Math.ceil((attemptData.firstAttempt + windowMs - now) / 1000)
      });
    }

    next();
  };
};

module.exports = {
  authRateLimit,
  apiRateLimit,
  passwordResetRateLimit,
  uploadRateLimit,
  securityHeaders,
  sanitizeRequest,
  ipWhitelist,
  requestSizeLimit,
  suspiciousActivityDetection,
  bruteForceProtection
};
