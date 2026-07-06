import type { WorldState } from "../../../core/state.js";
import { formatCurrency } from "../../../core/utils.js";
import {
  WATCH_TOWER_MAX_LEVEL,
  getWatchTowerLevelTuning
} from "../../../systems/fire/constants/fireDetectionConfig.js";
import { getWatchTowerForTown } from "../../../systems/fire/sim/fireDetection.js";
import type { TownFacilityDescriptor, TownFacilityRenderContext } from "./types.js";

export const getWatchTowerFacilityId = (townId: number): string => `watch-tower:${townId}`;

export const buildWatchTowerFacilityDescriptor = (world: WorldState, townId: number): TownFacilityDescriptor => {
  const tower = getWatchTowerForTown(world, townId);
  if (!tower) {
    const tuning = getWatchTowerLevelTuning(1);
    return {
      id: getWatchTowerFacilityId(townId),
      type: "watchTower",
      townId,
      name: "Watch Tower",
      icon: "WT",
      summary: `Not built - ${formatCurrency(tuning.buildCost)}`,
      warning: world.phase === "maintenance" ? null : "Maintenance only"
    };
  }
  const nextLevel = tower.level < WATCH_TOWER_MAX_LEVEL ? getWatchTowerLevelTuning((tower.level + 1) as 2 | 3) : null;
  return {
    id: getWatchTowerFacilityId(townId),
    type: "watchTower",
    townId,
    name: "Watch Tower",
    icon: "WT",
    summary: `Level ${tower.level} - radius ${Math.round(tower.detectionRadius)} - ${tower.active ? "active" : "inactive"}`,
    warning:
      tower.level >= WATCH_TOWER_MAX_LEVEL
        ? null
        : nextLevel && world.budget < nextLevel.upgradeCost
          ? `Need ${formatCurrency(nextLevel.upgradeCost)}`
          : null
  };
};

const bindActionButton = (
  button: HTMLButtonElement,
  dispatchAction: TownFacilityRenderContext["dispatchAction"],
  townId: number
): void => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled || !button.dataset.action) {
      return;
    }
    dispatchAction(button.dataset.action, { townId: String(townId) });
  });
};

const createActionButton = (label: string, action: string, cost: number): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "three-test-town-card-action three-test-hq-action";
  button.dataset.action = action;
  const labelSpan = document.createElement("span");
  labelSpan.className = "three-test-hq-action-label";
  labelSpan.textContent = label;
  const costSpan = document.createElement("span");
  costSpan.className = "three-test-hq-action-meta";
  costSpan.textContent = cost > 0 ? formatCurrency(cost) : "";
  button.append(labelSpan, costSpan);
  return button;
};

const getWatchTowerContentRenderKey = (context: TownFacilityRenderContext): string => {
  const tower = getWatchTowerForTown(context.world, context.town.id);
  return JSON.stringify({
    phase: context.world.phase,
    budget: Math.floor(context.world.budget),
    tower: tower
      ? {
          id: tower.id,
          level: tower.level,
          active: tower.active,
          radius: tower.detectionRadius,
          delay: tower.detectionDelayDays,
          accuracy: tower.accuracyRadius
        }
      : null
  });
};

export const renderWatchTowerFacilityContent = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const renderKey = getWatchTowerContentRenderKey(context);
  if (root.dataset.watchTowerRenderKey === renderKey && root.childElementCount > 0) {
    return;
  }
  root.dataset.watchTowerRenderKey = renderKey;
  root.replaceChildren();

  const tower = getWatchTowerForTown(context.world, context.town.id);
  const maintenanceOpen = context.world.phase === "maintenance";
  const budget = Math.max(0, Math.floor(context.world.budget));
  const stats = document.createElement("div");
  stats.className = "three-test-hq-recruit-summary";

  if (tower) {
    stats.append(
      Object.assign(document.createElement("span"), { textContent: `Level ${tower.level}` }),
      Object.assign(document.createElement("span"), { textContent: `Radius ${Math.round(tower.detectionRadius)}` }),
      Object.assign(document.createElement("span"), { textContent: `Delay ${tower.detectionDelayDays.toFixed(2)}d` }),
      Object.assign(document.createElement("span"), { textContent: `Accuracy ${Math.round(tower.accuracyRadius)}` })
    );
  } else {
    stats.append(
      Object.assign(document.createElement("span"), { textContent: "No tower built" }),
      Object.assign(document.createElement("span"), { textContent: `Budget ${formatCurrency(budget)}` })
    );
  }

  const grid = document.createElement("div");
  grid.className = "three-test-town-card-actions three-test-hq-action-grid";
  if (!tower) {
    const tuning = getWatchTowerLevelTuning(1);
    const buildButton = createActionButton("Build Tower", "watch-tower-build", tuning.buildCost);
    buildButton.disabled = !maintenanceOpen || budget < tuning.buildCost;
    buildButton.title = !maintenanceOpen
      ? "Only available during maintenance."
      : budget >= tuning.buildCost
        ? "Build a town watch tower."
        : `Need ${formatCurrency(tuning.buildCost)}.`;
    bindActionButton(buildButton, context.dispatchAction, context.town.id);
    grid.appendChild(buildButton);
  } else {
    const nextLevel = tower.level < WATCH_TOWER_MAX_LEVEL ? ((tower.level + 1) as 2 | 3) : null;
    const upgradeCost = nextLevel ? getWatchTowerLevelTuning(nextLevel).upgradeCost : 0;
    const upgradeButton = createActionButton(
      tower.level >= WATCH_TOWER_MAX_LEVEL ? "Max Level" : `Upgrade L${nextLevel}`,
      "watch-tower-upgrade",
      upgradeCost
    );
    upgradeButton.disabled = !maintenanceOpen || !nextLevel || budget < upgradeCost;
    upgradeButton.title = !maintenanceOpen
      ? "Only available during maintenance."
      : !nextLevel
        ? "Watch tower is fully upgraded."
        : budget >= upgradeCost
          ? "Improve detection range, delay, and accuracy."
          : `Need ${formatCurrency(upgradeCost)}.`;
    bindActionButton(upgradeButton, context.dispatchAction, context.town.id);
    grid.appendChild(upgradeButton);
  }

  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = maintenanceOpen
    ? "Detection affects player knowledge and alerts only."
    : "Watch tower work is locked outside maintenance.";
  root.append(stats, grid, hint);
};
