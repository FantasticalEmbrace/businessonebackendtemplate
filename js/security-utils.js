// Security Utilities for HM Herbs
// Provides secure DOM manipulation and input sanitization

class SecurityUtils {
    constructor() {
        this.isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    }

    /**
     * Safely set text content without XSS risk
     * @param {HTMLElement} element - Target element
     * @param {string} text - Text to set
     */
    setTextContent(element, text) {
        if (!element) return;
        element.textContent = String(text || '');
    }

    /**
     * Safely create HTML content with sanitization
     * @param {string} html - HTML string to sanitize
     * @returns {string} - Sanitized HTML
     */
    sanitizeHTML(html) {
        if (!html) return '';
        
        // Create a temporary div to parse HTML
        const temp = document.createElement('div');
        temp.textContent = html; // This escapes HTML entities
        return temp.innerHTML;
    }

    /**
     * Create DOM elements safely
     * @param {string} tagName - Element tag name
     * @param {Object} attributes - Element attributes
     * @param {string} textContent - Text content
     * @returns {HTMLElement} - Created element
     */
    createElement(tagName, attributes = {}, textContent = '') {
        const element = document.createElement(tagName);
        
        // Set attributes safely
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = String(value);
            } else if (key === 'innerHTML') {
                // Prevent innerHTML usage - use textContent instead
                console.warn('innerHTML usage blocked for security. Use textContent instead.');
                element.textContent = String(value);
            } else {
                element.setAttribute(key, String(value));
            }
        });
        
        if (textContent) {
            element.textContent = String(textContent);
        }
        
        return element;
    }

    /**
     * Safely update element content with mixed HTML/text
     * @param {HTMLElement} element - Target element
     * @param {string} content - Content to set
     * @param {boolean} allowBasicHTML - Allow basic HTML tags (b, i, em, strong)
     */
    setContent(element, content, allowBasicHTML = false) {
        if (!element || !content) return;
        
        if (allowBasicHTML) {
            // Allow only basic formatting tags
            const allowedTags = ['b', 'i', 'em', 'strong', 'br'];
            const sanitized = this.sanitizeBasicHTML(content, allowedTags);
            element.innerHTML = sanitized;
        } else {
            element.textContent = String(content);
        }
    }

    /**
     * Sanitize HTML allowing only specific tags
     * @param {string} html - HTML to sanitize
     * @param {Array} allowedTags - Array of allowed tag names
     * @returns {string} - Sanitized HTML
     */
    sanitizeBasicHTML(html, allowedTags = []) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Remove all elements not in allowedTags
        const allElements = temp.querySelectorAll('*');
        allElements.forEach(el => {
            if (!allowedTags.includes(el.tagName.toLowerCase())) {
                // Replace with text content
                const textNode = document.createTextNode(el.textContent);
                el.parentNode.replaceChild(textNode, el);
            } else {
                // Remove all attributes from allowed elements
                while (el.attributes.length > 0) {
                    el.removeAttribute(el.attributes[0].name);
                }
            }
        });
        
        return temp.innerHTML;
    }

    /**
     * Validate and sanitize user input
     * @param {string} input - User input
     * @param {Object} options - Validation options
     * @returns {string} - Sanitized input
     */
    sanitizeInput(input, options = {}) {
        if (!input) return '';
        
        let sanitized = String(input).trim();
        
        // Remove null bytes
        sanitized = sanitized.replace(/\0/g, '');
        
        // Limit length
        if (options.maxLength) {
            sanitized = sanitized.substring(0, options.maxLength);
        }
        
        // Remove HTML if not allowed
        if (!options.allowHTML) {
            const temp = document.createElement('div');
            temp.textContent = sanitized;
            sanitized = temp.textContent;
        }
        
        return sanitized;
    }

    /**
     * Secure logging that doesn't expose sensitive data
     * @param {string} level - Log level (log, warn, error)
     * @param {string} message - Log message
     * @param {*} data - Additional data (will be sanitized)
     */
    log(level, message, data = null) {
        if (!this.isDevelopment) return;
        
        const sanitizedMessage = this.sanitizeLogMessage(message);
        
        if (data) {
            const sanitizedData = this.sanitizeLogData(data);
            console[level](sanitizedMessage, sanitizedData);
        } else {
            console[level](sanitizedMessage);
        }
    }

    /**
     * Sanitize log messages to remove sensitive data
     * @param {string} message - Log message
     * @returns {string} - Sanitized message
     */
    sanitizeLogMessage(message) {
        if (!message) return '';
        
        // Remove potential passwords, tokens, keys
        const sensitivePatterns = [
            /password[=:]\s*[^\s]+/gi,
            /token[=:]\s*[^\s]+/gi,
            /key[=:]\s*[^\s]+/gi,
            /secret[=:]\s*[^\s]+/gi,
            /authorization[=:]\s*[^\s]+/gi
        ];
        
        let sanitized = String(message);
        sensitivePatterns.forEach(pattern => {
            sanitized = sanitized.replace(pattern, '[REDACTED]');
        });
        
        return sanitized;
    }

    /**
     * Sanitize log data objects
     * @param {*} data - Data to sanitize
     * @returns {*} - Sanitized data
     */
    sanitizeLogData(data) {
        if (!data) return data;
        
        if (typeof data === 'string') {
            return this.sanitizeLogMessage(data);
        }
        
        if (typeof data === 'object') {
            const sanitized = {};
            const sensitiveKeys = ['password', 'token', 'key', 'secret', 'authorization', 'cookie'];
            
            Object.entries(data).forEach(([key, value]) => {
                if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                    sanitized[key] = '[REDACTED]';
                } else if (typeof value === 'object') {
                    sanitized[key] = this.sanitizeLogData(value);
                } else {
                    sanitized[key] = value;
                }
            });
            
            return sanitized;
        }
        
        return data;
    }

    /**
     * Event listener manager with automatic cleanup
     */
    createEventManager() {
        const listeners = new Map();
        
        return {
            addEventListener: (element, event, handler, options = {}) => {
                element.addEventListener(event, handler, options);
                
                // Store for cleanup
                const key = `${element.tagName}-${event}-${Date.now()}`;
                listeners.set(key, { element, event, handler });
                
                return key;
            },
            
            removeEventListener: (key) => {
                const listener = listeners.get(key);
                if (listener) {
                    listener.element.removeEventListener(listener.event, listener.handler);
                    listeners.delete(key);
                }
            },
            
            cleanup: () => {
                listeners.forEach((listener) => {
                    listener.element.removeEventListener(listener.event, listener.handler);
                });
                listeners.clear();
            }
        };
    }
}

// Create global instance
window.SecurityUtils = new SecurityUtils();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecurityUtils;
}
