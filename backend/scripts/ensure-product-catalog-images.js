#!/usr/bin/env node
/**
 * Create images/products placeholder files (canonical JPEG + life-ext.jpg etc.).
 * Usage (from repo root): node backend/scripts/ensure-product-catalog-images.js
 */
const path = require('path');
const { ensureProductCatalogImages } = require('../utils/ensureProductCatalogImages');

const projectRoot = path.join(__dirname, '..', '..');

ensureProductCatalogImages(projectRoot, console)
    .then(() => {
        console.log('ensure-product-catalog-images: done.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('ensure-product-catalog-images failed:', err);
        process.exit(1);
    });
