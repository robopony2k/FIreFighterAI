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

const getFuelFieldLabel = (key: keyof FuelProfile): string =>
  FUEL_PROFILE_FIELDS.find((field) => field.key === key)?.label ?? key;

const buildFuelFieldTooltip = (key: keyof FuelProfile, heatCap: number): string => {
  switch (key) {
    case "baseFuel":
      return [
        "Starting combustible mass before moisture, vegetation-age scaling, and small random variation are applied.",
        "Final fuel is roughly baseFuel * vegetation multiplier * (1 - moisture * 0.6).",
        "Tune this for burn duration more than ignition difficulty.",
        "0 disables sustained burning; ~0.2-0.5 is light fuel; ~0.8+ is heavy fuel."
      ].join("\n");
    case "ignition":
      return [
        "Heat threshold required to ignite the tile.",
        "Final ignition is clamp(profile + moisture * 0.35 + forest bonus 0.08, 0.2, 1.4).",
        "Lower values ignite easily; higher values need stronger pre-heating.",
        "Values that end up above 1.4 are effectively capped."
      ].join("\n");
    case "burnRate":
      return [
        "Scales both fire growth and fuel drain once the tile is burning.",
        "Final burn rate is profile * (0.7 + (1 - moisture) * 0.8), so dry tiles burn a bit over 2x faster than saturated ones.",
        "Higher values create faster flare-ups; lower values create longer smoldering burns."
      ].join("\n");
    case "heatOutput":
      return [
        "Controls how much heat a burning tile generates for itself and neighboring tiles.",
        "Final heat output is profile * (0.85 + fuel * 0.25), so heavier-fuel tiles burn hotter.",
        "Raise this when you want a tile to push stronger heat into the fire front."
      ].join("\n");
    case "spreadBoost":
      return [
        "Multiplier on outgoing spread heat while the tile is actively burning.",
        "1.0 is neutral. 0 means the tile can burn, but contributes almost no active spread.",
        "Best tuned alongside heat output; high spread boost with low heat output still spreads weakly."
      ].join("\n");
    case "heatTransferCap":
      return [
        "Maximum stored heat the tile can hold after diffusion.",
        `The effective cap is limited by the current global fire heat cap (${heatCap.toFixed(2)}).`,
        "If this is non-zero but below the tile's ignition point, the sim still lifts the effective cap to at least ignitionPoint * 1.05.",
        "0 makes the tile dump stored heat immediately."
      ].join("\n");
    case "heatRetention":
      return [
        "Fraction of buffered heat kept each update, and a major driver of how long hotspots linger after flames die.",
        "~0.4-0.6 cools quickly; ~0.85+ keeps stubborn embers alive.",
        "Values above 1 can amplify heat and usually create unstable behavior."
      ].join("\n");
    case "windFactor":
      return [
        "How strongly wind biases the direction of spread heat.",
        "0 ignores wind. ~0.6-1.0 is a strong but sane directional effect. Values above 1 exaggerate downwind runs.",
        "Negative values are treated as 0 in the sim."
      ].join("\n");
    default:
      return "";
  }
};

const collectFuelProfileRelationshipNotes = (profile: FuelProfile, heatCap: number): string[] => {
  const notes: string[] = [];
  if (profile.baseFuel <= 0) {
    notes.push("Base fuel is 0, so this tile type will not sustain fire regardless of the other values.");
  } else if (profile.baseFuel < profile.burnRate) {
    notes.push("Base fuel is lower than burn rate; expect brief flare-ups that consume fuel very quickly.");
  } else if (profile.baseFuel > 0.8 && profile.burnRate < 0.2) {
    notes.push("High fuel with low burn rate creates long, stubborn burns that can smolder for a while.");
  }

  if (profile.heatOutput < profile.ignition) {
    notes.push("Heat output is below ignition point; same-type spread may need neighbor stacking, dry conditions, or wind support.");
  } else if (profile.baseFuel > 0 && profile.heatOutput > profile.baseFuel * 2.2 && profile.burnRate >= 0.6) {
    notes.push("Heat output is high relative to fuel; expect hot but relatively short-lived flare-ups.");
  }

  if (profile.spreadBoost <= 0 && profile.baseFuel > 0) {
    notes.push("Spread boost is 0: the tile can burn if ignited, but contributes almost no active spread.");
  } else if (profile.spreadBoost > 1 && profile.windFactor > 1) {
    notes.push("High spread boost plus high wind factor creates very aggressive downwind fronts.");
  }

  if (profile.heatTransferCap > heatCap) {
    notes.push(
      `Heat transfer cap is above the current global fire heat cap (${heatCap.toFixed(2)}), so the extra headroom is unused unless you raise the global cap.`
    );
  } else if (profile.heatTransferCap > 0 && profile.heatTransferCap < profile.ignition) {
    notes.push("Heat transfer cap is below ignition point; the sim will still lift the effective cap to at least ignitionPoint * 1.05.");
  }

  if (profile.heatRetention > 1) {
    notes.push("Heat retention above 1 can amplify stored heat and usually produces unstable or non-physical behavior.");
  } else if (profile.heatRetention > 0.85 && profile.heatTransferCap >= heatCap * 0.8 && profile.baseFuel > 0) {
    notes.push("High heat retention plus high heat transfer cap creates stubborn hotspots and repeat ignitions.");
  }

  if (profile.windFactor > 1 && profile.spreadBoost <= 0.75) {
    notes.push("Wind factor is very high, but spread boost is low, so wind will steer the fire more than it accelerates it.");
  } else if (profile.windFactor > 1) {
    notes.push("Wind factor above 1 exaggerates downwind bias and can starve upwind spread.");
  }

  return notes;
};

const buildFuelInputTooltip = (
  type: TileType,
  key: keyof FuelProfile,
  profile: FuelProfile,
  heatCap: number
): string => {
  const currentValue = profile[key];
  const defaultValue = FUEL_PROFILES[type][key];
  const relationshipNotes = collectFuelProfileRelationshipNotes(profile, heatCap);
  const lines = [
    `${formatTileTypeLabel(type)} - ${getFuelFieldLabel(key)}`,
    `Current ${currentValue.toFixed(2)} | Default ${defaultValue.toFixed(2)}`,
    "",
    buildFuelFieldTooltip(key, heatCap)
  ];
  if (relationshipNotes.length > 0) {
    lines.push("", "Current profile notes:");
    relationshipNotes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n");
};

const buildFuelTypeTooltip = (type: TileType, profile: FuelProfile, heatCap: number): string => {
  const notes = collectFuelProfileRelationshipNotes(profile, heatCap);
  const lines = [
    `${formatTileTypeLabel(type)} defaults`,
    "These values are copied into each tile of this type, then moisture and local fuel variance adjust the live sim values."
  ];
  if (notes.length > 0) {
    lines.push("", "Current profile notes:");
    notes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n");
};

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

const cloneRunOptions = (options: RunOptions): RunOptions => ({
  ...DEFAULT_RUN_OPTIONS,
  ...options,
  mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen, ...options.mapGen },
  fire: normalizeFireSettings(options.fire),
  fuelProfiles: { ...(options.fuelProfiles ?? {}) }
});

const cloneRunConfig = (config: NewRunConfig): NewRunConfig => ({
  seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
  mapSize: config.mapSize,
  characterId: config.characterId,
  callsign: config.callsign,
  options: cloneRunOptions(config.options)
});

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
  onConfirm: (config: NewRunConfig) => void | Promise<void>,
  initialConfig?: NewRunConfig
): { open: (config: NewRunConfig) => void; getCurrentConfig: () => NewRunConfig } {
  const defaultConfig: NewRunConfig = cloneRunConfig(
    initialConfig ?? {
      seed: DEFAULT_RUN_SEED,
      mapSize: DEFAULT_MAP_SIZE,
      options: {
        ...DEFAULT_RUN_OPTIONS,
        mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen },
        fire: { ...DEFAULT_RUN_OPTIONS.fire },
        fuelProfiles: { ...loadFuelProfileOverrides() }
      },
      characterId: state.campaign.characterId,
      callsign: state.campaign.callsign
    }
  );
  let selectedId: CharacterId = defaultConfig.characterId;
  let fuelProfileOverrides = { ...defaultConfig.options.fuelProfiles };
  let fuelProfiles = buildFuelProfiles(fuelProfileOverrides);
  const fuelProfileInputs: HTMLInputElement[] = [];
  const fuelProfileHeaderCells = new Map<keyof FuelProfile, HTMLDivElement>();
  const fuelProfileTypeCells = new Map<TileType, HTMLDivElement>();
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
    const headerLabels = ["Tile", ...FUEL_PROFILE_FIELDS.map((field) => field.label)];
    headerLabels.forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "fuel-grid-cell fuel-grid-head";
      cell.textContent = label;
      if (label === "Tile") {
        cell.title = "Tile type these fire-tuning values apply to.";
      } else {
        const field = FUEL_PROFILE_FIELDS.find((entry) => entry.label === label);
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
      label.textContent = formatTileTypeLabel(type);
      typeCell.appendChild(swatch);
      typeCell.appendChild(label);
      fuelProfileTypeCells.set(type, typeCell);
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
    mapGen: getMapGenSettings(),
    fire: getFireSettings(),
    fuelProfiles: fuelProfileOverrides
  });

  const applyConfigToForm = (config: NewRunConfig, fillMissingCallsign: boolean): void => {
    const nextConfig = cloneRunConfig(config);
    selectedId = nextConfig.characterId;
    state.campaign.characterId = selectedId;
    state.campaign.callsign = nextConfig.callsign;
    ui.characterNameInput.value = nextConfig.callsign;
    ui.runSeedInput.value = coerceSeed(`${nextConfig.seed}`).toString();
    setSelectedMapSize(nextConfig.mapSize);
    ui.runUnlimitedMoney.checked = nextConfig.options.unlimitedMoney;
    applyMapGenSettings(nextConfig.options.mapGen);
    applyFireSettings(nextConfig.options.fire);
    applyFuelProfileOverrides(nextConfig.options.fuelProfiles ?? {});
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
  ui.fireInputs.forEach((input) => {
    input.addEventListener("input", syncFuelProfileTooltips);
  });
  buildFuelProfileGrid();
  syncFuelProfileTooltips();
  applyConfigToForm(defaultConfig, false);

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
    applyConfigToForm(config, true);
    ui.characterScreen.classList.remove("hidden");
  };

  return { open, getCurrentConfig };
}
