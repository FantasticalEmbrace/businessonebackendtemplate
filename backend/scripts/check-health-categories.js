require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    const [rows] = await pool.query(
        `SELECT id, name, slug, is_active
         FROM health_categories
         WHERE slug IN ('male','female','men-products','women-products','mens-health','womens-health')
            OR name IN ('Male','Female','Men Products','Women Products')
         ORDER BY id`
    );
    console.log(JSON.stringify(rows, null, 2));
    await pool.end();
})();
