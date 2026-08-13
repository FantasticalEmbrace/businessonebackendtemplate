/**
 * Optional fallback for NMI Collect.js public tokenization key only (never put your private API key here).
 * Normal flow: leave empty — checkout loads the key from GET /api/payments/nmi-client-config (backend/.env).
 * Static HTML / file:// only: set the string below locally (do not commit real keys to a public repo).
 *
 * If checkout cannot reach the API (unusual host/port), set window.HMHERBS_API_ORIGIN first
 * (see hmHerbsApiOrigin() in js/checkout.js).
 */
window.HMHERBS_NMI_PUBLIC_TOKENIZATION_KEY = window.HMHERBS_NMI_PUBLIC_TOKENIZATION_KEY || '';
