import { initializeAreaSwitcher, initializeLogoutButtons, requireAuthenticatedPage } from './auth-client.js';
import { cachedRequestJson, invalidateApiCache, requestJson } from './data-client.js';
const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const statusBadge = document.querySelector('#creator-status');
const blocker = document.querySelector('#creator-blocker');
const successBox = document.querySelector('#creator-success');
const app = document.querySelector('#creator-app');
const stepList = document.querySelector('#step-list');
const stepContent = document.querySelector('#step-content');
const validationSummary = document.querySelector('#validation-summary');
const previousButton = document.querySelector('#previous-step');
const nextButton = document.querySelector('#next-step');
const resolveButton = document.querySelector('#resolve-draft');
const createButton = document.querySelector('#create-character');

const baseSteps = [
  { id: 'class', label: 'Classe' },
  { id: 'class-choices', label: 'Escolhas de classe' },
  { id: 'spells', label: 'Magias' },
  { id: 'background', label: 'Antecedente' },
  { id: 'species', label: 'Espécie' },
  { id: 'languages', label: 'Idiomas' },
  { id: 'abilities', label: 'Atributos' },
  { id: 'equipment', label: 'Equipamento' },
  { id: 'details', label: 'Outros detalhes' },
];

let visibleSteps = [...baseSteps];
let backgroundPatternIndex = 0;
let bootstrap = null;
let resolution = null;
let currentStep = 0;
let furthestStep = 0;
let spellOptions = [];
let loadedSpellKey = '';
let draft = emptyDraft();

function emptyDraft() {
  return {
    name: '',
    level: 1,
    concept: {
      shortPitch: '',
      personality: '',
      goals: '',
      fears: '',
      connectionToVarkhul: '',
    },
    speciesKey: null,
    classKey: null,
    subclassKey: null,
    backgroundKey: null,
    baseAbilityAssignments: {},
    backgroundAbilityIncreases: {},
    levelChoices: {},
    selectedFeats: [],
    selectedAsis: [],
    selectedClassSkills: [],
    selectedToolProficiencies: [],
    selectedLanguages: [],
    proficiencyChoices: {},
    featureChoices: {},
    cantripsKnown: [],
    spellbook: [],
    spellsKnown: [],
    preparedSpells: [],
    startingEquipmentChoices: {},
    startingEquipmentAccepted: false,
    inventory: [],
    portraitPath: null,
    rangedWeaponAbility: null,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function updateThemeButton() {
  const light = root.dataset.theme === 'light';
  themeButton.setAttribute('aria-pressed', String(light));
  themeButton.textContent = light ? 'Usar tema escuro' : 'Usar tema claro';
}

function initializeTheme() {
  const saved = localStorage.getItem('chronicle-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  updateThemeButton();
}

themeButton.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
  updateThemeButton();
});

async function initialize() {
  if (!await requireAuthenticatedPage('player')) return;
  initializeLogoutButtons();
  await initializeAreaSwitcher('player');
  initializeTheme();
  try {
    const payload = await cachedRequestJson('/api/creator/bootstrap', {
      freshForMs: 24 * 60 * 60 * 1000,
      staleForMs: 30 * 24 * 60 * 60 * 1000,
      tags: ['rules-catalog'],
    });
    if (!payload.ready) {
      showBlocker(payload.error || 'O catálogo ainda não está pronto.');
      return;
    }
    bootstrap = payload;
    statusBadge.className = 'status-badge ok';
    statusBadge.textContent = 'Regras carregadas';
    app.hidden = false;
    await refreshResolution(false);
    await render();
  } catch (error) {
    showBlocker(error.message);
  }
}

function showBlocker(message) {
  statusBadge.className = 'status-badge error';
  statusBadge.textContent = 'Criador indisponível';
  blocker.hidden = false;
  blocker.textContent = message;
  app.hidden = true;
}

async function refreshResolution(showValidation = false) {
  if (!bootstrap) return;
  try {
    draft.level = 1;
    resolution = await requestJson('/api/creator/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    ensureAutomaticChoices();
    updateVisibleSteps();
    if (showValidation) renderValidation(resolution.errors || []);
  } catch (error) {
    renderValidation([error.message]);
  }
}


function updateVisibleSteps() {
  const currentId = visibleSteps[currentStep]?.id || 'class';
  const hasSpellcasting = Boolean(resolution?.requirements?.spellcasting?.available);
  visibleSteps = baseSteps.filter((step) => step.id !== 'spells' || hasSpellcasting);
  const matchingIndex = visibleSteps.findIndex((step) => step.id === currentId);
  currentStep = matchingIndex >= 0 ? matchingIndex : Math.min(currentStep, visibleSteps.length - 1);
  furthestStep = Math.min(furthestStep, visibleSteps.length - 1);
}

function ensureAutomaticChoices() {
  const equipment = resolution?.requirements?.startingEquipment;
  if (equipment) {
    for (const [groupName, groups] of [
      ['class', equipment.classGroups || []],
      ['background', equipment.backgroundGroups || []],
    ]) {
      groups.forEach((group, index) => {
        if (group.options?.length === 1) {
          draft.startingEquipmentChoices[`${groupName}:${index}`] = group.options[0].id;
        }
      });
    }
  }
  const requiredFeatCount = resolution?.requirements?.featSlots?.length || 0;
  draft.selectedFeats = draft.selectedFeats.slice(0, requiredFeatCount);
  const asiLevels = new Set((resolution?.requirements?.asiSlots || []).map((slot) => Number(slot.level)));
  draft.selectedAsis = draft.selectedAsis.filter((asi) => asiLevels.has(Number(asi.level)));
  const subclassRequired = resolution?.requirements?.subclass?.required;
  if (!subclassRequired) draft.subclassKey = null;
  draft.proficiencyChoices = pruneChoiceMap(draft.proficiencyChoices, resolution?.requirements?.proficiencyChoices || []);
  draft.featureChoices = pruneChoiceMap(draft.featureChoices, resolution?.requirements?.featureChoices || []);
  const languageRule = resolution?.requirements?.languages || { count: 2, options: [] };
  const allowedLanguages = new Set((languageRule.options || []).map((item) => item.key));
  const languageCount = Number(languageRule.count || 2);
  const languageSelections = Array.from({ length: languageCount }, (_, index) => {
    const value = String((draft.selectedLanguages || [])[index] || '');
    if (!allowedLanguages.has(value)) return '';
    return (draft.selectedLanguages || []).findIndex((candidate) => candidate === value) === index ? value : '';
  });
  draft.selectedLanguages = languageSelections;
}

function pruneChoiceMap(values, requirements) {
  const byId = new Map((requirements || []).map((item) => [String(item.id || ''), item]));
  const output = {};
  Object.entries(values || {}).forEach(([identifier, raw]) => {
    const requirement = byId.get(String(identifier));
    if (!requirement) return;
    const allowed = new Set((requirement.options || []).map((option) => String(option.key || '')));
    const count = Number(requirement.count || 1);
    const selected = String(raw || '').split('||').filter((value, index, all) => allowed.has(value) && all.indexOf(value) === index).slice(0, count);
    if (selected.length) output[identifier] = selected.join('||');
  });
  return output;
}

async function render() {
  if (!bootstrap) return;
  updateVisibleSteps();
  renderStepRail();
  const step = visibleSteps[currentStep].id;
  if (step === 'class') renderClassStep();
  if (step === 'class-choices') renderClassChoicesStep();
  if (step === 'spells') await renderSpellsStep();
  if (step === 'background') renderBackgroundStep();
  if (step === 'species') renderSpeciesStep();
  if (step === 'languages') renderLanguagesStep();
  if (step === 'abilities') renderAbilitiesStep();
  if (step === 'equipment') renderEquipmentStep();
  if (step === 'details') renderDetailsStep();
  previousButton.disabled = currentStep === 0;
  nextButton.hidden = currentStep === visibleSteps.length - 1;
  createButton.hidden = currentStep !== visibleSteps.length - 1;
  validationSummary.replaceChildren();
}

function renderStepRail() {
  stepList.innerHTML = visibleSteps.map((step, index) => `
    <li>
      <button type="button" class="step-button ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'complete' : ''}" data-step-index="${index}" ${index > furthestStep ? 'disabled' : ''}>
        <span>${index + 1}</span>${escapeHtml(step.label)}
      </button>
    </li>
  `).join('');
}

function renderDetailsStep() {
  stepContent.innerHTML = `
    <div class="step-heading">
      <p class="eyebrow">Última etapa</p>
      <h3>Outros detalhes</h3>
      <p>Defina a identidade, o retrato e os elementos narrativos do personagem.</p>
    </div>
    <div class="form-grid two-columns">
      <label class="field">
        <span>Nome do personagem</span>
        <input type="text" data-draft-field="name" value="${escapeHtml(draft.name)}" autocomplete="off">
      </label>
      <label class="field">
        <span>Nível inicial</span>
        <input type="text" value="Nível 1" readonly>
      </label>
      <div class="field full-width portrait-upload-field">
        <span>Imagem do personagem</span>
        <div class="portrait-upload-row">
          ${draft.portraitPath ? `<img class="portrait-upload-preview" src="${escapeHtml(draft.portraitPath)}" alt="Prévia do retrato">` : '<div class="portrait-upload-placeholder">Sem imagem</div>'}
          <label class="secondary-button file-button">Selecionar imagem<input id="creator-portrait-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
          <span id="creator-portrait-feedback" class="muted">PNG, JPEG ou WebP; máximo de 5 MB.</span>
        </div>
      </div>
      ${conceptField('shortPitch', 'Resumo do conceito')}
      ${conceptField('personality', 'Personalidade')}
      ${conceptField('goals', 'Objetivos')}
      ${conceptField('fears', 'Medos')}
      <label class="field full-width">
        <span>Ligação com Varkhul</span>
        <textarea data-concept-field="connectionToVarkhul" rows="4">${escapeHtml(draft.concept.connectionToVarkhul)}</textarea>
      </label>
    </div>
  `;
}

function conceptField(key, label) {
  return `<label class="field"><span>${escapeHtml(label)}</span><input type="text" data-concept-field="${key}" value="${escapeHtml(draft.concept[key])}"></label>`;
}

function renderChoiceCards(title, options, field) {
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Escolha</p><h3>${escapeHtml(title)}</h3></div>
    <div class="option-grid">
      ${options.map((option) => optionCard(option, field, draft[field])).join('')}
    </div>
  `;
}

const classNamesPtBr = {
  Barbarian: 'Bárbaro', Bard: 'Bardo', Cleric: 'Clérigo', Druid: 'Druida',
  Fighter: 'Guerreiro', Monk: 'Monge', Paladin: 'Paladino', Ranger: 'Patrulheiro',
  Rogue: 'Ladino', Sorcerer: 'Feiticeiro', Warlock: 'Bruxo', Wizard: 'Mago',
  Artificer: 'Artífice',
};

function optionDisplayName(option, field) {
  return field === 'classKey' ? (classNamesPtBr[option.name] || option.name) : option.name;
}

function optionCard(option, field, selected) {
  return `
    <label class="option-card ${selected === option.key ? 'selected' : ''}">
      <input type="radio" name="${escapeHtml(field)}" value="${escapeHtml(option.key)}" data-choice-field="${escapeHtml(field)}" ${selected === option.key ? 'checked' : ''}>
      <span class="option-card-title">${escapeHtml(optionDisplayName(option, field))}</span>
      <span class="option-card-source">${escapeHtml(option.source)}</span>
      ${option.description ? `<span class="option-card-description">${escapeHtml(option.description)}</span>` : ''}
    </label>
  `;
}

function renderClassStep() {
  const subclass = resolution?.requirements?.subclass || { required: false, options: [] };
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Etapa de classe</p><h3>Classe${subclass.required ? ' e subclasse' : ''}</h3></div>
    <div class="option-grid compact">
      ${bootstrap.classes.map((option) => optionCard(option, 'classKey', draft.classKey)).join('')}
    </div>
    ${subclass.required ? `
      <div class="subsection">
        <h4>Subclasse — nível ${subclass.selectionLevel}</h4>
        <div class="option-grid compact">
          ${(subclass.options || []).map((option) => optionCard(option, 'subclassKey', draft.subclassKey)).join('') || '<p class="muted">Nenhuma subclasse compatível foi importada.</p>'}
        </div>
      </div>
    ` : ''}
  `;
}

function renderBackgroundStep() {
  const feat = resolution?.requirements?.backgroundFeat;
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Origem</p><h3>Antecedente</h3></div>
    <div class="option-grid compact">
      ${bootstrap.backgrounds.map((option) => optionCard(option, 'backgroundKey', draft.backgroundKey)).join('')}
    </div>
    ${draft.backgroundKey ? `
      <div class="subsection form-grid two-columns">
        <label class="field">
          <span>Talento de origem</span>
          <input type="text" value="${escapeHtml(feat?.name || 'Não definido')}" readonly>
        </label>
      </div>
      ${renderProficiencyChoices(backgroundProficiencyChoices())}
      ${renderFeatureChoices(backgroundFeatureChoices())}
    ` : ''}
  `;
}

function renderBackgroundAbilityControls(rule) {
  if (!rule.allowed?.length) return '';
  const patterns = rule.patterns?.length ? rule.patterns : [[2, 1]];
  const inferredPattern = inferCurrentPattern(draft.backgroundAbilityIncreases, patterns);
  const backgroundIncreaseTotal = Object.values(draft.backgroundAbilityIncreases || {}).reduce((total, value) => total + Number(value || 0), 0);
  if (backgroundIncreaseTotal === 3) {
    const inferredIndex = patterns.findIndex((pattern) => arraysEqual(sortedValues(pattern), sortedValues(inferredPattern)));
    if (inferredIndex >= 0) backgroundPatternIndex = inferredIndex;
  }
  backgroundPatternIndex = Math.max(0, Math.min(backgroundPatternIndex, patterns.length - 1));
  const patternIndex = backgroundPatternIndex;
  const pattern = patterns[patternIndex];
  const selectedAbilities = expandedIncreaseTargets(draft.backgroundAbilityIncreases, pattern);
  return `
    <label class="field">
      <span>Distribuição do antecedente</span>
      <select id="background-ability-pattern">
        ${patterns.map((item, index) => `<option value="${index}" ${index === patternIndex ? 'selected' : ''}>${formatIncreasePattern(item)}</option>`).join('')}
      </select>
    </label>
    <div class="field full-width">
      <span>Atributos aumentados</span>
      <div class="inline-fields">
        ${pattern.map((increase, index) => `
          <label>
            <small>${increase === 2 ? '+1' : '+ₒ'}</small>
            <select data-background-target="${index}" data-increase="${increase}">
              <option value="">Selecione</option>
              ${rule.allowed.map((ability) => { const usedElsewhere = selectedAbilities.some((selected, selectedIndex) => selected === ability && selectedIndex !== index); return `<option value="${ability}" ${selectedAbilities[index] === ability ? 'selected' : ''} ${usedElsewhere ? 'disabled' : ''}>${abilityLabel(ability)}</option>`; }).join('')}
            </select>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

function renderAbilitiesStep() {
  const assignments = draft.baseAbilityAssignments;
  const used = new Set(Object.values(assignments));
  const abilityRule = resolution?.requirements?.backgroundAbilities || { allowed: [], patterns: [] };
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Matriz de Varkhul</p><h3>Determinar atributos</h3><p>Primeiro aplique os aumentos concedidos pelo antecedente; depois use cada valor da matriz exatamente uma vez.</p></div>
    ${renderBackgroundAbilityControls(abilityRule)}
    <div class="ability-grid">
      ${abilityNames().map((ability) => `
        <label class="ability-field">
          <span>${abilityLabel(ability)}</span>
          <select data-ability="${ability}">
            <option value="">Selecione</option>
            ${bootstrap.abilityArray.values.map((value) => {
              const disabled = used.has(value) && assignments[ability] !== value;
              return `<option value="${escapeHtml(value)}" ${assignments[ability] === value ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(value)}</option>`;
            }).join('')}
          </select>
        </label>
      `).join('')}
    </div>
    ${renderFinalAbilityPreview()}
  `;
}

function renderFinalAbilityPreview() {
  const scores = resolution?.derived?.finalDndScores || {};
  const notation = resolution?.derived?.displayNotation || {};
  if (Object.keys(scores).length !== 6) return '';
  return `<div class="subsection"><h4>Resultado atual</h4><div class="ability-preview">${abilityNames().map((ability) => `<div><span>${abilityLabel(ability)}</span><strong>${escapeHtml(notation[ability])}</strong></div>`).join('')}</div></div>`;
}

function renderClassChoicesStep() {
  const classSkills = resolution?.requirements?.classSkills || { count: 0, options: [] };
  const proficiencyChoices = classProficiencyChoices();
  const featureChoices = classFeatureChoices();
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Classe</p><h3>Escolhas de classe</h3><p>Complete todas as escolhas concedidas pela classe antes de definir a origem.</p></div>
    ${renderSkillChoices(classSkills)}
    ${renderProficiencyChoices(proficiencyChoices)}
    ${renderFeatureChoices(featureChoices)}
    <div class="subsection">
      <h4>Atributo das armas à distância</h4>
      <label class="field narrow">
        <span>Usado tanto no ataque quanto no dano</span>
        <select data-draft-field="rangedWeaponAbility">
          <option value="">Selecione</option>
          ${bootstrap.rangedWeaponAbilities.map((ability) => `<option value="${ability}" ${draft.rangedWeaponAbility === ability ? 'selected' : ''}>${abilityLabel(ability)}</option>`).join('')}
        </select>
      </label>
    </div>
  `;
}

function classProficiencyChoices() {
  return (resolution?.requirements?.proficiencyChoices || []).filter((item) => String(item.id || '').startsWith('class-') && item.category !== 'language');
}

function classFeatureChoices() {
  return (resolution?.requirements?.featureChoices || []).filter((item) => item.origin === 'class' && item.category !== 'language');
}

function backgroundProficiencyChoices() {
  return (resolution?.requirements?.proficiencyChoices || []).filter((item) => String(item.id || '').startsWith('background-') && item.category !== 'language');
}

function backgroundFeatureChoices() {
  return (resolution?.requirements?.featureChoices || []).filter((item) => ['background', 'feat'].includes(item.origin) && item.category !== 'language');
}

function speciesFeatureChoices() {
  return (resolution?.requirements?.featureChoices || []).filter((item) => ['species', 'origin'].includes(item.origin) && item.category !== 'language');
}

function languageProficiencyChoices() {
  return (resolution?.requirements?.proficiencyChoices || []).filter((item) => item.category === 'language');
}

function languageFeatureChoices() {
  return (resolution?.requirements?.featureChoices || []).filter((item) => item.category === 'language');
}

function renderSpeciesStep() {
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Origem</p><h3>Espécie</h3></div>
    <div class="option-grid compact">
      ${bootstrap.species.map((option) => optionCard(option, 'speciesKey', draft.speciesKey)).join('')}
    </div>
    ${draft.speciesKey ? `${renderFeatureChoices(speciesFeatureChoices())}` : ''}
  `;
}

function renderLanguagesStep() {
  const rule = resolution?.requirements?.languages || { fixedName: 'Common', count: 2, options: [] };
  const selected = draft.selectedLanguages || [];
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Origem</p><h3>Idiomas</h3><p>Todos os personagens conhecem Comum e escolhem exatamente dois idiomas adicionais a partir do arquivo de idiomas.</p></div>
    <div class="locked-choice"><span>Idioma concedido automaticamente</span><strong>${escapeHtml(rule.fixedName || 'Common')}</strong></div>
    <div class="form-grid two-columns language-choice-grid">
      ${range(0, Number(rule.count || 2) - 1).map((index) => `
        <label class="field">
          <span>Idioma adicional ${index + 1}</span>
          <select data-language-choice="${index}">
            <option value="">Selecione</option>
            ${(rule.options || []).map((option) => {
              const usedElsewhere = selected.some((value, selectedIndex) => value === option.key && selectedIndex !== index);
              return `<option value="${escapeHtml(option.key)}" ${selected[index] === option.key ? 'selected' : ''} ${usedElsewhere ? 'disabled' : ''}>${escapeHtml(option.name)}</option>`;
            }).join('')}
          </select>
        </label>`).join('')}
    </div>
    ${renderProficiencyChoices(languageProficiencyChoices())}
    ${renderFeatureChoices(languageFeatureChoices())}
  `;
}

function renderSkillChoices(rule) {
  if (!rule.count) return '<div class="subsection"><h4>Perícias de classe</h4><p class="muted">A classe não exige escolhas adicionais de perícia.</p></div>';
  return `
    <div class="subsection">
      <h4>Perícias de classe <span class="requirement-count" data-class-skill-count>${draft.selectedClassSkills.length}/${rule.count}</span></h4>
      ${rule.conflictsRemoved?.length ? `<p class="notice">Conflitos com o antecedente foram substituídos por outras perícias disponíveis.</p>` : ''}
      <div class="check-grid">
        ${rule.options.map((skill) => `
          <label class="check-option">
            <input type="checkbox" data-class-skill="${escapeHtml(skill)}" ${draft.selectedClassSkills.includes(skill) ? 'checked' : ''}>
            <span>${escapeHtml(abilityLabel(skill))}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

function renderProficiencyChoices(requirements) {
  if (!requirements.length) return '';
  return `
    <div class="subsection">
      <h4>Escolhas de proficiência</h4>
      <div class="form-grid two-columns">
        ${requirements.map((requirement) => {
          const selected = String(draft.proficiencyChoices?.[requirement.id] || '').split('||').filter(Boolean);
          return range(0, Number(requirement.count || 1) - 1).map((index) => `
            <label class="field">
              <span>${escapeHtml(requirement.label)}${Number(requirement.count || 1) > 1 ? ` ${index + 1}` : ''}</span>
              <select data-proficiency-choice="${escapeHtml(requirement.id)}" data-choice-index="${index}">
                <option value="">Selecione</option>
                ${(requirement.options || []).map((option) => {
                  const usedElsewhere = selected.some((value, selectedIndex) => value === option.key && selectedIndex !== index);
                  return `<option value="${escapeHtml(option.key)}" ${selected[index] === option.key ? 'selected' : ''} ${usedElsewhere ? 'disabled' : ''}>${escapeHtml(option.name)}</option>`;
                }).join('')}
              </select>
            </label>`).join('');
        }).join('')}
      </div>
    </div>`;
}


function renderFeatureChoices(requirements) {
  if (!requirements.length) return '';
  return `
    <div class="subsection">
      <h4>Escolhas de características</h4>
      <div class="form-grid two-columns">
        ${requirements.map((requirement) => {
          const selected = String(draft.featureChoices?.[requirement.id] || '').split('||').filter(Boolean);
          return range(0, Number(requirement.count || 1) - 1).map((index) => `
            <label class="field">
              <span>${escapeHtml(requirement.label)}${Number(requirement.count || 1) > 1 ? ` ${index + 1}` : ''}</span>
              <select data-feature-choice="${escapeHtml(requirement.id)}" data-choice-index="${index}">
                <option value="">Selecione</option>
                ${(requirement.options || []).map((option) => {
                  const usedElsewhere = selected.some((value, selectedIndex) => value === option.key && selectedIndex !== index);
                  return `<option value="${escapeHtml(option.key)}" ${selected[index] === option.key ? 'selected' : ''} ${usedElsewhere ? 'disabled' : ''}>${escapeHtml(option.name)}</option>`;
                }).join('')}
              </select>
            </label>`).join('');
        }).join('')}
      </div>
    </div>`;
}

function renderFeatChoices(slots) {
  const fixed = resolution?.requirements?.backgroundFeat;
  return `
    <div class="subsection">
      <h4>Talentos</h4>
      ${fixed ? `<div class="locked-choice"><span>Nível 1 — antecedente</span><strong>${escapeHtml(fixed.name)}</strong></div>` : ''}
      <div class="form-grid two-columns">
        ${slots.map((slot, index) => `
          <label class="field">
            <span>Nível ${slot.level}</span>
            <select data-feat-index="${index}">
              <option value="">Selecione um talento</option>
              ${(resolution?.requirements?.featOptions || [])
                .filter((feat) => !slot.categories?.length || slot.categories.includes(feat.category))
                .map((feat) => `<option value="${escapeHtml(feat.key)}" ${draft.selectedFeats[index] === feat.key ? 'selected' : ''}>${escapeHtml(feat.name)} — ${escapeHtml(feat.source)}</option>`).join('')}
            </select>
          </label>
        `).join('') || '<p class="muted">Nenhum talento adicional é exigido neste nível.</p>'}
      </div>
    </div>
  `;
}

function renderAsiChoices(slots) {
  return `
    <div class="subsection">
      <h4>Melhorias de atributo</h4>
      <div class="asi-list">
        ${slots.map((slot) => renderAsiCard(slot)).join('') || '<p class="muted">Nenhuma melhoria de atributo é exigida neste nível.</p>'}
      </div>
    </div>
  `;
}

function renderAsiCard(slot) {
  const existing = draft.selectedAsis.find((asi) => Number(asi.level) === Number(slot.level)) || { level: slot.level, choiceId: 'two-half-steps', increments: {} };
  const choiceId = existing.choiceId || 'two-half-steps';
  const targets = Object.entries(existing.increments || {}).flatMap(([ability, amount]) => Array(Number(amount) === 2 ? 1 : Number(amount)).fill(ability));
  const targetCount = choiceId === 'one-full-step' ? 1 : 2;
  return `
    <div class="asi-card" data-asi-card="${slot.level}">
      <div><strong>Nível ${slot.level}</strong></div>
      <select data-asi-choice="${slot.level}">
        ${bootstrap.asiChoices.map((choice) => `<option value="${choice.id}" ${choiceId === choice.id ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}
      </select>
      <div class="inline-fields">
        ${range(0, targetCount - 1).map((index) => `
          <select data-asi-target="${slot.level}" data-target-index="${index}">
            <option value="">Atributo</option>
            ${abilityNames().map((ability) => `<option value="${ability}" ${targets[index] === ability ? 'selected' : ''}>${abilityLabel(ability)}</option>`).join('')}
          </select>
        `).join('')}
      </div>
    </div>
  `;
}

async function renderSpellsStep() {
  const spellcasting = resolution?.requirements?.spellcasting || { available: false };
  if (!spellcasting.available) {
    stepContent.innerHTML = '<div class="step-heading"><p class="eyebrow">Conjuração</p><h3>Magias</h3></div><div class="empty-state">A classe e a subclasse selecionadas não concedem conjuração neste nível.</div>';
    return;
  }
  const listClassName = spellcasting.spellListClass || '';
  const listClass = listClassName
    ? bootstrap.classes.find((option) => option.name === listClassName)
    : null;
  const spellClassKey = listClass?.key || draft.classKey;
  const usesSelectedSubclass = spellClassKey === draft.classKey;
  const spellSubclassKey = usesSelectedSubclass ? (draft.subclassKey || '') : '';
  const key = `${spellClassKey}|${spellSubclassKey}|${spellcasting.maxSpellLevel}`;
  if (loadedSpellKey !== key) {
    stepContent.innerHTML = '<div class="empty-state">Carregando lista de magias permitidas...</div>';
    try {
      const params = new URLSearchParams({ classKey: spellClassKey, maxLevel: String(spellcasting.maxSpellLevel) });
      if (spellSubclassKey) params.set('subclassKey', spellSubclassKey);
      const payload = await cachedRequestJson(`/api/creator/spells?${params}`, {
        freshForMs: 24 * 60 * 60 * 1000,
        staleForMs: 30 * 24 * 60 * 60 * 1000,
        tags: ['rules-catalog'],
      });
      spellOptions = payload.items || [];
      loadedSpellKey = key;
    } catch (error) {
      stepContent.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
      return;
    }
  }
  const cantrips = spellOptions.filter((spell) => Number(spell.level) === 0);
  const leveled = spellOptions.filter((spell) => Number(spell.level) > 0);
  const mode = spellcasting.mode;
  let body = renderSpellPicker('Truques', 'cantripsKnown', cantrips, Number(spellcasting.cantrips || 0));
  if (mode === 'spellbook') {
    body += renderSpellPicker('Magias no grimório', 'spellbook', leveled, Number(spellcasting.spellsKnown || 0));
    body += renderSpellPicker('Magias preparadas', 'preparedSpells', leveled.filter((spell) => draft.spellbook.includes(spell.key)), Number(spellcasting.preparedLimit || 0));
  } else if (mode === 'prepare_full_list') {
    body += renderSpellPicker('Magias preparadas', 'preparedSpells', leveled, Number(spellcasting.preparedLimit || 0));
  } else if (mode === 'known_as_prepared') {
    body += renderSpellPicker('Magias conhecidas e preparadas', 'spellsKnown', leveled, Number(spellcasting.spellsKnown || spellcasting.preparedLimit || 0));
  } else {
    body += renderSpellPicker('Magias conhecidas', 'spellsKnown', leveled, Number(spellcasting.spellsKnown || 0));
    body += renderSpellPicker('Magias preparadas', 'preparedSpells', leveled.filter((spell) => draft.spellsKnown.includes(spell.key)), Number(spellcasting.preparedLimit || 0));
  }
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Conjuração</p><h3>Magias</h3><p>Nível máximo de magia: ${spellcasting.maxSpellLevel}. As listas são filtradas pelo acesso da classe e subclasse no catálogo 5etools.</p></div>
    ${renderSpellSlots(spellcasting.spellSlots || [])}
    ${body}
  `;
}

function renderSpellSlots(slots) {
  return `<div class="spell-slot-preview">${slots.map((slot) => `<div><span>${roman(slot.spellLevel)}</span><strong>${'□'.repeat(slot.total)}</strong>${slot.speciesBonus ? `<small>+${slot.speciesBonus} da espécie</small>` : ''}</div>`).join('')}</div>`;
}

function renderSpellPicker(label, field, options, limit) {
  const selected = draft[field] || [];
  return `
    <div class="subsection spell-picker" data-spell-picker="${field}">
      <div class="picker-heading"><h4>${escapeHtml(label)} <span class="requirement-count">${selected.length}/${limit}</span></h4><input type="search" data-spell-search="${field}" placeholder="Buscar magia"></div>
      ${limit === 0 ? '<p class="muted">Nenhuma escolha exigida.</p>' : `
        <div class="spell-grid">
          ${options.map((spell) => `
            <label class="check-option spell-option" data-spell-name="${escapeHtml(spell.name.toLowerCase())}">
              <input type="checkbox" data-spell-field="${field}" value="${escapeHtml(spell.key)}" ${selected.includes(spell.key) ? 'checked' : ''}>
              <span><strong>${escapeHtml(spell.name)}</strong><small>Nível ${spell.level} · ${escapeHtml(spell.source)}</small></span>
            </label>
          `).join('') || '<p class="muted">Nenhuma magia compatível foi encontrada.</p>'}
        </div>
      `}
    </div>
  `;
}

function renderEquipmentStep() {
  const equipment = resolution?.requirements?.startingEquipment || { classGroups: [], backgroundGroups: [] };
  stepContent.innerHTML = `
    <div class="step-heading"><p class="eyebrow">Equipamento</p><h3>Equipamento inicial</h3><p>Escolha os pacotes e confirme o recebimento antes de criar a ficha.</p></div>
    ${renderEquipmentGroups('Classe', 'class', equipment.classGroups || [])}
    ${renderEquipmentGroups('Antecedente', 'background', equipment.backgroundGroups || [])}
    <label class="acceptance-box">
      <input type="checkbox" id="accept-starting-equipment" ${draft.startingEquipmentAccepted ? 'checked' : ''}>
      <span>Aceito o equipamento inicial selecionado e desejo adicioná-lo à ficha.</span>
    </label>
  `;
}

function renderEquipmentGroups(title, groupName, groups) {
  if (!groups.length) return `<div class="subsection"><h4>${title}</h4><p class="muted">Nenhum pacote registrado.</p></div>`;
  return `
    <div class="subsection">
      <h4>${title}</h4>
      ${groups.map((group, index) => `
        <div class="equipment-options">
          ${group.options.map((option) => {
            const key = `${groupName}:${index}`;
            const selected = draft.startingEquipmentChoices[key] === option.id;
            return `
              <label class="equipment-option ${selected ? 'selected' : ''}">
                <input type="radio" name="equipment-${groupName}-${index}" data-equipment-group="${key}" value="${escapeHtml(option.id)}" ${selected ? 'checked' : ''}>
                <strong>Opção ${escapeHtml(option.label)}</strong>
                <ul>${option.items.map((item) => `<li>${formatEquipmentItem(item)}</li>`).join('')}</ul>
              </label>
            `;
          }).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function formatEquipmentItem(item) {
  if (item.kind === 'currency') return formatCurrency(item.valueCp);
  const quantity = Number(item.quantity || 1);
  return `${quantity > 1 ? `${quantity}× ` : ''}${escapeHtml(item.name)}`;
}

function formatCurrency(valueCp) {
  let remaining = Math.max(0, Number(valueCp || 0));
  const units = [
    ['PP', 1000],
    ['GP', 100],
    ['SP', 10],
    ['CP', 1],
  ];
  const parts = [];
  for (const [label, value] of units) {
    const amount = Math.floor(remaining / value);
    if (amount) {
      parts.push(`${amount} ${label}`);
      remaining %= value;
    }
  }
  return parts.join(' · ') || '0 CP';
}

function renderValidation(errors) {
  validationSummary.replaceChildren();
  if (!errors?.length) {
    validationSummary.innerHTML = '<div class="alert success">As escolhas atuais são válidas para as etapas preenchidas.</div>';
    return;
  }
  validationSummary.innerHTML = `<div class="alert error"><strong>Há escolhas pendentes ou inválidas:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`;
}

function choiceRequirementErrors(requirements, values, label) {
  const errors = [];
  (requirements || []).forEach((requirement) => {
    const count = Number(requirement.count || 1);
    const selected = String(values?.[requirement.id] || '').split('||').filter(Boolean);
    if (selected.length !== count) errors.push(`Complete ${requirement.label || label}.`);
  });
  return errors;
}

function currentStepErrors() {
  const step = visibleSteps[currentStep]?.id;
  const requirements = resolution?.requirements || {};
  if (step === 'class') {
    const errors = [];
    if (!draft.classKey) errors.push('Escolha uma classe.');
    if (requirements.subclass?.required && !draft.subclassKey) errors.push('Escolha a subclasse exigida.');
    return errors;
  }
  if (step === 'class-choices') {
    const errors = [];
    const skills = requirements.classSkills || { count: 0 };
    if ((draft.selectedClassSkills || []).length !== Number(skills.count || 0)) errors.push(`Escolha exatamente ${Number(skills.count || 0)} perícia(s) de classe.`);
    errors.push(...choiceRequirementErrors(classProficiencyChoices(), draft.proficiencyChoices, 'a proficiência de classe'));
    errors.push(...choiceRequirementErrors(classFeatureChoices(), draft.featureChoices, 'a característica de classe'));
    if (!draft.rangedWeaponAbility) errors.push('Escolha o atributo usado por armas à distância.');
    return errors;
  }
  if (step === 'spells') {
    const spellcasting = requirements.spellcasting || {};
    const errors = [];
    const exact = (field, count, label) => {
      if ((draft[field] || []).length !== Number(count || 0)) errors.push(`Escolha exatamente ${Number(count || 0)} ${label}.`);
    };
    exact('cantripsKnown', spellcasting.cantrips, 'truque(s)');
    if (spellcasting.mode === 'spellbook') {
      exact('spellbook', spellcasting.spellsKnown, 'magia(s) para o grimório');
      exact('preparedSpells', spellcasting.preparedLimit, 'magia(s) preparada(s)');
    } else if (spellcasting.mode === 'prepare_full_list') {
      exact('preparedSpells', spellcasting.preparedLimit, 'magia(s) preparada(s)');
    } else if (spellcasting.mode === 'known_as_prepared') {
      exact('spellsKnown', spellcasting.spellsKnown || spellcasting.preparedLimit, 'magia(s) conhecida(s)');
    } else {
      exact('spellsKnown', spellcasting.spellsKnown, 'magia(s) conhecida(s)');
      exact('preparedSpells', spellcasting.preparedLimit, 'magia(s) preparada(s)');
    }
    return errors;
  }
  if (step === 'background') {
    const errors = [];
    if (!draft.backgroundKey) errors.push('Escolha um antecedente.');
    errors.push(...choiceRequirementErrors(backgroundProficiencyChoices(), draft.proficiencyChoices, 'a proficiência do antecedente'));
    errors.push(...choiceRequirementErrors(backgroundFeatureChoices(), draft.featureChoices, 'a escolha do talento de origem'));
    return errors;
  }
  if (step === 'species') {
    const errors = [];
    if (!draft.speciesKey) errors.push('Escolha uma espécie.');
    errors.push(...choiceRequirementErrors(speciesFeatureChoices(), draft.featureChoices, 'a escolha da espécie'));
    return errors;
  }
  if (step === 'languages') {
    const rule = requirements.languages || { count: 2 };
    const selected = (draft.selectedLanguages || []).filter(Boolean);
    const errors = [];
    if (selected.length !== Number(rule.count || 2) || new Set(selected).size !== selected.length) errors.push(`Escolha exatamente ${Number(rule.count || 2)} idiomas adicionais diferentes.`);
    errors.push(...choiceRequirementErrors(languageProficiencyChoices(), draft.proficiencyChoices, 'a escolha de idioma'));
    errors.push(...choiceRequirementErrors(languageFeatureChoices(), draft.featureChoices, 'a escolha de idioma'));
    return errors;
  }
  if (step === 'abilities') {
    const errors = [];
    const abilityRule = requirements.backgroundAbilities || {};
    if (abilityRule.allowed?.length && Object.values(draft.backgroundAbilityIncreases || {}).reduce((sum, value) => sum + Number(value || 0), 0) !== 3) {
      errors.push('Complete os aumentos de atributo do antecedente.');
    }
    const values = Object.values(draft.baseAbilityAssignments || {}).filter(Boolean);
    if (values.length !== 6 || new Set(values).size !== 6) errors.push('Atribua cada valor da matriz de Varkhul exatamente uma vez.');
    return errors;
  }
  if (step === 'equipment') {
    const errors = [];
    const equipment = requirements.startingEquipment || {};
    for (const [groupName, groups] of [['class', equipment.classGroups || []], ['background', equipment.backgroundGroups || []]]) {
      groups.forEach((group, index) => {
        if ((group.options || []).length > 1 && !draft.startingEquipmentChoices[`${groupName}:${index}`]) errors.push('Escolha todas as opções de equipamento inicial.');
      });
    }
    if (!draft.startingEquipmentAccepted) errors.push('Aceite o equipamento inicial antes de continuar.');
    return [...new Set(errors)];
  }
  if (step === 'details') return draft.name.trim() ? [] : ['Informe o nome do personagem.'];
  return [];
}

async function goToStep(index) {
  const target = Math.max(0, Math.min(index, visibleSteps.length - 1));
  if (target > furthestStep) return;
  currentStep = target;
  await refreshResolution(false);
  await render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

previousButton.addEventListener('click', () => goToStep(currentStep - 1));
nextButton.addEventListener('click', async () => {
  await refreshResolution(false);
  const errors = currentStepErrors();
  if (errors.length) {
    await render();
    renderValidation(errors);
    return;
  }
  furthestStep = Math.max(furthestStep, currentStep + 1);
  currentStep = Math.min(currentStep + 1, visibleSteps.length - 1);
  await render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
resolveButton.addEventListener('click', async () => {
  await refreshResolution(true);
  await render();
  renderValidation(resolution?.errors || []);
});

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  createButton.textContent = 'Criando...';
  try {
    const payload = await requestJson('/api/creator/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    successBox.hidden = false;
    successBox.textContent = `${payload.character.name} foi criado. Abrindo a ficha...`;
    await invalidateApiCache({ tags: ['player-home'] });
    window.location.assign(`./character.html?id=${encodeURIComponent(payload.character.id)}`);
    return;
  } catch (error) {
    const errors = error.payload?.errors || [error.message];
    renderValidation(errors);
  } finally {
    createButton.disabled = false;
    createButton.textContent = 'Criar personagem';
  }
});

stepList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-step-index]');
  if (button && !button.disabled) goToStep(Number(button.dataset.stepIndex));
});

stepContent.addEventListener('input', handleInput);
stepContent.addEventListener('change', handleChange);

function handleInput(event) {
  const target = event.target;
  if (target.matches('[data-draft-field="name"]')) draft.name = target.value;
  if (target.matches('[data-concept-field]')) draft.concept[target.dataset.conceptField] = target.value;
  if (target.matches('[data-spell-search]')) {
    const query = target.value.trim().toLowerCase();
    const picker = target.closest('.spell-picker');
    picker.querySelectorAll('[data-spell-name]').forEach((option) => {
      option.hidden = query && !option.dataset.spellName.includes(query);
    });
  }
}

async function handleChange(event) {
  const target = event.target;
  let mustResolve = false;
  if (target.id === 'creator-portrait-file') {
    await uploadCreatorPortrait(target.files?.[0]);
    return;
  }
  if (target.matches('[data-draft-field]')) {
    const field = target.dataset.draftField;
    draft[field] = target.value || null;
    draft.level = 1;
    mustResolve = true;
  }
  if (target.matches('[data-choice-field]')) {
    const field = target.dataset.choiceField;
    draft[field] = target.value;
    if (field === 'classKey') {
      draft.subclassKey = null;
      draft.selectedClassSkills = [];
      draft.proficiencyChoices = {};
      draft.featureChoices = {};
      draft.startingEquipmentChoices = {};
      draft.startingEquipmentAccepted = false;
      clearSpells();
      loadedSpellKey = '';
      furthestStep = 0;
    }
    if (field === 'subclassKey') {
      clearSpells();
      loadedSpellKey = '';
    }
    if (field === 'backgroundKey') {
      draft.backgroundAbilityIncreases = {};
      backgroundPatternIndex = 0;
      draft.startingEquipmentChoices = {};
      draft.startingEquipmentAccepted = false;
      furthestStep = currentStep;
    }
    if (field === 'speciesKey') furthestStep = currentStep;
    mustResolve = true;
  }
  if (target.matches('[data-ability]')) {
    const ability = target.dataset.ability;
    if (target.value) draft.baseAbilityAssignments[ability] = target.value;
    else delete draft.baseAbilityAssignments[ability];
    mustResolve = true;
  }
  if (target.id === 'background-ability-pattern') {
    backgroundPatternIndex = Number(target.value || 0);
    draft.backgroundAbilityIncreases = {};
    mustResolve = true;
  } else if (target.matches('[data-background-target]')) {
    updateBackgroundIncreases();
    mustResolve = true;
  }
  if (target.matches('[data-class-skill]')) {
    const skill = target.dataset.classSkill;
    const count = Number(resolution?.requirements?.classSkills?.count || 0);
    if (target.checked && !draft.selectedClassSkills.includes(skill)) draft.selectedClassSkills.push(skill);
    if (!target.checked) draft.selectedClassSkills = draft.selectedClassSkills.filter((item) => item !== skill);
    if (draft.selectedClassSkills.length > count) {
      draft.selectedClassSkills = draft.selectedClassSkills.filter((item) => item !== skill);
      target.checked = false;
    }
    const counter = document.querySelector('[data-class-skill-count]');
    if (counter) counter.textContent = `${draft.selectedClassSkills.length}/${count}`;
    mustResolve = true;
  }
  if (target.matches('[data-feat-index]')) {
    const index = Number(target.dataset.featIndex);
    draft.selectedFeats[index] = target.value;
    draft.selectedFeats = draft.selectedFeats.filter(Boolean);
    mustResolve = true;
  }
  if (target.matches('[data-asi-choice]') || target.matches('[data-asi-target]')) {
    updateAsiFromCard(target.closest('[data-asi-card]'));
    mustResolve = true;
  }
  if (target.matches('[data-proficiency-choice]')) {
    const identifier = target.dataset.proficiencyChoice;
    const requirement = (resolution?.requirements?.proficiencyChoices || []).find((item) => item.id === identifier);
    const count = Number(requirement?.count || 1);
    const current = String(draft.proficiencyChoices?.[identifier] || '').split('||').filter(Boolean);
    current[Number(target.dataset.choiceIndex || 0)] = target.value;
    draft.proficiencyChoices ||= {};
    draft.proficiencyChoices[identifier] = current.slice(0, count).filter(Boolean).join('||');
    mustResolve = true;
  }
  if (target.matches('[data-feature-choice]')) {
    const identifier = target.dataset.featureChoice;
    const requirement = (resolution?.requirements?.featureChoices || []).find((item) => item.id === identifier);
    const count = Number(requirement?.count || 1);
    const current = String(draft.featureChoices?.[identifier] || '').split('||').filter(Boolean);
    current[Number(target.dataset.choiceIndex || 0)] = target.value;
    draft.featureChoices ||= {};
    draft.featureChoices[identifier] = current.slice(0, count).filter(Boolean).join('||');
    mustResolve = true;
  }
  if (target.matches('[data-language-choice]')) {
    const index = Number(target.dataset.languageChoice || 0);
    const selected = [...(draft.selectedLanguages || [])];
    selected[index] = target.value;
    draft.selectedLanguages = selected.slice(0, Number(resolution?.requirements?.languages?.count || 2));
    mustResolve = true;
  }
  if (target.matches('[data-spell-field]')) {
    await updateSpellSelection(target);
  }
  if (target.matches('[data-equipment-group]')) {
    draft.startingEquipmentChoices[target.dataset.equipmentGroup] = target.value;
  }
  if (target.id === 'accept-starting-equipment') {
    draft.startingEquipmentAccepted = target.checked;
  }
  if (mustResolve) {
    await refreshResolution(false);
    await render();
  }
}

async function uploadCreatorPortrait(file) {
  const feedback = document.querySelector('#creator-portrait-feedback');
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    if (feedback) feedback.textContent = 'Use uma imagem PNG, JPEG ou WebP.';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    if (feedback) feedback.textContent = 'A imagem ultrapassa 5 MB.';
    return;
  }
  if (feedback) feedback.textContent = 'Enviando imagem...';
  try {
    const payload = await requestJson('/api/uploads/portraits', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    draft.portraitPath = payload.path;
    if (feedback) feedback.textContent = 'Imagem enviada.';
    await render();
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

function updateBackgroundIncreases() {
  const rule = resolution?.requirements?.backgroundAbilities || { patterns: [] };
  const patternSelect = document.querySelector('#background-ability-pattern');
  const patternIndex = Number(patternSelect?.value ?? backgroundPatternIndex ?? 0);
  backgroundPatternIndex = patternIndex;
  const pattern = rule.patterns[patternIndex] || [2, 1];
  const increases = {};
  document.querySelectorAll('[data-background-target]').forEach((select, index) => {
    if (!select.value) return;
    increases[select.value] = (increases[select.value] || 0) + Number(pattern[index]);
  });
  draft.backgroundAbilityIncreases = increases;
}

function updateAsiFromCard(card) {
  if (!card) return;
  const level = Number(card.dataset.asiCard);
  const choiceId = card.querySelector('[data-asi-choice]').value;
  const increments = {};
  card.querySelectorAll('[data-asi-target]').forEach((select) => {
    if (!select.value) return;
    const amount = choiceId === 'one-full-step' ? 2 : 1;
    increments[select.value] = (increments[select.value] || 0) + amount;
  });
  const next = { level, choiceId, increments };
  const index = draft.selectedAsis.findIndex((asi) => Number(asi.level) === level);
  if (index >= 0) draft.selectedAsis[index] = next;
  else draft.selectedAsis.push(next);
  draft.selectedAsis.sort((a, b) => Number(a.level) - Number(b.level));
}

async function updateSpellSelection(input) {
  const field = input.dataset.spellField;
  const spellcasting = resolution.requirements.spellcasting;
  const limit = spellLimit(field, spellcasting);
  let values = draft[field] || [];
  if (input.checked && !values.includes(input.value)) values = [...values, input.value];
  if (!input.checked) values = values.filter((value) => value !== input.value);
  if (values.length > limit) {
    input.checked = false;
    return;
  }
  draft[field] = values;
  if (field === 'spellbook') draft.preparedSpells = draft.preparedSpells.filter((value) => values.includes(value));
  if (field === 'spellsKnown') {
    if (spellcasting.mode === 'known_as_prepared') draft.preparedSpells = [...values];
    else draft.preparedSpells = draft.preparedSpells.filter((value) => values.includes(value));
  }
  await renderSpellsStep();
}

function spellLimit(field, spellcasting) {
  if (field === 'cantripsKnown') return Number(spellcasting.cantrips || 0);
  if (field === 'spellbook') return Number(spellcasting.spellsKnown || 0);
  if (field === 'spellsKnown') return Number(spellcasting.spellsKnown || spellcasting.preparedLimit || 0);
  if (field === 'preparedSpells') return Number(spellcasting.preparedLimit || 0);
  return 0;
}

function clearSpells() {
  draft.cantripsKnown = [];
  draft.spellbook = [];
  draft.spellsKnown = [];
  draft.preparedSpells = [];
}

function inferCurrentPattern(increases, patterns) {
  const values = sortedValues(Object.values(increases || {}).filter(Boolean));
  return patterns.find((pattern) => arraysEqual(sortedValues(pattern), values)) || patterns[0] || [2, 1];
}

function expandedIncreaseTargets(increases, pattern) {
  const remaining = { ...(increases || {}) };
  return pattern.map((amount) => {
    const match = Object.keys(remaining).find((ability) => remaining[ability] >= amount);
    if (!match) return '';
    remaining[match] -= amount;
    return match;
  });
}

function formatIncreasePattern(pattern) {
  if (arraysEqual(sortedValues(pattern), [1, 2])) return '+1 em um atributo e +ₒ em outro';
  if (arraysEqual(sortedValues(pattern), [1, 1, 1])) return '+ₒ em todos os três atributos';
  return pattern.map((value) => value === 2 ? '+1' : '+ₒ').join(', ');
}

function sortedValues(values) { return [...values].map(Number).sort((a, b) => a - b); }
function arraysEqual(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function range(start, end) { return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index); }
function abilityNames() { return ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']; }
function abilityLabel(value) {
  const labels = {
    strength: 'Força', dexterity: 'Destreza', constitution: 'Constituição', intelligence: 'Inteligência', wisdom: 'Sabedoria', charisma: 'Carisma',
    athletics: 'Atletismo', acrobatics: 'Acrobacia', arcana: 'Arcanismo', history: 'História', insight: 'Intuição', investigation: 'Investigação', medicine: 'Medicina', nature: 'Natureza', perception: 'Percepção', persuasion: 'Persuasão', religion: 'Religião', stealth: 'Furtividade', survival: 'Sobrevivência', intimidation: 'Intimidação', deception: 'Enganação', 'animal handling': 'Adestrar Animais', performance: 'Atuação', 'sleight of hand': 'Prestidigitação',
  };
  return labels[value] || String(value).replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function roman(value) { return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][Number(value) - 1] || String(value); }

initialize();
