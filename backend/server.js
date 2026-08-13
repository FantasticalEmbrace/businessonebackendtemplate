// Business One merchant platform — Backend API (template copy; do not confuse with HM Herbs)

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { ensureProductCatalogImages } = require('./utils/ensureProductCatalogImages');

// Load .env file FIRST - before any other requires that might need it
// Use explicit path to ensure we're loading from the backend directory
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

const logger = require('./utils/logger');
const { handlePromoBannerGet, disabledPayload } = require('./utils/promoBanner');
const { createSeoRedirectMiddleware } = require('./middleware/seoRedirects');
const { ensureProductSchema } = require('./utils/ensureProductSchema');
const { ensureInventorySettings } = require('./utils/ensureInventorySettings');
const {
    loadInventorySettings,
    enrichProductRow,
    toPublicSettings,
    canFulfillQuantity,
    isTracked,
    allowsOversell
} = require('./utils/inventorySettings');
const { ensureProductVariantSchema } = require('./utils/ensureProductVariantSchema');
const { ensureShippingSchema } = require('./utils/ensureShippingSchema');
const { ensurePosSchema } = require('./utils/ensurePosSchema');
const { hydrateFromDatabase: hydrateIntegrationCredentials } = require('./services/integrationCredentials');
const { ensurePosSignupSchema } = require('./utils/ensurePosSignupSchema');
const { ensureMenuSchema } = require('./utils/ensureMenuSchema');
const { ensurePlatformSupportSchema } = require('./utils/ensurePlatformSupportSchema');
const { ensurePersonnelSchema } = require('./utils/ensurePersonnelSchema');
const { ensureGiftCardPurchaseSchema } = require('./utils/ensureGiftCardPurchaseSchema');
const { ensureGiftCardCatalog } = require('./utils/ensureGiftCardCatalog');
const { ensureProductStorefrontSchema } = require('./utils/ensureProductStorefrontSchema');
const { ensureCbdCategory } = require('./utils/ensureCbdCategory');
const { ensureCustomerGroupSchema } = require('./utils/ensureCustomerGroupSchema');
const { ensureUserPasswordResetSchema } = require('./utils/ensureUserPasswordResetSchema');
const { ensureEdsaBookingSchema } = require('./utils/ensureEdsaBookingSchema');
const { ensureEdsaBlockedDatesTable } = require('./services/edsaBlockedDates');
const {
    findCustomerByEmailAnyStatus,
    reactivateCustomerForLocalSignup,
    loadCustomerRow
} = require('./utils/customerAccountReactivation');
const { provisionWebCustomerProfile } = require('./utils/provisionCustomerProfile');
const { loadLoyaltyProgramSettings } = require('./services/customerLoyalty');
const { saveRegistrationMailingAddress, normalizeRegistrationMailingAddress } = require('./utils/saveRegistrationMailingAddress');
const { isUsPhoneDisplayOrEmpty } = require('./utils/usPhoneDisplay');
const { startTaxReserveScheduler } = require('./services/taxReserveScheduler');
const { startPosBillingScheduler } = require('./services/posBillingScheduler');
const { startPlatformBillingScheduler } = require('./services/platformBillingScheduler');
const { ensurePlatformBillingSchema } = require('./utils/ensurePlatformBillingSchema');
const { startTaxAccountantScheduler } = require('./services/taxAccountantScheduler');
const { startPosDailySalesScheduler } = require('./services/posDailySalesScheduler');
const { startPosPayrollScheduler } = require('./services/posPayrollScheduler');
const { ensureSocialOAuthSchema } = require('./utils/ensureSocialOAuthSchema');
const { createCustomerGoogleRoutes, createAdminGoogleRoutes } = require('./routes/socialAuth');
const secureLogger = require('./utils/secure-logger');
const {
    userRegistrationValidation,
    userLoginValidation,
    userForgotPasswordValidation,
    userResetPasswordValidation
} = require('./middleware/validation');
const {
    catalogPrimaryImageForProduct,
    applyCatalogPriceFix,
    sanitizeLegacyProductImageUrl
} = require('./utils/catalogOverrides');
const { STOREFRONT_VISIBLE_WHERE } = require('./utils/storefrontProductVisibility');
const { toStorefrontProduct } = require('./utils/storefrontProduct');
const {
    enrichProductListPricesFromVariants,
    applyVariantPriceFallbackFromVariants
} = require('./utils/storefrontProductPrice');

const { jsonSafeDeep } = require('./utils/jsonSafeMysql');
const { buildDbConfig } = require('./utils/dbConfig');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Rate limiting for database error logging (prevent console spam)
const dbErrorLogTimes = new Map();
const DB_ERROR_LOG_INTERVAL = 60000; // Log database errors at most once per minute

function shouldLogDatabaseError(errorCode) {
    if (errorCode !== 'ER_ACCESS_DENIED_ERROR' && errorCode !== 'ECONNREFUSED') {
        return true; // Always log non-database connection errors
    }

    const now = Date.now();
    const lastLogTime = dbErrorLogTimes.get(errorCode) || 0;

    if (now - lastLogTime > DB_ERROR_LOG_INTERVAL) {
        dbErrorLogTimes.set(errorCode, now);
        return true;
    }

    return false; // Don't log - too soon since last log
}

// Database connection (local MySQL or Linode Managed MySQL — see utils/dbConfig.js)
let dbConfig;
try {
    dbConfig = buildDbConfig();
} catch (err) {
    logger.error(`Database configuration error: ${err.message}`);
    process.exit(1);
}

// Log database config (without password) for debugging
if (process.env.NODE_ENV === 'development') {
    logger.info('Database config:', {
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        database: dbConfig.database,
        ssl: !!dbConfig.ssl,
        hasPassword: !!dbConfig.password,
        passwordLength: dbConfig.password ? dbConfig.password.length : 0
    });

    // Warn if password is missing
    if (!dbConfig.password || dbConfig.password.trim() === '') {
        logger.warn('⚠️ WARNING: DB_PASSWORD is empty or not set in .env file!');
        logger.warn('   Database connections will fail. Please set DB_PASSWORD in backend/.env');
    }
}

const pool = mysql.createPool(dbConfig);

// Attach DB pool to every request first (public routes and middleware expect req.pool).
app.use((req, res, next) => {
    req.pool = pool;
    next();
});

// Enhanced Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false, // Don't use helmet defaults - use our own
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com",
                // NMI Collect.js inline variant loads hosted styles
                "https://secure.nmi.com",
                "https://sandbox.nmi.com"
            ],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                // NMI Collect.js (card tokenization on checkout; sandbox for NMI test keys)
                "https://secure.nmi.com",
                "https://sandbox.nmi.com",
                // Apple Pay SDK (loaded by Collect.js when Apple Pay is offered)
                "https://applepay.cdn-apple.com"
            ],
            scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                // Apple Pay button / wallet SDK (Collect.js) loads fonts from applepay.cdn-apple.com
                "https://applepay.cdn-apple.com"
            ],
            imgSrc: ["'self'", "data:", "https:", "blob:", "http:", "https://images.unsplash.com", "https://hmherbs.com", "https://*.hmherbs.com"],
            connectSrc: [
                "'self'",
                // Development: Allow localhost connections on all common ports
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:3002",
                "http://localhost:8080",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:3002",
                "http://127.0.0.1:8080",
                // Production APIs
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                "https://hmherbs.com",
                "https://*.hmherbs.com",
                "https://images.unsplash.com",
                // NMI tokenization / gateway (Collect.js inline + API)
                "https://secure.nmi.com",
                "https://sandbox.nmi.com",
                "https://secure.networkmerchants.com",
                "ws:", // WebSocket support
                "wss:" // Secure WebSocket support
            ],
            // Inline Collect.js mounts hosted fields in iframes on NMI hosts
            frameSrc: [
                "'self'",
                "https://secure.nmi.com",
                "https://sandbox.nmi.com",
                "https://secure.networkmerchants.com"
            ],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            workerSrc: ["'self'", "blob:"],
            childSrc: ["'self'"],
            formAction: ["'self'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: null, // Disable upgrade insecure requests in development
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // POS PWA (e.g. localhost:8080) embeds product photos from this server.
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
// Compression middleware - but exclude SSE endpoints
app.use(compression({
    filter: (req, res) => {
        // Don't compress Server-Sent Events
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
            return false;
        }
        // Service worker must be readable as plain script; compression can confuse devtools / registration
        if (req.path === '/service-worker.js') {
            return false;
        }
        // Use default compression filter for other responses
        return compression.filter(req, res);
    }
}));
// CORS configuration with support for multiple origins
const allowedOrigins = [
    'http://localhost:8000',
    'http://localhost:3000',
    'http://localhost:3001', // Allow same-origin requests when frontend is served from backend
    'http://localhost:5500', // VS Code Live Server and similar
    'http://localhost:5173', // Vite dev
    'http://localhost:4173', // Vite preview
    'http://localhost:8080',
    'http://localhost:8765', // python -m http.server local preview
    'http://127.0.0.1:8000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001', // Allow same-origin requests when frontend is served from backend
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8765', // python -m http.server local preview
    // Capacitor Android/iOS WebView origins
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    'https://businessonecomprehensive.com',
    'http://businessonecomprehensive.com',
    'https://www.businessonecomprehensive.com',
    'http://www.businessonecomprehensive.com',
    'https://signup.businessonecomprehensive.com',
    'http://signup.businessonecomprehensive.com',
    'https://pos.businessonecomprehensive.com',
    'http://pos.businessonecomprehensive.com'
];

// Add production frontend URL if specified
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
    allowedOrigins.push(process.env.FRONTEND_URL);
}
if (process.env.STOREFRONT_PUBLIC_URL && !allowedOrigins.includes(process.env.STOREFRONT_PUBLIC_URL)) {
    allowedOrigins.push(process.env.STOREFRONT_PUBLIC_URL);
}

// Optional comma-separated extra origins (staging hostnames, alternate sslip.io URLs, etc.)
if (process.env.CORS_EXTRA_ORIGINS) {
    process.env.CORS_EXTRA_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .forEach((origin) => {
            if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
        });
}

// Add production domain if specified
if (process.env.PRODUCTION_DOMAIN) {
    allowedOrigins.push(`https://${process.env.PRODUCTION_DOMAIN}`);
    allowedOrigins.push(`http://${process.env.PRODUCTION_DOMAIN}`);
}

// Business One POS PWA origins (comma-separated), e.g. http://localhost:8080,https://pos.hmherbs.com
if (process.env.POS_ALLOWED_ORIGINS) {
    process.env.POS_ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .forEach((origin) => {
            if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
        });
}

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Development: allow any localhost / 127.0.0.1 port (python http.server, Live Server, etc.)
        if (process.env.NODE_ENV !== 'production') {
            try {
                const { hostname } = new URL(origin);
                if (hostname === 'localhost' || hostname === '127.0.0.1') {
                    return callback(null, true);
                }
            } catch (_) {
                /* ignore malformed origin */
            }
        }

        // Allow same-origin requests (when origin matches server origin)
        const serverOrigin = `http://localhost:${PORT}`;
        const serverOriginAlt = `http://127.0.0.1:${PORT}`;
        if (origin === serverOrigin || origin === serverOriginAlt) {
            return callback(null, true);
        }

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Only log CORS blocks for non-localhost origins to reduce noise
            // Localhost CORS issues are usually development configuration issues, not security threats
            if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
                secureLogger.logSecurityEvent('cors_blocked', 'medium', 'CORS blocked request', { origin });
            }
            // Don't throw error - just reject silently to prevent "Unhandled error" messages
            callback(null, false);
        }
    },
    credentials: true
}));

// Rate limiting - skip for static files and in development.
// Override with API_RATE_LIMIT_MAX (integer). Behind a load balancer, client IP must
// reach Express (trust proxy + X-Forwarded-For or PROXY protocol) or all visitors share one bucket.
const apiRateLimitMaxEnv = parseInt(process.env.API_RATE_LIMIT_MAX || '', 10);
const apiRateLimitDefaultMax = process.env.NODE_ENV === 'production' ? 300 : 1000;
const apiRateLimitMax =
    Number.isFinite(apiRateLimitMaxEnv) && apiRateLimitMaxEnv > 0
        ? apiRateLimitMaxEnv
        : apiRateLimitDefaultMax;

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: apiRateLimitMax,
    validate: { trustProxy: true },
    skip: (req) => {
        // Skip rate limiting for static files (CSS, JS, images, fonts, etc.)
        const staticExtensions = ['.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.json', '.xml', '.txt', '.pdf'];
        const isStaticFile = staticExtensions.some(ext => req.path.toLowerCase().endsWith(ext));

        // Skip for localhost in development
        const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';

        return isStaticFile || (process.env.NODE_ENV !== 'production' && isLocalhost);
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Stricter rate limiting for authentication endpoints.
// In production: 5 attempts / 15 min per IP (brute-force protection).
// In non-production (local dev): much higher default so debugging sign-in
// isn't blocked for 15 minutes after a few tries. Override with
// AUTH_RATE_LIMIT_MAX (integer) if needed.
const authLimiterMaxEnv = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '', 10);
const authLimiterDefaultMax = process.env.NODE_ENV === 'production' ? 5 : 80;
const authLimiterMax =
    Number.isFinite(authLimiterMaxEnv) && authLimiterMaxEnv > 0
        ? authLimiterMaxEnv
        : authLimiterDefaultMax;

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: authLimiterMax,
    validate: { trustProxy: true },
    message: {
        error: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads — always resolve to backend/uploads (relative "uploads" breaks if cwd is not backend/)
const uploadsDir = path.join(__dirname, 'uploads');
const rootPath = path.join(__dirname, '..');

// DB often points at /uploads/products/... files that only exist where they were uploaded (not in git).
app.get('/uploads/products/:filename', async (req, res) => {
    const filename = req.params.filename || '';
    if (!filename || filename.includes('..') || /[/\\]/.test(filename)) {
        return res.status(400).end();
    }
    const filePath = path.join(uploadsDir, 'products', filename);
    try {
        await fs.access(filePath);
        return res.sendFile(path.resolve(filePath));
    } catch {
        return res.status(404).end();
    }
});

// Catalog images under /images/products/ — serve only when the file exists (no substitute image).
app.get('/images/products/:filename', async (req, res) => {
    const filename = req.params.filename || '';
    if (!filename || filename.includes('..') || /[/\\]/.test(filename)) {
        return res.status(400).end();
    }
    const filePath = path.join(rootPath, 'images', 'products', filename);
    try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.size > 0) {
            return res.sendFile(path.resolve(filePath));
        }
    } catch {
        // missing or unreadable
    }
    return res.status(404).end();
});

app.use('/uploads', express.static(uploadsDir));

// Service worker: dedicated handler (correct MIME, no-cache, scope) — avoids flaky registration on :3001
app.get('/service-worker.js', (req, res, next) => {
    const swPath = path.join(rootPath, 'service-worker.js');
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.resolve(swPath), (err) => {
        if (err) next(err);
    });
});

// Staging / preview hosts: block indexing (unset before production launch).
if (process.env.STAGING_BLOCK_INDEXING === 'true') {
    app.use((req, res, next) => {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        next();
    });
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain');
        res.send('User-agent: *\nDisallow: /\n');
    });
}

// Permanent SEO redirects from repo-root redirects-301.csv (see file header).
app.use(createSeoRedirectMiddleware({ rootPath, logger }));

// Business One POS UI — hosted on the dedicated POS platform (pos.businessonecomprehensive.com), not on store servers.
// Local dev only: set SERVE_POS_UI=true to serve ../business-one-pos at /pos/ from this server.
const posAppPath = path.join(rootPath, '..', 'business-one-pos');
const servePosUi = String(process.env.SERVE_POS_UI || '').toLowerCase() === 'true';
const posRegisterUrl = String(process.env.POS_REGISTER_URL || 'https://pos.businessonecomprehensive.com').replace(/\/+$/, '');

if (servePosUi && fsSync.existsSync(posAppPath)) {
    app.use('/pos', express.static(posAppPath));
} else {
    app.use((req, res, next) => {
        const p = req.path;
        if (p === '/pos' || p.startsWith('/pos/')) {
            const suffix = p === '/pos' ? '/' : p.slice('/pos'.length);
            const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            return res.redirect(302, `${posRegisterUrl}${suffix}${qs}`);
        }
        next();
    });
}

const supportAgentPath = fsSync.existsSync(path.join(rootPath, 'business-one-support-agent'))
    ? path.join(rootPath, 'business-one-support-agent')
    : path.join(rootPath, '..', 'business-one-support-agent');
if (fsSync.existsSync(supportAgentPath)) {
    app.use('/support-agent', express.static(supportAgentPath));
}

// Business One Support Desk — dedicated local URL (not the HM Herbs storefront)
app.get('/support-desk', (req, res) => {
    res.sendFile(path.join(rootPath, 'platform-support.html'));
});
app.get('/support-desk/viewer', (req, res) => {
    res.sendFile(path.join(rootPath, 'support-viewer.html'));
});
app.get('/platform-support.html', (req, res) => {
    res.redirect(302, '/support-desk');
});

// Serve admin panel and frontend files
app.use(express.static(rootPath)); // Serve files from project root

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    if (!process.env.JWT_SECRET) {
        logger.error('CRITICAL: JWT_SECRET environment variable is not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const uid = decoded.userId ?? decoded.id ?? decoded.sub;
        if (uid == null || uid === '') {
            return res.status(403).json({ error: 'Invalid token' });
        }
        const [rows] = await pool.execute(
            'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ? AND is_active = 1',
            [uid]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = rows[0];
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    if (!process.env.JWT_SECRET) {
        logger.error('CRITICAL: JWT_SECRET environment variable is not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await pool.execute(
            'SELECT id, email, first_name, last_name, role, is_active FROM admin_users WHERE id = ? AND is_active = 1',
            [decoded.adminId]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid admin token' });
        }

        const { normalizeAdminRole } = require('./utils/adminRoles');
        req.admin = { ...rows[0], role: normalizeAdminRole(rows[0].role) };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid admin token' });
    }
};

/** Build storefront JWT session `user` JSON from a users table row (camelCase for web clients). */
function storefrontSessionUserFromDbRow(row) {
    if (!row) return null;
    let dob = row.date_of_birth;
    if (dob instanceof Date) {
        dob = dob.toISOString().slice(0, 10);
    } else if (dob != null && String(dob).trim() !== '') {
        dob = String(dob).slice(0, 10);
    } else {
        dob = null;
    }
    return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone != null ? row.phone : null,
        dateOfBirth: dob,
        customerNumber: row.customer_number != null ? row.customer_number : null,
    };
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Database + catalog readiness (use when /api/products returns empty)
app.get('/api/health/ready', async (req, res) => {
    try {
        await pool.query('SELECT 1 AS ok');
        const [countRows] = await pool.query(
            'SELECT COUNT(*) AS n FROM products WHERE is_active = 1'
        );
        const activeProducts = countRows[0] ? Number(countRows[0].n) : 0;
        res.json({
            status: 'OK',
            database: 'connected',
            activeProducts,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.warn('Health ready check failed:', error.message);
        res.status(503).json({
            status: 'error',
            database: 'unavailable',
            code: error.code || null,
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Promo banner (early registration; uses `pool` directly; always 200 — see utils/promoBanner.js)
app.get('/api/promo-banner', async (req, res) => {
    try {
        await handlePromoBannerGet(pool, res, logger);
    } catch (error) {
        logger.error('Promo banner route error:', error);
        if (!res.headersSent) {
            res.status(200).json(disabledPayload());
        }
    }
});

const { loadPublicStoreInfo, publicStoreInfoPayload, DEFAULT_FOOTER_HOURS } = require('./utils/storePublicInfo');
const { loadStoreTaxRate } = require('./utils/storeTaxRate');

app.get('/api/store-info', async (req, res) => {
    try {
        const [storeInfo, taxRate] = await Promise.all([
            loadPublicStoreInfo(pool),
            loadStoreTaxRate(pool)
        ]);
        res.json({ ...storeInfo, taxRate });
    } catch (error) {
        logger.error('Store info route error:', error);
        res.status(200).json({ ...publicStoreInfoPayload(DEFAULT_FOOTER_HOURS), taxRate: 0.08 });
    }
});

// User Authentication Routes
app.post('/api/auth/register', authLimiter, userRegistrationValidation, async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, dateOfBirth, mailingAddress } = req.body;
        const emailNorm = String(email || '').trim().toLowerCase();
        const dob = String(dateOfBirth || '').trim().slice(0, 10);

        // Validate input (DOB also enforced by userRegistrationValidation)
        if (!emailNorm || !password || !firstName || !lastName || !dob) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        // Active account blocks registration; deactivated (admin "deleted") accounts can re-register.
        const [existingUsers] = await pool.execute(
            'SELECT id, is_active FROM users WHERE LOWER(TRIM(email)) = ?',
            [emailNorm]
        );

        try {
            normalizeRegistrationMailingAddress(mailingAddress);
        } catch (addrErr) {
            if (addrErr.code === 'INCOMPLETE_MAILING_ADDRESS' || addrErr.code === 'INVALID_STATE' || addrErr.code === 'INVALID_POSTAL') {
                return res.status(400).json({ error: addrErr.message });
            }
            throw addrErr;
        }

        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        let userId;
        const isReactivation = existingUsers.length > 0 && !existingUsers[0].is_active;

        if (existingUsers.length > 0 && existingUsers[0].is_active) {
            return res.status(400).json({
                error: 'There is already an account with this email address. Please sign in instead.'
            });
        }

        if (isReactivation) {
            userId = existingUsers[0].id;
            await reactivateCustomerForLocalSignup(pool, userId, {
                passwordHash,
                firstName,
                lastName,
                phone: phone || null,
                dateOfBirth: dob,
                email: emailNorm
            });
        } else {
            const [result] = await pool.execute(
                `INSERT INTO users (email, password_hash, auth_provider, first_name, last_name, phone, date_of_birth)
                 VALUES (?, ?, 'local', ?, ?, ?, ?)`,
                [emailNorm, passwordHash, firstName, lastName, phone || null, dob]
            );
            userId = result.insertId;
            await provisionWebCustomerProfile(pool, userId, logger);
        }

        try {
            await saveRegistrationMailingAddress(pool, userId, {
                firstName,
                lastName,
                mailingAddress
            });
        } catch (addrErr) {
            if (addrErr.code === 'INCOMPLETE_MAILING_ADDRESS' || addrErr.code === 'INVALID_STATE' || addrErr.code === 'INVALID_POSTAL') {
                return res.status(400).json({ error: addrErr.message });
            }
            throw addrErr;
        }

        if (!process.env.JWT_SECRET) {
            logger.error('CRITICAL: JWT_SECRET environment variable is not set');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

        let sessionUser;
        try {
            const row = await loadCustomerRow(pool, userId);
            sessionUser = storefrontSessionUserFromDbRow(row);
        } catch (err) {
            if (err.errno !== 1054) throw err;
            const [urows] = await pool.execute(
                `SELECT id, email, first_name, last_name, phone, date_of_birth FROM users WHERE id = ?`,
                [userId]
            );
            sessionUser = storefrontSessionUserFromDbRow({ ...urows[0], customer_number: null });
        }

        res.status(isReactivation ? 200 : 201).json({
            message: isReactivation ? 'Account reactivated successfully' : 'User created successfully',
            token,
            user: sessionUser || {
                id: userId,
                email: emailNorm,
                firstName,
                lastName,
                phone: phone || null,
                dateOfBirth: dob,
                customerNumber: null
            }
        });
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                error: 'There is already an account with this email address. Please sign in instead.',
            });
        }
        logger.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', authLimiter, userLoginValidation, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const emailKey = String(email || '').trim().toLowerCase();

        // Find user (case-insensitive match for legacy mixed-case emails)
        let users;
        try {
            [users] = await pool.execute(
                `SELECT id, email, password_hash, first_name, last_name, phone, date_of_birth,
                        customer_number, is_active
                   FROM users WHERE LOWER(TRIM(email)) = ?`,
                [emailKey]
            );
        } catch (err) {
            if (err.errno !== 1054) throw err;
            [users] = await pool.execute(
                `SELECT id, email, password_hash, first_name, last_name, phone, date_of_birth, is_active
                   FROM users WHERE LOWER(TRIM(email)) = ?`,
                [emailKey]
            );
            users = users.map((u) => ({ ...u, customer_number: null }));
        }

        if (users.length === 0) {
            return res.json({ success: false, error: 'Invalid credentials' });
        }

        const user = users[0];

        if (!user.is_active) {
            return res.json({ success: false, error: 'Account is deactivated' });
        }

        if (!user.password_hash) {
            return res.json({
                success: false,
                error: 'This account uses Google sign-in. Click Continue with Google instead.'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.json({ success: false, error: 'Invalid credentials' });
        }

        await provisionWebCustomerProfile(pool, user.id, logger);

        // Update last login
        await pool.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        // Generate JWT token
        if (!process.env.JWT_SECRET) {
            logger.error('CRITICAL: JWT_SECRET environment variable is not set');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: storefrontSessionUserFromDbRow(user),
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const { getStorefrontPublicBaseUrl } = require('./utils/storefrontUrl');
const { sendMail } = require('./utils/mailTransporter');

// Customer password reset (self-service; same email privacy pattern as admin)
app.post('/api/auth/forgot-password', authLimiter, userForgotPasswordValidation, async (req, res) => {
    try {
        const emailNorm = String(req.body.email || '')
            .trim()
            .toLowerCase();
        const crypto = require('crypto');
        const [users] = await pool.execute(
            `SELECT id, email, first_name, last_name FROM users
             WHERE LOWER(TRIM(email)) = ? AND is_active = 1`,
            [emailNorm]
        );

        if (users.length > 0) {
            const u = users[0];
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpires = new Date(Date.now() + 3600000);
            await pool.execute(
                'UPDATE users SET password_reset_token = ?, password_reset_token_expires = ? WHERE id = ?',
                [resetToken, resetTokenExpires, u.id]
            );
            const resetBase = getStorefrontPublicBaseUrl();
            const resetUrl = `${resetBase}/reset-password.html?token=${encodeURIComponent(resetToken)}`;

            try {
                const first = String(u.first_name || '').trim() || 'there';
                const result = await sendMail({
                    to: u.email,
                    subject: 'H&M Herbs — reset your password',
                    html: `
                        <h2>Password reset</h2>
                        <p>Hello ${first},</p>
                        <p>We received a request to reset the password for your H&amp;M Herbs account.</p>
                        <p><a href="${resetUrl}" style="background:#10b981;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;">Choose a new password</a></p>
                        <p>Or copy this link into your browser:</p>
                        <p style="word-break:break-all;">${resetUrl}</p>
                        <p>This link expires in one hour. If you did not ask for this, you can ignore this email.</p>
                    `,
                    logTag: 'Customer password reset email'
                });
                if (!result.sent) {
                    logger.info('Customer password reset (SMTP not configured):', { email: u.email, resetUrl });
                    console.log('\n🔑 Customer password reset link (set SMTP_* in backend/.env to send email):\n');
                    console.log(`   ${resetUrl}\n`);
                }
            } catch (emailErr) {
                logger.error('Failed to send customer password reset email:', emailErr);
            }
        }

        res.json({
            message: 'If an account with that email exists, we sent a link to reset your password.'
        });
    } catch (error) {
        if (error && (error.code === 'ER_BAD_FIELD_ERROR' || error.errno === 1054)) {
            logger.error(
                'Customer forgot-password: missing password_reset columns on users. Restart server after DB migration.',
                error.message
            );
            return res.status(503).json({
                error: 'Password reset is temporarily unavailable. Please try again later or contact support.'
            });
        }
        logger.error('Customer forgot-password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/reset-password', authLimiter, userResetPasswordValidation, async (req, res) => {
    try {
        const token = String(req.body.token || '').trim();
        const newPassword = String(req.body.newPassword || '');
        const [rows] = await pool.execute(
            `SELECT id FROM users
             WHERE password_reset_token = ? AND password_reset_token_expires > NOW() AND is_active = 1`,
            [token]
        );
        if (rows.length === 0) {
            return res.status(400).json({
                error: 'Invalid or expired reset link. Please request a new password reset.'
            });
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.execute(
            'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_token_expires = NULL, updated_at = NOW() WHERE id = ?',
            [passwordHash, rows[0].id]
        );
        res.json({ message: 'Your password was updated. You can sign in with your new password.' });
    } catch (error) {
        if (error && (error.code === 'ER_BAD_FIELD_ERROR' || error.errno === 1054)) {
            logger.error('Customer reset-password: missing columns on users.', error.message);
            return res.status(503).json({
                error: 'Password reset is temporarily unavailable. Please try again later or contact support.'
            });
        }
        logger.error('Customer reset-password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User Profile Routes (require authentication)
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        await provisionWebCustomerProfile(pool, req.user.id, logger);

        const baseSelect = `SELECT id, email, first_name, last_name, phone, date_of_birth, email_verified,
                    created_at, last_login`;
        let users;
        try {
            [users] = await pool.execute(
                `${baseSelect}, customer_number FROM users WHERE id = ?`,
                [req.user.id]
            );
        } catch (err) {
            if (err.errno !== 1054) throw err;
            [users] = await pool.execute(`${baseSelect} FROM users WHERE id = ?`, [req.user.id]);
        }

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const u = users[0];
        res.json({
            user: {
                id: u.id,
                email: u.email,
                firstName: u.first_name,
                lastName: u.last_name,
                phone: u.phone,
                dateOfBirth: u.date_of_birth,
                emailVerified: u.email_verified,
                createdAt: u.created_at,
                lastLogin: u.last_login,
                customerNumber: u.customer_number != null ? u.customer_number : null,
            }
        });
    } catch (error) {
        logger.error('Get user profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Tax exemption status for checkout UI (requires authentication)
app.get('/api/user/tax-status', authenticateToken, async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await pool.execute(
                'SELECT tax_exempt, tax_exempt_id FROM users WHERE id = ? LIMIT 1',
                [req.user.id]
            );
        } catch (err) {
            // Older schema without tax fields
            if (err.errno !== 1054) throw err;
            return res.json({ taxExempt: false, verified: false, taxExemptIdPresent: false });
        }

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const taxExempt = Boolean(rows[0].tax_exempt);
        const idValue = rows[0].tax_exempt_id ? String(rows[0].tax_exempt_id).trim() : '';
        const verified = taxExempt && idValue.length >= 3;

        res.json({
            taxExempt,
            verified,
            taxExemptIdPresent: idValue.length > 0
        });
    } catch (error) {
        logger.error('Get tax status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { firstName, lastName, email, phone, dateOfBirth } = req.body;
        const userId = req.user.id;

        const phoneTrim = phone != null ? String(phone).trim() : '';
        if (!isUsPhoneDisplayOrEmpty(phoneTrim)) {
            return res.status(400).json({ error: 'Phone must be formatted as (555) 123-4567 or left blank' });
        }

        // Check if email is being changed
        if (email) {
            const [existingUsers] = await pool.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, userId]
            );
            if (existingUsers.length > 0) {
                return res.status(400).json({ error: 'Email already in use' });
            }
        }

        const dob = dateOfBirth != null && String(dateOfBirth).trim() !== '' ? String(dateOfBirth).trim().slice(0, 32) : null;

        // Update user (date_of_birth exists in base schema)
        await pool.execute(
            'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, date_of_birth = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [firstName, lastName, email, phoneTrim || null, dob, userId]
        );

        // Get updated user
        let users;
        try {
            [users] = await pool.execute(
                `SELECT id, email, first_name, last_name, phone, date_of_birth, customer_number FROM users WHERE id = ?`,
                [userId]
            );
        } catch (err) {
            if (err.errno !== 1054) throw err;
            [users] = await pool.execute(
                `SELECT id, email, first_name, last_name, phone, date_of_birth FROM users WHERE id = ?`,
                [userId]
            );
        }

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: users[0].id,
                email: users[0].email,
                firstName: users[0].first_name,
                lastName: users[0].last_name,
                phone: users[0].phone,
                dateOfBirth: users[0].date_of_birth,
                customerNumber: users[0].customer_number != null ? users[0].customer_number : null,
            }
        });
    } catch (error) {
        logger.error('Update user profile error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email already in use' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/user/orders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [orders] = await pool.execute(
            `SELECT /* hmherbs-user-orders-v7 */
                    o.id, o.order_number, o.total_amount AS total, o.status, o.created_at,
                    o.tracking_number, o.tracking_url, o.shipping_carrier, o.shipped_at, o.fulfillment_status,
                    o.tracking_status_detail,
                    COALESCE(o.sales_channel, 'online') AS sales_channel,
                    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
             FROM orders o
             WHERE o.user_id = ?
             ORDER BY o.created_at DESC
             LIMIT 50`,
            [userId]
        );

        const { enrichOrderTracking } = require('./utils/trackingUrl');
        res.json({ orders: jsonSafeDeep(orders.map(enrichOrderTracking)) });
    } catch (error) {
        logger.error('Get user orders error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/user/addresses', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [addresses] = await pool.execute(
            'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
            [userId]
        );

        res.json({ addresses });
    } catch (error) {
        logger.error('Get user addresses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Customer-facing loyalty profile (web user's points/tier/history)
app.get('/api/user/loyalty', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        let [[loyalty]] = await pool.execute(
            `SELECT points_balance, cash_balance, points_pending, lifetime_points_earned,
                    lifetime_points_redeemed, lifetime_cash_earned, lifetime_cash_redeemed,
                    loyalty_enrollment, tier, tier_progress, member_since,
                    last_earned_at, last_redeemed_at,
                    last_synced_at, sync_status
               FROM customer_loyalty WHERE user_id = ?`,
            [userId]
        );
        if (!loyalty) {
            await pool.execute(
                `INSERT INTO customer_loyalty (user_id, member_since, loyalty_enrollment)
                 VALUES (?, CURDATE(), 'cash')`,
                [userId]
            );
            [[loyalty]] = await pool.execute(
                `SELECT points_balance, cash_balance, points_pending, lifetime_points_earned,
                        lifetime_points_redeemed, lifetime_cash_earned, lifetime_cash_redeemed,
                        loyalty_enrollment, tier, tier_progress, member_since,
                        last_earned_at, last_redeemed_at,
                        last_synced_at, sync_status
                   FROM customer_loyalty WHERE user_id = ?`,
                [userId]
            );
        }
        const loyaltySettings = await loadLoyaltyProgramSettings(pool);
        const [transactions] = await pool.execute(
            `SELECT id, transaction_type, reward_type, points_change, points_balance_after,
                    cash_change, cash_balance_after, description, created_at
               FROM loyalty_transactions
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT 25`,
            [userId]
        );
        res.json({ loyalty, settings: loyaltySettings, transactions });
    } catch (error) {
        logger.error('Get user loyalty error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Customer-facing gift cards (cards assigned to this customer)
app.get('/api/user/gift-cards', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [cards] = await pool.execute(
            `SELECT id, code, card_type, status, initial_balance, current_balance,
                    currency, recipient_name, recipient_email, sender_name,
                    personal_message, issued_at, expires_at, last_used_at
               FROM gift_cards
              WHERE customer_id = ? OR recipient_email = (SELECT email FROM users WHERE id = ?)
              ORDER BY status = 'active' DESC, created_at DESC`,
            [userId, userId]
        );
        res.json({ gift_cards: cards });
    } catch (error) {
        logger.error('Get user gift cards error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Customer-facing gift card balance check (PIN required when card has a PIN)
const giftCardBalanceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { error: 'Too many gift card lookups. Please wait a moment and try again.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.post('/api/gift-cards/check-balance', giftCardBalanceLimiter, async (req, res) => {
    try {
        const { code, pin } = req.body || {};
        if (!code) return res.status(400).json({ error: 'code is required' });
        const cleanCode = String(code).trim().toUpperCase().replace(/\s+/g, '');
        const [[card]] = await pool.execute(
            `SELECT card_type, status, initial_balance, current_balance, currency,
                    expires_at, last_used_at, pin
               FROM gift_cards
              WHERE code = ?
              LIMIT 1`,
            [cleanCode]
        );
        if (!card) return res.status(404).json({ error: 'Gift card not found or invalid PIN' });
        if (card.pin) {
            const pinTrim = pin != null ? String(pin).trim() : '';
            if (!pinTrim || pinTrim !== String(card.pin).trim()) {
                return res.status(400).json({ error: 'Invalid gift card PIN', code: 'GIFT_CARD_INVALID_PIN' });
            }
        }
        if (card.status !== 'active') {
            return res.status(400).json({ error: 'This gift card is not active', code: 'GIFT_CARD_INACTIVE' });
        }
        if (card.expires_at && new Date(card.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This gift card has expired', code: 'GIFT_CARD_EXPIRED' });
        }
        const { pin: _pin, ...safeCard } = card;
        res.json({ gift_card: safeCard, balance: Number(card.current_balance) });
    } catch (error) {
        logger.error('Check gift card balance error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const { getGiftCardCatalog } = require('./routes/gift-cards');
app.get('/api/gift-cards/catalog', getGiftCardCatalog);
app.use('/api/gift-cards', require('./routes/gift-cards'));

// US address type-ahead (storefront forms)
const { searchAddressSuggestions } = require('./services/addressSuggest');
const addressSuggestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many address lookups. Please wait a moment and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.get('/api/address-suggest', addressSuggestLimiter, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        const state = String(req.query.state || '').trim();
        if (q.length < 3) {
            return res.json({ suggestions: [] });
        }
        const suggestions = await searchAddressSuggestions(q, { state });
        res.json({ suggestions });
    } catch (error) {
        logger.error('Address suggest error:', error);
        res.status(502).json({ error: 'Address lookup is temporarily unavailable' });
    }
});

// Product Routes
app.get('/api/products', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            category,
            brand,
            healthCategory,
            search,
            minPrice,
            maxPrice,
            sortBy = 'name',
            sortOrder = 'ASC',
            featured
        } = req.query;

        const offset = (page - 1) * limit;
        let whereConditions = ['p.is_active = 1', STOREFRONT_VISIBLE_WHERE];
        let queryParams = [];

        const catRaw = category != null && category !== '' ? (Array.isArray(category) ? category[0] : category) : '';
        const hcRaw =
            healthCategory != null && healthCategory !== ''
                ? Array.isArray(healthCategory)
                    ? healthCategory[0]
                    : healthCategory
                : '';
        const cat = String(catRaw || '').trim();
        const hc = String(hcRaw || '').trim();

        // Build WHERE conditions for category / health category
        // products.js sends BOTH category=X and healthCategory=X with the same slug so either taxonomy
        // can match. Using AND would require a product to satisfy pc.slug AND hc.slug simultaneously
        // (usually impossible), which hid the entire catalog.
        if (cat && hc && cat === hc) {
            whereConditions.push('(pc.slug = ? OR hc.slug = ?)');
            queryParams.push(cat, hc);
        } else {
            if (cat) {
                whereConditions.push('pc.slug = ?');
                queryParams.push(cat);
            }
            if (hc) {
                whereConditions.push('hc.slug = ?');
                queryParams.push(hc);
            }
        }

        if (brand) {
            const cleanBrand = brand.toLowerCase().replace(/[^a-z0-9]/g, '');

            whereConditions.push(`(
                LOWER(b.slug) = ? OR 
                LOWER(b.name) = ? OR 
                REPLACE(REPLACE(LOWER(b.slug), '-', ''), ' ', '') = ? OR
                REPLACE(REPLACE(LOWER(b.name), '-', ''), ' ', '') = ? OR
                LOWER(b.slug) LIKE ? OR 
                LOWER(b.name) LIKE ?
            )`);

            queryParams.push(
                brand.toLowerCase(),
                brand.toLowerCase(),
                cleanBrand,
                cleanBrand,
                `%${cleanBrand}%`,
                `%${cleanBrand}%`
            );
        }

        if (search) {
            const searchTerm = `%${search}%`;
            const cleanSearch = String(search).toLowerCase().replace(/[^a-z0-9]/g, '');
            whereConditions.push(`(
                p.name LIKE ? OR
                p.short_description LIKE ? OR
                p.long_description LIKE ? OR
                b.name LIKE ? OR
                b.slug LIKE ? OR
                REPLACE(REPLACE(LOWER(b.slug), '-', ''), ' ', '') LIKE ?
            )`);
            queryParams.push(
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                `%${cleanSearch}%`
            );
        }

        if (minPrice) {
            whereConditions.push('p.price >= ?');
            queryParams.push(parseFloat(minPrice));
        }

        if (maxPrice) {
            whereConditions.push('p.price <= ?');
            queryParams.push(parseFloat(maxPrice));
        }

        if (featured === 'true') {
            whereConditions.push('p.is_featured = 1');
            // Also ensure active products only for featured
            if (!whereConditions.includes('p.is_active = 1')) {
                whereConditions.push('p.is_active = 1');
            }
        }

        // Exclude scheduled events/non-product items from product listing
        const excludedSkus = ['51302']; // Association of Natural Health EDSA Biofeedback Testing
        const excludedSlugs = ['association-of-natural-health-edsa-biofeedback-testing'];
        const excludedNamePatterns = ['association of natural health edsa'];

        if (excludedSkus.length) {
            const placeholders = excludedSkus.map(() => '?').join(', ');
            whereConditions.push(`COALESCE(TRIM(p.sku), '') NOT IN (${placeholders})`);
            queryParams.push(...excludedSkus);
        }

        if (excludedSlugs.length) {
            const placeholders = excludedSlugs.map(() => '?').join(', ');
            whereConditions.push(`COALESCE(TRIM(p.slug), '') NOT IN (${placeholders})`);
            queryParams.push(...excludedSlugs);
        }

        excludedNamePatterns.forEach(pattern => {
            whereConditions.push('LOWER(p.name) NOT LIKE ?');
            queryParams.push(`%${pattern}%`);
        });

        // Gift card products appear on gift-cards.html / category=gift-cards only
        if (!cat && !hc) {
            whereConditions.push('(p.gift_card_type IS NULL)');
        }

        const inventorySettings = await loadInventorySettings(pool);
        if (inventorySettings.hideOutOfStock) {
            whereConditions.push(
                '(p.track_inventory = 0 OR p.track_inventory IS NULL OR p.inventory_quantity > 0)'
            );
        }

        // Build ORDER BY clause
        const allowedSortFields = ['name', 'price', 'created_at'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'name';
        const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Ensure limit and offset are integers
        const limitInt = parseInt(limit) || 20;
        const offsetInt = parseInt(offset) || 0;

        // Build query with embedded LIMIT/OFFSET (MySQL2 has issues with LIMIT/OFFSET placeholders)
        const query = `
            SELECT DISTINCT
                p.id,
                p.sku,
                p.name,
                p.slug,
                p.short_description,
                p.price,
                p.compare_price,
                p.inventory_quantity,
                p.track_inventory,
                p.allow_backorder,
                p.low_stock_threshold,
                p.is_featured,
                p.is_cannabis,
                p.coa_url,
                p.coa_updated_at,
                b.name as brand_name,
                b.slug as brand_slug,
                pc.name as category_name,
                pc.slug as category_slug,
                pi.image_url,
                pi.alt_text
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_categories pc ON p.category_id = pc.id
            LEFT JOIN product_health_categories phc ON p.id = phc.product_id
            LEFT JOIN health_categories hc ON phc.health_category_id = hc.id
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
            ${whereClause}
            ORDER BY p.${sortField} ${order}
            LIMIT ${limitInt} OFFSET ${offsetInt}
        `;

        // Use query() instead of execute() since we're embedding LIMIT/OFFSET directly
        const [products] = await pool.query(query, queryParams);

        products.forEach((p) => {
            applyCatalogPriceFix(p);
            const catalog = catalogPrimaryImageForProduct(p);
            if (catalog) {
                p.image_url = catalog;
            } else if (p.image_url) {
                p.image_url = sanitizeLegacyProductImageUrl(p.image_url, p.slug, p.sku) || null;
            }
            enrichProductRow(p, inventorySettings);
        });

        await enrichProductListPricesFromVariants(pool, products);

        // Log featured products query for debugging
        if (featured === 'true') {
            logger.info('Featured products query result:', {
                count: products.length,
                products: products.map(p => ({ id: p.id, name: p.name, is_featured: p.is_featured }))
            });
        }

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(DISTINCT p.id) as total
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_categories pc ON p.category_id = pc.id
            LEFT JOIN product_health_categories phc ON p.id = phc.product_id
            LEFT JOIN health_categories hc ON phc.health_category_id = hc.id
            ${whereClause}
        `;

        const [countRows] = await pool.query(countQuery, queryParams);
        const totalProducts = countRows[0] ? Number(countRows[0].total) : 0;
        const totalPages = Math.ceil(totalProducts / limit);

        res.json({
            products,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalProducts,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        // Rate limit database connection error logging to prevent console spam
        if (shouldLogDatabaseError(error.code)) {
            if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ECONNREFUSED') {
                logger.error(
                    `Products fetch error (database unavailable): ${logger.formatMysqlError(error)}`
                );
                logger.warn('Note: This error will only be logged once per minute to reduce console spam.');
            } else {
                logger.error('Products fetch error:', error);
            }
        }

        // Database unreachable — 503 so clients do not treat an empty list as a valid catalog
        const dbUnavailable =
            error.code === 'ER_ACCESS_DENIED_ERROR' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'PROTOCOL_CONNECTION_LOST';
        if (dbUnavailable) {
            return res.status(503).json({
                error: 'Database unavailable',
                code: error.code,
                products: [],
                pagination: {
                    currentPage: parseInt(req.query.page || 1),
                    totalPages: 0,
                    totalProducts: 0,
                    hasNextPage: false,
                    hasPrevPage: false
                }
            });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get single product
app.get('/api/products/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const raw = String(slug || '').trim();
        const isNumericId = /^\d+$/.test(raw);
        const idParam = isNumericId ? Number(raw) : -1;

        const [products] = await pool.execute(`
            SELECT 
                p.*,
                b.name as brand_name,
                b.slug as brand_slug,
                b.description as brand_description,
                pc.name as category_name,
                pc.slug as category_slug
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN product_categories pc ON p.category_id = pc.id
            WHERE p.is_active = 1 AND ${STOREFRONT_VISIBLE_WHERE} AND (p.slug = ? OR p.id = ?)
        `, [raw, idParam]);

        if (products.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = products[0];
        applyCatalogPriceFix(product);

        // Get product images
        const [images] = await pool.execute(
            'SELECT image_url, alt_text, is_primary, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order',
            [product.id]
        );

        // Get product variants
        const [variants] = await pool.execute(
            'SELECT id, sku, name, price, compare_price, inventory_quantity, is_active, attributes, image_url FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order',
            [product.id]
        );

        let variantOptionGroups = product.variant_option_groups;
        if (typeof variantOptionGroups === 'string') {
            try {
                variantOptionGroups = JSON.parse(variantOptionGroups);
            } catch {
                variantOptionGroups = null;
            }
        }
        product.variant_option_groups = Array.isArray(variantOptionGroups) ? variantOptionGroups : [];

        // Get health categories
        const [healthCategories] = await pool.execute(`
            SELECT hc.id, hc.name, hc.slug, hc.description
            FROM health_categories hc
            JOIN product_health_categories phc ON hc.id = phc.health_category_id
            WHERE phc.product_id = ? AND hc.is_active = 1
            ORDER BY hc.sort_order
        `, [product.id]);

        const catalogPrimary = catalogPrimaryImageForProduct(product);
        const dbImages = (images || [])
            .map((row) => ({
                ...row,
                image_url: sanitizeLegacyProductImageUrl(row.image_url, product.slug, product.sku),
            }))
            .filter((row) => row.image_url);

        if (dbImages.length > 0) {
            product.images = dbImages;
        } else if (catalogPrimary) {
            product.images = [{
                image_url: catalogPrimary,
                alt_text: product.name,
                is_primary: 1,
                sort_order: 0
            }];
        } else {
            product.images = [];
        }
        product.variants = variants.map((row) => {
            let attributes = row.attributes;
            if (typeof attributes === 'string') {
                try {
                    attributes = JSON.parse(attributes);
                } catch {
                    attributes = null;
                }
            }
            const imageUrl = row.image_url
                ? sanitizeLegacyProductImageUrl(row.image_url, product.slug, row.sku || product.sku)
                : null;
            return {
                ...row,
                attributes: attributes && typeof attributes === 'object' ? attributes : null,
                image_url: imageUrl,
            };
        });
        applyVariantPriceFallbackFromVariants(product, product.variants);
        product.health_categories = healthCategories;

        const inventorySettings = await loadInventorySettings(pool);
        enrichProductRow(product, inventorySettings);
        product.variants = product.variants.map((variant) => {
            const row = { ...variant };
            row.in_stock = !isTracked(product) || (parseInt(row.inventory_quantity, 10) || 0) > 0;
            row.can_purchase = canFulfillQuantity(
                product,
                inventorySettings,
                row.inventory_quantity,
                1
            );
            row.is_low_stock =
                isTracked(product) &&
                row.in_stock &&
                (parseInt(row.inventory_quantity, 10) || 0) <= product.low_stock_threshold;
            return row;
        });

        // Map database field names to frontend-expected names
        product.description = product.long_description || product.description || '';
        // Ensure short_description is available (it's already in the SELECT p.*)

        res.json(toStorefrontProduct(product));
    } catch (error) {
        logger.error('Product fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Public inventory policy (low-stock threshold, oversell, hide OOS)
app.get('/api/inventory-settings', async (req, res) => {
    try {
        const settings = await loadInventorySettings(pool);
        res.json(toPublicSettings(settings));
    } catch (error) {
        logger.error('Inventory settings fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get health categories
app.get('/api/health-categories', async (req, res) => {
    try {
        const [categories] = await pool.execute(
            'SELECT id, name, slug, description, image_url FROM health_categories WHERE is_active = 1 ORDER BY name ASC'
        );

        res.json(categories);
    } catch (error) {
        logger.error('Health categories fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get brands
app.get('/api/brands', async (req, res) => {
    try {
        const { enrichBrandsWithLogos, resolveBrandLogoUrl } = require('./utils/brandLogoResolve');
        const [brands] = await pool.execute(
            `SELECT DISTINCT b.id, b.name, b.slug, b.description, b.logo_url
             FROM brands b
             INNER JOIN products p ON p.brand_id = b.id AND p.show_on_web = 1
             WHERE b.is_active = 1
             ORDER BY b.name`
        );

        const enriched = enrichBrandsWithLogos(brands);
        const visible = enriched.filter((brand) => {
            if (resolveBrandLogoUrl(brand)) return true;
            const slug = String(brand.slug || '').toLowerCase();
            const name = String(brand.name || '').toLowerCase();
            return slug === 'unknown' || name === 'unknown' || name === 'miscellaneous';
        });

        res.json(visible);
    } catch (error) {
        logger.error('Brands fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get product categories
app.get('/api/categories', async (req, res) => {
    try {
        const [categories] = await pool.execute(
            'SELECT id, name, slug, description, image_url, parent_id FROM product_categories WHERE is_active = 1 ORDER BY name ASC'
        );

        res.json(categories);
    } catch (error) {
        logger.error('Categories fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Import route modules
const cartRoutes = require('./routes/cart');
const edsaRoutes = require('./routes/edsa');
const adminRoutes = require('./routes/admin');
const paymentCardsRoutes = require('./routes/payment-cards');
const publicRoutes = require('./routes/public');
const marketingSettingsSvc = require('./services/marketingSettings');
const {
    listFrontDisplays,
    getFrontDisplay,
    setDisplayAdAssignments
} = require('./services/posFrontDisplays');

/** req.pool is attached at app init (right after createPool). */

const { requirePermission: requireAdminPermissionLevel } = require('./middleware/adminAuth');

// Marketing hub (Mailchimp signup URL / headline) — registered on the main app so `/api/admin/marketing-settings`
// is never missed by the catch-all 404 (some deployments had only this path fail from the admin router).
app.get('/api/admin/marketing-settings', authenticateAdmin, requireAdminPermissionLevel('manager'), (req, res) => {
    try {
        const stored = marketingSettingsSvc.readConfig();
        const effective = marketingSettingsSvc.mergedPublicConfig();
        res.json({ stored, effective });
    } catch (error) {
        logger.error('Get marketing-settings error:', error);
        res.status(500).json({ error: 'Failed to load marketing settings' });
    }
});

app.put('/api/admin/marketing-settings', authenticateAdmin, requireAdminPermissionLevel('manager'), (req, res) => {
    try {
        const { signupLandingUrl, headline } = req.body || {};
        const saved = marketingSettingsSvc.saveConfig({ signupLandingUrl, headline });
        res.json({
            saved,
            effective: marketingSettingsSvc.mergedPublicConfig()
        });
    } catch (error) {
        logger.error('Put marketing-settings error:', error);
        res.status(500).json({ error: 'Failed to save marketing settings' });
    }
});

// Front-facing display ad playlists — registered on the main app (same reliability fix as marketing-settings).
app.get('/api/admin/pos/front-displays', authenticateAdmin, requireAdminPermissionLevel('manager'), async (req, res) => {
    try {
        const displays = await listFrontDisplays(pool);
        res.json({ displays });
    } catch (error) {
        logger.error('List front displays error:', error);
        res.status(500).json({ error: 'Failed to load front-facing displays' });
    }
});

app.get('/api/admin/pos/front-displays/:equipmentId', authenticateAdmin, requireAdminPermissionLevel('manager'), async (req, res) => {
    try {
        const display = await getFrontDisplay(pool, req.params.equipmentId);
        if (!display) return res.status(404).json({ error: 'Display not found' });
        res.json({ display });
    } catch (error) {
        logger.error('Get front display error:', error);
        res.status(500).json({ error: 'Failed to load display' });
    }
});

app.put('/api/admin/pos/front-displays/:equipmentId/ads', authenticateAdmin, requireAdminPermissionLevel('manager'), async (req, res) => {
    try {
        const adIds = Array.isArray(req.body?.adIds) ? req.body.adIds : req.body?.ad_ids || [];
        const display = await setDisplayAdAssignments(pool, req.params.equipmentId, adIds);
        res.json({ display });
    } catch (error) {
        const status =
            error.code === 'NOT_FOUND' || error.code === 'AD_NOT_FOUND'
                ? 404
                : error.code === 'INVALID_EQUIPMENT'
                  ? 400
                  : 500;
        res.status(status).json({ error: error.message, code: error.code });
    }
});

// Analytics endpoint (public, for client-side analytics)
app.post('/api/analytics', express.json(), (req, res) => {
    // Accept analytics data but don't require database connection
    // This prevents 404 errors when frontend sends analytics
    try {
        // In production, you would store this in a database
        // For now, just acknowledge receipt to prevent errors
        res.status(200).json({ success: true, message: 'Analytics data received' });
    } catch (error) {
        // Silently fail - analytics shouldn't break the app
        res.status(200).json({ success: true });
    }
});

// Mount routes
app.use('/api/auth', createCustomerGoogleRoutes(pool, logger, authenticateToken));
app.use('/api/admin/auth', createAdminGoogleRoutes(pool, logger));
app.use('/api/cart', cartRoutes);
app.use('/api/promotions', require('./routes/promotions'));
app.use('/api/payments', require('./routes/nmi-payments'));
app.use('/api/payments', require('./routes/mxmerchant-payments'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/shipping', require('./routes/shipping'));
app.use('/api/payment-gateway', require('./routes/payment-gateway'));
app.use('/api/edsa', edsaRoutes);
app.use('/api/menu', require('./routes/menu'));
app.use('/api/business-one', require('./routes/business-one-contact'));
app.use('/api/business-one/pos', require('./routes/business-one-pos'));
app.use('/api/admin/customers', require('./routes/admin-customers'));
app.use('/api/admin/customer-groups', require('./routes/admin-customer-groups'));
app.use('/api/admin/gift-cards', require('./routes/admin-gift-cards'));
app.use('/api/admin/dev-tools', require('./routes/admin-dev-tools'));
app.use('/api/admin/personnel', require('./routes/admin-personnel'));
app.use('/api/admin/pos', require('./routes/admin-pos'));
app.use('/api/bo', require('./routes/bo-platform'));
app.use('/api/admin/bo', require('./routes/bo-platform'));
const { mountVendorReceivingRoutes, ensureVendorReceivingReady } = require('./register-vendor-receiving');
const { authenticatePosEmployee } = require('./middleware/posEmployeeAuth');
mountVendorReceivingRoutes(app, {
    pool,
    posEmployeeAuth: authenticatePosEmployee,
    requireAdmin: authenticateAdmin
});
app.use('/api/admin', adminRoutes);
app.use('/api/payment-cards', paymentCardsRoutes);
app.use('/api/pos-billing', require('./routes/pos-billing'));
app.use('/api/platform/billing', require('./routes/platform-billing'));
app.use('/api/platform/support/hub', require('./routes/platform-support-hub'));
app.use('/api/platform/support/store', require('./routes/platform-support-store'));
app.use('/api/platform/ops', require('./routes/platform-ops'));
app.use('/api/pos-support/v1', require('./routes/pos-support-v1'));
app.use('/api/pos/v1', require('./routes/pos-v1'));
// Customer-facing account API (addresses CRUD, password change, order detail,
// wishlist collections + items). Mounted AFTER the inline /api/user/* handlers
// (profile, orders list, addresses GET, loyalty, gift-cards) defined above so
// those keep working — express tries router routes only if no inline match.
app.use('/api/user', require('./routes/user')({ pool, authenticateToken, logger }));

app.use('/api', publicRoutes);

// Error handling middleware (fourth arg required so Express recognizes this as an error handler)
// eslint-disable-next-line no-unused-vars -- Express requires arity-4; we never forward to `next`
app.use((error, req, res, next) => {
    // Don't log CORS errors - they're handled by the CORS middleware
    // CORS errors are expected when origins don't match and are not security issues
    if (error.message && error.message.includes('CORS')) {
        // CORS errors are handled by returning false in the callback
        // This shouldn't reach here, but if it does, handle silently
        return res.status(403).json({ error: 'CORS policy: Origin not allowed' });
    }

    // Log other errors
    logger.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler - only for API routes, allow static files to be served
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
});

// Start server (apply DB patches first so API queries match current schema)
(async () => {
    try {
        await ensureProductSchema(pool);
    } catch (e) {
        logger.error(`ensureProductSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureInventorySettings(pool);
    } catch (e) {
        logger.error(`ensureInventorySettings failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureProductVariantSchema(pool);
    } catch (e) {
        logger.error(`ensureProductVariantSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureShippingSchema(pool);
        await ensurePosSchema(pool);
        await hydrateIntegrationCredentials(pool);
        await ensurePlatformBillingSchema(pool);
        await ensurePosSignupSchema(pool);
        await ensureMenuSchema(pool);
        const { refreshStoreBaseUrlFromDb } = require('./utils/platformSupportEnv');
        await refreshStoreBaseUrlFromDb(pool);
        await ensurePlatformSupportSchema(pool);
        await ensurePersonnelSchema(pool);
    } catch (e) {
        logger.error(`ensureShippingSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureGiftCardPurchaseSchema(pool);
        await ensureGiftCardCatalog(pool);
        await ensureProductStorefrontSchema(pool);
    } catch (e) {
        logger.error(`ensureGiftCardPurchaseSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureCbdCategory(pool);
    } catch (e) {
        logger.error(`ensureCbdCategory failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureCustomerGroupSchema(pool);
    } catch (e) {
        logger.error(`ensureCustomerGroupSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureUserPasswordResetSchema(pool);
    } catch (e) {
        logger.error(`ensureUserPasswordResetSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureSocialOAuthSchema(pool);
    } catch (e) {
        logger.error(`ensureSocialOAuthSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureEdsaBookingSchema(pool);
    } catch (e) {
        logger.error(`ensureEdsaBookingSchema failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureEdsaBlockedDatesTable(pool);
    } catch (e) {
        logger.error(`ensureEdsaBlockedDatesTable failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await fs.mkdir(uploadsDir, { recursive: true });
    } catch (e) {
        logger.warn(`Could not create uploads directory: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureProductCatalogImages(rootPath, logger);
    } catch (e) {
        logger.error(`ensureProductCatalogImages failed: ${logger.formatMysqlError(e)}`);
    }

    try {
        await ensureVendorReceivingReady(pool);
    } catch (e) {
        logger.error(`ensureVendorReceivingReady failed: ${logger.formatMysqlError(e)}`);
    }

    const stopTaxReserveScheduler = startTaxReserveScheduler(pool);
    const stopTaxAccountantScheduler = startTaxAccountantScheduler(pool);
    const stopPosDailySalesScheduler = startPosDailySalesScheduler(pool);
    const stopPosPayrollScheduler = startPosPayrollScheduler(pool);
    const stopPosBillingScheduler = startPosBillingScheduler(pool);
    const stopPlatformBillingScheduler = startPlatformBillingScheduler(pool);

    const server = app.listen(PORT, () => {
        const { isSmtpConfigured } = require('./utils/smtpConfig');
        console.log(`H&M Herbs API Server running on port ${PORT}`);
        if (servePosUi && fsSync.existsSync(posAppPath)) {
            console.log(`Business One POS (local dev): http://127.0.0.1:${PORT}/pos/`);
        } else {
            console.log(`Business One POS platform: ${posRegisterUrl}/`);
        }
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:8000'}`);
        if (isSmtpConfigured()) {
            console.log('EDSA/customer email: SMTP configured (branded appointment emails enabled)');
        } else {
            console.warn(
                'EDSA/customer email: SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in backend/.env. ' +
                    'Until then, new bookings rely on Google Calendar guest invites when calendar is connected.'
            );
        }
        console.log(
            'Checkout API: orders INSERT v2 (order_number + shipping_address_line_1); NMI skip-preflight=' +
                (process.env.NMI_SKIP_TOKENIZATION_PREFLIGHT || '0')
        );
        logger.info(
            'Account SQL v3: GET /api/user/orders uses total_amount + item subquery; ' +
            'wishlist items JOIN product_images (not products.image_url). If errors still cite o.total or p.image_url, restart the server from backend/ after save.'
        );
        if (process.env.NODE_ENV !== 'production') {
            logger.info(
                'Checkout CSP: restart this Node process after changing helmet in server.js (e.g. Apple Pay script + NMI styles). Stale processes serve old Content-Security-Policy headers.'
            );
        }
        if (typeof stopTaxReserveScheduler === 'function' && process.env.TAX_LEDGER_SYNC_ENABLED === 'true') {
            process.on('SIGTERM', () => stopTaxReserveScheduler());
            process.on('SIGINT', () => stopTaxReserveScheduler());
        }
        if (typeof stopTaxAccountantScheduler === 'function') {
            process.on('SIGTERM', () => stopTaxAccountantScheduler());
            process.on('SIGINT', () => stopTaxAccountantScheduler());
        }
        if (typeof stopPosDailySalesScheduler === 'function') {
            process.on('SIGTERM', () => stopPosDailySalesScheduler());
            process.on('SIGINT', () => stopPosDailySalesScheduler());
        }
        if (typeof stopPosPayrollScheduler === 'function') {
            process.on('SIGTERM', () => stopPosPayrollScheduler());
            process.on('SIGINT', () => stopPosPayrollScheduler());
        }
        if (typeof stopPosBillingScheduler === 'function') {
            process.on('SIGTERM', () => stopPosBillingScheduler());
            process.on('SIGINT', () => stopPosBillingScheduler());
        }
        if (typeof stopPlatformBillingScheduler === 'function') {
            process.on('SIGTERM', () => stopPlatformBillingScheduler());
            process.on('SIGINT', () => stopPlatformBillingScheduler());
        }
    }).on('error', (error) => {
        logger.error('Server startup error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use. Please stop the other process or change the port.`);
        } else {
            console.error(`❌ Failed to start server: ${error.message}`);
        }
        process.exit(1);
    });

    // Set server timeouts for long-running operations like scraping
    server.timeout = 0; // Disable timeout
    server.keepAliveTimeout = 600000; // 10 minutes
    server.headersTimeout = 601000; // 10 minutes + 1s
})();
