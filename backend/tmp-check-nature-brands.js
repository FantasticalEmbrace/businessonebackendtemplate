const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env' });

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
    });

    const [rows] = await pool.execute(
        "SELECT id,name,slug FROM brands WHERE name LIKE 'Nature%' OR name LIKE 'Natural%' OR slug LIKE '%nature%' OR slug LIKE '%natural%'"
    );
    console.log(rows);

    await pool.end();
})();

