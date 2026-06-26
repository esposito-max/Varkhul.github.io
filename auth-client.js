const SESSION_KEY = 'chronicle-auth-session';
let configPromise = null;

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

export function safeNextPath(value, fallback = '/player.html') {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  try {
    const origin = globalThis.location?.origin || 'http://localhost';
    const parsed = new URL(candidate, origin);
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
        if (!response.ok) throw new Error(payload.error || 'Authentication configuration could not be loaded.');
        if (!payload.configured) throw new Error('Supabase authentication is not configured on this server.');
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
  if (!session.accessToken) throw new Error('The authentication provider did not return an access token.');
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearAuthSession() {
  localStorage.removeItem(SESSION_KEY);
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
    throw new Error(payload.msg || payload.error_description || payload.error || 'Authentication request failed.');
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
  if (!config.discordEnabled) throw new Error('Discord authentication is disabled on this server.');
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
  history.replaceState(
  {},
  document.title,
  window.location.pathname,
  );
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

export async function getProfileRole(session = readAuthSession()) {
  const user = await getAuthenticatedUser(session);
  if (!user?.id) return 'player';
  const config = await loadAuthConfig();
  const url = new URL(`${config.supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set('id', `eq.${user.id}`);
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
  return rows[0]?.role === 'dm' ? 'dm' : 'player';
}

export async function signedInDestination(session = readAuthSession()) {
  const role = await getProfileRole(session);
  const fallback = role === 'dm' ? '/dm.html' : '/player.html';
  const requested = safeNextPath(new URLSearchParams(window.location.search).get('returnTo'), fallback);
  if (role !== 'dm' && requested.startsWith('/dm')) return fallback;
  if (requested === '/login.html') return fallback;
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
        window.location.assign('/index.html');
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
    window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
    throw new Error('Authentication required.');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  const resolvedInput = resolveApiUrl(input);
  let response;
  try {
    response = await fetch(resolvedInput, { ...options, headers });
  } catch (error) {
    console.error('[Chronicle API] Network failure', {
      input,
      resolvedInput,
      backend: backendOriginLabel(),
      error,
    });
    throw new Error(
      `Não foi possível acessar o backend em ${backendOriginLabel()}. `
      + 'Verifique web/runtime-config.js e CHRONICLE_CORS_ORIGINS.',
    );
  }
  if (response.status === 401 && retry && session.refreshToken) {
    const refreshed = await refreshAuthSession(session);
    if (refreshed?.accessToken) return authenticatedFetch(input, options, false);
  }
  if (response.status === 401) {
    clearAuthSession();
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return response;
}

export async function requireAuthenticatedPage(expectedRole = null) {
  const session = await getUsableAuthSession();
  if (!session) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.replace(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
    return null;
  }
  if (expectedRole) {
    const role = await getProfileRole(session);
    if (role !== expectedRole) {
      window.location.replace(role === 'dm' ? 'dm.html' : 'player.html');
      return null;
    }
  }
  return session;
}

