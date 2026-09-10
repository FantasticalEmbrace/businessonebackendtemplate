/**

 * Admin panel roles (top → bottom): developer, admin, manager, assistant_manager.

 * Legacy DB values super_admin → admin, staff → assistant_manager, marketing → assistant_manager.

 */



const ADMIN_ROLES = Object.freeze([

    'developer',

    'admin',

    'manager',

    'assistant_manager',

]);



const LEGACY_ROLE_MAP = Object.freeze({

    super_admin: 'admin',

    staff: 'assistant_manager',

    marketing: 'assistant_manager',

});



/** Numeric rank — higher can do everything lower roles can. */

const ROLE_LEVEL = Object.freeze({

    assistant_manager: 1,

    manager: 2,

    admin: 3,

    developer: 4,

});



const ROLE_LABELS = Object.freeze({

    developer: 'Developer',

    admin: 'Admin',

    manager: 'Manager',

    assistant_manager: 'Assistant Manager',

});



function normalizeAdminRole(role) {

    if (!role) return '';

    const key = String(role).trim().toLowerCase();

    return LEGACY_ROLE_MAP[key] || key;

}



function adminRoleLevel(role) {

    return ROLE_LEVEL[normalizeAdminRole(role)] || 0;

}



function isDeveloperRole(role) {

    return normalizeAdminRole(role) === 'developer';

}



function hasMinAdminRole(userRole, minRole) {

    return adminRoleLevel(userRole) >= adminRoleLevel(minRole);

}



/** Settings keys that control storefront footer hours and Google Business hour sync. */
const STORE_HOUR_SETTING_KEYS = Object.freeze([
    'store_hours_weekdays',
    'store_hours_saturday',
    'store_hours_sunday',
    'store_holiday_schedule',
]);

function canManageStoreHours(role) {
    return hasMinAdminRole(role, 'admin');
}



/** Merchant promotion path only — Developer is platform staff, never promoted from Admin/owner. */
const MERCHANT_PROMOTION_CHAIN = Object.freeze(['assistant_manager', 'manager', 'admin']);

/** Next rank up (assistant_manager → manager → admin). */
function getNextRole(role) {
    const normalized = normalizeAdminRole(role);
    const idx = MERCHANT_PROMOTION_CHAIN.indexOf(normalized);
    if (idx < 0 || idx >= MERCHANT_PROMOTION_CHAIN.length - 1) return null;
    return MERCHANT_PROMOTION_CHAIN[idx + 1];
}



/** Sections visible in admin.html sidebar (data-section values). */

const SECTION_ACCESS = Object.freeze({

    assistant_manager: [

        'dashboard',

        'orders',

        'customers',

        'customer-groups',

        'edsa',

        'low-stock',

        'marketing',

    ],

    manager: [

        'dashboard',

        'products',

        'low-stock',

        'import',

        'categories',

        'brands',

        'vendors',

        'orders',

        'tax-ledger',

        'customers',

        'customer-groups',

        'gift-cards',

        'edsa',

        'marketing',

        'pos',

        'reports',

        'settings',

    ],

    admin: null, // null = all sections

    developer: null,

});



const DEVELOPER_ONLY_SECTIONS = Object.freeze(['developer-tools']);

/** Reserved for principal-store-only admin sections (schedule/EDSA is available to all merchants). */
const PRINCIPAL_ONLY_SECTIONS = Object.freeze([]);

function filterAllowedSectionsForStore(sections, { isPrincipalStore = false } = {}) {
    if (isPrincipalStore || sections === null || sections === undefined) {
        return sections;
    }
    const drop = new Set(PRINCIPAL_ONLY_SECTIONS);
    return sections.filter((section) => !drop.has(section));
}

function canAccessAdminSection(role, sectionId, options = {}) {
    if (DEVELOPER_ONLY_SECTIONS.includes(sectionId)) {
        return isDeveloperRole(role);
    }
    if (PRINCIPAL_ONLY_SECTIONS.includes(sectionId) && !options.isPrincipalStore) {
        return false;
    }

    const normalized = normalizeAdminRole(role);
    const allowed = SECTION_ACCESS[normalized];

    if (allowed === null) return true;

    if (!allowed) return false;

    return allowed.includes(sectionId);
}



function defaultSectionForRole() {

    return 'dashboard';

}



/** `null` means all sections (Admin). */

function allowedSectionsForRole(role) {

    const normalized = normalizeAdminRole(role);

    if (normalized === 'admin' || normalized === 'developer') return null;

    return SECTION_ACCESS[normalized] || [];

}



module.exports = {

    ADMIN_ROLES,

    LEGACY_ROLE_MAP,

    ROLE_LEVEL,

    ROLE_LABELS,

    normalizeAdminRole,

    adminRoleLevel,

    isDeveloperRole,

    hasMinAdminRole,
    canManageStoreHours,
    STORE_HOUR_SETTING_KEYS,
    getNextRole,

    canAccessAdminSection,

    DEVELOPER_ONLY_SECTIONS,

    PRINCIPAL_ONLY_SECTIONS,

    filterAllowedSectionsForStore,

    MERCHANT_PROMOTION_CHAIN,

    defaultSectionForRole,

    allowedSectionsForRole,

};

