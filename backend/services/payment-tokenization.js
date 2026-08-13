/**
 * Payment Card Tokenization Service
 * Securely handles payment card tokenization using payment processors
 * Never stores actual card numbers - only tokens
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentTokenizationService {
    constructor(pool) {
        this.pool = pool;
        this.processor = process.env.PAYMENT_PROCESSOR || 'stripe';
    }

    /**
     * Tokenize a payment card using Stripe
     * @param {Object} cardData - Card information from frontend
     * @param {string} cardData.number - Card number (will be tokenized)
     * @param {number} cardData.exp_month - Expiration month
     * @param {number} cardData.exp_year - Expiration year
     * @param {string} cardData.cvc - CVC code
     * @param {string} cardData.cardholder_name - Name on card
     * @param {Object} billingAddress - Billing address
     * @returns {Promise<Object>} Tokenized card information
     */
    async tokenizeCard(cardData, billingAddress = null) {
        if (this.processor === 'stripe') {
            return await this.tokenizeWithStripe(cardData, billingAddress);
        }
        throw new Error(`Payment processor ${this.processor} not implemented`);
    }

    /**
     * Tokenize card with Stripe
     */
    async tokenizeWithStripe(cardData, billingAddress) {
        try {
            // Create payment method (tokenizes the card)
            const paymentMethod = await stripe.paymentMethods.create({
                type: 'card',
                card: {
                    number: cardData.number,
                    exp_month: cardData.exp_month,
                    exp_year: cardData.exp_year,
                    cvc: cardData.cvc,
                },
                billing_details: {
                    name: cardData.cardholder_name,
                    email: cardData.email,
                    address: billingAddress ? {
                        line1: billingAddress.address_line_1,
                        line2: billingAddress.address_line_2,
                        city: billingAddress.city,
                        state: billingAddress.state,
                        postal_code: billingAddress.postal_code,
                        country: billingAddress.country || 'US',
                    } : undefined,
                },
            });

            return {
                payment_token: paymentMethod.id,
                payment_method_id: paymentMethod.id,
                last4: paymentMethod.card.last4,
                brand: paymentMethod.card.brand,
                exp_month: paymentMethod.card.exp_month,
                exp_year: paymentMethod.card.exp_year,
                fingerprint: paymentMethod.card.fingerprint,
                metadata: {
                    type: paymentMethod.type,
                    created: paymentMethod.created,
                },
            };
        } catch (error) {
            console.error('Stripe tokenization error:', error);
            throw new Error(`Card tokenization failed: ${error.message}`);
        }
    }

    /**
     * Save tokenized card to database
     * @param {number} userId - User ID
     * @param {Object} tokenizedCard - Tokenized card data from processor
     * @param {number} billingAddressId - Optional billing address ID
     * @param {boolean} setAsDefault - Set as default payment method
     */
    async saveCard(userId, tokenizedCard, billingAddressId = null, setAsDefault = false) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();

            // If setting as default, unset other default cards
            if (setAsDefault) {
                await connection.execute(
                    'UPDATE payment_cards SET is_default = FALSE WHERE user_id = ? AND is_active = TRUE',
                    [userId]
                );
            }

            // Insert new card
            const [result] = await connection.execute(
                `INSERT INTO payment_cards (
                    user_id, payment_processor, payment_token, payment_method_id,
                    last4, brand, exp_month, exp_year, cardholder_name,
                    billing_address_id, is_default, is_active, fingerprint, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    this.processor,
                    tokenizedCard.payment_token,
                    tokenizedCard.payment_method_id,
                    tokenizedCard.last4,
                    tokenizedCard.brand,
                    tokenizedCard.exp_month,
                    tokenizedCard.exp_year,
                    tokenizedCard.cardholder_name || null,
                    billingAddressId,
                    setAsDefault,
                    true,
                    tokenizedCard.fingerprint || null,
                    JSON.stringify(tokenizedCard.metadata || {}),
                ]
            );

            await connection.commit();
            return result.insertId;
        } catch (error) {
            await connection.rollback();
            console.error('Error saving payment card:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Get user's saved payment cards
     * @param {number} userId - User ID
     * @param {boolean} activeOnly - Only return active cards
     */
    async getUserCards(userId, activeOnly = true) {
        let query = `
            SELECT 
                pc.id,
                pc.payment_processor,
                pc.last4,
                pc.brand,
                pc.exp_month,
                pc.exp_year,
                pc.cardholder_name,
                pc.is_default,
                pc.is_active,
                pc.billing_address_id,
                pc.created_at,
                ua.address_line_1,
                ua.city,
                ua.state,
                ua.postal_code
            FROM payment_cards pc
            LEFT JOIN user_addresses ua ON pc.billing_address_id = ua.id
            WHERE pc.user_id = ? AND pc.deleted_at IS NULL
        `;

        if (activeOnly) {
            query += ' AND pc.is_active = TRUE';
        }

        query += ' ORDER BY pc.is_default DESC, pc.created_at DESC';

        const [cards] = await this.pool.execute(query, [userId]);
        return cards;
    }

    /**
     * Get a specific payment card
     * @param {number} cardId - Card ID
     * @param {number} userId - User ID (for security)
     */
    async getCard(cardId, userId) {
        const [cards] = await this.pool.execute(
            `SELECT 
                pc.*,
                ua.address_line_1,
                ua.city,
                ua.state,
                ua.postal_code,
                ua.country
            FROM payment_cards pc
            LEFT JOIN user_addresses ua ON pc.billing_address_id = ua.id
            WHERE pc.id = ? AND pc.user_id = ? AND pc.deleted_at IS NULL AND pc.is_active = TRUE`,
            [cardId, userId]
        );

        if (cards.length === 0) {
            throw new Error('Payment card not found');
        }

        return cards[0];
    }

    /**
     * Update payment card (e.g., set as default, update billing address)
     * @param {number} cardId - Card ID
     * @param {number} userId - User ID
     * @param {Object} updates - Fields to update
     */
    async updateCard(cardId, userId, updates) {
        const allowedUpdates = ['is_default', 'billing_address_id', 'cardholder_name'];
        const updateFields = [];
        const updateValues = [];

        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                updateFields.push(`${key} = ?`);
                updateValues.push(updates[key]);
            }
        });

        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }

        // If setting as default, unset other defaults
        if (updates.is_default) {
            await this.pool.execute(
                'UPDATE payment_cards SET is_default = FALSE WHERE user_id = ? AND id != ?',
                [userId, cardId]
            );
        }

        updateValues.push(cardId, userId);
        const [result] = await this.pool.execute(
            `UPDATE payment_cards 
             SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
            updateValues
        );

        return result.affectedRows > 0;
    }

    /**
     * Delete (soft delete) a payment card
     * @param {number} cardId - Card ID
     * @param {number} userId - User ID
     */
    async deleteCard(cardId, userId) {
        // Also delete from payment processor if needed
        const card = await this.getCard(cardId, userId);

        // Soft delete in database
        const [result] = await this.pool.execute(
            'UPDATE payment_cards SET deleted_at = CURRENT_TIMESTAMP, is_active = FALSE WHERE id = ? AND user_id = ?',
            [cardId, userId]
        );

        // Optionally detach payment method from customer in Stripe
        if (this.processor === 'stripe' && card.payment_method_id) {
            try {
                // Note: We don't delete the payment method in Stripe, just detach it
                // This allows for potential reuse and maintains transaction history
                await this.getOrCreateStripeCustomer(userId);
                await stripe.paymentMethods.detach(card.payment_method_id);
            } catch (error) {
                console.error('Error detaching payment method from Stripe:', error);
                // Don't fail the deletion if Stripe detach fails
            }
        }

        return result.affectedRows > 0;
    }

    /**
     * Get or create Stripe customer
     * @param {number} userId - User ID
     */
    async getOrCreateStripeCustomer(userId) {
        // Get user info
        const [users] = await this.pool.execute(
            'SELECT id, email, first_name, last_name FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];

        // Check if customer already exists in metadata
        // For now, create a new customer each time (in production, store customer ID)
        const customer = await stripe.customers.create({
            email: user.email,
            name: `${user.first_name} ${user.last_name}`,
            metadata: {
                user_id: userId.toString(),
            },
        });

        return customer;
    }

    /**
     * Charge a saved payment card
     * @param {number} cardId - Saved card ID
     * @param {number} amount - Amount in cents
     * @param {string} currency - Currency code (default: 'usd')
     * @param {string} description - Payment description
     */
    async chargeCard(cardId, userId, amount, currency = 'usd', description = '') {
        const card = await this.getCard(cardId, userId);

        if (this.processor === 'stripe') {
            const customer = await this.getOrCreateStripeCustomer(userId);

            // Attach payment method to customer if not already attached
            try {
                await stripe.paymentMethods.attach(card.payment_method_id, {
                    customer: customer.id,
                });
            } catch (error) {
                // Payment method might already be attached, ignore
                if (!error.message.includes('already been attached')) {
                    throw error;
                }
            }

            // Create payment intent
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(amount * 100), // Convert to cents
                currency: currency.toLowerCase(),
                customer: customer.id,
                payment_method: card.payment_method_id,
                description: description,
                confirm: true,
                return_url: process.env.PAYMENT_RETURN_URL || 'https://hmherbs.com/account#orders',
            });

            return {
                payment_intent_id: paymentIntent.id,
                status: paymentIntent.status,
                amount: paymentIntent.amount / 100, // Convert back to dollars
                currency: paymentIntent.currency,
            };
        }

        throw new Error(`Payment processor ${this.processor} not implemented for charging`);
    }
}

module.exports = PaymentTokenizationService;

