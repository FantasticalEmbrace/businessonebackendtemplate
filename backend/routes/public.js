// HM Herbs Public API Routes
// Routes accessible without authentication for frontend functionality

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { emailCampaignValidation } = require('../middleware/validation');
const EmailCampaignService = require('../services/email-campaign');
const { searchAddressSuggestions } = require('../services/addressSuggest');

// Middleware: req.pool is set globally in server.js (immediately after createPool).
router.use((req, res, next) => {
    if (!req.pool) {
        logger.error('Database pool not available in public routes (req.pool unset)');
        return res.status(500).json({ error: 'Database connection not available' });
    }
    next();
});

// Rate limiting middleware for email signups
const rateLimit = require('express-rate-limit');
const emailSignupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 email signups per windowMs
    message: {
        error: 'Too many email signup attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const addressSuggestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many address lookups. Please wait a moment and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ===== EMAIL CAMPAIGN PUBLIC ENDPOINTS =====

// Get active email campaign for display
router.get('/email-campaign/active', async (req, res) => {
    try {
        const emailCampaignService = new EmailCampaignService(req.pool);
        const userAgent = req.get('User-Agent') || '';
        const referrer = req.get('Referer') || '';
        const isNewVisitor = !req.cookies.returning_visitor;

        const campaign = await emailCampaignService.getActiveCampaignForDisplay(
            userAgent,
            referrer,
            isNewVisitor
        );

        if (campaign) {
            // Record impression
            await emailCampaignService.recordImpression(campaign.id, campaign.ab_test_variant);

            // Set returning visitor cookie
            res.cookie('returning_visitor', 'true', {
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                httpOnly: true
            });
        }

        res.json({ campaign });
    } catch (error) {
        logger.error('Get active campaign error:', error);
        res.status(500).json({ error: 'Failed to get active campaign' });
    }
});

// Subscribe to email list (newsletter footer + popup → `email_subscribers` / campaign analytics)
router.post('/email-campaign/subscribe', emailSignupLimiter, emailCampaignValidation, async (req, res) => {
    try {
        const emailCampaignService = new EmailCampaignService(req.pool);
        const { email, first_name, last_name, campaign_id } = req.body;

        const signup_ip = req.ip || req.connection?.remoteAddress;
        const signup_user_agent = req.get('User-Agent');
        const signup_referrer = req.get('Referer');

        const subscriber = await emailCampaignService.addSubscriber({
            email,
            first_name: first_name || null,
            last_name: last_name || null,
            campaign_id: campaign_id ?? null,
            signup_ip,
            signup_user_agent: signup_user_agent || null,
            signup_referrer: signup_referrer || null,
        });

        const response = {
            success: true,
            message: 'Successfully subscribed to our newsletter!',
            subscriber: {
                email: subscriber.email,
                first_name: subscriber.first_name,
                offer_code_sent: subscriber.offer_code_sent,
                offer_expires_at: subscriber.offer_expires_at,
            },
        };

        if (campaign_id) {
            const campaign = await emailCampaignService.getCampaignById(campaign_id);
            if (campaign) {
                response.offer = {
                    type: campaign.offer_type,
                    description: campaign.offer_description,
                    code: subscriber.offer_code_sent,
                    expires_at: subscriber.offer_expires_at,
                };
            }
        }

        res.status(201).json(response);
    } catch (error) {
        logger.error('Email subscription error:', error);

        if (error.message && error.message.includes('already subscribed')) {
            res.status(409).json({ error: error.message });
        } else if (error.message && error.message.includes('Valid email')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Failed to subscribe to newsletter' });
        }
    }
});

// Unsubscribe from email list
router.post('/email-campaign/unsubscribe', async (req, res) => {
    try {
        const emailCampaignService = new EmailCampaignService(req.pool);
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        // Find subscriber by email
        const subscribers = await emailCampaignService.getSubscribers({
            search: email,
            limit: 1
        });

        if (subscribers.length === 0) {
            return res.status(404).json({ error: 'Email address not found' });
        }

        const subscriber = subscribers[0];

        // Update status to unsubscribed
        await emailCampaignService.updateSubscriberStatus(subscriber.id, 'unsubscribed');

        res.json({
            success: true,
            message: 'Successfully unsubscribed from our newsletter'
        });
    } catch (error) {
        logger.error('Email unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to unsubscribe from newsletter' });
    }
});

// Validate offer code (for checkout integration)
router.post('/email-campaign/validate-offer', async (req, res) => {
    try {
        const emailCampaignService = new EmailCampaignService(req.pool);
        const { email, offer_code } = req.body;

        if (!email || !offer_code) {
            return res.status(400).json({ error: 'Email and offer code are required' });
        }

        // Find subscriber with matching email and offer code
        const subscribers = await emailCampaignService.getSubscribers({
            search: email,
            limit: 1
        });

        if (subscribers.length === 0) {
            return res.status(404).json({ error: 'Email address not found' });
        }

        const subscriber = subscribers[0];

        // Validate offer code and expiry
        if (subscriber.offer_code_sent !== offer_code) {
            return res.status(400).json({ error: 'Invalid offer code' });
        }

        if (subscriber.offer_claimed) {
            return res.status(400).json({ error: 'Offer has already been claimed' });
        }

        if (subscriber.offer_expires_at && new Date() > new Date(subscriber.offer_expires_at)) {
            return res.status(400).json({ error: 'Offer has expired' });
        }

        // Get campaign details for offer information
        let offerDetails = null;
        if (subscriber.campaign_id) {
            const campaign = await emailCampaignService.getCampaignById(subscriber.campaign_id);
            offerDetails = {
                type: campaign.offer_type,
                value: campaign.offer_value,
                description: campaign.offer_description,
                expires_at: subscriber.offer_expires_at
            };
        }

        res.json({
            valid: true,
            subscriber_id: subscriber.id,
            offer: offerDetails
        });
    } catch (error) {
        logger.error('Validate offer error:', error);
        res.status(500).json({ error: 'Failed to validate offer code' });
    }
});

// Claim offer (called during checkout)
router.post('/email-campaign/claim-offer', async (req, res) => {
    try {
        const emailCampaignService = new EmailCampaignService(req.pool);
        const { subscriber_id, order_reference } = req.body;

        if (!subscriber_id) {
            return res.status(400).json({ error: 'Subscriber ID is required' });
        }

        const result = await emailCampaignService.claimOffer(subscriber_id, order_reference);
        res.json(result);
    } catch (error) {
        logger.error('Claim offer error:', error);
        res.status(500).json({ error: 'Failed to claim offer' });
    }
});

// ===== UTILITY ENDPOINTS =====

router.get('/address-suggest', addressSuggestLimiter, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        const state = String(req.query.state || '').trim();
        if (q.length < 3) {
            return res.json({ suggestions: [] });
        }
        const suggestions = await searchAddressSuggestions(q, { state });
        res.json({ suggestions });
    } catch (error) {
        logger.error('Address suggest error:', error);
        res.status(502).json({ error: 'Address lookup is temporarily unavailable' });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'HM Herbs Public API'
    });
});

// Get offer types for frontend (for campaign creation UI)
router.get('/email-campaign/offer-types', (req, res) => {
    const offerTypes = [
        {
            value: 'discount_percentage',
            label: '% Discount',
            description: 'Percentage discount (e.g., 10% off)',
            requires_value: true,
            value_label: 'Percentage'
        },
        {
            value: 'discount_fixed',
            label: 'Fixed Discount',
            description: 'Fixed amount discount (e.g., $5 off)',
            requires_value: true,
            value_label: 'Amount ($)'
        },
        {
            value: 'free_shipping',
            label: 'Free Shipping',
            description: 'Free shipping on orders',
            requires_value: false
        },
        {
            value: 'exclusive_access',
            label: 'Exclusive Access',
            description: 'Access to exclusive products or sales',
            requires_value: false
        },
        {
            value: 'early_access',
            label: 'Early Access',
            description: 'Early access to new products or sales',
            requires_value: false
        },
        {
            value: 'gift_with_purchase',
            label: 'Gift with Purchase',
            description: 'Free gift with qualifying purchase',
            requires_value: false
        },
        {
            value: 'loyalty_points',
            label: 'Bonus Points',
            description: 'Bonus loyalty points',
            requires_value: true,
            value_label: 'Points'
        },
        {
            value: 'custom',
            label: 'Custom Offer',
            description: 'Custom offer (describe in offer description)',
            requires_value: false
        }
    ];

    res.json({ offer_types: offerTypes });
});

// Newsletter signup landing (Mailchimp) — data file merged with MAILCHIMP_SIGNUP_LANDING_URL fallback
router.get('/marketing-signup', async (req, res) => {
    try {
        const { mergedPublicConfig } = require('../services/marketingSettings');
        const cfg = mergedPublicConfig();
        res.json({
            signupLandingUrl: cfg.signupLandingUrl,
            headline: cfg.headline
        });
    } catch (error) {
        logger.error('Marketing signup fetch error:', error);
        res.status(500).json({ error: 'Failed to load marketing settings' });
    }
});

module.exports = router;
