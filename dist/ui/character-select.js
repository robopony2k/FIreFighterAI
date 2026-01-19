import { CHARACTERS, getCharacterInitials } from "../core/characters.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "./run-config.js";
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
    const coerceSeed = (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return DEFAULT_RUN_SEED;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
            return DEFAULT_RUN_SEED;
        }
        return Math.floor(parsed);
    };
    const setSelectedMapSize = (mapSize) => {
        let matched = false;
        ui.runMapSizeInputs.forEach((input) => {
            const isMatch = input.value === mapSize;
            input.checked = isMatch;
            matched = matched || isMatch;
        });
        if (!matched) {
            const fallback = ui.runMapSizeInputs.find((input) => input.value === DEFAULT_MAP_SIZE);
            if (fallback) {
                fallback.checked = true;
                return;
            }
            if (ui.runMapSizeInputs.length > 0) {
                ui.runMapSizeInputs[0].checked = true;
            }
        }
    };
    const getSelectedMapSize = () => {
        const selected = ui.runMapSizeInputs.find((input) => input.checked);
        return selected?.value ?? DEFAULT_MAP_SIZE;
    };
    const mapGenOutputs = new Map();
    ui.mapGenInputs.forEach((input) => {
        const outputId = input.dataset.output;
        if (!outputId) {
            return;
        }
        const output = document.getElementById(outputId);
        if (output) {
            mapGenOutputs.set(input, output);
        }
    });
    const tabButtons = Array.from(document.querySelectorAll("#characterScreen .run-tab"));
    const tabPanels = Array.from(document.querySelectorAll("#characterScreen .run-tab-panel"));
    const setActiveTab = (tabId) => {
        tabButtons.forEach((button) => {
            const isActive = button.dataset.tab === tabId;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        tabPanels.forEach((panel) => {
            const isActive = panel.dataset.tabPanel === tabId;
            panel.classList.toggle("is-active", isActive);
        });
    };
    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const tabId = button.dataset.tab;
            if (!tabId) {
                return;
            }
            setActiveTab(tabId);
        });
    });
    const defaultTab = tabButtons.find((button) => button.classList.contains("is-active"))?.dataset.tab
        ?? tabButtons[0]?.dataset.tab;
    if (defaultTab) {
        setActiveTab(defaultTab);
    }
    const formatMapGenValue = (input) => {
        const raw = Number(input.value);
        if (!Number.isFinite(raw)) {
            return input.value;
        }
        const format = input.dataset.format;
        if (format === "int") {
            return Math.round(raw).toString();
        }
        return raw.toFixed(2);
    };
    const syncMapGenOutput = (input) => {
        const output = mapGenOutputs.get(input);
        if (!output) {
            return;
        }
        output.textContent = formatMapGenValue(input);
    };
    const getMapGenSettings = () => {
        const settings = { ...DEFAULT_RUN_OPTIONS.mapGen };
        ui.mapGenInputs.forEach((input) => {
            const key = input.dataset.mapgenKey;
            if (!key) {
                return;
            }
            const value = Number(input.value);
            if (Number.isFinite(value)) {
                settings[key] = value;
            }
        });
        return settings;
    };
    const applyMapGenSettings = (settings) => {
        const nextSettings = { ...DEFAULT_RUN_OPTIONS.mapGen, ...settings };
        ui.mapGenInputs.forEach((input) => {
            const key = input.dataset.mapgenKey;
            if (!key) {
                return;
            }
            input.value = `${nextSettings[key]}`;
            syncMapGenOutput(input);
        });
    };
    const getFireSettings = () => {
        const settings = {};
        ui.fireInputs.forEach((input) => {
            const key = input.dataset.fireKey;
            if (!key) {
                return;
            }
            const value = Number(input.value);
            if (Number.isFinite(value)) {
                settings[key] = value;
            }
        });
        return normalizeFireSettings(settings);
    };
    const applyFireSettings = (settings) => {
        const nextSettings = normalizeFireSettings(settings);
        ui.fireInputs.forEach((input) => {
            const key = input.dataset.fireKey;
            if (!key) {
                return;
            }
            input.value = `${nextSettings[key]}`;
        });
    };
    const getRunOptions = () => ({
        ...DEFAULT_RUN_OPTIONS,
        unlimitedMoney: ui.runUnlimitedMoney.checked,
        mapGen: getMapGenSettings(),
        fire: getFireSettings()
    });
    ui.characterNameInput.value = state.campaign.callsign;
    ui.characterNameInput.addEventListener("input", () => {
        state.campaign.callsign = ui.characterNameInput.value;
        updateConfirmState();
    });
    ui.runSeedInput.value = coerceSeed(ui.runSeedInput.value).toString();
    ui.runSeedInput.addEventListener("blur", () => {
        ui.runSeedInput.value = coerceSeed(ui.runSeedInput.value).toString();
    });
    ui.characterNameRandom.addEventListener("click", () => {
        applyRandomName();
    });
    ui.mapGenInputs.forEach((input) => {
        input.addEventListener("input", () => syncMapGenOutput(input));
        syncMapGenOutput(input);
    });
    applyMapGenSettings(DEFAULT_RUN_OPTIONS.mapGen);
    applyFireSettings(DEFAULT_RUN_OPTIONS.fire);
    updateSelection();
    updateConfirmState();
    const flushConfirmation = (config) => {
        window.requestAnimationFrame(() => {
            onConfirm(config);
        });
    };
    ui.characterConfirm.addEventListener("click", () => {
        state.campaign.characterId = selectedId;
        const trimmed = ui.characterNameInput.value.trim();
        const callsign = trimmed || buildCallsign(selectedId);
        state.campaign.callsign = callsign;
        ui.characterNameInput.value = callsign;
        const config = {
            seed: coerceSeed(ui.runSeedInput.value),
            mapSize: getSelectedMapSize(),
            options: getRunOptions(),
            characterId: selectedId,
            callsign
        };
        ui.characterScreen.classList.add("hidden");
        state.paused = false;
        flushConfirmation(config);
    });
    const getCurrentConfig = () => {
        const trimmed = ui.characterNameInput.value.trim();
        const callsign = trimmed || state.campaign.callsign || buildCallsign(selectedId);
        return {
            seed: coerceSeed(ui.runSeedInput.value),
            mapSize: getSelectedMapSize(),
            options: getRunOptions(),
            characterId: selectedId,
            callsign
        };
    };
    const open = (config) => {
        state.paused = true;
        selectedId = config.characterId;
        state.campaign.characterId = selectedId;
        state.campaign.callsign = config.callsign;
        ui.characterNameInput.value = config.callsign;
        const seedValue = Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED;
        ui.runSeedInput.value = seedValue.toString();
        setSelectedMapSize(config.mapSize);
        ui.runUnlimitedMoney.checked = config.options.unlimitedMoney;
        applyMapGenSettings(config.options.mapGen ?? DEFAULT_RUN_OPTIONS.mapGen);
        applyFireSettings(config.options.fire ?? DEFAULT_RUN_OPTIONS.fire);
        setActiveTab("roster");
        if (ui.characterNameInput.value.trim().length === 0) {
            applyRandomName();
        }
        updateSelection();
        ui.characterScreen.classList.remove("hidden");
    };
    return { open, getCurrentConfig };
}
