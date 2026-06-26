import { authenticatedFetch, initializeLogoutButtons, requireAuthenticatedPage } from './auth-client.js';
import { displayValue, formatDate, markdownToHtml, structuredDataToHtml } from './gm-common.js';
const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const saveStatus = document.querySelector('#sheet-save-status');
const sheetRoot = document.querySelector('#character-sheet-root');
const dialog = document.querySelector('#sheet-dialog');
const shortRestButton = document.querySelector('#short-rest');
const longRestButton = document.querySelector('#long-rest');
const levelUpButton = document.querySelector('#level-up');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const characterLayout = document.querySelector('#character-layout');
const characterViewTabs = [...document.querySelectorAll('[data-character-view]')];
const characterViewTabBar = document.querySelector('.character-view-tabs');
const characterHeader = document.querySelector('.player-inner-header');
const characterCampaignTab = document.querySelector('#character-campaign-tab');

const classPalettes = {
  artificer: ['#D59139', '#C48F4A', '#7D5B2D', '#A8712A', '#7D5725', '#553E1F'],
  barbarian: ['#E7623E', '#D46D51', '#9E462E', '#C44320', '#91371E', '#622B1C'],
  bard: ['#AB6DAC', '#A97AAA', '#7B537C', '#885289', '#674168', '#483048'],
  cleric: ['#91A1B2', '#8FA1B4', '#526375', '#6A7D92', '#53606F', '#3D454E'],
  druid: ['#7A853B', '#949F56', '#5F6539', '#5E6530', '#474C27', '#31351E'],
  fighter: ['#7F513E', '#AA7D6A', '#765547', '#614032', '#493228', '#33241F'],
  monk: ['#51A5C5', '#5E9FB8', '#386678', '#3B839E', '#306376', '#264551'],
  paladin: ['#B59E54', '#AA985F', '#6C613C', '#8D7B42', '#6A5D35', '#494229'],
  ranger: ['#507F62', '#629375', '#486854', '#40624D', '#324A3B', '#25342B'],
  rogue: ['#555752', '#73766F', '#8B8D86', '#424440', '#333431', '#242524'],
  sorcerer: ['#992E2E', '#C66E6E', '#8A3D3D', '#742727', '#572121', '#3B1A1A'],
  warlock: ['#7B469B', '#A079B8', '#724E88', '#5F3976', '#492E59', '#34233E'],
  wizard: ['#2A50A1', '#6A88C9', '#3B5690', '#24407A', '#1F325B', '#19253E'],
};
const classToneNames = ['original', 'light', 'lighter', 'dark', 'darker', 'deep'];
const classNames = {
  Barbarian: 'Bárbaro', Bard: 'Bardo', Cleric: 'Clérigo', Druid: 'Druida', Fighter: 'Guerreiro',
  Monk: 'Monge', Paladin: 'Paladino', Ranger: 'Patrulheiro', Rogue: 'Ladino', Sorcerer: 'Feiticeiro',
  Warlock: 'Bruxo', Wizard: 'Mago', Artificer: 'Artífice',
};
const abilityLabels = {
  strength: 'FOR', dexterity: 'DES', constitution: 'CON', intelligence: 'INT', wisdom: 'SAB', charisma: 'CAR',
};
const abilityNames = {
  strength: 'Força', dexterity: 'Destreza', constitution: 'Constituição', intelligence: 'Inteligência', wisdom: 'Sabedoria', charisma: 'Carisma',
};
const skills = [
  ['Acrobacia', 'acrobatics', 'dexterity'], ['Arcanismo', 'arcana', 'intelligence'], ['Atletismo', 'athletics', 'strength'],
  ['Atuação', 'performance', 'charisma'], ['Enganação', 'deception', 'charisma'], ['Furtividade', 'stealth', 'dexterity'],
  ['História', 'history', 'intelligence'], ['Intimidação', 'intimidation', 'charisma'], ['Intuição', 'insight', 'wisdom'],
  ['Investigação', 'investigation', 'intelligence'], ['Adestrar Animais', 'animal handling', 'wisdom'], ['Medicina', 'medicine', 'wisdom'],
  ['Natureza', 'nature', 'intelligence'], ['Percepção', 'perception', 'wisdom'], ['Persuasão', 'persuasion', 'charisma'],
  ['Prestidigitação', 'sleight of hand', 'dexterity'], ['Religião', 'religion', 'intelligence'], ['Sobrevivência', 'survival', 'wisdom'],
];

let character = null;
let activeTab = 'attacks';
let activeView = 'sheet';
let storeItems = [];
let levelUpState = {};
let characterCampaign = null;
let characterCampaignPoll = null;
let levelUpAccessPoll = null;
let lastCharacterCampaignTurnNotice = null;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function signed(value) { const number = Number(value); return number >= 0 ? `+${number}` : String(number); }
function initializeTheme() {
  const saved = localStorage.getItem('chronicle-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  updateThemeButton();
}
function updateThemeButton() {
  const light = root.dataset.theme === 'light';
  themeButton.setAttribute('aria-pressed', String(light));
  themeButton.textContent = light ? 'Usar tema escuro' : 'Usar tema claro';
}
themeButton.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
  updateThemeButton();
});
sidebarToggle?.addEventListener('click', () => {
  const collapsed = characterLayout.classList.toggle('sidebar-collapsed');
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.textContent = collapsed ? 'Mostrar menu' : 'Ocultar menu';
});
function updateSidebarOverlayOffset() {
  if (!characterLayout) return;
  const headerBottom = characterHeader?.getBoundingClientRect().bottom || 0;
  const tabsBottom = characterViewTabBar?.getBoundingClientRect().bottom || 0;
  characterLayout.style.setProperty('--sidebar-overlay-top', `${Math.max(0, headerBottom, tabsBottom)}px`);
}
window.addEventListener('resize', updateSidebarOverlayOffset);
window.addEventListener('scroll', updateSidebarOverlayOffset, { passive: true });
updateSidebarOverlayOffset();
characterViewTabs.forEach((button) => button.addEventListener('click', () => {
  captureInputs();
  activeView = button.dataset.characterView || 'sheet';
  render();
}));
async function requestJson(url, options = {}) {
  const response = await authenticatedFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.errors?.join(' ') || 'A solicitação falhou.');
  return payload;
}
function post(url, body) {
  return requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function classColor() {
  const name = character?.sheetData?.identity?.className || '';
  return classPalette(name)[0];
}
function classPalette(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  return classPalettes[key] || classPalettes.fighter;
}
function classNamePt(name) { return classNames[name] || name || '—'; }
function spellName(key) { return String(key || '').split('|')[0]; }
function roman(value) { return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][Number(value) - 1] || String(value); }
const moneyLabels = { PP: 'PL', GP: 'PO', SP: 'PP', CP: 'PC' };
function formatCurrency(totalCp) {
  let remaining = Math.max(0, Number(totalCp || 0));
  const values = [['PL', 1000], ['PO', 100], ['PP', 10], ['PC', 1]];
  const parts = [];
  for (const [label, unit] of values) {
    const amount = Math.floor(remaining / unit); if (amount) parts.push(`${amount} ${label}`); remaining %= unit;
  }
  return parts.join(' · ') || '0 PC';
}
function localizeAbility(value) { return abilityNames[value] || value || '—'; }
function showStatus(message, kind = 'pending') { saveStatus.className = `status-badge ${kind}`; saveStatus.textContent = message; }

function updateLevelUpButton() {
  if (!character) return;
  const access = character.levelUpAccess || {};
  const atMaximum = Number(character.level) >= 20;
  const blockedByCampaign = Boolean(access.requiresAuthorization && !access.authorized);
  levelUpButton.disabled = atMaximum || blockedByCampaign;
  levelUpButton.classList.toggle('locked', blockedByCampaign);
  levelUpButton.textContent = atMaximum ? 'Nível máximo' : (blockedByCampaign ? 'Subir de nível — bloqueado' : 'Subir de nível');
  if (atMaximum) {
    levelUpButton.title = 'O personagem já alcançou o nível 20.';
  } else if (blockedByCampaign) {
    levelUpButton.title = `Aguardando autorização do Mestre para o nível ${Number(access.targetLevel || Number(character.level) + 1)}.`;
  } else if (access.requiresAuthorization) {
    levelUpButton.title = `Evolução para o nível ${Number(access.targetLevel || Number(character.level) + 1)} autorizada pelo Mestre.`;
  } else {
    levelUpButton.title = 'Subir o personagem para o próximo nível.';
  }
  levelUpButton.setAttribute('aria-disabled', String(levelUpButton.disabled));
}

function render() {
  if (!character) return;
  updateLevelUpButton();
  const sheet = character.sheetData;
  const identity = sheet.identity || {};
  const stats = sheet.derived?.playStats || {};
  const proficiencies = sheet.derived?.proficiencies || {};
  const notation = sheet.abilities?.displayNotation || {};
  const scores = sheet.abilities?.finalDndScores || {};
  const state = sheet.playState || {};
  const spellcasting = sheet.derived?.spellcasting || {};
  const hasSpells = Boolean(spellcasting.available);
  if (!hasSpells && activeTab === 'spells') activeTab = 'attacks';
  const color = classColor();
  const portrait = character.portraitPath || sheet.portraitPath || '';
  const maxHp = Number(stats.maxHp || 0);
  const currentHp = Number(state.currentHp ?? maxHp);
  const savingThrows = new Set(stats.savingThrows || []);
  const initials = character.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const notices = sheet.derived?.notices || [];
  const traits = collectCharacterTraits(sheet);
  const palette = classPalette(identity.className);
  sheetRoot.style.setProperty('--class-color', palette[0]);
  classToneNames.forEach((tone, index) => sheetRoot.style.setProperty(`--class-${tone}`, palette[index]));
  const shortRest = sheet.restOptions?.short || {};
  const longRest = sheet.restOptions?.long || {};
  shortRestButton.disabled = !shortRest.available;
  shortRestButton.title = shortRest.available ? 'Revisar recuperações do descanso curto' : (shortRest.reason || '');
  longRestButton.disabled = !longRest.available;
  longRestButton.title = longRest.available ? 'Revisar recuperações do descanso longo' : (longRest.reason || '');

  characterViewTabs.forEach((button) => {
    const selected = button.dataset.characterView === activeView;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  if (activeView === 'details') {
    stopCharacterCampaignPolling();
    renderCharacterDetails({ sheet, identity, traits, portrait, initials, color });
    return;
  }
  if (activeView === 'campaign' && characterCampaign) {
    renderCharacterCampaignView();
    return;
  }
  stopCharacterCampaignPolling();
  sheetRoot.innerHTML = `
    ${notices.length ? `<section class="sheet-rule-notices">${notices.map((notice) => `<article><strong>${escapeHtml(notice.name)}</strong><span>${escapeHtml(notice.text)}</span></article>`).join('')}</section>` : ''}
    <section class="character-sheet-grid">
      <section class="sheet-identity-column">
        <button id="portrait-button" class="sheet-portrait-frame" type="button" title="Alterar imagem">
          ${portrait ? `<img src="${escapeHtml(portrait)}" alt="Retrato de ${escapeHtml(character.name)}">` : `<span>${escapeHtml(initials)}</span>`}
        </button>
        <input id="portrait-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        ${identityField(character.name, 'Nome')}
        ${identityField(identity.speciesName, 'Espécie')}
        <div class="identity-split">${identityField(classNamePt(identity.className), 'Classe')}${identityField(character.level, 'Nível')}</div>
        ${identityField(identity.subclassName || '—', 'Subclasse')}
        ${identityField(identity.backgroundName, 'Antecedente')}
        <div class="sheet-traits-panel">
          <h3>Características</h3>
          <div class="sheet-traits-scroll">${renderTraitNames(traits, sheet)}</div>
        </div>
      </section>

      <section class="sheet-attributes-column">
        <div class="attribute-panel">
          <h3>Atributos</h3>
          <div class="attribute-box-grid">
            ${Object.keys(abilityLabels).map((ability) => `
              <div class="attribute-box ${savingThrows.has(ability) ? 'save-proficient' : ''}" title="${savingThrows.has(ability) ? 'Proficiência em salvaguarda' : ''}">
                <span>${abilityLabels[ability]}</span><strong>${escapeHtml(notation[ability] || '—')}</strong>
              </div>`).join('')}
          </div>
          <div class="secondary-stats-grid">
            ${statBox('BP', signed(stats.proficiencyBonus || 0))}
            ${statBox('INI', signed(stats.initiative || 0))}
            ${statBox('CA', stats.armorClass || '—')}
            ${statBox('MOV', stats.movement || '—', true)}
            ${statBox('Per. passiva', stats.passivePerception || '—')}
            ${statBox('DV', Math.max(0, Number(stats.hitDiceTotal || character.level) - Number(state.hitDiceSpent || 0)))}
          </div>
          <div class="hp-controls">
            <label><span>PV máximo</span><output>${maxHp || '—'}</output></label>
            <label><span>PV atual</span><input id="current-hp" type="number" min="0" max="${maxHp}" value="${currentHp}"></label>
            <label><span>PV temporário</span><input id="temporary-hp" type="number" min="0" value="${Number(state.temporaryHp || 0)}"></label>
          </div>
          <div class="death-saves">
            ${deathSaveRow('Sucessos', 'success', Number(state.deathSaveSuccesses || 0))}
            ${deathSaveRow('Falhas', 'failure', Number(state.deathSaveFailures || 0))}
          </div>
          ${hasSpells ? renderSpellSlots(sheet.derived?.spellSlots || [], state.spellSlotsUsed || {}) : ''}
          ${stats.usesAbilityDc ? `<div class="dc-stats">${statBox('BA', signed(stats.abilityAttackBonus))}${statBox('CD', stats.abilitySaveDc)}${statBox('KA', abilityLabels[stats.keyAbility] || '—')}</div>` : ''}
          <button id="save-play-state" class="primary-button sheet-save-button" type="button">Salvar estado</button>
        </div>
      </section>

      <section class="sheet-skills-column">
        <div class="skills-panel"><h3>Perícias</h3><div class="skill-list">
          ${skills.map(([label, slug, ability]) => renderSkill(label, slug, ability, scores, proficiencies, stats.proficiencyBonus || 2)).join('')}
        </div></div>
      </section>

      <section class="sheet-information-column">
        <div class="sheet-tabs-panel">
          <div class="sheet-tabs" role="tablist">
            ${tabButton('attacks', 'Ataques')}${hasSpells ? tabButton('spells', 'Magias') : ''}${tabButton('equipment', 'Equipamento')}
          </div>
          <div id="sheet-tab-content" class="sheet-tab-content">${renderTab(activeTab, sheet, stats)}</div>
        </div>
        <div class="extra-proficiencies-panel">
          <h3>Proficiências adicionais</h3>
          ${proficiencyRow('Armaduras', proficiencies.armor)}
          ${proficiencyRow('Jogos', proficiencies.gamingSets)}
          ${proficiencyRow('Instrumentos', proficiencies.instruments)}
          ${proficiencyRow('Idiomas', proficiencies.languages)}
          ${proficiencyRow('Ferramentas', proficiencies.tools)}
          ${proficiencyRow('Armas', proficiencies.weapons)}
        </div>
      </section>
    </section>`;
  bindSheetInteractions();
  showStatus('Ficha carregada', 'ok');
}

function identityField(value, label) { return `<div class="identity-field"><small>${label}</small><strong>${escapeHtml(value || '—')}</strong></div>`; }
function statBox(label, value, wide = false) { return `<div class="secondary-stat-box ${wide ? 'wide-value' : ''}"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`; }
function deathSaveRow(label, key, selected) {
  return `<div class="death-save-row"><small>${label}</small>${[1, 2, 3].map((index) => `<button type="button" data-death-save="${key}" data-count="${index}" class="death-save-dot ${selected >= index ? 'selected' : ''}" aria-label="${label}: ${index}"></button>`).join('')}</div>`;
}
function normalizeResourceName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/points?$/, 'point').replace(/uses?$/, 'use');
}
function collectCharacterTraits(sheet) {
  const values = [
    ...(sheet.derived?.speciesTraits || []).map((value) => ({ ...value, group: 'Espécie' })),
    ...(sheet.derived?.classFeatures || []).map((value) => ({ ...value, group: 'Classe' })),
    ...(sheet.derived?.subclassFeatures || []).map((value) => ({ ...value, group: 'Subclasse' })),
    ...(sheet.derived?.selectedFeatureOptions || []).map((value) => ({ ...value, group: 'Escolha de característica' })),
    ...(sheet.derived?.referencedFeatures || []).map((value) => ({ ...value, group: 'Característica vinculada' })),
    ...(sheet.derived?.backgroundBenefits || []).map((value) => ({ ...value, group: 'Antecedente' })),
    ...(sheet.derived?.selectedFeats || []).map((value) => ({ ...value, group: 'Talento' })),
  ];
  return [...new Map(values.map((trait) => [`${trait.name}|${trait.level || ''}|${trait.source || ''}|${trait.group}`, trait])).values()];
}

function traitResourceControl(trait, sheet) {
  const resources = sheet.derived?.featureResources || [];
  const used = sheet.playState?.featureUses || {};
  const consumeName = trait.consumes?.name || trait.name;
  const normalized = normalizeResourceName(consumeName);
  const resource = resources.find((item) => {
    const candidate = normalizeResourceName(item.name);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  });
  const amount = Math.max(1, Number(trait.consumes?.amount || 1));
  const spent = resource ? Number(used[resource.id] || 0) : 0;
  const remaining = resource ? Math.max(0, Number(resource.maximum) - spent) : null;
  const canUse = resource && (trait.consumes || normalizeResourceName(trait.name) === normalizeResourceName(resource.name));
  if (canUse && resource.actionState) {
    const state = resource.actionState;
    return `<button type="button" class="small-action recovery-action-button"
      data-use-recovery="${escapeHtml(resource.id)}"
      title="${escapeHtml(state.available ? 'Escolher espaços de magia gastos' : state.reason)}"
      ${state.available ? '' : 'disabled'}>Recuperar espaços (${state.remainingUses}/${resource.maximum})</button>`;
  }
  return canUse ? `<button type="button" class="small-action" data-use-feature="${escapeHtml(resource.id)}" data-use-amount="${amount}" ${remaining < amount ? 'disabled' : ''}>Usar (${remaining}/${resource.maximum})</button>` : '';
}

function renderTraitNames(traits, sheet) {
  if (!traits.length) return '<p class="muted">Nenhuma característica registrada.</p>';
  return traits.map((trait) => `<article class="trait-name-only"><strong>${escapeHtml(trait.name)}</strong>${traitResourceControl(trait, sheet)}</article>`).join('');
}

function renderDetailedTraits(traits, sheet) {
  if (!traits.length) return '<p class="muted">Nenhuma característica registrada.</p>';
  return traits.map((trait) => `<article class="detailed-trait"><header><div><small>${escapeHtml(trait.group || 'Característica')}${trait.level ? ` · Nível ${trait.level}` : ''}</small><strong>${escapeHtml(trait.name)}</strong></div>${traitResourceControl(trait, sheet)}</header><p>${escapeHtml(trait.description || 'Sem descrição disponível.')}</p></article>`).join('');
}

function renderCharacterDetails({ sheet, identity, traits, portrait, initials }) {
  const state = sheet.playState || {};
  const concept = sheet.concept || {};
  sheetRoot.innerHTML = `<section class="character-details-grid">
    <section class="details-identity-column">
      <button id="portrait-button" class="details-portrait-frame" type="button" title="Alterar imagem">${portrait ? `<img src="${escapeHtml(portrait)}" alt="Retrato de ${escapeHtml(character.name)}">` : `<span>${escapeHtml(initials)}</span>`}</button>
      <input id="portrait-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      ${identityField(character.name, 'Nome')}
      ${identityField(identity.speciesName, 'Espécie')}
      ${identityField(classNamePt(identity.className), 'Classe')}
      ${identityField(identity.subclassName || '—', 'Subclasse')}
      ${identityField(identity.backgroundName, 'Antecedente')}
      <label class="details-backstory"><span>História do personagem</span><textarea id="character-backstory" placeholder="História, origem e acontecimentos importantes">${escapeHtml(state.backstory || '')}</textarea></label>
      <div class="concept-summary">
        ${detailText('Conceito', concept.shortPitch)}${detailText('Personalidade', concept.personality)}${detailText('Objetivos', concept.goals)}${detailText('Medos', concept.fears)}${detailText('Ligação com Varkhul', concept.connectionToVarkhul)}
      </div>
      <label class="details-other"><span>Outros detalhes</span><textarea id="character-other-details" placeholder="Aparência, vínculos, aliados e outros detalhes">${escapeHtml(state.otherDetails || '')}</textarea></label>
    </section>
    <section class="details-characteristics-panel"><h2>Características detalhadas</h2><div class="details-characteristics-scroll">${renderDetailedTraits(traits, sheet)}</div></section>
    <section class="details-notes-panel"><h2>Anotações do personagem</h2><textarea id="in-character-notes" placeholder="Anotações em personagem">${escapeHtml(state.inCharacterNotes || state.notes || '')}</textarea><button id="save-play-state-details" class="primary-button" type="button">Salvar detalhes</button></section>
  </section>`;
  bindSheetInteractions();
  showStatus('Detalhes carregados', 'ok');
}

function detailText(label, value) {
  return value ? `<article><small>${escapeHtml(label)}</small><p>${escapeHtml(value)}</p></article>` : '';
}

function renderSkill(label, slug, ability, scores, proficiencies, proficiencyBonus) {
  const modifier = Math.floor((Number(scores[ability] || 10) - 10) / 2);
  const proficient = (proficiencies.skills || []).includes(slug);
  const expert = (proficiencies.expertise || []).includes(slug);
  const total = modifier + (expert ? proficiencyBonus * 2 : proficient ? proficiencyBonus : 0);
  return `<div class="skill-row ${proficient || expert ? 'is-proficient' : ''}"><strong>${escapeHtml(label)}</strong><span class="skill-marker diamond ${expert ? 'selected' : ''}" aria-label="${expert ? 'Especialização' : 'Sem especialização'}"></span><output>${signed(total)}</output></div>`;
}
function tabButton(id, label) { return `<button type="button" role="tab" data-sheet-tab="${id}" class="${activeTab === id ? 'active' : ''}">${label}</button>`; }
function renderTab(tab, sheet, stats) { if (tab === 'spells') return renderSpells(sheet, stats); if (tab === 'equipment') return renderEquipment(sheet); return renderAttacks(sheet); }

function renderAttacks(sheet) {
  const attacks = sheet.playState?.attacks || [];
  if (!attacks.length) return '<div class="sheet-empty-tab"><strong>Nenhum ataque adicionado</strong><p>Adicione armas ou magias pelas abas correspondentes.</p></div>';
  return `<div class="attack-list">${attacks.map((attack) => {
    const castButtons = attack.sourceType === 'spell' ? `<div class="inline-actions">${attack.castable ? `<button type="button" class="primary-button compact-button" data-cast-spell="${escapeHtml(attack.sourceKey)}">Conjurar</button>` : ''}${attack.ritualAvailable ? `<button type="button" class="secondary-button compact-button" data-cast-ritual="${escapeHtml(attack.sourceKey)}">Conjurar ritual</button>` : ''}</div>` : '';
    const labels = [...(attack.properties || []).map(displayValue), ...(attack.mastery || []).map((value) => `Maestria: ${displayValue(value)}`)];
    if (attack.ritual) labels.push('Ritual');
    return `<article class="attack-card"><div><strong>${escapeHtml(attack.name)}</strong><span>${escapeHtml(displayValue(attack.damageType || ''))}</span></div><div class="attack-values"><b>${escapeHtml(attack.attack || '—')}</b><span>${escapeHtml(attack.damage || '—')}</span></div><p>${escapeHtml(labels.join(' · '))}</p>${castButtons}<button type="button" class="small-action danger" data-remove-attack="${escapeHtml(attack.sourceType)}" data-source-key="${escapeHtml(attack.sourceKey)}">Remover</button></article>`;
  }).join('')}</div>`;
}

function renderSpells(sheet, stats) {
  const spells = sheet.spellDetails || [];
  const mode = String(sheet.derived?.spellcasting?.mode || '');
  const canPrepare = ['spellbook', 'prepare_full_list', 'choose_then_prepare'].includes(mode);
  return `${canPrepare ? '<div class="spell-manager-heading"><button id="prepare-spells" class="secondary-button" type="button">Preparar magias</button></div>' : ''}<div class="spell-card-list">${spells.map((spell) => {
    const canCast = Boolean(spell.castable);
    const ritualAvailable = Boolean(spell.ritualAvailable);
    const canAttack = canCast || ritualAvailable;
    return `<article class="spell-card"><div class="spell-card-heading"><div><strong>${escapeHtml(spell.name)}${spell.prepared ? ' <span class="spell-tag">Preparada</span>' : ''}${spell.ritual ? ' <span class="spell-tag">Ritual</span>' : ''}</strong><span>${Number(spell.level) === 0 ? 'Truque' : `${spell.level}º nível`} · ${escapeHtml(spell.castingTime)} · ${escapeHtml(spell.range)}</span></div><div class="inline-actions">${canCast ? `<button type="button" class="primary-button compact-button" data-cast-spell="${escapeHtml(spell.key)}">Conjurar</button>` : ''}${ritualAvailable ? `<button type="button" class="secondary-button compact-button" data-cast-ritual="${escapeHtml(spell.key)}">Conjurar ritual</button>` : ''}${canAttack ? `<button type="button" class="secondary-button compact-button" data-add-attack="spell" data-source-key="${escapeHtml(spell.key)}">Adicionar aos ataques</button>` : ''}</div></div><p>${escapeHtml(spell.description)}</p>${spell.damage ? `<small>Dano: ${escapeHtml(spell.damage)} ${escapeHtml((spell.damageTypes || []).map(displayValue).join(', '))}</small>` : ''}${!canCast && !ritualAvailable ? '<small class="muted">A magia precisa estar preparada para ser conjurada ou adicionada aos ataques.</small>' : ''}</article>`;
  }).join('') || '<div class="sheet-empty-tab">Nenhuma magia registrada.</div>'}</div>`;
}

function renderSpellSlots(slots, used) {
  return `<div class="sheet-spell-slots"><span class="spell-slot-title">Espaços de magia</span>${slots.map((slot) => { const spent = Number(used[String(slot.spellLevel)] || 0); return `<div><span>${roman(slot.spellLevel)}</span><div>${Array.from({ length: Number(slot.total) }, (_, index) => `<i class="slot-square ${index < spent ? 'spent' : ''}"></i>`).join('')}</div></div>`; }).join('')}</div>`;
}
function renderEquipment(sheet) {
  const items = sheet.displayInventory || sheet.inventory || [];
  const wallet = sheet.wallet || { PP: 0, GP: 0, SP: 0, CP: 0 };
  return `
    <div class="equipment-manager">
      <div class="equipment-items">${items.map(renderItem).join('') || '<div class="sheet-empty-tab">Nenhum item registrado.</div>'}</div>
      <div class="equipment-actions-grid">
        <section><h4>Comprar itens</h4><form id="buy-item-form" class="compact-form"><input id="buy-item-search" type="search" placeholder="Buscar item"><select id="buy-item-key" required>${storeOptions(true, true)}</select><input id="buy-item-quantity" type="number" min="1" value="1" aria-label="Quantidade"><button class="primary-button" type="submit">Comprar</button></form></section>
        <section><h4>Adicionar itens</h4><form id="add-item-form" class="compact-form"><select id="add-item-key"><option value="">Item personalizado</option>${storeOptions(false)}</select><input id="add-item-name" type="text" placeholder="Nome do item"><input id="add-item-quantity" type="number" min="1" value="1" aria-label="Quantidade"><textarea id="add-item-description" rows="2" placeholder="Descrição opcional"></textarea><button class="secondary-button" type="submit">Adicionar</button></form></section>
      </div>
      <footer class="money-footer"><div><span>Dinheiro total</span><strong>${formatCurrency(sheet.walletCp || 0)}</strong></div><form id="wallet-form">${moneyInput('PP', wallet.PP)}${moneyInput('GP', wallet.GP)}${moneyInput('SP', wallet.SP)}${moneyInput('CP', wallet.CP)}<button class="secondary-button" type="submit">Salvar dinheiro</button></form></footer>
    </div>`;
}
function renderItem(item) {
  const details = [];
  if (item.damageDice) details.push(`Dano ${item.damageDice}${item.damageType ? ` ${displayValue(item.damageType)}` : ''}`);
  if (item.versatileDamage) details.push(`Versátil ${item.versatileDamage}`);
  if (item.properties?.length) details.push(item.properties.map(displayValue).join(', '));
  if (item.mastery?.length) details.push(`Maestria: ${item.mastery.map(displayValue).join(', ')}`);
  if (item.range) details.push(`Alcance ${item.range}`);
  const displayedArmorClass = item.bonusArmorClass ?? item.armorClass;
  if (displayedArmorClass) details.push(`${item.evengadulCustomArmor ? 'Bônus de CA' : 'CA'} ${displayedArmorClass}`);
  const canAddAttack = Boolean(item.key && (item.weapon || item.specialAttacks?.length));
  const canEquip = Boolean(item.key && (item.armor || item.shield));
  return `<article class="equipment-item-card ${item.equipped ? 'equipped' : ''}"><div><strong>${Number(item.quantity || 1) > 1 ? `${item.quantity}× ` : ''}${escapeHtml(item.name)}</strong><span>${escapeHtml(displayValue(item.category || ''))}${item.equipped ? ' · Equipado' : ''}</span></div>${details.length ? `<p>${escapeHtml(details.join(' · '))}</p>` : ''}${item.description ? `<p class="item-description">${escapeHtml(item.description)}</p>` : ''}<div class="inline-actions">${canEquip ? `<button type="button" class="small-action" data-toggle-equipment="${escapeHtml(item.key)}">${item.equipped ? 'Desequipar' : 'Equipar'}</button>` : ''}${canAddAttack ? `<button type="button" class="small-action" data-add-attack="item" data-source-key="${escapeHtml(item.key)}">Adicionar aos ataques</button>` : ''}</div></article>`;
}
function storeOptions(includePlaceholder = true, purchasableOnly = false) { const items = purchasableOnly ? storeItems.filter((item) => item.purchasable && Number(item.valueCp) > 0) : storeItems; return `${includePlaceholder ? '<option value="">Selecione um item</option>' : ''}${items.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.name)}${item.purchasable ? ` — ${escapeHtml(currencyPt(item.valueCp))}` : ' — sem preço'}</option>`).join('')}`; }
function currencyPt(cp) { return formatCurrency(cp); }
function moneyInput(label, value) { return `<label><span>${moneyLabels[label] || label}</span><input name="${label}" type="number" min="0" value="${Number(value || 0)}"></label>`; }
function proficiencyRow(label, values = []) { return `<div class="proficiency-row"><strong>${label}</strong><span>${values?.length ? values.map((value) => escapeHtml(localizeProficiency(value))).join(', ') : '—'}</span></div>`; }
function localizeProficiency(value) {
  const labels = { light: 'Armaduras leves', medium: 'Armaduras médias', heavy: 'Armaduras pesadas', shields: 'Escudos', simple: 'Armas simples', martial: 'Armas marciais' };
  return labels[value] || String(value).replaceAll('Choose', 'Escolha').replaceAll('Musical Instrument', 'Instrumento musical').replaceAll('Tools', 'Ferramentas').replaceAll('Supplies', 'Suprimentos');
}


function formatCampaignParticipantName(participant) {
  const state = participant.state || {};
  return `${state.name || participant.key}${state.ordinal ? ` (${state.ordinal})` : ''}`;
}

function characterCampaignInitiativeControl(participant, encounter) {
  if (participant.key !== character.id || encounter.initiativePhase !== 'collecting') {
    return `<span class="campaign-initiative-value">${participant.initiative ?? '—'}</span>`;
  }
  return `<form class="campaign-character-initiative-form" data-campaign-character-initiative>
    <label><span>Iniciativa</span><input name="initiative" type="number" value="${participant.initiative ?? ''}" required></label>
    <button class="secondary-button compact-button" type="submit">Salvar</button>
  </form>`;
}

function renderCharacterCampaignInitiative(encounter) {
  if (!encounter) {
    return `<div class="campaign-panel-heading"><p class="eyebrow">Encontro</p><h3>Iniciativa</h3></div><div class="campaign-tab-empty">Nenhum encontro ativo.</div>`;
  }
  const collecting = encounter.initiativePhase === 'collecting';
  return `<div class="campaign-panel-heading"><div><p class="eyebrow">${collecting ? 'Preparando encontro' : `Rodada ${Number(encounter.round || 1)}`}</p><h3>${escapeHtml(encounter.name)}</h3></div><strong>${collecting ? `${encounter.initiativeEntered}/${encounter.initiativeRequired}` : `R${Number(encounter.round || 1)}`}</strong></div>
    <div class="campaign-character-initiative-list">
      ${(encounter.participants || []).map((participant) => {
        const state = participant.state || {};
        const active = participant.key === encounter.activeParticipantKey;
        const isCharacter = participant.type === 'character';
        const hp = state.currentHp == null ? '' : `${state.currentHp}/${state.maxHp} PV`;
        const creatureHealth = state.healthCategory || 'Desconhecido';
        const conditions = (participant.conditions || []).map((condition) => `<small>${escapeHtml(condition.name)}${condition.turns == null ? '' : ` (${condition.turns})`}</small>`).join('');
        return `<article class="campaign-character-initiative-row ${active ? 'active-turn' : ''} ${participant.key === character.id ? 'current-character-row' : ''}">
          <div><strong>${escapeHtml(formatCampaignParticipantName(participant))}</strong><small>${isCharacter ? escapeHtml(hp) : escapeHtml(creatureHealth)}</small></div>
          ${characterCampaignInitiativeControl(participant, encounter)}
          ${conditions ? `<div class="campaign-character-condition-list">${conditions}</div>` : ''}
          ${active && participant.key === character.id && encounter.initiativePhase === 'running' ? '<button class="primary-button compact-button" type="button" data-character-campaign-end-turn>Encerrar turno</button>' : ''}
        </article>`;
      }).join('') || '<div class="campaign-tab-empty">Nenhum participante.</div>'}
    </div>`;
}

function renderCharacterCampaignMessages(campaign) {
  const relevantThreads = (campaign.messageThreads || []).filter((thread) => !thread.characterId || thread.characterId === character.id);
  const conversations = relevantThreads.length ? relevantThreads.map((thread) => `<article class="campaign-character-thread"><header><strong>${escapeHtml(thread.characterName || 'Conversa da campanha')}</strong></header>${(thread.messages || []).map((message) => `<div class="player-gm-message ${message.fromGm ? 'from-gm' : 'from-player'}"><strong>${message.fromGm ? 'Mestre' : 'Você'}</strong><p>${escapeHtml(message.body)}</p><time datetime="${escapeHtml(message.createdAt || '')}">${escapeHtml(formatDate(message.createdAt))}</time></div>`).join('')}</article>`).join('') : '<p class="muted">Nenhuma mensagem enviada ainda.</p>';
  return `<div class="campaign-panel-heading"><p class="eyebrow">Privado</p><h3>Mensagem ao Mestre</h3></div>
    <div class="campaign-character-thread-list">${conversations}</div>
    <form id="character-campaign-message-form" class="campaign-character-compact-form">
      <textarea name="body" rows="4" maxlength="4000" placeholder="Escreva ao Mestre" required></textarea>
      <button class="primary-button" type="submit">Enviar</button>
      <div id="character-campaign-message-feedback" aria-live="polite"></div>
    </form>`;
}

function renderCharacterCampaignNotes(campaign) {
  const notes = campaign.campaignNotes || {};
  return `<div class="campaign-panel-heading campaign-notes-heading"><div><p class="eyebrow">${escapeHtml(campaign.name)}</p><h2>Anotações da campanha</h2></div><span>Revisão ${Number(notes.revision || 0)}</span></div>
    <div class="campaign-identity-summary" ${campaign.bannerPath ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"` : ''}>
      <span class="campaign-identity-overlay"></span><div><strong>${escapeHtml(campaign.name)}</strong><small>Nível inicial ${Number(campaign.startingLevel || 1)}</small><p>${escapeHtml(campaign.description || 'Sem descrição.')}</p></div>
    </div>
    <details class="campaign-player-rules" ${Object.keys(campaign.homebrewRules || {}).length ? '' : 'open'}>
      <summary>Regras da campanha</summary>
      ${structuredDataToHtml(campaign.homebrewRules || {}, { emptyMessage: 'Nenhuma regra própria foi cadastrada.' })}
    </details>
    <form id="character-campaign-notes-form" class="campaign-character-notes-form">
      <textarea name="markdown" rows="18">${escapeHtml(notes.markdown || '')}</textarea>
      <input name="revision" type="hidden" value="${Number(notes.revision || 0)}">
      <div class="inline-actions"><button class="primary-button" type="submit">Salvar anotações</button><span id="character-campaign-notes-feedback" aria-live="polite"></span></div>
    </form>
    <article id="character-campaign-notes-preview" class="lore-content campaign-character-notes-preview">${markdownToHtml(notes.markdown || '') || '<p class="muted">Nenhuma anotação ainda.</p>'}</article>`;
}

function renderCharacterCampaignBoard(campaign) {
  return `<div class="campaign-panel-heading"><p class="eyebrow">Compartilhado</p><h3>Mural dos Jogadores</h3></div>
    <form id="character-campaign-board-form" class="campaign-character-compact-form">
      <textarea name="body" rows="4" maxlength="4000" placeholder="Publicar no mural" required></textarea>
      <button class="primary-button" type="submit">Publicar</button>
    </form>
    <div class="campaign-character-board-list">${(campaign.playerBoard || []).length ? campaign.playerBoard.map((post) => `<article><header><strong>${escapeHtml(post.author)}</strong><time datetime="${escapeHtml(post.createdAt || '')}">${escapeHtml(formatDate(post.createdAt))}</time></header><p>${escapeHtml(post.body)}</p></article>`).join('') : '<p class="muted">Nenhuma publicação ainda.</p>'}</div>`;
}

function renderCharacterCampaignView() {
  if (!characterCampaign) {
    activeView = 'sheet';
    render();
    return;
  }
  sheetRoot.innerHTML = `<section class="character-campaign-view" data-figma-node="76:16">
    <section class="campaign-figma-panel campaign-initiative-panel" data-figma-node="76:34"><div id="character-campaign-initiative" class="campaign-figma-panel-inner">${renderCharacterCampaignInitiative(characterCampaign.activeEncounter)}</div></section>
    <section class="campaign-figma-panel campaign-message-panel" data-figma-node="76:46"><div class="campaign-figma-panel-inner">${renderCharacterCampaignMessages(characterCampaign)}</div></section>
    <section class="campaign-figma-panel campaign-notes-panel" data-figma-node="76:40"><div class="campaign-figma-panel-inner">${renderCharacterCampaignNotes(characterCampaign)}</div></section>
    <section class="campaign-figma-panel campaign-board-panel" data-figma-node="76:37"><div class="campaign-figma-panel-inner">${renderCharacterCampaignBoard(characterCampaign)}</div></section>
  </section>`;
  bindCharacterCampaignInteractions();
  startCharacterCampaignPolling();
  showStatus('Campanha sincronizada', 'ok');
}

function showCharacterCampaignTurnNotification(encounter) {
  if (!encounter || encounter.activeParticipantKey !== character.id || encounter.initiativePhase !== 'running') return;
  const key = `${encounter.id}:${encounter.activeParticipantKey}:${encounter.round}`;
  if (lastCharacterCampaignTurnNotice === key) return;
  lastCharacterCampaignTurnNotice = key;
  document.querySelector('.player-turn-notification')?.remove();
  const notice = document.createElement('div');
  notice.className = 'player-turn-notification';
  notice.setAttribute('role', 'alert');
  notice.setAttribute('aria-live', 'assertive');
  notice.innerHTML = `<strong>É o seu turno</strong><span>${escapeHtml(character.name)} · Rodada ${Number(encounter.round || 1)}</span><button type="button" aria-label="Fechar">×</button>`;
  notice.querySelector('button').addEventListener('click', () => notice.remove());
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 9000);
}

function bindCharacterCampaignEncounterInteractions() {
  const encounter = characterCampaign?.activeEncounter;
  document.querySelector('[data-campaign-character-initiative]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const initiative = new FormData(event.currentTarget).get('initiative');
      const updated = await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/active-encounter/initiative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: character.id, initiative }),
      });
      characterCampaign.activeEncounter = updated;
      refreshCharacterCampaignInitiative();
    } catch (error) { showStatus(error.message, 'error'); }
  });
  document.querySelector('[data-character-campaign-end-turn]')?.addEventListener('click', async () => {
    try {
      const updated = await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/active-encounter/end-turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      characterCampaign.activeEncounter = updated;
      refreshCharacterCampaignInitiative();
    } catch (error) { showStatus(error.message, 'error'); }
  });
  showCharacterCampaignTurnNotification(encounter);
}

function bindCharacterCampaignInteractions() {
  bindCharacterCampaignEncounterInteractions();
  const notesForm = document.querySelector('#character-campaign-notes-form');
  notesForm?.querySelector('textarea')?.addEventListener('input', (event) => {
    document.querySelector('#character-campaign-notes-preview').innerHTML = markdownToHtml(event.target.value) || '<p class="muted">Nenhuma anotação ainda.</p>';
  });
  notesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: data.get('markdown'), revision: Number(data.get('revision')) }),
      });
      await loadCharacterCampaign(true);
    } catch (error) {
      document.querySelector('#character-campaign-notes-feedback').innerHTML = `<span class="alert error">${escapeHtml(error.message)}</span>`;
    }
  });
  document.querySelector('#character-campaign-message-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/message-gm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: data.get('body'), characterId: character.id }),
      });
      await loadCharacterCampaign(true);
    } catch (error) {
      document.querySelector('#character-campaign-message-feedback').innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
    }
  });
  document.querySelector('#character-campaign-board-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    try {
      await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/player-board`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      });
      await loadCharacterCampaign(true);
    } catch (error) { showStatus(error.message, 'error'); }
  });
}

function refreshCharacterCampaignInitiative() {
  const container = document.querySelector('#character-campaign-initiative');
  if (!container || !characterCampaign) return;
  container.innerHTML = renderCharacterCampaignInitiative(characterCampaign.activeEncounter);
  bindCharacterCampaignEncounterInteractions();
}

function stopCharacterCampaignPolling() {
  if (characterCampaignPoll) clearInterval(characterCampaignPoll);
  characterCampaignPoll = null;
}

function startCharacterCampaignPolling() {
  stopCharacterCampaignPolling();
  if (!characterCampaign || activeView !== 'campaign') return;
  characterCampaignPoll = setInterval(async () => {
    if (activeView !== 'campaign' || !characterCampaign) { stopCharacterCampaignPolling(); return; }
    try {
      const payload = await requestJson(`/api/campaigns/${encodeURIComponent(characterCampaign.id)}/active-encounter`);
      characterCampaign.activeEncounter = payload.encounter;
      refreshCharacterCampaignInitiative();
    } catch { /* retain the last synchronized encounter view */ }
  }, 2000);
}

async function loadCharacterCampaign(shouldRender = false) {
  if (!character) return;
  const payload = await requestJson(`/api/characters/${encodeURIComponent(character.id)}/campaign`);
  characterCampaign = payload.campaign || null;
  if (characterCampaignTab) characterCampaignTab.hidden = !characterCampaign;
  if (!characterCampaign && activeView === 'campaign') activeView = 'sheet';
  if (shouldRender) render();
}

function bindSheetInteractions() {
  document.querySelectorAll('[data-sheet-tab]').forEach((button) => button.addEventListener('click', () => { captureInputs(); activeTab = button.dataset.sheetTab; render(); }));
  document.querySelectorAll('[data-death-save]').forEach((button) => button.addEventListener('click', () => {
    captureInputs(); const state = character.sheetData.playState ||= {}; const key = button.dataset.deathSave === 'success' ? 'deathSaveSuccesses' : 'deathSaveFailures'; const count = Number(button.dataset.count); state[key] = Number(state[key] || 0) === count ? count - 1 : count; render(); showStatus('Alterações não salvas');
  }));
  document.querySelector('#save-play-state')?.addEventListener('click', savePlayState);
  document.querySelector('#save-play-state-details')?.addEventListener('click', savePlayState);
  document.querySelector('#portrait-button')?.addEventListener('click', () => document.querySelector('#portrait-file').click());
  document.querySelector('#portrait-file')?.addEventListener('change', (event) => uploadPortrait(event.target.files?.[0]));
  document.querySelectorAll('[data-use-feature]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/features/use`, { resourceId: button.dataset.useFeature, amount: Number(button.dataset.useAmount || 1) }, 'Recurso utilizado')));
  document.querySelectorAll('[data-use-recovery]').forEach((button) => button.addEventListener('click', () => openSpellSlotRecoveryDialog(button.dataset.useRecovery)));
  document.querySelector('#prepare-spells')?.addEventListener('click', openPrepareSpellsDialog);
  document.querySelectorAll('[data-cast-spell]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/cast-spell`, { spellKey: button.dataset.castSpell, ritual: false }, 'Magia conjurada')));
  document.querySelectorAll('[data-cast-ritual]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/cast-spell`, { spellKey: button.dataset.castRitual, ritual: true }, 'Ritual conjurado')));
  document.querySelectorAll('[data-add-attack]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/attacks/add`, { sourceType: button.dataset.addAttack, sourceKey: button.dataset.sourceKey }, 'Ataque adicionado')));
  document.querySelectorAll('[data-toggle-equipment]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/equipment/toggle`, { itemKey: button.dataset.toggleEquipment }, 'Equipamento atualizado')));
  document.querySelectorAll('[data-remove-attack]').forEach((button) => button.addEventListener('click', () => mutate(`/api/characters/${character.id}/attacks/remove`, { sourceType: button.dataset.removeAttack, sourceKey: button.dataset.sourceKey }, 'Ataque removido')));
  document.querySelector('#wallet-form')?.addEventListener('submit', saveWallet);
  document.querySelector('#buy-item-form')?.addEventListener('submit', buyItem);
  document.querySelector('#add-item-form')?.addEventListener('submit', addItem);
  document.querySelector('#buy-item-search')?.addEventListener('input', filterBuyItems);
  document.querySelectorAll('#current-hp, #temporary-hp, #character-notes, #character-backstory, #character-other-details, #in-character-notes').forEach((input) => input.addEventListener('input', () => showStatus('Alterações não salvas')));
}
function captureInputs() {
  if (!character) return; const state = character.sheetData.playState ||= {}; const hp = document.querySelector('#current-hp'); const temp = document.querySelector('#temporary-hp'); const notes = document.querySelector('#character-notes'); const backstory = document.querySelector('#character-backstory'); const otherDetails = document.querySelector('#character-other-details'); const inCharacterNotes = document.querySelector('#in-character-notes'); if (hp) state.currentHp = Number(hp.value || 0); if (temp) state.temporaryHp = Number(temp.value || 0); if (notes) state.notes = notes.value; if (backstory) state.backstory = backstory.value; if (otherDetails) state.otherDetails = otherDetails.value; if (inCharacterNotes) state.inCharacterNotes = inCharacterNotes.value;
}
async function mutate(url, body, success) {
  showStatus('Salvando...');
  try { character = await post(url, body); render(); showStatus(success, 'ok'); } catch (error) { showStatus(error.message, 'error'); }
}
async function savePlayState() { captureInputs(); await mutate(`/api/characters/${character.id}/play-state`, character.sheetData.playState, 'Estado salvo'); }
async function saveWallet(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget); await mutate(`/api/characters/${character.id}/wallet`, { PP: data.get('PP'), GP: data.get('GP'), SP: data.get('SP'), CP: data.get('CP') }, 'Dinheiro atualizado');
}
async function buyItem(event) { event.preventDefault(); const key = document.querySelector('#buy-item-key').value; if (!key) return; await mutate(`/api/characters/${character.id}/buy-item`, { itemKey: key, quantity: Number(document.querySelector('#buy-item-quantity').value || 1) }, 'Compra concluída'); }
async function addItem(event) {
  event.preventDefault(); const key = document.querySelector('#add-item-key').value; const name = document.querySelector('#add-item-name').value; if (!key && !name.trim()) return; await mutate(`/api/characters/${character.id}/add-item`, { key, name, quantity: Number(document.querySelector('#add-item-quantity').value || 1), description: document.querySelector('#add-item-description').value }, 'Item adicionado');
}
function filterBuyItems(event) {
  const query = event.target.value.toLowerCase(); const select = document.querySelector('#buy-item-key'); select.innerHTML = '<option value="">Selecione um item</option>' + storeItems.filter((item) => item.purchasable && Number(item.valueCp) > 0 && item.name.toLowerCase().includes(query)).map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.name)} — ${escapeHtml(currencyPt(item.valueCp))}</option>`).join('');
}
async function uploadPortrait(file) {
  if (!file) return; showStatus('Enviando imagem...');
  try {
    const upload = await requestJson('/api/uploads/portraits', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    character = await post(`/api/characters/${character.id}/portrait`, { portraitPath: upload.path }); render(); showStatus('Imagem atualizada', 'ok');
  } catch (error) { showStatus(error.message, 'error'); }
}

function openPrepareSpellsDialog(clearExisting = false) {
  const sheet = character.sheetData;
  const options = sheet.preparationOptions || [];
  const existing = new Set(sheet.choices?.preparedSpells || []);
  const selected = clearExisting ? new Set() : existing;
  const limit = Number(sheet.derived?.spellcasting?.preparedLimit || 0);
  dialog.innerHTML = `<form id="prepare-spells-form" class="dialog-card"><button class="dialog-close" type="button" data-close-dialog>×</button><h3>Preparar magias</h3><p>Escolha exatamente ${limit} magias entre as opções disponíveis. As magias já preparadas permanecem mantidas até que você use <strong>Limpar preparação</strong>.</p><div class="dialog-actions preparation-actions"><button id="clear-current-preparation" class="secondary-button" type="button">Limpar preparação</button></div><div class="preparation-list">${options.map((spell) => {
    const locked = !clearExisting && existing.has(spell.key);
    return `<label class="check-option ${locked ? 'locked-option' : ''}"><input type="checkbox" name="preparedSpell" value="${escapeHtml(spell.key)}" ${selected.has(spell.key) ? 'checked' : ''} ${locked ? 'disabled data-locked-spell="true"' : ''}><span><strong>${escapeHtml(spell.name)}</strong><small>${spell.level}º nível${spell.ritual ? ' · Ritual' : ''}${locked ? ' · mantida' : ''}</small></span></label>`;
  }).join('') || '<p class="muted">Nenhuma magia disponível.</p>'}</div><div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancelar</button><button class="primary-button" type="submit">Salvar preparação</button></div></form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('#clear-current-preparation')?.addEventListener('click', () => openPrepareSpellsDialog(true));
  const form = dialog.querySelector('#prepare-spells-form');
  form?.addEventListener('change', () => {
    const checked = [...form.querySelectorAll('input[name="preparedSpell"]:checked')];
    if (checked.length > limit) checked.at(-1).checked = false;
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const keys = [...form.querySelectorAll('input[name="preparedSpell"]:checked')].map((input) => input.value);
    if (keys.length !== limit) { showStatus(`Selecione exatamente ${limit} magias.`, 'error'); return; }
    dialog.close();
    await mutate(`/api/characters/${character.id}/spells/prepare`, { spellKeys: keys }, 'Magias preparadas');
  });
}

shortRestButton.addEventListener('click', () => openRestDialog('short'));
longRestButton.addEventListener('click', () => openRestDialog('long'));
levelUpButton.addEventListener('click', () => {
  const access = character?.levelUpAccess || {};
  if (access.requiresAuthorization && !access.authorized) {
    showStatus('O Mestre precisa autorizar esta evolução.', 'pending');
    return;
  }
  levelUpState = {};
  openLevelUp();
});
function recoverySlotInputs(actionState, resourceId, context) {
  return `<div class="recovery-slot-list">${(actionState.options || []).map((option) => `
    <label class="recovery-slot-row">
      <span><strong>${option.level}º nível</strong><small>${option.expended} gasto(s)</small></span>
      <input type="number" min="0" max="${option.expended}" value="0"
        data-recovery-context="${escapeHtml(context)}"
        data-recovery-resource="${escapeHtml(resourceId)}"
        data-recovery-level="${option.level}">
    </label>`).join('')}</div>
    <p class="recovery-budget">Níveis selecionados: <strong data-recovery-total="${escapeHtml(context)}:${escapeHtml(resourceId)}">0</strong> / ${actionState.budget}</p>`;
}
function selectedRecoverySlots(rootElement, resourceId, context) {
  return Object.fromEntries(
    [...rootElement.querySelectorAll(`[data-recovery-context="${context}"][data-recovery-resource="${resourceId}"]`)]
      .map((input) => [input.dataset.recoveryLevel, Number(input.value || 0)])
  );
}
function recoverySelectionTotal(selection) {
  return Object.entries(selection).reduce((total, [level, count]) => total + Number(level) * Number(count || 0), 0);
}
function bindRecoveryBudget(rootElement, resourceId, context, budget, confirmButton) {
  const inputs = [...rootElement.querySelectorAll(`[data-recovery-context="${context}"][data-recovery-resource="${resourceId}"]`)];
  const totalOutput = rootElement.querySelector(`[data-recovery-total="${context}:${resourceId}"]`);
  const update = () => {
    const total = recoverySelectionTotal(selectedRecoverySlots(rootElement, resourceId, context));
    if (totalOutput) totalOutput.textContent = String(total);
    if (confirmButton) confirmButton.disabled = total < 1 || total > Number(budget || 0);
  };
  inputs.forEach((input) => input.addEventListener('input', update));
  update();
}
function openSpellSlotRecoveryDialog(resourceId) {
  const resource = (character.sheetData.derived?.featureResources || []).find((item) => item.id === resourceId);
  const actionState = resource?.actionState;
  if (!resource || !actionState?.available) {
    showStatus(actionState?.reason || 'Esta recuperação não está disponível.', 'error');
    return;
  }
  dialog.innerHTML = `<form class="dialog-card recovery-dialog" id="feature-recovery-form">
    <button class="dialog-close" type="button" data-close-dialog aria-label="Fechar">×</button>
    <h3>${escapeHtml(resource.name)}</h3>
    <p>Escolha espaços de magia gastos cuja soma de níveis não ultrapasse ${actionState.budget}. Espaços acima do ${actionState.maxSpellLevel}º nível não são elegíveis.</p>
    ${recoverySlotInputs(actionState, resourceId, 'feature')}
    <p class="dialog-inline-error" data-recovery-error></p>
    <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancelar</button><button id="confirm-feature-recovery" class="primary-button" type="submit">Recuperar</button></div>
  </form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  const form = dialog.querySelector('#feature-recovery-form');
  const confirm = dialog.querySelector('#confirm-feature-recovery');
  bindRecoveryBudget(dialog, resourceId, 'feature', actionState.budget, confirm);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    confirm.disabled = true;
    try {
      character = await post(`/api/characters/${character.id}/features/use`, {
        resourceId,
        recoverySelection: { spellSlots: selectedRecoverySlots(dialog, resourceId, 'feature') },
      });
      dialog.close();
      render();
      showStatus('Espaços de magia recuperados', 'ok');
    } catch (error) {
      dialog.querySelector('[data-recovery-error]').textContent = error.message;
      confirm.disabled = false;
    }
  });
}
function restOptionMarkup(option) {
  const identifier = escapeHtml(option.id);
  if (option.type === 'hitDiceSpend') {
    return `<div class="recovery-option-card">
      <label class="check-option"><input type="checkbox" name="restRecovery" value="${identifier}" checked><span><strong>${escapeHtml(option.name)}</strong><small>${option.available} disponível(is)</small></span></label>
      <div class="recovery-inline-fields"><label><span>Dados gastos</span><input id="rest-hit-dice" type="number" min="1" max="${option.available}" value="1"></label><label><span>PV recuperados</span><input id="rest-healing" type="number" min="0" value="0"></label></div>
    </div>`;
  }
  if (option.type === 'featureAction') {
    return `<div class="recovery-option-card">
      <label class="check-option"><input type="checkbox" name="restRecovery" value="${identifier}"><span><strong>${escapeHtml(option.name)}</strong><small>Escolha os espaços que serão recuperados</small></span></label>
      ${recoverySlotInputs(option.actionState, option.resourceId, 'rest')}
    </div>`;
  }
  const detail = option.type === 'resource' ? `Recuperar ${option.restoreAmount} uso(s)` : 'Restaurar o valor gasto';
  return `<label class="check-option recovery-option-card"><input type="checkbox" name="restRecovery" value="${identifier}" checked><span><strong>${escapeHtml(option.name)}</strong><small>${detail}</small></span></label>`;
}
function openRestDialog(type) {
  const sheet = character.sheetData;
  const rule = sheet.restRules?.[type] || {};
  const restState = sheet.restOptions?.[type] || {};
  if (!restState.available) {
    showStatus(restState.reason || 'Este descanso não possui nada para recuperar.', 'error');
    return;
  }
  dialog.innerHTML = `<form class="dialog-card recovery-dialog" id="rest-form">
    <button class="dialog-close" type="button" data-close-dialog aria-label="Fechar">×</button>
    <h3>${escapeHtml(rule.name || (type === 'short' ? 'Descanso curto' : 'Descanso longo'))}</h3>
    <p>${escapeHtml(rule.description || '')}</p>
    <div class="recovery-option-list">${restState.options.map(restOptionMarkup).join('')}</div>
    <p class="dialog-inline-error" data-recovery-error></p>
    <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancelar</button><button id="confirm-rest" class="primary-button" type="submit">Aplicar descanso</button></div>
  </form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  for (const option of restState.options.filter((item) => item.type === 'featureAction')) {
    bindRecoveryBudget(dialog, option.resourceId, 'rest', option.actionState.budget);
  }
  dialog.querySelector('#rest-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const recoveries = [...dialog.querySelectorAll('input[name="restRecovery"]:checked')].map((input) => input.value);
    if (!recoveries.length) {
      dialog.querySelector('[data-recovery-error]').textContent = 'Selecione ao menos uma recuperação.';
      return;
    }
    const actionSelections = {};
    for (const option of restState.options.filter((item) => item.type === 'featureAction')) {
      if (recoveries.includes(option.id)) {
        actionSelections[option.resourceId] = {
          spellSlots: selectedRecoverySlots(dialog, option.resourceId, 'rest'),
        };
      }
    }
    const confirm = dialog.querySelector('#confirm-rest');
    confirm.disabled = true;
    try {
      character = await post(`/api/characters/${character.id}/rest`, {
        type,
        recoveries,
        hitDiceSpent: Number(dialog.querySelector('#rest-hit-dice')?.value || 0),
        healing: Number(dialog.querySelector('#rest-healing')?.value || 0),
        actionSelections,
      });
      dialog.close();
      render();
      showStatus('Descanso aplicado', 'ok');
    } catch (error) {
      dialog.querySelector('[data-recovery-error]').textContent = error.message;
      confirm.disabled = false;
    }
  });
}

async function openLevelUp(patch = {}) {
  levelUpState = { ...levelUpState, ...patch };
  showStatus('Calculando evolução...');
  try {
    const data = await post(`/api/characters/${character.id}/level-up/resolve`, levelUpState);
    levelUpState = { ...levelUpState, subclassKey: data.draft?.subclassKey || levelUpState.subclassKey };
    renderLevelUpDialog(data);
    showStatus('Evolução pronta', 'ok');
  } catch (error) { showStatus(error.message, 'error'); }
}
function renderLevelUpDialog(data) {
  const delta = data.delta || {}; const requirement = data.requirements?.spellcasting || {}; const draft = data.draft || {}; const feats = data.options?.feats || []; const spellOptions = data.options?.spells || [];
  const chosenSubclass = levelUpState.subclassKey || draft.subclassKey || character.subclassKey || '';
  const chosenFeat = levelUpState.featKey || '';
  dialog.innerHTML = `<form id="level-up-form" class="dialog-card level-up-dialog"><button class="dialog-close" type="button" data-close-dialog>×</button><h3>Subir para o nível ${data.targetLevel}</h3>${data.errors?.length ? `<div class="alert warning"><ul>${data.errors.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>` : ''}
    ${delta.subclass?.required && !character.subclassKey ? `<label class="field"><span>Subclasse</span><select id="level-subclass"><option value="">Selecione</option>${(delta.subclass.options || []).map((option) => `<option value="${escapeHtml(option.key)}" ${chosenSubclass === option.key ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}</select></label>` : ''}
    ${delta.featSlots?.length ? `<label class="field"><span>Talento</span><select id="level-feat"><option value="">Selecione</option>${feats.filter((feat) => !delta.featSlots[0].categories?.length || delta.featSlots[0].categories.includes(feat.category)).map((feat) => `<option value="${escapeHtml(feat.key)}" ${chosenFeat === feat.key ? 'selected' : ''}>${escapeHtml(feat.name)}</option>`).join('')}</select></label>` : ''}
    ${delta.asiSlots?.length ? renderLevelAsi(data.targetLevel) : ''}
    ${renderLevelLanguages(data.requirements?.languages || {}, draft.selectedLanguages || [])}
    ${renderLevelFeatureChoices(delta.featureChoices || [], draft.featureChoices || {})}
    ${requirement.available ? renderLevelSpells(requirement, draft, spellOptions, delta.spellExchange || {}) : ''}
    <section class="level-feature-summary"><h4>Novas características</h4>${[...(delta.classFeatures || []), ...(delta.subclassFeatures || [])].map((feature) => `<article><strong>${escapeHtml(feature.name)}</strong><p>${escapeHtml(feature.description || '')}</p></article>`).join('') || '<p class="muted">Nenhuma nova característica textual neste nível.</p>'}</section>
    <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancelar</button><button class="primary-button" type="submit">Concluir nível</button></div></form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  document.querySelector('#level-subclass')?.addEventListener('change', () => { levelUpState = { ...levelUpState, ...collectLevelUpPayload() }; openLevelUp(); });
  document.querySelector('#level-feat')?.addEventListener('change', () => { levelUpState = { ...levelUpState, ...collectLevelUpPayload() }; openLevelUp(); });
  dialog.querySelectorAll('[data-level-language-choice]').forEach((select) => select.addEventListener('change', () => {
    levelUpState = { ...levelUpState, ...collectLevelUpPayload() };
    openLevelUp();
  }));
  bindLevelSpellControls(data);
  document.querySelector('#level-up-form').addEventListener('submit', applyLevelUp);
}
function renderLevelLanguages(requirement, current) {
  const count = Number(requirement.count || 2);
  const currentValues = Array.isArray(levelUpState.selectedLanguages)
    ? levelUpState.selectedLanguages
    : (Array.isArray(current) ? current : []);
  const selected = currentValues.filter(Boolean).slice(0, count);
  if (selected.length >= count) return '';
  return `<section class="level-language-choices"><h4>Idiomas da origem</h4><p class="muted">Este personagem foi criado antes da escolha obrigatória de idiomas. Comum é concedido automaticamente; escolha exatamente ${count} idiomas adicionais para continuar.</p><div class="locked-choice"><span>Idioma concedido automaticamente</span><strong>${escapeHtml(requirement.fixedName || 'Common')}</strong></div><div class="form-grid two-columns language-choice-grid">${Array.from({ length: count }, (_, index) => `<label class="field"><span>Idioma adicional ${index + 1}</span><select data-level-language-choice="${index}"><option value="">Selecione</option>${(requirement.options || []).map((option) => {
    const usedElsewhere = selected.some((value, selectedIndex) => value === option.key && selectedIndex !== index);
    return `<option value="${escapeHtml(option.key)}" ${selected[index] === option.key ? 'selected' : ''} ${usedElsewhere ? 'disabled' : ''}>${escapeHtml(option.name)}</option>`;
  }).join('')}</select></label>`).join('')}</div></section>`;
}

function renderLevelFeatureChoices(requirements, current) {
  if (!requirements.length) return '';
  return `<section class="level-feature-choices"><h4>Escolhas de características</h4>${requirements.map((requirement) => {
    const selected = String(levelUpState.featureChoices?.[requirement.id] || current?.[requirement.id] || '').split('||').filter(Boolean);
    return Array.from({ length: Number(requirement.count || 1) }, (_, index) => `<label class="field"><span>${escapeHtml(requirement.label)}${Number(requirement.count || 1) > 1 ? ` ${index + 1}` : ''}</span><select data-level-feature-choice="${escapeHtml(requirement.id)}" data-choice-index="${index}"><option value="">Selecione</option>${(requirement.options || []).map((option) => `<option value="${escapeHtml(option.key)}" ${selected[index] === option.key ? 'selected' : ''}>${escapeHtml(option.name)}</option>`).join('')}</select></label>`).join('');
  }).join('')}</section>`;
}

function renderLevelAsi(level) {
  return `<fieldset class="level-asi"><legend>Melhoria de atributo</legend><label class="field"><span>Forma</span><select id="level-asi-choice"><option value="two-half-steps">+ₒ em dois atributos</option><option value="one-full-step">+1 em um atributo</option></select></label><div class="inline-fields"><select id="level-asi-a">${abilityOptions()}</select><select id="level-asi-b">${abilityOptions()}</select></div></fieldset>`;
}
function abilityOptions() { return `<option value="">Atributo</option>${Object.entries(abilityNames).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}`; }
function renderLevelSpells(requirement, draft, options, exchangeRequirement = {}) {
  const cantrips = options.filter((spell) => Number(spell.level) === 0);
  const leveled = options.filter((spell) => Number(spell.level) > 0);
  const oldChoices = character.sheetData?.choices || {};
  const selectedCantrips = levelUpState.cantripsKnown ?? draft.cantripsKnown ?? [];
  const selectedSpellbook = levelUpState.spellbook ?? draft.spellbook ?? [];
  const exchangeFrom = levelUpState.spellExchange?.from || '';
  const selectedKnown = (levelUpState.spellsKnown ?? draft.spellsKnown ?? []).filter((key) => key !== exchangeFrom);
  const preparedCleared = Boolean(levelUpState.clearPreparedSpells);
  const selectedPrepared = preparedCleared ? (levelUpState.preparedSpells || []) : (levelUpState.preparedSpells ?? draft.preparedSpells ?? []);

  let fields = spellCheckboxGroup('Truques', 'cantripsKnown', cantrips, selectedCantrips, Number(requirement.cantrips || 0), oldChoices.cantripsKnown || []);
  if (requirement.mode === 'spellbook') {
    fields += spellCheckboxGroup('Grimório', 'spellbook', leveled, selectedSpellbook, Number(requirement.spellsKnown || 0), oldChoices.spellbook || []);
    const pool = new Set(selectedSpellbook);
    fields += spellCheckboxGroup('Preparadas', 'preparedSpells', leveled.filter((spell) => pool.has(spell.key)), selectedPrepared, Number(requirement.preparedLimit || 0), preparedCleared ? [] : (oldChoices.preparedSpells || []), true);
  } else if (requirement.mode === 'prepare_full_list') {
    fields += spellCheckboxGroup('Preparadas', 'preparedSpells', leveled, selectedPrepared, Number(requirement.preparedLimit || 0), preparedCleared ? [] : (oldChoices.preparedSpells || []), true);
  } else {
    const lockedKnown = (oldChoices.spellsKnown || []).filter((key) => key !== exchangeFrom);
    fields += spellCheckboxGroup('Conhecidas', 'spellsKnown', leveled, selectedKnown, Number(requirement.spellsKnown || requirement.preparedLimit || 0), lockedKnown);
    if (requirement.mode === 'choose_then_prepare') {
      const pool = new Set(selectedKnown);
      fields += spellCheckboxGroup('Preparadas', 'preparedSpells', leveled.filter((spell) => pool.has(spell.key)), selectedPrepared, Number(requirement.preparedLimit || 0), preparedCleared ? [] : (oldChoices.preparedSpells || []), true);
    }
  }
  const exchange = exchangeRequirement.available ? renderSpellExchange(exchangeRequirement, leveled, oldChoices.spellsKnown || []) : '';
  return `<section class="level-spells"><h4>Magias</h4>${fields}${exchange}</section>`;
}

function spellCheckboxGroup(label, field, options, selected, count, locked = [], clearable = false) {
  const selectedSet = new Set(selected || []);
  const lockedSet = new Set(locked || []);
  return `<fieldset class="spell-checkbox-group" data-spell-group="${field}" data-spell-limit="${count}"><legend>${label} — <span data-spell-count>${selectedSet.size}/${count}</span></legend>${clearable ? '<button class="small-action clear-prepared" type="button" data-clear-prepared>Limpar preparação</button>' : ''}<div class="spell-checkbox-list">${options.map((spell) => {
    const isLocked = lockedSet.has(spell.key);
    const checked = selectedSet.has(spell.key) || isLocked;
    return `<label class="check-option ${isLocked ? 'locked-option' : ''}"><input type="checkbox" data-level-spell-field="${field}" value="${escapeHtml(spell.key)}" ${checked ? 'checked' : ''} ${isLocked ? 'disabled data-locked-spell="true"' : ''}><span><strong>${escapeHtml(spell.name)}</strong><small>${Number(spell.level) === 0 ? 'Truque' : `${spell.level}º nível`}${spell.ritual ? ' · Ritual' : ''}${isLocked ? ' · mantida' : ''}</small></span></label>`;
  }).join('') || '<p class="muted">Nenhuma opção disponível.</p>'}</div></fieldset>`;
}

function renderSpellExchange(requirement, options, known) {
  const state = levelUpState.spellExchange || {};
  const enabled = Boolean(state.from || state.to || levelUpState.exchangeSpellsEnabled);
  const knownSet = new Set(known || []);
  const replacementOptions = options.filter((spell) => !knownSet.has(spell.key) || spell.key === state.from);
  return `<fieldset class="spell-exchange"><legend>Trocar Magias <small>(opcional, no máximo uma)</small></legend><label class="check-option compact-check"><input id="enable-spell-exchange" type="checkbox" ${enabled ? 'checked' : ''}><span>Trocar uma magia conhecida neste nível</span></label><div class="inline-fields ${enabled ? '' : 'is-hidden'}" id="spell-exchange-fields"><label class="field"><span>Remover</span><select id="spell-exchange-from"><option value="">Selecione</option>${(known || []).map((key) => `<option value="${escapeHtml(key)}" ${state.from === key ? 'selected' : ''}>${escapeHtml(spellName(key))}</option>`).join('')}</select></label><label class="field"><span>Aprender no lugar</span><select id="spell-exchange-to"><option value="">Selecione</option>${replacementOptions.map((spell) => `<option value="${escapeHtml(spell.key)}" ${state.to === spell.key ? 'selected' : ''}>${escapeHtml(spell.name)} (${spell.level}º)</option>`).join('')}</select></label></div></fieldset>`;
}

function checkedSpellValues(field) {
  return [...document.querySelectorAll(`input[data-level-spell-field="${field}"]:checked`)].map((input) => input.value);
}

function bindLevelSpellControls(data) {
  document.querySelectorAll('[data-level-spell-field]').forEach((input) => input.addEventListener('change', () => {
    const group = input.closest('[data-spell-group]');
    const limit = Number(group?.dataset.spellLimit || 0);
    const checked = [...group.querySelectorAll('input[data-level-spell-field]:checked')];
    if (limit && checked.length > limit) input.checked = false;
    const count = group.querySelector('[data-spell-count]');
    if (count) count.textContent = `${group.querySelectorAll('input[data-level-spell-field]:checked').length}/${limit}`;
    levelUpState = { ...levelUpState, ...collectLevelUpPayload() };
  }));
  document.querySelectorAll('[data-clear-prepared]').forEach((button) => button.addEventListener('click', () => {
    levelUpState = { ...levelUpState, ...collectLevelUpPayload(), clearPreparedSpells: true, preparedSpells: [] };
    renderLevelUpDialog(data);
  }));
  const exchangeToggle = document.querySelector('#enable-spell-exchange');
  exchangeToggle?.addEventListener('change', () => {
    levelUpState.exchangeSpellsEnabled = exchangeToggle.checked;
    if (!exchangeToggle.checked) levelUpState.spellExchange = {};
    renderLevelUpDialog(data);
  });
  document.querySelector('#spell-exchange-from')?.addEventListener('change', () => {
    levelUpState = { ...levelUpState, ...collectLevelUpPayload() };
    renderLevelUpDialog(data);
  });
  document.querySelector('#spell-exchange-to')?.addEventListener('change', () => { levelUpState = { ...levelUpState, ...collectLevelUpPayload() }; });
}

function collectLevelUpPayload() {
  const choice = document.querySelector('#level-asi-choice')?.value; const a = document.querySelector('#level-asi-a')?.value; const b = document.querySelector('#level-asi-b')?.value; let asi;
  if (choice && a) { const increments = { [a]: choice === 'one-full-step' ? 2 : 1 }; if (choice === 'two-half-steps' && b) increments[b] = (increments[b] || 0) + 1; asi = { level: character.level + 1, choiceId: choice, increments }; }
  const featureChoices = { ...(levelUpState.featureChoices || {}) };
  document.querySelectorAll('[data-level-feature-choice]').forEach((select) => {
    const identifier = select.dataset.levelFeatureChoice; const index = Number(select.dataset.choiceIndex || 0);
    const current = String(featureChoices[identifier] || '').split('||'); current[index] = select.value; featureChoices[identifier] = current.filter(Boolean).join('||');
  });
  const languageSelects = [...document.querySelectorAll('[data-level-language-choice]')];
  const selectedLanguages = languageSelects.length
    ? languageSelects.map((select) => select.value).filter(Boolean)
    : levelUpState.selectedLanguages;
  const exchangeEnabled = Boolean(document.querySelector('#enable-spell-exchange')?.checked || levelUpState.exchangeSpellsEnabled);
  const exchangeFrom = document.querySelector('#spell-exchange-from')?.value || levelUpState.spellExchange?.from || '';
  const exchangeTo = document.querySelector('#spell-exchange-to')?.value || levelUpState.spellExchange?.to || '';
  return {
    subclassKey: document.querySelector('#level-subclass')?.value || levelUpState.subclassKey || character.subclassKey || undefined,
    featKey: document.querySelector('#level-feat')?.value || levelUpState.featKey || undefined,
    asi: asi || levelUpState.asi,
    featureChoices,
    selectedLanguages,
    cantripsKnown: document.querySelector('[data-spell-group="cantripsKnown"]') ? checkedSpellValues('cantripsKnown') : levelUpState.cantripsKnown,
    spellbook: document.querySelector('[data-spell-group="spellbook"]') ? checkedSpellValues('spellbook') : levelUpState.spellbook,
    spellsKnown: document.querySelector('[data-spell-group="spellsKnown"]') ? checkedSpellValues('spellsKnown') : levelUpState.spellsKnown,
    preparedSpells: document.querySelector('[data-spell-group="preparedSpells"]') ? checkedSpellValues('preparedSpells') : levelUpState.preparedSpells,
    clearPreparedSpells: Boolean(levelUpState.clearPreparedSpells),
    spellExchange: exchangeEnabled ? { from: exchangeFrom, to: exchangeTo } : {},
  };
}

async function applyLevelUp(event) {
  event.preventDefault(); levelUpState = { ...levelUpState, ...collectLevelUpPayload() };
  try { const result = await post(`/api/characters/${character.id}/level-up`, levelUpState); if (!result.valid) { renderLevelUpDialog(result); return; } character = result.character; levelUpState = {}; dialog.close(); render(); showStatus(`Nível ${character.level} concluído`, 'ok'); } catch (error) { showStatus(error.message, 'error'); }
}


async function refreshLevelUpAccess() {
  if (!character?.id || document.hidden) return;
  try {
    const access = await requestJson(`/api/characters/${encodeURIComponent(character.id)}/level-up-access`);
    const changed = JSON.stringify(character.levelUpAccess || {}) !== JSON.stringify(access || {});
    character.levelUpAccess = access;
    if (changed) updateLevelUpButton();
  } catch (_error) {
    // The current sheet remains usable if a background authorization refresh fails.
  }
}

function startLevelUpAccessPolling() {
  if (levelUpAccessPoll) window.clearInterval(levelUpAccessPoll);
  levelUpAccessPoll = window.setInterval(refreshLevelUpAccess, 15000);
}

async function initialize() {
  if (!await requireAuthenticatedPage('player')) return;
  initializeTheme(); const id = new URLSearchParams(window.location.search).get('id');
  if (!id) { sheetRoot.innerHTML = '<div class="alert error">Nenhum personagem foi informado.</div>'; return; }
  try {
    const [characterPayload, itemsPayload] = await Promise.all([
      requestJson(`/api/characters/${encodeURIComponent(id)}`),
      requestJson('/api/items?limit=250'),
    ]);
    character = characterPayload;
    storeItems = itemsPayload.items || [];
    await loadCharacterCampaign(false);
    render();
    startLevelUpAccessPolling();
  } catch (error) { sheetRoot.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; showStatus('Ficha indisponível', 'error'); }
}
window.addEventListener('focus', refreshLevelUpAccess);
window.addEventListener('beforeunload', () => {
  if (levelUpAccessPoll) window.clearInterval(levelUpAccessPoll);
});

initialize();

initializeLogoutButtons();
