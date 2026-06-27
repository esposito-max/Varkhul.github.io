import {
  displayValue,
  entityLabels,
  escapeHtml,
  initializeGmShell,
  cachedRequestJson,
  structuredDataToHtml,
} from './gm-common.js';

const form = document.querySelector('#gm-resource-search');
const results = document.querySelector('#gm-resource-results');
const dialog = document.querySelector('#resource-dialog');
const detail = document.querySelector('#resource-dialog-content');
let items = [];

function resourceType(item) {
  return entityLabels[item.type] || displayValue(item.category || item.type || 'Recurso');
}

function openResource(item) {
  detail.innerHTML = `<header><p class="eyebrow">${escapeHtml(resourceType(item))}</p><h2>${escapeHtml(item.name)}</h2><div><span>${escapeHtml(displayValue(item.category || ''))}</span><strong>${escapeHtml(item.source || '')}${item.page ? ` · página ${Number(item.page)}` : ''}</strong></div></header><div class="reference-divider"></div><p>${escapeHtml(item.description || 'Nenhum resumo disponível.')}</p><details><summary>Informações completas</summary>${structuredDataToHtml(item.payload || {}, { emptyMessage: 'Nenhuma informação adicional.' })}</details>`;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
}

function render() {
  if (!items.length) {
    results.innerHTML = '<div class="empty-state">Nenhum recurso correspondente.</div>';
    return;
  }
  results.innerHTML = items.map((item, index) => `<button type="button" class="resource-card" data-resource-index="${index}"><span class="eyebrow">${escapeHtml(resourceType(item))}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.source || '')}${item.page ? ` · página ${Number(item.page)}` : ''}</small><p>${escapeHtml(item.description || 'Nenhum resumo disponível.')}</p></button>`).join('');
  document.querySelectorAll('[data-resource-index]').forEach((button) => {
    button.addEventListener('click', () => openResource(items[Number(button.dataset.resourceIndex)]));
  });
}

async function search() {
  const data = new FormData(form);
  results.innerHTML = '<div class="empty-state">Pesquisando...</div>';
  const payload = await cachedRequestJson(`/api/dm/resources?q=${encodeURIComponent(data.get('q') || '')}&type=${encodeURIComponent(data.get('type') || '')}&limit=120`, {
    freshForMs: 24 * 60 * 60 * 1000,
    staleForMs: 30 * 24 * 60 * 60 * 1000,
    tags: ['rules-catalog'],
  });
  items = payload.items || [];
  render();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search().catch((error) => {
    results.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  });
});

async function boot() {
  await initializeGmShell('resources');
}

boot();
