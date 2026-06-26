import { escapeHtml, formatDate, initializeGmShell, requestJson } from './gm-common.js';

const statGrid = document.querySelector('#gm-stat-grid');
const recentCampaigns = document.querySelector('#recent-campaigns');
const recentLore = document.querySelector('#recent-gm-lore');
const requestList = document.querySelector('#dm-request-list');

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
      await loadRequests();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }));
}

async function loadRequests() {
  const payload = await requestJson('/api/dm/item-requests?status=pending');
  renderRequests(payload.items || []);
}

async function boot() {
  if (!await initializeGmShell('home')) return;
  try {
    const [dashboard] = await Promise.all([requestJson('/api/dm/dashboard'), loadRequests()]);
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
  } catch (error) {
    statGrid.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

boot();
