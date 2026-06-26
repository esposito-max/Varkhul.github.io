import { escapeHtml, initializeGmShell, requestJson } from './gm-common.js';
const grid = document.querySelector('#gm-campaign-grid');
const dialog = document.querySelector('#campaign-create-dialog');
const form = document.querySelector('#campaign-create-form');
const fileInput = document.querySelector('#campaign-banner-input');
const preview = document.querySelector('#campaign-banner-preview');
const feedback = document.querySelector('#campaign-create-feedback');

function openDialog() { dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', ''); }
function closeDialog() { dialog.close ? dialog.close() : dialog.removeAttribute('open'); }

document.querySelector('#create-campaign-button').addEventListener('click', openDialog);
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  feedback.innerHTML = '<div class="status-badge pending">Uploading banner...</div>';
  try {
    const payload = await requestJson('/api/uploads/campaign-banners', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    form.elements.bannerPath.value = payload.path;
    preview.src = payload.path;
    preview.hidden = false;
    feedback.innerHTML = '<div class="alert success">Banner uploaded.</div>';
  } catch (error) {
    fileInput.value = '';
    preview.hidden = true;
    feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  let rules;
  try { rules = JSON.parse(String(data.get('homebrewRules') || '{}')); }
  catch { feedback.innerHTML = '<div class="alert error">Homebrew Rules must contain valid JSON.</div>'; return; }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const campaign = await requestJson('/api/dm/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: data.get('name'), startingLevel: Number(data.get('startingLevel')), description: data.get('description'), homebrewRules: rules, bannerPath: data.get('bannerPath') }) });
    location.href = `/dm-campaign.html?id=${campaign.id}`;
  } catch (error) { feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; submit.disabled = false; }
});

function renderCampaigns(items) {
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No campaigns have been created.</div>'; return; }
  grid.innerHTML = items.map((campaign) => `<a class="campaign-card gm-campaign-card" href="/dm-campaign.html?id=${campaign.id}" ${campaign.bannerPath ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"` : ''}><span class="campaign-card-overlay"></span><span class="campaign-card-content"><span class="eyebrow">Campaign</span><strong>${escapeHtml(campaign.name)}</strong><small>${campaign.playerCount} players · ${campaign.characterCount} characters · starting level ${campaign.startingLevel}</small><span class="gm-campaign-flags">${campaign.activeEncounterCount ? '<em>Active encounter</em>' : ''}${campaign.unreadMessageCount ? `<em>${campaign.unreadMessageCount} unread</em>` : ''}${campaign.pendingRequestCount ? `<em>${campaign.pendingRequestCount} requests</em>` : ''}</span></span></a>`).join('');
}

async function boot() {
  if (!await initializeGmShell('campaigns')) return;
  try { const payload = await requestJson('/api/dm/campaigns'); renderCampaigns(payload.items || []); }
  catch (error) { grid.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }
  if (new URLSearchParams(location.search).get('create') === '1') openDialog();
}
boot();
