/**
 * Payment Cards API Routes
 * Handles secure payment card tokenization and management
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const PaymentTokenizationService = require('../services/payment-tokenization');

// Initialize service with database pool
function getPaymentService(req) {
    // req.pool is already set by server.js middleware at line 781-784
    const pool = req.pool;
    if (!pool) {
        throw new Error('Database pool not available');
    }
    return new PaymentTokenizationService(pool);
}

// Middleware to authenticate user
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // req.pool is already set by server.js middleware at line 781-784
        const pool = req.pool;
        if (!pool) {
            return res.status(500).json({ error: 'Database connection not available' });
        }

        // Verify user exists and is active
        const [users] = await pool.execute(
            'SELECT id FROM users WHERE id = ? AND is_active = 1',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Get user's saved payment cards
router.get('/', authenticateUser, async (req, res) => {
    try {
        const service = getPaymentService(req);
        const cards = await service.getUserCards(req.userId);
        res.json({ cards });
    } catch (error) {
        logger.error('Get payment cards error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Save a new payment card (tokenize and store)
router.post('/', authenticateUser, async (req, res) => {
    try {
        const { cardData, billingAddressId, setAsDefault } = req.body;

        if (!cardData || !cardData.number || !cardData.exp_month || !cardData.exp_year) {
            return res.status(400).json({ error: 'Invalid card data' });
        }

        const service = getPaymentService(req);
        
        // Tokenize the card
        const tokenizedCard = await service.tokenizeCard(
            cardData,
            req.body.billingAddress || null
        );

        // Save to database
        const cardId = await service.saveCard(
            req.userId,
            tokenizedCard,
            billingAddressId || null,
            setAsDefault || false
        );

        res.status(201).json({
            message: 'Payment card saved successfully',
            cardId: cardId,
            card: {
                id: cardId,
                last4: tokenizedCard.last4,
                brand: tokenizedCard.brand,
                exp_month: tokenizedCard.exp_month,
                exp_year: tokenizedCard.exp_year,
            },
        });
    } catch (error) {
        logger.error('Save payment card error:', error);
        res.status(500).json({ error: error.message || 'Failed to save payment card' });
    }
});

// Update a payment card
router.put('/:cardId', authenticateUser, async (req, res) => {
    try {
        const { cardId } = req.params;
        const updates = req.body;

        const service = getPaymentService(req);
        const updated = await service.updateCard(cardId, req.userId, updates);

        if (!updated) {
            return res.status(404).json({ error: 'Payment card not found' });
        }

        res.json({ message: 'Payment card updated successfully' });
    } catch (error) {
        logger.error('Update payment card error:', error);
        res.status(500).json({ error: error.message || 'Failed to update payment card' });
    }
});

// Delete a payment card
router.delete('/:cardId', authenticateUser, async (req, res) => {
    try {
        const { cardId } = req.params;

        const service = getPaymentService(req);
        const deleted = await service.deleteCard(cardId, req.userId);

        if (!deleted) {
            return res.status(404).json({ error: 'Payment card not found' });
        }

        res.json({ message: 'Payment card deleted successfully' });
    } catch (error) {
        logger.error('Delete payment card error:', error);
        res.status(500).json({ error: error.message || 'Failed to delete payment card' });
    }
});

// Get a specific payment card
router.get('/:cardId', authenticateUser, async (req, res) => {
    try {
        const { cardId } = req.params;

        const service = getPaymentService(req);
        const card = await service.getCard(cardId, req.userId);

        res.json({ card });
    } catch (error) {
        logger.error('Get payment card error:', error);
        if (error.message === 'Payment card not found') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

