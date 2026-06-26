import {
  authenticatedFetch,
  initializeLogoutButtons,
  requireAuthenticatedPage,
} from './auth-client.js';

export const root = document.documentElement;

const DISPLAY_LABELS = {
  abilityDc: 'CD de habilidade',
  abilityModifiers: 'Modificadores de atributo',
  abilityScores: 'Valores de atributo',
  ac: 'Classe de Armadura',
  actions: 'Ações',
  armorClass: 'Classe de Armadura',
  background: 'Antecedente',
  bannerPath: 'Imagem de capa',
  category: 'Categoria',
  challengeRating: 'Nível de Desafio',
  class: 'Classe',
  className: 'Classe',
  components: 'Componentes',
  conditions: 'Condições',
  creatureHealthDisplay: 'Exibição dos pontos de vida',
  damage: 'Dano',
  description: 'Descrição',
  duration: 'Duração',
  enabled: 'Habilitada',
  eventDate: 'Data dos acontecimentos',
  factions: 'Facções envolvidas',
  false: 'Não',
  homebrewRules: 'Regras próprias',
  initiative: 'Iniciativa',
  item: 'Item',
  legendaryActions: 'Ações lendárias',
  level: 'Nível',
  maxHp: 'Pontos de vida máximos',
  name: 'Nome',
  notes: 'Anotações',
  passive: 'Percepção passiva',
  passivePerception: 'Percepção passiva',
  range: 'Alcance',
  savingThrows: 'Testes de resistência',
  school: 'Escola',
  skills: 'Perícias',
  sortMode: 'Ordenação',
  source: 'Fonte',
  speed: 'Deslocamento',
  species: 'Espécie',
  spellAttack: 'Ataque mágico',
  spellSaveDc: 'CD para resistir às magias',
  startingLevel: 'Nível inicial',
  subclass: 'Subclasse',
  tags: 'Marcadores',
  true: 'Sim',
  type: 'Tipo',
  visible: 'Visível',
  visibleColumns: 'Informações visíveis aos jogadores',
  ability: 'Atributos',
  action: 'Ações',
  alignment: 'Tendência',
  armorProficiencies: 'Proficiências com armaduras',
  attunement: 'Sintonização',
  bonus: 'Ações bônus',
  cha: 'Carisma',
  classFeatures: 'Características de classe',
  con: 'Constituição',
  conditionImmune: 'Imunidades a condições',
  cr: 'Nível de Desafio',
  daily: 'Usos diários',
  damageType: 'Tipo de dano',
  dex: 'Destreza',
  dmg1: 'Dano',
  entries: 'Descrição e efeitos',
  equipment: 'Equipamento',
  hitDice: 'Dado de Vida',
  hp: 'Pontos de vida',
  immune: 'Imunidades a dano',
  int: 'Inteligência',
  languageProficiencies: 'Proficiências em idiomas',
  languages: 'Idiomas',
  legendary: 'Ações lendárias',
  page: 'Página',
  prerequisite: 'Pré-requisitos',
  proficiency: 'Proficiência',
  property: 'Propriedades',
  rarity: 'Raridade',
  reaction: 'Reações',
  resist: 'Resistências a dano',
  save: 'Testes de resistência',
  senses: 'Sentidos',
  size: 'Tamanho',
  skill: 'Perícias',
  skillProficiencies: 'Proficiências em perícias',
  slots: 'Espaços de magia',
  spells: 'Magias',
  spellcasting: 'Conjuração',
  str: 'Força',
  subclassFeatures: 'Características de subclasse',
  toolProficiencies: 'Proficiências com ferramentas',
  trait: 'Características',
  vulnerable: 'Vulnerabilidades a dano',
  weaponProficiencies: 'Proficiências com armas',
  weight: 'Peso',
  wis: 'Sabedoria',
};

const DISPLAY_VALUES = {
  active: 'Ativa',
  alphabetical: 'Alfabética',
  approved: 'Aprovada',
  campaign: 'Campanha',
  category: 'Categoria de saúde',
  consumed: 'Utilizada',
  creature: 'Criatura',
  dm: 'Mestre',
  exact: 'Pontos de vida exatos',
  expired: 'Expirada',
  general: 'Geral',
  hidden: 'Oculta',
  inactive: 'Inativa',
  initiative: 'Iniciativa',
  locked: 'Bloqueada',
  pending: 'Pendente',
  personal: 'Pessoal',
  player: 'Jogador',
  private: 'Privada',
  published: 'Publicada',
  rejected: 'Rejeitada',
  visible: 'Visível',
  bludgeoning: 'Concussão',
  piercing: 'Perfuração',
  slashing: 'Corte',
  acid: 'Ácido',
  cold: 'Frio',
  fire: 'Fogo',
  force: 'Força',
  lightning: 'Elétrico',
  necrotic: 'Necrótico',
  poison: 'Veneno',
  psychic: 'Psíquico',
  radiant: 'Radiante',
  thunder: 'Trovejante',
  tiny: 'Minúsculo',
  small: 'Pequeno',
  medium: 'Médio',
  large: 'Grande',
  huge: 'Enorme',
  gargantuan: 'Colossal',
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  'very rare': 'Muito raro',
  legendary: 'Lendário',
  artifact: 'Artefato',
  ammunition: 'Munição',
  finesse: 'Acuidade',
  heavy: 'Pesada',
  light: 'Leve',
  loading: 'Recarga',
  reach: 'Alcance',
  special: 'Especial',
  thrown: 'Arremesso',
  'two-handed': 'Duas mãos',
  versatile: 'Versátil',
  martial: 'Marcial',
  simple: 'Simples',
  melee: 'Corpo a corpo',
  ranged: 'À distância',
  armor: 'Armadura',
  shield: 'Escudo',
  weapon: 'Arma',
  adventuringGear: 'Equipamento de aventura',
  adventuringgear: 'Equipamento de aventura',
  wounded: 'Ferido',
  bloodied: 'Sangrando',
  critical: 'Estado crítico',
  healthy: 'Saudável',
  dead: 'Morto',
  Barbarian: 'Bárbaro',
  Bard: 'Bardo',
  Cleric: 'Clérigo',
  Druid: 'Druida',
  Fighter: 'Guerreiro',
  Monk: 'Monge',
  Paladin: 'Paladino',
  Ranger: 'Patrulheiro',
  Rogue: 'Ladino',
  Sorcerer: 'Feiticeiro',
  Warlock: 'Bruxo',
  Wizard: 'Mago',
  Artificer: 'Artífice',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function displayLabel(value) {
  const key = String(value ?? '').trim();
  if (!key) return 'Informação';
  if (DISPLAY_LABELS[key]) return DISPLAY_LABELS[key];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-zà-ÿ0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toLocaleUpperCase('pt-BR'));
}

export function displayValue(value) {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (value == null || value === '') return 'Não informado';
  const raw = String(value);
  return DISPLAY_VALUES[raw] || raw;
}

export function structuredDataToHtml(value, options = {}) {
  const emptyMessage = options.emptyMessage || 'Nenhuma informação adicional.';

  const render = (current, depth = 0) => {
    if (current == null || current === '') {
      return '<span class="structured-empty">Não informado</span>';
    }
    if (typeof current === 'boolean' || typeof current === 'number' || typeof current === 'string') {
      return `<span>${escapeHtml(displayValue(current))}</span>`;
    }
    if (Array.isArray(current)) {
      if (!current.length) return `<span class="structured-empty">${escapeHtml(emptyMessage)}</span>`;
      return `<ul class="structured-list">${current
        .map((item) => `<li>${render(item, depth + 1)}</li>`)
        .join('')}</ul>`;
    }
    if (typeof current === 'object') {
      const entries = Object.entries(current).filter(([, item]) => item != null && item !== '');
      if (!entries.length) return `<span class="structured-empty">${escapeHtml(emptyMessage)}</span>`;
      return `<dl class="structured-data" data-depth="${depth}">${entries
        .map(
          ([key, item]) => `<div><dt>${escapeHtml(displayLabel(key))}</dt><dd>${render(item, depth + 1)}</dd></div>`,
        )
        .join('')}</dl>`;
    }
    return `<span>${escapeHtml(String(current))}</span>`;
  };

  return render(value);
}

export async function requestJson(url, options = {}) {
  const response = await authenticatedFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível concluir a solicitação.');
  }
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
    const light = root.dataset.theme === 'light';
    themeButton.textContent = light ? 'Usar tema escuro' : 'Usar tema claro';
    themeButton.setAttribute('aria-pressed', String(light));
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

function safeMarkdownHref(href) {
  const rawTarget = String(href || '').trim();
  if (!rawTarget || rawTarget.startsWith('//')) return '';
  const target = rawTarget.startsWith('/') ? `.${rawTarget}` : rawTarget;
  const lower = target.toLocaleLowerCase('en-US');
  if (
    target.startsWith('#')
    || target.startsWith('./')
    || target.startsWith('../')
    || lower.startsWith('https://')
    || lower.startsWith('http://')
    || lower.startsWith('mailto:')
  ) {
    return target;
  }
  return '';
}

export function markdownToHtml(value) {
  const safe = escapeHtml(value).replace(/\r\n?/g, '\n');
  const lines = safe.split('\n');
  let html = '';
  let listOpen = false;
  const inline = (line) => line
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const target = safeMarkdownHref(href);
      if (!target) return label;
      const external = /^https?:\/\//i.test(target);
      return `<a href="${escapeHtml(target)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      if (!listOpen) {
        html += '<ul>';
        listOpen = true;
      }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (listOpen) {
      html += '</ul>';
      listOpen = false;
    }
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
  const safeName = String(filename || 'documento-de-lore')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'documento-de-lore';
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
  const raw = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
}

export const entityLabels = {
  background: 'Antecedente',
  baseitem: 'Item básico',
  class: 'Classe',
  condition: 'Condição',
  creature: 'Criatura',
  feat: 'Talento',
  item: 'Item',
  monster: 'Criatura',
  optionalfeature: 'Característica opcional',
  race: 'Espécie',
  skill: 'Perícia',
  spell: 'Magia',
  subclass: 'Subclasse',
  variantrule: 'Regra variante',
};
