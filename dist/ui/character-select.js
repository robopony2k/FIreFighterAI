import { CHARACTERS, getCharacterInitials } from "../core/characters.js";
const formatPercent = (value) => {
    const rounded = Math.round(value * 100);
    if (rounded === 0) {
        return "0%";
    }
    return `${rounded > 0 ? "+" : ""}${rounded}%`;
};
const formatMultiplier = (value) => formatPercent(value - 1);
const buildStats = (character) => [
    `Budget ${formatMultiplier(character.modifiers.budgetMultiplier)}`,
    `Unit Speed ${formatMultiplier(character.modifiers.unitSpeedMultiplier)}`,
    `Suppression ${formatMultiplier(character.modifiers.unitPowerMultiplier)}`,
    `Containment ${formatPercent(character.modifiers.containmentBonus)}`,
    `Firebreak Cost ${formatMultiplier(character.modifiers.firebreakCostMultiplier)}`,
    `Approval Retention ${formatMultiplier(character.modifiers.approvalRetentionMultiplier)}`
];
const FIRST_NAMES = [
    "Alex",
    "Riley",
    "Jordan",
    "Casey",
    "Morgan",
    "Avery",
    "Quinn",
    "Parker",
    "Rowan",
    "Hayden",
    "Logan",
    "Emery",
    "Reese",
    "Sawyer",
    "Cameron",
    "Ellis"
];
const LAST_NAMES = [
    "Sparks",
    "Calloway",
    "Hale",
    "Stone",
    "Vega",
    "Maddox",
    "Delaney",
    "Hart",
    "Navarro",
    "Rourke",
    "Ashford",
    "Bishop",
    "Sterling",
    "Graves",
    "Beckett",
    "Sawyer"
];
const NICKNAMES = {
    chief: ["Anchor", "Redline", "Sentinel", "Frontier", "Steel"],
    strategist: ["Grid", "Compass", "Calc", "Sightline", "Vector"],
    logistics: ["Quarter", "Depot", "Supply", "Railhead", "Stack"],
    trainer: ["Anvil", "Forge", "Hammer", "Drill", "Standard"],
    "air-ops": ["Skylark", "Jetstream", "Overwatch", "Altitude", "Falcon"],
    community: ["Cedar", "Harbor", "Beacon", "Hearth", "Pioneer"]
};
const pickRandom = (options) => options[Math.floor(Math.random() * options.length)];
const buildCallsign = (characterId) => {
    const first = pickRandom(FIRST_NAMES);
    const last = pickRandom(LAST_NAMES);
    const nick = pickRandom(NICKNAMES[characterId]);
    return `${first} "${nick}" ${last}`;
};
export function initCharacterSelect(ui, state, onConfirm) {
    let selectedId = state.campaign.characterId;
    let pendingSeed = null;
    const cards = new Map();
    ui.characterGrid.innerHTML = "";
    CHARACTERS.forEach((character) => {
        const initials = getCharacterInitials(character.name);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "character-card";
        card.dataset.id = character.id;
        card.innerHTML = `
      <div class="character-card-top">
        <div class="character-portrait has-photo" style="--chief-accent: ${character.accent};">
          <img src="${character.portrait}" alt="${character.name} portrait" loading="lazy" />
          <span>${initials}</span>
        </div>
        <div>
          <div class="character-name">${character.name}</div>
          <div class="character-title">${character.title}</div>
        </div>
      </div>
      <p class="character-desc">${character.description}</p>
      <div class="character-stats">
        ${buildStats(character)
            .map((stat) => `<div>${stat}</div>`)
            .join("")}
      </div>
    `;
        card.addEventListener("click", () => {
            selectedId = character.id;
            updateSelection();
        });
        ui.characterGrid.appendChild(card);
        cards.set(character.id, card);
    });
    const updatePreview = () => {
        const chosen = CHARACTERS.find((entry) => entry.id === selectedId) ?? CHARACTERS[0];
        ui.characterSummary.textContent = `${chosen.name} - ${chosen.title}. ${chosen.description}`;
        ui.characterPreviewInitials.textContent = getCharacterInitials(chosen.name);
        ui.characterPreviewPortrait.style.setProperty("--chief-accent", chosen.accent);
        ui.characterPreviewImage.src = chosen.portrait;
        ui.characterPreviewImage.alt = `${chosen.name} portrait`;
        ui.characterPreviewPortrait.classList.add("has-photo");
    };
    const updateSelection = () => {
        cards.forEach((card, id) => {
            const active = id === selectedId;
            card.classList.toggle("selected", active);
            card.setAttribute("aria-pressed", active ? "true" : "false");
        });
        updatePreview();
        updateConfirmState();
    };
    const updateConfirmState = () => {
        ui.characterConfirm.disabled = ui.characterNameInput.value.trim().length === 0;
    };
    const applyRandomName = () => {
        const name = buildCallsign(selectedId);
        ui.characterNameInput.value = name;
        state.campaign.callsign = name;
        updateConfirmState();
    };
    ui.characterNameInput.value = state.campaign.callsign;
    ui.characterNameInput.addEventListener("input", () => {
        state.campaign.callsign = ui.characterNameInput.value;
        updateConfirmState();
    });
    ui.characterNameRandom.addEventListener("click", () => {
        applyRandomName();
    });
    updateSelection();
    updateConfirmState();
    const flushConfirmation = (seed) => {
        window.requestAnimationFrame(() => {
            onConfirm(seed);
        });
    };
    ui.characterConfirm.addEventListener("click", () => {
        state.campaign.characterId = selectedId;
        const trimmed = ui.characterNameInput.value.trim();
        state.campaign.callsign = trimmed || buildCallsign(selectedId);
        ui.characterScreen.classList.add("hidden");
        const seedToUse = pendingSeed;
        pendingSeed = null;
        state.paused = false;
        flushConfirmation(seedToUse);
    });
    const open = (seed) => {
        pendingSeed = seed;
        state.paused = true;
        ui.characterNameInput.value = state.campaign.callsign;
        if (ui.characterNameInput.value.trim().length === 0) {
            applyRandomName();
        }
        updateConfirmState();
        updatePreview();
        ui.characterScreen.classList.remove("hidden");
    };
    return { open };
}
