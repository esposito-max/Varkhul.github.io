import { authenticatedFetch, readAuthSession } from './auth-client.js';

const DATABASE_NAME = 'chronicle-character-cache';
const DATABASE_VERSION = 2;
const STORE_NAME = 'responses';
const CACHE_SCHEMA_KEY = 'chronicle-cache-schema';
const CACHE_CLEANUP_KEY = 'chronicle-cache-last-cleanup';
const CACHE_EVENT_KEY = 'chronicle-cache-event';
const CACHE_SCHEMA = '2';
const CACHE_CHANNEL_NAME = 'chronicle-data-cache';
const DEFAULT_FRESH_MS = 15_000;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_RECORD_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS_PER_SCOPE = 350;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const memoryCache = new Map();
const pendingRequests = new Map();
const queuedWrites = new Map();
let databasePromise = null;
let writeFlushScheduled = false;
let activeWritePromise = Promise.resolve();
let cacheEpoch = 0;
let cacheChannel = null;

function safeStorage(storageName) {
  try {
    return globalThis[storageName] || null;
  } catch {
    return null;
  }
}

function readLocalValue(key) {
  try {
    return safeStorage('localStorage')?.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeLocalValue(key, value) {
  try {
    safeStorage('localStorage')?.setItem(key, String(value));
  } catch {
    // Cache metadata is optional when storage is blocked or full.
  }
}

function decodeJwtSubject(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    return String(parsed?.sub || '');
  } catch {
    return '';
  }
}

export function currentCacheScope() {
  const session = readAuthSession();
  return String(session?.user?.id || decodeJwtSubject(session?.accessToken) || 'anonymous');
}

function normalizedUrl(input) {
  return typeof input === 'string' ? input : String(input?.url || input || '');
}

function parsedPath(input) {
  try {
    return new URL(normalizedUrl(input), globalThis.location?.origin || 'http://chronicle.local').pathname;
  } catch {
    return normalizedUrl(input).split('?')[0];
  }
}

function cacheKey(url, scope = currentCacheScope()) {
  return `${scope}::${normalizedUrl(url)}`;
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

function routeTags(input) {
  const path = parsedPath(input);
  const tags = [];

  if (path === '/api/player/bootstrap') tags.push('player-home', 'characters', 'campaigns');
  if (path === '/api/dm/bootstrap') tags.push('dm-home', 'dm-campaigns', 'dm-lore');
  if (path === '/api/dm/campaigns') tags.push('dm-campaigns');
  if (path.startsWith('/api/dm/')) tags.push('dm-home');
  if (path === '/api/characters') tags.push('characters', 'player-home');
  if (path === '/api/campaigns') tags.push('campaigns', 'player-home');
  if (path.startsWith('/api/quick-search')) tags.push('quick-search');
  if (path.startsWith('/api/profile')) tags.push('profile');
  if (path.startsWith('/api/lore')) tags.push('player-lore');
  if (path.startsWith('/api/dm/lore')) tags.push('dm-lore');

  const characterMatch = path.match(/^\/api\/characters\/([^/]+)/);
  if (characterMatch) tags.push(`character:${decodeURIComponent(characterMatch[1])}`, 'characters');

  const playerCampaignMatch = path.match(/^\/api\/campaigns\/([^/]+)/);
  if (playerCampaignMatch && playerCampaignMatch[1] !== 'join') {
    tags.push(`campaign:${decodeURIComponent(playerCampaignMatch[1])}`, 'campaigns');
  }

  const dmCampaignMatch = path.match(/^\/api\/dm\/campaigns\/([^/]+)/);
  if (dmCampaignMatch) {
    tags.push(`dm-campaign:${decodeURIComponent(dmCampaignMatch[1])}`, 'dm-campaigns');
  }

  const encounterMatch = path.match(/^\/api\/dm\/encounters\/([^/]+)/);
  if (encounterMatch) tags.push(`encounter:${decodeURIComponent(encounterMatch[1])}`, 'encounters');

  if (path.startsWith('/api/account/')) tags.push('account', 'profile');
  return uniqueValues(tags);
}

function routePolicy(input) {
  const path = parsedPath(input);

  if (/\/active-encounter(?:\/|$)/.test(path) || /\/encounters\//.test(path)) {
    return { mode: 'network-first', freshForMs: 0, staleForMs: 5 * 60 * 1000 };
  }
  if (/\/level-up-access$/.test(path) || path === '/api/account/gm-promotion/status') {
    return { mode: 'network-first', freshForMs: 0, staleForMs: 15 * 60 * 1000 };
  }
  if (path.startsWith('/api/quick-search')) {
    return { mode: 'stale-while-revalidate', freshForMs: 5 * 60 * 1000, staleForMs: 24 * 60 * 60 * 1000 };
  }
  if (path.endsWith('/workspace') || path.endsWith('/bootstrap')) {
    return { mode: 'stale-while-revalidate', freshForMs: 10_000, staleForMs: 24 * 60 * 60 * 1000 };
  }
  return { mode: 'network-first', freshForMs: 0, staleForMs: 24 * 60 * 60 * 1000 };
}

function mutationInvalidation(input) {
  const path = parsedPath(input);
  const tags = routeTags(input);
  const prefixes = [];

  if (path.startsWith('/api/characters')) tags.push('player-home', 'characters');
  if (path.startsWith('/api/campaigns')) tags.push('player-home', 'campaigns');
  if (path.startsWith('/api/dm/')) tags.push('dm-home');
  if (path.startsWith('/api/dm/campaigns')) tags.push('dm-campaigns');
  if (path.includes('/lore')) tags.push('dm-lore', 'player-lore', 'player-home', 'dm-home');
  if (path.startsWith('/api/account/')) tags.push('profile', 'player-home', 'dm-home');

  return { tags: uniqueValues(tags), prefixes };
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'key' });

      if (!store.indexNames.contains('scope')) store.createIndex('scope', 'scope', { unique: false });
      if (!store.indexNames.contains('tags')) store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      if (!store.indexNames.contains('storedAt')) store.createIndex('storedAt', 'storedAt', { unique: false });
      if (!store.indexNames.contains('lastAccessedAt')) store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };

    request.onerror = () => {
      databasePromise = null;
      resolve(null);
    };

    request.onblocked = () => {
      databasePromise = null;
      resolve(null);
    };
  });

  return databasePromise;
}

async function readPersistent(key) {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function flushQueuedWrites() {
  writeFlushScheduled = false;
  if (!queuedWrites.size) return;

  const records = [...queuedWrites.values()];
  queuedWrites.clear();
  const database = await openDatabase();
  if (!database) return;

  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      records.forEach((record) => store.put(record));
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    } catch {
      resolve();
    }
  });
}

function queuePersistentWrite(record) {
  queuedWrites.set(record.key, record);
  if (writeFlushScheduled) return;
  writeFlushScheduled = true;

  const schedule = globalThis.queueMicrotask
    ? (callback) => globalThis.queueMicrotask(callback)
    : (callback) => setTimeout(callback, 0);

  schedule(() => {
    activeWritePromise = activeWritePromise.then(() => flushQueuedWrites());
    void activeWritePromise;
  });
}

async function deleteMatching(predicate) {
  await activeWritePromise.catch(() => {});
  for (const [key, value] of memoryCache.entries()) {
    if (predicate(value)) memoryCache.delete(key);
  }
  for (const [key, value] of queuedWrites.entries()) {
    if (predicate(value)) queuedWrites.delete(key);
  }

  const database = await openDatabase();
  if (!database) return;

  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        if (predicate(current.value)) current.delete();
        current.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    } catch {
      resolve();
    }
  });
}

async function readCache(url, scope = currentCacheScope()) {
  const key = cacheKey(url, scope);
  if (memoryCache.has(key)) {
    const record = memoryCache.get(key);
    record.lastAccessedAt = Date.now();
    return record;
  }

  const record = await readPersistent(key);
  if (memoryCache.has(key)) return memoryCache.get(key);
  if (!record || record.scope !== scope || record.schema !== CACHE_SCHEMA) return null;
  record.lastAccessedAt = Date.now();
  memoryCache.set(key, record);
  return record;
}

function stableJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function canUseStaleFallback(error) {
  const status = Number(error?.status || 0);
  return !status || status >= 500;
}

function emitDataUpdated(record) {
  if (typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent?.(new CustomEvent('chronicle:data-updated', {
      detail: { url: record.url, tags: record.tags, data: record.data },
    }));
  }
}

function broadcastCacheEvent(message) {
  const payload = { ...message, source: globalThis.crypto?.randomUUID?.() || String(Date.now()), sentAt: Date.now() };
  try {
    cacheChannel?.postMessage(payload);
  } catch {
    // Cross-tab synchronization remains optional.
  }
  writeLocalValue(CACHE_EVENT_KEY, JSON.stringify(payload));
}

function updateCache(url, data, tags = [], scope = currentCacheScope(), expectedEpoch = cacheEpoch) {
  if (expectedEpoch !== cacheEpoch) return null;

  const now = Date.now();
  const key = cacheKey(url, scope);
  const previous = memoryCache.get(key) || null;
  const record = {
    key,
    schema: CACHE_SCHEMA,
    scope,
    url: normalizedUrl(url),
    tags: uniqueValues([...routeTags(url), ...tags]),
    storedAt: now,
    lastAccessedAt: now,
    fingerprint: stableJson(data),
    data,
  };

  memoryCache.set(key, record);
  queuePersistentWrite(record);
  writeLocalValue(`chronicle-cache-last-sync:${scope}`, now);

  const changed = !previous || previous.fingerprint !== record.fingerprint;
  if (changed) {
    emitDataUpdated(record);
    broadcastCacheEvent({ type: 'updated', scope, key, url: record.url, tags: record.tags });
  }
  return { record, changed };
}

function splitRequestOptions(options = {}) {
  const { chronicleCache = null, ...fetchOptions } = options || {};
  return { cacheOptions: chronicleCache || {}, fetchOptions };
}

async function fetchJson(url, options = {}, scope = currentCacheScope()) {
  const method = String(options.method || 'GET').toUpperCase();
  const dedupeKey = method === 'GET' ? `${scope}::${normalizedUrl(url)}` : '';
  if (dedupeKey && pendingRequests.has(dedupeKey)) return pendingRequests.get(dedupeKey);

  const task = (async () => {
    const controller = options.signal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 30_000) : null;
    let response;

    try {
      response = await authenticatedFetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.errors?.join(' ') || 'Não foi possível concluir a solicitação.');
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload;
  })();

  if (dedupeKey) pendingRequests.set(dedupeKey, task);
  try {
    return await task;
  } finally {
    if (dedupeKey) pendingRequests.delete(dedupeKey);
  }
}

async function revalidate(url, fetchOptions, cacheOptions, previousRecord = null, scope = currentCacheScope()) {
  const epoch = cacheEpoch;
  const data = await fetchJson(url, fetchOptions, scope);
  const result = updateCache(url, data, cacheOptions.tags || [], scope, epoch);
  if (result?.changed && typeof cacheOptions.onUpdate === 'function') cacheOptions.onUpdate(data);
  return data;
}

async function networkFirstRequest(url, fetchOptions, cacheOptions = {}) {
  const scope = currentCacheScope();
  const recordPromise = readCache(url, scope);
  const epoch = cacheEpoch;

  try {
    const data = await fetchJson(url, fetchOptions, scope);
    const result = updateCache(url, data, cacheOptions.tags || [], scope, epoch);
    if (result?.changed && typeof cacheOptions.onUpdate === 'function') cacheOptions.onUpdate(data);
    return data;
  } catch (error) {
    const record = await recordPromise;
    const staleForMs = Math.max(0, Number(cacheOptions.staleForMs ?? DEFAULT_STALE_MS));
    const age = record ? Date.now() - Number(record.storedAt || 0) : Number.POSITIVE_INFINITY;
    if (canUseStaleFallback(error) && record && age <= staleForMs) return record.data;
    throw error;
  }
}

export async function requestJson(url, options = {}) {
  const { cacheOptions, fetchOptions } = splitRequestOptions(options);
  const method = String(fetchOptions.method || 'GET').toUpperCase();

  if (method === 'GET') {
    const policy = { ...routePolicy(url), ...cacheOptions };
    if (policy.mode === 'network-only') return fetchJson(url, fetchOptions);
    if (policy.mode === 'cache-first' || policy.mode === 'stale-while-revalidate') {
      return cachedRequestJson(url, { ...policy, request: fetchOptions });
    }
    return networkFirstRequest(url, fetchOptions, policy);
  }

  const data = await fetchJson(url, fetchOptions);
  if (cacheOptions.invalidate !== false) {
    const automatic = mutationInvalidation(url);
    const configured = typeof cacheOptions.invalidate === 'object' ? cacheOptions.invalidate : {};
    const tags = uniqueValues([...(automatic.tags || []), ...(configured.tags || [])]);
    const prefixes = uniqueValues([...(automatic.prefixes || []), ...(configured.prefixes || [])]);
    if (tags.length || prefixes.length) await invalidateApiCache({ tags, prefixes });
  }
  return data;
}

export async function cachedRequestJson(url, cacheOptions = {}) {
  const options = cacheOptions.request || {};
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') return requestJson(url, { ...options, chronicleCache: cacheOptions });

  const scope = currentCacheScope();
  const freshForMs = Math.max(0, Number(cacheOptions.freshForMs ?? DEFAULT_FRESH_MS));
  const staleForMs = Math.max(freshForMs, Number(cacheOptions.staleForMs ?? DEFAULT_STALE_MS));
  const forceRefresh = Boolean(cacheOptions.forceRefresh);
  const record = await readCache(url, scope);
  const age = record ? Date.now() - Number(record.storedAt || 0) : Number.POSITIVE_INFINITY;

  if (!forceRefresh && record && age <= staleForMs) {
    if (age > freshForMs && globalThis.navigator?.onLine !== false) {
      void revalidate(url, options, cacheOptions, record, scope).catch(() => {
        // The stale value remains usable while the network is unavailable.
      });
    }
    return record.data;
  }

  try {
    return await revalidate(url, options, cacheOptions, record, scope);
  } catch (error) {
    if (canUseStaleFallback(error) && record) return record.data;
    throw error;
  }
}

export async function readCachedJson(url, { scope = currentCacheScope(), staleForMs = DEFAULT_STALE_MS } = {}) {
  const record = await readCache(url, scope);
  if (!record) return null;
  if (Date.now() - Number(record.storedAt || 0) > Math.max(0, Number(staleForMs))) return null;
  return record.data;
}

export function writeCachedJson(url, data, { tags = [], scope = currentCacheScope() } = {}) {
  return updateCache(url, data, tags, scope)?.record?.data ?? data;
}

export async function invalidateApiCache({ tags = [], prefixes = [], scope = currentCacheScope(), broadcast = true } = {}) {
  cacheEpoch += 1;
  const normalizedTags = new Set(uniqueValues(tags));
  const normalizedPrefixes = uniqueValues(prefixes);

  await deleteMatching((record) => {
    if (scope && record.scope !== scope) return false;
    if (normalizedPrefixes.some((prefix) => String(record.url || '').startsWith(prefix))) return true;
    return Array.isArray(record.tags) && record.tags.some((tag) => normalizedTags.has(tag));
  });

  if (broadcast) {
    broadcastCacheEvent({
      type: 'invalidate',
      scope,
      tags: [...normalizedTags],
      prefixes: normalizedPrefixes,
    });
  }
}

export async function clearCurrentUserCache(scope = currentCacheScope(), { broadcast = true } = {}) {
  cacheEpoch += 1;
  await deleteMatching((record) => record.scope === scope);
  if (broadcast) broadcastCacheEvent({ type: 'clear-scope', scope });
}

export async function pruneApiCache({ maxAgeMs = MAX_RECORD_AGE_MS, maxRecordsPerScope = MAX_RECORDS_PER_SCOPE } = {}) {
  const database = await openDatabase();
  if (!database) return;
  const now = Date.now();
  const grouped = new Map();

  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const record = current.value;
        const storedAt = Number(record.storedAt || 0);
        if (!storedAt || now - storedAt > maxAgeMs || record.schema !== CACHE_SCHEMA) {
          memoryCache.delete(record.key);
          current.delete();
        } else {
          const records = grouped.get(record.scope) || [];
          records.push({ key: record.key, lastAccessedAt: Number(record.lastAccessedAt || storedAt) });
          grouped.set(record.scope, records);
        }
        current.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    } catch {
      resolve();
    }
  });

  const overflowKeys = [];
  for (const records of grouped.values()) {
    records.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt);
    overflowKeys.push(...records.slice(maxRecordsPerScope).map((record) => record.key));
  }
  if (!overflowKeys.length) return;
  const overflow = new Set(overflowKeys);
  await deleteMatching((record) => overflow.has(record.key));
}

export function debounceRefresh(callback, delayMs = 150) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delayMs);
  };
}

function handleExternalCacheEvent(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'updated' && message.key) {
    memoryCache.delete(message.key);
    return;
  }

  if (message.type === 'invalidate') {
    void invalidateApiCache({
      tags: message.tags || [],
      prefixes: message.prefixes || [],
      scope: message.scope || '',
      broadcast: false,
    });
    return;
  }

  if (message.type === 'clear-scope' && message.scope) {
    void clearCurrentUserCache(message.scope, { broadcast: false });
  }
}

if ('BroadcastChannel' in globalThis) {
  try {
    cacheChannel = new BroadcastChannel(CACHE_CHANNEL_NAME);
    cacheChannel.addEventListener('message', (event) => handleExternalCacheEvent(event.data));
  } catch {
    cacheChannel = null;
  }
}

globalThis.addEventListener?.('storage', (event) => {
  if (event.key !== CACHE_EVENT_KEY || !event.newValue) return;
  try {
    handleExternalCacheEvent(JSON.parse(event.newValue));
  } catch {
    // Ignore invalid cross-tab cache metadata.
  }
});

globalThis.addEventListener?.('chronicle:session-cleared', (event) => {
  const scope = String(event?.detail?.scope || '');
  if (scope) void clearCurrentUserCache(scope);
  else memoryCache.clear();
});

globalThis.addEventListener?.('online', () => {
  if (typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent?.(new CustomEvent('chronicle:network-restored'));
  }
});

globalThis.__chronicleClearDataCache = clearCurrentUserCache;

if (readLocalValue(CACHE_SCHEMA_KEY) !== CACHE_SCHEMA) {
  writeLocalValue(CACHE_SCHEMA_KEY, CACHE_SCHEMA);
}

const lastCleanup = Number(readLocalValue(CACHE_CLEANUP_KEY) || 0);
if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
  writeLocalValue(CACHE_CLEANUP_KEY, Date.now());
  const schedule = globalThis.requestIdleCallback
    ? (callback) => globalThis.requestIdleCallback(callback, { timeout: 1500 })
    : (callback) => setTimeout(callback, 250);
  schedule(() => { void pruneApiCache(); });
}
