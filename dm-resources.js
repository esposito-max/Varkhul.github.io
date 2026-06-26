import { entityLabels, escapeHtml, initializeGmShell, requestJson } from './gm-common.js';
const form = document.querySelector('#gm-resource-search');
const results = document.querySelector('#gm-resource-results');
const dialog = document.querySelector('#resource-dialog');
const detail = document.querySelector('#resource-dialog-content');
let items = [];

function render() {
  if (!items.length) { results.innerHTML = '<div class="empty-state">No matching resources.</div>'; return; }
  results.innerHTML = items.map((item, index) => `<button type="button" class="resource-card" data-resource-index="${index}"><span class="eyebrow">${escapeHtml(entityLabels[item.type] || item.type)}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.source || '')}${item.page ? ` · p.${item.page}` : ''}</small><p>${escapeHtml(item.description || 'No summary available.')}</p></button>`).join('');
  document.querySelectorAll('[data-resource-index]').forEach((button) => button.addEventListener('click', () => {
    const item = items[Number(button.dataset.resourceIndex)];
    detail.innerHTML = `<header><p class="eyebrow">${escapeHtml(entityLabels[item.type] || item.type)}</p><h2>${escapeHtml(item.name)}</h2><div><span>${escapeHtml(item.category || '')}</span><strong>${escapeHtml(item.source || '')}${item.page ? ` p.${item.page}` : ''}</strong></div></header><div class="reference-divider"></div><p>${escapeHtml(item.description || 'No summary available.')}</p><details><summary>Raw source data</summary><pre>${escapeHtml(JSON.stringify(item.payload || {}, null, 2))}</pre></details>`;
    dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', '');
  }));
}

async function search() {
  const data = new FormData(form);
  results.innerHTML = '<div class="empty-state">Searching...</div>';
  const payload = await requestJson(`/api/dm/resources?q=${encodeURIComponent(data.get('q') || '')}&type=${encodeURIComponent(data.get('type') || '')}&limit=120`);
  items = payload.items || [];
  render();
}
form.addEventListener('submit', (event) => { event.preventDefault(); search().catch((error) => { results.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }); });
async function boot() {
  if (!await initializeGmShell('resources')) return;
}
boot();
