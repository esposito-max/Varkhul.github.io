import {
  authenticatedFetch,
  initializeLogoutButtons,
  requireAuthenticatedPage,
} from './auth-client.js';
import { escapeHtml, markdownToHtml } from './gm-common.js';

const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const list = document.querySelector('#lore-list');
const reader = document.querySelector('#lore-reader');
const form = document.querySelector('#lore-search-form');
const input = document.querySelector('#lore-search-input');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const lorePageLayout = document.querySelector('#lore-page-layout');

async function requestJson(url) {
  const response = await authenticatedFetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível concluir a solicitação.');
  }
  return payload;
}

function initializeTheme() {
  const saved = localStorage.getItem('chronicle-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const light = root.dataset.theme === 'light';
  themeButton.textContent = light ? 'Usar tema escuro' : 'Usar tema claro';
  themeButton.setAttribute('aria-pressed', String(light));
}

themeButton.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
  initializeTheme();
});

sidebarToggle?.addEventListener('click', () => {
  const collapsed = lorePageLayout.classList.toggle('sidebar-collapsed');
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.textContent = collapsed ? 'Mostrar menu' : 'Ocultar menu';
});

async function loadList(query = '') {
  try {
    const payload = await requestJson(`/api/lore?q=${encodeURIComponent(query)}`);
    const items = payload.items || [];
    list.innerHTML = items.length
      ? items.map((item) => `<button type="button" class="lore-list-item" data-slug="${escapeHtml(item.slug)}">
          <span class="eyebrow">${escapeHtml(item.category || 'Lore')}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.excerpt || '')}</small>
        </button>`).join('')
      : '<div class="empty-state">Nenhuma página revelada foi encontrada.</div>';
    document.querySelectorAll('[data-slug]').forEach((button) => {
      button.addEventListener('click', () => openLore(button.dataset.slug));
    });
    return items;
  } catch (error) {
    list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
    return [];
  }
}

async function openLore(slug) {
  try {
    reader.innerHTML = '<div class="empty-state">Abrindo página...</div>';
    const item = await requestJson(`/api/lore/${encodeURIComponent(slug)}`);
    reader.innerHTML = `<header>
        <p class="eyebrow">${escapeHtml(item.category || 'Lore')}</p>
        <h2>${escapeHtml(item.title)}</h2>
        ${item.tags?.length ? `<div class="lore-tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </header>
      <div class="lore-content">${markdownToHtml(item.content || '')}</div>`;
    history.replaceState(null, '', `./lore.html?slug=${encodeURIComponent(slug)}`);
  } catch (error) {
    reader.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadList(input.value.trim());
});

async function boot() {
  if (!await requireAuthenticatedPage('player')) return;
  initializeLogoutButtons();
  initializeTheme();
  const items = await loadList();
  const requested = new URLSearchParams(location.search).get('slug');
  if (requested) {
    await openLore(requested);
  } else if (items.length) {
    await openLore(items[0].slug);
  }
}

boot();
