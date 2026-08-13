const mysql = require('mysql2/promise');
require('dotenv').config();

async function listAllBrands() {
    const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    const [rows] = await pool.execute('SELECT id, name, slug, logo_url FROM brands ORDER BY name');
    console.log(JSON.stringify(rows, null, 2));
    await pool.end();
}
listAllBrands();

