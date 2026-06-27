import { cachedRequestJson, escapeHtml, formatDate, initializeGmShell, requestJson } from './gm-common.js';
import { debounceRefresh, invalidateApiCache } from './data-client.js';
import { subscribeToDatabaseChanges } from './realtime-client.js';

const statGrid = document.querySelector('#gm-stat-grid');
const recentCampaigns = document.querySelector('#recent-campaigns');
const recentLore = document.querySelector('#recent-gm-lore');
const requestList = document.querySelector('#dm-request-list');
let dashboardSubscription = null;

const loreScopeLabels = {
  general: 'Lore geral',
  campaign: 'Lore da campanha',
  personal: 'Lore pessoal',
};

function statCard(label, value, href) {
  return `<a class="gm-stat-card" href="${href}"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></a>`;
}

function renderRequests(items) {
  if (!items.length) {
    requestList.innerHTML = '<div class="empty-state">Nenhuma solicitação pendente.</div>';
    return;
  }
  requestList.innerHTML = `<div class="dm-request-grid">${items.slice(0, 8).map((request) => `
    <article class="dm-request-card">
      <div><p class="eyebrow">${escapeHtml(request.campaignName || 'Sem campanha')}</p><h3>${escapeHtml(request.item.name)}</h3><p>${escapeHtml(request.playerName)} — ${escapeHtml(request.characterName)}</p><small>Quantidade: ${Number(request.item.quantity || 1)} · ${formatDate(request.createdAt)}</small></div>
      <div class="inline-actions"><button class="secondary-button" type="button" data-review="reject" data-id="${escapeHtml(request.id)}">Rejeitar</button><button class="primary-button" type="button" data-review="approve" data-id="${escapeHtml(request.id)}">Aprovar</button></div>
    </article>`).join('')}</div>`;
  document.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await requestJson(`/api/dm/item-requests/${encodeURIComponent(button.dataset.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: button.dataset.review === 'approve' }),
      });
      await invalidateApiCache({ tags: ['dm-home'] });
      await loadDashboard({ forceRefresh: true });
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }));
}

function renderDashboardSnapshot(snapshot = {}) {
  const dashboard = snapshot.dashboard || {};
  renderRequests(Array.isArray(snapshot.requests) ? snapshot.requests : []);
  statGrid.innerHTML = [
    statCard('Campanhas', dashboard.campaignCount, './dm-campaigns.html'),
    statCard('Encontros ativos', dashboard.activeEncounterCount, './dm-campaigns.html'),
    statCard('Mensagens não lidas', dashboard.unreadMessageCount, './dm-campaigns.html'),
    statCard('Solicitações pendentes', dashboard.pendingItemRequestCount, '#dm-request-list'),
  ].join('');
  recentCampaigns.innerHTML = dashboard.recentCampaigns?.length
    ? dashboard.recentCampaigns.map((item) => `<a class="gm-list-row" href="./dm-campaign.html?id=${encodeURIComponent(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${formatDate(item.updated_at)}</small></a>`).join('')
    : '<div class="empty-state">Nenhuma campanha criada.</div>';
  recentLore.innerHTML = dashboard.recentLore?.length
    ? dashboard.recentLore.map((item) => `<a class="gm-list-row" href="./dm-lore.html?fileId=${encodeURIComponent(item.file_id || '')}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(loreScopeLabels[item.lore_scope] || item.lore_scope || 'Lore')} · ${formatDate(item.updated_at)}</small></a>`).join('')
    : '<div class="empty-state">Nenhum documento de lore.</div>';
}

async function loadDashboard({ forceRefresh = false } = {}) {
  try {
    const snapshot = await cachedRequestJson('/api/dm/bootstrap', {
      freshForMs: 10_000,
      staleForMs: 24 * 60 * 60 * 1000,
      forceRefresh,
      tags: ['dm-home'],
      onUpdate: renderDashboardSnapshot,
    });
    renderDashboardSnapshot(snapshot);
  } catch (error) {
    statGrid.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

const refreshDashboard = debounceRefresh(async () => {
  await invalidateApiCache({ tags: ['dm-home'] });
  await loadDashboard({ forceRefresh: true });
}, 180);

async function boot() {
  if (!await initializeGmShell('home')) return;
  await loadDashboard();
  try {
    dashboardSubscription = await subscribeToDatabaseChanges({
      name: 'dm-home',
      bindings: [
        { table: 'campaigns' },
        { table: 'encounters' },
        { table: 'campaign_message_threads' },
        { table: 'item_authorization_requests' },
        { table: 'lore_entries' },
      ],
      onChange: refreshDashboard,
      fallback: refreshDashboard,
      fallbackIntervalMs: 30_000,
    });
  } catch {
    // Cached dashboard and explicit actions remain fully usable.
  }
}

window.addEventListener('beforeunload', () => { void dashboardSubscription?.unsubscribe(); });
boot();
