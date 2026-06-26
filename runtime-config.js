/*
 * Public browser runtime configuration.
 *
 * When the frontend and Python API use different hosts, set apiBaseUrl to the
 * public HTTPS address of the Python backend, without a trailing slash.
 * Example: https://your-app.justrunmy.app
 *
 * This file must never contain SUPABASE_SERVICE_ROLE_KEY, NTFY_TOKEN, or
 * GM_PROMOTION_SECRET.
 */
window.CHRONICLE_RUNTIME_CONFIG = Object.freeze({
  apiBaseUrl: '',
});
