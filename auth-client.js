const SESSION_KEY = 'chronicle-auth-session';
const ROLE_CACHE_KEY = 'chronicle-profile-role';
const PREFERRED_AREA_KEY = 'chronicle-preferred-area';
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
let configPromise = null;
let rolePromise = null;

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function sessionUserId(session) {
  return String(session?.user?.id || decodeJwtPayload(session?.accessToken)?.sub || '');
}

export function getPreferredArea() {
  return localStorage.getItem(PREFERRED_AREA_KEY) === 'player' ? 'player' : 'dm';
}

export function setPreferredArea(area) {
  localStorage.setItem(PREFERRED_AREA_KEY, area === 'player' ? 'player' : 'dm');
}

export function invalidateProfileRoleCache() {
  rolePromise = null;
  localStorage.removeItem(ROLE_CACHE_KEY);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Static caching is an optimization; the application remains usable without it.
    });
  }, { once: true });
}

registerServiceWorker();

export function getApiBaseUrl() {
  const configured = String(
    globalThis.CHRONICLE_RUNTIME_CONFIG?.apiBaseUrl || '',
  ).trim();
  return configured.replace(/\/+$/, '');
}

export function resolveApiUrl(input) {
  if (typeof input !== 'string') return input;
  if (!input.startsWith('/api/')) return input;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${input}` : input;
}

function backendOriginLabel() {
  const baseUrl = getApiBaseUrl();
  return baseUrl || globalThis.location?.origin || 'backend configurado';
}

export function safeNextPath(value, fallback = './player.html') {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.startsWith('//')) return fallback;
  try {
    const base = globalThis.location?.href || 'http://localhost/';
    const origin = globalThis.location?.origin || new URL(base).origin;
    const parsed = new URL(candidate, base);
    if (parsed.origin !== origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export async function loadAuthConfig() {
  if (!configPromise) {
    configPromise = fetch(resolveApiUrl('/api/auth/config'), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar a configuração de autenticação.');
        if (!payload.configured) throw new Error('A autenticação ainda não foi configurada no servidor.');
        return payload;
      });
  }
  return configPromise;
}

export function readAuthSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.accessToken) return null;
    return session;
  } catch {
    return null;
  }
}

export function storeAuthSession(payload) {
  const expiresIn = Number(payload.expires_in || payload.expiresIn || 3600);
  const session = {
    accessToken: payload.access_token || payload.accessToken,
    refreshToken: payload.refresh_token || payload.refreshToken || null,
    tokenType: payload.token_type || payload.tokenType || 'bearer',
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    user: payload.user || null,
  };
  if (!session.accessToken) throw new Error('O provedor de autenticação não retornou um token de acesso.');
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearAuthSession() {
  localStorage.removeItem(SESSION_KEY);
  invalidateProfileRoleCache();
  globalThis.dispatchEvent?.(new CustomEvent('chronicle:session-cleared'));
}

function authHeaders(config, accessToken = '') {
  const headers = { apikey: config.anonKey, 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function authRequest(path, options = {}) {
  const config = await loadAuthConfig();
  const response = await fetch(`${config.supabaseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || payload.error_description || payload.error || 'Não foi possível concluir a autenticação.');
  }
  return payload;
}

export async function signInWithEmail(email, password) {
  const config = await loadAuthConfig();
  const payload = await authRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ email, password }),
  });
  return storeAuthSession(payload);
}

export async function signUpWithEmail(email, password) {
  const config = await loadAuthConfig();
  const redirectTo = new URL('login.html', window.location.href).href;
  const payload = await authRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ email, password, data: {} }),
  });
  if (payload.access_token) {
    return { session: storeAuthSession(payload), confirmationRequired: false };
  }
  return { session: null, confirmationRequired: true, user: payload.user || null };
}

export async function startDiscordAuth() {
  const config = await loadAuthConfig();
  if (!config.discordEnabled) throw new Error('O acesso pelo Discord está desabilitado neste servidor.');
  const redirectTo = new URL('login.html', window.location.href).href;
  const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set('provider', 'discord');
  url.searchParams.set('redirect_to', redirectTo);
  window.location.assign(url.toString());
}

export function consumeOAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const error = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error');
  if (error) throw new Error(error);
  const accessToken = hash.get('access_token');
  if (!accessToken) return null;
  const session = storeAuthSession({
    access_token: accessToken,
    refresh_token: hash.get('refresh_token'),
    expires_in: hash.get('expires_in'),
    token_type: hash.get('token_type'),
  });
  history.replaceState({}, document.title, window.location.pathname);
  return session;
}

export async function getAuthenticatedUser(session = readAuthSession()) {
  if (!session?.accessToken) return null;
  const config = await loadAuthConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: authHeaders(config, session.accessToken),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function getProfileRole(session = readAuthSession(), { force = false } = {}) {
  const userId = sessionUserId(session);
  if (!session?.accessToken || !userId) return 'player';

  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) || 'null');
      if (cached?.userId === userId && Date.now() - Number(cached.storedAt || 0) < ROLE_CACHE_TTL_MS) {
        return cached.role === 'dm' ? 'dm' : 'player';
      }
    } catch {
      localStorage.removeItem(ROLE_CACHE_KEY);
    }
    if (rolePromise) return rolePromise;
  }

  rolePromise = (async () => {
    const config = await loadAuthConfig();
    const url = new URL(`${config.supabaseUrl}/rest/v1/profiles`);
    url.searchParams.set('id', `eq.${userId}`);
    url.searchParams.set('select', 'role');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return 'player';
    const rows = await response.json().catch(() => []);
    const role = rows[0]?.role === 'dm' ? 'dm' : 'player';
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ userId, role, storedAt: Date.now() }));
    return role;
  })();

  try {
    return await rolePromise;
  } finally {
    rolePromise = null;
  }
}

export async function signedInDestination(session = readAuthSession()) {
  const role = await getProfileRole(session);
  const fallback = role === 'dm' && getPreferredArea() === 'dm' ? './dm.html' : './player.html';
  const requested = safeNextPath(
    new URLSearchParams(window.location.search).get('returnTo'),
    fallback,
  );
  const destination = new URL(requested, window.location.href);
  const pageName = destination.pathname.split('/').pop() || '';
  if (role !== 'dm' && (pageName === 'dm.html' || pageName.startsWith('dm-'))) {
    return fallback;
  }
  if (pageName === 'login.html') return fallback;
  return requested;
}

export async function signOut() {
  const session = readAuthSession();
  try {
    if (session?.accessToken) {
      const config = await loadAuthConfig();
      await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: authHeaders(config, session.accessToken),
      });
    }
  } catch {
    // Local session removal must still succeed when the network is unavailable.
  } finally {
    await globalThis.__chronicleClearDataCache?.().catch(() => {});
    clearAuthSession();
  }
}

export function initializeLogoutButtons(selector = '[data-auth-logout]') {
  document.querySelectorAll(selector).forEach((button) => {
    if (button.dataset.logoutReady === 'true') return;
    button.dataset.logoutReady = 'true';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await signOut();
      } finally {
        window.location.assign('./index.html');
      }
    });
  });
}

export async function refreshAuthSession(session = readAuthSession()) {
  if (!session?.refreshToken) return null;
  const config = await loadAuthConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    clearAuthSession();
    return null;
  }
  return storeAuthSession(payload);
}

export async function getUsableAuthSession() {
  const session = readAuthSession();
  if (!session) return null;
  if (Number(session.expiresAt || 0) > Date.now() + 30_000) return session;
  return refreshAuthSession(session);
}

export async function authenticatedFetch(input, options = {}, retry = true) {
  const session = await getUsableAuthSession();
  if (!session?.accessToken) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.assign(`./login.html?returnTo=${encodeURIComponent(returnTo)}`);
    throw new Error('É necessário entrar na sua conta.');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  const resolvedInput = resolveApiUrl(input);
  let response;
  try {
    response = await fetch(resolvedInput, { ...options, headers });
  } catch (error) {
    console.error('[API Chronicle] Falha de rede', {
      input,
      resolvedInput,
      backend: backendOriginLabel(),
      error,
    });
    if (error?.name === 'AbortError') {
      throw new Error('O servidor demorou mais de 30 segundos para responder. Tente novamente.');
    }
    throw new Error(
      'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
    );
  }
  if (response.status === 401 && retry && session.refreshToken) {
    const refreshed = await refreshAuthSession(session);
    if (refreshed?.accessToken) return authenticatedFetch(input, options, false);
  }
  if (response.status === 401) {
    clearAuthSession();
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.assign(`./login.html?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return response;
}

export async function requireAuthenticatedPage(expectedArea = null) {
  const session = await getUsableAuthSession();
  if (!session) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.replace(`./login.html?returnTo=${encodeURIComponent(returnTo)}`);
    return null;
  }
  if (expectedArea) {
    const role = await getProfileRole(session);
    if (expectedArea === 'dm' && role !== 'dm') {
      window.location.replace('./player.html');
      return null;
    }
    setPreferredArea(expectedArea === 'dm' ? 'dm' : 'player');
  }
  return session;
}

export async function initializeAreaSwitcher(area) {
  const session = readAuthSession();
  const role = await getProfileRole(session);
  setPreferredArea(area === 'dm' ? 'dm' : 'player');

  document.querySelectorAll('[data-area-switch]').forEach((link) => {
    link.addEventListener('click', () => setPreferredArea(link.dataset.areaSwitch));
  });

  if (area !== 'player' || role !== 'dm') return role;
  document.querySelector('.sidebar-gm-promotion')?.setAttribute('hidden', '');
  if (document.querySelector('[data-area-switch="dm"]')) return role;
  const logout = document.querySelector('[data-auth-logout]');
  if (!logout?.parentElement) return role;
  const link = document.createElement('a');
  link.className = 'secondary-button button-link area-switch-button';
  link.href = './dm.html';
  link.dataset.areaSwitch = 'dm';
  link.textContent = 'Área do Mestre';
  link.addEventListener('click', () => setPreferredArea('dm'));
  logout.parentElement.insertBefore(link, logout);
  return role;
}

