/**
 * Payment Cards Manager (Frontend)
 * Handles saving and managing payment cards securely
 */

class PaymentCardsManager {
    constructor() {
        this.apiBaseUrl = '/api/payment-cards';
        this.stripePublicKey = process.env.STRIPE_PUBLIC_KEY || ''; // Set in your .env
        this.init();
    }

    init() {
        // Load Stripe.js if using Stripe Elements
        if (this.stripePublicKey && typeof window.Stripe !== 'undefined') {
            this.stripe = window.Stripe(this.stripePublicKey);
        }
    }

    /**
     * Get user's saved payment cards
     */
    async getCards() {
        try {
            const token = window.customerAuth?.getToken();
            if (!token) {
                throw new Error('Authentication required');
            }

            const response = await fetch(this.apiBaseUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error('Failed to load payment cards');
            }

            const data = await response.json();
            return data.cards || [];
        } catch (error) {
            console.error('Error loading payment cards:', error);
            throw error;
        }
    }

    /**
     * Save a new payment card
     * @param {Object} cardData - Card information
     * @param {string} cardData.number - Card number
     * @param {number} cardData.exp_month - Expiration month
     * @param {number} cardData.exp_year - Expiration year
     * @param {string} cardData.cvc - CVC code
     * @param {string} cardData.cardholder_name - Name on card
     * @param {number} billingAddressId - Optional billing address ID
     * @param {boolean} setAsDefault - Set as default payment method
     */
    async saveCard(cardData, billingAddressId = null, setAsDefault = false) {
        try {
            const token = window.customerAuth?.getToken();
            if (!token) {
                throw new Error('Authentication required');
            }

            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    cardData,
                    billingAddressId,
                    setAsDefault,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save payment card');
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error saving payment card:', error);
            throw error;
        }
    }

    /**
     * Update a payment card
     * @param {number} cardId - Card ID
     * @param {Object} updates - Fields to update
     */
    async updateCard(cardId, updates) {
        try {
            const token = window.customerAuth?.getToken();
            if (!token) {
                throw new Error('Authentication required');
            }

            const response = await fetch(`${this.apiBaseUrl}/${cardId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update payment card');
            }

            return await response.json();
        } catch (error) {
            console.error('Error updating payment card:', error);
            throw error;
        }
    }

    /**
     * Delete a payment card
     * @param {number} cardId - Card ID
     */
    async deleteCard(cardId) {
        try {
            const token = window.customerAuth?.getToken();
            if (!token) {
                throw new Error('Authentication required');
            }

            const response = await fetch(`${this.apiBaseUrl}/${cardId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete payment card');
            }

            return await response.json();
        } catch (error) {
            console.error('Error deleting payment card:', error);
            throw error;
        }
    }

    /**
     * Set a card as default
     * @param {number} cardId - Card ID
     */
    async setAsDefault(cardId) {
        return await this.updateCard(cardId, { is_default: true });
    }

    /**
     * Format card number for display (shows only last 4 digits)
     * @param {string} last4 - Last 4 digits
     * @param {string} brand - Card brand
     */
    formatCardDisplay(last4, brand) {
        const brandName = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
        return `${brandName} •••• ${last4}`;
    }

    /**
     * Format expiration date
     * @param {number} month - Expiration month
     * @param {number} year - Expiration year
     */
    formatExpiration(month, year) {
        const monthStr = month.toString().padStart(2, '0');
        const yearStr = year.toString().slice(-2);
        return `${monthStr}/${yearStr}`;
    }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.paymentCardsManager = new PaymentCardsManager();
    });
} else {
    window.paymentCardsManager = new PaymentCardsManager();
}

