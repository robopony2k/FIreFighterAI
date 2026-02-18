import type { WorldState } from "../core/state.js";
import { CHARACTERS, getCharacterInitials } from "../core/characters.js";
import type { CharacterId, CharacterDefinition } from "../core/characters.js";
import { FUEL_PROFILES, type MapSizeId } from "../core/config.js";
import type { FireSettings, FuelProfile, TileType } from "../core/types.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "./run-config.js";
import type { FuelProfileOverrides, NewRunConfig, RunOptions } from "./run-config.js";
import type { MapGenSettings } from "../mapgen/settings.js";
import { loadFuelProfileOverrides, saveFuelProfileOverrides } from "../persistence/fuelProfiles.js";

type NumericMapGenKey = {
  [K in keyof MapGenSettings]: MapGenSettings[K] extends number ? K : never;
}[keyof MapGenSettings];
export type CharacterSelectRefs = {
  characterScreen: HTMLDivElement;
  characterGrid: HTMLDivElement;
  characterSummary: HTMLParagraphElement;
  characterConfirm: HTMLButtonElement;
  characterPreviewPortrait: HTMLDivElement;
  characterPreviewImage: HTMLImageElement;
  characterPreviewInitials: HTMLSpanElement;
  characterNameInput: HTMLInputElement;
  characterNameRandom: HTMLButtonElement;
  runSeedInput: HTMLInputElement;
  runMapSizeInputs: HTMLInputElement[];
  runUnlimitedMoney: HTMLInputElement;
  mapGenInputs: HTMLInputElement[];
  fireInputs: HTMLInputElement[];
  fuelProfileGrid: HTMLDivElement;
};

const formatPercent = (value: number): string => {
  const rounded = Math.round(value * 100);
  if (rounded === 0) {
    return "0%";
  }
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
};

const formatMultiplier = (value: number): string => formatPercent(value - 1);

const buildStats = (character: CharacterDefinition): string[] => [
  `Budget ${formatMultiplier(character.modifiers.budgetMultiplier)}`,
  `Unit Speed ${formatMultiplier(character.modifiers.unitSpeedMultiplier)}`,
  `Suppression ${formatMultiplier(character.modifiers.unitPowerMultiplier)}`,
  `Containment ${formatPercent(character.modifiers.containmentBonus)}`,
  `Firebreak Cost ${formatMultiplier(character.modifiers.firebreakCostMultiplier)}`,
  `Approval Retention ${formatMultiplier(character.modifiers.approvalRetentionMultiplier)}`
];

const FUEL_PROFILE_FIELDS: { key: keyof FuelProfile; label: string; step: string }[] = [
  { key: "baseFuel", label: "Base fuel", step: "0.01" },
  { key: "ignition", label: "Ignition point", step: "0.01" },
  { key: "burnRate", label: "Burn rate", step: "0.01" },
  { key: "heatOutput", label: "Heat output", step: "0.01" },
  { key: "spreadBoost", label: "Spread boost", step: "0.01" },
  { key: "heatTransferCap", label: "Heat transfer cap", step: "0.01" },
  { key: "heatRetention", label: "Heat retention", step: "0.01" },
  { key: "windFactor", label: "Wind factor", step: "0.01" }
];

const FUEL_PROFILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];

const formatTileTypeLabel = (type: TileType): string => type.charAt(0).toUpperCase() + type.slice(1);

const buildFuelProfiles = (overrides: FuelProfileOverrides): Record<TileType, FuelProfile> => {
  const result = {} as Record<TileType, FuelProfile>;
  for (const type of FUEL_PROFILE_TYPES) {
    const base = FUEL_PROFILES[type];
    result[type] = { ...base, ...(overrides[type] ?? {}) };
  }
  return result;
};

const buildFuelProfileOverrides = (profiles: Record<TileType, FuelProfile>): FuelProfileOverrides => {
  const overrides: FuelProfileOverrides = {};
  for (const type of FUEL_PROFILE_TYPES) {
    const base = FUEL_PROFILES[type];
    const profile = profiles[type];
    const delta: Partial<FuelProfile> = {};
    for (const field of FUEL_PROFILE_FIELDS) {
      const key = field.key;
      if (Math.abs(profile[key] - base[key]) > 1e-6) {
        delta[key] = profile[key];
      }
    }
    if (Object.keys(delta).length > 0) {
      overrides[type] = delta;
    }
  }
  return overrides;
};

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

const NICKNAMES: Record<CharacterId, string[]> = {
  chief: ["Anchor", "Redline", "Sentinel", "Frontier", "Steel"],
  strategist: ["Grid", "Compass", "Calc", "Sightline", "Vector"],
  logistics: ["Quarter", "Depot", "Supply", "Railhead", "Stack"],
  trainer: ["Anvil", "Forge", "Hammer", "Drill", "Standard"],
  "air-ops": ["Skylark", "Jetstream", "Overwatch", "Altitude", "Falcon"],
  community: ["Cedar", "Harbor", "Beacon", "Hearth", "Pioneer"]
};

const pickRandom = <T,>(options: T[]): T => options[Math.floor(Math.random() * options.length)];

const buildCallsign = (characterId: CharacterId): string => {
  const first = pickRandom(FIRST_NAMES);
  const last = pickRandom(LAST_NAMES);
  const nick = pickRandom(NICKNAMES[characterId]);
  return `${first} "${nick}" ${last}`;
};

export function initCharacterSelect(
  ui: CharacterSelectRefs,
  state: WorldState,
  onConfirm: (config: NewRunConfig) => void | Promise<void>
): { open: (config: NewRunConfig) => void; getCurrentConfig: () => NewRunConfig } {
  let selectedId: CharacterId = state.campaign.characterId;
  let fuelProfileOverrides = loadFuelProfileOverrides();
  let fuelProfiles = buildFuelProfiles(fuelProfileOverrides);
  const fuelProfileInputs: HTMLInputElement[] = [];
  const cards = new Map<CharacterId, HTMLButtonElement>();

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

  const updatePreview = (): void => {
    const chosen = CHARACTERS.find((entry) => entry.id === selectedId) ?? CHARACTERS[0];
    ui.characterSummary.textContent = `${chosen.name} - ${chosen.title}. ${chosen.description}`;
    ui.characterPreviewInitials.textContent = getCharacterInitials(chosen.name);
    ui.characterPreviewPortrait.style.setProperty("--chief-accent", chosen.accent);
    ui.characterPreviewImage.src = chosen.portrait;
    ui.characterPreviewImage.alt = `${chosen.name} portrait`;
    ui.characterPreviewPortrait.classList.add("has-photo");
  };

  const updateSelection = (): void => {
    cards.forEach((card, id) => {
      const active = id === selectedId;
      card.classList.toggle("selected", active);
      card.setAttribute("aria-pressed", active ? "true" : "false");
    });
    updatePreview();
    updateConfirmState();
  };

  const updateConfirmState = (): void => {
    ui.characterConfirm.disabled = ui.characterNameInput.value.trim().length === 0;
  };

  const applyRandomName = (): void => {
    const name = buildCallsign(selectedId);
    ui.characterNameInput.value = name;
    state.campaign.callsign = name;
    updateConfirmState();
  };

  const coerceSeed = (value: string): number => {
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

  const setSelectedMapSize = (mapSize: MapSizeId): void => {
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

  const getSelectedMapSize = (): MapSizeId => {
    const selected = ui.runMapSizeInputs.find((input) => input.checked);
    return (selected?.value as MapSizeId) ?? DEFAULT_MAP_SIZE;
  };

  const mapGenOutputs = new Map<HTMLInputElement, HTMLElement>();
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

  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#characterScreen .run-tab"));
  const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("#characterScreen .run-tab-panel"));

  const setActiveTab = (tabId: string): void => {
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

  const formatMapGenValue = (input: HTMLInputElement): string => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) {
      return input.value;
    }
    const format = input.dataset.format;
    if (format === "int") {
      return Math.round(raw).toString();
    }
    if (format === "percent") {
      return `${Math.round(raw * 100)}%`;
    }
    return raw.toFixed(2);
  };

  const syncMapGenOutput = (input: HTMLInputElement): void => {
    const output = mapGenOutputs.get(input);
    if (!output) {
      return;
    }
    output.textContent = formatMapGenValue(input);
  };

  const getMapGenSettings = (): MapGenSettings => {
    const settings: MapGenSettings = { ...DEFAULT_RUN_OPTIONS.mapGen };
    ui.mapGenInputs.forEach((input) => {
      const key = input.dataset.mapgenKey as NumericMapGenKey | undefined;
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

  const applyMapGenSettings = (settings: MapGenSettings): void => {
    const nextSettings = { ...DEFAULT_RUN_OPTIONS.mapGen, ...settings };
    ui.mapGenInputs.forEach((input) => {
      const key = input.dataset.mapgenKey as NumericMapGenKey | undefined;
      if (!key) {
        return;
      }
      input.value = `${nextSettings[key]}`;
      syncMapGenOutput(input);
    });
  };

  const getFireSettings = (): FireSettings => {
    const settings: Partial<FireSettings> = {};
    ui.fireInputs.forEach((input) => {
      const key = input.dataset.fireKey as keyof FireSettings | undefined;
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

  const applyFireSettings = (settings: Partial<FireSettings>): void => {
    const nextSettings = normalizeFireSettings(settings);
    ui.fireInputs.forEach((input) => {
      const key = input.dataset.fireKey as keyof FireSettings | undefined;
      if (!key) {
        return;
      }
      input.value = `${nextSettings[key]}`;
    });
  };

  const handleFuelProfileInput = (event: Event): void => {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const type = input.dataset.fuelType as TileType | undefined;
    const key = input.dataset.fuelKey as keyof FuelProfile | undefined;
    if (!type || !key) {
      return;
    }
    if (input.value.trim().length === 0) {
      return;
    }
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    fuelProfiles[type] = { ...fuelProfiles[type], [key]: value };
    fuelProfileOverrides = buildFuelProfileOverrides(fuelProfiles);
    saveFuelProfileOverrides(fuelProfileOverrides);
  };

  const syncFuelProfileInputs = (): void => {
    fuelProfileInputs.forEach((input) => {
      const type = input.dataset.fuelType as TileType | undefined;
      const key = input.dataset.fuelKey as keyof FuelProfile | undefined;
      if (!type || !key) {
        return;
      }
      const value = fuelProfiles[type]?.[key];
      if (Number.isFinite(value)) {
        input.value = value.toFixed(2);
      }
    });
  };

  const buildFuelProfileGrid = (): void => {
    if (!ui.fuelProfileGrid) {
      return;
    }
    fuelProfileInputs.length = 0;
    ui.fuelProfileGrid.innerHTML = "";
    const headerLabels = ["Tile", ...FUEL_PROFILE_FIELDS.map((field) => field.label)];
    headerLabels.forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "fuel-grid-cell fuel-grid-head";
      cell.textContent = label;
      ui.fuelProfileGrid.appendChild(cell);
    });

    for (const type of FUEL_PROFILE_TYPES) {
      const typeCell = document.createElement("div");
      typeCell.className = "fuel-grid-cell fuel-grid-type";
      const swatch = document.createElement("span");
      swatch.className = "fuel-grid-swatch";
      swatch.dataset.type = type;
      const label = document.createElement("span");
      label.textContent = formatTileTypeLabel(type);
      typeCell.appendChild(swatch);
      typeCell.appendChild(label);
      ui.fuelProfileGrid.appendChild(typeCell);

      for (const field of FUEL_PROFILE_FIELDS) {
        const cell = document.createElement("div");
        cell.className = "fuel-grid-cell";
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = field.step;
        const value = fuelProfiles[type][field.key];
        input.value = Number.isFinite(value) ? value.toFixed(2) : "0";
        input.dataset.fuelType = type;
        input.dataset.fuelKey = field.key;
        input.addEventListener("input", handleFuelProfileInput);
        cell.appendChild(input);
        ui.fuelProfileGrid.appendChild(cell);
        fuelProfileInputs.push(input);
      }
    }
  };

  const applyFuelProfileOverrides = (overrides?: FuelProfileOverrides): void => {
    if (overrides !== undefined) {
      fuelProfileOverrides = overrides;
    }
    fuelProfiles = buildFuelProfiles(fuelProfileOverrides);
    syncFuelProfileInputs();
    saveFuelProfileOverrides(fuelProfileOverrides);
  };

  const getRunOptions = (): RunOptions => ({
    ...DEFAULT_RUN_OPTIONS,
    unlimitedMoney: ui.runUnlimitedMoney.checked,
    mapGen: getMapGenSettings(),
    fire: getFireSettings(),
    fuelProfiles: fuelProfileOverrides
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
  buildFuelProfileGrid();
  applyFuelProfileOverrides(fuelProfileOverrides);

  updateSelection();
  updateConfirmState();

  const flushConfirmation = (config: NewRunConfig): void => {
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
    const config: NewRunConfig = {
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

  const getCurrentConfig = (): NewRunConfig => {
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

  const open = (config: NewRunConfig): void => {
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
    const requestedOverrides = config.options.fuelProfiles;
    const hasOverrides = requestedOverrides && Object.keys(requestedOverrides).length > 0;
    applyFuelProfileOverrides(hasOverrides ? requestedOverrides : undefined);
    setActiveTab("roster");
    if (ui.characterNameInput.value.trim().length === 0) {
      applyRandomName();
    }
    updateSelection();
    ui.characterScreen.classList.remove("hidden");
  };

  return { open, getCurrentConfig };
}
