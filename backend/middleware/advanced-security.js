// Advanced Security Headers and Content Security Policy for HM Herbs
// Enterprise-level security implementation with comprehensive protection

class AdvancedSecurityManager {
    constructor() {
        this.securityConfig = this.getSecurityConfiguration();
        this.trustedDomains = this.getTrustedDomains();
        this.securityViolations = [];
    }

    // Comprehensive Content Security Policy
    getContentSecurityPolicy() {
        const _nonce = this.generateNonce();
        
        return {
            directives: {
                'default-src': ["'self'"],
                'script-src': [
                    "'self'",
                    "'unsafe-inline'", // TODO: Remove after implementing nonce-based CSP
                    "'unsafe-eval'", // TODO: Remove after refactoring dynamic scripts
                    'https://cdnjs.cloudflare.com',
                    'https://fonts.googleapis.com',
                    'https://www.google-analytics.com',
                    'https://www.googletagmanager.com',
                    'https://js.stripe.com',
                    'https://checkout.stripe.com',
                    'https://secure.nmi.com',
                    'https://sandbox.nmi.com',
                    'https://applepay.cdn-apple.com'
                ],
                'style-src': [
                    "'self'",
                    "'unsafe-inline'", // Required for dynamic styles
                    'https://fonts.googleapis.com',
                    'https://cdnjs.cloudflare.com',
                    'https://secure.nmi.com',
                    'https://sandbox.nmi.com'
                ],
                'img-src': [
                    "'self'",
                    'data:',
                    'blob:',
                    'https:',
                    'https://www.google-analytics.com',
                    'https://stats.g.doubleclick.net'
                ],
                'font-src': [
                    "'self'",
                    'https://fonts.gstatic.com',
                    'https://cdnjs.cloudflare.com',
                    'https://applepay.cdn-apple.com'
                ],
                'connect-src': [
                    "'self'",
                    // Development: Allow localhost connections on common ports
                    'http://localhost:3000',
                    'http://localhost:3001',
                    'http://localhost:3002',
                    'http://localhost:8080',
                    'http://127.0.0.1:3000',
                    'http://127.0.0.1:3001',
                    'http://127.0.0.1:3002',
                    'http://127.0.0.1:8080',
                    // Production APIs
                    'https://api.stripe.com',
                    'https://www.google-analytics.com',
                    'https://stats.g.doubleclick.net',
                    'https://secure.nmi.com',
                    'https://sandbox.nmi.com',
                    'https://secure.networkmerchants.com',
                    'wss:'
                ],
                'media-src': ["'self'"],
                'object-src': ["'none'"],
                'child-src': ["'self'", 'https://js.stripe.com'],
                'frame-src': [
                    "'self'",
                    'https://js.stripe.com',
                    'https://checkout.stripe.com',
                    'https://secure.nmi.com',
                    'https://sandbox.nmi.com',
                    'https://secure.networkmerchants.com'
                ],
                'worker-src': ["'self'", 'blob:'],
                'manifest-src': ["'self'"],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"],
                'upgrade-insecure-requests': true,
                'block-all-mixed-content': true
            },
            reportUri: '/api/security/csp-report',
            reportOnly: false // Set to true for testing, false for enforcement
        };
    }

    // Advanced security headers middleware
    advancedSecurityHeaders() {
        return (req, res, next) => {
            const headers = this.getSecurityHeaders(req);
            
            // Apply all security headers
            Object.entries(headers).forEach(([header, value]) => {
                res.setHeader(header, value);
            });
            
            next();
        };
    }

    // Comprehensive security headers
    getSecurityHeaders(req) {
        const csp = this.getContentSecurityPolicy();
        const cspString = this.buildCSPString(csp);
        
        return {
            // Content Security Policy
            'Content-Security-Policy': cspString,
            
            // Strict Transport Security
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
            
            // X-Frame-Options (defense in depth with CSP frame-ancestors)
            'X-Frame-Options': 'DENY',
            
            // X-Content-Type-Options
            'X-Content-Type-Options': 'nosniff',
            
            // X-XSS-Protection (legacy browsers)
            'X-XSS-Protection': '1; mode=block',
            
            // Referrer Policy
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            
            // Permissions Policy (formerly Feature Policy)
            'Permissions-Policy': this.getPermissionsPolicy(),
            
            // Cross-Origin Embedder Policy
            'Cross-Origin-Embedder-Policy': 'require-corp',
            
            // Cross-Origin Opener Policy
            'Cross-Origin-Opener-Policy': 'same-origin',
            
            // Cross-Origin Resource Policy
            'Cross-Origin-Resource-Policy': 'same-origin',
            
            // X-Permitted-Cross-Domain-Policies
            'X-Permitted-Cross-Domain-Policies': 'none',
            
            // Clear-Site-Data (for logout endpoints)
            ...(req.path === '/api/auth/logout' && {
                'Clear-Site-Data': '"cache", "cookies", "storage", "executionContexts"'
            }),
            
            // Expect-CT (Certificate Transparency)
            'Expect-CT': 'max-age=86400, enforce, report-uri="/api/security/ct-report"',
            
            // X-DNS-Prefetch-Control
            'X-DNS-Prefetch-Control': 'off',
            
            // X-Download-Options (IE)
            'X-Download-Options': 'noopen',
            
            // Cache-Control for sensitive pages
            ...(this.isSensitivePage(req.path) && {
                'Cache-Control': 'no-store, no-cache, must-revalidate, private',
                'Pragma': 'no-cache',
                'Expires': '0'
            })
        };
    }

    // Permissions Policy configuration
    getPermissionsPolicy() {
        return [
            'accelerometer=()',
            'ambient-light-sensor=()',
            'autoplay=()',
            'battery=()',
            'camera=()',
            'cross-origin-isolated=()',
            'display-capture=()',
            'document-domain=()',
            'encrypted-media=()',
            'execution-while-not-rendered=()',
            'execution-while-out-of-viewport=()',
            'fullscreen=(self)',
            'geolocation=()',
            'gyroscope=()',
            'keyboard-map=()',
            'magnetometer=()',
            'microphone=()',
            'midi=()',
            'navigation-override=()',
            'payment=(self)',
            'picture-in-picture=()',
            'publickey-credentials-get=()',
            'screen-wake-lock=()',
            'sync-xhr=()',
            'usb=()',
            'web-share=()',
            'xr-spatial-tracking=()'
        ].join(', ');
    }

    // Subresource Integrity (SRI) generator
    generateSRIHashes() {
        return {
            // External CDN resources
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css': 'sha384-...',
            'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap': 'sha384-...',
            
            // Local assets (would be generated during build)
            '/css/styles.css': 'sha384-...',
            '/js/script.js': 'sha384-...'
        };
    }

    // Trusted Types Policy (for XSS prevention)
    getTrustedTypesPolicy() {
        return {
            policy: `
                if (window.trustedTypes && trustedTypes.createPolicy) {
                    const policy = trustedTypes.createPolicy('hmherbs-policy', {
                        createHTML: (string) => {
                            // Sanitize HTML content
                            return DOMPurify.sanitize(string);
                        },
                        createScript: (string) => {
                            // Only allow specific scripts
                            if (this.isAllowedScript(string)) {
                                return string;
                            }
                            throw new Error('Untrusted script blocked');
                        },
                        createScriptURL: (string) => {
                            // Only allow scripts from trusted domains
                            if (this.isTrustedScriptURL(string)) {
                                return string;
                            }
                            throw new Error('Untrusted script URL blocked');
                        }
                    });
                    
                    window.hmherbsPolicy = policy;
                }
            `
        };
    }

    // Security violation reporting
    setupViolationReporting() {
        return {
            cspReportHandler: (req, res, next) => {
                if (req.path === '/api/security/csp-report') {
                    const violation = req.body;
                    this.logSecurityViolation('csp', violation, req);
                    res.status(204).end();
                    return;
                }
                next();
            },
            
            ctReportHandler: (req, res, next) => {
                if (req.path === '/api/security/ct-report') {
                    const report = req.body;
                    this.logSecurityViolation('ct', report, req);
                    res.status(204).end();
                    return;
                }
                next();
            }
        };
    }

    // Advanced threat detection
    threatDetectionMiddleware() {
        return (req, res, next) => {
            const threats = this.detectThreats(req);
            
            if (threats.length > 0) {
                this.handleThreats(threats, req, res);
                return;
            }
            
            next();
        };
    }

    detectThreats(req) {
        const threats = [];
        
        // SQL Injection detection
        if (this.detectSQLInjection(req)) {
            threats.push({ type: 'sql_injection', severity: 'high' });
        }
        
        // XSS detection
        if (this.detectXSS(req)) {
            threats.push({ type: 'xss', severity: 'high' });
        }
        
        // Path traversal detection
        if (this.detectPathTraversal(req)) {
            threats.push({ type: 'path_traversal', severity: 'medium' });
        }
        
        // Command injection detection
        if (this.detectCommandInjection(req)) {
            threats.push({ type: 'command_injection', severity: 'high' });
        }
        
        // Suspicious user agent
        if (this.detectSuspiciousUserAgent(req)) {
            threats.push({ type: 'suspicious_user_agent', severity: 'low' });
        }
        
        // Rate limit violations
        if (this.detectRateLimitViolation(req)) {
            threats.push({ type: 'rate_limit_violation', severity: 'medium' });
        }
        
        return threats;
    }

    // Security monitoring and alerting
    setupSecurityMonitoring() {
        return {
            // Monitor failed authentication attempts
            authFailureMonitor: (req, res, next) => {
                const originalJson = res.json;
                res.json = function(data) {
                    if (res.statusCode === 401 || res.statusCode === 403) {
                        this.logAuthFailure(req, data);
                    }
                    return originalJson.call(this, data);
                }.bind(this);
                next();
            },
            
            // Monitor suspicious activities
            activityMonitor: (req, res, next) => {
                this.logActivity(req);
                next();
            }
        };
    }

    // Helper methods
    buildCSPString(csp) {
        const directives = [];
        
        Object.entries(csp.directives).forEach(([directive, values]) => {
            if (typeof values === 'boolean' && values) {
                directives.push(directive);
            } else if (Array.isArray(values)) {
                directives.push(`${directive} ${values.join(' ')}`);
            }
        });
        
        return directives.join('; ');
    }

    generateNonce() {
        return require('crypto').randomBytes(16).toString('base64');
    }

    getTrustedDomains() {
        return [
            'hmherbs.com',
            'www.hmherbs.com',
            'api.hmherbs.com',
            'cdn.hmherbs.com'
        ];
    }

    isSensitivePage(path) {
        const sensitivePages = [
            '/admin',
            '/api/admin',
            '/api/auth',
            '/api/user',
            '/api/orders',
            '/api/payment'
        ];
        
        return sensitivePages.some(page => path.startsWith(page));
    }

    detectSQLInjection(req) {
        const sqlPatterns = [
            /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
            /(\'|\"|;|--|\*|\|)/,
            /(\bOR\b|\bAND\b).*(\=|\<|\>)/i
        ];
        
        const inputs = [
            ...Object.values(req.query || {}),
            ...Object.values(req.body || {}),
            ...Object.values(req.params || {})
        ];
        
        return inputs.some(input => 
            typeof input === 'string' && 
            sqlPatterns.some(pattern => pattern.test(input))
        );
    }

    detectXSS(req) {
        const xssPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/i,
            /on\w+\s*=/i,
            /<iframe/i,
            /<object/i,
            /<embed/i
        ];
        
        const inputs = [
            ...Object.values(req.query || {}),
            ...Object.values(req.body || {}),
            req.get('User-Agent') || '',
            req.get('Referer') || ''
        ];
        
        return inputs.some(input => 
            typeof input === 'string' && 
            xssPatterns.some(pattern => pattern.test(input))
        );
    }

    detectPathTraversal(req) {
        const pathTraversalPatterns = [
            /\.\.\//,
            /\.\.\\/,
            /%2e%2e%2f/i,
            /%2e%2e%5c/i
        ];
        
        const paths = [req.path, req.originalUrl];
        
        return paths.some(path => 
            pathTraversalPatterns.some(pattern => pattern.test(path))
        );
    }

    detectCommandInjection(req) {
        const commandPatterns = [
            /(\||;|&|`|\$\(|\${)/,
            /(nc|netcat|wget|curl|ping|nslookup)/i
        ];
        
        const inputs = [
            ...Object.values(req.query || {}),
            ...Object.values(req.body || {})
        ];
        
        return inputs.some(input => 
            typeof input === 'string' && 
            commandPatterns.some(pattern => pattern.test(input))
        );
    }

    detectSuspiciousUserAgent(req) {
        const suspiciousAgents = [
            /sqlmap/i,
            /nikto/i,
            /nessus/i,
            /burp/i,
            /nmap/i,
            /masscan/i
        ];
        
        const userAgent = req.get('User-Agent') || '';
        
        return suspiciousAgents.some(pattern => pattern.test(userAgent));
    }

    detectRateLimitViolation(_req) {
        // This would integrate with the existing rate limiting system
        return false; // Placeholder
    }

    handleThreats(threats, req, res) {
        const highSeverityThreats = threats.filter(t => t.severity === 'high');
        
        if (highSeverityThreats.length > 0) {
            // Block request for high severity threats
            this.logSecurityViolation('threat_detected', { threats, req: this.sanitizeRequest(req) });
            res.status(403).json({ error: 'Request blocked for security reasons' });
            return;
        }
        
        // Log medium/low severity threats but allow request
        this.logSecurityViolation('suspicious_activity', { threats, req: this.sanitizeRequest(req) });
    }

    logSecurityViolation(type, data, req = null) {
        const violation = {
            type,
            timestamp: new Date().toISOString(),
            data,
            ip: req?.ip,
            userAgent: req?.get('User-Agent'),
            path: req?.path,
            method: req?.method
        };
        
        this.securityViolations.push(violation);
        console.warn('Security violation detected:', violation);
        
        // In production, send to security monitoring service
        // this.sendToSecurityService(violation);
    }

    logAuthFailure(req, data) {
        this.logSecurityViolation('auth_failure', {
            path: req.path,
            method: req.method,
            body: this.sanitizeRequest(req).body,
            response: data
        }, req);
    }

    logActivity(req) {
        // Log suspicious activity patterns
        if (this.isSensitivePage(req.path)) {
            console.log(`Sensitive page access: ${req.method} ${req.path} from ${req.ip}`);
        }
    }

    sanitizeRequest(req) {
        return {
            method: req.method,
            path: req.path,
            query: req.query,
            body: this.sanitizeObject(req.body),
            headers: this.sanitizeHeaders(req.headers)
        };
    }

    sanitizeObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    sanitizeHeaders(headers) {
        const sanitized = { ...headers };
        delete sanitized.authorization;
        delete sanitized.cookie;
        return sanitized;
    }

    getSecurityConfiguration() {
        return {
            enableCSP: true,
            enableHSTS: true,
            enableThreatDetection: true,
            enableViolationReporting: true,
            blockHighSeverityThreats: true,
            logAllViolations: true
        };
    }

    // Get security statistics
    getSecurityStats() {
        const now = Date.now();
        const last24Hours = now - (24 * 60 * 60 * 1000);
        
        const recentViolations = this.securityViolations.filter(
            v => new Date(v.timestamp).getTime() > last24Hours
        );
        
        const violationsByType = {};
        recentViolations.forEach(v => {
            violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
        });
        
        return {
            totalViolations: this.securityViolations.length,
            recentViolations: recentViolations.length,
            violationsByType,
            topThreats: Object.entries(violationsByType)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
        };
    }
}

// Export singleton instance
const securityManager = new AdvancedSecurityManager();

module.exports = {
    AdvancedSecurityManager,
    securityManager,
    advancedSecurityHeaders: securityManager.advancedSecurityHeaders.bind(securityManager),
    threatDetectionMiddleware: securityManager.threatDetectionMiddleware.bind(securityManager),
    setupViolationReporting: securityManager.setupViolationReporting.bind(securityManager),
    setupSecurityMonitoring: securityManager.setupSecurityMonitoring.bind(securityManager),
    getSecurityStats: securityManager.getSecurityStats.bind(securityManager)
};
