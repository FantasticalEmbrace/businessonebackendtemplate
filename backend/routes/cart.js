// Shopping Cart Routes
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { addToCartValidation, updateCartValidation } = require('../middleware/validation');
const { storefrontPrimaryImageFromFields } = require('../utils/catalogOverrides');
const { cartLookupBinds, normalizeVariantId } = require('../utils/cartSession');
const { loadInventorySettings, canFulfillQuantity } = require('../utils/inventorySettings');
const { STOREFRONT_VISIBLE_WHERE } = require('../utils/storefrontProductVisibility');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');

// Get or create cart for user/session
const getOrCreateCart = async (pool, userId, sessionId) => {
    const [cartUserId, cartSessionId] = cartLookupBinds(userId, sessionId);
    let [carts] = await pool.execute(
        'SELECT id FROM shopping_carts WHERE user_id = ? OR session_id = ? ORDER BY user_id DESC LIMIT 1',
        [cartUserId, cartSessionId]
    );

    if (carts.length === 0) {
        const [result] = await pool.execute(
            'INSERT INTO shopping_carts (user_id, session_id) VALUES (?, ?)',
            [cartUserId, cartSessionId]
        );
        return result.insertId;
    }

    return carts[0].id;
};

// Get cart contents
router.get('/', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID;

        const cartId = await getOrCreateCart(req.pool, userId, sessionId);

        const [items] = await req.pool.execute(`
            SELECT 
                ci.id,
                ci.quantity,
                ci.price,
                p.id as product_id,
                p.name as product_name,
                p.slug as product_slug,
                p.sku as product_sku,
                p.inventory_quantity,
                pv.id as variant_id,
                pv.name as variant_name,
                pv.inventory_quantity as variant_inventory,
                pi.image_url,
                pi.alt_text,
                b.name as brand_name
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.id
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE ci.cart_id = ? AND ${STOREFRONT_VISIBLE_WHERE}
            ORDER BY ci.created_at DESC
        `, [cartId]);

        items.forEach((item) => {
            const fixed = storefrontPrimaryImageFromFields({
                slug: item.product_slug,
                sku: item.product_sku,
                primaryImageUrl: item.image_url
            });
            if (fixed) item.image_url = fixed;
        });

        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const taxRate = await loadStoreTaxRate(req.pool);
        const tax = Math.round(subtotal * taxRate * 100) / 100;
        const shipping = subtotal >= 50 ? 0 : 9.99;
        const total = subtotal + tax + shipping;

        res.json({
            items,
            summary: {
                subtotal: subtotal.toFixed(2),
                tax: tax.toFixed(2),
                shipping: shipping.toFixed(2),
                total: total.toFixed(2),
                itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
            }
        });
    } catch (error) {
        logger.error('Cart fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add item to cart
router.post('/add', addToCartValidation, async (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;
        const variantId = normalizeVariantId(req.body.variantId);
        const userId = req.user?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID;

        if (!productId || quantity < 1) {
            return res.status(400).json({ error: 'Invalid product or quantity' });
        }

        // Get product details
        const [products] = await req.pool.execute(
            `SELECT id, name, price, inventory_quantity, track_inventory, allow_backorder
             FROM products WHERE id = ? AND is_active = 1 AND COALESCE(show_on_web, 1) = 1`,
            [productId]
        );

        if (products.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const product = products[0];
        let price = product.price;
        let availableQuantity = product.inventory_quantity;

        // Check variant if specified
        if (variantId) {
            const [variants] = await req.pool.execute(
                'SELECT price, inventory_quantity FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1',
                [variantId, productId]
            );

            if (variants.length === 0) {
                return res.status(404).json({ error: 'Product variant not found' });
            }

            price = variants[0].price;
            availableQuantity = variants[0].inventory_quantity;
        }

        const inventorySettings = await loadInventorySettings(req.pool);

        // Check inventory
        if (
            product.track_inventory &&
            !canFulfillQuantity(product, inventorySettings, availableQuantity, quantity)
        ) {
            return res.status(400).json({ error: 'Insufficient inventory' });
        }

        const cartId = await getOrCreateCart(req.pool, userId, sessionId);

        // Check if item already exists in cart
        const [existingItems] = await req.pool.execute(
            'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL))',
            [cartId, productId, variantId, variantId]
        );

        if (existingItems.length > 0) {
            // Update existing item
            const newQuantity = existingItems[0].quantity + quantity;
            
            if (
                product.track_inventory &&
                !canFulfillQuantity(product, inventorySettings, availableQuantity, newQuantity)
            ) {
                return res.status(400).json({ error: 'Insufficient inventory for requested quantity' });
            }

            await req.pool.execute(
                'UPDATE cart_items SET quantity = ?, price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [newQuantity, price, existingItems[0].id]
            );
        } else {
            // Add new item
            await req.pool.execute(
                'INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price) VALUES (?, ?, ?, ?, ?)',
                [cartId, productId, variantId, quantity, price]
            );
        }

        // Update cart timestamp
        await req.pool.execute(
            'UPDATE shopping_carts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [cartId]
        );

        res.json({ message: 'Item added to cart successfully' });
    } catch (error) {
        logger.error('Add to cart error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update cart item quantity
router.put('/items/:itemId', updateCartValidation, async (req, res) => {
    try {
        const { itemId } = req.params;
        const { quantity } = req.body;
        const userId = req.user?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID;
        const [cartUserId, cartSessionId] = cartLookupBinds(userId, sessionId);

        if (quantity < 0) {
            return res.status(400).json({ error: 'Invalid quantity' });
        }

        // Verify item belongs to user's cart
        const [items] = await req.pool.execute(`
            SELECT ci.id, ci.product_id, ci.variant_id, p.track_inventory, p.allow_backorder, p.inventory_quantity, pv.inventory_quantity as variant_inventory
            FROM cart_items ci
            JOIN shopping_carts sc ON ci.cart_id = sc.id
            JOIN products p ON ci.product_id = p.id
            LEFT JOIN product_variants pv ON ci.variant_id = pv.id
            WHERE ci.id = ? AND (sc.user_id = ? OR sc.session_id = ?)
        `, [itemId, cartUserId, cartSessionId]);

        if (items.length === 0) {
            return res.status(404).json({ error: 'Cart item not found' });
        }

        const item = items[0];
        const inventorySettings = await loadInventorySettings(req.pool);

        if (quantity === 0) {
            // Remove item from cart
            await req.pool.execute('DELETE FROM cart_items WHERE id = ?', [itemId]);
        } else {
            // Check inventory
            const availableQuantity = item.variant_id ? item.variant_inventory : item.inventory_quantity;

            if (
                item.track_inventory &&
                !canFulfillQuantity(item, inventorySettings, availableQuantity, quantity)
            ) {
                return res.status(400).json({ error: 'Insufficient inventory' });
            }

            // Update quantity
            await req.pool.execute(
                'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [quantity, itemId]
            );
        }

        res.json({ message: 'Cart updated successfully' });
    } catch (error) {
        logger.error('Cart update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove item from cart
router.delete('/items/:itemId', async (req, res) => {
    try {
        const { itemId } = req.params;
        const userId = req.user?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID;
        const [cartUserId, cartSessionId] = cartLookupBinds(userId, sessionId);

        // Verify item belongs to user's cart
        const [items] = await req.pool.execute(`
            SELECT ci.id
            FROM cart_items ci
            JOIN shopping_carts sc ON ci.cart_id = sc.id
            WHERE ci.id = ? AND (sc.user_id = ? OR sc.session_id = ?)
        `, [itemId, cartUserId, cartSessionId]);

        if (items.length === 0) {
            return res.status(404).json({ error: 'Cart item not found' });
        }

        await req.pool.execute('DELETE FROM cart_items WHERE id = ?', [itemId]);

        res.json({ message: 'Item removed from cart' });
    } catch (error) {
        logger.error('Cart item removal error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clear cart
router.delete('/clear', async (req, res) => {
    try {
        const userId = req.user?.id || null;
        const sessionId = req.headers['x-session-id'] || req.sessionID;
        const [cartUserId, cartSessionId] = cartLookupBinds(userId, sessionId);

        await req.pool.execute(`
            DELETE ci FROM cart_items ci
            JOIN shopping_carts sc ON ci.cart_id = sc.id
            WHERE sc.user_id = ? OR sc.session_id = ?
        `, [cartUserId, cartSessionId]);

        res.json({ message: 'Cart cleared successfully' });
    } catch (error) {
        logger.error('Cart clear error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
