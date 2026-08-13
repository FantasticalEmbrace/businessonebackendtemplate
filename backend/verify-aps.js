const mysql = require('mysql2/promise');
require('dotenv').config();

async function verify() {
    const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    const [rows] = await pool.execute('SELECT p.name, b.name as brand_name FROM products p JOIN brands b ON p.brand_id = b.id WHERE b.name = "APS"');
    console.log('Products currently under APS brand:', JSON.stringify(rows, null, 2));
    await pool.end();
}
verify();

