// Secure Logger for HM Herbs Backend
// Provides secure logging that doesn't expose sensitive information

const winston = require('winston');

class SecureLogger {
    constructor() {
        this.sensitiveKeys = [
            'password', 'token', 'key', 'secret', 'authorization', 'cookie',
            'jwt', 'auth', 'credential', 'pass', 'pwd', 'api_key', 'apikey'
        ];
        
        this.sensitivePatterns = [
            /password[=:]\s*[^\s,}]+/gi,
            /token[=:]\s*[^\s,}]+/gi,
            /key[=:]\s*[^\s,}]+/gi,
            /secret[=:]\s*[^\s,}]+/gi,
            /authorization[=:]\s*[^\s,}]+/gi,
            /bearer\s+[^\s,}]+/gi,
            /jwt\s+[^\s,}]+/gi
        ];
        
        // Create Winston logger instance
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const sanitizedMessage = this.sanitizeMessage(message);
                    const sanitizedMeta = this.sanitizeObject(meta);
                    
                    return JSON.stringify({
                        timestamp,
                        level,
                        message: sanitizedMessage,
                        ...sanitizedMeta
                    });
                })
            ),
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ]
        });
        
        // Add file transport in production
        if (process.env.NODE_ENV === 'production') {
            this.logger.add(new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error'
            }));
            
            this.logger.add(new winston.transports.File({
                filename: 'logs/combined.log'
            }));
        }
    }
    
    /**
     * Sanitize a message string to remove sensitive information
     * @param {string} message - Message to sanitize
     * @returns {string} - Sanitized message
     */
    sanitizeMessage(message) {
        if (!message || typeof message !== 'string') return message;
        
        let sanitized = message;
        this.sensitivePatterns.forEach(pattern => {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        });
        
        return sanitized;
    }
    
    /**
     * Sanitize an object to remove sensitive information
     * @param {*} obj - Object to sanitize
     * @returns {*} - Sanitized object
     */
    sanitizeObject(obj) {
        if (!obj) return obj;
        
        if (typeof obj === 'string') {
            return this.sanitizeMessage(obj);
        }
        
        if (typeof obj !== 'object') return obj;
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }
        
        const sanitized = {};
        
        Object.entries(obj).forEach(([key, value]) => {
            const lowerKey = key.toLowerCase();
            
            // Check if key contains sensitive information
            if (this.sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'object') {
                sanitized[key] = this.sanitizeObject(value);
            } else if (typeof value === 'string') {
                sanitized[key] = this.sanitizeMessage(value);
            } else {
                sanitized[key] = value;
            }
        });
        
        return sanitized;
    }
    
    /**
     * Log info level message
     * @param {string} message - Log message
     * @param {*} meta - Additional metadata
     */
    info(message, meta = {}) {
        this.logger.info(message, meta);
    }
    
    /**
     * Log warning level message
     * @param {string} message - Log message
     * @param {*} meta - Additional metadata
     */
    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }
    
    /**
     * Log error level message
     * @param {string} message - Log message
     * @param {*} meta - Additional metadata
     */
    error(message, meta = {}) {
        this.logger.error(message, meta);
    }
    
    /**
     * Log debug level message
     * @param {string} message - Log message
     * @param {*} meta - Additional metadata
     */
    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }
    
    /**
     * Log authentication events securely
     * @param {string} event - Event type (login, logout, register, etc.)
     * @param {string} userId - User ID (not email or username)
     * @param {string} ip - IP address
     * @param {string} userAgent - User agent
     * @param {boolean} success - Whether the event was successful
     * @param {string} reason - Reason for failure (if applicable)
     */
    logAuthEvent(event, userId, ip, userAgent, success, reason = null) {
        const logData = {
            event,
            userId,
            ip,
            userAgent: userAgent ? userAgent.substring(0, 200) : null, // Limit length
            success,
            timestamp: new Date().toISOString()
        };
        
        if (!success && reason) {
            logData.reason = reason;
        }
        
        if (success) {
            this.info(`Authentication event: ${event}`, logData);
        } else {
            this.warn(`Authentication failed: ${event}`, logData);
        }
    }
    
    /**
     * Log database operations securely
     * @param {string} operation - Database operation (SELECT, INSERT, UPDATE, DELETE)
     * @param {string} table - Table name
     * @param {number} affectedRows - Number of affected rows
     * @param {number} duration - Operation duration in ms
     * @param {string} userId - User ID performing the operation
     */
    logDatabaseOperation(operation, table, affectedRows, duration, userId = null) {
        const logData = {
            operation,
            table,
            affectedRows,
            duration,
            userId,
            timestamp: new Date().toISOString()
        };
        
        this.debug(`Database operation: ${operation} on ${table}`, logData);
    }
    
    /**
     * Log security events
     * @param {string} event - Security event type
     * @param {string} severity - Severity level (low, medium, high, critical)
     * @param {string} description - Event description
     * @param {*} metadata - Additional metadata
     */
    logSecurityEvent(event, severity, description, metadata = {}) {
        const logData = {
            securityEvent: event,
            severity,
            description,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        switch (severity) {
            case 'critical':
            case 'high':
                this.error(`Security event: ${event}`, logData);
                break;
            case 'medium':
                this.warn(`Security event: ${event}`, logData);
                break;
            default:
                this.info(`Security event: ${event}`, logData);
        }
    }
    
    /**
     * Create a child logger with additional context
     * @param {Object} context - Additional context to include in all logs
     * @returns {Object} - Child logger instance
     */
    child(context) {
        const sanitizedContext = this.sanitizeObject(context);
        const childLogger = this.logger.child(sanitizedContext);
        
        return {
            info: (message, meta = {}) => childLogger.info(message, this.sanitizeObject(meta)),
            warn: (message, meta = {}) => childLogger.warn(message, this.sanitizeObject(meta)),
            error: (message, meta = {}) => childLogger.error(message, this.sanitizeObject(meta)),
            debug: (message, meta = {}) => childLogger.debug(message, this.sanitizeObject(meta))
        };
    }
}

// Create and export singleton instance
const secureLogger = new SecureLogger();

module.exports = secureLogger;
