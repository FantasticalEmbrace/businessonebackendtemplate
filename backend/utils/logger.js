const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const FILE_TRANSPORT_OPTIONS = [
    {
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5,
    },
    {
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5242880,
        maxFiles: 5,
    },
];

// Create logger instance with appropriate configuration
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'hmherbs-backend' },
    transports: FILE_TRANSPORT_OPTIONS.map((options) => new winston.transports.File(options)),
});

// If we're not in production, log to the console with a simple format
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

function addFileTransports() {
    for (const options of FILE_TRANSPORT_OPTIONS) {
        logger.add(new winston.transports.File(options));
    }
}

/** Close winston file handles, truncate logs, then reopen (Windows-safe). */
async function clearRotatingLogFiles() {
    const fileTransports = logger.transports.filter(
        (t) => t instanceof winston.transports.File
    );

    await Promise.all(
        fileTransports.map(
            (transport) =>
                new Promise((resolve) => {
                    transport.close(() => resolve());
                })
        )
    );
    fileTransports.forEach((transport) => logger.remove(transport));

    let cleared = 0;
    for (const options of FILE_TRANSPORT_OPTIONS) {
        try {
            await fs.promises.writeFile(options.filename, '', 'utf8');
            cleared += 1;
        } catch (_) {
            // Missing or locked file — continue with the rest.
        }
    }

    addFileTransports();
    return { cleared, total: FILE_TRANSPORT_OPTIONS.length };
}

/** Readable MySQL / Node network error for plain console (avoid winston "second arg" pitfalls). */
function formatMysqlError(err) {
    if (!err) return 'unknown error';
    const parts = [err.code, err.errno, err.sqlState, err.message || err.sqlMessage].filter(
        (p) => p !== undefined && p !== null && p !== ''
    );
    return parts.length ? parts.join(' — ') : String(err);
}

logger.formatMysqlError = formatMysqlError;
logger.clearRotatingLogFiles = clearRotatingLogFiles;

module.exports = logger;
