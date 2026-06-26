import {
  currentId,
  escapeHtml,
  formatDate,
  initializeGmShell,
  markdownToHtml,
  requestJson,
} from "./gm-common.js";
const campaignId = currentId();
const root = document.querySelector("#campaign-manager-root");
const encounterDialog = document.querySelector("#encounter-create-dialog");
const encounterForm = document.querySelector("#encounter-create-form");
let campaign = null;
let threads = [];
let requests = [];
let activeTab = "overview";
let activeEncounterId = "";
let encounterPoll = null;
let activeEncounterRevision = -1;
let campaignRefresh = null;
let creatureSuggestions = [];
let creatureSearchTimer = null;

const encounterStatLabels = {
  armorClass: "AC",
  passivePerception: "Passive Perception",
  speed: "Speed",
  challengeRating: "CR",
  abilityDc: "Ability DC",
  legendaryActions: "Legendary Actions",
  savingThrows: "Saving Throws",
  abilityModifiers: "Ability Modifiers",
  abilityScores: "Ability Scores",
  skills: "Skills",
  image: "Image / Token",
};
const encounterStatKeys = Object.keys(encounterStatLabels);

function formatEncounterStat(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatEncounterStat).join(", ");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${formatEncounterStat(item)}`)
      .join(" · ");
  return String(value);
}

function encounterStatsMarkup(state, settings) {
  const stats =
    state.stats && typeof state.stats === "object" ? state.stats : {};
  const values = { ...stats, armorClass: state.armorClass };
  const rows = encounterStatKeys
    .filter((key) => values[key] != null && values[key] !== "")
    .map((key) => {
      const playerVisible = (settings.visibleColumns || []).includes(key);
      if (key === "image" && /^https?:\/\//i.test(String(values[key]))) {
        return `<span class="initiative-stat"><small>${encounterStatLabels[key]}${playerVisible ? " · visible" : ""}</small><img src="${escapeHtml(values[key])}" alt=""></span>`;
      }
      return `<span class="initiative-stat"><small>${encounterStatLabels[key]}${playerVisible ? " · visible" : ""}</small><strong>${escapeHtml(formatEncounterStat(values[key]))}</strong></span>`;
    });
  return rows.length
    ? `<details class="initiative-stats"><summary>Creature statistics</summary><div>${rows.join("")}</div></details>`
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
  if (tab === "encounters" && activeEncounterId) startEncounterPolling();
  else stopEncounterPolling();
}

function campaignHeader() {
  const banner = campaign.bannerPath
    ? `style="--campaign-banner:url('${escapeHtml(campaign.bannerPath)}')"`
    : "";
  return `<header class="campaign-manager-header gm-campaign-hero" ${banner}><div><p class="eyebrow">Campaign Manager</p><h1>${escapeHtml(campaign.name)}</h1><p>${escapeHtml(campaign.description || "No campaign description.")}</p><div class="gm-hero-meta"><span>Starting level ${campaign.startingLevel}</span><span>${campaign.characters.length} characters</span><span>Code <code>${escapeHtml(campaign.joinCode)}</code></span></div></div></header>`;
}

function characterCard(character) {
  const slots = character.spellSlots?.length
    ? character.spellSlots
        .map(
          (slot) =>
            `<span title="Level ${slot.level}">L${slot.level}: ${slot.remaining}/${slot.total}</span>`,
        )
        .join("")
    : "<span>No spell slots</span>";
  const resources = character.featureResources?.length
    ? character.featureResources
        .map(
          (resource) =>
            `<span>${escapeHtml(resource.name)}: ${resource.remaining}/${resource.maximum}</span>`,
        )
        .join("")
    : "<span>No tracked charges</span>";
  const authorization = character.levelUpAuthorization || {};
  const atMaximum = Number(character.level) >= 20;
  const authorizationButton = atMaximum
    ? '<button class="secondary-button compact-button" type="button" disabled>Level 20 Reached</button>'
    : `<button class="${authorization.authorized ? "danger-button" : "primary-button"} compact-button" type="button" data-level-up-authorization data-character-id="${escapeHtml(character.id)}" data-authorized="${authorization.authorized ? "true" : "false"}">${authorization.authorized ? `Revoke Level ${authorization.targetLevel}` : `Authorize Level ${authorization.targetLevel}`}</button>`;
  const authorizationStatus = authorization.authorized
    ? `<span class="status-badge ok">Level ${authorization.targetLevel} authorized</span>`
    : `<span class="status-badge pending">Level ${authorization.targetLevel} locked</span>`;
  return `<article class="gm-character-monitor"><header>${character.portraitPath ? `<img src="${escapeHtml(character.portraitPath)}" alt="">` : '<span class="portrait-placeholder">?</span>'}<div><p class="eyebrow">${escapeHtml(character.playerName)}</p><h3>${escapeHtml(character.name)}</h3><small>Level ${character.level} ${escapeHtml(character.className || "")}${character.subclass ? ` · ${escapeHtml(character.subclass)}` : ""}</small></div></header><div class="gm-character-vitals"><span><strong>${character.currentHp}/${character.maxHp}</strong> HP</span><span><strong>${character.temporaryHp}</strong> Temp</span><span><strong>${character.armorClass ?? "—"}</strong> AC</span><span><strong>${character.spellSaveDc ?? "—"}</strong> DC</span><span><strong>${character.passivePerception ?? "—"}</strong> Passive Perception</span></div><details><summary>Spell slots</summary><div class="resource-chip-row">${slots}</div></details><details><summary>Charged abilities</summary><div class="resource-chip-row">${resources}</div></details><div class="gm-level-up-authorization"><div><strong>Level Up Access</strong>${authorizationStatus}</div><div class="inline-actions">${authorizationButton}<button class="danger-button compact-button" type="button" data-remove-campaign-character data-character-id="${escapeHtml(character.id)}" data-character-name="${escapeHtml(character.name)}">Remover da campanha</button></div></div><small>Player-managed sheet · updated ${formatDate(character.updatedAt)}</small></article>`;
}

function renderOverview() {
  return `<section data-campaign-panel="overview" class="gm-campaign-panel"><div class="gm-stat-grid"><div class="gm-stat-card static"><span>Players</span><strong>${new Set(campaign.characters.map((item) => item.playerEmail)).size}</strong></div><div class="gm-stat-card static"><span>Characters</span><strong>${campaign.characters.length}</strong></div><div class="gm-stat-card static"><span>Encounters</span><strong>${campaign.encounters.length}</strong></div><div class="gm-stat-card static"><span>Rules Overrides</span><strong>${Object.keys(campaign.homebrewRules || {}).length}</strong></div></div><div class="gm-dashboard-columns"><section class="panel"><h3>Invitation Code</h3><p class="lead"><code class="campaign-code-display">${escapeHtml(campaign.joinCode)}</code></p><p>Players enter this 13-character code from their sidebar and select a character.</p></section><section class="panel"><h3>Homebrew Rules</h3><pre>${escapeHtml(JSON.stringify(campaign.homebrewRules || {}, null, 2))}</pre></section></div></section>`;
}

function renderPlayers() {
  return `<section data-campaign-panel="players" class="gm-campaign-panel" hidden><div class="section-heading-row"><div><p class="eyebrow">Synchronous sheet view</p><h3>Players and Characters</h3></div><span class="status-badge ok">Refreshes every 45 seconds</span></div><p class="muted">Players manage their own HP, spell slots, equipment, and feature charges. This panel is read-only.</p><div class="gm-character-monitor-grid">${campaign.characters.length ? campaign.characters.map(characterCard).join("") : '<div class="empty-state">No participating characters.</div>'}</div></section>`;
}

function renderEncounterList() {
  return `<div class="section-heading-row"><div><p class="eyebrow">Creature Management</p><h2>Encounters</h2></div><button id="create-encounter-button" class="primary-button" type="button">Create Encounter</button></div><div class="gm-encounter-list">${campaign.encounters.length ? campaign.encounters.map((encounter) => `<button class="gm-encounter-row ${encounter.isActive ? "active" : ""}" type="button" data-open-encounter="${encounter.id}"><span><strong>${escapeHtml(encounter.name)}</strong><small>Round ${encounter.round} · revision ${encounter.revision}</small></span><em>${encounter.isActive ? "ACTIVE" : formatDate(encounter.updatedAt)}</em></button>`).join("") : '<div class="empty-state">No encounters created.</div>'}</div><div id="encounter-runner"></div>`;
}

function renderMessages() {
  return `<section data-campaign-panel="messages" class="gm-campaign-panel" hidden><div class="section-heading-row"><div><p class="eyebrow">Direct Conversations</p><h3>Messages</h3></div></div><div class="gm-message-layout"><aside id="gm-thread-list" class="gm-thread-list">${threads.length ? threads.map((thread) => `<button type="button" data-thread-id="${thread.id}"><span><strong>${escapeHtml(thread.playerName)}</strong><small>${escapeHtml(thread.characterName || "No character selected")}</small></span>${thread.unreadCount ? `<em>${thread.unreadCount}</em>` : ""}<p>${escapeHtml(thread.lastBody || "")}</p></button>`).join("") : '<div class="empty-state">No direct messages.</div>'}</aside><section id="gm-thread-view" class="panel"><div class="empty-state">Select a conversation.</div></section></div></section>`;
}

function renderNotes() {
  return `<section data-campaign-panel="notes" class="gm-campaign-panel" hidden><div class="section-heading-row"><div><p class="eyebrow">Shared Markdown</p><h3>Campaign Notes</h3></div><span>Revision <strong id="notes-revision-label">${campaign.notes.revision}</strong></span></div><div class="gm-notes-layout"><form id="campaign-notes-form"><textarea name="markdown" rows="24">${escapeHtml(campaign.notes.markdown || "")}</textarea><input name="revision" type="hidden" value="${campaign.notes.revision}"><button class="primary-button" type="submit">Save Notes</button><div id="notes-feedback"></div></form><article id="campaign-notes-preview" class="panel lore-content">${markdownToHtml(campaign.notes.markdown || "") || '<p class="muted">No campaign notes yet.</p>'}</article></div></section>`;
}

function renderLore() {
  return `<section data-campaign-panel="lore" class="gm-campaign-panel" hidden><div class="panel"><p class="eyebrow">Campaign Lore</p><h3>Publish lore for ${escapeHtml(campaign.name)}</h3><p>Create or upload a Markdown document, select <strong>Campaign Lore</strong>, choose this campaign, and optionally insert its link into Campaign Notes.</p><a class="primary-button button-link" href="./dm-lore.html">Open Lore Editor</a></div></section>`;
}

function renderRequests() {
  return `<section data-campaign-panel="requests" class="gm-campaign-panel" hidden><div class="section-heading-row"><div><p class="eyebrow">Hidden Player Workflow</p><h3>Item Requests</h3></div></div><div id="campaign-request-list">${requests.length ? requests.map((request) => `<article class="dm-request-card"><div><p class="eyebrow">${escapeHtml(request.playerName)}</p><h3>${escapeHtml(request.item.name)}</h3><p>${escapeHtml(request.characterName)} · quantity ${Number(request.item.quantity || 1)}</p><small>${escapeHtml(request.item.description || "")}</small></div><div class="inline-actions"><button class="secondary-button" data-request-review="reject" data-id="${request.id}">Reject</button><button class="primary-button" data-request-review="approve" data-id="${request.id}">Approve</button></div></article>`).join("") : '<div class="empty-state">No pending item requests for this campaign.</div>'}</div></section>`;
}

function renderSettings() {
  return `<section data-campaign-panel="settings" class="gm-campaign-panel" hidden><div class="panel"><p class="eyebrow">Campaign Configuration</p><h3>Settings</h3><dl class="gm-definition-list"><div><dt>Name</dt><dd>${escapeHtml(campaign.name)}</dd></div><div><dt>Starting Level</dt><dd>${campaign.startingLevel}</dd></div><div><dt>Join Code</dt><dd><code>${escapeHtml(campaign.joinCode)}</code></dd></div><div><dt>Created</dt><dd>${formatDate(campaign.createdAt)}</dd></div><div><dt>Updated</dt><dd>${formatDate(campaign.updatedAt)}</dd></div></dl><p class="muted">Campaign editing and deletion are not part of the current confirmed scope.</p></div></section>`;
}

function renderCampaign() {
  root.innerHTML = `${campaignHeader()}<nav class="gm-campaign-tabs" aria-label="Campaign sections"><button data-campaign-tab="overview">Overview</button><button data-campaign-tab="players">Players</button><button data-campaign-tab="encounters">Encounters</button><button data-campaign-tab="messages">Messages</button><button data-campaign-tab="notes">Campaign Notes</button><button data-campaign-tab="lore">Lore</button><button data-campaign-tab="requests">Item Requests</button><button data-campaign-tab="settings">Settings</button></nav><div class="gm-campaign-panels">${renderOverview()}${renderPlayers()}<section data-campaign-panel="encounters" class="gm-campaign-panel" hidden>${renderEncounterList()}</section>${renderMessages()}${renderNotes()}${renderLore()}${renderRequests()}${renderSettings()}</div>`;
  document
    .querySelectorAll("[data-campaign-tab]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setTab(button.dataset.campaignTab),
      ),
    );
  attachCampaignHandlers();
  setTab(activeTab);
}

function attachCampaignHandlers() {
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
        await load(false);
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
        await load(false);
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
      '<div class="alert success">Campaign notes saved.</div>';
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
    await load(false);
  } catch (error) {
    alert(error.message);
  }
}

async function openThread(id) {
  const view = document.querySelector("#gm-thread-view");
  view.innerHTML = '<div class="empty-state">Loading conversation...</div>';
  try {
    const thread = await requestJson(`/api/dm/messages/${id}`);
    view.innerHTML = `<header><p class="eyebrow">${escapeHtml(thread.campaignName)}</p><h2>${escapeHtml(thread.playerName)}</h2><small>${escapeHtml(thread.characterName || "No character selected")}</small></header><div class="gm-message-transcript">${thread.messages.map((message) => `<article class="gm-message ${message.fromGm ? "from-gm" : "from-player"}"><strong>${escapeHtml(message.senderName)}</strong><p>${escapeHtml(message.body)}</p><time>${formatDate(message.createdAt)}</time></article>`).join("")}</div><form id="gm-reply-form" data-thread-id="${thread.id}"><textarea name="body" rows="4" maxlength="4000" placeholder="Write a reply" required></textarea><button class="primary-button" type="submit">Send Reply</button></form>`;
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
    await load(false);
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
            `<span class="condition-chip" style="--condition-color:${escapeHtml(condition.color || "#8F718F")}"><span>${escapeHtml(condition.name)}${condition.turns == null ? "" : ` (${condition.turns})`}</span>${condition.turns == null ? "" : `<button type="button" title="Decrease duration" data-condition-action="decrease" data-condition-index="${index}">−</button><button type="button" title="Increase duration" data-condition-action="increase" data-condition-index="${index}">+</button>`}<button type="button" title="Remove condition" data-condition-action="remove" data-condition-index="${index}">×</button></span>`,
        )
        .join("")
    : '<span class="muted">No conditions</span>';
}

function encounterSettingsFields(settings) {
  const columns = encounterStatKeys
    .map(
      (key) =>
        `<label class="checkbox-line"><input name="visibleColumns" type="checkbox" value="${key}" ${(settings.visibleColumns || []).includes(key) ? "checked" : ""}> ${encounterStatLabels[key]}</label>`,
    )
    .join("");
  return `<label>Sort order<select name="sortMode"><option value="initiative" ${settings.sortMode === "initiative" ? "selected" : ""}>Initiative</option><option value="alphabetical" ${settings.sortMode === "alphabetical" ? "selected" : ""}>Alphabetical</option></select></label><label>Player creature health<select name="creatureHealthDisplay"><option value="category" ${settings.creatureHealthDisplay === "category" ? "selected" : ""}>Health category</option><option value="exact" ${settings.creatureHealthDisplay === "exact" ? "selected" : ""}>Exact HP</option></select></label><label class="checkbox-line"><input name="showOrdinals" type="checkbox" ${settings.showOrdinals ? "checked" : ""}> Show duplicate ordinals</label><label class="checkbox-line"><input name="locked" type="checkbox" ${settings.locked ? "checked" : ""}> Lock tracker editing</label><details class="encounter-column-settings"><summary>Player-visible creature statistics</summary><div>${columns}</div></details><button class="secondary-button compact-button" type="submit">Save Tracker Settings</button>`;
}

function playerEncounterResources(state) {
  const slots = state.spellSlots?.length
    ? state.spellSlots
        .map(
          (slot) =>
            `<span title="Spell level ${slot.level}">L${slot.level} ${slot.remaining}/${slot.total}</span>`,
        )
        .join("")
    : "<span>No spell slots</span>";
  const features = state.featureResources?.length
    ? state.featureResources
        .map(
          (resource) =>
            `<span>${escapeHtml(resource.name)} ${resource.remaining}/${resource.maximum}</span>`,
        )
        .join("")
    : "<span>No charged abilities</span>";
  return `<details><summary>Player-managed resources</summary><div class="initiative-resource-groups"><div><small>Spell slots</small>${slots}</div><div><small>Abilities</small>${features}</div><div><small>Death saves</small><span>${Number(state.deathSaveSuccesses || 0)} successes</span><span>${Number(state.deathSaveFailures || 0)} failures</span></div></div></details>`;
}

function encounterName(participant) {
  const state = participant?.state || {};
  const base = state.customName || state.name || participant?.key || "Unknown";
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

function initiativeEntry(participant, encounter, label = "Initiative") {
  const disabled = !encounter.isActive || encounter.settings.locked;
  return `<label class="initiative-entry-field">${label}<input class="encounter-editor-control" data-field="initiative" type="number" value="${participant.initiative ?? ""}" ${disabled ? "disabled" : ""} aria-label="${label}"></label>`;
}

function creatureEditor(participant, encounter) {
  const state = participant.state || {};
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="encounter-creature-card ${active ? "active-turn" : ""}" data-participant-key="${escapeHtml(participant.key)}">
    <header><div><p class="eyebrow">${active ? "Current Creature" : "Creature"}</p><h3>${escapeHtml(encounterName(participant))}</h3></div>${initiativeEntry(participant, encounter)}</header>
    <div class="initiative-hp"><label>HP<input class="encounter-editor-control" data-field="currentHp" type="number" min="0" value="${Number(state.currentHp || 0)}"></label><span>/</span><label>Max<input class="encounter-editor-control" data-field="maxHp" type="number" min="0" value="${Number(state.maxHp || 0)}"></label><label>Temp<input class="encounter-editor-control" data-field="temporaryHp" type="number" min="0" value="${Number(state.temporaryHp || 0)}"></label></div>
    ${encounterStatsMarkup(state, encounter.settings)}
    <div class="initiative-conditions"><div>${conditionRows(participant.conditions)}</div><div class="condition-add-row"><input class="encounter-editor-control" data-condition-name placeholder="Condition"><input class="encounter-editor-control" data-condition-turns type="number" min="1" placeholder="Turns"><input class="encounter-editor-control" data-condition-color type="color" value="#8F718F" title="Condition color"><button type="button" class="secondary-button compact-button encounter-editor-control" data-add-condition>Add</button></div></div>
    <label class="checkbox-line"><input class="encounter-editor-control" data-field="visible" type="checkbox" ${participant.visible ? "checked" : ""}> Visible to players</label>
    <div class="inline-actions"><button type="button" class="secondary-button compact-button encounter-editor-control" data-save-participant>Save Creature</button><button type="button" class="secondary-button compact-button encounter-editor-control" data-duplicate-participant>Duplicate</button><button type="button" class="danger-button compact-button encounter-editor-control" data-remove-participant>Remove</button>${active && encounter.initiativePhase === "running" ? '<button type="button" class="primary-button compact-button" data-end-creature-turn>End Turn</button>' : ""}</div>
  </article>`;
}

function playerDetail(participant, encounter) {
  const state = participant.state || {};
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="encounter-player-card ${active ? "active-turn" : ""}" data-participant-key="${escapeHtml(participant.key)}">
    <header>${state.portraitPath ? `<img src="${escapeHtml(state.portraitPath)}" alt="">` : '<span class="portrait-placeholder">?</span>'}<div><p class="eyebrow">${escapeHtml(state.playerName || "Player")}</p><h3>${escapeHtml(state.name || participant.key)}</h3></div>${initiativeEntry(participant, encounter)}</header>
    <div class="initiative-hp read-only"><span><strong>${state.currentHp}/${state.maxHp}</strong> HP</span><span>${state.temporaryHp || 0} Temp</span><span>${state.armorClass ?? "—"} AC</span></div>
    <div class="initiative-conditions">${playerEncounterResources(state)}</div>
    ${encounter.isActive ? '<button type="button" class="secondary-button compact-button encounter-editor-control" data-save-participant>Save Initiative</button>' : '<small class="muted">Initiative opens when the encounter starts.</small>'}
  </article>`;
}

function initiativeOrderRow(participant, encounter) {
  const active = participant.key === encounter.activeParticipantKey;
  return `<article class="figma-initiative-order-row ${active ? "active-turn" : ""}"><span class="initiative-position">${participant.initiative ?? "—"}</span><div><strong>${escapeHtml(encounterName(participant))}</strong><small>${participant.type === "creature" ? "Creature" : `Player · ${escapeHtml(participant.state?.playerName || "")}`}</small></div>${active ? "<em>TURN</em>" : ""}</article>`;
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
        ? `Initiative entry open · ${encounter.initiativeEntered}/${encounter.initiativeRequired} entered`
        : encounter.initiativePhase === "running"
          ? `Round ${encounter.round}`
          : "Start the encounter to enter initiative";
    runner.innerHTML = `<section class="initiative-tracker figma-encounter-layout">
      <header class="figma-encounter-toolbar"><div><p class="eyebrow">Initiative Tracker</p><h2>${escapeHtml(encounter.name)}</h2><span class="status-badge ${encounter.isActive ? "ok" : "pending"}">${encounter.isActive ? phaseCopy : "Inactive"}</span></div><div class="initiative-controls"><button class="secondary-button" data-close-encounter>Back to Encounters</button><button class="secondary-button" data-toggle-active>${encounter.isActive ? "End Encounter" : "Start Encounter"}</button><button class="secondary-button" data-reset-encounter>Reset</button><button class="secondary-button" data-rename-encounter>Rename</button><button class="danger-button" data-delete-encounter>Delete</button></div></header>
      <div class="figma-current-next"><div class="figma-current-initiative"><small>Current Initiative</small><strong>${current ? escapeHtml(encounterName(current)) : encounter.initiativePhase === "collecting" ? "Collecting initiatives" : "—"}</strong></div><div class="figma-next-initiative"><small>Next Initiative</small><strong>${next ? escapeHtml(encounterName(next)) : "—"}</strong></div><div class="figma-initiative-value">${current?.initiative ?? "—"}</div></div>
      <form id="encounter-settings-form" class="encounter-settings-form">${encounterSettingsFields(encounter.settings)}</form>
      <div class="figma-encounter-grid">
        <section class="figma-creature-details"><div class="section-heading-row"><div><p class="eyebrow">Bestiary</p><h3>Creature Details</h3></div></div>
          <form id="add-creature-form" class="add-creature-form figma-add-creature"><div class="encounter-creature-search"><input id="encounter-creature-name" name="name" placeholder="Type at least 3 letters" autocomplete="off" aria-controls="encounter-creature-results" aria-expanded="false" required><div id="encounter-creature-results" class="encounter-creature-search-results" role="listbox" aria-live="polite"></div></div><input name="creatureKey" type="hidden"><input name="customName" placeholder="Custom name"><input name="quantity" type="number" min="1" max="50" value="1" aria-label="Quantity"><input name="maxHp" type="number" min="0" placeholder="Max HP"><input name="armorClass" type="number" min="0" placeholder="AC"><input name="initiative" type="number" placeholder="Initiative" ${encounter.isActive ? "required" : "disabled"}><label class="checkbox-line"><input name="visible" type="checkbox" checked> Visible</label><button class="primary-button" type="submit">Add Creature</button></form>
          <div class="figma-creature-list">${creatures.length ? creatures.map((participant) => creatureEditor(participant, encounter)).join("") : '<div class="empty-state">No creatures added.</div>'}</div>
        </section>
        <section class="figma-player-details"><div class="section-heading-row"><div><p class="eyebrow">Live Character State</p><h3>Players' Details</h3></div></div><p class="muted">Players control their own sheets. The GM can enter initiative only after the encounter starts.</p><div class="figma-player-list">${players.length ? players.map((participant) => playerDetail(participant, encounter)).join("") : '<div class="empty-state">No player characters.</div>'}</div></section>
        <aside class="figma-initiative-order"><div class="section-heading-row"><div><p class="eyebrow">Round ${encounter.round}</p><h3>Initiative Order</h3></div>${encounter.initiativePhase === "running" ? '<button class="secondary-button compact-button" data-turn="previous">Previous</button>' : ""}</div><div class="figma-initiative-order-list">${encounter.participants.length ? encounter.participants.map((participant) => initiativeOrderRow(participant, encounter)).join("") : '<div class="empty-state">No participants.</div>'}</div></aside>
      </div><footer>Revision ${encounter.revision} · synchronizes every 2 seconds.</footer></section>`;
    attachEncounterHandlers(encounter);
    startEncounterPolling();
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
        '<div class="encounter-creature-search-empty">No creatures found.</div>';
      return;
    }
    results.innerHTML = items
      .map(
        (item, index) => `
      <button type="button" class="encounter-creature-search-result" role="option" data-creature-result="${index}">
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.source || "Unknown source")}</small></span>
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
      '<div class="encounter-creature-search-empty">Searching bestiary...</div>';
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
        results.innerHTML = `<div class="encounter-creature-search-empty error">${escapeHtml(error.message || "Bestiary search failed.")}</div>`;
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
      stopEncounterPolling();
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
        alert("Select a creature returned by the bestiary search.");
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
          "Start the encounter and open initiative entry? Existing initiative values will be cleared.",
        )
      )
        return;
      await requestJson(`/api/dm/encounters/${encounter.id}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !encounter.isActive }),
      });
      await load(false);
      await openEncounter(encounter.id);
    });
  document
    .querySelector("[data-reset-encounter]")
    ?.addEventListener("click", async () => {
      if (!confirm("Reset the encounter and collect initiative again?")) return;
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
      const name = prompt("Encounter name", encounter.name)?.trim();
      if (!name || name === encounter.name) return;
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await load(false);
        await openEncounter(encounter.id);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .querySelector("[data-delete-encounter]")
    ?.addEventListener("click", async () => {
      if (!confirm(`Delete ${encounter.name}? This cannot be undone.`)) return;
      try {
        await requestJson(`/api/dm/encounters/${encounter.id}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        activeEncounterId = "";
        activeEncounterRevision = -1;
        stopEncounterPolling();
        document.body.classList.remove("encounter-focus-mode");
        await load(false);
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
              name: state.name || state.customName || "Creature",
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
        if (!confirm("Remove this creature from the encounter?")) return;
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

function startEncounterPolling() {
  stopEncounterPolling();
  if (!activeEncounterId || activeTab !== "encounters") return;
  encounterPoll = setInterval(
    () => openEncounter(activeEncounterId, false),
    2000,
  );
}
function stopEncounterPolling() {
  if (encounterPoll) clearInterval(encounterPoll);
  encounterPoll = null;
}

async function load(preserveRunner = true) {
  try {
    const [campaignPayload, threadPayload, requestPayload] = await Promise.all([
      requestJson(`/api/dm/campaigns/${campaignId}`),
      requestJson(`/api/dm/campaigns/${campaignId}/messages`),
      requestJson(
        `/api/dm/item-requests?status=pending&campaignId=${encodeURIComponent(campaignId)}`,
      ),
    ]);
    campaign = campaignPayload;
    threads = threadPayload.items || [];
    requests = requestPayload.items || [];
    const runnerId = preserveRunner ? activeEncounterId : "";
    renderCampaign();
    if (runnerId && activeTab === "encounters") await openEncounter(runnerId);
  } catch (error) {
    root.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`;
  }
}

async function refreshCampaignMembership() {
  if (activeTab !== "encounters" || !activeEncounterId) {
    await load(false);
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
    /* the 2-second encounter poll keeps the last valid state visible */
  }
}

async function boot() {
  if (!await initializeGmShell("campaigns")) return;
  if (!campaignId) {
    root.innerHTML = '<div class="alert error">Campaign ID is missing.</div>';
    return;
  }
  await load();
  campaignRefresh = setInterval(refreshCampaignMembership, 45000);
}
window.addEventListener("beforeunload", () => {
  stopEncounterPolling();
  if (campaignRefresh) clearInterval(campaignRefresh);
});
boot();
