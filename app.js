import {
  initializeAreaSwitcher,
  initializeLogoutButtons,
  invalidateProfileRoleCache,
  requireAuthenticatedPage,
  resolveApiUrl,
  setPreferredArea,
} from './auth-client.js';
import { displayValue, formatDate, markdownToHtml, structuredDataToHtml } from './gm-common.js';
import { cachedRequestJson, debounceRefresh, invalidateApiCache, requestJson } from './data-client.js';
import { subscribeToDatabaseChanges } from './realtime-client.js';
const root = document.documentElement;
const themeButton = document.querySelector('#theme-toggle');
const healthBadge = document.querySelector('#health-badge');
const playerWelcome = document.querySelector('#player-welcome');
const characterGrid = document.querySelector('#character-grid');
const campaignCodeForm = document.querySelector('#campaign-code-form');
const campaignCodeInput = document.querySelector('#campaign-code');
const campaignFeedback = document.querySelector('#campaign-feedback');
const campaignList = document.querySelector('#campaign-list');
const recentLoreList = document.querySelector('#recent-lore-list');
const quickSearchForm = document.querySelector('#quick-search-form');
const quickSearchInput = document.querySelector('#quick-search-input');
const quickSearchResults = document.querySelector('#quick-search-results');
const homeDialog = document.querySelector('#home-dialog');
const homeDialogContent = document.querySelector('#home-dialog-content');
const promotionRequestButton = document.querySelector('#gm-promotion-request');
const promotionForm = document.querySelector('#gm-promotion-form');
const promotionCodeInput = document.querySelector('#gm-promotion-code');
const promotionConfirmButton = document.querySelector('#gm-promotion-confirm');
const promotionFeedback = document.querySelector('#gm-promotion-feedback');

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
const classNamesPtBr = {
  Barbarian: 'Bárbaro', Bard: 'Bardo', Cleric: 'Clérigo', Druid: 'Druida',
  Fighter: 'Guerreiro', Monk: 'Monge', Paladin: 'Paladino', Ranger: 'Patrulheiro',
  Rogue: 'Ladino', Sorcerer: 'Feiticeiro', Warlock: 'Bruxo', Wizard: 'Mago', Artificer: 'Artífice',
};
const entityNamesPtBr = {
  item: 'Item', baseitem: 'Item básico', spell: 'Magia', feat: 'Talento', class: 'Classe',
  subclass: 'Subclasse', race: 'Espécie', background: 'Antecedente', variantrule: 'Regra', skill: 'Perícia',
};
let characters = [];
let campaigns = [];
let pendingJoinCode = '';
let campaignEncounterSubscription = null;
let playerHomeSubscription = null;
let lastPlayerTurnNotification = null;
let promotionRequestId = '';
let promotionExpiresAt = 0;
let promotionCountdown = null;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function displayNameFromKey(key, fallback = '—') { return String(key || '').split('|')[0].trim() || fallback; }
function localizeClassName(name) { return classNamesPtBr[name] || name; }
function classPaletteStyle(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  const palette = classPalettes[key] || classPalettes.fighter;
  return [
    `--class-color:${palette[0]}`,
    ...classToneNames.map((tone, index) => `--class-${tone}:${palette[index]}`),
  ].join(';');
}

function countLabel(count, singular, plural = `${singular}s`) {
  const value = Number(count || 0);
  return `${value} ${value === 1 ? singular : plural}`;
}
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
function openDialog(html) {
  homeDialogContent.innerHTML = html;
  if (homeDialog.open) return;
  if (typeof homeDialog.showModal === 'function') homeDialog.showModal();
  else homeDialog.setAttribute('open', '');
}

function renderCharacters() {
  if (!characters.length) {
    characterGrid.innerHTML = `<div class="empty-state character-empty"><h4>Nenhum personagem criado</h4><p>Todo personagem começa no nível 1 e evolui pela própria ficha.</p><a class="primary-button button-link" href="./creator.html">Criar primeiro personagem</a></div>`;
    return;
  }
  characterGrid.innerHTML = characters.map((character) => {
    const identity = character.sheetData?.identity || {};
    const species = identity.speciesName || displayNameFromKey(character.speciesKey);
    const rawClassName = identity.className || displayNameFromKey(character.classKey);
    const className = localizeClassName(rawClassName);
    const subclass = identity.subclassName || displayNameFromKey(character.subclassKey, '');
    const portrait = character.portraitPath || character.sheetData?.portraitPath || '';
    const initials = character.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    const playStats = character.sheetData?.derived?.playStats || {};
    const playState = character.sheetData?.playState || {};
    const maxHp = Number(playStats.maxHp || 0);
    const currentHp = Number(playState.currentHp ?? playStats.currentHp ?? maxHp);
    const campaignLocked = Boolean(character.campaign);
    return `<article class="player-character-card" style="${classPaletteStyle(rawClassName)}">
      <a class="character-card-link" href="./character.html?id=${encodeURIComponent(character.id)}" aria-label="Abrir ${escapeHtml(character.name)}">
        <div class="character-card-body"><h4 class="character-card-name">${escapeHtml(character.name)}</h4><p class="character-card-species">${escapeHtml(species)}</p>
          <div class="character-card-hp" aria-label="Pontos de vida"><span>${currentHp || '—'}</span><b>/</b><span>${maxHp || '—'}</span></div>
          <div class="character-card-meta"><strong>${escapeHtml(className)}</strong><span>${escapeHtml(subclass || '—')}</span><em>${character.level}</em></div>
        </div>
        <div class="character-card-portrait">${portrait ? `<img src="${escapeHtml(portrait)}" alt="Retrato de ${escapeHtml(character.name)}">` : `<span>${escapeHtml(initials)}</span>`}</div>
      </a>
      <div class="character-card-actions"><button class="danger-button compact-button" type="button" data-delete-character="${escapeHtml(character.id)}" data-character-name="${escapeHtml(character.name)}" ${campaignLocked ? 'disabled title="O Mestre precisa remover este personagem da campanha antes da exclusão."' : ''}>${campaignLocked ? 'Vinculado à campanha' : 'Excluir personagem'}</button></div>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-delete-character]:not([disabled])').forEach((button) => {
    button.addEventListener('click', () => deleteCharacter(button.dataset.deleteCharacter, button.dataset.characterName));
  });
}

async function deleteCharacter(characterId, characterName) {
  const confirmed = window.confirm(
    `Excluir permanentemente ${characterName}? Esta ação não pode ser desfeita.`,
  );
  if (!confirmed) return;
  try {
    await requestJson(`/api/characters/${encodeURIComponent(characterId)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await invalidateApiCache({ tags: ['player-home'] });
    await loadHome({ forceRefresh: true });
  } catch (error) {
    alert(error.message);
  }
}

function clearPromotionCountdown() {
  if (promotionCountdown) clearInterval(promotionCountdown);
  promotionCountdown = null;
}

function promotionSecondsRemaining() {
  return Math.max(0, Math.ceil((promotionExpiresAt - Date.now()) / 1000));
}

function renderPromotionState(status = {}) {
  clearPromotionCountdown();
  const active = Boolean(status.active && status.requestId && status.expiresAt);
  promotionRequestId = active ? String(status.requestId) : '';
  promotionExpiresAt = active ? Date.parse(status.expiresAt) : 0;
  promotionCodeInput.disabled = !active;
  promotionConfirmButton.disabled = !active;
  promotionRequestButton.disabled = active || status.status === 'not_configured';

  if (status.status === 'not_configured') {
    promotionFeedback.textContent = 'A promoção por ntfy ainda não foi configurada no servidor.';
    return;
  }
  if (!active) {
    promotionFeedback.textContent = status.status === 'expired'
      ? 'O código anterior expirou. Solicite um novo.'
      : 'Nenhum código ativo.';
    return;
  }

  const update = () => {
    const remaining = promotionSecondsRemaining();
    if (remaining <= 0) {
      clearPromotionCountdown();
      promotionRequestId = '';
      promotionCodeInput.disabled = true;
      promotionConfirmButton.disabled = true;
      promotionRequestButton.disabled = false;
      promotionFeedback.textContent = 'O código expirou. Solicite um novo.';
      return;
    }
    promotionFeedback.textContent = `Código ativo por mais ${remaining} segundo(s). ${Number(status.attemptsRemaining ?? 5)} tentativa(s) disponível(is).`;
  };
  update();
  promotionCountdown = setInterval(update, 1000);
}

async function loadPromotionStatus() {
  try {
    const status = await requestJson('/api/account/gm-promotion/status');
    renderPromotionState(status);
  } catch (error) {
    promotionFeedback.textContent = error.message;
  }
}

promotionRequestButton.addEventListener('click', async () => {
  promotionRequestButton.disabled = true;
  const promotionEndpoint = resolveApiUrl('/api/account/gm-promotion/request');
  promotionFeedback.textContent = 'Enviando solicitação ao dispositivo autorizador...';
  console.info('[GM promotion] Enviando solicitação', { endpoint: promotionEndpoint });
  try {
    const status = await requestJson('/api/account/gm-promotion/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    promotionCodeInput.value = '';
    renderPromotionState({ ...status, active: true });
    promotionCodeInput.focus();
  } catch (error) {
    console.error('[GM promotion] Falha na solicitação', {
      endpoint: promotionEndpoint,
      error,
    });
    promotionRequestButton.disabled = false;
    promotionFeedback.textContent = error.message;
  }
});

promotionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!promotionRequestId) return;
  promotionConfirmButton.disabled = true;
  try {
    await requestJson('/api/account/gm-promotion/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: promotionRequestId,
        code: promotionCodeInput.value.trim(),
      }),
    });
    clearPromotionCountdown();
    invalidateProfileRoleCache();
    setPreferredArea('dm');
    await invalidateApiCache({ tags: ['player-home'] });
    promotionFeedback.textContent = 'Conta promovida. Abrindo o painel do Mestre...';
    window.location.assign('./dm.html');
  } catch (error) {
    promotionFeedback.textContent = error.message;
    promotionConfirmButton.disabled = false;
    promotionCodeInput.select();
  }
});

function renderCampaigns() {
  if (!campaigns.length) {
    campaignList.innerHTML = '<div class="empty-state">Nenhum personagem está vinculado a uma campanha.</div>';
    return;
  }
  campaignList.innerHTML = campaigns.map((campaign) => {
    const bannerStyle = campaign.bannerPath ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"` : '';
    return `<button type="button" class="campaign-card" data-campaign-id="${escapeHtml(campaign.id)}" ${bannerStyle}>
      <span class="campaign-card-overlay"></span><span class="campaign-card-content">
        <span class="eyebrow">Campanha</span><strong>${escapeHtml(campaign.name)}</strong>
        <small>${countLabel(campaign.characters.length, 'personagem', 'personagens')} • nível inicial ${campaign.startingLevel}</small>
      </span></button>`;
  }).join('');
  document.querySelectorAll('[data-campaign-id]').forEach((button) => button.addEventListener('click', () => openCampaign(button.dataset.campaignId)));
}

function renderRecentLore(items) {
  if (!items.length) {
    recentLoreList.innerHTML = '<div class="empty-state">Nenhuma página de lore foi visitada ainda.</div>';
    return;
  }
  recentLoreList.innerHTML = items.map((item) => `<a class="recent-lore-card" href="./lore.html?slug=${encodeURIComponent(item.slug)}">
    <span class="eyebrow">${escapeHtml(item.category || 'Lore')}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.excerpt || '')}</p>
  </a>`).join('');
}

const playerEncounterStatLabels = {
  passivePerception: 'Percepção passiva', speed: 'Deslocamento', challengeRating: 'ND',
  abilityDc: 'CD', legendaryActions: 'Ações lendárias', savingThrows: 'Salvaguardas',
  abilityModifiers: 'Modificadores', abilityScores: 'Atributos', skills: 'Perícias', image: 'Imagem',
};

function playerEncounterStats(state) {
  const stats = state.stats && typeof state.stats === 'object' ? state.stats : {};
  const rows = Object.entries(stats)
    .filter(([key, value]) => playerEncounterStatLabels[key] && value != null && value !== '')
    .map(([key, value]) => {
      if (key === 'image' && /^https?:\/\//i.test(String(value))) {
        return `<div><dt>${playerEncounterStatLabels[key]}</dt><dd><img src="${escapeHtml(value)}" alt="Imagem da criatura"></dd></div>`;
      }
      return `<div><dt>${playerEncounterStatLabels[key]}</dt><dd>${structuredDataToHtml(value, { emptyMessage: 'Não informado' })}</dd></div>`;
    });
  return rows.length
    ? `<details class="initiative-stats player-visible-stats"><summary>Informações da criatura</summary><dl class="structured-data encounter-stat-details">${rows.join('')}</dl></details>`
    : '';
}

function showPlayerTurnNotification(encounter) {
  if (!encounter?.viewerTurn || !encounter.activeParticipantKey) return;
  const notificationKey = `${encounter.id}:${encounter.activeParticipantKey}:${encounter.round}`;
  if (lastPlayerTurnNotification === notificationKey) return;
  lastPlayerTurnNotification = notificationKey;
  document.querySelector('.player-turn-notification')?.remove();
  const participant = encounter.participants.find((item) => item.key === encounter.activeParticipantKey);
  const notice = document.createElement('div');
  notice.className = 'player-turn-notification';
  notice.setAttribute('role', 'alert');
  notice.setAttribute('aria-live', 'assertive');
  notice.innerHTML = `<strong>É o seu turno</strong><span>${escapeHtml(participant?.state?.name || 'Seu personagem')} · Rodada ${Number(encounter.round || 1)}</span><button type="button" aria-label="Fechar">×</button>`;
  notice.querySelector('button').addEventListener('click', () => notice.remove());
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 9000);
}

function playerInitiativeControl(participant, encounter) {
  if (!participant.ownedByViewer) return `<span>${participant.initiative ?? '—'}</span>`;
  return `<form class="player-initiative-entry" data-player-initiative data-character-id="${escapeHtml(participant.key)}"><label>Iniciativa<input name="initiative" type="number" value="${participant.initiative ?? ''}" required></label><button class="secondary-button compact-button" type="submit">Salvar</button></form>`;
}

function renderPlayerEncounter(encounter) {
  const container = document.querySelector('#player-active-encounter');
  if (!container) return;
  if (!encounter) { container.innerHTML = '<div class="empty-state">Nenhum encontro ativo.</div>'; return; }
  const collecting = encounter.initiativePhase === 'collecting';
  container.innerHTML = `<div class="player-encounter-header"><div><p class="eyebrow">Encontro ativo</p><h3>${escapeHtml(encounter.name)}</h3><small>${collecting ? `Aguardando iniciativas · ${encounter.initiativeEntered}/${encounter.initiativeRequired}` : `Rodada ${encounter.round}`}</small></div><div class="round-display"><span>Rodada</span><strong>${encounter.round}</strong></div></div><div class="player-initiative-list">${encounter.participants.map((participant) => { const state = participant.state || {}; const active = participant.key === encounter.activeParticipantKey; const creatureName = `${state.name || participant.key}${state.ordinal ? ` (${state.ordinal})` : ''}`; const creatureHealth = encounter.settings?.creatureHealthDisplay === 'exact' && state.currentHp != null ? `${state.currentHp}/${state.maxHp} PV` : (state.healthCategory || 'Desconhecido'); const armorClass = state.armorClass == null ? '' : ` · CA ${state.armorClass}`; return `<article class="player-initiative-row ${active ? 'active-turn' : ''}" data-player-participant="${escapeHtml(participant.key)}"><strong>${escapeHtml(creatureName)}</strong>${playerInitiativeControl(participant, encounter)}${participant.type === 'creature' ? `<em>${escapeHtml(creatureHealth)}${escapeHtml(armorClass)}</em>` : `<em>${state.currentHp}/${state.maxHp} PV${escapeHtml(armorClass)}</em>`}<div>${(participant.conditions || []).map((condition) => `<small>${escapeHtml(condition.name)}${condition.turns == null ? '' : ` (${condition.turns})`}</small>`).join('')}</div>${participant.type === 'creature' ? playerEncounterStats(state) : ''}${active && participant.ownedByViewer && encounter.initiativePhase === 'running' ? '<button class="primary-button player-end-turn" type="button" data-player-end-turn>Encerrar turno</button>' : ''}</article>`; }).join('')}</div>`;
  container.querySelectorAll('[data-player-initiative]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const initiative = new FormData(form).get('initiative');
    try {
      const updated = await requestJson(`/api/campaigns/${encodeURIComponent(encounter.campaignId)}/active-encounter/initiative`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: form.dataset.characterId, initiative }) });
      renderPlayerEncounter(updated);
    } catch (error) { alert(error.message); }
  }));
  container.querySelector('[data-player-end-turn]')?.addEventListener('click', async () => {
    try {
      const updated = await requestJson(`/api/campaigns/${encodeURIComponent(encounter.campaignId)}/active-encounter/end-turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      renderPlayerEncounter(updated);
    } catch (error) { alert(error.message); }
  });
  showPlayerTurnNotification(encounter);
}

async function stopCampaignEncounterRealtime() {
  if (!campaignEncounterSubscription) return;
  const current = campaignEncounterSubscription;
  campaignEncounterSubscription = null;
  await current.unsubscribe().catch(() => {});
}

async function refreshCampaignEncounter(campaignId) {
  if (!homeDialog.open) return;
  try {
    const payload = await requestJson(`/api/campaigns/${encodeURIComponent(campaignId)}/active-encounter`);
    renderPlayerEncounter(payload.encounter);
  } catch {
    // Keep the last synchronized encounter while the connection recovers.
  }
}

async function startCampaignEncounterRealtime(campaignId) {
  await stopCampaignEncounterRealtime();
  try {
    campaignEncounterSubscription = await subscribeToDatabaseChanges({
      name: `player-campaign-${campaignId}`,
      bindings: [
        { table: 'encounters', filter: `campaign_id=eq.${campaignId}` },
        { table: 'encounter_participants' },
      ],
      onChange: () => refreshCampaignEncounter(campaignId),
      fallback: () => refreshCampaignEncounter(campaignId),
      fallbackIntervalMs: 1000,
    });
  } catch {
    // Realtime unavailable: use the built-in one-second fallback behavior locally.
    const timer = window.setInterval(() => refreshCampaignEncounter(campaignId), 1000);
    campaignEncounterSubscription = { unsubscribe: async () => window.clearInterval(timer) };
  }
}
homeDialog.addEventListener('close', () => { void stopCampaignEncounterRealtime(); });

async function openCampaign(campaignId, { forceRefresh = false } = {}) {
  try {
    const campaignUrl = `/api/campaigns/${encodeURIComponent(campaignId)}`;
    const campaign = await cachedRequestJson(campaignUrl, {
      freshForMs: 3000,
      staleForMs: 60 * 60 * 1000,
      forceRefresh,
      tags: [`campaign:${campaignId}`],
    });
    const characterOptions = campaign.characters?.map((character) => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}</option>`).join('') || '';
    const conversations = campaign.messageThreads?.length ? campaign.messageThreads.map((thread) => `<article class="player-gm-thread"><header><strong>${escapeHtml(thread.characterName || 'Conversa da campanha')}</strong></header>${thread.messages.map((message) => `<div class="player-gm-message ${message.fromGm ? 'from-gm' : 'from-player'}"><strong>${message.fromGm ? 'Mestre' : 'Você'}</strong><p>${escapeHtml(message.body)}</p><time datetime="${escapeHtml(message.createdAt || '')}">${formatDate(message.createdAt)}</time></div>`).join('')}</article>`).join('') : '<p class="muted">Nenhuma mensagem enviada ainda.</p>';
    openDialog(`<article class="campaign-manager-player">
      <header class="campaign-manager-header" ${campaign.bannerPath ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"` : ''}>
        <div><p class="eyebrow">Campanha</p><h2>${escapeHtml(campaign.name)}</h2><p>${escapeHtml(campaign.description || 'Sem descrição.')}</p></div>
      </header>
      <section class="panel compact-panel campaign-player-overview">
        <div class="campaign-player-metadata">
          <div><span>Nível inicial</span><strong>${Number(campaign.startingLevel || 1)}</strong></div>
          <div><span>Seus personagens</span><strong>${countLabel(campaign.characters?.length, 'personagem', 'personagens')}</strong></div>
        </div>
        <details class="campaign-player-rules" ${Object.keys(campaign.homebrewRules || {}).length ? 'open' : ''}>
          <summary>Regras próprias da campanha</summary>
          ${structuredDataToHtml(campaign.homebrewRules || {}, { emptyMessage: 'Nenhuma regra própria cadastrada.' })}
        </details>
      </section>
      <section class="panel compact-panel"><div id="player-active-encounter"></div></section>
      <div class="campaign-player-tools">
        <section class="panel compact-panel"><h3>Mensagens com o Mestre</h3><div class="player-gm-thread-list">${conversations}</div>
          <form id="gm-message-form" data-campaign-id="${escapeHtml(campaign.id)}">${characterOptions ? `<label>Personagem relacionado<select name="characterId"><option value="">Campanha em geral</option>${characterOptions}</select></label>` : ''}<textarea name="body" rows="4" maxlength="4000" placeholder="Mensagem privada para o Mestre" required></textarea><button class="primary-button" type="submit">Enviar</button></form>
          <div id="gm-message-feedback" aria-live="polite"></div>
        </section>
        <section class="panel compact-panel"><h3>Mural dos Jogadores</h3><p class="muted">Mural textual exclusivo dos jogadores desta campanha.</p>
          <form id="player-board-form" data-campaign-id="${escapeHtml(campaign.id)}"><textarea name="body" rows="3" maxlength="4000" placeholder="Publicar no mural" required></textarea><button class="primary-button" type="submit">Publicar</button></form>
          <div class="player-board-list">${campaign.playerBoard.length ? campaign.playerBoard.map((post) => `<article><strong>${escapeHtml(post.author)}</strong><time datetime="${escapeHtml(post.createdAt || '')}">${formatDate(post.createdAt)}</time><p>${escapeHtml(post.body)}</p></article>`).join('') : '<p class="muted">Nenhuma publicação ainda.</p>'}</div>
        </section>
      </div>
      <section class="panel compact-panel campaign-shared-notes"><div class="section-heading-row"><div><p class="eyebrow">Documento compartilhado</p><h3>Anotações da campanha</h3></div><span>Revisão ${Number(campaign.campaignNotes?.revision || 0)}</span></div><div class="campaign-notes-player-layout"><form id="player-campaign-notes-form" data-campaign-id="${escapeHtml(campaign.id)}"><textarea name="markdown" rows="12">${escapeHtml(campaign.campaignNotes?.markdown || '')}</textarea><input name="revision" type="hidden" value="${Number(campaign.campaignNotes?.revision || 0)}"><button class="primary-button" type="submit">Salvar anotações</button><div id="player-notes-feedback"></div></form><article id="player-notes-preview" class="lore-content">${markdownToHtml(campaign.campaignNotes?.markdown || '') || '<p class="muted">Nenhuma anotação ainda.</p>'}</article></div></section>
    </article>`);
    renderPlayerEncounter(campaign.activeEncounter);
    document.querySelector('#gm-message-form').addEventListener('submit', submitGmMessage);
    document.querySelector('#player-board-form').addEventListener('submit', submitBoardPost);
    document.querySelector('#player-campaign-notes-form').addEventListener('submit', submitCampaignNotes);
    const notes = document.querySelector('#player-campaign-notes-form textarea');
    notes.addEventListener('input', () => { document.querySelector('#player-notes-preview').innerHTML = markdownToHtml(notes.value); });
    void startCampaignEncounterRealtime(campaign.id);
  } catch (error) { openDialog(`<div class="alert error">${escapeHtml(error.message)}</div>`); }
}
async function submitGmMessage(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const body = data.get('body');
  const feedback = document.querySelector('#gm-message-feedback');
  try { await requestJson(`/api/campaigns/${form.dataset.campaignId}/message-gm`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body, characterId:data.get('characterId') || null})}); form.reset(); feedback.innerHTML='<div class="alert success">Mensagem enviada ao Mestre.</div>'; await invalidateApiCache({ tags: [`campaign:${form.dataset.campaignId}`] }); await openCampaign(form.dataset.campaignId, { forceRefresh: true }); }
  catch (error) { feedback.innerHTML=`<div class="alert error">${escapeHtml(error.message)}</div>`; }
}
async function submitCampaignNotes(event) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const feedback = document.querySelector('#player-notes-feedback');
  try { await requestJson(`/api/campaigns/${form.dataset.campaignId}/notes`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({markdown:data.get('markdown'), revision:Number(data.get('revision'))})}); feedback.innerHTML='<div class="alert success">Anotações salvas.</div>'; await invalidateApiCache({ tags: [`campaign:${form.dataset.campaignId}`] }); await openCampaign(form.dataset.campaignId, { forceRefresh: true }); }
  catch (error) { feedback.innerHTML=`<div class="alert error">${escapeHtml(error.message)}</div>`; }
}
async function submitBoardPost(event) {
  event.preventDefault(); const form = event.currentTarget; const body = new FormData(form).get('body');
  try { await requestJson(`/api/campaigns/${form.dataset.campaignId}/player-board`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body})}); await invalidateApiCache({ tags: [`campaign:${form.dataset.campaignId}`] }); await openCampaign(form.dataset.campaignId, { forceRefresh: true }); }
  catch (error) { alert(error.message); }
}

campaignCodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  pendingJoinCode = campaignCodeInput.value.trim();
  if (pendingJoinCode.length !== 13) { campaignFeedback.textContent = 'O código deve ter 13 caracteres.'; return; }
  if (!characters.length) { campaignFeedback.textContent = 'Crie um personagem antes de entrar em uma campanha.'; return; }
  const availableCharacters = characters.filter((character) => !character.campaign);
  if (!availableCharacters.length) {
    campaignFeedback.textContent = 'Todos os seus personagens já participam de uma campanha. Cada personagem pode participar de apenas uma.';
    return;
  }
  openDialog(`<section class="join-character-dialog"><p class="eyebrow">Participar de campanha</p><h2>Escolha o personagem</h2><p>O código será usado somente depois da escolha do personagem.</p>
    <form id="join-character-form"><div class="join-character-options">${availableCharacters.map((character, index) => `<label><input type="radio" name="characterId" value="${escapeHtml(character.id)}" ${index === 0 ? 'checked' : ''}><span><strong>${escapeHtml(character.name)}</strong><small>Nível ${character.level}</small></span></label>`).join('')}</div><button class="primary-button" type="submit">Confirmar participação</button></form></section>`);
  document.querySelector('#join-character-form').addEventListener('submit', submitCampaignJoin);
});
async function submitCampaignJoin(event) {
  event.preventDefault(); const characterId = new FormData(event.currentTarget).get('characterId');
  try {
    const payload = await requestJson('/api/campaigns/join', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({joinCode:pendingJoinCode, characterId})});
    homeDialog.close(); campaignFeedback.textContent = `${payload.campaign.name} vinculada ao personagem.`; campaignCodeForm.reset();
    await invalidateApiCache({ tags: ['player-home'] });
    await loadHome({ forceRefresh: true });
  } catch (error) { document.querySelector('.join-character-dialog').insertAdjacentHTML('beforeend', `<div class="alert error">${escapeHtml(error.message)}</div>`); }
}

quickSearchForm.addEventListener('submit', async (event) => {
  event.preventDefault(); const q = quickSearchInput.value.trim(); if (q.length < 2) return;
  quickSearchResults.innerHTML = '<div class="empty-state">Pesquisando...</div>';
  try {
    const payload = await cachedRequestJson(`/api/quick-search?q=${encodeURIComponent(q)}&limit=30`, {
      freshForMs: 5 * 60 * 1000,
      staleForMs: 7 * 24 * 60 * 60 * 1000,
      tags: ['rules-search'],
    });
    renderQuickResults(payload.items || []);
  } catch (error) { quickSearchResults.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }
});
function renderQuickResults(items) {
  if (!items.length) { quickSearchResults.innerHTML = '<div class="empty-state">Nenhum resultado encontrado.</div>'; return; }
  quickSearchResults.innerHTML = items.map((item, index) => `<button type="button" class="quick-result-row" data-result-index="${index}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(entityNamesPtBr[item.type] || item.type)}</small></span><em>${escapeHtml(item.source || '')}${item.page ? ` p.${escapeHtml(item.page)}` : ''}</em></button>`).join('');
  document.querySelectorAll('[data-result-index]').forEach((button) => button.addEventListener('click', () => openQuickCard(items[Number(button.dataset.resultIndex)])));
}
function openQuickCard(item) {
  openDialog(`<article class="reference-detail-card"><header><p class="eyebrow">${escapeHtml(entityNamesPtBr[item.type] || item.type)}</p><h2>${escapeHtml(item.name)}</h2><div><span>${escapeHtml(displayValue(item.category || ''))}</span><strong>${escapeHtml(item.source || '')}${item.page ? ` p.${escapeHtml(item.page)}` : ''}</strong></div></header><div class="reference-divider"></div><p>${escapeHtml(item.description || 'Sem descrição disponível no catálogo.')}</p></article>`);
}

function applyHomeSnapshot(snapshot = {}) {
  const profile = snapshot.profile || {};
  characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];
  campaigns = Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [];
  playerWelcome.textContent = `Bem-vindo, ${profile.displayName || 'jogador'}, a Varkhul`;
  renderCharacters();
  renderCampaigns();
  renderRecentLore(Array.isArray(snapshot.recent_lore) ? snapshot.recent_lore : []);
  renderPromotionState(snapshot.promotion || {});
  healthBadge.className = 'status-badge ok';
  healthBadge.textContent = navigator.onLine === false ? 'Dados salvos neste dispositivo' : 'Painel atualizado';
}

async function loadHome({ forceRefresh = false } = {}) {
  initializeTheme();
  if (!characters.length) {
    healthBadge.className = 'status-badge pending';
    healthBadge.textContent = 'Carregando painel';
  }
  try {
    const snapshot = await cachedRequestJson('/api/player/bootstrap', {
      freshForMs: 10_000,
      staleForMs: 24 * 60 * 60 * 1000,
      forceRefresh,
      tags: ['player-home'],
      onUpdate: applyHomeSnapshot,
    });
    applyHomeSnapshot(snapshot);
  } catch (error) {
    healthBadge.className = 'status-badge error';
    healthBadge.textContent = 'Falha ao carregar';
    characterGrid.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

const refreshPlayerHome = debounceRefresh(async () => {
  await invalidateApiCache({ tags: ['player-home'] });
  await loadHome({ forceRefresh: true });
}, 180);

async function startPlayerHomeRealtime() {
  try {
    playerHomeSubscription = await subscribeToDatabaseChanges({
      name: 'player-home',
      bindings: [
        { table: 'profiles' },
        { table: 'characters' },
        { table: 'character_campaigns' },
        { table: 'campaigns' },
        { table: 'lore_entries' },
        { table: 'lore_visits' },
        { table: 'gm_promotion_requests' },
      ],
      onChange: refreshPlayerHome,
      fallback: refreshPlayerHome,
      fallbackIntervalMs: 30_000,
    });
  } catch {
    // Cached data remains available; explicit actions still revalidate immediately.
  }
}

async function initializePlayerHome() {
  if (!await requireAuthenticatedPage('player')) return;
  initializeLogoutButtons();
  await initializeAreaSwitcher('player');
  await loadHome();
  await startPlayerHomeRealtime();
}

window.addEventListener('beforeunload', () => {
  void playerHomeSubscription?.unsubscribe();
  void campaignEncounterSubscription?.unsubscribe();
});

initializePlayerHome();
