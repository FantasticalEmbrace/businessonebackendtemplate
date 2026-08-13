const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hmherbs'
};

async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

async function updateMissingImages() {
    let connection;
    try {
        // Connect to database
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected to database');

        // Get all products with missing images (NULL or empty string)
        const [products] = await connection.execute(
            `SELECT p.id, p.sku, p.name, pi.image_url 
             FROM products p
             LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
             WHERE p.is_active = 1 
             AND (pi.image_url IS NULL OR pi.image_url = '' OR pi.image_url = 'null')
             ORDER BY p.name`
        );

        console.log(`\nFound ${products.length} products with missing images\n`);

        if (products.length === 0) {
            console.log('No products need image updates!');
            return;
        }

        // Read CSV file
        const csvPath = 'c:\\Users\\donal\\Downloads\\products-2025-12-23.csv';
        console.log(`Reading CSV file: ${csvPath}...`);
        const csvData = await readCSV(csvPath);
        console.log(`CSV contains ${csvData.length} products\n`);

        // Create a map of SKU to image URLs
        const imageMap = new Map();
        csvData.forEach(row => {
            const sku = row.Code;
            const imagesField = row.Images || '';
            
            if (sku && imagesField) {
                // Parse the Images field which contains multiple images separated by |
                const imageUrls = imagesField
                    .split('|')
                    .filter(img => img.includes('Product Image URL:'))
                    .map(img => img.split('Product Image URL:')[1].trim())
                    .filter(url => url);
                
                if (imageUrls.length > 0) {
                    // Store the first image URL
                    imageMap.set(sku, imageUrls[0]);
                }
            }
        });

        console.log(`Extracted image URLs for ${imageMap.size} products from CSV\n`);

        // Match products and prepare updates
        const updates = [];
        const notFound = [];

        for (const product of products) {
            const imageUrl = imageMap.get(product.sku);
            
            if (imageUrl) {
                updates.push({
                    id: product.id,
                    sku: product.sku,
                    name: product.name,
                    imageUrl: imageUrl
                });
            } else {
                notFound.push({
                    sku: product.sku,
                    name: product.name
                });
            }
        }

        console.log(`\n=== SUMMARY ===`);
        console.log(`Products with missing images: ${products.length}`);
        console.log(`Matches found in CSV: ${updates.length}`);
        console.log(`Not found in CSV: ${notFound.length}`);

        if (updates.length > 0) {
            console.log(`\n=== PRODUCTS TO UPDATE (${updates.length}) ===`);
            updates.forEach((update, index) => {
                console.log(`${index + 1}. [${update.sku}] ${update.name}`);
                console.log(`   Image: ${update.imageUrl}\n`);
            });

            console.log('\n=== EXECUTING UPDATES ===');
            let updateCount = 0;
            for (const update of updates) {
                // Check if product already has an entry in product_images
                const [existing] = await connection.execute(
                    'SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1',
                    [update.id]
                );

                if (existing.length > 0) {
                    // Update existing image
                    await connection.execute(
                        'UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?',
                        [update.imageUrl, update.name, existing[0].id]
                    );
                } else {
                    // Insert new image
                    await connection.execute(
                        'INSERT INTO product_images (product_id, image_url, alt_text, is_primary) VALUES (?, ?, ?, 1)',
                        [update.id, update.imageUrl, update.name]
                    );
                }
                
                updateCount++;
                if (updateCount % 10 === 0) {
                    console.log(`Updated ${updateCount}/${updates.length}...`);
                }
            }
            console.log(`\n✅ Successfully updated ${updateCount} products!`);
        }

        if (notFound.length > 0) {
            console.log(`\n=== PRODUCTS NOT FOUND IN CSV (${notFound.length}) ===`);
            notFound.forEach((item, index) => {
                console.log(`${index + 1}. [${item.sku}] ${item.name}`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\nDatabase connection closed');
        }
    }
}

// Run the script
updateMissingImages();

