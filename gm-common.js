import { authenticatedFetch, initializeLogoutButtons, requireAuthenticatedPage } from './auth-client.js';
export const root = document.documentElement;

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function requestJson(url, options = {}) {
  const response = await authenticatedFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The request failed.');
  return payload;
}

export async function initializeGmShell(activeTab) {
  if (!await requireAuthenticatedPage('dm')) return false;
  initializeLogoutButtons();
  const saved = localStorage.getItem('chronicle-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const themeButton = document.querySelector('#theme-toggle');
  const updateTheme = () => {
    if (!themeButton) return;
    themeButton.textContent = root.dataset.theme === 'light' ? 'Use Dark Mode' : 'Use Light Mode';
  };
  updateTheme();
  themeButton?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('chronicle-theme', root.dataset.theme);
    updateTheme();
  });
  document.querySelectorAll('[data-gm-tab]').forEach((link) => {
    link.classList.toggle('active', link.dataset.gmTab === activeTab);
  });
  return true;
}

export function markdownToHtml(value) {
  const safe = escapeHtml(value).replace(/\r\n?/g, '\n');
  const lines = safe.split('\n');
  let html = '';
  let listOpen = false;
  const inline = (line) => line
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const target = String(href).trim();
      const lower = target.toLowerCase();
      const allowed = target.startsWith('/') || target.startsWith('#') || lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:');
      return allowed ? `<a href="${target}"${lower.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>` : label;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (listOpen) { html += '</ul>'; listOpen = false; }
    if (!line) continue;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
    } else {
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (listOpen) html += '</ul>';
  return html;
}

export function downloadMarkdown(filename, content) {
  const safeName = String(filename || 'lore-document').replace(/[^A-Za-z0-9_-]+/g, '-') || 'lore-document';
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function currentId() {
  return new URLSearchParams(location.search).get('id') || '';
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export const entityLabels = {
  class: 'Class', subclass: 'Subclass', race: 'Species', background: 'Background',
  feat: 'Feat', spell: 'Spell', item: 'Item', baseitem: 'Base Item',
  variantrule: 'Variant Rule', skill: 'Skill', condition: 'Condition',
  monster: 'Creature', creature: 'Creature', optionalfeature: 'Optional Feature',
};
