const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'deploy-staging.sql');
const out = path.join(__dirname, 'deploy-staging-remainder.sql');
const startLine = Number(process.argv[2] || 2134);

let sql = fs.readFileSync(src, 'utf8').replace(/\uFEFF/g, '');
sql = sql.split(/\r?\n/).slice(startLine - 1).join('\n');

sql = sql
    .replace(/ADD COLUMN IF NOT EXISTS/g, 'ADD COLUMN')
    .replace(/ADD INDEX IF NOT EXISTS/g, 'ADD INDEX')
    .replace(/ADD FOREIGN KEY IF NOT EXISTS/g, 'ADD FOREIGN KEY')
    .replace(/CREATE UNIQUE INDEX IF NOT EXISTS/g, 'CREATE UNIQUE INDEX');

sql = sql
    .split('\n')
    .map((line) => {
        if (/CALL hmherbs_\w+_if_missing/.test(line)) {
            return line.replace(/"([^"]*)"/g, (_, inner) => `'${inner.replace(/'/g, "''")}'`);
        }
        return line;
    })
    .join('\n');

fs.writeFileSync(out, sql, 'utf8');
console.log('Wrote', out, sql.length, 'bytes');
