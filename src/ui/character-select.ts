import type { WorldState } from "../core/state.js";
import { CHARACTERS, CHIEF_GENDERS, DEFAULT_CHIEF_GENDER, getCharacterInitials } from "../core/characters.js";
import type { CharacterId, CharacterDefinition, ChiefGender } from "../core/characters.js";
import { FUEL_PROFILES, type MapSizeId } from "../core/config.js";
import type { FireSettings, FuelProfile, TileType } from "../core/types.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "./run-config.js";
import type { FuelProfileOverrides, NewRunConfig, RunOptions } from "./run-config.js";
import { cloneTerrainRecipe, createDefaultTerrainRecipe, terrainRecipeEqual, type TerrainRecipe } from "../mapgen/terrainProfile.js";
import { loadFuelProfileOverrides, saveFuelProfileOverrides } from "../persistence/fuelProfiles.js";
import { loadMapScenarios, type MapScenario } from "../persistence/mapScenarios.js";
import { buildTerrainControls } from "./terrain-controls.js";
import {
  coerceTerrainSeedNumber,
  decodeTerrainSeedCode,
  encodeTerrainSeedCode
} from "./terrainSeedCode.js";
import {
  applyTerrainArchetypeDefaultsToControls,
  applyTerrainRecipeToControls,
  collectTerrainControlElements,
  readTerrainRecipeFromControls,
  syncTerrainControlOutputs,
  TERRAIN_RUN_GROUPS
} from "./terrain-schema.js";
import {
  FUEL_PROFILE_FIELD_DEFINITIONS,
  buildFuelFieldTooltip,
  buildFuelInputTooltip,
  buildFuelTypeTooltip,
  formatFuelTileTypeLabel
} from "./fuelProfileHelp.js";
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
  runScenarioSelect: HTMLSelectElement;
  runScenarioLoad: HTMLButtonElement;
  runScenarioState: HTMLDivElement;
  runUnlimitedMoney: HTMLInputElement;
  terrainControls: HTMLDivElement;
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

const FUEL_PROFILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];

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
    for (const field of FUEL_PROFILE_FIELD_DEFINITIONS) {
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

const cloneRunOptions = (options: RunOptions): RunOptions => ({
  ...DEFAULT_RUN_OPTIONS,
  ...options,
  terrain: cloneTerrainRecipe(options.terrain ?? DEFAULT_RUN_OPTIONS.terrain),
  fire: normalizeFireSettings(options.fire),
  fuelProfiles: { ...(options.fuelProfiles ?? {}) }
});

const cloneRunConfig = (config: NewRunConfig): NewRunConfig => ({
  seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
  mapSize: config.mapSize,
  characterId: config.characterId,
  chiefGender: config.chiefGender ?? DEFAULT_CHIEF_GENDER,
  callsign: config.callsign,
  options: cloneRunOptions(config.options)
});

const FIRST_NAMES: Record<ChiefGender, string[]> = {
  male: [
    "Alex",
    "Riley",
    "Jordan",
    "Casey",
    "Logan",
    "Hayden",
    "Cameron",
    "Ellis",
    "Wyatt",
    "Beckett",
    "Drew",
    "Miles"
  ],
  female: [
    "Avery",
    "Morgan",
    "Quinn",
    "Parker",
    "Rowan",
    "Emery",
    "Reese",
    "Sawyer",
    "Harper",
    "Maya",
    "Tessa",
    "Nora"
  ]
};

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

const buildCallsign = (characterId: CharacterId, chiefGender: ChiefGender): string => {
  const first = pickRandom(FIRST_NAMES[chiefGender]);
  const last = pickRandom(LAST_NAMES);
  const nick = pickRandom(NICKNAMES[characterId]);
  return `${first} "${nick}" ${last}`;
};

export function initCharacterSelect(
  ui: CharacterSelectRefs,
  state: WorldState,
  onConfirm: (config: NewRunConfig) => void | Promise<void>,
  initialConfig?: NewRunConfig
): { open: (config: NewRunConfig) => void; getCurrentConfig: () => NewRunConfig } {
  const defaultConfig: NewRunConfig = cloneRunConfig(
    initialConfig ?? {
      seed: DEFAULT_RUN_SEED,
      mapSize: DEFAULT_MAP_SIZE,
      options: {
        ...DEFAULT_RUN_OPTIONS,
        terrain: cloneTerrainRecipe(DEFAULT_RUN_OPTIONS.terrain),
        fire: { ...DEFAULT_RUN_OPTIONS.fire },
        fuelProfiles: { ...loadFuelProfileOverrides() }
      },
      characterId: state.campaign.characterId,
      chiefGender: state.campaign.chiefGender,
      callsign: state.campaign.callsign
    }
  );
  let selectedId: CharacterId = defaultConfig.characterId;
  let selectedGender: ChiefGender = defaultConfig.chiefGender;
  let fuelProfileOverrides = { ...defaultConfig.options.fuelProfiles };
  let fuelProfiles = buildFuelProfiles(fuelProfileOverrides);
  const fuelProfileInputs: HTMLInputElement[] = [];
  const fuelProfileHeaderCells = new Map<keyof FuelProfile, HTMLDivElement>();
  const fuelProfileTypeCells = new Map<TileType, HTMLDivElement>();
  const cards = new Map<CharacterId, HTMLButtonElement>();
  const genderButtons = new Map<ChiefGender, HTMLButtonElement>();
  const genderControl = document.createElement("div");
  const previewDetails = document.createElement("div");
  let mapScenarios: MapScenario[] = [];
  let selectedScenarioOptionId = "";

  genderControl.className = "character-gender-toggle";
  genderControl.setAttribute("role", "group");
  genderControl.setAttribute("aria-label", "Chief portrait gender");
  CHIEF_GENDERS.forEach((gender) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-gender-option";
    button.dataset.chiefGender = gender;
    button.textContent = gender === "male" ? "Male" : "Female";
    button.addEventListener("click", () => {
      selectedGender = gender;
      state.campaign.chiefGender = selectedGender;
      updateSelection();
    });
    genderControl.appendChild(button);
    genderButtons.set(gender, button);
  });
  ui.characterNameInput.closest(".character-preview-fields")?.prepend(genderControl);

  previewDetails.className = "character-preview-details";
  ui.characterPreviewPortrait.insertAdjacentElement("afterend", previewDetails);

  const getPortrait = (character: CharacterDefinition): string =>
    character.portraits[selectedGender] ?? character.portraits[DEFAULT_CHIEF_GENDER];

  ui.characterGrid.innerHTML = "";
  CHARACTERS.forEach((character) => {
    const initials = getCharacterInitials(character.name);
    const portrait = getPortrait(character);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "character-card";
    card.dataset.id = character.id;
    card.setAttribute("aria-label", `Select ${character.name}, ${character.title}`);
    card.innerHTML = `
      <div class="character-card-frame">
        <div class="character-portrait has-photo" style="--chief-accent: ${character.accent};">
          <img src="${portrait}" alt="${character.name} portrait" loading="lazy" />
          <span>${initials}</span>
        </div>
      </div>
      <div class="character-card-label">
        <div class="character-name">${character.name}</div>
        <div class="character-title">${character.title}</div>
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
    const portrait = getPortrait(chosen);
    ui.characterSummary.textContent = `${chosen.name} - ${chosen.title}. ${chosen.description}`;
    ui.characterPreviewInitials.textContent = getCharacterInitials(chosen.name);
    ui.characterPreviewPortrait.style.setProperty("--chief-accent", chosen.accent);
    ui.characterPreviewImage.src = portrait;
    ui.characterPreviewImage.alt = `${chosen.name} portrait`;
    ui.characterPreviewPortrait.classList.add("has-photo");
    previewDetails.innerHTML = `
      <div class="character-preview-kicker">Selected Chief</div>
      <div class="character-preview-name">${chosen.name}</div>
      <div class="character-preview-title">${chosen.title}</div>
      <p class="character-preview-desc">${chosen.description}</p>
      <div class="character-preview-stats">
        ${buildStats(chosen)
          .map((stat) => `<div>${stat}</div>`)
          .join("")}
      </div>
    `;
  };

  const updateSelection = (): void => {
    cards.forEach((card, id) => {
      const active = id === selectedId;
      card.classList.toggle("selected", active);
      card.setAttribute("aria-pressed", active ? "true" : "false");
      const character = CHARACTERS.find((entry) => entry.id === id);
      const image = card.querySelector<HTMLImageElement>("img");
      if (character && image) {
        image.src = getPortrait(character);
        image.alt = `${character.name} portrait`;
      }
    });
    genderButtons.forEach((button, gender) => {
      const active = gender === selectedGender;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    updatePreview();
    updateConfirmState();
  };

  const updateConfirmState = (): void => {
    ui.characterConfirm.disabled = ui.characterNameInput.value.trim().length === 0;
  };

  const applyRandomName = (): void => {
    const name = buildCallsign(selectedId, selectedGender);
    ui.characterNameInput.value = name;
    state.campaign.callsign = name;
    updateConfirmState();
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

  if (ui.terrainControls.childElementCount === 0) {
    buildTerrainControls({
      container: ui.terrainControls,
      groups: TERRAIN_RUN_GROUPS,
      idPrefix: "runTerrain"
    });
  }
  const terrainControlElements = collectTerrainControlElements(ui.terrainControls);

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

  const getTerrainRecipe = (): TerrainRecipe =>
    cloneTerrainRecipe({
      ...readTerrainRecipeFromControls(terrainControlElements, createDefaultTerrainRecipe(getSelectedMapSize())),
      mapSize: getSelectedMapSize()
    });

  const applyTerrainRecipe = (recipe: TerrainRecipe): void => {
    applyTerrainRecipeToControls(
      cloneTerrainRecipe({
        ...recipe,
        mapSize: recipe.mapSize ?? getSelectedMapSize()
      }),
      terrainControlElements
    );
  };

  const readSeedNumber = (): number =>
    decodeTerrainSeedCode(ui.runSeedInput.value)?.seed
    ?? coerceTerrainSeedNumber(ui.runSeedInput.value, DEFAULT_RUN_SEED);

  const syncSeedField = (seedNumber = readSeedNumber()): void => {
    ui.runSeedInput.value = encodeTerrainSeedCode({
      seed: seedNumber,
      mapSize: getSelectedMapSize(),
      terrain: getTerrainRecipe()
    });
  };

  const applySeedFieldIfEncoded = (): boolean => {
    const decoded = decodeTerrainSeedCode(ui.runSeedInput.value);
    if (!decoded) {
      return false;
    }
    setSelectedMapSize(decoded.mapSize);
    applyTerrainRecipe(decoded.terrain);
    ui.runSeedInput.value = encodeTerrainSeedCode(decoded);
    return true;
  };

  const findMatchingScenario = (
    seed: number,
    mapSize: MapSizeId,
    terrain: TerrainRecipe
  ): MapScenario | null =>
    mapScenarios.find(
      (scenario) =>
        scenario.seed === seed &&
        scenario.mapSize === mapSize &&
        terrainRecipeEqual(scenario.terrain, terrain)
    ) ?? null;

  const syncScenarioLoadButton = (): void => {
    ui.runScenarioLoad.disabled =
      !selectedScenarioOptionId || !mapScenarios.some((scenario) => scenario.id === selectedScenarioOptionId);
  };

  const syncCurrentScenarioState = (): void => {
    const match = findMatchingScenario(readSeedNumber(), getSelectedMapSize(), getTerrainRecipe());
    ui.runScenarioState.textContent = `Current terrain: ${match ? match.name : "Custom"}`;
  };

  const refreshScenarioOptions = (preferredScenarioId?: string): void => {
    mapScenarios = loadMapScenarios();
    const preferred = preferredScenarioId ?? selectedScenarioOptionId;
    ui.runScenarioSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = mapScenarios.length > 0 ? "Select a saved scenario" : "No saved scenarios yet";
    placeholder.disabled = mapScenarios.length === 0;
    ui.runScenarioSelect.appendChild(placeholder);
    mapScenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = `${scenario.name} · ${scenario.mapSize} · seed ${scenario.seed}`;
      ui.runScenarioSelect.appendChild(option);
    });
    if (preferred && mapScenarios.some((scenario) => scenario.id === preferred)) {
      selectedScenarioOptionId = preferred;
      ui.runScenarioSelect.value = preferred;
    } else {
      selectedScenarioOptionId = "";
      ui.runScenarioSelect.value = "";
    }
    syncScenarioLoadButton();
    syncCurrentScenarioState();
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
    syncFuelProfileTooltips();
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

  const syncFuelProfileTooltips = (): void => {
    const heatCap = getFireSettings().heatCap;
    fuelProfileHeaderCells.forEach((cell, key) => {
      cell.title = buildFuelFieldTooltip(key, heatCap);
    });
    fuelProfileTypeCells.forEach((cell, type) => {
      cell.title = buildFuelTypeTooltip(type, fuelProfiles[type], heatCap);
    });
    fuelProfileInputs.forEach((input) => {
      const type = input.dataset.fuelType as TileType | undefined;
      const key = input.dataset.fuelKey as keyof FuelProfile | undefined;
      if (!type || !key) {
        return;
      }
      input.title = buildFuelInputTooltip(type, key, fuelProfiles[type], heatCap);
    });
  };

  const buildFuelProfileGrid = (): void => {
    if (!ui.fuelProfileGrid) {
      return;
    }
    fuelProfileInputs.length = 0;
    fuelProfileHeaderCells.clear();
    fuelProfileTypeCells.clear();
    ui.fuelProfileGrid.innerHTML = "";
    const headerLabels = ["Tile", ...FUEL_PROFILE_FIELD_DEFINITIONS.map((field) => field.label)];
    headerLabels.forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "fuel-grid-cell fuel-grid-head";
      cell.textContent = label;
      if (label === "Tile") {
        cell.title = "Tile type these fire-tuning values apply to.";
      } else {
        const field = FUEL_PROFILE_FIELD_DEFINITIONS.find((entry) => entry.label === label);
        if (field) {
          fuelProfileHeaderCells.set(field.key, cell);
        }
      }
      ui.fuelProfileGrid.appendChild(cell);
    });

    for (const type of FUEL_PROFILE_TYPES) {
      const typeCell = document.createElement("div");
      typeCell.className = "fuel-grid-cell fuel-grid-type";
      const swatch = document.createElement("span");
      swatch.className = "fuel-grid-swatch";
      swatch.dataset.type = type;
      const label = document.createElement("span");
      label.textContent = formatFuelTileTypeLabel(type);
      typeCell.appendChild(swatch);
      typeCell.appendChild(label);
      fuelProfileTypeCells.set(type, typeCell);
      ui.fuelProfileGrid.appendChild(typeCell);

      for (const field of FUEL_PROFILE_FIELD_DEFINITIONS) {
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

  const applyFuelProfileOverrides = (overrides: FuelProfileOverrides): void => {
    fuelProfileOverrides = { ...overrides };
    fuelProfiles = buildFuelProfiles(fuelProfileOverrides);
    syncFuelProfileInputs();
    syncFuelProfileTooltips();
    saveFuelProfileOverrides(fuelProfileOverrides);
  };

  const getRunOptions = (): RunOptions => ({
    ...DEFAULT_RUN_OPTIONS,
    unlimitedMoney: ui.runUnlimitedMoney.checked,
    terrain: getTerrainRecipe(),
    fire: getFireSettings(),
    fuelProfiles: fuelProfileOverrides
  });

  const applyConfigToForm = (config: NewRunConfig, fillMissingCallsign: boolean): void => {
    const nextConfig = cloneRunConfig(config);
    selectedId = nextConfig.characterId;
    selectedGender = nextConfig.chiefGender;
    state.campaign.characterId = selectedId;
    state.campaign.chiefGender = selectedGender;
    state.campaign.callsign = nextConfig.callsign;
    ui.characterNameInput.value = nextConfig.callsign;
    setSelectedMapSize(nextConfig.mapSize);
    ui.runUnlimitedMoney.checked = nextConfig.options.unlimitedMoney;
    applyTerrainRecipe(nextConfig.options.terrain);
    syncSeedField(nextConfig.seed);
    applyFireSettings(nextConfig.options.fire);
    applyFuelProfileOverrides(nextConfig.options.fuelProfiles ?? {});
    const matchingScenario = findMatchingScenario(nextConfig.seed, nextConfig.mapSize, nextConfig.options.terrain);
    refreshScenarioOptions(matchingScenario?.id ?? selectedScenarioOptionId);
    setActiveTab("roster");
    if (fillMissingCallsign && ui.characterNameInput.value.trim().length === 0) {
      applyRandomName();
    }
    updateSelection();
    updateConfirmState();
  };

  ui.characterNameInput.addEventListener("input", () => {
    state.campaign.callsign = ui.characterNameInput.value;
    updateConfirmState();
  });

  syncSeedField(readSeedNumber());
  ui.runSeedInput.addEventListener("input", () => {
    applySeedFieldIfEncoded();
    syncCurrentScenarioState();
  });
  ui.runSeedInput.addEventListener("blur", () => {
    if (!applySeedFieldIfEncoded()) {
      syncSeedField(readSeedNumber());
    }
    syncCurrentScenarioState();
  });

  ui.runMapSizeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      syncSeedField();
      syncCurrentScenarioState();
    });
  });

  ui.runScenarioSelect.addEventListener("change", () => {
    selectedScenarioOptionId = ui.runScenarioSelect.value;
    syncScenarioLoadButton();
  });

  ui.runScenarioLoad.addEventListener("click", () => {
    const scenario = mapScenarios.find((entry) => entry.id === selectedScenarioOptionId);
    if (!scenario) {
      return;
    }
    setSelectedMapSize(scenario.mapSize);
    applyTerrainRecipe(scenario.terrain);
    syncSeedField(scenario.seed);
    syncCurrentScenarioState();
  });

  ui.characterNameRandom.addEventListener("click", () => {
    applyRandomName();
  });

  terrainControlElements.inputs.forEach((input) => {
    const sync = (): void => {
      if (input instanceof HTMLSelectElement && input.dataset.terrainScope === "recipe" && input.dataset.terrainKey === "archetype") {
        applyTerrainArchetypeDefaultsToControls(input.value as TerrainRecipe["archetype"], getSelectedMapSize(), terrainControlElements);
      }
      syncTerrainControlOutputs(terrainControlElements);
      syncSeedField();
      syncCurrentScenarioState();
    };
    input.addEventListener(input instanceof HTMLSelectElement ? "change" : "input", sync);
  });
  syncTerrainControlOutputs(terrainControlElements);
  ui.fireInputs.forEach((input) => {
    input.addEventListener("input", syncFuelProfileTooltips);
  });
  buildFuelProfileGrid();
  syncFuelProfileTooltips();
  refreshScenarioOptions();
  applyConfigToForm(defaultConfig, false);

  const flushConfirmation = (config: NewRunConfig): void => {
    window.requestAnimationFrame(() => {
      onConfirm(config);
    });
  };

  ui.characterConfirm.addEventListener("click", () => {
    state.campaign.characterId = selectedId;
    state.campaign.chiefGender = selectedGender;
    const trimmed = ui.characterNameInput.value.trim();
    const callsign = trimmed || buildCallsign(selectedId, selectedGender);
    state.campaign.callsign = callsign;
    ui.characterNameInput.value = callsign;
    const config: NewRunConfig = {
      seed: readSeedNumber(),
      mapSize: getSelectedMapSize(),
      options: getRunOptions(),
      characterId: selectedId,
      chiefGender: selectedGender,
      callsign
    };
    ui.characterScreen.classList.add("hidden");
    state.paused = false;
    flushConfirmation(config);
  });

  const getCurrentConfig = (): NewRunConfig => {
    const trimmed = ui.characterNameInput.value.trim();
    const callsign = trimmed || state.campaign.callsign || buildCallsign(selectedId, selectedGender);
    return {
      seed: readSeedNumber(),
      mapSize: getSelectedMapSize(),
      options: getRunOptions(),
      characterId: selectedId,
      chiefGender: selectedGender,
      callsign
    };
  };

  const open = (config: NewRunConfig): void => {
    state.paused = true;
    applyConfigToForm(config, true);
    ui.characterScreen.classList.remove("hidden");
  };

  return { open, getCurrentConfig };
}
