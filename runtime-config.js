/*
 * Public browser runtime configuration.
 *
 * Local Python testing at http://127.0.0.1:8000 or http://localhost:8000 uses
 * the same origin, so apiBaseUrl stays empty. GitHub Pages uses the hosted
 * JustRunMy backend.
 *
 * This file must never contain SUPABASE_SERVICE_ROLE_KEY, NTFY_TOKEN, or
 * GM_PROMOTION_SECRET.
 */
const localFrontendHosts = new Set(['127.0.0.1', 'localhost']);

window.CHRONICLE_RUNTIME_CONFIG = Object.freeze({
  apiBaseUrl: localFrontendHosts.has(window.location.hostname)
    ? ''
    : 'https://a39965-824e.m.jrnm.app',
});
