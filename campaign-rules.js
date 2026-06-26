import { displayLabel, escapeHtml } from './gm-common.js';

const VALUE_TYPES = new Set(['text', 'number', 'boolean', 'list']);

function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!normalized.length) return 'regra';
  return normalized
    .map((part, index) => {
      const lower = part.toLocaleLowerCase('pt-BR');
      return index === 0 ? lower : lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    })
    .join('');
}

function flattenRules(value, prefix = '', output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    output.push({
      path: prefix || `regra${output.length + 1}`,
      label: displayLabel(prefix.split('.').pop() || `Regra ${output.length + 1}`),
      type: 'list',
      value,
    });
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        flattenRules(item, path, output);
      } else {
        const type = typeof item === 'boolean' ? 'boolean' : typeof item === 'number' ? 'number' : 'text';
        output.push({
          path,
          label: displayLabel(key),
          type,
          value: item,
        });
      }
    }
    return output;
  }
  output.push({
    path: prefix || `regra${output.length + 1}`,
    label: displayLabel(prefix || `Regra ${output.length + 1}`),
    type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text',
    value,
  });
  return output;
}

function setPath(target, path, value) {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function valueInput(type, value) {
  if (type === 'boolean') {
    return `<select data-rule-value aria-label="Valor da regra"><option value="true" ${value === true ? 'selected' : ''}>Sim</option><option value="false" ${value === false ? 'selected' : ''}>Não</option></select>`;
  }
  if (type === 'number') {
    return `<input data-rule-value type="number" step="any" value="${escapeHtml(value ?? '')}" aria-label="Valor numérico da regra">`;
  }
  if (type === 'list') {
    const items = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n|,/);
    return `<textarea data-rule-value rows="3" maxlength="2000" aria-label="Itens da regra, um por linha">${escapeHtml(items.map((item) => String(item).trim()).filter(Boolean).join('\n'))}</textarea>`;
  }
  return `<input data-rule-value type="text" value="${escapeHtml(value ?? '')}" maxlength="500" aria-label="Valor da regra">`;
}

function ruleRow(rule = {}) {
  const type = VALUE_TYPES.has(rule.type) ? rule.type : 'text';
  const path = String(rule.path || slugify(rule.label || 'regra'));
  const label = String(rule.label || displayLabel(path.split('.').pop()));
  return `<div class="campaign-rule-row" data-campaign-rule>
    <input data-rule-path type="hidden" value="${escapeHtml(path)}">
    <label>Nome da regra
      <input data-rule-label type="text" value="${escapeHtml(label)}" maxlength="120" required>
    </label>
    <label>Tipo de valor
      <select data-rule-type>
        <option value="text" ${type === 'text' ? 'selected' : ''}>Texto</option>
        <option value="number" ${type === 'number' ? 'selected' : ''}>Número</option>
        <option value="boolean" ${type === 'boolean' ? 'selected' : ''}>Sim ou não</option>
        <option value="list" ${type === 'list' ? 'selected' : ''}>Lista</option>
      </select>
    </label>
    <label class="campaign-rule-value">Valor
      ${valueInput(type, rule.value)}
    </label>
    <button class="danger-button compact-button" type="button" data-remove-rule aria-label="Remover regra">Remover</button>
  </div>`;
}

function bindRow(row) {
  const typeSelect = row.querySelector('[data-rule-type]');
  const labelInput = row.querySelector('[data-rule-label]');
  const pathInput = row.querySelector('[data-rule-path]');
  const valueLabel = row.querySelector('.campaign-rule-value');

  typeSelect.addEventListener('change', () => {
    const previous = row.querySelector('[data-rule-value]')?.value ?? '';
    valueLabel.innerHTML = `Valor${valueInput(typeSelect.value, previous)}`;
  });

  labelInput.addEventListener('change', () => {
    if (!pathInput.dataset.preserved) {
      pathInput.value = slugify(labelInput.value);
    }
  });

  row.querySelector('[data-remove-rule]').addEventListener('click', () => row.remove());
}

export function mountCampaignRuleBuilder(container, rules = {}) {
  container.innerHTML = '';
  const flattened = flattenRules(rules);
  const items = flattened.length ? flattened : [];
  items.forEach((rule) => addCampaignRule(container, rule, true));
}

export function addCampaignRule(container, rule = {}, preservePath = false) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = ruleRow(rule);
  const row = wrapper.firstElementChild;
  if (preservePath) row.querySelector('[data-rule-path]').dataset.preserved = 'true';
  container.append(row);
  bindRow(row);
  row.querySelector('[data-rule-label]').focus();
  return row;
}

export function collectCampaignRules(container) {
  const rules = {};
  const usedPaths = new Set();
  for (const row of container.querySelectorAll('[data-campaign-rule]')) {
    const label = row.querySelector('[data-rule-label]').value.trim();
    if (!label) throw new Error('Toda regra própria precisa de um nome.');
    let path = row.querySelector('[data-rule-path]').value.trim() || slugify(label);
    if (usedPaths.has(path)) {
      let suffix = 2;
      while (usedPaths.has(`${path}${suffix}`)) suffix += 1;
      path = `${path}${suffix}`;
    }
    usedPaths.add(path);
    const type = row.querySelector('[data-rule-type]').value;
    const raw = row.querySelector('[data-rule-value]').value;
    let value = raw.trim();
    if (type === 'boolean') value = raw === 'true';
    if (type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`Informe um número válido para a regra “${label}”.`);
      }
    }
    if (type === 'list') {
      value = raw
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    setPath(rules, path, value);
  }
  return rules;
}
