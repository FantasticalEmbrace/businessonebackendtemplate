// Enhanced Input Validation Middleware for HM Herbs
// Comprehensive validation using express-validator

const { body, param, query, validationResult } = require('express-validator');
const validator = require('validator');
const { isUsPhoneDisplayOrEmpty, isUsPhoneDisplay } = require('../utils/usPhoneDisplay');
const {
  normalizeDateYmd,
  normalizeTimeHm,
  isStoreDateTodayOrFuture
} = require('../utils/storeTimezone');

// Custom validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// User registration validation
const userRegistrationValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
    .isLength({ max: 255 })
    .withMessage('Email must be less than 255 characters'),
  
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (!isUsPhoneDisplayOrEmpty(value)) {
        throw new Error('Phone must be formatted as (555) 123-4567');
      }
      return true;
    }),

  body('dateOfBirth')
    .trim()
    .notEmpty()
    .withMessage('Date of birth is required')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('Date of birth must be YYYY-MM-DD')
    .custom((value) => {
      const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return true;
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const da = Number(m[3]);
      const birth = new Date(Date.UTC(y, mo, da));
      if (Number.isNaN(birth.getTime())) {
        throw new Error('Invalid date of birth');
      }
      const now = new Date();
      const oldest = new Date(Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate()));
      if (birth < oldest) {
        throw new Error('Invalid date of birth');
      }
      const minBirthDate = new Date(Date.UTC(now.getUTCFullYear() - 21, now.getUTCMonth(), now.getUTCDate()));
      if (birth > minBirthDate) {
        throw new Error('You must be 21 or older to create an account');
      }
      return true;
    }),
  
  handleValidationErrors
];

// User login validation
const userLoginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: 1 })
    .withMessage('Password is required'),
  
  handleValidationErrors
];

// Product validation
const productValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Product name must be between 1 and 255 characters')
    .escape(),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Description must be less than 5000 characters')
    .escape(),
  
  body('price')
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage('Price must be a valid number between 0 and 999999.99'),

  body('cost_price')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage('Cost must be a valid number between 0 and 999999.99'),
  
  body('sku')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('SKU must be between 1 and 100 characters')
    .matches(/^[A-Za-z0-9\-_]+$/)
    .withMessage('SKU can only contain letters, numbers, hyphens, and underscores'),
  
  body('category_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Category ID must be a positive integer'),
  
  body('brand_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Brand ID must be a positive integer'),
  
  body('inventory_quantity')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Inventory quantity must be a non-negative integer'),
  
  body('weight')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Weight must be less than 50 characters'),
  
  body('ingredients')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Ingredients must be less than 2000 characters')
    .escape(),
  
  body('is_active')
    .optional()
    .isBoolean()
    .withMessage('is_active must be a boolean value'),

  body('is_cannabis')
    .optional()
    .isBoolean()
    .withMessage('is_cannabis must be a boolean value'),

  body('coa_url')
    .optional({ checkFalsy: true })
    .isLength({ max: 500 })
    .withMessage('COA URL must be at most 500 characters'),

  body('coa_updated_at')
    .optional({ checkFalsy: true })
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('COA date must be YYYY-MM-DD'),
  
  handleValidationErrors
];

// Order validation
const orderValidation = [
  body('customer_email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid customer email'),
  
  body('customer_name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Customer name must be between 1 and 100 characters')
    .escape(),
  
  body('customer_phone')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (!isUsPhoneDisplayOrEmpty(value)) {
        throw new Error('Phone must be formatted as (555) 123-4567');
      }
      return true;
    }),
  
  body('shipping_address')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Shipping address must be between 1 and 500 characters')
    .escape(),
  
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  
  body('items.*.product_id')
    .isInt({ min: 1 })
    .withMessage('Product ID must be a positive integer'),
  
  body('items.*.quantity')
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999'),
  
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  
  body('total_amount')
    .isFloat({ min: 0 })
    .withMessage('Total amount must be a positive number'),
  
  handleValidationErrors
];

// EDSA booking validation (JSON body matches js/edsa-booking.js: camelCase)
const edsaBookingValidation = [
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be between 1 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes')
    .escape(),

  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be between 1 and 50 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes')
    .escape(),

  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),

  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone is required')
    .custom((value) => {
      if (!isUsPhoneDisplay(value)) {
        throw new Error('Phone must be formatted as (555) 123-4567');
      }
      return true;
    }),

  body('preferredDate')
    .custom((value) => {
      if (!normalizeDateYmd(value)) {
        throw new Error('Preferred date must be in YYYY-MM-DD format');
      }
      if (!isStoreDateTodayOrFuture(value)) {
        throw new Error('Preferred date cannot be in the past');
      }
      return true;
    }),

  body('preferredTime')
    .custom((value) => {
      if (!normalizeTimeHm(value)) {
        throw new Error('Preferred time must be in HH:MM format');
      }
      return true;
    }),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters')
    .escape(),

  body('alternativeDate')
    .optional()
    .isISO8601({ strict: true })
    .withMessage('Alternative date must be in YYYY-MM-DD format'),

  body('alternativeTime')
    .optional()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Alternative time must be in HH:MM format'),

  handleValidationErrors
];

const edsaCustomerEmailValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  handleValidationErrors
];

const edsaCustomerRescheduleValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),

  body('preferredDate')
    .custom((value) => {
      if (!normalizeDateYmd(value)) {
        throw new Error('Preferred date must be in YYYY-MM-DD format');
      }
      if (!isStoreDateTodayOrFuture(value)) {
        throw new Error('Preferred date cannot be in the past');
      }
      return true;
    }),

  body('preferredTime')
    .custom((value) => {
      if (!normalizeTimeHm(value)) {
        throw new Error('Preferred time must be in HH:MM format');
      }
      return true;
    }),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters')
    .escape(),

  handleValidationErrors
];

const edsaRequestChangeValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),

  body('requestType')
    .isIn(['cancel', 'reschedule'])
    .withMessage('Request type must be cancel or reschedule'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters'),

  body('requestedDate')
    .if((value, { req }) => req.body.requestType === 'reschedule')
    .isISO8601({ strict: true })
    .withMessage('Requested date must be YYYY-MM-DD'),

  body('requestedTime')
    .if((value, { req }) => req.body.requestType === 'reschedule')
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Requested time must be HH:MM'),

  handleValidationErrors,
];

// Email campaign validation
const emailCampaignValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('first_name')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name must be less than 50 characters')
    .escape(),
  
  body('last_name')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name must be less than 50 characters')
    .escape(),
  
  body('campaign_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Campaign ID must be a positive integer'),
  
  handleValidationErrors
];

// ID parameter validation
const idParamValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer'),
  
  handleValidationErrors
];

// Pagination query validation
const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be between 1 and 1000'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('search')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Search term must be less than 255 characters')
    .escape(),
  
  handleValidationErrors
];

// Add to cart validation
const addToCartValidation = [
  body('productId')
    .isInt({ min: 1 })
    .withMessage('Product ID must be a positive integer'),
  
  body('variantId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Variant ID must be a positive integer'),
  
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999'),
  
  handleValidationErrors
];

// Update cart validation
const updateCartValidation = [
  body('quantity')
    .isInt({ min: 0, max: 999 })
    .withMessage('Quantity must be between 0 and 999'),
  
  handleValidationErrors
];

// Common validations (for reuse)
const commonValidations = {
  idParam: idParamValidation,
  pagination: paginationValidation
};

// Custom sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Recursively sanitize all string inputs
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        // Remove potential XSS patterns
        obj[key] = validator.escape(obj[key].trim());
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  
  next();
};

// Admin login validation (same as user login)
const adminLoginValidation = userLoginValidation;

// Settings validation
const settingsValidation = [
  body('site_name')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Site name must be less than 255 characters')
    .escape(),
  
  body('site_email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  handleValidationErrors
];

// Inventory adjustment validation
const inventoryAdjustmentValidation = [
  body('productId')
    .isInt({ min: 1 })
    .withMessage('Product ID must be a positive integer'),
  
  body('quantityChange')
    .isInt()
    .withMessage('Quantity change must be an integer'),
  
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason must be less than 500 characters')
    .escape(),
  
  handleValidationErrors
];

// Vendor validation
const vendorValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Vendor name must be between 1 and 255 characters')
    .escape(),
  
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .custom((value) => {
      if (!isUsPhoneDisplayOrEmpty(value)) {
        throw new Error('Phone must be formatted as (555) 123-4567');
      }
      return true;
    }),
  
  handleValidationErrors
];

// User forgot password (request email link)
const userForgotPasswordValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address')
        .isLength({ max: 255 })
        .withMessage('Email must be less than 255 characters'),
    handleValidationErrors
];

// User reset password (token from email)
const userResetPasswordValidation = [
    body('token')
        .trim()
        .isLength({ min: 16, max: 128 })
        .withMessage('Invalid reset token'),
    body('newPassword')
        .isLength({ min: 8, max: 128 })
        .withMessage('Password must be between 8 and 128 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage(
            'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
        ),
    handleValidationErrors
];

module.exports = {
  userRegistrationValidation,
  userLoginValidation,
  userForgotPasswordValidation,
  userResetPasswordValidation,
  adminLoginValidation,
  productValidation,
  orderValidation,
  edsaBookingValidation,
  edsaRequestChangeValidation,
  edsaCustomerEmailValidation,
  edsaCustomerRescheduleValidation,
  emailCampaignValidation,
  idParamValidation,
  paginationValidation,
  addToCartValidation,
  updateCartValidation,
  settingsValidation,
  inventoryAdjustmentValidation,
  vendorValidation,
  commonValidations,
  sanitizeInput,
  handleValidationErrors
};
