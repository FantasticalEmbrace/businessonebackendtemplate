// HM Herbs Vendor Management Service
// Comprehensive vendor management with catalog import and synchronization

const fs = require('fs').promises;
const csv = require('csv-parser');
const xml2js = require('xml2js');
const { buildCatalogAxiosConfig, fetchVendorCatalogText } = require('../utils/vendorCatalogFetch');

class VendorService {
    constructor(db) {
        this.db = db;
        this.xmlParser = new xml2js.Parser();
    }

    // Vendor CRUD Operations
    async createVendor(vendorData, adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(`
                INSERT INTO vendors (
                    name, company_name, contact_person, email, phone, fax, website,
                    address_line1, address_line2, city, state, postal_code, country,
                    tax_id, business_license, account_number, payment_terms, currency,
                    catalog_url, catalog_format, catalog_auth_type, catalog_auth_credentials,
                    auto_sync_enabled, sync_frequency, status, notes, pos_ordering_enabled, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                vendorData.name,
                vendorData.company_name || null,
                vendorData.contact_person || null,
                vendorData.email || null,
                vendorData.phone || null,
                vendorData.fax || null,
                vendorData.website || null,
                vendorData.address_line1 || null,
                vendorData.address_line2 || null,
                vendorData.city || null,
                vendorData.state || null,
                vendorData.postal_code || null,
                vendorData.country || 'United States',
                vendorData.tax_id || null,
                vendorData.business_license || null,
                vendorData.account_number || null,
                vendorData.payment_terms || 'net_30',
                vendorData.currency || 'USD',
                vendorData.catalog_url || null,
                vendorData.catalog_format || 'csv',
                vendorData.catalog_auth_type || 'none',
                vendorData.catalog_auth_credentials ? JSON.stringify(vendorData.catalog_auth_credentials) : null,
                vendorData.auto_sync_enabled || false,
                vendorData.sync_frequency || 'daily',
                vendorData.status || 'pending',
                vendorData.notes || null,
                vendorData.pos_ordering_enabled !== false,
                adminId
            ]);

            await connection.commit();
            return { id: result.insertId, ...vendorData };
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to create vendor: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async getVendors(filters = {}) {
        const { status, search, limit = 50, offset = 0 } = filters;
        
        let query = `
            SELECT v.*, 
                   COUNT(vp.id) as mapped_products,
                   admin.first_name as created_by_name
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            LEFT JOIN admin_users admin ON v.created_by = admin.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND v.status = ?';
            params.push(status);
        }
        
        if (search) {
            query += ' AND (v.name LIKE ? OR v.company_name LIKE ? OR v.email LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        query += ' GROUP BY v.id ORDER BY v.created_at DESC';
        const limitSql = String(Math.min(500, Math.max(1, parseInt(String(limit), 10) || 50)));
        const offsetSql = String(Math.max(0, parseInt(String(offset), 10) || 0));
        query += ` LIMIT ${limitSql} OFFSET ${offsetSql}`;

        const [vendors] = await this.db.query(query, params);
        return vendors;
    }

    async getVendorById(vendorId) {
        const [vendors] = await this.db.execute(`
            SELECT v.*, 
                   COUNT(vp.id) as mapped_products,
                   admin.first_name as created_by_name
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            LEFT JOIN admin_users admin ON v.created_by = admin.id
            WHERE v.id = ?
            GROUP BY v.id
        `, [vendorId]);

        if (vendors.length === 0) {
            throw new Error('Vendor not found');
        }

        const vendor = vendors[0];
        
        // Parse JSON fields
        if (vendor.catalog_auth_credentials) {
            vendor.catalog_auth_credentials = JSON.parse(vendor.catalog_auth_credentials);
        }

        return vendor;
    }

    async updateVendor(vendorId, updateData, _adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Build dynamic update query
            const updateFields = [];
            const params = [];
            
            const allowedFields = [
                'name', 'company_name', 'contact_person', 'email', 'phone', 'fax', 'website',
                'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
                'tax_id', 'business_license', 'account_number', 'payment_terms', 'currency',
                'catalog_url', 'catalog_format', 'catalog_auth_type', 'auto_sync_enabled',
                'sync_frequency', 'status', 'rating', 'notes', 'pos_ordering_enabled'
            ];

            for (const field of allowedFields) {
                if (updateData.hasOwnProperty(field)) {
                    updateFields.push(`${field} = ?`);
                    params.push(updateData[field]);
                }
            }

            if (Object.prototype.hasOwnProperty.call(updateData, 'catalog_auth_credentials')) {
                updateFields.push('catalog_auth_credentials = ?');
                params.push(
                    updateData.catalog_auth_credentials
                        ? JSON.stringify(updateData.catalog_auth_credentials)
                        : null
                );
            }

            if (updateFields.length === 0) {
                throw new Error('No valid fields to update');
            }

            params.push(vendorId);

            const [result] = await connection.execute(`
                UPDATE vendors 
                SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, params);

            if (result.affectedRows === 0) {
                throw new Error('Vendor not found');
            }

            await connection.commit();
            return await this.getVendorById(vendorId);
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to update vendor: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async deleteVendor(vendorId, _adminId) {
        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Check if vendor has mapped products
            const [products] = await connection.execute(
                'SELECT COUNT(*) as count FROM vendor_products WHERE vendor_id = ?',
                [vendorId]
            );

            if (products[0].count > 0) {
                // Soft delete by setting status to inactive
                await connection.execute(
                    'UPDATE vendors SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['inactive', vendorId]
                );
            } else {
                // Hard delete if no products mapped
                const [result] = await connection.execute(
                    'DELETE FROM vendors WHERE id = ?',
                    [vendorId]
                );

                if (result.affectedRows === 0) {
                    throw new Error('Vendor not found');
                }
            }

            await connection.commit();
            return { success: true };
        } catch (error) {
            await connection.rollback();
            throw new Error(`Failed to delete vendor: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    // Catalog Import and Synchronization
    async importCatalog(vendorId, importType = 'manual', sourceFile = null) {
        const vendor = await this.getVendorById(vendorId);
        
        if (!vendor.catalog_url && !sourceFile) {
            throw new Error('No catalog URL or source file provided');
        }

        const connection = await this.db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Create import record
            const [importResult] = await connection.execute(`
                INSERT INTO vendor_catalog_imports (
                    vendor_id, import_type, status, source_file, started_at
                ) VALUES (?, ?, 'processing', ?, NOW())
            `, [vendorId, importType, sourceFile]);

            const importId = importResult.insertId;

            try {
                let catalogData;
                
                if (sourceFile) {
                    catalogData = await this.parseCatalogFile(sourceFile, vendor.catalog_format);
                } else {
                    catalogData = await this.fetchCatalogFromUrl(vendor);
                }

                const importStats = await this.processCatalogData(vendorId, catalogData, connection);

                // Update import record with success
                await connection.execute(`
                    UPDATE vendor_catalog_imports 
                    SET status = 'completed', 
                        completed_at = NOW(),
                        total_records = ?,
                        processed_records = ?,
                        new_products = ?,
                        updated_products = ?,
                        failed_records = ?
                    WHERE id = ?
                `, [
                    importStats.total,
                    importStats.processed,
                    importStats.new,
                    importStats.updated,
                    importStats.failed,
                    importId
                ]);

                // Update vendor last sync time
                await connection.execute(
                    'UPDATE vendors SET last_catalog_sync = NOW(), total_products = ? WHERE id = ?',
                    [importStats.new + importStats.updated, vendorId]
                );

                await connection.commit();
                return { importId, ...importStats };

            } catch (processingError) {
                // Update import record with failure
                await connection.execute(`
                    UPDATE vendor_catalog_imports 
                    SET status = 'failed', 
                        completed_at = NOW(),
                        error_details = ?
                    WHERE id = ?
                `, [JSON.stringify({ error: processingError.message }), importId]);

                await connection.commit();
                throw processingError;
            }

        } catch (error) {
            await connection.rollback();
            throw new Error(`Catalog import failed: ${error.message}`);
        } finally {
            connection.release();
        }
    }

    async fetchCatalogFromUrl(vendor) {
        const { text } = await fetchVendorCatalogText(vendor);
        return this.parseCatalogData(text, vendor.catalog_format);
    }

    async parseCatalogFile(filePath, format) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        return this.parseCatalogData(fileContent, format);
    }

    async parseCatalogData(data, format) {
        switch (format) {
            case 'json':
                return typeof data === 'string' ? JSON.parse(data) : data;
            
            case 'xml':
                const result = await this.xmlParser.parseStringPromise(data);
                return this.normalizeXmlData(result);
            
            case 'csv':
                return new Promise((resolve, reject) => {
                    const results = [];
                    const stream = require('stream');
                    const readable = new stream.Readable();
                    readable.push(data);
                    readable.push(null);
                    
                    readable
                        .pipe(csv())
                        .on('data', (row) => results.push(row))
                        .on('end', () => resolve(results))
                        .on('error', reject);
                });
            
            default:
                throw new Error(`Unsupported catalog format: ${format}`);
        }
    }

    normalizeXmlData(xmlData) {
        // Convert XML structure to array of products
        // This is a basic implementation - customize based on vendor XML structure
        if (xmlData.catalog && xmlData.catalog.product) {
            return Array.isArray(xmlData.catalog.product) 
                ? xmlData.catalog.product 
                : [xmlData.catalog.product];
        }
        
        if (xmlData.products && xmlData.products.product) {
            return Array.isArray(xmlData.products.product) 
                ? xmlData.products.product 
                : [xmlData.products.product];
        }
        
        throw new Error('Unable to parse XML catalog structure');
    }

    async processCatalogData(vendorId, catalogData, connection) {
        const stats = {
            total: catalogData.length,
            processed: 0,
            new: 0,
            updated: 0,
            failed: 0
        };

        for (const item of catalogData) {
            try {
                const productData = this.mapCatalogItem(item);
                
                if (!productData.sku || !productData.name) {
                    stats.failed++;
                    continue;
                }

                // Check if product exists in our system
                const [existingProducts] = await connection.execute(
                    'SELECT id FROM products WHERE sku = ?',
                    [productData.sku]
                );

                let productId;
                
                if (existingProducts.length > 0) {
                    // Update existing product
                    productId = existingProducts[0].id;
                    await this.updateProductFromCatalog(productId, productData, connection);
                    stats.updated++;
                } else {
                    // Create new product
                    productId = await this.createProductFromCatalog(productData, connection);
                    stats.new++;
                }

                // Create or update vendor product mapping
                await this.upsertVendorProduct(vendorId, productId, item, connection);
                stats.processed++;

            } catch (error) {
                console.error(`Failed to process catalog item:`, error);
                stats.failed++;
            }
        }

        return stats;
    }

    mapCatalogItem(item) {
        // Map vendor catalog fields to our product structure
        // This is a generic mapping - customize based on vendor data structure
        return {
            sku: item.sku || item.SKU || item.product_code,
            name: item.name || item.title || item.product_name,
            description: item.description || item.desc,
            price: parseFloat(item.price || item.retail_price || 0),
            cost: parseFloat(item.cost || item.wholesale_price || 0),
            inventory_quantity: parseInt(item.inventory || item.stock || 0),
            weight: parseFloat(item.weight || 0),
            category: item.category || item.product_category,
            brand: item.brand || item.manufacturer,
            image_url: item.image || item.image_url
        };
    }

    async createProductFromCatalog(productData, connection) {
        const [result] = await connection.execute(`
            INSERT INTO products (
                sku, name, description, price, compare_at_price, cost,
                inventory_quantity, weight, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW())
        `, [
            productData.sku,
            productData.name,
            productData.description || '',
            productData.price,
            productData.price * 1.2, // Default compare price
            productData.cost,
            productData.inventory_quantity,
            productData.weight
        ]);

        return result.insertId;
    }

    async updateProductFromCatalog(productId, productData, connection) {
        await connection.execute(`
            UPDATE products 
            SET name = ?, description = ?, price = ?, cost = ?, 
                inventory_quantity = ?, weight = ?, updated_at = NOW()
            WHERE id = ?
        `, [
            productData.name,
            productData.description || '',
            productData.price,
            productData.cost,
            productData.inventory_quantity,
            productData.weight,
            productId
        ]);
    }

    async upsertVendorProduct(vendorId, productId, catalogItem, connection) {
        const vendorData = {
            vendor_sku: catalogItem.vendor_sku || catalogItem.sku,
            vendor_name: catalogItem.vendor_name || catalogItem.name,
            vendor_price: parseFloat(catalogItem.price || 0),
            vendor_cost: parseFloat(catalogItem.cost || 0),
            minimum_order_quantity: parseInt(catalogItem.min_order || 1),
            lead_time_days: parseInt(catalogItem.lead_time || 0)
        };

        // Try to update existing mapping
        const [updateResult] = await connection.execute(`
            UPDATE vendor_products 
            SET vendor_sku = ?, vendor_name = ?, vendor_price = ?, vendor_cost = ?,
                minimum_order_quantity = ?, lead_time_days = ?, mapping_status = 'mapped',
                last_updated = NOW()
            WHERE vendor_id = ? AND product_id = ?
        `, [
            vendorData.vendor_sku,
            vendorData.vendor_name,
            vendorData.vendor_price,
            vendorData.vendor_cost,
            vendorData.minimum_order_quantity,
            vendorData.lead_time_days,
            vendorId,
            productId
        ]);

        // If no existing mapping, create new one
        if (updateResult.affectedRows === 0) {
            await connection.execute(`
                INSERT INTO vendor_products (
                    vendor_id, product_id, vendor_sku, vendor_name, vendor_price, vendor_cost,
                    minimum_order_quantity, lead_time_days, mapping_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mapped')
            `, [
                vendorId,
                productId,
                vendorData.vendor_sku,
                vendorData.vendor_name,
                vendorData.vendor_price,
                vendorData.vendor_cost,
                vendorData.minimum_order_quantity,
                vendorData.lead_time_days
            ]);
        }
    }

    // Vendor Analytics and Reporting
    async getVendorAnalytics(vendorId, dateRange = 30) {
        const [analytics] = await this.db.execute(`
            SELECT 
                COUNT(DISTINCT vp.product_id) as total_products,
                COUNT(DISTINCT CASE WHEN vp.mapping_status = 'mapped' THEN vp.product_id END) as mapped_products,
                COUNT(DISTINCT CASE WHEN vp.mapping_status = 'conflict' THEN vp.product_id END) as conflict_products,
                AVG(vp.vendor_price) as avg_price,
                MIN(vp.vendor_price) as min_price,
                MAX(vp.vendor_price) as max_price,
                COUNT(DISTINCT vci.id) as total_imports,
                COUNT(DISTINCT CASE WHEN vci.status = 'completed' THEN vci.id END) as successful_imports
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            LEFT JOIN vendor_catalog_imports vci ON v.id = vci.vendor_id 
                AND vci.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            WHERE v.id = ?
        `, [dateRange, vendorId]);

        return analytics[0];
    }

    async getImportHistory(vendorId, limit = 20) {
        const [imports] = await this.db.execute(`
            SELECT * FROM vendor_catalog_imports 
            WHERE vendor_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        `, [vendorId, limit]);

        return imports.map(imp => {
            if (imp.error_details) {
                imp.error_details = JSON.parse(imp.error_details);
            }
            return imp;
        });
    }
}

module.exports = VendorService;

