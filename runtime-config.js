/*
 * Configuração pública do frontend.
 *
 * Em testes locais por http://127.0.0.1:8000 ou http://localhost:8000, o
 * frontend e a API usam a mesma origem. No GitHub Pages, as chamadas são
 * direcionadas ao backend hospedado no JustRunMy.
 *
 * Nunca coloque SUPABASE_SERVICE_ROLE_KEY, NTFY_TOKEN ou
 * GM_PROMOTION_SECRET neste arquivo.
 */
const localFrontendHosts = new Set(['127.0.0.1', 'localhost']);

window.CHRONICLE_RUNTIME_CONFIG = Object.freeze({
  apiBaseUrl: localFrontendHosts.has(window.location.hostname)
    ? ''
    : 'https://a39965-824e.m.jrnm.app',
});
