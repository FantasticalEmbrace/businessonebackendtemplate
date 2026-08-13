'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const { Readable } = require('stream');
const csv = require('csv-parser');
const path = require('path');
const { loadBackendEnv, createPool } = require('../utils/dbConfig');

loadBackendEnv();

function pickField(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (value != null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return '';
}

function parseMoney(value, fallback = 0) {
    if (value == null || value === '') return fallback;
    const cleaned = String(value).replace(/[$,\s]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : fallback;
}

function parseIntQty(value, fallback = 0) {
    if (value == null || value === '') return fallback;
    const n = parseInt(String(value).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function parseBool(value, defaultValue = true) {
    if (value == null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0'].includes(normalized)) return false;
    return defaultValue;
}

class ProductImporter {
    /**
     * @param {import('mysql2/promise').Pool} [pool]
     */
    constructor(pool = null) {
        this.pool = pool || createPool({ connectionLimit: 10, queueLimit: 0 });
        this.ownsPool = !pool;
        this.resetStats();
    }

    resetStats() {
        this.importStats = {
            total: 0,
            success: 0,
            created: 0,
            updated: 0,
            errors: 0,
            skipped: 0,
            errorDetails: []
        };
    }

    getStats() {
        return { ...this.importStats };
    }

    async importFromCSV(filePath) {
        console.log(`Starting import from: ${filePath}`);
        const products = await this.parseCSVFile(filePath);
        return this.importProductList(products);
    }

    async importFromBuffer(buffer) {
        const products = await this.parseCSVBuffer(buffer);
        return this.importProductList(products);
    }

    async importProductList(products) {
        this.resetStats();
        this.importStats.total = products.length;
        console.log(`Found ${products.length} products to import`);

        for (let index = 0; index < products.length; index++) {
            const product = products[index];
            if (!product) {
                this.importStats.skipped++;
                continue;
            }
            try {
                const result = await this.importSingleProduct(product);
                this.importStats.success++;
                if (result === 'created') this.importStats.created++;
                else this.importStats.updated++;

                if (this.importStats.success % 100 === 0) {
                    console.log(`Imported ${this.importStats.success} products...`);
                }
            } catch (error) {
                console.error(`Error importing product ${product.name}:`, error.message);
                this.importStats.errors++;
                if (this.importStats.errorDetails.length < 25) {
                    this.importStats.errorDetails.push({
                        row: index + 2,
                        sku: product.sku || '',
                        name: product.name || '',
                        message: error.message
                    });
                }
            }
        }

        this.printImportSummary();
        return this.getStats();
    }

    async importFromJSON(filePath) {
        console.log(`Starting import from JSON: ${filePath}`);
        const fileContent = await fs.readFile(filePath, 'utf8');
        const jsonData = JSON.parse(fileContent);
        const products = (jsonData.products || [])
            .map((product) => this.mapJSONToProduct(product))
            .filter(Boolean);
        return this.importProductList(products);
    }

    mapJSONToProduct(jsonProduct) {
        try {
            return {
                sku: jsonProduct.sku || this.generateSKU(),
                name: jsonProduct.name || 'Unknown Product',
                slug: this.generateSlug(jsonProduct.name || 'unknown-product'),
                short_description: jsonProduct.shortDescription || jsonProduct.description || '',
                long_description: (() => {
                    const short = (jsonProduct.shortDescription || '').trim();
                    const long = (jsonProduct.description || jsonProduct.longDescription || '').trim();
                    if (!long) return '';
                    if (short && long === short) return '';
                    return long;
                })(),
                brand: jsonProduct.brand || 'Unknown',
                category: jsonProduct.category || 'General',
                price: parseMoney(jsonProduct.price, 0),
                cost_price: parseMoney(jsonProduct.cost ?? jsonProduct.costPrice, null) || null,
                compare_price: parseMoney(jsonProduct.comparePrice, null) || null,
                weight: parseMoney(jsonProduct.weight, null) || null,
                inventory_quantity: parseIntQty(jsonProduct.inventory ?? (jsonProduct.inStock ? 10 : 0), 0),
                track_inventory: jsonProduct.trackInventory !== false,
                is_taxable: jsonProduct.isTaxable !== false,
                low_stock_threshold: parseIntQty(jsonProduct.lowStockThreshold, 10),
                is_active: jsonProduct.inStock !== false,
                is_featured: Boolean(jsonProduct.isFeatured),
                show_on_web: jsonProduct.showOnWeb !== false && jsonProduct.show_on_web !== false,
                health_categories: jsonProduct.healthCategories || [],
                images: (jsonProduct.images || []).map((img) => ({
                    url: typeof img === 'string' ? img : (img.url || ''),
                    alt: typeof img === 'string' ? '' : (img.alt || '')
                })),
                variants: jsonProduct.variants || []
            };
        } catch (error) {
            console.error('Error mapping JSON product:', error);
            return null;
        }
    }

    async parseCSVFile(filePath) {
        return new Promise((resolve, reject) => {
            const products = [];
            fsSync.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                    const product = this.mapCSVToProduct(row);
                    if (product) products.push(product);
                })
                .on('end', () => resolve(products))
                .on('error', reject);
        });
    }

    async parseCSVBuffer(buffer) {
        return new Promise((resolve, reject) => {
            const products = [];
            Readable.from(buffer)
                .pipe(csv())
                .on('data', (row) => {
                    const product = this.mapCSVToProduct(row);
                    if (product) products.push(product);
                })
                .on('end', () => resolve(products))
                .on('error', reject);
        });
    }

    mapCSVToProduct(row) {
        try {
            const name = pickField(row, [
                'name', 'Name', 'Product Name', 'product_name', 'title', 'Item Name', 'item_name'
            ]);
            if (!name) return null;

            const sku =
                pickField(row, ['sku', 'SKU', 'Product Code', 'product_code', 'Item Number', 'item_number']) ||
                pickField(row, ['barcode', 'Barcode', 'UPC', 'upc', 'EAN', 'ean']) ||
                this.generateSKU();

            const shortDesc = pickField(row, [
                'short_description', 'Short Description', 'short_desc', 'summary'
            ]);
            const longDesc = pickField(row, [
                'description', 'Description', 'Long Description', 'long_description', 'details'
            ]);

            return {
                sku,
                name,
                slug: this.generateSlug(name),
                short_description: shortDesc,
                long_description: longDesc || shortDesc,
                brand: pickField(row, ['brand', 'Brand', 'manufacturer', 'Manufacturer', 'vendor', 'Vendor']) || 'Unknown',
                category: pickField(row, ['category', 'Category', 'department', 'Department']) || 'General',
                price: parseMoney(pickField(row, ['price', 'Price', 'retail_price', 'Retail Price', 'sell_price', 'Sell Price']), 0),
                cost_price: (() => {
                    const raw = pickField(row, ['cost', 'Cost', 'cost_price', 'wholesale', 'Wholesale']);
                    return raw ? parseMoney(raw, null) : null;
                })(),
                compare_price: (() => {
                    const raw = pickField(row, ['compare_price', 'Compare Price', 'msrp', 'MSRP']);
                    return raw ? parseMoney(raw, null) : null;
                })(),
                weight: (() => {
                    const raw = pickField(row, ['weight', 'Weight']);
                    return raw ? parseMoney(raw, null) : null;
                })(),
                inventory_quantity: parseIntQty(
                    pickField(row, [
                        'quantity', 'qty', 'Qty', 'inventory', 'Inventory', 'stock', 'Stock',
                        'on_hand', 'On Hand', 'quantity_on_hand'
                    ]),
                    0
                ),
                track_inventory: parseBool(pickField(row, ['track_inventory', 'Track Inventory', 'track_stock']), true),
                is_taxable: parseBool(pickField(row, ['is_taxable', 'taxable', 'Taxable']), true),
                low_stock_threshold: parseIntQty(
                    pickField(row, ['low_stock_threshold', 'Low Stock', 'low_stock', 'reorder_level']),
                    10
                ),
                is_active: parseBool(pickField(row, ['is_active', 'active', 'Active']), true),
                is_featured: parseBool(pickField(row, ['is_featured', 'featured', 'Featured']), false),
                show_on_web: (() => {
                    const posOnly = pickField(row, ['pos_only', 'POS Only', 'in_store_only', 'In Store Only']);
                    if (posOnly) return !parseBool(posOnly, false);
                    return parseBool(
                        pickField(row, ['show_on_web', 'Show On Web', 'web_visible', 'Web Visible']),
                        true
                    );
                })(),
                health_categories: this.parseHealthCategories(
                    pickField(row, ['health_categories', 'Health Categories'])
                ),
                images: this.parseImages(
                    pickField(row, ['image_url', 'images', 'Images', 'Image URL', 'image', 'Image', 'photo', 'Photo'])
                ),
                variants: this.parseVariants(pickField(row, ['variants', 'Variants']))
            };
        } catch (error) {
            console.error('Error mapping CSV row:', error);
            return null;
        }
    }

    async importSingleProduct(productData) {
        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();

            const brandId = await this.getOrCreateBrand(connection, productData.brand);
            const categoryId = await this.getOrCreateCategory(connection, productData.category);

            let [existing] = await connection.execute('SELECT id, sku FROM products WHERE sku = ?', [productData.sku]);

            if (existing.length === 0 || productData.sku.startsWith('HM-')) {
                const [existingByName] = await connection.execute(
                    'SELECT id, sku FROM products WHERE name = ?',
                    [productData.name]
                );
                if (existingByName.length > 0) {
                    existing = existingByName;
                }
            }

            let productId;
            let action = 'created';

            if (existing.length > 0) {
                action = 'updated';
                productId = existing[0].id;

                const skuToUse =
                    existing[0].sku && !existing[0].sku.startsWith('HM-') ? existing[0].sku : productData.sku;

                const [currentValues] = await connection.execute(
                    'SELECT brand_id, category_id FROM products WHERE id = ?',
                    [productId]
                );

                let brandIdToUse = brandId;
                let categoryIdToUse = categoryId;

                if (productData.brand === 'Unknown' || productData.brand === '') {
                    const [currentBrand] = await connection.execute('SELECT name FROM brands WHERE id = ?', [
                        currentValues[0].brand_id
                    ]);
                    if (currentBrand.length > 0 && currentBrand[0].name !== 'Unknown') {
                        brandIdToUse = currentValues[0].brand_id;
                    }
                }

                if (productData.category === 'General' || productData.category === '') {
                    const [currentCategory] = await connection.execute(
                        'SELECT name FROM product_categories WHERE id = ?',
                        [currentValues[0].category_id]
                    );
                    if (
                        currentCategory.length > 0 &&
                        currentCategory[0].name !== 'General' &&
                        currentCategory[0].name !== 'Unknown'
                    ) {
                        categoryIdToUse = currentValues[0].category_id;
                    }
                }

                await connection.execute(
                    `UPDATE products SET
                        sku = ?, name = ?, slug = ?, short_description = ?, long_description = ?,
                        brand_id = ?, category_id = ?, price = ?, compare_price = ?, cost_price = ?,
                        weight = ?, inventory_quantity = ?, track_inventory = ?, is_taxable = ?,
                        low_stock_threshold = ?, is_active = ?, is_featured = ?, show_on_web = ?,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        skuToUse,
                        productData.name,
                        productData.slug,
                        productData.short_description,
                        productData.long_description,
                        brandIdToUse,
                        categoryIdToUse,
                        productData.price,
                        productData.compare_price,
                        productData.cost_price,
                        productData.weight,
                        productData.inventory_quantity,
                        productData.track_inventory ? 1 : 0,
                        productData.is_taxable ? 1 : 0,
                        productData.low_stock_threshold,
                        productData.is_active ? 1 : 0,
                        productData.is_featured ? 1 : 0,
                        productData.show_on_web !== false ? 1 : 0,
                        productId
                    ]
                );
            } else {
                const [result] = await connection.execute(
                    `INSERT INTO products (
                        sku, name, slug, short_description, long_description,
                        brand_id, category_id, price, compare_price, cost_price, weight,
                        inventory_quantity, track_inventory, is_taxable, low_stock_threshold,
                        is_active, is_featured, show_on_web
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        productData.sku,
                        productData.name,
                        productData.slug,
                        productData.short_description,
                        productData.long_description,
                        brandId,
                        categoryId,
                        productData.price,
                        productData.compare_price,
                        productData.cost_price,
                        productData.weight,
                        productData.inventory_quantity,
                        productData.track_inventory ? 1 : 0,
                        productData.is_taxable ? 1 : 0,
                        productData.low_stock_threshold,
                        productData.is_active ? 1 : 0,
                        productData.is_featured ? 1 : 0,
                        productData.show_on_web !== false ? 1 : 0
                    ]
                );
                productId = result.insertId;
            }

            if (productData.health_categories.length > 0) {
                await this.assignHealthCategories(connection, productId, productData.health_categories);
            }

            if (productData.images.length > 0) {
                await this.addProductImages(connection, productId, productData.images);
            }

            if (productData.variants.length > 0) {
                await this.addProductVariants(connection, productId, productData.variants);
            }

            await connection.commit();
            return action;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async getOrCreateBrand(connection, brandName) {
        const [existing] = await connection.execute('SELECT id FROM brands WHERE name = ?', [brandName]);
        if (existing.length > 0) return existing[0].id;

        const [result] = await connection.execute('INSERT INTO brands (name, slug) VALUES (?, ?)', [
            brandName,
            this.generateSlug(brandName)
        ]);
        return result.insertId;
    }

    async getOrCreateCategory(connection, categoryName) {
        const [existing] = await connection.execute('SELECT id FROM product_categories WHERE name = ?', [
            categoryName
        ]);
        if (existing.length > 0) return existing[0].id;

        const [result] = await connection.execute('INSERT INTO product_categories (name, slug) VALUES (?, ?)', [
            categoryName,
            this.generateSlug(categoryName)
        ]);
        return result.insertId;
    }

    async assignHealthCategories(connection, productId, healthCategories) {
        await connection.execute('DELETE FROM product_health_categories WHERE product_id = ?', [productId]);

        for (const categoryName of healthCategories) {
            const [category] = await connection.execute(
                'SELECT id FROM health_categories WHERE name = ? OR slug = ?',
                [categoryName, this.generateSlug(categoryName)]
            );

            if (category.length > 0) {
                await connection.execute(
                    'INSERT IGNORE INTO product_health_categories (product_id, health_category_id) VALUES (?, ?)',
                    [productId, category[0].id]
                );
            }
        }
    }

    async addProductImages(connection, productId, images) {
        await connection.execute('DELETE FROM product_images WHERE product_id = ?', [productId]);

        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            await connection.execute(
                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
                [productId, image.url, image.alt || '', i === 0, i]
            );
        }
    }

    async addProductVariants(connection, productId, variants) {
        await connection.execute('DELETE FROM product_variants WHERE product_id = ?', [productId]);

        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            await connection.execute(
                'INSERT INTO product_variants (product_id, sku, name, price, inventory_quantity, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    productId,
                    variant.sku,
                    variant.name,
                    variant.price,
                    variant.inventory ?? variant.inventory_quantity ?? 0,
                    i
                ]
            );
        }
    }

    generateSlug(text) {
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    generateSKU() {
        return `HM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    parseHealthCategories(categoriesString) {
        if (!categoriesString) return [];
        return categoriesString.split(',').map((cat) => cat.trim()).filter(Boolean);
    }

    parseImages(imagesString) {
        if (!imagesString) return [];
        const urls = imagesString.split('|').length > 1
            ? imagesString.split('|')
            : imagesString.split(',');
        return urls.map((url) => url.trim()).filter(Boolean).map((url) => ({ url, alt: '' }));
    }

    parseVariants(variantsString) {
        if (!variantsString) return [];
        try {
            const parsed = JSON.parse(variantsString);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    printImportSummary() {
        console.log('\n=== IMPORT SUMMARY ===');
        console.log(`Total products processed: ${this.importStats.total}`);
        console.log(`Successfully imported: ${this.importStats.success}`);
        console.log(`  Created: ${this.importStats.created}`);
        console.log(`  Updated: ${this.importStats.updated}`);
        console.log(`Errors: ${this.importStats.errors}`);
        console.log(`Skipped: ${this.importStats.skipped}`);
        console.log('======================\n');
    }

    async close() {
        if (this.ownsPool) {
            await this.pool.end();
        }
    }
}

if (require.main === module) {
    const filePath = process.argv[2];
    const fileType = process.argv[3] || 'auto';

    if (!filePath) {
        console.log('Usage: node import-products.js <file-path> [csv|json|auto]');
        process.exit(1);
    }

    const importer = new ProductImporter();
    const ext = path.extname(filePath).toLowerCase();
    const importType = fileType === 'auto' ? (ext === '.json' ? 'json' : 'csv') : fileType;

    const importPromise =
        importType === 'json' ? importer.importFromJSON(filePath) : importer.importFromCSV(filePath);

    importPromise
        .then(() => importer.close().then(() => process.exit(0)))
        .catch((error) => {
            console.error('Import failed:', error);
            importer.close().finally(() => process.exit(1));
        });
}

module.exports = ProductImporter;
