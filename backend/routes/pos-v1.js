'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticatePosDevice } = require('../middleware/posDeviceAuth');
const { authenticatePosEmployee, attachOptionalPosEmployee } = require('../middleware/posEmployeeAuth');
const personnel = require('../services/posPersonnel');
const {
    createInStorePosOrder,
    syncPosOrderBatch,
    refundInStorePosOrder,
    loadCatalogLines,
    ALLOWED_PAYMENT_METHODS
} = require('../services/posStoreOrder');
const { pricePosCart } = require('../services/posPromotionPricing');
const { merchandiseSubtotal, applyCartDiscountToEnriched, computeDualPricing } = require('../services/posCashDiscount');
const { resolveCustomerUser } = require('../services/posCustomerService');
const { listInStorePosSales, getInStorePosOrderReceipt } = require('../services/posOrderHistory');
const { loadStoreTaxRate } = require('../utils/storeTaxRate');
const { loadCashDiscountSettings } = require('../services/posCashDiscount');
const { loadPosPaymentMethodsSettings } = require('../services/posPaymentMethodsSettings');
const { loadPosStoreConfig } = require('../services/posStoreConfig');
const { loadPosReceiptSettings } = require('../services/posReceiptSettings');
const { loadPosSecuritySettings } = require('../services/posSecuritySettings');
const { loadPosOperationsSettings } = require('../services/posOperationsSettings');
const { loadPosRegisterExperienceSettings } = require('../services/posRegisterExperienceSettings');
const { loadStoreHours, storeHourFooterLines } = require('../utils/storePublicInfo');
const { loadPosPaymentConfig } = require('../services/posPaymentConfig');
const { loadPosCardCheckoutSettings } = require('../services/posCardCheckoutSettings');
const { listDisplayAds } = require('../services/posDisplayAds');
const { listDisplayAdsForRegister } = require('../services/posFrontDisplays');
const { recordRegisterNetworkReport } = require('../services/posStoreNetwork');
const { loadMerchantLicense } = require('../services/posMerchantLicense');
const { requireActivePosLicense } = require('../middleware/posLicenseGate');
const { listEquipmentForRegister, getMobileCardReaderForRegister, upsertMobileCardReaderForRegister, listMobileCardReaderModels } = require('../services/posEquipment');
const { buildRegisterHardwareProfile } = require('../services/posRegisterHardware');
const { printEscposReceipt } = require('../services/posEscposPrint');
const {
    createCheckoutIntent,
    getCheckoutIntent,
    cancelCheckoutIntent,
    chargeTerminalCheckoutIntent,
    completeCheckoutIntent
} = require('../services/posCheckoutIntent');
const { resolvePosProcessorCredentials, loadPosPaymentProcessor, MX_PROCESSOR_ID } = require('../services/storePaymentProcessor');
const {
    getPosNmiCollectJsUrl,
    isPosNmiSandboxHint,
    isNmiWalletsDisabled,
    nmiResolveTokenizationCollectJs
} = require('../utils/nmiEnv');
const { getLimitedUseToken, isMxmerchantConfigured } = require('../services/mxmerchantGateway');
const {
    getMxmerchantApiBase,
    getMxmerchantConfig,
    buildPosVirtualPosData,
} = require('../utils/mxmerchantEnv');
const { createHandoffCode } = require('../services/posAdminHandoff');
const { storefrontPrimaryImageFromFields } = require('../utils/catalogOverrides');
const { loadLoyaltyProgramSettings } = require('../services/customerLoyalty');
const posCustomerService = require('../services/posCustomerService');
const { buildRegisterTroubleshootReport } = require('../services/posRegisterTroubleshoot');
const {
    isTroubleshootAiEnabled,
    getTroubleshootAiConfig,
    buildRegisterRulesBriefing,
    briefRegisterTroubleshoot,
    chatRegisterTroubleshoot
} = require('../services/posTroubleshootAi');

const posPinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 40 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.posDeviceId || 'device'}:${req.ip || 'ip'}`,
    message: { error: 'Too many PIN attempts. Please wait and try again.', code: 'PIN_RATE_LIMITED' }
});

function publicStoreBaseUrl(req) {
    const fromEnv = String(process.env.FRONTEND_URL || process.env.PUBLIC_STORE_URL || '').trim().replace(/\/+$/, '');
    if (fromEnv) return fromEnv;
    return `${req.protocol}://${req.get('host')}`;
}

router.use(authenticatePosDevice);

router.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'business-one-pos',
        version: '1.0.0',
        deviceId: req.posDeviceId,
        timestamp: new Date().toISOString()
    });
});

router.put('/network/report', async (req, res) => {
    try {
        const localIp = req.body?.localIp ?? req.body?.reportedIp ?? req.body?.ip;
        const result = await recordRegisterNetworkReport(req.pool, req.posDeviceRecordId, {
            localIp,
            userAgent: req.get('user-agent')
        });
        if (!result) {
            return res.status(400).json({ error: 'localIp is required', code: 'IP_REQUIRED' });
        }
        res.json({ success: true, ...result });
    } catch (e) {
        logger.error('POS network report error:', e);
        res.status(500).json({ error: 'Failed to record network report' });
    }
});

router.put('/failover/usage', async (req, res) => {
    try {
        const { recordFailoverUsage } = require('../services/posFailoverMetering');
        const bytesDelta = req.body?.bytesDelta ?? req.body?.bytes_delta;
        const bytesTotal = req.body?.bytesTotal ?? req.body?.bytes_total ?? req.body?.bytesUsed;
        const result = await recordFailoverUsage(req.pool, {
            bytesDelta,
            bytesTotal,
            source: req.body?.source || 'register'
        });
        res.json({ success: true, ...result });
    } catch (e) {
        logger.error('POS failover usage report error:', e);
        res.status(500).json({ error: 'Failed to record failover usage' });
    }
});

router.get('/config', async (req, res) => {
    try {
        const [cashDiscount, store, security, payment, taxRate, operations, experience, cardCheckout, displayAds, paymentMethods, loyaltyProgram] =
            await Promise.all([
            loadCashDiscountSettings(req.pool),
            loadPosStoreConfig(req.pool),
            loadPosSecuritySettings(req.pool),
            loadPosPaymentConfig(req.pool),
            loadStoreTaxRate(req.pool),
            loadPosOperationsSettings(req.pool),
            loadPosRegisterExperienceSettings(req.pool),
            loadPosCardCheckoutSettings(req.pool),
            listDisplayAdsForRegister(req.pool, req.posDeviceRecordId),
            loadPosPaymentMethodsSettings(req.pool),
            loadLoyaltyProgramSettings(req.pool)
        ]);
        const receipt = await loadPosReceiptSettings(req.pool, store.storeLogoUrl);
        const storeHours = await loadStoreHours(req.pool);
        const license = await loadMerchantLicense(req.pool);
        const equipment = req.posDeviceRecordId
            ? await listEquipmentForRegister(req.pool, req.posDeviceRecordId)
            : [];
        const hardware = req.posDeviceRecordId
            ? await buildRegisterHardwareProfile(req.pool, req.posDeviceRecordId, {
                  globalCheckout: cardCheckout,
                  globalPrinter: experience.hardwarePrinter
              })
            : null;
        res.json({
            storeName: store.storeName,
            storeLogoUrl: store.storeLogoUrl,
            platformName: 'Business One',
            taxRate,
            currency: 'USD',
            paymentMethods: paymentMethods.methods,
            paymentMethodOptions: {
                cash: paymentMethods.cash,
                check: paymentMethods.check,
                card: paymentMethods.card
            },
            payment: {
                cardAdapter: payment.cardAdapter,
                cardAdapterLabel: payment.cardAdapterLabel,
                adapters: payment.adapters,
                driverScript: payment.driverScript,
                helperScript: payment.helperScript || '',
                customDriverUrl: payment.customDriverUrl,
                integrated: payment.integrated,
                serverCharge: payment.serverCharge,
                configured: payment.configured,
                configurationNote: payment.configurationNote,
                checkout: {
                    displayMode: cardCheckout.displayMode,
                    deploymentMode: cardCheckout.deploymentMode,
                    virtualTerminal: cardCheckout.virtualTerminal,
                    mxQuickPay: Boolean(cardCheckout.mxQuickPay),
                    nmiControlsTerminal: cardCheckout.nmiControlsTerminal,
                    displayCardCheckout: cardCheckout.displayCardCheckout,
                    hasPoiDeviceId: Boolean(hardware?.runtime?.poiDeviceId || cardCheckout.poiDeviceId)
                }
            },
            receipt,
            security: {
                sessionTimeoutMinutes: security.sessionTimeoutMinutes,
                pinMaxAttempts: security.pinMaxAttempts,
                pinLockoutMinutes: security.pinLockoutMinutes,
                signOutAfterSale: security.signOutAfterSale,
                requireManagerPinDiscounts: security.requireManagerPinDiscounts,
                requireManagerPinVoidRefund: security.requireManagerPinVoidRefund,
                maxLineDiscountPercent: security.maxLineDiscountPercent
            },
            promotions: {
                autoApplyAtRegister: true
            },
            cashDiscount: {
                enabled: cashDiscount.enabled,
                percent: cashDiscount.percent,
                disclosure:
                    'Prices shown include standard payment pricing. Pay with cash to receive the cash discount.'
            },
            loyalty: {
                enabled: loyaltyProgram.enabled,
                cashEnabled: loyaltyProgram.cashEnabled,
                pointsEnabled: loyaltyProgram.pointsEnabled,
                cashbackPercent: loyaltyProgram.cashbackPercent,
                pointsPerDollar: loyaltyProgram.pointsPerDollar,
                dollarPerPoint: loyaltyProgram.dollarPerPoint
            },
            compliance: payment.compliance,
            equipment,
            hardware,
            license: {
                status: license.status,
                licensedStationCount: license.licensedStationCount,
                activeStationLimit: license.licensedStationCount,
                monthlyFormatted: license.monthlyFormatted,
                licenseExpiresAt: license.licenseExpiresAt,
                enforcementEnabled: license.enforcementEnabled,
                writable: license.writable,
                inGracePeriod: license.inGracePeriod,
                graceEndsAt: license.graceEndsAt,
                isComped: license.isComped,
                serviceCompedUntil: license.serviceCompedUntil,
                pastDueOwed: license.pastDueOwed,
                billingPortalUrl: license.billingPortalUrl,
                warningMessage: license.warningMessage
            },
            support: {
                enabled: String(process.env.POS_REGISTER_SUPPORT_ENABLED ?? 'true').toLowerCase() !== 'false',
                platforms: ['windows', 'android'],
                heartbeatSeconds: Math.max(15, Number(process.env.POS_SUPPORT_HEARTBEAT_SECONDS) || 30),
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
                phone: operations.supportPhone,
                helpUrl: operations.helpUrl
            },
            operations: {
                catalogRefreshMinutes: operations.catalogRefreshMinutes,
                eodReminderEnabled: operations.eodReminderEnabled,
                eodReminderHour: operations.eodReminderHour,
                eodReminderMinute: operations.eodReminderMinute,
                supportPhone: operations.supportPhone,
                helpUrl: operations.helpUrl,
                shiftReportEmailTo: operations.dailySalesEmailTo || ''
            },
            experience: {
                largeTouchMode: experience.largeTouchMode,
                scanBeepEnabled: experience.scanBeepEnabled,
                displayStoreHoursIdle: experience.displayStoreHoursIdle,
                personnelMode: experience.personnelMode,
                showCostInCart: experience.showCostInCart,
                hardwarePrinter: hardware?.runtime?.printerDriver || experience.hardwarePrinter,
                displayCardCheckout: experience.displayCardCheckout
            },
            storeHours: {
                weekdays: storeHours.weekdays,
                saturday: storeHours.saturday,
                sunday: storeHours.sunday,
                lines: storeHourFooterLines(storeHours)
            },
            displayAds: (displayAds || []).map((ad) => ({
                id: ad.id,
                title: ad.title,
                subtitle: ad.subtitle,
                imageUrl: ad.imageUrl,
                linkUrl: ad.linkUrl
            }))
        });
    } catch (e) {
        logger.error('POS config error:', e);
        res.status(500).json({ error: 'Failed to load config' });
    }
});

router.get('/mobile-card-reader/models', authenticatePosEmployee, (_req, res) => {
    res.json({ models: listMobileCardReaderModels() });
});

router.get('/mobile-card-reader', authenticatePosEmployee, async (req, res) => {
    try {
        if (!req.posDeviceRecordId) {
            return res.status(400).json({ error: 'Register device record not found', code: 'INVALID_DEVICE' });
        }
        const reader = await getMobileCardReaderForRegister(req.pool, req.posDeviceRecordId);
        res.json({ reader, models: listMobileCardReaderModels() });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to load card reader' });
    }
});

router.put('/mobile-card-reader', authenticatePosEmployee, async (req, res) => {
    try {
        if (!req.posDeviceRecordId) {
            return res.status(400).json({ error: 'Register device record not found', code: 'INVALID_DEVICE' });
        }
        const equipment = await upsertMobileCardReaderForRegister(req.pool, req.posDeviceRecordId, req.body || {});
        const hardware = await buildRegisterHardwareProfile(req.pool, req.posDeviceRecordId, {
            globalCheckout: await loadPosCardCheckoutSettings(req.pool)
        });
        res.json({
            success: true,
            equipment,
            reader: {
                equipmentId: equipment.id,
                label: equipment.label,
                poiDeviceId: equipment.config?.poiDeviceId || '',
                catalogModelId: equipment.config?.catalogModelId || '',
                connection: equipment.config?.connection || '',
                serialNumber: equipment.serialNumber || ''
            },
            hardware
        });
    } catch (e) {
        const status =
            e.code === 'INVALID_POI' || e.code === 'INVALID_CONFIG' || e.code === 'SERIAL_REQUIRED'
                ? 400
                : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

function parsePosCost(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function withPosCost(includeCost, cost) {
    if (!includeCost) return {};
    const parsed = parsePosCost(cost);
    return parsed != null ? { cost: parsed } : {};
}

async function resolveIncludePosCost(req) {
    const experience = await loadPosRegisterExperienceSettings(req.pool);
    if (!experience.showCostInCart) return false;
    return Boolean(req.posEmployee?.canViewCost);
}

router.get('/catalog', attachOptionalPosEmployee, async (req, res) => {
    try {
        const includeCost = await resolveIncludePosCost(req);
        const since = req.query.since ? new Date(req.query.since) : null;
        const sinceValid = since && !Number.isNaN(since.getTime()) ? since : null;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
        const offset = (page - 1) * limit;

        let where = "p.is_active = 1 AND p.sku <> 'POS-CUSTOM'";
        const params = [];
        if (sinceValid) {
            where += ' AND p.updated_at >= ?';
            params.push(sinceValid);
        }

        const [countRows] = await req.pool.execute(
            `SELECT COUNT(DISTINCT p.id) AS total
             FROM products p
             LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
             WHERE ${where}`,
            params
        );
        const total = Number(countRows[0]?.total) || 0;

        const limitNum = Number(limit);
        const offsetNum = Number(offset);
        const [products] = await req.pool.execute(
            `SELECT p.id, p.sku, p.name, p.slug, p.price, p.cost_price, p.inventory_quantity, p.track_inventory,
                    p.is_taxable, p.updated_at, p.category_id,
                    pc.name AS category_name,
                    pi.image_url AS primary_image_url
             FROM products p
             LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.is_active = 1
             LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
             WHERE p.is_active = 1 AND p.sku <> 'POS-CUSTOM'
             ${sinceValid ? 'AND p.updated_at >= ?' : ''}
             ORDER BY p.id ASC
             LIMIT ${limitNum} OFFSET ${offsetNum}`,
            sinceValid ? [sinceValid] : []
        );

        const productIds = products.map((p) => p.id);
        let variants = [];
        if (productIds.length) {
            const placeholders = productIds.map(() => '?').join(',');
            const [variantRows] = await req.pool.execute(
                `SELECT id, product_id, sku, name, price, cost_price, inventory_quantity
                 FROM product_variants
                 WHERE is_active = 1 AND product_id IN (${placeholders})`,
                productIds
            );
            variants = variantRows;
        }

        const variantsByProduct = variants.reduce((acc, v) => {
            if (!acc[v.product_id]) acc[v.product_id] = [];
            acc[v.product_id].push({
                id: v.id,
                sku: v.sku,
                name: v.name,
                price: Number(v.price),
                inventoryQuantity: Number(v.inventory_quantity) || 0,
                ...(includeCost && v.cost_price != null
                    ? withPosCost(true, v.cost_price)
                    : {}),
            });
            return acc;
        }, {});

        res.json({
            page,
            limit,
            total,
            syncedAt: new Date().toISOString(),
            products: products.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                slug: p.slug,
                price: Number(p.price),
                inventoryQuantity: Number(p.inventory_quantity) || 0,
                trackInventory: Boolean(p.track_inventory),
                isTaxable: Boolean(p.is_taxable),
                updatedAt: p.updated_at,
                categoryId: p.category_id ? Number(p.category_id) : null,
                categoryName: p.category_name || null,
                imageUrl:
                    storefrontPrimaryImageFromFields({
                        slug: p.slug,
                        sku: p.sku,
                        primaryImageUrl: p.primary_image_url
                    }) || null,
                variants: variantsByProduct[p.id] || [],
                ...withPosCost(includeCost, p.cost_price)
            }))
        });
    } catch (error) {
        logger.error('POS catalog error:', error);
        res.status(500).json({ error: 'Failed to load catalog' });
    }
});

router.get('/categories', async (req, res) => {
    try {
        const [rows] = await req.pool.execute(
            `SELECT pc.id, pc.name, pc.slug, pc.image_url, pc.description, pc.parent_id,
                    COALESCE(dp.direct_count, 0) AS direct_count,
                    COALESCE(cp.child_count, 0) AS child_count
             FROM product_categories pc
             LEFT JOIN (
                SELECT category_id, COUNT(*) AS direct_count
                  FROM products
                 WHERE is_active = 1
                 GROUP BY category_id
             ) dp ON dp.category_id = pc.id
             LEFT JOIN (
                SELECT c.parent_id, COUNT(p.id) AS child_count
                  FROM product_categories c
                  INNER JOIN products p ON p.category_id = c.id AND p.is_active = 1
                 WHERE c.is_active = 1 AND c.parent_id IS NOT NULL
                 GROUP BY c.parent_id
             ) cp ON cp.parent_id = pc.id
             WHERE pc.is_active = 1
               AND (COALESCE(dp.direct_count, 0) + COALESCE(cp.child_count, 0) > 0)
             ORDER BY pc.sort_order ASC, pc.name ASC`
        );
        const [uncatRows] = await req.pool.execute(
            `SELECT COUNT(*) AS product_count FROM products
             WHERE is_active = 1 AND (category_id IS NULL OR category_id = 0)`
        );
        const uncategorized = Number(uncatRows[0]?.product_count) || 0;
        const categories = (rows || []).map((row) => {
            const direct = Number(row.direct_count) || 0;
            const child = Number(row.child_count) || 0;
            return {
                id: Number(row.id),
                name: row.name,
                slug: row.slug,
                description: row.description || null,
                imageUrl: row.image_url || null,
                parentId: row.parent_id != null ? Number(row.parent_id) : null,
                directProductCount: direct,
                childProductCount: child,
                productCount: direct + child,
                hasChildren: child > 0,
            };
        });
        if (uncategorized > 0) {
            const supplementsId = categories.find((c) => c.slug === 'supplements')?.id ?? null;
            categories.push({
                id: 0,
                name: 'Other',
                slug: 'other',
                description: null,
                imageUrl: null,
                parentId: supplementsId,
                directProductCount: uncategorized,
                childProductCount: 0,
                productCount: uncategorized,
                hasChildren: false,
            });
            const supplements = categories.find((c) => c.slug === 'supplements');
            if (supplements) {
                supplements.hasChildren = true;
                supplements.childProductCount = (supplements.childProductCount || 0) + uncategorized;
                supplements.productCount =
                    (supplements.directProductCount || 0) + supplements.childProductCount;
            }
        }
        res.json({ categories });
    } catch (error) {
        logger.error('POS categories error:', error);
        res.status(500).json({ error: 'Failed to load categories' });
    }
});

router.get('/products/lookup', attachOptionalPosEmployee, async (req, res) => {
    try {
        const includeCost = await resolveIncludePosCost(req);
        const q = String(req.query.q || req.query.sku || '').trim();
        if (!q) {
            return res.status(400).json({ error: 'Search query required (q or sku)' });
        }

        const [variantHits] = await req.pool.execute(
            `SELECT pv.id AS variant_id, pv.sku, pv.name AS variant_name, pv.price AS variant_price,
                    pv.inventory_quantity AS variant_inventory,
                    COALESCE(pv.cost_price, p.cost_price) AS effective_cost_price,
                    p.id, p.sku AS product_sku, p.name, p.slug, p.price, p.cost_price, p.inventory_quantity,
                    p.track_inventory, p.is_taxable,
                    pi.image_url AS primary_image_url
             FROM product_variants pv
             JOIN products p ON p.id = pv.product_id
             LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
             WHERE pv.is_active = 1 AND p.is_active = 1 AND p.sku <> 'POS-CUSTOM'
               AND (pv.sku = ? OR p.sku = ?)
             LIMIT 5`,
            [q, q]
        );

        if (variantHits.length) {
            return res.json({
                matches: variantHits.map((row) => ({
                    productId: row.id,
                    variantId: row.variant_id,
                    sku: row.sku,
                    name: `${row.name} — ${row.variant_name}`,
                    price: Number(row.variant_price),
                    inventoryQuantity: Number(row.variant_inventory) || 0,
                    trackInventory: Boolean(row.track_inventory),
                    isTaxable: Boolean(row.is_taxable),
                    imageUrl:
                        storefrontPrimaryImageFromFields({
                            slug: row.slug,
                            sku: row.sku,
                            primaryImageUrl: row.primary_image_url
                        }) || null,
                    ...withPosCost(includeCost, row.effective_cost_price)
                }))
            });
        }

        const [productHits] = await req.pool.execute(
            `SELECT p.id, p.sku, p.name, p.slug, p.price, p.cost_price, p.inventory_quantity, p.track_inventory, p.is_taxable,
                    pi.image_url AS primary_image_url
             FROM products p
             LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
             WHERE p.is_active = 1 AND p.sku <> 'POS-CUSTOM' AND (p.sku = ? OR p.name LIKE ?)
             ORDER BY CASE WHEN p.sku = ? THEN 0 ELSE 1 END, p.name ASC
             LIMIT 10`,
            [q, `%${q}%`, q]
        );

        res.json({
            matches: productHits.map((row) => ({
                productId: row.id,
                variantId: null,
                sku: row.sku,
                name: row.name,
                price: Number(row.price),
                inventoryQuantity: Number(row.inventory_quantity) || 0,
                trackInventory: Boolean(row.track_inventory),
                isTaxable: Boolean(row.is_taxable),
                imageUrl:
                    storefrontPrimaryImageFromFields({
                        slug: row.slug,
                        sku: row.sku,
                        primaryImageUrl: row.primary_image_url
                    }) || null,
                ...withPosCost(includeCost, row.cost_price)
            }))
        });
    } catch (error) {
        logger.error('POS product lookup error:', error);
        res.status(500).json({ error: 'Product lookup failed' });
    }
});

router.post('/cart/pricing', authenticatePosEmployee, async (req, res) => {
    try {
        const body = req.body || {};
        const lineItems = Array.isArray(body.items) ? body.items : [];
        if (!lineItems.length) {
            return res.json({
                ok: true,
                lines: [],
                totals: { subtotal: 0, cartDiscountAmount: 0, taxAmount: 0, total: 0 },
                appliedPromotions: [],
                allowManualDiscounts: false
            });
        }

        const allowManualDiscounts = Boolean(req.posEmployee?.allowManualDiscounts);
        const manualCartDiscountPercent = allowManualDiscounts
            ? Math.min(100, Math.max(0, Number(body.cartDiscountPercent ?? body.cart_discount_percent) || 0))
            : 0;

        const customerId = Number(body.customerId ?? body.customer_id ?? body.userId ?? body.user_id);
        const customerUser =
            Number.isInteger(customerId) && customerId > 0
                ? await resolveCustomerUser(req.pool, customerId)
                : null;

        const taxExempt = Boolean(body.taxExempt || body.tax_exempt || customerUser?.tax_exempt);
        const taxRate = taxExempt ? 0 : await loadStoreTaxRate(req.pool);

        const catalogLines = await loadCatalogLines(req.pool, lineItems);
        const preCartSubtotal = merchandiseSubtotal(catalogLines);
        const promoPricing = await pricePosCart(req.pool, {
            catalogLines,
            customerUser,
            taxExempt,
            taxRate,
            allowManualDiscounts,
            manualCartDiscountPercent
        });

        let effectivePct = 0;
        if (preCartSubtotal > 0 && promoPricing.cartDiscountAmount > 0) {
            effectivePct = Math.min(100, (promoPricing.cartDiscountAmount / preCartSubtotal) * 100);
        }

        const cashSettings = await loadCashDiscountSettings(req.pool);
        const pricedLines = applyCartDiscountToEnriched(catalogLines, effectivePct);
        const pricing = computeDualPricing(
            pricedLines,
            taxRate,
            cashSettings.enabled ? cashSettings.percent : 0
        );

        res.json({
            ok: true,
            allowManualDiscounts,
            appliedPromotions: promoPricing.appliedPromotions || [],
            discountLabel: promoPricing.cartDiscountLabel || null,
            promoCode: promoPricing.promotion?.code || null,
            lines: catalogLines.map((line) => ({
                productId: line.product_id,
                variantId: line.variant_id,
                sku: line.sku,
                name: line.name,
                quantity: line.quantity,
                catalogUnitPrice: line.catalogUnitPrice,
                unitPrice: line.unitPrice,
                lineDiscountPercent: line.lineDiscountPercent || 0
            })),
            totals: {
                preCartSubtotal,
                subtotal: pricing.card.subtotal,
                cartDiscountPercent: effectivePct,
                cartDiscountAmount: promoPricing.cartDiscountAmount,
                taxAmount: pricing.card.taxAmount,
                total: pricing.card.totalAmount,
                cashTotal: pricing.cash?.totalAmount ?? pricing.card.totalAmount
            }
        });
    } catch (error) {
        logger.error('POS cart pricing error:', error);
        res.status(500).json({ error: error.message || 'Cart pricing failed' });
    }
});

// --- Customer profiles (shared with website gift cards & loyalty) ---

router.get('/customers/search', authenticatePosEmployee, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        const phone = String(req.query.phone || '').trim();
        const searchTerm = phone || q;
        if (searchTerm.length < 2) {
            return res.json({ customers: [] });
        }
        const customers = await posCustomerService.searchCustomers(req.pool, searchTerm, req.query.limit);
        res.json({ customers });
    } catch (error) {
        logger.error('POS customer search error:', error);
        res.status(500).json({ error: 'Customer search failed' });
    }
});

router.get('/customers/:id', authenticatePosEmployee, async (req, res) => {
    try {
        const customer = await posCustomerService.getCustomerForPos(req.pool, Number(req.params.id));
        res.json({ customer });
    } catch (error) {
        const code = error.code || 'CUSTOMER_LOAD_FAILED';
        res.status(code === 'CUSTOMER_NOT_FOUND' ? 404 : 500).json({
            error: error.message || 'Failed to load customer',
            code
        });
    }
});

router.post('/customers/quick-enroll', authenticatePosEmployee, async (req, res) => {
    try {
        const customer = await posCustomerService.quickEnrollCustomer(req.pool, req.body || {});
        res.status(201).json({ success: true, customer });
    } catch (error) {
        const code = error.code || 'ENROLL_FAILED';
        const statusMap = {
            NAME_REQUIRED: 400,
            CONTACT_REQUIRED: 400,
            EMAIL_EXISTS: 409,
            PHONE_FORMAT: 400
        };
        res.status(statusMap[code] || 400).json({
            error: error.message || 'Could not create customer',
            code
        });
    }
});

router.patch('/customers/:id/tax-exempt', authenticatePosEmployee, async (req, res) => {
    try {
        const customer = await posCustomerService.updateCustomerTaxExempt(req.pool, Number(req.params.id), req.body || {});
        res.json({ success: true, customer });
    } catch (error) {
        const code = error.code || 'TAX_EXEMPT_UPDATE_FAILED';
        const statusMap = {
            CUSTOMER_NOT_FOUND: 404,
            TAX_EXEMPT_ID_REQUIRED: 400
        };
        res.status(statusMap[code] || 400).json({
            error: error.message || 'Could not update tax exempt status',
            code
        });
    }
});

router.post('/customers/gift-cards/check', authenticatePosEmployee, async (req, res) => {
    try {
        const body = req.body || {};
        const result = await posCustomerService.checkGiftCardBalance(req.pool, {
            code: body.code,
            pin: body.pin,
            giftCardId: body.giftCardId ?? body.gift_card_id,
            userId: body.userId ?? body.user_id ?? body.customerId ?? body.customer_id,
            staffLookup: true
        });
        res.json({ success: true, ...result });
    } catch (error) {
        const code = error.code || 'GIFT_CARD_CHECK_FAILED';
        const statusMap = {
            GIFT_CARD_NOT_FOUND: 404,
            GIFT_CARD_INVALID_PIN: 403,
            GIFT_CARD_INACTIVE: 400,
            GIFT_CARD_EXPIRED: 400,
            GIFT_CARD_CODE_REQUIRED: 400
        };
        res.status(statusMap[code] || 400).json({
            error: error.message || 'Gift card check failed',
            code
        });
    }
});

router.post('/print/receipt', authenticatePosEmployee, async (req, res) => {
    try {
        const lines = req.body?.lines;
        const openDrawer = Boolean(req.body?.openDrawer);
        const copyCount = Math.min(3, Math.max(0, parseInt(req.body?.copyCount, 10) || 1));
        if (!openDrawer && (!Array.isArray(lines) || !lines.length)) {
            return res.status(400).json({ error: 'Receipt lines are required', code: 'PRINT_LINES_REQUIRED' });
        }

        const [experience, cardCheckout] = await Promise.all([
            loadPosRegisterExperienceSettings(req.pool),
            loadPosCardCheckoutSettings(req.pool)
        ]);
        const hardware = await buildRegisterHardwareProfile(req.pool, req.posDeviceRecordId, {
            globalCheckout: cardCheckout,
            globalPrinter: experience.hardwarePrinter
        });
        const runtime = hardware?.runtime || {};
        const driver = String(runtime.printerDriver || 'browser').toLowerCase();
        if (driver === 'browser' || driver === 'elo_star' || driver === 'star_android') {
            return res.status(400).json({
                error: 'This register is not configured for network receipt printing.',
                code: 'PRINTER_NOT_NETWORK'
            });
        }

        const result = await printEscposReceipt({
            host: runtime.printerAddress,
            port: runtime.printerPort,
            lines: Array.isArray(lines) ? lines : [],
            copyCount: openDrawer && !lines?.length ? 0 : copyCount,
            openDrawer
        });
        res.json({ ok: true, ...result, method: 'network' });
    } catch (e) {
        logger.error('POS receipt print error:', e);
        res.status(502).json({
            error: e.message || 'Could not print receipt',
            code: 'PRINT_FAILED'
        });
    }
});

router.post('/orders', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const result = await createInStorePosOrder(req.pool, req.body, req.posDeviceId, req.posEmployee.id);
        res.status(result.duplicate ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
        logger.error('POS create order error:', error);
        const code = error.code || 'ORDER_FAILED';
        const statusMap = {
            EMPTY_CART: 400,
            INVALID_PAYMENT: 400,
            INVALID_PAYMENT_METHOD: 400,
            PAYMENT_METHOD_DISABLED: 400,
            TERMINAL_LAST_FOUR_REQUIRED: 400,
            TERMINAL_LAST_FOUR_INVALID: 400,
            TERMINAL_APPROVAL_REQUIRED: 400,
            CARD_DATA_NOT_ALLOWED: 400,
            EMPLOYEE_AUTH_REQUIRED: 401,
            EMPLOYEE_MISMATCH: 403,
            PRODUCT_NOT_FOUND: 404,
            INVALID_LINE_QUANTITY: 400,
            TAX_EXEMPT_REASON_REQUIRED: 400,
            MANUAL_DISCOUNT_DISABLED: 403,
            MANAGER_PIN_REQUIRED: 403,
            INVALID_MANAGER_PIN: 403,
            NOT_AUTHORIZED_MANAGER: 403,
            CUSTOMER_NOT_FOUND: 404,
            CUSTOMER_REQUIRED_FOR_LOYALTY: 400,
            INSUFFICIENT_LOYALTY_POINTS: 400,
            INSUFFICIENT_LOYALTY_CASH: 400,
            LOYALTY_NOT_ENROLLED: 400,
            LOYALTY_DISABLED: 400,
            GIFT_CARD_NOT_FOUND: 404,
            GIFT_CARD_INVALID_PIN: 403,
            GIFT_CARD_INACTIVE: 400,
            GIFT_CARD_EXPIRED: 400,
            INSUFFICIENT_GIFT_CARD_BALANCE: 400,
            INVALID_GIFT_CARD_AMOUNT: 400,
            GIFT_CARD_CODE_REQUIRED: 400,
            INSUFFICIENT_CASH_TENDER: 400,
            TENDER_TOTAL_MISMATCH: 400,
            PAYMENT_REQUIRED: 400,
            REFUND_REASON_REQUIRED: 400,
            ORDER_NOT_FOUND: 404,
            ORDER_NOT_POS: 400,
            ORDER_ALREADY_REFUNDED: 409,
            ORDER_NOT_REFUNDABLE: 400
        };
        res.status(statusMap[code] || 500).json({
            error: error.message || 'Failed to create order',
            code
        });
    }
});

async function handleListPosSales(req, res) {
    try {
        const result = await listInStorePosSales(req.pool, {
            date: req.query.date,
            q: req.query.q,
            limit: req.query.limit,
            offset: req.query.offset
        });
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('POS list sales error:', error);
        res.status(500).json({ error: error.message || 'Failed to load sales' });
    }
}

async function handlePosOrderReceipt(req, res) {
    try {
        const receipt = await getInStorePosOrderReceipt(req.pool, req.params.orderNumber);
        res.json({ success: true, receipt });
    } catch (error) {
        const code = error.code || 'RECEIPT_FAILED';
        const statusMap = {
            ORDER_NUMBER_REQUIRED: 400,
            ORDER_NOT_FOUND: 404,
            ORDER_NOT_POS: 400
        };
        res.status(statusMap[code] || 500).json({
            error: error.message || 'Failed to load receipt',
            code
        });
    }
}

const listPosSalesRoute = [authenticatePosEmployee, requireActivePosLicense, handleListPosSales];
const posOrderReceiptRoute = [authenticatePosEmployee, requireActivePosLicense, handlePosOrderReceipt];

router.get('/sales', ...listPosSalesRoute);
/** @deprecated use GET /sales — kept for cached POS clients */
router.get('/orders', ...listPosSalesRoute);

router.get('/sales/:orderNumber/receipt', ...posOrderReceiptRoute);
/** @deprecated use GET /sales/:orderNumber/receipt */
router.get('/orders/:orderNumber/receipt', ...posOrderReceiptRoute);

router.post('/sync', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const sales = Array.isArray(req.body?.sales) ? req.body.sales : [];
        if (!sales.length) {
            return res.status(400).json({ error: 'No sales to sync', code: 'EMPTY_BATCH' });
        }
        if (sales.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 sales per sync batch', code: 'BATCH_TOO_LARGE' });
        }
        const results = await syncPosOrderBatch(req.pool, sales, req.posDeviceId, req.posEmployee.id);
        const failed = results.filter((r) => !r.success).length;
        res.json({
            success: failed === 0,
            synced: results.filter((r) => r.success).length,
            failed,
            results
        });
    } catch (error) {
        logger.error('POS sync batch error:', error);
        res.status(500).json({ error: 'Sync failed' });
    }
});

// --- Employee auth & personnel (Phase 2+) ---

router.post('/employees/login', posPinLimiter, async (req, res) => {
    try {
        const pin = req.body?.pin;
        const result = await personnel.loginWithPin(req.pool, pin, {
            deviceId: req.posDeviceId,
            ip: req.ip
        });
        res.json({ success: true, ...result });
    } catch (e) {
        const status =
            e.code === 'PIN_LOCKED' || e.code === 'PIN_RATE_LIMITED'
                ? 429
                : e.code === 'INVALID_PIN'
                  ? 401
                  : 400;
        res.status(status).json({
            error: e.message,
            code: e.code,
            lockedUntil: e.lockedUntil || null
        });
    }
});

router.post('/admin/handoff', authenticatePosEmployee, async (req, res) => {
    try {
        const employee = await personnel.getEmployeeById(req.pool, req.posEmployee.id);
        if (!employee?.admin_user_id) {
            return res.status(403).json({
                error: 'This employee is not linked to an admin account.',
                code: 'ADMIN_ACCESS_DENIED'
            });
        }
        const hasAccess = await personnel.employeeHasAdminAccess(req.pool, employee);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'Linked admin account is not active.',
                code: 'ADMIN_ACCESS_DENIED'
            });
        }
        const { code } = await createHandoffCode(req.pool, employee.id, employee.admin_user_id);
        const base = publicStoreBaseUrl(req);
        res.json({
            success: true,
            adminUrl: `${base}/admin.html?pos_handoff=${encodeURIComponent(code)}`
        });
    } catch (error) {
        logger.error('POS admin handoff error:', error);
        res.status(500).json({ error: 'Could not open admin session' });
    }
});

router.post('/manager/verify-pin', authenticatePosEmployee, posPinLimiter, async (req, res) => {
    try {
        const pin = req.body?.pin;
        const purpose = String(req.body?.purpose || 'manager');
        const context = {
            deviceId: req.posDeviceId,
            ip: req.ip,
            scope: purpose
        };
        const authorizer =
            purpose === 'refund'
                ? await personnel.verifyRefundPin(req.pool, pin, context)
                : await personnel.verifyManagerPin(req.pool, pin, context);
        res.json({ success: true, authorizer });
    } catch (e) {
        const status =
            e.code === 'PIN_LOCKED' || e.code === 'PIN_RATE_LIMITED'
                ? 429
                : e.code === 'INVALID_PIN' || e.code === 'INVALID_MANAGER_PIN' || e.code === 'NOT_AUTHORIZED_MANAGER' || e.code === 'NOT_AUTHORIZED_REFUND'
                  ? 403
                  : 400;
        res.status(status).json({ error: e.message, code: e.code || 'MANAGER_PIN_FAILED' });
    }
});

router.post('/orders/:orderNumber/refund', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const result = await refundInStorePosOrder(
            req.pool,
            req.params.orderNumber,
            req.body,
            req.posEmployee.id,
            req.posDeviceId,
            { ip: req.ip }
        );
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('POS refund error:', error);
        const code = error.code || 'REFUND_FAILED';
        const statusMap = {
            MANAGER_PIN_REQUIRED: 403,
            INVALID_MANAGER_PIN: 403,
            NOT_AUTHORIZED_MANAGER: 403,
            NOT_AUTHORIZED_REFUND: 403,
            REFUND_REASON_REQUIRED: 400,
            ORDER_NOT_FOUND: 404,
            ORDER_NOT_POS: 400,
            ORDER_ALREADY_REFUNDED: 409,
            ORDER_NOT_REFUNDABLE: 400
        };
        res.status(statusMap[code] || 500).json({
            error: error.message || 'Failed to process refund',
            code
        });
    }
});

router.get('/employees/me', authenticatePosEmployee, async (req, res) => {
    try {
        const employee = await personnel.getEmployeeById(req.pool, req.posEmployee.id);
        if (!employee) return res.status(404).json({ error: 'Employee not found' });
        res.json({
            employee: {
                id: employee.id,
                employeeCode: employee.employee_code,
                firstName: employee.first_name,
                lastName: employee.last_name,
                name: `${employee.first_name} ${employee.last_name}`.trim(),
                canAuthorize: Boolean(employee.can_authorize),
                canProcessRefunds: Boolean(employee.can_process_refunds),
                canOpenDrawer: Boolean(employee.can_open_drawer),
                allowManualDiscounts: personnel.employeeAllowManualDiscounts(employee),
                canViewCost: personnel.employeeCanViewCost(employee)
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load employee profile' });
    }
});

router.post('/timesheet/clock-in', authenticatePosEmployee, async (req, res) => {
    try {
        const shiftSessionId = req.body?.shiftSessionId ? Number(req.body.shiftSessionId) : null;
        const id = await personnel.clockIn(req.pool, req.posEmployee.id, shiftSessionId);
        res.json({ success: true, timeEntryId: id });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/timesheet/clock-out', authenticatePosEmployee, async (req, res) => {
    try {
        const id = await personnel.clockOut(req.pool, req.posEmployee.id);
        res.json({ success: true, timeEntryId: id });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.get('/timesheet/current', authenticatePosEmployee, async (req, res) => {
    try {
        const entry = await personnel.getOpenTimeEntry(req.pool, req.posEmployee.id);
        if (!entry) return res.json({ clockedIn: false, entry: null });
        res.json({
            clockedIn: true,
            entry: {
                id: entry.id,
                clockIn: entry.clock_in,
                shiftSessionId: entry.shift_session_id
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load timesheet status' });
    }
});

router.get('/shift/current', authenticatePosEmployee, async (req, res) => {
    try {
        const shift = await personnel.getOpenShiftSession(req.pool, req.posEmployee.id, req.posDeviceId);
        if (!shift) return res.json({ shift: null });
        const expected = await personnel.computeExpectedCash(req.pool, shift);
        res.json({ shift, expectedCash: expected });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load current shift' });
    }
});

router.post('/shift/open', authenticatePosEmployee, async (req, res) => {
    try {
        const shift = await personnel.openShiftSession(req.pool, {
            employeeId: req.posEmployee.id,
            deviceId: req.posDeviceId,
            openingCash: req.body?.openingCash,
            scheduledShiftId: req.body?.scheduledShiftId ? Number(req.body.scheduledShiftId) : null
        });
        await personnel.clockIn(req.pool, req.posEmployee.id, shift.id).catch(() => {});
        res.status(201).json({ shift });
    } catch (e) {
        res.status(e.code === 'SHIFT_ALREADY_OPEN' ? 409 : 400).json({
            error: e.message,
            code: e.code,
            shiftSessionId: e.shiftSessionId
        });
    }
});

router.post('/shift/cash-event', authenticatePosEmployee, async (req, res) => {
    try {
        const shiftSessionId = Number(req.body?.shiftSessionId);
        const eventType = String(req.body?.eventType || '').trim();
        if (!['paid_out', 'drop', 'cash_in'].includes(eventType)) {
            return res.status(400).json({ error: 'Invalid event type' });
        }
        const id = await personnel.addCashDrawerEvent(req.pool, {
            shiftSessionId,
            eventType,
            amount: req.body?.amount,
            reason: req.body?.reason,
            employeeId: req.posEmployee.id
        });
        res.json({ success: true, eventId: id });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/shift/close', authenticatePosEmployee, async (req, res) => {
    try {
        const shift = await personnel.closeShiftSession(req.pool, {
            shiftSessionId: Number(req.body?.shiftSessionId),
            closingCash: req.body?.closingCash,
            notes: req.body?.notes,
            employeeId: req.posEmployee.id
        });
        await personnel.clockOut(req.pool, req.posEmployee.id).catch(() => {});
        const report = await personnel.getShiftReport(req.pool, shift.id);
        res.json({ success: true, shift, report });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.get('/shifts/scheduled', authenticatePosEmployee, async (req, res) => {
    try {
        const shifts = await personnel.listScheduledShifts(req.pool, {
            employeeId: req.posEmployee.id,
            from: req.query.from,
            to: req.query.to
        });
        res.json({ shifts });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load scheduled shifts' });
    }
});

router.get('/reports/shift/:id', authenticatePosEmployee, async (req, res) => {
    try {
        const report = await personnel.getShiftReport(req.pool, Number(req.params.id), {
            employeeId: req.posEmployee.id
        });
        if (!report) return res.status(404).json({ error: 'Shift not found' });
        res.json(report);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load shift report' });
    }
});

const posSalesReports = require('../services/posSalesReports');

router.get('/reports/x', authenticatePosEmployee, async (req, res) => {
    try {
        const shift = await personnel.getOpenShiftSession(req.pool, req.posEmployee.id, req.posDeviceId);
        if (!shift) {
            return res.status(404).json({ error: 'No open shift', code: 'NO_OPEN_SHIFT' });
        }
        const report = await posSalesReports.buildXReport(req.pool, shift.id);
        res.json({ success: true, report });
    } catch (e) {
        res.status(e.code === 'SHIFT_NOT_OPEN' ? 400 : 500).json({
            error: e.message || 'Failed to build current shift summary',
            code: e.code || 'X_REPORT_FAILED'
        });
    }
});

router.get('/reports/z/:id', authenticatePosEmployee, async (req, res) => {
    try {
        const report = await posSalesReports.buildZReport(req.pool, Number(req.params.id));
        if (!report) return res.status(404).json({ error: 'Shift not found' });
        res.json({ success: true, report });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to build end-of-shift summary' });
    }
});

const { sendShiftReportEmail } = require('../services/posShiftReportEmail');

router.post('/reports/z/:id/email', authenticatePosEmployee, async (req, res) => {
    try {
        const shiftId = Number(req.params.id);
        const email = String(req.body?.email || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A valid email address is required', code: 'INVALID_EMAIL' });
        }
        const report = await posSalesReports.buildZReport(req.pool, shiftId);
        if (!report) return res.status(404).json({ error: 'Shift not found' });
        const result = await sendShiftReportEmail(req.pool, report, email);
        if (!result.sent) {
            const code = result.reason === 'smtp_not_configured' ? 'SMTP_NOT_CONFIGURED' : 'EMAIL_FAILED';
            const message =
                result.reason === 'smtp_not_configured'
                    ? 'Email is not configured on this store server (SMTP).'
                    : 'Could not send email';
            return res.status(result.reason === 'smtp_not_configured' ? 503 : 400).json({ error: message, code });
        }
        res.json({ success: true, sent: true, to: result.to, filename: result.filename });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to email shift report' });
    }
});

router.get('/reports/day', authenticatePosEmployee, async (req, res) => {
    try {
        const date = String(req.query.date || '').slice(0, 10) || posSalesReports.localDateKey();
        const report = await posSalesReports.getDaySalesSummary(req.pool, date);
        res.json({ success: true, report });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to build daily sales summary' });
    }
});

router.put('/display', async (req, res) => {
    try {
        const incoming = req.body && typeof req.body === 'object' ? req.body : {};
        const deviceId = req.posDeviceId;
        const [rows] = await req.pool.execute(
            'SELECT payload FROM pos_display_snapshots WHERE device_id = ? LIMIT 1',
            [deviceId]
        );
        let existing = {};
        if (rows[0]?.payload) {
            try {
                existing =
                    typeof rows[0].payload === 'string'
                        ? JSON.parse(rows[0].payload)
                        : rows[0].payload;
            } catch {
                existing = {};
            }
        }
        const payload = {
            ...existing,
            ...incoming,
            checkout:
                incoming.checkout !== undefined ? incoming.checkout : existing.checkout || { phase: 'idle' }
        };
        await req.pool.execute(
            `INSERT INTO pos_display_snapshots (device_id, payload) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
            [deviceId, JSON.stringify(payload)]
        );
        res.json({ success: true });
    } catch (e) {
        logger.error('POS display push error:', e);
        res.status(500).json({ error: 'Failed to update display' });
    }
});

router.get('/display', async (req, res) => {
    try {
        const deviceId = String(req.posDeviceId || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
        const [rows] = await req.pool.execute(
            'SELECT payload, updated_at FROM pos_display_snapshots WHERE device_id = ? LIMIT 1',
            [deviceId]
        );
        if (!rows.length) {
            return res.json({ status: 'idle', lines: [], card: null, cash: null, checkout: { phase: 'idle' }, updatedAt: null });
        }
        let payload = rows[0].payload;
        if (typeof payload === 'string') {
            try {
                payload = JSON.parse(payload);
            } catch {
                payload = {};
            }
        }
        res.json({ ...payload, updatedAt: rows[0].updated_at });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load display' });
    }
});

router.get('/display/ads', async (req, res) => {
    try {
        const ads = await listDisplayAdsForRegister(req.pool, req.posDeviceRecordId);
        res.json({
            ads: (ads || []).map((ad) => ({
                id: ad.id,
                title: ad.title,
                subtitle: ad.subtitle,
                imageUrl: ad.imageUrl,
                linkUrl: ad.linkUrl
            }))
        });
    } catch (e) {
        logger.error('POS display ads error:', e);
        res.status(500).json({ error: 'Failed to load display ads' });
    }
});

router.post('/checkout-intents', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const amount = Number(req.body?.amount);
        const cart = req.body?.cart && typeof req.body.cart === 'object' ? req.body.cart : {};
        const intent = await createCheckoutIntent(req.pool, {
            deviceId: req.posDeviceId,
            deviceRecordId: req.posDeviceRecordId,
            amount,
            cart,
            employeeId: req.posEmployee?.id
        });
        res.status(201).json({ intent });
    } catch (e) {
        const status =
            e.code === 'INVALID_AMOUNT' || e.code === 'CHECKOUT_DISABLED' ? 400 : e.code === 'CARD_DECLINED' ? 402 : 500;
        res.status(status).json({ error: e.message, code: e.code, intent: e.data?.intent || null });
    }
});

router.post('/checkout-intents/:id/charge-terminal', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const intent = await chargeTerminalCheckoutIntent(req.pool, req.params.id, {
            deviceId: req.posDeviceId,
            deviceRecordId: req.posDeviceRecordId
        });
        res.json({ success: true, intent });
    } catch (e) {
        const status =
            e.code === 'NOT_FOUND'
                ? 404
                : e.code === 'INVALID_STATE' || e.code === 'EXPIRED' || e.code === 'TERMINAL_NOT_CONFIGURED'
                  ? 400
                  : e.code === 'CARD_DECLINED'
                    ? 402
                    : 500;
        res.status(status).json({
            error: e.message,
            code: e.code,
            intent: e.data?.intent || null
        });
    }
});

router.get('/checkout-intents/:id', authenticatePosEmployee, async (req, res) => {
    try {
        const intent = await getCheckoutIntent(req.pool, req.params.id);
        if (!intent || intent.deviceId !== req.posDeviceId) {
            return res.status(404).json({ error: 'Checkout not found', code: 'NOT_FOUND' });
        }
        res.json({ intent });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to load checkout' });
    }
});

router.post('/checkout-intents/:id/cancel', authenticatePosEmployee, async (req, res) => {
    try {
        const intent = await cancelCheckoutIntent(req.pool, req.params.id, req.posDeviceId);
        if (!intent) return res.status(404).json({ error: 'Checkout not found', code: 'NOT_FOUND' });
        res.json({ intent });
    } catch (e) {
        const status = e.code === 'NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/checkout-intents/:id/pay', authenticatePosEmployee, requireActivePosLicense, async (req, res) => {
    try {
        const intent = await completeCheckoutIntent(req.pool, req.params.id, {
            paymentToken: req.body?.paymentToken || req.body?.payment_token,
            mxPaymentId: req.body?.mxPaymentId || req.body?.mx_payment_id,
            deviceId: req.posDeviceId
        });
        res.json({ success: true, intent });
    } catch (e) {
        const status =
            e.code === 'NOT_FOUND'
                ? 404
                : e.code === 'TOKEN_REQUIRED' ||
                    e.code === 'INVALID_STATE' ||
                    e.code === 'EXPIRED' ||
                    e.code === 'TERMINAL_ONLY' ||
                    e.code === 'PROCESSOR_NOT_CONFIGURED'
                  ? 400
                  : e.code === 'CARD_DECLINED'
                    ? 402
                    : 500;
        res.status(status).json({
            error: e.message,
            code: e.code,
            intent: e.data?.intent || null
        });
    }
});

router.get('/payments/nmi-client-config', async (req, res) => {
    try {
        const checkout = await loadPosCardCheckoutSettings(req.pool);
        const posProcessor = await loadPosPaymentProcessor(req.pool);
        const creds = resolvePosProcessorCredentials(posProcessor);
        const tokenizationKey = creds.publicKey || '';
        const basePayload = {
            processor: creds.processor,
            processorLabel: creds.label,
            tokenizationKey: '',
            collectJsUrl: creds.collectJsUrl || getPosNmiCollectJsUrl(),
            disableWallets: isNmiWalletsDisabled(),
            accountScope: 'pos',
            sandbox: Boolean(creds.sandbox),
            deploymentMode: checkout.deploymentMode,
            displayMode: checkout.displayMode,
            terminalOnly: checkout.displayMode === 'nmi_terminal'
        };

        if (checkout.displayMode !== 'collect_js') {
            return res.json({ ...basePayload, enabled: false, terminalOnly: true });
        }
        if (!tokenizationKey) {
            return res.json({ ...basePayload, enabled: false });
        }

        const resolved = await nmiResolveTokenizationCollectJs(tokenizationKey, {
            collectJsUrl: creds.collectJsUrl || getPosNmiCollectJsUrl(),
            sandbox: isPosNmiSandboxHint()
        });
        if (!resolved.ok) {
            return res.json({
                ...basePayload,
                enabled: false,
                collectJsUrl: resolved.collectJsUrl || basePayload.collectJsUrl,
                preflightRejected: true
            });
        }

        return res.json({
            ...basePayload,
            enabled: true,
            tokenizationKey,
            collectJsUrl: resolved.collectJsUrl || basePayload.collectJsUrl,
            variant: 'inline',
            terminalOnly: false
        });
    } catch (e) {
        logger.error('POS NMI client config error:', e);
        res.status(500).json({ error: e.message || 'Failed to load payment config' });
    }
});

router.get('/payments/mx-client-config', async (req, res) => {
    try {
        const checkout = await loadPosCardCheckoutSettings(req.pool);
        const posProcessor = await loadPosPaymentProcessor(req.pool);
        const creds = resolvePosProcessorCredentials(posProcessor);
        const basePayload = {
            processor: creds.processor,
            processorLabel: creds.label,
            merchantId: '',
            apiBaseUrl: getMxmerchantApiBase('pos'),
            sandbox: Boolean(creds.sandbox),
            deploymentMode: checkout.deploymentMode,
            displayMode: checkout.displayMode,
            terminalOnly: checkout.displayMode === 'mx_terminal',
            posDataDefaults: buildPosVirtualPosData(),
        };

        if (posProcessor !== MX_PROCESSOR_ID || checkout.displayMode !== 'mx_virtual') {
            return res.json({ ...basePayload, enabled: false, terminalOnly: true });
        }
        if (!isMxmerchantConfigured('pos')) {
            return res.json({ ...basePayload, enabled: false });
        }

        const cfg = getMxmerchantConfig('pos');
        const sessionToken = await getLimitedUseToken('pos');
        return res.json({
            ...basePayload,
            enabled: true,
            merchantId: cfg.merchantId,
            sessionToken,
            terminalOnly: false,
        });
    } catch (e) {
        logger.error('POS MX client config error:', e);
        res.status(500).json({ error: e.message || 'Failed to load MX config' });
    }
});

const registerSupport = require('../services/posRegisterSupport');
const { scheduleSupportSessionSync } = require('../services/posPlatformSupportSync');

router.post('/support/heartbeat', async (req, res) => {
    try {
        if (!req.posDeviceRecordId) {
            return res.json({ ok: true, session: null });
        }
        const platform = String(req.body?.platform || '').toLowerCase();
        if (!registerSupport.isSupportedPlatform(platform)) {
            return res.status(400).json({ error: 'Platform not supported for remote assistance', code: 'PLATFORM_UNSUPPORTED' });
        }
        await registerSupport.updateDeviceSupportMeta(req.pool, req.posDeviceRecordId, {
            platform,
            appVersion: req.body?.appVersion || req.body?.app_version,
            rustdeskId: req.body?.rustdeskId || req.body?.rustdesk_id
        });
        const session = await registerSupport.getActiveSessionForDevice(req.pool, req.posDeviceRecordId);
        if (session) {
            scheduleSupportSessionSync(req.pool, session.id);
        }
        res.json({
            ok: true,
            session: session ? registerSupport.mapSessionRow(session) : null
        });
    } catch (e) {
        res.status(500).json({ error: 'Heartbeat failed' });
    }
});

router.post('/troubleshoot/briefing', async (req, res) => {
    try {
        const report = await buildRegisterTroubleshootReport(req.pool, req.posDeviceRecordId, {
            deviceLabel: req.posDeviceId,
            localChecks: req.body?.localChecks,
            situation: req.body?.situation
        });
        const statusReport = report.statusReport || {};

        if (isTroubleshootAiEnabled()) {
            const result = await briefRegisterTroubleshoot(report);
            return res.json({
                reply: result.reply,
                suggestedActions: result.suggestedActions,
                autoAction: result.autoAction,
                statusReport,
                fingerprint: statusReport.fingerprint,
                source: 'openai',
                model: result.model,
                ai: getTroubleshootAiConfig()
            });
        }

        const rules = buildRegisterRulesBriefing(report);
        res.json({
            ...rules,
            statusReport,
            fingerprint: statusReport.fingerprint,
            ai: { enabled: false }
        });
    } catch (e) {
        if (e.code === 'AI_NOT_CONFIGURED' || e.code === 'AI_AUTH_FAILED') {
            return res.status(503).json({ error: e.message, code: e.code });
        }
        logger.error('Register troubleshoot briefing error:', e);
        res.status(500).json({ error: 'Failed to load help briefing' });
    }
});

router.post('/troubleshoot/chat', async (req, res) => {
    try {
        const userMessage = String(req.body?.message || '').trim();
        if (!userMessage) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const report = await buildRegisterTroubleshootReport(req.pool, req.posDeviceRecordId, {
            deviceLabel: req.posDeviceId,
            localChecks: req.body?.localChecks,
            situation: req.body?.situation
        });

        if (!isTroubleshootAiEnabled()) {
            const rules = buildRegisterRulesBriefing(report);
            return res.json({
                reply: rules.reply,
                suggestedActions: rules.suggestedActions,
                statusReport: report.statusReport,
                source: 'rules',
                ai: { enabled: false }
            });
        }

        const result = await chatRegisterTroubleshoot({
            report,
            messages: req.body?.messages || [],
            userMessage
        });

        res.json({
            reply: result.reply,
            suggestedActions: result.suggestedActions,
            autoAction: result.autoAction,
            statusReport: report.statusReport,
            source: 'openai',
            model: result.model
        });
    } catch (e) {
        if (e.code === 'AI_NOT_CONFIGURED' || e.code === 'AI_AUTH_FAILED') {
            return res.status(503).json({ error: e.message, code: e.code });
        }
        logger.error('Register troubleshoot chat error:', e);
        res.status(500).json({ error: 'Help chat failed' });
    }
});

router.post('/support/request', async (req, res) => {
    try {
        const session = await registerSupport.requestSupportSession(req.pool, req.posDeviceRecordId, {
            platform: req.body?.platform,
            diagnostics: req.body?.diagnostics
        });
        scheduleSupportSessionSync(req.pool, session.id);
        res.status(201).json({ session });
    } catch (e) {
        const status =
            e.code === 'PLATFORM_UNSUPPORTED' || e.code === 'DEVICE_NOT_REGISTERED' ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.get('/support/session/current', async (req, res) => {
    try {
        if (!req.posDeviceRecordId) {
            return res.json({ session: null });
        }
        const row = await registerSupport.getActiveSessionForDevice(req.pool, req.posDeviceRecordId);
        res.json({ session: row ? registerSupport.mapSessionRow(row) : null });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load session' });
    }
});

router.post('/support/session/:id/consent', async (req, res) => {
    try {
        const allowed = req.body?.allowed !== false;
        const session = await registerSupport.setSessionConsent(
            req.pool,
            req.params.id,
            req.posDeviceRecordId,
            allowed
        );
        scheduleSupportSessionSync(req.pool, session.id);
        res.json({ session });
    } catch (e) {
        const status = e.code === 'NOT_FOUND' || e.code === 'INVALID_STATE' ? 400 : 500;
        res.status(status).json({ error: e.message, code: e.code });
    }
});

router.post('/support/session/:id/offer', async (req, res) => {
    try {
        const session = await registerSupport.setOfferSdp(
            req.pool,
            req.params.id,
            req.posDeviceRecordId,
            req.body?.sdp
        );
        scheduleSupportSessionSync(req.pool, session.id);
        res.json({ session });
    } catch (e) {
        res.status(400).json({ error: e.message, code: e.code });
    }
});

router.post('/support/session/:id/ice', async (req, res) => {
    try {
        await registerSupport.appendIceCandidate(
            req.pool,
            req.params.id,
            'pos',
            req.body?.candidate,
            req.posDeviceRecordId
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.get('/support/session/:id/signal', async (req, res) => {
    try {
        const sinceVersion = Number(req.query.since) || 0;
        const state = await registerSupport.getSignalState(req.pool, req.params.id, {
            sinceVersion,
            deviceRecordId: req.posDeviceRecordId
        });
        res.json(state);
    } catch (e) {
        res.status(404).json({ error: e.message, code: e.code });
    }
});

router.post('/support/session/:id/end', async (req, res) => {
    try {
        await registerSupport.endSession(req.pool, req.params.id, {
            deviceRecordId: req.posDeviceRecordId
        });
        scheduleSupportSessionSync(req.pool, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to end session' });
    }
});

module.exports = router;
