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
let library = [];
let campaigns = [];

function updatePreview() { preview.innerHTML = markdownToHtml(editor.value || '') || '<p class="muted">Preview appears here.</p>'; }
editor.addEventListener('input', updatePreview);

function resetEditor() { workingName.value = ''; workingFileId.value = ''; editor.value = ''; updatePreview(); feedback.innerHTML = ''; }
document.querySelector('#new-lore-button').addEventListener('click', resetEditor);

document.querySelector('#markdown-file-input').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.md')) { feedback.innerHTML = '<div class="alert error">Only Markdown (.md) files are supported.</div>'; event.currentTarget.value = ''; return; }
  editor.value = await file.text();
  if (!workingName.value) workingName.value = file.name.replace(/\.md$/i, '');
  if (!workingFileId.value) workingFileId.value = file.name.replace(/\.md$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  updatePreview();
});

document.querySelector('#download-markdown-button').addEventListener('click', () => downloadMarkdown(workingFileId.value || workingName.value, editor.value));

async function saveLore(payload) {
  feedback.innerHTML = '<div class="status-badge pending">Saving...</div>';
  try {
    const item = await requestJson('/api/dm/lore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    workingName.value = item.name;
    workingFileId.value = item.fileId;
    feedback.innerHTML = `<div class="alert success">${item.scope === 'personal' ? 'Personal lore saved.' : 'Lore published.'}</div>`;
    await loadLibrary();
    return item;
  } catch (error) { feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; return null; }
}

document.querySelector('#save-personal-button').addEventListener('click', async () => {
  const name = workingName.value.trim();
  const fileId = workingFileId.value.trim();
  if (!name || !fileId) { feedback.innerHTML = '<div class="alert error">Working Name and Working File ID are required for personal lore.</div>'; return; }
  await saveLore({ name, fileId, markdownContent: editor.value, scope: 'personal' });
});

function openPublishDialog() {
  publishForm.elements.name.value = workingName.value;
  publishForm.elements.fileId.value = workingFileId.value;
  publishDialog.showModal ? publishDialog.showModal() : publishDialog.setAttribute('open', '');
}
function closePublishDialog() { publishDialog.close ? publishDialog.close() : publishDialog.removeAttribute('open'); }
document.querySelector('#publish-lore-button').addEventListener('click', openPublishDialog);
document.querySelectorAll('[data-close-publish]').forEach((button) => button.addEventListener('click', closePublishDialog));

publishForm.elements.scope.addEventListener('change', () => {
  const campaign = publishForm.elements.scope.value === 'campaign';
  campaignField.hidden = !campaign;
  insertNotesField.hidden = !campaign;
  publishForm.elements.campaignId.required = campaign;
});

publishForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(publishForm);
  const item = await saveLore({
    name: data.get('name'), fileId: data.get('fileId'), markdownContent: editor.value,
    scope: data.get('scope'), campaignId: data.get('campaignId'),
    insertIntoPlayerNotes: data.get('insertIntoPlayerNotes') === 'on',
    eventDate: data.get('eventDate'), factions: data.get('factions'),
  });
  if (item) { closePublishDialog(); workingName.value = item.name; workingFileId.value = item.fileId; }
});

function openItem(item) {
  workingName.value = item.name;
  workingFileId.value = item.fileId;
  editor.value = item.markdownContent || '';
  updatePreview();
  feedback.innerHTML = `<div class="status-badge ${item.isPublished ? 'ok' : 'pending'}">${escapeHtml(item.scope)} · ${item.isPublished ? 'published' : 'private'}</div>`;
}

function renderLibrary() {
  if (!library.length) { list.innerHTML = '<div class="empty-state">No lore documents found.</div>'; return; }
  list.innerHTML = library.map((item, index) => `<button type="button" class="gm-lore-row" data-lore-index="${index}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.fileId)}</small></span><em>${escapeHtml(item.scope)}${item.campaignName ? ` · ${escapeHtml(item.campaignName)}` : ''}</em></button>`).join('');
  document.querySelectorAll('[data-lore-index]').forEach((button) => button.addEventListener('click', () => openItem(library[Number(button.dataset.loreIndex)])));
}

async function loadLibrary() {
  const q = document.querySelector('#gm-lore-search').value.trim();
  const scope = document.querySelector('#gm-lore-scope').value;
  const payload = await requestJson(`/api/dm/lore?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`);
  library = payload.items || [];
  renderLibrary();
}

document.querySelector('#gm-lore-search-form').addEventListener('submit', (event) => { event.preventDefault(); loadLibrary().catch((error) => { list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }); });

async function boot() {
  if (!await initializeGmShell('lore')) return;
  try {
    const [campaignPayload] = await Promise.all([requestJson('/api/dm/campaigns'), loadLibrary()]);
    campaigns = campaignPayload.items || [];
    publishForm.elements.campaignId.innerHTML = '<option value="">Choose campaign</option>' + campaigns.map((campaign) => `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`).join('');
    const requested = new URLSearchParams(location.search).get('fileId');
    if (requested) { const item = library.find((entry) => entry.fileId === requested); if (item) openItem(item); }
  } catch (error) { list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }
  updatePreview();
}
boot();
