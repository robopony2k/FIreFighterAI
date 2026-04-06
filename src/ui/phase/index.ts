import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import {
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  SCORE_EXTINGUISHED_TILE_POINTS,
  SCORE_HOUSE_LOSS_PENALTY,
  SCORE_LIFE_LOSS_PENALTY,
  TRUCK_CAPACITY
} from "../../core/config.js";
import { getCommandRewardDefinition, getCommandRewardDefinitions } from "../../config/progression/rewardCatalog.js";
import { formatCurrency } from "../../core/utils.js";
import { getPhaseInfo } from "../../core/time.js";
import type { SelectedEntity } from "./types.js";
import type { Formation } from "../../core/types.js";
import type { CrewPanelData } from "./components/MaintenanceCrewPanel.js";
import type { BudgetReportData } from "./components/BudgetReportView.js";
import type { ProgressionDraftPanelData } from "./components/ProgressionDraftPanel.js";
import { GameState } from "./gameState.js";
import { UIController } from "./uiController.js";
import { getProgressionLevelFloor, getProgressionNextLevelThreshold, getProgressionProgress01 } from "../../systems/progression/index.js";
import { getFirebreakCostForState, getTrainingCostForState } from "../../sim/units.js";

export type PhaseUiApi = {
  sync: (world: WorldState, inputState: InputState) => void;
  state: GameState;
  controller: UIController;
};

const buildBudgetReportData = (world: WorldState): BudgetReportData => {
  const summary = world.scoring.seasonSummary;
  const extinguishedCount = summary ? summary.extinguishedCount : world.scoring.seasonExtinguishedCount;
  const extinguishPoints = summary ? summary.extinguishPoints : world.scoring.seasonExtinguishPoints;
  const propertyDamageCount = summary ? summary.propertyDamageCount : world.scoring.seasonPropertyDamageCount;
  const propertyDamagePenalties = summary ? summary.propertyDamagePenalties : world.scoring.seasonPropertyDamagePenalties;
  const destroyedHouseCount = summary ? summary.destroyedHouseCount : world.scoring.seasonDestroyedHouseCount;
  const criticalAssetLossCount = summary ? summary.criticalAssetLossCount : world.scoring.seasonCriticalAssetLossCount;
  const houseLossPenalties = summary ? summary.houseLossPenalties : world.scoring.seasonHouseLossPenalties;
  const criticalAssetLossPenalties = summary
    ? summary.criticalAssetLossPenalties
    : world.scoring.seasonCriticalAssetLossPenalties;
  const livesLostCount = summary ? summary.livesLostCount : world.scoring.seasonLivesLostCount;
  const civilianLivesLost = summary ? summary.civilianLivesLost : world.scoring.seasonCivilianLivesLost;
  const firefighterLivesLost = summary ? summary.firefighterLivesLost : world.scoring.seasonFirefighterLivesLost;
  const lifeLossPenalties = summary ? summary.lifeLossPenalties : world.scoring.seasonLifeLossPenalties;
  const civilianLifeLossPenalties = summary
    ? summary.civilianLifeLossPenalties
    : world.scoring.seasonCivilianLifeLossPenalties;
  const firefighterLifeLossPenalties = summary
    ? summary.firefighterLifeLossPenalties
    : world.scoring.seasonFirefighterLifeLossPenalties;
  const seasonStartScore = summary ? summary.seasonStartScore : world.scoring.seasonStartScore;
  const seasonFinalScore = summary ? summary.seasonFinalScore : world.scoring.score;
  const seasonDeltaScore = summary ? summary.seasonDeltaScore : seasonFinalScore - seasonStartScore;
  const averageApprovalMult = summary ? summary.averageApprovalMult : world.scoring.approvalMult;
  const averageRiskMult = summary ? summary.averageRiskMult : world.scoring.riskMult;
  const finalDifficultyMult = summary ? summary.finalDifficultyMult : world.scoring.difficultyMult;
  const finalApprovalMult = summary ? summary.finalApprovalMult : world.scoring.approvalMult;
  const finalStreakMult = summary ? summary.finalStreakMult : world.scoring.streakMult;
  const finalRiskMult = summary ? summary.finalRiskMult : world.scoring.riskMult;
  const finalTotalMult = summary ? summary.finalTotalMult : world.scoring.totalMult;
  const finalApprovalTier = summary ? summary.finalApprovalTier : world.scoring.approvalTier;
  const finalRiskTier = summary ? summary.finalRiskTier : world.scoring.riskTier;
  const positiveBasePoints = summary ? summary.positiveBasePoints : world.scoring.seasonExtinguishPoints;
  const multipliedPositivePoints = summary
    ? summary.multipliedPositivePoints
    : world.scoring.seasonMultipliedPositivePoints;
  const reportYear = world.annualReportOpen && world.phase === "maintenance" ? Math.max(1, world.year - 1) : world.year;

  return {
    summary: `Year ${reportYear} ledger: extinguish gains, losses, multiplier, and carry-over.`,
    continueLabel: world.annualReportOpen ? "Begin Winter Prep" : "Continue",
    multiplierPills: [
      {
        id: "difficulty",
        label: "DIFF",
        value: `x${finalDifficultyMult.toFixed(2)}`
      },
      {
        id: "approval",
        label: `APP ${finalApprovalTier}`,
        value: `x${finalApprovalMult.toFixed(2)}`
      },
      {
        id: "streak",
        label: "STREAK",
        value: `x${finalStreakMult.toFixed(2)}`
      },
      {
        id: "risk",
        label: `RISK ${finalRiskTier.toUpperCase()}`,
        value: `x${finalRiskMult.toFixed(2)}`
      },
      {
        id: "total",
        label: "TOTAL",
        value: `x${finalTotalMult.toFixed(2)}`,
        tone: "positive"
      }
    ],
    rails: [
      {
        id: "extinguished",
        label: "Extinguished",
        count: extinguishedCount,
        formula: `${extinguishedCount.toLocaleString()} x ${SCORE_EXTINGUISHED_TILE_POINTS.toLocaleString()} pts`,
        points: extinguishPoints,
        tone: "positive"
      },
      {
        id: "property",
        label: "Property Damage",
        count: propertyDamageCount,
        formula: `${propertyDamageCount.toLocaleString()} structures impacted`,
        points: -propertyDamagePenalties,
        tone: "negative"
      },
      {
        id: "lives",
        label: "Lives Lost",
        count: livesLostCount,
        formula: `${livesLostCount.toLocaleString()} lives lost`,
        points: -lifeLossPenalties,
        tone: "negative"
      }
    ],
    propertyDetails: [
      {
        id: "houses",
        label: "Houses",
        count: destroyedHouseCount,
        points: -houseLossPenalties,
        detail: `${destroyedHouseCount.toLocaleString()} x ${SCORE_HOUSE_LOSS_PENALTY.toLocaleString()}`,
        tone: houseLossPenalties > 0 ? "negative" : "neutral"
      },
      {
        id: "assets",
        label: "Critical Assets",
        count: criticalAssetLossCount,
        points: -criticalAssetLossPenalties,
        detail:
          criticalAssetLossCount > 0
            ? `${criticalAssetLossCount.toLocaleString()} x tracked penalty`
            : "No asset-loss producer configured in this pass.",
        tone: criticalAssetLossPenalties > 0 ? "negative" : "neutral"
      }
    ],
    lifeDetails: [
      {
        id: "civilians",
        label: "Civilians",
        count: civilianLivesLost,
        points: -civilianLifeLossPenalties,
        detail: `${civilianLivesLost.toLocaleString()} x ${SCORE_LIFE_LOSS_PENALTY.toLocaleString()}`,
        tone: civilianLifeLossPenalties > 0 ? "negative" : "neutral"
      },
      {
        id: "firefighters",
        label: "Firefighters",
        count: firefighterLivesLost,
        points: -firefighterLifeLossPenalties,
        detail: `${firefighterLivesLost.toLocaleString()} x ${SCORE_LIFE_LOSS_PENALTY.toLocaleString()}`,
        tone: firefighterLifeLossPenalties > 0 ? "negative" : "neutral"
      }
    ],
    stageTotals: [
      {
        id: "positive-base",
        label: "Base Positives",
        value: positiveBasePoints,
        detail: `${extinguishedCount.toLocaleString()} extinguished tiles`,
        format: "points",
        tone: "positive"
      },
      {
        id: "multiplied-positive",
        label: "After Multiplier",
        value: multipliedPositivePoints,
        detail: `${Math.round(positiveBasePoints).toLocaleString()} x ${finalTotalMult.toFixed(2)}x | avg A/R ${averageApprovalMult.toFixed(
          2
        )}/${averageRiskMult.toFixed(2)}`,
        format: "points",
        tone: "positive"
      },
      {
        id: "property-loss",
        label: "Property Damage",
        value: -propertyDamagePenalties,
        detail: `${propertyDamageCount.toLocaleString()} structure losses`,
        format: "signed_points",
        tone: propertyDamagePenalties > 0 ? "negative" : "neutral"
      },
      {
        id: "life-loss",
        label: "Lives Lost",
        value: -lifeLossPenalties,
        detail: `${livesLostCount.toLocaleString()} life losses`,
        format: "signed_points",
        tone: lifeLossPenalties > 0 ? "negative" : "neutral"
      },
      {
        id: "annual-score",
        label: "Annual Score",
        value: seasonDeltaScore,
        detail: `${Math.round(multipliedPositivePoints).toLocaleString()} - ${Math.round(propertyDamagePenalties).toLocaleString()} - ${Math.round(
          lifeLossPenalties
        ).toLocaleString()}`,
        format: "signed_points",
        tone: seasonDeltaScore >= 0 ? "positive" : "negative"
      },
      {
        id: "carry-in",
        label: "Carry In",
        value: seasonStartScore,
        detail: "Career score entering fire season",
        format: "points"
      },
      {
        id: "carry-out",
        label: "Carry Out",
        value: seasonFinalScore,
        detail: "Career score after annual ledger closes",
        format: "points"
      }
    ]
  };
};

const getSelection = (world: WorldState): SelectedEntity => {
  if (world.selectedUnitIds.length !== 1) {
    return { kind: "none" };
  }
  const selected = world.units.find((unit) => unit.id === world.selectedUnitIds[0]) ?? null;
  if (!selected) {
    return { kind: "none" };
  }
  let crewFormation: Formation | null = null;
  if (selected.kind === "truck" && selected.crewIds.length > 0) {
    const crewMember = world.units.find((u) => u.id === selected.crewIds[0]);
    if (crewMember) {
      crewFormation = crewMember.formation;
    }
  }
  return {
    kind: "unit",
    id: selected.id,
    unitType: selected.kind,
    crewFormation
  };
};

const getInteractionMode = (world: WorldState, inputState: InputState) => {
  if (world.deployMode === "clear") {
    return "fuelBreak";
  }
  if (world.deployMode === "firefighter" || world.deployMode === "truck") {
    return "deploy";
  }
  if (inputState.formationStart) {
    return "formation";
  }
  return "default";
};

const toRewardChipLabel = (icon: string): string => icon.slice(0, 3).toUpperCase();
const formatRewardCategory = (category: string): string => `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;

const buildProgressionPanelData = (world: WorldState): ProgressionDraftPanelData => {
  const level = world.progression.level;
  const nextThreshold = getProgressionNextLevelThreshold(level);
  const progress01 = getProgressionProgress01(level, world.progression.totalAssistedExtinguishes);
  const activeDraft = world.progression.activeDraft;
  const draftLevel = activeDraft?.level ?? level;
  return {
    active: activeDraft !== null,
    title: activeDraft ? `Command Upgrade L${draftLevel}` : `Command Upgrade L${level}`,
    summary: activeDraft
      ? `Level ${draftLevel} reward ready. Pick while the run continues.`
      : nextThreshold !== null
        ? `Next command upgrade unlocks at ${nextThreshold} assisted extinguishes.`
        : "All authored command upgrades unlocked.",
    progressText:
      nextThreshold !== null
        ? `${world.progression.totalAssistedExtinguishes}/${nextThreshold} assisted extinguishes`
        : `${world.progression.totalAssistedExtinguishes} assisted extinguishes total`,
    progress01,
    queuedCount: world.progression.queuedDraftOrdinals.length,
    options: activeDraft
      ? activeDraft.options.map((rewardId) => {
          const definition = getCommandRewardDefinition(rewardId);
          return {
            id: rewardId,
            name: definition.name,
            description: definition.description,
            icon: definition.icon,
            category: definition.category,
            categoryLabel: formatRewardCategory(definition.category),
            rarity: definition.rarity,
            stacks: Math.max(0, Math.floor(world.progression.rewardStacks[rewardId] ?? 0)),
            maxStacks: definition.maxStacks
          };
        })
      : []
  };
};

export const initPhaseUI = (container: HTMLElement): PhaseUiApi => {
  const state = new GameState();
  const root = document.createElement("div");
  root.className = "phase-ui";
  container.appendChild(root);
  const controller = new UIController(root, state);

  const sync = (world: WorldState, inputState: InputState) => {
    const isThreeTest = container.classList.contains("phase-ui-root--three-test");
    const phaseInfo = getPhaseInfo(world.phaseIndex);
    const progress = phaseInfo.duration > 0 ? world.phaseDay / phaseInfo.duration : 0;
    state.setPhase(world.phase);
    state.setPhaseProgress(progress);
    state.setAnnualReportOpen(world.annualReportOpen);
    state.setSelection(getSelection(world));
    state.setInteractionMode(getInteractionMode(world, inputState));
    state.setPaused(world.paused);
    state.setSimTimeMode(world.simTimeMode);
    state.setTimeSpeedIndex(world.timeSpeedIndex);
    state.setSkipToNextFireState(
      !!world.skipToNextFire,
      !world.gameOver && world.simTimeMode === "strategic" && world.lastActiveFires <= 0 && !world.skipToNextFire
    );
    state.setAlert(world.statusMessage && world.statusMessage !== "Ready." ? world.statusMessage : null);
    const windStrength = Math.round(world.wind.strength * 10);
    const windLabel = windStrength > 0 ? `Wind ${world.wind.name} ${windStrength}` : "Wind Calm";
    const tempLabel = Number.isFinite(world.climateTemp) ? `${Math.round(world.climateTemp)}C` : "n/a";
    const approvalPct = Math.round(Math.max(0, Math.min(1, world.approval)) * 100);
    const totalHouses = Number.isFinite(world.totalHouses) ? Math.max(0, Math.floor(world.totalHouses)) : 0;
    const destroyedHouses = Number.isFinite(world.destroyedHouses) ? Math.max(0, Math.floor(world.destroyedHouses)) : 0;
    const houseCount = Math.max(0, totalHouses - destroyedHouses);
    const forecastMeta = `Year ${world.year} | ${tempLabel} | ${windLabel} | Approval ${approvalPct}% | Houses ${houseCount}`;
    state.setForecast(
      world.climateForecast ?? null,
      world.climateForecastDay ?? 0,
      Math.max(0, world.climateForecastStart ?? 0),
      world.climateTimeline?.daysPerYear ?? 360,
      forecastMeta
    );
    const progressionLevel = world.progression.level;
    const nextProgressionThreshold = getProgressionNextLevelThreshold(progressionLevel);
    state.setProgression({
      level: progressionLevel,
      totalAssistedExtinguishes: world.progression.totalAssistedExtinguishes,
      currentThreshold: getProgressionLevelFloor(progressionLevel),
      nextThreshold: nextProgressionThreshold,
      progress01: getProgressionProgress01(progressionLevel, world.progression.totalAssistedExtinguishes),
      queuedDraftCount: world.progression.queuedDraftOrdinals.length,
      hasActiveDraft: world.progression.activeDraft !== null,
      ownedRewards: getCommandRewardDefinitions()
        .map((definition) => ({
          id: definition.id,
          label: toRewardChipLabel(definition.icon),
          name: definition.name,
          stacks: Math.max(0, Math.floor(world.progression.rewardStacks[definition.id] ?? 0))
        }))
        .filter((entry) => entry.stacks > 0)
    });
    state.setScoring({
      score: world.scoring.score,
      difficultyMult: world.scoring.difficultyMult,
      approvalMult: world.scoring.approvalMult,
      streakMult: world.scoring.streakMult,
      riskMult: world.scoring.riskMult,
      totalMult: world.scoring.totalMult,
      noHouseLossDays: world.scoring.noHouseLossDays,
      noLifeLossDays: world.scoring.noLifeLossDays,
      approvalTier: world.scoring.approvalTier,
      riskTier: world.scoring.riskTier,
      nextApprovalTier: world.scoring.nextApprovalTier,
      nextApprovalThreshold01: world.scoring.nextApprovalThreshold01,
      nextTierProgress01: world.scoring.nextTierProgress01,
      activeFireCount: world.lastActiveFires,
      extinguishedCount: world.scoring.seasonExtinguishedCount,
      propertyDamageCount: world.scoring.seasonPropertyDamageCount,
      livesLostCount: world.scoring.seasonLivesLostCount,
      events: world.scoring.events.map((event) => ({
        id: event.id,
        lane: event.lane,
        deltaCount: event.deltaCount,
        deltaPoints: event.deltaPoints,
        severity: event.severity,
        remainingSeconds: event.remainingSeconds,
        detail: event.detail
      })),
      flowEvents: world.scoring.flowEvents.map((event) => ({
        id: event.id,
        kind: event.kind,
        deltaCount: event.deltaCount,
        remainingSeconds: event.remainingSeconds,
        tileX: event.tileX,
        tileY: event.tileY
      }))
    });
    const budgetReportData = buildBudgetReportData(world);
    controller.setPanelData("progressionDraft", buildProgressionPanelData(world));
    if (isThreeTest) {
      controller.setPanelData("budgetReport", budgetReportData);
      return;
    }
    controller.setPanelData("miniMap", { world });

    const rosterFirefighters = world.roster.filter((unit) => unit.kind === "firefighter");
    const rosterList = world.roster.map((entry) => {
      let assignmentLabel = "";
      if (entry.kind === "firefighter") {
        const truck = entry.assignedTruckId
          ? world.roster.find((unit) => unit.id === entry.assignedTruckId) ?? null
          : null;
        assignmentLabel = truck ? `Crew ${truck.name}` : "Crew Unassigned";
      } else {
        assignmentLabel = `Crew ${entry.crewIds.length}/${TRUCK_CAPACITY}`;
      }
      return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        status: entry.status,
        assignment: assignmentLabel,
        training: { ...entry.training }
      };
    });
    const totalFirefighters = rosterFirefighters.length;
    const totalTrucks = world.roster.filter((unit) => unit.kind === "truck").length;
    const availableFirefighters = rosterFirefighters.filter((unit) => unit.status === "available").length;
    const availableTrucks = world.roster.filter((unit) => unit.kind === "truck" && unit.status === "available").length;
    const selectedRoster =
      world.selectedRosterId !== null
        ? world.roster.find((unit) => unit.id === world.selectedRosterId) ?? null
        : null;
    const canTrain = world.phase === "maintenance" && selectedRoster !== null && selectedRoster.status !== "lost";

    controller.setPanelData("maintenanceRoster", {
      totalFirefighters,
      availableFirefighters,
      totalTrucks,
      availableTrucks,
      roster: rosterList,
      selectedId: world.selectedRosterId ?? null,
      recruitFirefighterCost: formatCurrency(RECRUIT_FIREFIGHTER_COST),
      recruitTruckCost: formatCurrency(RECRUIT_TRUCK_COST),
      trainingCost: formatCurrency(getTrainingCostForState(world)),
      canTrain
    });

    const crewPlanTrucks = world.roster.filter((unit) => unit.kind === "truck" && unit.status !== "lost");
    const crewPanelData: CrewPanelData = {
      summary: `Trucks ready: ${crewPlanTrucks.length}. Crew plan is locked in before fire season.`,
      hint:
        crewPlanTrucks.length > 0
          ? "Select a firefighter in the roster, then choose a truck and click Assign."
          : "Recruit a truck to assign crews.",
      selectionLabel: "No roster selected.",
      trucks: crewPlanTrucks.map((truck) => ({
        id: truck.id,
        name: truck.name,
        crewCount: truck.crewIds.length,
        capacity: TRUCK_CAPACITY,
        disabled: false
      })),
      selectedTruckId: null,
      selectedRosterId: selectedRoster ? selectedRoster.id : null,
      selectEnabled: false,
      assignEnabled: false,
      unassignEnabled: false,
      showAssignControls: false,
      crewList: [] as string[]
    };

    if (selectedRoster && world.phase === "maintenance") {
      if (selectedRoster.kind === "firefighter") {
        const assignedTruck = selectedRoster.assignedTruckId
          ? world.roster.find((unit) => unit.id === selectedRoster.assignedTruckId) ?? null
          : null;
        if (assignedTruck) {
          crewPanelData.hint = `Assigned to ${assignedTruck.name}. Choose a different truck to reassign.`;
        } else {
          crewPanelData.hint =
            crewPlanTrucks.length > 0 ? "Choose a truck below and click Assign." : "No trucks available. Recruit a truck to assign crews.";
        }
        crewPanelData.selectionLabel = `${selectedRoster.name} - Firefighter`;
        crewPanelData.selectedTruckId = assignedTruck ? assignedTruck.id : null;
        crewPanelData.selectEnabled = selectedRoster.status !== "lost" && crewPlanTrucks.length > 0;
        crewPanelData.assignEnabled = selectedRoster.status !== "lost" && crewPlanTrucks.length > 0;
        crewPanelData.unassignEnabled = selectedRoster.status !== "lost" && selectedRoster.assignedTruckId !== null;
        crewPanelData.showAssignControls = true;
        crewPanelData.trucks = crewPlanTrucks.map((truck) => ({
          id: truck.id,
          name: truck.name,
          crewCount: truck.crewIds.length,
          capacity: TRUCK_CAPACITY,
          disabled: truck.crewIds.length >= TRUCK_CAPACITY && truck.id !== selectedRoster.assignedTruckId
        }));
        if (assignedTruck) {
          crewPanelData.crewList = assignedTruck.crewIds
            .map((id) => world.roster.find((unit) => unit.id === id)?.name ?? "")
            .filter((name) => name);
        }
      } else {
        crewPanelData.hint = "Truck selected. Assigned crew listed below. Select a firefighter in the roster to assign them to a truck.";
        crewPanelData.selectionLabel = `${selectedRoster.name} - Truck`;
        crewPanelData.selectedTruckId = selectedRoster.id;
        crewPanelData.crewList = selectedRoster.crewIds
          .map((id) => world.roster.find((unit) => unit.id === id)?.name ?? "")
          .filter((name) => name);
      }
    }

    controller.setPanelData("maintenanceCrew", crewPanelData);

    controller.setPanelData("fuelBreak", {
      active: world.deployMode === "clear",
      costPerTile: formatCurrency(getFirebreakCostForState(world)),
      toolLabel: "Drag to carve a fire break"
    });

    const deployedTruckRosterIds = new Set(
      world.units.filter((unit) => unit.kind === "truck" && unit.rosterId !== null).map((unit) => unit.rosterId as number)
    );
    const deployableFirefighters = world.roster.filter(
      (unit) =>
        unit.kind === "firefighter" &&
        unit.status === "available" &&
        unit.assignedTruckId !== null &&
        deployedTruckRosterIds.has(unit.assignedTruckId)
    ).length;
    const truckSlots = world.units
      .filter((unit) => unit.kind === "truck")
      .sort((a, b) => (a.rosterId ?? a.id) - (b.rosterId ?? b.id))
      .slice(0, 10)
      .map((truck, index) => {
        const rosterName = truck.rosterId
          ? world.roster.find((entry) => entry.id === truck.rosterId)?.name ?? null
          : null;
        const hotkey = index === 9 ? "0" : String(index + 1);
        return {
          id: truck.id,
          name: rosterName ?? `Truck ${index + 1}`,
          crewCount: truck.crewIds.length,
          crewCapacity: TRUCK_CAPACITY,
          crewMode: truck.crewMode,
          hotkey,
          selected: world.selectedUnitIds.includes(truck.id)
        };
      });
    controller.setPanelData("fireDeploy", {
      trucks: truckSlots,
      deployableFirefighters,
      availableTrucks,
      activeMode: world.deployMode === "firefighter" ? "firefighter" : world.deployMode === "truck" ? "truck" : null
    });

    const unitGroups = [
      {
        label: "Trucks",
        units: world.units
          .filter((unit) => unit.kind === "truck")
          .map((unit) => ({
            name: world.roster.find((entry) => entry.id === unit.rosterId)?.name ?? `Truck ${unit.id}`,
            status: unit.target && unit.pathIndex < unit.path.length ? "Moving" : "Holding"
          }))
      },
      {
        label: "Firefighters",
        units: world.units
          .filter((unit) => unit.kind === "firefighter")
          .map((unit) => ({
            name: world.roster.find((entry) => entry.id === unit.rosterId)?.name ?? `Crew ${unit.id}`,
            status: unit.carrierId ? "On board" : unit.target && unit.pathIndex < unit.path.length ? "Moving" : "Patrolling"
          }))
      }
    ];
    controller.setPanelData("fireUnitList", { groups: unitGroups });

    controller.setPanelData("budgetReport", budgetReportData);
  };

  return {
    sync,
    state,
    controller
  };
};
