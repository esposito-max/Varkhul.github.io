import { downloadMarkdown, escapeHtml, initializeGmShell, markdownToHtml, requestJson } from './gm-common.js';

const list = document.querySelector('#gm-lore-list');
const editor = document.querySelector('#markdown-editor');
const preview = document.querySelector('#markdown-preview');
const workingName = document.querySelector('#working-name');
const workingFileId = document.querySelector('#working-file-id');
const feedback = document.querySelector('#gm-lore-feedback');
const publishDialog = document.querySelector('#publish-lore-dialog');
const publishForm = document.querySelector('#publish-lore-form');
const campaignField = document.querySelector('#publish-campaign-field');
const insertNotesField = document.querySelector('#insert-notes-field');
const scopeLabels = { general: 'Lore geral', campaign: 'Lore da campanha', personal: 'Lore pessoal' };
let library = [];
let campaigns = [];

function updatePreview() {
  preview.innerHTML = markdownToHtml(editor.value || '') || '<p class="muted">A prévia aparecerá aqui.</p>';
}

function resetEditor() {
  workingName.value = '';
  workingFileId.value = '';
  editor.value = '';
  updatePreview();
  feedback.replaceChildren();
  editor.focus();
}

function slugifyFileId(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

editor.addEventListener('input', updatePreview);
document.querySelector('#new-lore-button').addEventListener('click', resetEditor);

document.querySelector('#markdown-file-input').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.md')) {
    feedback.innerHTML = '<div class="alert error">Selecione um arquivo Markdown com extensão .md.</div>';
    event.currentTarget.value = '';
    return;
  }
  editor.value = await file.text();
  const baseName = file.name.replace(/\.md$/i, '');
  if (!workingName.value) workingName.value = baseName;
  if (!workingFileId.value) workingFileId.value = slugifyFileId(baseName);
  updatePreview();
});

document.querySelector('#download-markdown-button').addEventListener('click', () => {
  downloadMarkdown(workingFileId.value || workingName.value || 'lore', editor.value);
});

async function saveLore(payload) {
  feedback.innerHTML = '<div class="status-badge pending">Salvando...</div>';
  try {
    const item = await requestJson('/api/dm/lore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    workingName.value = item.name;
    workingFileId.value = item.fileId;
    feedback.innerHTML = `<div class="alert success">${item.scope === 'personal' ? 'Lore pessoal salva.' : 'Lore publicada.'}</div>`;
    await loadLibrary();
    return item;
  } catch (error) {
    feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
    return null;
  }
}

document.querySelector('#save-personal-button').addEventListener('click', async () => {
  const name = workingName.value.trim();
  const fileId = workingFileId.value.trim();
  if (!name || !fileId) {
    feedback.innerHTML = '<div class="alert error">Informe o nome e o identificador do arquivo.</div>';
    return;
  }
  await saveLore({ name, fileId, markdownContent: editor.value, scope: 'personal' });
});

function openPublishDialog() {
  publishForm.elements.name.value = workingName.value;
  publishForm.elements.fileId.value = workingFileId.value || slugifyFileId(workingName.value);
  publishForm.elements.scope.dispatchEvent(new Event('change'));
  if (publishDialog.showModal) publishDialog.showModal();
  else publishDialog.setAttribute('open', '');
}

function closePublishDialog() {
  if (publishDialog.close) publishDialog.close();
  else publishDialog.removeAttribute('open');
}

document.querySelector('#publish-lore-button').addEventListener('click', openPublishDialog);
document.querySelectorAll('[data-close-publish]').forEach((button) => button.addEventListener('click', closePublishDialog));

publishForm.elements.scope.addEventListener('change', () => {
  const campaignScope = publishForm.elements.scope.value === 'campaign';
  campaignField.hidden = !campaignScope;
  insertNotesField.hidden = !campaignScope;
  publishForm.elements.campaignId.required = campaignScope;
});

publishForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = publishForm.querySelector('[type="submit"]');
  submit.disabled = true;
  const data = new FormData(publishForm);
  const item = await saveLore({
    name: data.get('name'),
    fileId: data.get('fileId'),
    markdownContent: editor.value,
    scope: data.get('scope'),
    campaignId: data.get('campaignId'),
    insertIntoPlayerNotes: data.get('insertIntoPlayerNotes') === 'on',
    eventDate: data.get('eventDate'),
    factions: data.get('factions'),
  });
  submit.disabled = false;
  if (item) {
    closePublishDialog();
    workingName.value = item.name;
    workingFileId.value = item.fileId;
  }
});

function openItem(item) {
  workingName.value = item.name;
  workingFileId.value = item.fileId;
  editor.value = item.markdownContent || '';
  updatePreview();
  const visibility = item.isPublished ? 'publicada' : 'privada';
  feedback.innerHTML = `<div class="status-badge ${item.isPublished ? 'ok' : 'pending'}">${escapeHtml(scopeLabels[item.scope] || item.scope)} · ${visibility}</div>`;
}

function renderLibrary() {
  if (!library.length) {
    list.innerHTML = '<div class="empty-state">Nenhum documento de lore encontrado.</div>';
    return;
  }
  list.innerHTML = library.map((item, index) => `<button type="button" class="gm-lore-row" data-lore-index="${index}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.fileId)}</small></span><em>${escapeHtml(scopeLabels[item.scope] || item.scope)}${item.campaignName ? ` · ${escapeHtml(item.campaignName)}` : ''}</em></button>`).join('');
  document.querySelectorAll('[data-lore-index]').forEach((button) => {
    button.addEventListener('click', () => openItem(library[Number(button.dataset.loreIndex)]));
  });
}

async function loadLibrary() {
  const q = document.querySelector('#gm-lore-search').value.trim();
  const scope = document.querySelector('#gm-lore-scope').value;
  const payload = await requestJson(`/api/dm/lore?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`);
  library = payload.items || [];
  renderLibrary();
}

document.querySelector('#gm-lore-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadLibrary().catch((error) => {
    list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  });
});

async function boot() {
  if (!await initializeGmShell('lore')) return;
  try {
    const [campaignPayload] = await Promise.all([requestJson('/api/dm/campaigns'), loadLibrary()]);
    campaigns = campaignPayload.items || [];
    publishForm.elements.campaignId.innerHTML = '<option value="">Selecione uma campanha</option>' + campaigns.map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)}</option>`).join('');
    const requested = new URLSearchParams(location.search).get('fileId');
    if (requested) {
      const item = library.find((entry) => entry.fileId === requested);
      if (item) openItem(item);
    }
  } catch (error) {
    list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
  updatePreview();
}

boot();
