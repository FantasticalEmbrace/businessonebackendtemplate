// Setup default newsletter campaign with 15% discount offer
const { loadBackendEnv, createPool, createConnection } = require('../utils/dbConfig');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

(async () => {
    loadBackendEnv();
    let connection;
    try {
        // Connect to database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'hmherbs'
        });

        console.log('✅ Connected to database');

        // Check if default newsletter campaign already exists
        const [existing] = await connection.execute(
            `SELECT id FROM email_campaigns 
             WHERE campaign_name = 'Newsletter Signup - 15% Off' 
             AND is_active = 1`
        );

        if (existing.length > 0) {
            console.log(`✅ Default newsletter campaign already exists (ID: ${existing[0].id})`);
            console.log('   To update it, delete the existing campaign first or update it via admin panel.');
            await connection.end();
            return;
        }

        // Generate a unique offer code
        const offerCode = 'NEWSLETTER15';
        const offerValue = 15; // 15% discount
        const offerExpiryDays = 30; // Valid for 30 days

        // Create the default newsletter campaign
        const [result] = await connection.execute(`
            INSERT INTO email_campaigns (
                campaign_name,
                campaign_description,
                prompt_title,
                prompt_message,
                button_text,
                offer_type,
                offer_value,
                offer_description,
                offer_code,
                offer_expiry_days,
                display_type,
                display_delay,
                display_frequency,
                target_pages,
                target_new_visitors,
                target_returning_visitors,
                min_time_on_site,
                is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'Newsletter Signup - 15% Off',
            'Default newsletter signup campaign offering 15% discount to new subscribers',
            'Subscribe & Save 15%',
            'Join our newsletter and get 15% off your next order!',
            'Subscribe Now',
            'discount_percentage',
            offerValue,
            '15% off your next order',
            offerCode,
            offerExpiryDays,
            'inline', // Display type
            0, // Display delay
            'always', // Display frequency
            null, // Target all pages
            true, // Target new visitors
            true, // Target returning visitors
            0, // Min time on site
            true // Is active
        ]);

        console.log(`✅ Created default newsletter campaign with ID: ${result.insertId}`);
        console.log(`   Offer Code: ${offerCode}`);
        console.log(`   Discount: ${offerValue}%`);
        console.log(`   Valid for: ${offerExpiryDays} days`);
        console.log('\n📝 Campaign ID to use in frontend:', result.insertId);

        await connection.end();
    } catch (error) {
        console.error('❌ Error setting up newsletter campaign:', error);
        if (connection) {
            await connection.end();
        }
        process.exit(1);
    }
})();

