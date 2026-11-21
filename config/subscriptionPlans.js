/**
 * DINEVIQ CAFE OS — Module & Feature Allocation Configuration
 * Matrix based on Dineviq_Subscription_Plans_and_Modules.pdf
 * Dependency-Proof Plan Architecture: Starter (₹499) • Growth (₹799) • Pro (₹999) • Custom
 */

const MODULE_KEYS = {
  // Base Modules (Starter)
  POS_TERMINAL: 'pos_terminal',
  MENU_MANAGEMENT: 'menu_management',
  ORDERS_MANAGEMENT: 'orders_management',
  BASIC_DASHBOARD: 'basic_dashboard',
  SETTINGS_BRANDING: 'settings_branding',

  // Table Suite (Growth & Pro, or Custom +Table Suite)
  // Architecture Rule: #6, #7, #8, #9 are strictly grouped together in Table Suite
  TABLE_QR: 'table_qr',
  LIVE_ORDERS_KDS: 'live_orders_kds',
  TEMPORARY_TABLES: 'temporary_tables',
  FLOOR_LAYOUT: 'floor_layout',

  // Growth & Pro Addons
  KHATA_LEDGER: 'khata_ledger',
  ITEM_SUMMARY: 'item_summary',

  // Pro Only (or Custom Addon)
  WHATSAPP_SUITE: 'whatsapp_suite',
  CUSTOMER_CRM: 'customer_crm',
  REPORTS_EXCEL: 'reports_excel',
  STAFF_MANAGEMENT: 'staff_management',
  AI_COPILOT: 'ai_copilot'
};

const MODULE_DEFINITIONS = [
  {
    id: MODULE_KEYS.POS_TERMINAL,
    number: 1,
    name: 'POS Terminal (Counter)',
    description: 'Fast counter billing, walk-in orders & Cash/UPI settlement',
    category: 'base'
  },
  {
    id: MODULE_KEYS.MENU_MANAGEMENT,
    number: 2,
    name: 'Menu Management',
    description: 'Dish add/edit, categories, pricing, variants, in-stock toggle',
    category: 'base'
  },
  {
    id: MODULE_KEYS.ORDERS_MANAGEMENT,
    number: 3,
    name: 'Orders Management',
    description: 'Complete order history, bill re-print & payment mode filters',
    category: 'base'
  },
  {
    id: MODULE_KEYS.BASIC_DASHBOARD,
    number: 4,
    name: 'Basic Dashboard',
    description: "Today's revenue, total bills count & daily sales metrics",
    category: 'base'
  },
  {
    id: MODULE_KEYS.SETTINGS_BRANDING,
    number: 5,
    name: 'Settings & Branding',
    description: 'Cafe name, logo, GST %, UPI QR setup & sound chime',
    category: 'base'
  },
  {
    id: MODULE_KEYS.TABLE_QR,
    number: 6,
    name: 'Table QR Codes',
    description: 'Dynamic table QR, customer self-ordering mobile cart',
    category: 'table_suite',
    suite: 'table_suite'
  },
  {
    id: MODULE_KEYS.LIVE_ORDERS_KDS,
    number: 7,
    name: 'Live Orders / KDS',
    description: 'Kitchen display screen, cooking prep timer, order ready status',
    category: 'table_suite',
    suite: 'table_suite'
  },
  {
    id: MODULE_KEYS.TEMPORARY_TABLES,
    number: 8,
    name: 'Temporary Tables',
    description: 'Floating open tabs (e.g. Deepak) & auto-removal on settlement',
    category: 'table_suite',
    suite: 'table_suite'
  },
  {
    id: MODULE_KEYS.FLOOR_LAYOUT,
    number: 9,
    name: 'Floor & Seating Layout',
    description: 'Multi-floor view (Indoor, Rooftop, Garden) & table states',
    category: 'table_suite',
    suite: 'table_suite'
  },
  {
    id: MODULE_KEYS.KHATA_LEDGER,
    number: 10,
    name: 'Khata Ledger',
    description: 'Customer udhari tracking, credit limits, repayment ledger',
    category: 'growth',
    addonPrice: 149
  },
  {
    id: MODULE_KEYS.ITEM_SUMMARY,
    number: 11,
    name: 'Item Summary Reports',
    description: 'Dish-wise sales velocity & item quantity sold analysis',
    category: 'growth',
    addonPrice: 149
  },
  {
    id: MODULE_KEYS.WHATSAPP_SUITE,
    number: 12,
    name: 'Automated WhatsApp Suite',
    description: 'Direct WhatsApp E-Bills & marketing discount broadcasts',
    category: 'pro',
    addonPrice: 249
  },
  {
    id: MODULE_KEYS.CUSTOMER_CRM,
    number: 13,
    name: 'Customer CRM & Loyalty',
    description: 'Customer directory, lifetime spend metrics, visit count, AOV',
    category: 'pro',
    addonPrice: 199
  },
  {
    id: MODULE_KEYS.REPORTS_EXCEL,
    number: 14,
    name: 'Reports Suite (Excel)',
    description: 'Detailed sales summary, payment mode splits, .xlsx export',
    category: 'pro',
    addonPrice: 149
  },
  {
    id: MODULE_KEYS.STAFF_MANAGEMENT,
    number: 15,
    name: 'Staff Management & Roles',
    description: 'Cashier, Waiter, Kitchen roles, PIN security & permissions',
    category: 'pro',
    addonPrice: 149
  },
  {
    id: MODULE_KEYS.AI_COPILOT,
    number: 16,
    name: 'AI Copilot & Insights',
    description: 'Sales predictions, smart recommendations & Dineviq AI Assistant',
    category: 'pro',
    addonPrice: 199
  }
];

// Base starter modules (included in every plan)
const BASE_MODULES = [
  MODULE_KEYS.POS_TERMINAL,
  MODULE_KEYS.MENU_MANAGEMENT,
  MODULE_KEYS.ORDERS_MANAGEMENT,
  MODULE_KEYS.BASIC_DASHBOARD,
  MODULE_KEYS.SETTINGS_BRANDING
];

// Table Suite (grouped together by architecture rule)
const TABLE_SUITE_MODULES = [
  MODULE_KEYS.TABLE_QR,
  MODULE_KEYS.LIVE_ORDERS_KDS,
  MODULE_KEYS.TEMPORARY_TABLES,
  MODULE_KEYS.FLOOR_LAYOUT
];

// Standard plan tiers
const PLAN_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    price: 499,
    durationDays: 30,
    description: 'Base Counter Billing & Operational Essentials',
    modules: [...BASE_MODULES]
  },
  growth: {
    id: 'growth',
    name: 'Growth Plan',
    price: 799,
    durationDays: 30,
    description: 'Starter + Table Suite + Khata Ledger + Item Summary',
    modules: [
      ...BASE_MODULES,
      ...TABLE_SUITE_MODULES,
      MODULE_KEYS.KHATA_LEDGER,
      MODULE_KEYS.ITEM_SUMMARY
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    price: 999,
    durationDays: 30,
    description: 'All 16 Modules Unlocked — Full Dineviq Cafe OS Suite',
    modules: MODULE_DEFINITIONS.map(m => m.id)
  },
  custom: {
    id: 'custom',
    name: 'Custom Plan',
    basePrice: 499,
    durationDays: 30,
    description: 'Base + Custom Tailored Add-on Modules',
    baseModules: [...BASE_MODULES]
  },
  free_trial: {
    id: 'free_trial',
    name: 'Free Trial',
    price: 0,
    durationDays: 14,
    description: '14-Day Full Access Trial',
    modules: MODULE_DEFINITIONS.map(m => m.id)
  }
};

// Custom plan add-on catalog
const CUSTOM_ADDONS = {
  table_suite: {
    id: 'table_suite',
    name: 'Table Suite (QR, KDS, Temp Tables, Seating Layout)',
    price: 249, // Bundled price for all 4
    modules: [...TABLE_SUITE_MODULES]
  },
  khata_ledger: {
    id: 'khata_ledger',
    name: 'Khata Ledger',
    price: 149,
    modules: [MODULE_KEYS.KHATA_LEDGER]
  },
  item_summary: {
    id: 'item_summary',
    name: 'Item Summary Reports',
    price: 149,
    modules: [MODULE_KEYS.ITEM_SUMMARY]
  },
  whatsapp_suite: {
    id: 'whatsapp_suite',
    name: 'Automated WhatsApp Suite',
    price: 249,
    modules: [MODULE_KEYS.WHATSAPP_SUITE]
  },
  customer_crm: {
    id: 'customer_crm',
    name: 'Customer CRM & Loyalty',
    price: 199,
    modules: [MODULE_KEYS.CUSTOMER_CRM]
  },
  reports_excel: {
    id: 'reports_excel',
    name: 'Reports Suite (Excel)',
    price: 149,
    modules: [MODULE_KEYS.REPORTS_EXCEL]
  },
  staff_management: {
    id: 'staff_management',
    name: 'Staff Management & Roles',
    price: 149,
    modules: [MODULE_KEYS.STAFF_MANAGEMENT]
  },
  ai_copilot: {
    id: 'ai_copilot',
    name: 'AI Copilot & Insights',
    price: 199,
    modules: [MODULE_KEYS.AI_COPILOT]
  }
};

/**
 * Resolves the complete set of enabled module IDs for a given tenant subscription.
 * Handles backward compatibility for legacy plans ('1_month', '6_months', '1_year').
 */
function getEffectiveTenantModules(subscription = {}) {
  const planKey = (subscription.plan || '').toLowerCase();

  // If explicit modules array is set and not empty, union with base
  if (Array.isArray(subscription.modules) && subscription.modules.length > 0) {
    const set = new Set([...BASE_MODULES, ...subscription.modules]);
    return Array.from(set);
  }

  // Map legacy plans to Pro (to avoid breaking existing paying customers)
  if (['1_month', '6_months', '1_year', 'pro', 'yearly', 'annual'].includes(planKey)) {
    return PLAN_TIERS.pro.modules;
  }

  if (planKey === 'growth') {
    return PLAN_TIERS.growth.modules;
  }

  if (planKey === 'starter') {
    return PLAN_TIERS.starter.modules;
  }

  if (planKey === 'custom') {
    const modulesSet = new Set([...BASE_MODULES]);
    const addons = subscription.customAddons || [];
    addons.forEach(addonKey => {
      const addon = CUSTOM_ADDONS[addonKey];
      if (addon && Array.isArray(addon.modules)) {
        addon.modules.forEach(m => modulesSet.add(m));
      } else if (MODULE_KEYS[addonKey.toUpperCase()] || Object.values(MODULE_KEYS).includes(addonKey)) {
        modulesSet.add(addonKey);
      }
    });
    return Array.from(modulesSet);
  }

  // Free trial gets full access, unless customAddons is configured
  if (planKey === 'free_trial') {
    if (Array.isArray(subscription.customAddons) && subscription.customAddons.length > 0) {
      const modulesSet = new Set([...BASE_MODULES]);
      subscription.customAddons.forEach(addonKey => {
        const addon = CUSTOM_ADDONS[addonKey];
        if (addon && Array.isArray(addon.modules)) {
          addon.modules.forEach(m => modulesSet.add(m));
        } else if (MODULE_KEYS[addonKey.toUpperCase()] || Object.values(MODULE_KEYS).includes(addonKey)) {
          modulesSet.add(addonKey);
        }
      });
      return Array.from(modulesSet);
    }
    return PLAN_TIERS.free_trial.modules;
  }

  // Default fallback: Starter
  return PLAN_TIERS.starter.modules;
}

/**
 * Calculates total monthly price for a custom plan.
 */
function calculateCustomPlanPrice(selectedAddonKeys = []) {
  let total = PLAN_TIERS.custom.basePrice;
  selectedAddonKeys.forEach(key => {
    if (CUSTOM_ADDONS[key]) {
      total += CUSTOM_ADDONS[key].price;
    }
  });
  return total;
}

module.exports = {
  MODULE_KEYS,
  MODULE_DEFINITIONS,
  BASE_MODULES,
  TABLE_SUITE_MODULES,
  PLAN_TIERS,
  CUSTOM_ADDONS,
  getEffectiveTenantModules,
  calculateCustomPlanPrice
};
