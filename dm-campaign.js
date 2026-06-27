import {
  currentId,
  escapeHtml,
  formatDate,
  initializeGmShell,
  markdownToHtml,
  cachedRequestJson,
  requestJson,
  structuredDataToHtml,
} from "./gm-common.js";
import {
  addCampaignRule,
  collectCampaignRules,
  mountCampaignRuleBuilder,
} from "./campaign-rules.js";
import { debounceRefresh, invalidateApiCache } from "./data-client.js";
import { subscribeToDatabaseChanges } from "./realtime-client.js";
const campaignId = currentId();
const root = document.querySelector("#campaign-manager-root");
const encounterDialog = document.querySelector("#encounter-create-dialog");
const encounterForm = document.querySelector("#encounter-create-form");
const campaignEditDialog = document.querySelector("#campaign-edit-dialog");
const campaignEditForm = document.querySelector("#campaign-edit-form");
const campaignEditRules = document.querySelector("#campaign-edit-rules");
const campaignEditBannerInput = document.querySelector("#campaign-edit-banner-input");
const campaignEditBannerPreview = document.querySelector("#campaign-edit-banner-preview");
const campaignDeleteDialog = document.querySelector("#campaign-delete-dialog");
const campaignDeleteForm = document.querySelector("#campaign-delete-form");
let campaign = null;
let threads = [];
let requests = [];
let activeTab = "overview";
let activeEncounterId = "";
let encounterSubscription = null;
let activeEncounterRevision = -1;
let campaignSubscription = null;
let creatureSuggestions = [];
let creatureSearchTimer = null;

const encounterStatLabels = {
  armorClass: "AC",
  passivePerception: "Percepção passiva",
  speed: "Deslocamento",
  challengeRating: "ND",
  abilityDc: "CD de habilidade",
  legendaryActions: "Ações lendárias",
  savingThrows: "Testes de resistência",
  abilityModifiers: "Modificadores de atributo",
  abilityScores: "Valores de atributo",
  skills: "Perícias",
  image: "Imagem / marcador",
};
const encounterStatKeys = Object.keys(encounterStatLabels);

function encounterStatsMarkup(state, settings) {
  const stats = state.stats && typeof state.stats === "object" ? state.stats : {};
  const values = { ...stats, armorClass: state.armorClass };
  const rows = encounterStatKeys
    .filter((key) => values[key] != null && values[key] !== "")
    .map((key) => {
      const playerVisible = (settings.visibleColumns || []).includes(key);
      const visibility = playerVisible ? " · visível aos jogadores" : "";
      if (key === "image" && /^https?:\/\//i.test(String(values[key]))) {
        return `<div><dt>${encounterStatLabels[key]}${visibility}</dt><dd><img src="${escapeHtml(values[key])}" alt="Imagem da criatura"></dd></div>`;
      }
      return `<div><dt>${encounterStatLabels[key]}${visibility}</dt><dd>${structuredDataToHtml(values[key], { emptyMessage: "Não informado" })}</dd></div>`;
    });
  return rows.length
    ? `<details class="initiative-stats"><summary>Informações da criatura</summary><dl class="structured-data encounter-stat-details">${rows.join("")}</dl></details>`
    : "";
}

function setTab(tab) {
  activeTab = tab;
  if (tab !== "encounters")
    document.body.classList.remove("encounter-focus-mode");
  document
    .querySelectorAll("[data-campaign-tab]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.campaignTab === tab),
    );
  document.querySelectorAll("[data-campaign-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.campaignPanel !== tab;
  });
  if (tab === "encounters" && activeEncounterId) startEncounterRealtime();
  else stopEncounterRealtime();
}

function campaignHeader() {
  const banner = campaign.bannerPath
    ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"`
    : '';
  const characterCount = campaign.characters.length;
  return `<header class="campaign-manager-header gm-campaign-hero" ${banner}>
    <div>
      <p class="eyebrow">Gerenciamento de campanha</p>
      <h1>${escapeHtml(campaign.name)}</h1>
      <p>${escapeHtml(campaign.description || 'Sem descrição da campanha.')}</p>
      <div class="gm-hero-meta">
        <span>Nível inicial ${Number(campaign.startingLevel || 1)}</span>
        <span>${characterCount} ${characterCount === 1 ? 'personagem' : 'personagens'}</span>
        <span>Código <code>${escapeHtml(campaign.joinCode)}</code></span>
      </div>
    </div>
  </header>`;
}

function characterCard(character) {
  const slots = character.spellSlots?.length
    ? character.spellSlots
      .map((slot) => `<span title="Nível de magia ${slot.level}">N${slot.level}: ${slot.remaining}/${slot.total}</span>`)
      .join('')
    : '<span>Nenhum espaço de magia</span>';
  const resources = character.featureResources?.length
    ? character.featureResources
      .map((resource) => `<span>${escapeHtml(resource.name)}: ${resource.remaining}/${resource.maximum}</span>`)
      .join('')
    : '<span>Nenhum recurso com usos</span>';
  const authorization = character.levelUpAuthorization || {};
  const atMaximum = Number(character.level) >= 20;
  const authorizationButton = atMaximum
    ? '<button class="secondary-button compact-button" type="button" disabled>Nível 20 alcançado</button>'
    : `<button class="${authorization.authorized ? 'danger-button' : 'primary-button'} compact-button" type="button" data-level-up-authorization data-character-id="${escapeHtml(character.id)}" data-authorized="${authorization.authorized ? 'true' : 'false'}">${authorization.authorized ? `Revogar nível ${authorization.targetLevel}` : `Autorizar nível ${authorization.targetLevel}`}</button>`;
  const authorizationStatus = authorization.authorized
    ? `<span class="status-badge ok">Nível ${authorization.targetLevel} autorizado</span>`
    : `<span class="status-badge pending">Nível ${authorization.targetLevel} bloqueado</span>`;
  return `<article class="gm-character-monitor">
    <header>
      ${character.portraitPath ? `<img src="${escapeHtml(character.portraitPath)}" alt="Retrato de ${escapeHtml(character.name)}">` : '<span class="portrait-placeholder" aria-hidden="true">?</span>'}
      <div>
        <p class="eyebrow">${escapeHtml(character.playerName)}</p>
        <h3>${escapeHtml(character.name)}</h3>
        <small>Nível ${character.level} ${escapeHtml(character.className || '')}${character.subclass ? ` · ${escapeHtml(character.subclass)}` : ''}</small>
      </div>
    </header>
    <div class="gm-character-vitals">
      <span><strong>${character.currentHp}/${character.maxHp}</strong> PV</span>
      <span><strong>${character.temporaryHp}</strong> PV temporários</span>
      <span><strong>${character.armorClass ?? '—'}</strong> CA</span>
      <span><strong>${character.spellSaveDc ?? '—'}</strong> CD</span>
      <span><strong>${character.passivePerception ?? '—'}</strong> Percepção passiva</span>
    </div>
    <details><summary>Espaços de magia</summary><div class="resource-chip-row">${slots}</div></details>
    <details><summary>Recursos com usos</summary><div class="resource-chip-row">${resources}</div></details>
    <div class="gm-level-up-authorization">
      <div><strong>Acesso à evolução</strong>${authorizationStatus}</div>
      <div class="inline-actions">
        ${authorizationButton}
        <button class="danger-button compact-button" type="button" data-remove-campaign-character data-character-id="${escapeHtml(character.id)}" data-character-name="${escapeHtml(character.name)}">Remover da campanha</button>
      </div>
    </div>
    <small>Ficha gerenciada pelo jogador · atualizada em ${formatDate(character.updatedAt)}</small>
  </article>`;
}

function renderOverview() {
  const playerCount = new Set(campaign.characters.map((item) => item.playerEmail)).size;
  const rules = campaign.homebrewRules || {};
  return `<section data-campaign-panel="overview" class="gm-campaign-panel">
    <div class="gm-stat-grid">
      <div class="gm-stat-card static"><span>Jogadores</span><strong>${playerCount}</strong></div>
      <div class="gm-stat-card static"><span>Personagens</span><strong>${campaign.characters.length}</strong></div>
      <div class="gm-stat-card static"><span>Encontros</span><strong>${campaign.encounters.length}</strong></div>
      <div class="gm-stat-card static"><span>Regras próprias</span><strong>${Object.keys(rules).length}</strong></div>
    </div>
    <div class="gm-dashboard-columns">
      <section class="panel">
        <h3>Código de convite</h3>
        <p class="lead"><code class="campaign-code-display">${escapeHtml(campaign.joinCode)}</code></p>
        <p>Os jogadores informam este código de 13 caracteres na barra lateral e escolhem um personagem.</p>
      </section>
      <section class="panel">
        <h3>Regras próprias</h3>
        ${structuredDataToHtml(rules, { emptyMessage: 'Nenhuma regra própria cadastrada.' })}
      </section>
    </div>
  </section>`;
}

function renderPlayers() {
  return `<section data-campaign-panel="players" class="gm-campaign-panel" hidden>
    <div class="section-heading-row">
      <div><p class="eyebrow">Visão sincronizada das fichas</p><h3>Jogadores e personagens</h3></div>
      <span class="status-badge ok">Atualização a cada 45 segundos</span>
    </div>
    <p class="muted">Os jogadores gerenciam os próprios pontos de vida, espaços de magia, equipamentos e recursos. Este painel é somente para consulta.</p>
    <div class="gm-character-monitor-grid">${campaign.characters.length ? campaign.characters.map(characterCard).join('') : '<div class="empty-state">Nenhum personagem participa desta campanha.</div>'}</div>
  </section>`;
}

function renderEncounterList() {
  return `<div class="section-heading-row">
    <div><p class="eyebrow">Gerenciamento de criaturas</p><h2>Encontros</h2></div>
    <button id="create-encounter-button" class="primary-button" type="button">Criar encontro</button>
  </div>
  <div class="gm-encounter-list">${campaign.encounters.length
    ? campaign.encounters.map((encounter) => `<button class="gm-encounter-row ${encounter.isActive ? 'active' : ''}" type="button" data-open-encounter="${encounter.id}"><span><strong>${escapeHtml(encounter.name)}</strong><small>Rodada ${encounter.round} · revisão ${encounter.revision}</small></span><em>${encounter.isActive ? 'ATIVO' : formatDate(encounter.updatedAt)}</em></button>`).join('')
    : '<div class="empty-state">Nenhum encontro criado.</div>'}</div>
  <div id="encounter-runner"></div>`;
}

function renderMessages() {
  return `<section data-campaign-panel="messages" class="gm-campaign-panel" hidden>
    <div class="section-heading-row"><div><p class="eyebrow">Conversas diretas</p><h3>Mensagens</h3></div></div>
    <div class="gm-message-layout">
      <aside id="gm-thread-list" class="gm-thread-list">${threads.length
        ? threads.map((thread) => `<button type="button" data-thread-id="${thread.id}"><span><strong>${escapeHtml(thread.playerName)}</strong><small>${escapeHtml(thread.characterName || 'Nenhum personagem selecionado')}</small></span>${thread.unreadCount ? `<em>${thread.unreadCount}</em>` : ''}<p>${escapeHtml(thread.lastBody || '')}</p></button>`).join('')
        : '<div class="empty-state">Nenhuma mensagem direta.</div>'}</aside>
      <section id="gm-thread-view" class="panel"><div class="empty-state">Selecione uma conversa.</div></section>
    </div>
  </section>`;
}

function renderNotes() {
  return `<section data-campaign-panel="notes" class="gm-campaign-panel" hidden>
    <div class="section-heading-row"><div><p class="eyebrow">Documento compartilhado</p><h3>Anotações da campanha</h3></div><span>Revisão <strong id="notes-revision-label">${campaign.notes.revision}</strong></span></div>
    <div class="gm-notes-layout">
      <form id="campaign-notes-form">
        <textarea name="markdown" rows="24">${escapeHtml(campaign.notes.markdown || '')}</textarea>
        <input name="revision" type="hidden" value="${campaign.notes.revision}">
        <button class="primary-button" type="submit">Salvar anotações</button>
        <div id="notes-feedback" aria-live="polite"></div>
      </form>
      <article id="campaign-notes-preview" class="panel lore-content">${markdownToHtml(campaign.notes.markdown || '') || '<p class="muted">Ainda não há anotações da campanha.</p>'}</article>
    </div>
  </section>`;
}

function renderLore() {
  return `<section data-campaign-panel="lore" class="gm-campaign-panel" hidden>
    <div class="panel">
      <p class="eyebrow">Lore da campanha</p>
      <h3>Publicar lore para ${escapeHtml(campaign.name)}</h3>
      <p>Crie ou envie um documento Markdown, selecione <strong>Lore da campanha</strong>, escolha esta campanha e, se desejar, insira o link nas anotações compartilhadas.</p>
      <a class="primary-button button-link" href="./dm-lore.html">Abrir editor de lore</a>
    </div>
  </section>`;
}

function renderRequests() {
  return `<section data-campaign-panel="requests" class="gm-campaign-panel" hidden>
    <div class="section-heading-row"><div><p class="eyebrow">Solicitações dos jogadores</p><h3>Solicitações de itens</h3></div></div>
    <div id="campaign-request-list">${requests.length
      ? requests.map((request) => `<article class="dm-request-card"><div><p class="eyebrow">${escapeHtml(request.playerName)}</p><h3>${escapeHtml(request.item.name)}</h3><p>${escapeHtml(request.characterName)} · quantidade ${Number(request.item.quantity || 1)}</p><small>${escapeHtml(request.item.description || '')}</small></div><div class="inline-actions"><button class="secondary-button" data-request-review="reject" data-id="${request.id}">Rejeitar</button><button class="primary-button" data-request-review="approve" data-id="${request.id}">Aprovar</button></div></article>`).join('')
      : '<div class="empty-state">Nenhuma solicitação de item pendente nesta campanha.</div>'}</div>
  </section>`;
}

function renderSettings() {
  return `<section data-campaign-panel="settings" class="gm-campaign-panel" hidden>
    <div class="panel">
      <p class="eyebrow">Configuração da campanha</p>
      <div class="section-heading-row"><h3>Configurações</h3><button id="edit-campaign-button" class="primary-button" type="button">Editar campanha</button></div>
      <dl class="gm-definition-list">
        <div><dt>Nome</dt><dd>${escapeHtml(campaign.name)}</dd></div>
        <div><dt>Nível inicial</dt><dd>${campaign.startingLevel}</dd></div>
        <div><dt>Código de convite</dt><dd><code>${escapeHtml(campaign.joinCode)}</code></dd></div>
        <div><dt>Criada em</dt><dd>${formatDate(campaign.createdAt)}</dd></div>
        <div><dt>Atualizada em</dt><dd>${formatDate(campaign.updatedAt)}</dd></div>
      </dl>
    </div>
    <div class="panel campaign-danger-zone">
      <p class="eyebrow">Zona de risco</p>
      <h3>Excluir campanha</h3>
      <p>A exclusão remove encontros, mensagens, anotações e vínculos da campanha. As fichas dos personagens permanecem disponíveis para seus jogadores.</p>
      <button id="delete-campaign-button" class="danger-button" type="button">Excluir campanha</button>
    </div>
  </section>`;
}

function renderCampaign() {
  root.innerHTML = `${campaignHeader()}
    <nav class="gm-campaign-tabs" aria-label="Seções da campanha">
      <button data-campaign-tab="overview">Visão geral</button>
      <button data-campaign-tab="players">Jogadores</button>
      <button data-campaign-tab="encounters">Encontros</button>
      <button data-campaign-tab="messages">Mensagens</button>
      <button data-campaign-tab="notes">Anotações</button>
      <button data-campaign-tab="lore">Lore</button>
      <button data-campaign-tab="requests">Solicitações</button>
      <button data-campaign-tab="settings">Configurações</button>
    </nav>
    <div class="gm-campaign-panels">
      ${renderOverview()}
      ${renderPlayers()}
      <section data-campaign-panel="encounters" class="gm-campaign-panel" hidden>${renderEncounterList()}</section>
      ${renderMessages()}
      ${renderNotes()}
      ${renderLore()}
      ${renderRequests()}
      ${renderSettings()}
    </div>`;
  document.querySelectorAll('[data-campaign-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.campaignTab));
  });
  attachCampaignHandlers();
  setTab(activeTab);
}

function showDialog(dialog) {
  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (dialog?.close) dialog.close();
  else dialog?.removeAttribute("open");
}

function setCampaignEditFeedback(message = "", kind = "") {
  const feedback = document.querySelector("#campaign-edit-feedback");
  if (!feedback) return;
  feedback.innerHTML = message
    ? `<div class="${kind === "pending" ? "status-badge pending" : `alert ${kind || "error"}`}">${escapeHtml(message)}</div>`
    : "";
}

function openCampaignEditDialog() {
  campaignEditForm.reset();
  campaignEditForm.elements.name.value = campaign.name || "";
  campaignEditForm.elements.startingLevel.value = Number(campaign.startingLevel || 1);
  campaignEditForm.elements.description.value = campaign.description || "";
  campaignEditForm.elements.bannerPath.value = campaign.bannerPath || "";
  campaignEditForm.elements.removeBanner.checked = false;
  mountCampaignRuleBuilder(campaignEditRules, campaign.homebrewRules || {});
  if (campaign.bannerPath) {
    campaignEditBannerPreview.src = campaign.bannerPath;
    campaignEditBannerPreview.hidden = false;
  } else {
    campaignEditBannerPreview.hidden = true;
    campaignEditBannerPreview.removeAttribute("src");
  }
  setCampaignEditFeedback();
  showDialog(campaignEditDialog);
}

function openCampaignDeleteDialog() {
  campaignDeleteForm.reset();
  const feedback = document.querySelector("#campaign-delete-feedback");
  if (feedback) feedback.replaceChildren();
  showDialog(campaignDeleteDialog);
  campaignDeleteForm.elements.confirmationName.focus();
}

async function uploadCampaignBanner() {
  const file = campaignEditBannerInput.files?.[0];
  if (!file) return;
  setCampaignEditFeedback("Enviando imagem de capa...", "pending");
  try {
    const payload = await requestJson("/api/uploads/campaign-banners", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    campaignEditForm.elements.bannerPath.value = payload.path;
    campaignEditForm.elements.removeBanner.checked = false;
    campaignEditBannerPreview.src = payload.path;
    campaignEditBannerPreview.hidden = false;
    setCampaignEditFeedback("Imagem de capa enviada.", "success");
  } catch (error) {
    campaignEditBannerInput.value = "";
    setCampaignEditFeedback(error.message, "error");
  }
}

async function saveCampaignSettings(event) {
  event.preventDefault();
  const submit = campaignEditForm.querySelector('[type="submit"]');
  submit.disabled = true;
  setCampaignEditFeedback("Salvando alterações...", "pending");
  try {
    const data = new FormData(campaignEditForm);
    const updated = await requestJson(`/api/dm/campaigns/${campaignId}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        startingLevel: Number(data.get("startingLevel")),
        description: data.get("description"),
        homebrewRules: collectCampaignRules(campaignEditRules),
        bannerPath: data.get("removeBanner") === "on" ? "" : data.get("bannerPath"),
      }),
    });
    campaign = { ...campaign, ...updated };
    closeDialog(campaignEditDialog);
    activeTab = "settings";
    await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
  } catch (error) {
    setCampaignEditFeedback(error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function deleteCampaign(event) {
  event.preventDefault();
  const feedback = document.querySelector("#campaign-delete-feedback");
  const submit = campaignDeleteForm.querySelector('[type="submit"]');
  submit.disabled = true;
  if (feedback) feedback.innerHTML = '<div class="status-badge pending">Excluindo campanha...</div>';
  try {
    const data = new FormData(campaignDeleteForm);
    await requestJson(`/api/dm/campaigns/${campaignId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationName: data.get("confirmationName") }),
    });
    location.replace("./dm-campaigns.html");
  } catch (error) {
    if (feedback) feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
    submit.disabled = false;
  }
}

function attachCampaignHandlers() {
  document.querySelector("#edit-campaign-button")?.addEventListener("click", openCampaignEditDialog);
  document.querySelector("#delete-campaign-button")?.addEventListener("click", openCampaignDeleteDialog);
  document
    .querySelector("#create-encounter-button")
    ?.addEventListener("click", () =>
      encounterDialog.showModal
        ? encounterDialog.showModal()
        : encounterDialog.setAttribute("open", ""),
    );
  document
    .querySelectorAll("[data-open-encounter]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openEncounter(button.dataset.openEncounter),
      ),
    );
  document
    .querySelectorAll("[data-thread-id]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openThread(button.dataset.threadId),
      ),
    );
  document
    .querySelector("#campaign-notes-form")
    ?.addEventListener("submit", saveNotes);
  const notes = document.querySelector("#campaign-notes-form textarea");
  notes?.addEventListener("input", () => {
    document.querySelector("#campaign-notes-preview").innerHTML =
      markdownToHtml(notes.value);
  });
  document
    .querySelectorAll("[data-request-review]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        reviewRequest(
          button.dataset.id,
          button.dataset.requestReview === "approve",
        ),
      ),
    );
  document.querySelectorAll("[data-level-up-authorization]").forEach((button) =>
    button.addEventListener("click", async () => {
      const authorized = button.dataset.authorized === "true";
      button.disabled = true;
      try {
        await requestJson(
          `/api/dm/campaigns/${campaignId}/characters/${button.dataset.characterId}/level-up-authorization`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authorized: !authorized }),
          },
        );
        activeTab = "players";
        await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    }),
  );
  document.querySelectorAll("[data-remove-campaign-character]").forEach((button) =>
    button.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Remover ${button.dataset.characterName} desta campanha? O personagem não será excluído.`,
      );
      if (!confirmed) return;
      button.disabled = true;
      try {
        await requestJson(
          `/api/dm/campaigns/${campaignId}/characters/${button.dataset.characterId}/remove`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        activeTab = "players";
        await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    }),
  );
}

async function saveNotes(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const feedback = document.querySelector("#notes-feedback");
  try {
    const result = await requestJson(`/api/dm/campaigns/${campaignId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: data.get("markdown"),
        revision: Number(data.get("revision")),
      }),
    });
    campaign.notes = result;
    form.elements.revision.value = result.revision;
    document.querySelector("#notes-revision-label").textContent =
      result.revision;
    feedback.innerHTML =
      '<div class="alert success">Anotações da campanha salvas.</div>';
  } catch (error) {
    feedback.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

async function reviewRequest(id, approved) {
  try {
    await requestJson(`/api/dm/item-requests/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
  } catch (error) {
    alert(error.message);
  }
}

async function openThread(id) {
  const view = document.querySelector("#gm-thread-view");
  view.innerHTML = '<div class="empty-state">Carregando conversa...</div>';
  try {
    const thread = await requestJson(`/api/dm/messages/${id}`);
    view.innerHTML = `<header><p class="eyebrow">${escapeHtml(thread.campaignName)}</p><h2>${escapeHtml(thread.playerName)}</h2><small>${escapeHtml(thread.characterName || "Nenhum personagem selecionado")}</small></header><div class="gm-message-transcript">${thread.messages.map((message) => `<article class="gm-message ${message.fromGm ? "from-gm" : "from-player"}"><strong>${escapeHtml(message.senderName)}</strong><p>${escapeHtml(message.body)}</p><time>${formatDate(message.createdAt)}</time></article>`).join("")}</div><form id="gm-reply-form" data-thread-id="${thread.id}"><textarea name="body" rows="4" maxlength="4000" placeholder="Escreva uma resposta" required></textarea><button class="primary-button" type="submit">Enviar resposta</button></form>`;
    view
      .querySelector("#gm-reply-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = new FormData(event.currentTarget).get("body");
        try {
          await requestJson(`/api/dm/messages/${id}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          });
          await refreshThreads();
          await openThread(id);
        } catch (error) {
          alert(error.message);
        }
      });
  } catch (error) {
    view.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

async function refreshThreads() {
  threads =
    (await requestJson(`/api/dm/campaigns/${campaignId}/messages`)).items || [];
}

campaignEditForm.addEventListener("submit", saveCampaignSettings);
campaignEditBannerInput.addEventListener("change", uploadCampaignBanner);
document.querySelector("#campaign-edit-add-rule")?.addEventListener("click", () => {
  addCampaignRule(campaignEditRules, { label: "Nova regra", type: "text", value: "" });
});
document.querySelectorAll("[data-close-campaign-edit]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(campaignEditDialog));
});
campaignDeleteForm.addEventListener("submit", deleteCampaign);
document.querySelectorAll("[data-close-campaign-delete]").forEach((button) => {
  button.addEventListener("click", () => closeDialog(campaignDeleteDialog));
});

encounterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = new FormData(encounterForm).get("name");
  try {
    const encounter = await requestJson(
      `/api/dm/campaigns/${campaignId}/encounters`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    encounterDialog.close();
    encounterForm.reset();
    activeTab = "encounters";
    await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
    await openEncounter(encounter.id);
  } catch (error) {
    alert(error.message);
  }
});
document
  .querySelectorAll("[data-close-encounter-dialog]")
  .forEach((button) =>
    button.addEventListener("click", () => encounterDialog.close()),
  );

function conditionRows(conditions) {
  return conditions?.length
    ? conditions
        .map(
          (condition, index) =>
            `<span class="condition-chip" style="--condition-color:${escapeHtml(condition.color || "#8F718F")}"><span>${escapeHtml(condition.name)}${condition.turns == null ? "" : ` (${condition.turns})`}</span>${condition.turns == null ? "" : `<button type="button" title="Diminuir duração" data-condition-action="decrease" data-condition-index="${index}">−</button><button type="button" title="Aumentar duração" data-condition-action="increase" data-condition-index="${index}">+</button>`}<button type="button" title="Remover condição" data-condition-action="remove" data-condition-index="${index}">×</button></span>`,
        )
        .join("")
    : '<span class="muted">Nenhuma condição</span>';
}

function encounterSettingsFields(settings) {
  const columns = encounterStatKeys
    .map(
      (key) =>
        `<label class="checkbox-line"><input name="visibleColumns" type="checkbox" value="${key}" ${(settings.visibleColumns || []).includes(key) ? "checked" : ""}> ${encounterStatLabels[key]}</label>`,
    )
    .join("");
  return `<label>Ordenação<select name="sortMode"><option value="initiative" ${settings.sortMode === "initiative" ? "selected" : ""}>Iniciativa</option><option value="alphabetical" ${settings.sortMode === "alphabetical" ? "selected" : ""}>Alfabética</option></select></label><label>Vida das criaturas para jogadores<select name="creatureHealthDisplay"><option value="category" ${settings.creatureHealthDisplay === "category" ? "selected" : ""}>Categoria de vida</option><option value="exact" ${settings.creatureHealthDisplay === "exact" ? "selected" : ""}>PV exatos</option></select></label><label class="checkbox-line"><input name="showOrdinals" type="checkbox" ${settings.showOrdinals ? "checked" : ""}> Exibir numeração de duplicatas</label><label class="checkbox-line"><input name="locked" type="checkbox" ${settings.locked ? "checked" : ""}> Bloquear edição do rastreador</label><details class="encounter-column-settings"><summary>Estatísticas de criaturas visíveis aos jogadores</summary><div>${columns}</div></details><button class="secondary-button compact-button" type="submit">Salvar configurações do rastreador</button>`;
}

function playerEncounterResources(state) {
  const slots = state.spellSlots?.length
    ? state.spellSlots
        .map(
          (slot) =>
            `<span title="Nível de magia ${slot.level}">L${slot.level} ${slot.remaining}/${slot.total}</span>`,
        )
        .join("")
    : "<span>Nenhum espaço de magia</span>";
  const features = state.featureResources?.length
    ? state.featureResources
        .map(
          (resource) =>
            `<span>${escapeHtml(resource.name)} ${resource.remaining}/${resource.maximum}</span>`,
        )
        .join("")
    : "<span>Nenhuma habilidade com usos</span>";
  return `<details><summary>Recursos gerenciados pelo jogador</summary><div class="initiative-resource-groups"><div><small>Espaços de magia</small>${slots}</div><div><small>Habilidades</small>${features}</div><div><small>Testes contra a morte</small><span>${Number(state.deathSaveSuccesses || 0)} sucessos</span><span>${Number(state.deathSaveFailures || 0)} falhas</span></div></div></details>`;
}

function encounterName(participant) {
  const state = participant?.state || {};
  const base = state.customName || state.name || participant?.key || "Desconhecido";
  return `${base}${state.ordinal ? ` (${state.ordinal})` : ""}`;
}

function encounterCurrentNext(encounter) {
  const participants = encounter.participants || [];
  const currentIndex = participants.findIndex(
    (item) => item.key === encounter.activeParticipantKey,
  );
  if (currentIndex < 0) return { current: null, next: null };
  return {
    current: participants[currentIndex],
    next: participants[(currentIndex + 1) % participants.length] || null,
  };
}

function initiativeEntry(participant, encounter, label = "Iniciativa") {
  const disabled = !encounter.isActive || encounter.settings.locked;
  return `<label class="initiative-entry-field">${label}<input class="encounter-editor-control" data-field="initiative" type="number" value="${participant.initiative ?? ""}" ${disabled ? "disabled" : ""} aria-label="${label}"></label>`;
}

function creatureEditor(participant, encounter) {
  const state = participant.state || {};
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="encounter-creature-card ${active ? "active-turn" : ""}" data-participant-key="${escapeHtml(participant.key)}">
    <header><div><p class="eyebrow">${active ? "Criatura atual" : "Criatura"}</p><h3>${escapeHtml(encounterName(participant))}</h3></div>${initiativeEntry(participant, encounter)}</header>
    <div class="initiative-hp"><label>PV<input class="encounter-editor-control" data-field="currentHp" type="number" min="0" value="${Number(state.currentHp || 0)}"></label><span>/</span><label>Máx.<input class="encounter-editor-control" data-field="maxHp" type="number" min="0" value="${Number(state.maxHp || 0)}"></label><label>Temporários<input class="encounter-editor-control" data-field="temporaryHp" type="number" min="0" value="${Number(state.temporaryHp || 0)}"></label></div>
    ${encounterStatsMarkup(state, encounter.settings)}
    <div class="initiative-conditions"><div>${conditionRows(participant.conditions)}</div><div class="condition-add-row"><input class="encounter-editor-control" data-condition-name placeholder="Condição"><input class="encounter-editor-control" data-condition-turns type="number" min="1" placeholder="Turnos"><input class="encounter-editor-control" data-condition-color type="color" value="#8F718F" title="Cor da condição"><button type="button" class="secondary-button compact-button encounter-editor-control" data-add-condition>Adicionar</button></div></div>
    <label class="checkbox-line"><input class="encounter-editor-control" data-field="visible" type="checkbox" ${participant.visible ? "checked" : ""}> Visível aos jogadores</label>
    <div class="inline-actions"><button type="button" class="secondary-button compact-button encounter-editor-control" data-save-participant>Salvar criatura</button><button type="button" class="secondary-button compact-button encounter-editor-control" data-duplicate-participant>Duplicar</button><button type="button" class="danger-button compact-button encounter-editor-control" data-remove-participant>Remover</button>${active && encounter.initiativePhase === "running" ? '<button type="button" class="primary-button compact-button" data-end-creature-turn>Encerrar turno</button>' : ""}</div>
  </article>`;
}

function playerDetail(participant, encounter) {
  const state = participant.state || {};
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="encounter-player-card ${active ? "active-turn" : ""}" data-participant-key="${escapeHtml(participant.key)}">
    <header>${state.portraitPath ? `<img src="${escapeHtml(state.portraitPath)}" alt="">` : '<span class="portrait-placeholder">?</span>'}<div><p class="eyebrow">${escapeHtml(state.playerName || "Jogador")}</p><h3>${escapeHtml(state.name || participant.key)}</h3></div>${initiativeEntry(participant, encounter)}</header>
    <div class="initiative-hp read-only"><span><strong>${state.currentHp}/${state.maxHp}</strong> PV</span><span>${state.temporaryHp || 0} temporários</span><span>${state.armorClass ?? "—"} CA</span></div>
    <div class="initiative-conditions">${playerEncounterResources(state)}</div>
    ${encounter.isActive ? '<button type="button" class="secondary-button compact-button encounter-editor-control" data-save-participant>Salvar iniciativa</button>' : '<small class="muted">A iniciativa será liberada quando o encontro começar.</small>'}
  </article>`;
}

function initiativeOrderRow(participant, encounter) {
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="figma-initiative-order-row ${active ? "active-turn" : ""}"><span class="initiative-position">${participant.initiative ?? "—"}</span><div><strong>${escapeHtml(encounterName(participant))}</strong><small>${participant.type === "creature" ? "Criatura" : `Jogador · ${escapeHtml(participant.state?.playerName || "")}`}</small></div>${active ? "<em>TURNO</em>" : ""}</article>`;
}

async function openEncounter(id, force = true) {
  activeEncounterId = id;
  document.body.classList.add("encounter-focus-mode");
  const runner = document.querySelector("#encounter-runner");
  if (!runner) return;
  try {
    const encounter = await requestJson(`/api/dm/encounters/${id}`);
    if (!force && encounter.revision === activeEncounterRevision) return;
    if (!force && runner.contains(document.activeElement)) return;
    activeEncounterRevision = encounter.revision;
    const creatures = encounter.participants.filter(
      (participant) => participant.type === "creature",
    );
    const players = encounter.participants.filter(
      (participant) => participant.type === "character",
    );
    const { current, next } = encounterCurrentNext(encounter);
    const phaseCopy =
      encounter.initiativePhase === "collecting"
        ? `Lançamento de iniciativa aberto · ${encounter.initiativeEntered}/${encounter.initiativeRequired} informadas`
        : encounter.initiativePhase === "running"
          ? `Rodada ${encounter.round}`
          : "Inicie o encontro para informar as iniciativas";
    runner.innerHTML = `<section class="initiative-tracker figma-encounter-layout">
      <header class="figma-encounter-toolbar"><div><p class="eyebrow">Rastreador de iniciativa</p><h2>${escapeHtml(encounter.name)}</h2><span class="status-badge ${encounter.isActive ? "ok" : "pending"}">${encounter.isActive ? phaseCopy : "Inativo"}</span></div><div class="initiative-controls"><button class="secondary-button" data-close-encounter>Voltar aos encontros</button><button class="secondary-button" data-toggle-active>${encounter.isActive ? "Encerrar encontro" : "Iniciar encontro"}</button><button class="secondary-button" data-reset-encounter>Reiniciar</button><button class="secondary-button" data-rename-encounter>Renomear</button><button class="danger-button" data-delete-encounter>Excluir</button></div></header>
      <div class="figma-current-next"><div class="figma-current-initiative"><small>Iniciativa atual</small><strong>${current ? escapeHtml(encounterName(current)) : encounter.initiativePhase === "collecting" ? "Coletando iniciativas" : "—"}</strong></div><div class="figma-next-initiative"><small>Próxima iniciativa</small><strong>${next ? escapeHtml(encounterName(next)) : "—"}</strong></div><div class="figma-initiative-value">${current?.initiative ?? "—"}</div></div>
      <form id="encounter-settings-form" class="encounter-settings-form">${encounterSettingsFields(encounter.settings)}</form>
      <div class="figma-encounter-grid">
        <section class="figma-creature-details"><div class="section-heading-row"><div><p class="eyebrow">Bestiário</p><h3>Detalhes das criaturas</h3></div></div>
          <form id="add-creature-form" class="add-creature-form figma-add-creature"><div class="encounter-creature-search"><input id="encounter-creature-name" name="name" placeholder="Digite ao menos 3 letras" autocomplete="off" aria-controls="encounter-creature-results" aria-expanded="false" required><div id="encounter-creature-results" class="encounter-creature-search-results" role="listbox" aria-live="polite"></div></div><input name="creatureKey" type="hidden"><input name="customName" placeholder="Nome personalizado"><input name="quantity" type="number" min="1" max="50" value="1" aria-label="Quantidade"><input name="maxHp" type="number" min="0" placeholder="PV máximos"><input name="armorClass" type="number" min="0" placeholder="AC"><input name="initiative" type="number" placeholder="Iniciativa" ${encounter.isActive ? "required" : "disabled"}><label class="checkbox-line"><input name="visible" type="checkbox" checked> Visível</label><button class="primary-button" type="submit">Adicionar criatura</button></form>
          <div class="figma-creature-list">${creatures.length ? creatures.map((participant) => creatureEditor(participant, encounter)).join("") : '<div class="empty-state">Nenhuma criatura adicionada.</div>'}</div>
        </section>
        <section class="figma-player-details"><div class="section-heading-row"><div><p class="eyebrow">Estado atual das fichas</p><h3>Detalhes dos jogadores</h3></div></div><p class="muted">Os jogadores controlam as próprias fichas. O Mestre pode informar a iniciativa somente depois que o encontro começar.</p><div class="figma-player-list">${players.length ? players.map((participant) => playerDetail(participant, encounter)).join("") : '<div class="empty-state">Nenhum personagem de jogador.</div>'}</div></section>
        <aside class="figma-initiative-order"><div class="section-heading-row"><div><p class="eyebrow">Rodada ${encounter.round}</p><h3>Ordem de iniciativa</h3></div>${encounter.initiativePhase === "running" ? '<button class="secondary-button compact-button" data-turn="previous">Anterior</button>' : ""}</div><div class="figma-initiative-order-list">${encounter.participants.length ? encounter.participants.map((participant) => initiativeOrderRow(participant, encounter)).join("") : '<div class="empty-state">Nenhum participante.</div>'}</div></aside>
      </div><footer>Atualização automática ativa · revisão ${encounter.revision}.</footer></section>`;
    attachEncounterHandlers(encounter);
    startEncounterRealtime();
  } catch (error) {
    runner.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

function participantPayload(row, participant, encounter) {
  const payload = {};
  if (encounter.isActive)
    payload.initiative =
      row.querySelector('[data-field="initiative"]')?.value || null;
  if (participant.type === "creature") {
    payload.currentHp = Number(
      row.querySelector('[data-field="currentHp"]').value || 0,
    );
    payload.maxHp = Number(
      row.querySelector('[data-field="maxHp"]').value || 0,
    );
    payload.temporaryHp = Number(
      row.querySelector('[data-field="temporaryHp"]').value || 0,
    );
    payload.visible = row.querySelector('[data-field="visible"]').checked;
    payload.conditions = participant.conditions || [];
  }
  return payload;
}

function creatureArmorClass(payload) {
  const first = Array.isArray(payload?.ac) ? payload.ac[0] : payload?.ac;
  if (typeof first === "number") return first;
  if (first && typeof first === "object")
    return Number(first.ac ?? first.special ?? 0) || "";
  return "";
}

function abilityModifier(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  const modifier = Math.floor((numeric - 10) / 2);
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}

function extractAbilityDc(payload) {
  const values = [];
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(dc|saveDc)$/i.test(key)) {
        const candidate =
          typeof item === "object" ? Number(item?.dc) : Number(item);
        if (Number.isFinite(candidate) && candidate > 0 && candidate < 100)
          values.push(candidate);
      }
      visit(item, depth + 1);
    }
  };
  visit(payload);
  return values.length ? Math.max(...values) : null;
}

function creatureImage(payload) {
  const candidates = [
    payload?.tokenUrl,
    payload?.image,
    payload?.img,
    payload?.token,
  ];
  return (
    candidates.find((value) => /^https?:\/\//i.test(String(value || ""))) ||
    null
  );
}

function creatureStats(payload) {
  if (!payload || typeof payload !== "object") return {};
  const abilities = Object.fromEntries(
    ["str", "dex", "con", "int", "wis", "cha"]
      .filter((key) => Number.isFinite(Number(payload[key])))
      .map((key) => [key.toUpperCase(), Number(payload[key])]),
  );
  const modifiers = Object.fromEntries(
    Object.entries(abilities).map(([key, value]) => [
      key,
      abilityModifier(value),
    ]),
  );
  const challengeRating =
    typeof payload.cr === "object" ? payload.cr?.cr : payload.cr;
  const legendaryActions =
    payload.legendaryActions ??
    (Array.isArray(payload.legendary) && payload.legendary.length
      ? true
      : null);
  const stats = {
    passivePerception: payload.passive ?? null,
    speed: payload.speed ?? null,
    challengeRating: challengeRating ?? null,
    abilityDc: extractAbilityDc(payload),
    legendaryActions,
    savingThrows: payload.save ?? null,
    abilityModifiers: Object.keys(modifiers).length ? modifiers : null,
    abilityScores: Object.keys(abilities).length ? abilities : null,
    skills: payload.skill ?? null,
    image: creatureImage(payload),
  };
  return Object.fromEntries(
    Object.entries(stats).filter(([, value]) => value != null && value !== ""),
  );
}

function selectedCreaturePayload(name) {
  const normalized = String(name || "")
    .trim()
    .toLocaleLowerCase();
  return (
    creatureSuggestions.find(
      (item) => item.name.toLocaleLowerCase() === normalized,
    )?.payload || null
  );
}

function selectedCreatureRecord(name) {
  const normalized = String(name || "")
    .trim()
    .toLocaleLowerCase();
  return (
    creatureSuggestions.find(
      (item) => item.name.toLocaleLowerCase() === normalized,
    ) || null
  );
}

function attachCreatureLookup() {
  const input = document.querySelector("#encounter-creature-name");
  const form = document.querySelector("#add-creature-form");
  const results = document.querySelector("#encounter-creature-results");
  if (!input || !form || !results) return;

  const closeResults = () => {
    results.innerHTML = "";
    results.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
  };

  const applyRecord = (match) => {
    if (!match) {
      form.elements.creatureKey.value = "";
      return;
    }
    input.value = match.name;
    form.elements.creatureKey.value = match.key || "";
    const hp =
      Number(match.payload?.hp?.average ?? match.payload?.hp ?? 0) || 0;
    if (!form.elements.maxHp.value && hp) form.elements.maxHp.value = hp;
    const ac = creatureArmorClass(match.payload);
    if (!form.elements.armorClass.value && ac !== "")
      form.elements.armorClass.value = ac;
  };

  const applyExactMatch = () =>
    applyRecord(selectedCreatureRecord(input.value));

  const renderResults = (items) => {
    results.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    if (!items.length) {
      results.innerHTML =
        '<div class="encounter-creature-search-empty">Nenhuma criatura encontrada.</div>';
      return;
    }
    results.innerHTML = items
      .map(
        (item, index) => `
      <button type="button" class="encounter-creature-search-result" role="option" data-creature-result="${index}">
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.source || "Fonte desconhecida")}</small></span>
        <em>${escapeHtml(item.category || item.payload?.type || "")}</em>
      </button>`,
      )
      .join("");
    results.querySelectorAll("[data-creature-result]").forEach((button) => {
      button.addEventListener("click", () => {
        const match =
          creatureSuggestions[Number(button.dataset.creatureResult)];
        applyRecord(match);
        closeResults();
        input.focus();
      });
    });
  };

  input.addEventListener("input", () => {
    applyExactMatch();
    clearTimeout(creatureSearchTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      creatureSuggestions = [];
      closeResults();
      return;
    }
    results.classList.add("open");
    results.innerHTML =
      '<div class="encounter-creature-search-empty">Pesquisando no bestiário...</div>';
    input.setAttribute("aria-expanded", "true");
    creatureSearchTimer = setTimeout(async () => {
      try {
        const payload = await requestJson(
          `/api/dm/bestiary?q=${encodeURIComponent(query)}&limit=20`,
        );
        if (input.value.trim() !== query) return;
        creatureSuggestions = payload.items || [];
        renderResults(creatureSuggestions);
        applyExactMatch();
      } catch (error) {
        creatureSuggestions = [];
        results.classList.add("open");
        results.innerHTML = `<div class="encounter-creature-search-empty error">${escapeHtml(error.message || "Falha ao pesquisar no bestiário.")}</div>`;
      }
    }, 200);
  });

  input.addEventListener("change", applyExactMatch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeResults();
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!results.matches(":hover")) closeResults();
    }, 120);
  });
}

function attachEncounterHandlers(encounter) {
  attachCreatureLookup();
  document
    .querySelector("[data-close-encounter]")
    ?.addEventListener("click", () => {
      activeEncounterId = "";
      activeEncounterRevision = -1;
      stopEncounterRealtime();
      document.body.classList.remove("encounter-focus-mode");
      load(false);
    });
  document
    .querySelector("#encounter-settings-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creatureHealthDisplay: data.get("creatureHealthDisplay"),
            showOrdinals: data.get("showOrdinals") === "on",
            sortMode: data.get("sortMode"),
            locked: data.get("locked") === "on",
            visibleColumns: data.getAll("visibleColumns"),
          }),
        });
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector("#add-creature-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const record = selectedCreatureRecord(data.get("name"));
      if (!record || !data.get("creatureKey")) {
        alert("Selecione uma criatura retornada pela pesquisa do bestiário.");
        return;
      }
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/creatures`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: record.name,
            customName: data.get("customName"),
            creatureKey: record.key,
            quantity: Number(data.get("quantity")),
            maxHp: Number(data.get("maxHp") || 0),
            armorClass: data.get("armorClass"),
            initiative: encounter.isActive ? data.get("initiative") : null,
            visible: data.get("visible") === "on",
            stats: creatureStats(record.payload),
          }),
        });
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector('[data-turn="previous"]')
    ?.addEventListener("click", async () => {
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/previous`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector("[data-toggle-active]")
    ?.addEventListener("click", async () => {
      if (
        !encounter.isActive &&
        !confirm(
          "Iniciar o encontro e abrir o lançamento de iniciativas? Os valores de iniciativa atuais serão apagados.",
        )
      )
        return;
      await requestJson(`/api/dm/encounters/${encounter.id}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !encounter.isActive }),
      });
      await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
      await openEncounter(encounter.id);
    });
  document
    .querySelector("[data-reset-encounter]")
    ?.addEventListener("click", async () => {
      if (!confirm("Reiniciar o encontro e coletar as iniciativas novamente?")) return;
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector("[data-rename-encounter]")
    ?.addEventListener("click", async () => {
      const name = prompt("Nome do encontro", encounter.name)?.trim();
      if (!name || name === encounter.name) return;
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector("[data-delete-encounter]")
    ?.addEventListener("click", async () => {
      if (!confirm(`Excluir ${encounter.name}? Esta ação não pode ser desfeita.`)) return;
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        activeEncounterId = "";
        activeEncounterRevision = -1;
        stopEncounterRealtime();
        document.body.classList.remove("encounter-focus-mode");
        await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
      } catch (error) {
        alert(error.message);
      }
    });
  document.querySelectorAll("[data-participant-key]").forEach((row) => {
    const participant = encounter.participants.find(
      (item) => item.key === row.dataset.participantKey,
    );
    if (!participant) return;
    row
      .querySelector("[data-end-creature-turn]")
      ?.addEventListener("click", async () => {
        try {
          await requestJson(`/api/dm/encounters/${encounter.id}/end-turn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          await openEncounter(encounter.id);
        } catch (error) {
          alert(error.message);
        }
      });
    row
      .querySelector("[data-add-condition]")
      ?.addEventListener("click", async () => {
        const name = row.querySelector("[data-condition-name]").value.trim();
        if (!name) return;
        const turns = row.querySelector("[data-condition-turns]").value;
        const color =
          row.querySelector("[data-condition-color]").value || "#8F718F";
        const conditions = [
          ...(participant.conditions || []),
          { name, turns: turns ? Number(turns) : null, color },
        ];
        try {
          await requestJson(
            `/api/dm/encounters/${encounter.id}/participants/${encodeURIComponent(participant.key)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conditions }),
            },
          );
          await openEncounter(encounter.id);
        } catch (error) {
          alert(error.message);
        }
      });
    row.querySelectorAll("[data-condition-action]").forEach((button) =>
      button.addEventListener("click", async () => {
        const index = Number(button.dataset.conditionIndex);
        const conditions = (participant.conditions || []).map((condition) => ({
          ...condition,
        }));
        if (!conditions[index]) return;
        if (button.dataset.conditionAction === "remove")
          conditions.splice(index, 1);
        if (button.dataset.conditionAction === "increase" && conditions[index])
          conditions[index].turns = Math.max(
            1,
            Number(conditions[index].turns || 0) + 1,
          );
        if (
          button.dataset.conditionAction === "decrease" &&
          conditions[index]
        ) {
          const next = Number(conditions[index].turns || 1) - 1;
          if (next <= 0) conditions.splice(index, 1);
          else conditions[index].turns = next;
        }
        try {
          await requestJson(
            `/api/dm/encounters/${encounter.id}/participants/${encodeURIComponent(participant.key)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conditions }),
            },
          );
          await openEncounter(encounter.id);
        } catch (error) {
          alert(error.message);
        }
      }),
    );
    row
      .querySelector("[data-save-participant]")
      ?.addEventListener("click", async () => {
        try {
          await requestJson(
            `/api/dm/encounters/${encounter.id}/participants/${encodeURIComponent(participant.key)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                participantPayload(row, participant, encounter),
              ),
            },
          );
          await openEncounter(encounter.id);
        } catch (error) {
          alert(error.message);
        }
      });
    row
      .querySelector("[data-duplicate-participant]")
      ?.addEventListener("click", async () => {
        const state = participant.state || {};
        try {
          await requestJson(`/api/dm/encounters/${encounter.id}/creatures`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: state.name || state.customName || "Criatura",
              customName: state.customName || "",
              quantity: 1,
              currentHp: state.currentHp,
              maxHp: state.maxHp,
              temporaryHp: state.temporaryHp,
              armorClass: state.armorClass,
              initiative: encounter.isActive ? participant.initiative : null,
              visible: participant.visible,
              creatureKey: state.creatureKey || "",
              stats: state.stats || {},
              conditions: participant.conditions || [],
            }),
          });
          await openEncounter(encounter.id);
        } catch (error) {
          alert(error.message);
        }
      });
    row
      .querySelector("[data-remove-participant]")
      ?.addEventListener("click", async () => {
        if (!confirm("Remover esta criatura do encontro?")) return;
        await requestJson(
          `/api/dm/encounters/${encounter.id}/participants/${encodeURIComponent(participant.key)}/remove`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        );
        await openEncounter(encounter.id);
      });
  });
  if (encounter.settings.locked) {
    document
      .querySelectorAll(".encounter-editor-control")
      .forEach((control) => {
        control.disabled = true;
      });
    document
      .querySelector(".initiative-tracker")
      ?.classList.add("tracker-locked");
  }
}

async function stopEncounterRealtime() {
  if (!encounterSubscription) return;
  const current = encounterSubscription;
  encounterSubscription = null;
  await current.unsubscribe().catch(() => {});
}

async function startEncounterRealtime() {
  await stopEncounterRealtime();
  if (!activeEncounterId || activeTab !== "encounters") return;
  const encounterId = activeEncounterId;
  const refresh = () => openEncounter(encounterId, false);
  try {
    encounterSubscription = await subscribeToDatabaseChanges({
      name: `dm-encounter-${encounterId}`,
      bindings: [
        { table: "encounters", filter: `id=eq.${encounterId}` },
        { table: "encounter_participants", filter: `encounter_id=eq.${encounterId}` },
      ],
      onChange: refresh,
      fallback: refresh,
      fallbackIntervalMs: 1000,
    });
  } catch {
    const timer = window.setInterval(refresh, 1000);
    encounterSubscription = { unsubscribe: async () => window.clearInterval(timer) };
  }
}

async function load(preserveRunner = true, { forceRefresh = false } = {}) {
  try {
    const payload = await cachedRequestJson(`/api/dm/campaigns/${campaignId}/workspace`, {
      freshForMs: 3000,
      staleForMs: 24 * 60 * 60 * 1000,
      forceRefresh,
      tags: [`dm-campaign:${campaignId}`],
    });
    campaign = payload.campaign;
    threads = payload.threads || [];
    requests = payload.requests || [];
    const runnerId = preserveRunner ? activeEncounterId : "";
    renderCampaign();
    if (runnerId && activeTab === "encounters") await openEncounter(runnerId);
  } catch (error) {
    root.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

async function refreshCampaignMembership() {
  if (activeTab !== "encounters" || !activeEncounterId) {
    await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
    await load(false, { forceRefresh: true });
    return;
  }
  try {
    const nextCampaign = await requestJson(`/api/dm/campaigns/${campaignId}`);
    const previousIds = (campaign?.characters || [])
      .map((item) => item.id)
      .sort()
      .join("|");
    const nextIds = (nextCampaign.characters || [])
      .map((item) => item.id)
      .sort()
      .join("|");
    campaign = nextCampaign;
    if (previousIds !== nextIds) {
      await requestJson(
        `/api/dm/encounters/${activeEncounterId}/sync-players`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      renderCampaign();
      setTab("encounters");
      await openEncounter(activeEncounterId);
    }
  } catch {
    /* preserve the last valid state while realtime reconnects */
  }
}

const refreshCampaignWorkspace = debounceRefresh(async () => {
  await invalidateApiCache({ tags: [`dm-campaign:${campaignId}`, "dm-home"] });
  await refreshCampaignMembership();
  await load(true, { forceRefresh: true });
}, 180);

async function startCampaignRealtime() {
  try {
    campaignSubscription = await subscribeToDatabaseChanges({
      name: `dm-campaign-${campaignId}`,
      bindings: [
        { table: "campaigns", filter: `id=eq.${campaignId}` },
        { table: "character_campaigns", filter: `campaign_id=eq.${campaignId}` },
        { table: "campaign_message_threads", filter: `campaign_id=eq.${campaignId}` },
        { table: "item_authorization_requests", filter: `campaign_id=eq.${campaignId}` },
        { table: "campaign_notes", filter: `campaign_id=eq.${campaignId}` },
        { table: "encounters", filter: `campaign_id=eq.${campaignId}` },
      ],
      onChange: refreshCampaignWorkspace,
      fallback: refreshCampaignWorkspace,
      fallbackIntervalMs: 30_000,
    });
  } catch {
    // Cached workspace and explicit actions remain usable without realtime.
  }
}

async function boot() {
  if (!await initializeGmShell("campaigns")) return;
  if (!campaignId) {
    root.innerHTML = '<div class="alert error">O identificador da campanha está ausente.</div>';
    return;
  }
  await load();
  await startCampaignRealtime();
}
window.addEventListener("beforeunload", () => {
  void stopEncounterRealtime();
  void campaignSubscription?.unsubscribe();
});
boot();
