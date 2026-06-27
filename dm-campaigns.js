import {
  addCampaignRule,
  collectCampaignRules,
  mountCampaignRuleBuilder,
} from './campaign-rules.js';
import { cachedRequestJson, escapeHtml, initializeGmShell, requestJson } from './gm-common.js';
import { debounceRefresh, invalidateApiCache } from './data-client.js';
import { subscribeToDatabaseChanges } from './realtime-client.js';

const grid = document.querySelector('#gm-campaign-grid');
const dialog = document.querySelector('#campaign-create-dialog');
const form = document.querySelector('#campaign-create-form');
const fileInput = document.querySelector('#campaign-banner-input');
const preview = document.querySelector('#campaign-banner-preview');
const feedback = document.querySelector('#campaign-create-feedback');
const rulesContainer = document.querySelector('#campaign-create-rules');
let campaignsSubscription = null;

function openDialog() {
  form.reset();
  preview.hidden = true;
  preview.removeAttribute('src');
  feedback.replaceChildren();
  mountCampaignRuleBuilder(rulesContainer, {});
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog() {
  if (dialog.close) dialog.close();
  else dialog.removeAttribute('open');
}

document.querySelector('#create-campaign-button').addEventListener('click', openDialog);
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', closeDialog);
});
document.querySelector('#campaign-create-add-rule').addEventListener('click', () => {
  addCampaignRule(rulesContainer, { label: 'Nova regra', type: 'text', value: '' });
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  feedback.innerHTML = '<div class="status-badge pending">Enviando imagem de capa...</div>';
  try {
    const payload = await requestJson('/api/uploads/campaign-banners', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    form.elements.bannerPath.value = payload.path;
    preview.src = payload.path;
    preview.hidden = false;
    feedback.innerHTML = '<div class="alert success">Imagem de capa enviada.</div>';
  } catch (error) {
    fileInput.value = '';
    preview.hidden = true;
    feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  feedback.innerHTML = '<div class="status-badge pending">Criando campanha...</div>';
  try {
    const data = new FormData(form);
    const campaign = await requestJson('/api/dm/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        startingLevel: Number(data.get('startingLevel')),
        description: data.get('description'),
        homebrewRules: collectCampaignRules(rulesContainer),
        bannerPath: data.get('bannerPath'),
      }),
    });
    await invalidateApiCache({ tags: ['dm-campaigns', 'dm-home'] });
    location.href = `./dm-campaign.html?id=${encodeURIComponent(campaign.id)}`;
  } catch (error) {
    feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
    submit.disabled = false;
  }
});

function plural(value, singular, pluralForm) {
  return `${Number(value || 0)} ${Number(value || 0) === 1 ? singular : pluralForm}`;
}

function renderCampaigns(items) {
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><h2>Nenhuma campanha criada</h2><p>Crie a primeira campanha para gerar um código de convite e começar a reunir personagens.</p></div>';
    return;
  }
  grid.innerHTML = items.map((campaign) => {
    const bannerStyle = campaign.bannerPath
      ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"`
      : '';
    const flags = [
      campaign.activeEncounterCount ? '<em>Encontro ativo</em>' : '',
      campaign.unreadMessageCount ? `<em>${plural(campaign.unreadMessageCount, 'mensagem não lida', 'mensagens não lidas')}</em>` : '',
      campaign.pendingRequestCount ? `<em>${plural(campaign.pendingRequestCount, 'solicitação pendente', 'solicitações pendentes')}</em>` : '',
    ].filter(Boolean).join('');
    return `<a class="campaign-card gm-campaign-card" href="./dm-campaign.html?id=${encodeURIComponent(campaign.id)}" ${bannerStyle}>
      <span class="campaign-card-overlay"></span>
      <span class="campaign-card-content">
        <span class="eyebrow">Campanha</span>
        <strong>${escapeHtml(campaign.name)}</strong>
        <small>${plural(campaign.playerCount, 'jogador', 'jogadores')} · ${plural(campaign.characterCount, 'personagem', 'personagens')} · nível inicial ${Number(campaign.startingLevel || 1)}</small>
        <span class="gm-campaign-flags">${flags}</span>
      </span>
    </a>`;
  }).join('');
}

async function loadCampaigns({ forceRefresh = false } = {}) {
  try {
    const payload = await cachedRequestJson('/api/dm/campaigns', {
      freshForMs: 15_000,
      staleForMs: 24 * 60 * 60 * 1000,
      forceRefresh,
      tags: ['dm-campaigns'],
      onUpdate: (next) => renderCampaigns(next.items || []),
    });
    renderCampaigns(payload.items || []);
  } catch (error) {
    grid.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

const refreshCampaigns = debounceRefresh(async () => {
  await invalidateApiCache({ tags: ['dm-campaigns', 'dm-home'] });
  await loadCampaigns({ forceRefresh: true });
}, 180);

async function boot() {
  if (!await initializeGmShell('campaigns')) return;
  await loadCampaigns();
  try {
    campaignsSubscription = await subscribeToDatabaseChanges({
      name: 'dm-campaigns',
      bindings: [
        { table: 'campaigns' },
        { table: 'character_campaigns' },
        { table: 'campaign_members' },
        { table: 'encounters' },
        { table: 'campaign_message_threads' },
        { table: 'item_authorization_requests' },
      ],
      onChange: refreshCampaigns,
      fallback: refreshCampaigns,
      fallbackIntervalMs: 30_000,
    });
  } catch {
    // Cached campaign cards remain available without realtime.
  }
  if (new URLSearchParams(location.search).get('create') === '1') openDialog();
}

window.addEventListener('beforeunload', () => { void campaignsSubscription?.unsubscribe(); });
boot();
