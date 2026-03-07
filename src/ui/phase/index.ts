import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import {
  FIREBREAK_COST_PER_TILE,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  SCORE_BURNOUT_POINTS_PER_FUEL,
  SCORE_HOUSE_LOSS_PENALTY,
  SCORE_LIFE_LOSS_PENALTY,
  SCORE_SQUIRT_BONUS_RATE,
  TRAINING_COST,
  TRUCK_CAPACITY
} from "../../core/config.js";
import { formatCurrency } from "../../core/utils.js";
import { getPhaseInfo } from "../../core/time.js";
import { getCharacterFirebreakCost } from "../../core/characters.js";
import type { SelectedEntity } from "./types.js";
import type { Formation } from "../../core/types.js";
import type { CrewPanelData } from "./components/MaintenanceCrewPanel.js";
import type { BudgetReportData } from "./components/BudgetReportView.js";
import { GameState } from "./gameState.js";
import { UIController } from "./uiController.js";

export type PhaseUiApi = {
  sync: (world: WorldState, inputState: InputState) => void;
  state: GameState;
  controller: UIController;
};

const buildBudgetReportData = (world: WorldState): BudgetReportData => {
  const summary = world.scoring.seasonSummary;
  const burnoutPoints = summary ? summary.burnoutPoints : world.scoring.seasonBurnoutPoints;
  const squirtBonusPoints = summary ? summary.squirtBonusPoints : world.scoring.seasonSquirtBonusPoints;
  const otherPositivePoints = summary ? summary.otherPositivePoints : world.scoring.seasonOtherPositivePoints;
  const houseLossPenalties = summary ? summary.houseLossPenalties : world.scoring.seasonHouseLossPenalties;
  const civilianLifeLossPenalties = summary
    ? summary.civilianLifeLossPenalties
    : world.scoring.seasonCivilianLifeLossPenalties;
  const firefighterLifeLossPenalties = summary
    ? summary.firefighterLifeLossPenalties
    : world.scoring.seasonFirefighterLifeLossPenalties;
  const criticalAssetLossPenalties = summary
    ? summary.criticalAssetLossPenalties
    : world.scoring.seasonCriticalAssetLossPenalties;
  const totalLossPenalties =
    houseLossPenalties + civilianLifeLossPenalties + firefighterLifeLossPenalties + criticalAssetLossPenalties;
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
  const houseDays = summary ? summary.finalNoHouseLossDays : world.scoring.noHouseLossDays;
  const lifeDays = summary ? summary.finalNoLifeLossDays : world.scoring.noLifeLossDays;
  const housesLostUnits = SCORE_HOUSE_LOSS_PENALTY > 0 ? Math.round(houseLossPenalties / SCORE_HOUSE_LOSS_PENALTY) : 0;
  const civilianLossUnits =
    SCORE_LIFE_LOSS_PENALTY > 0 ? Math.round(civilianLifeLossPenalties / SCORE_LIFE_LOSS_PENALTY) : 0;
  const firefighterLossUnits =
    SCORE_LIFE_LOSS_PENALTY > 0 ? Math.round(firefighterLifeLossPenalties / SCORE_LIFE_LOSS_PENALTY) : 0;
  const burnoutFuelUnits =
    SCORE_BURNOUT_POINTS_PER_FUEL > 0 ? burnoutPoints / SCORE_BURNOUT_POINTS_PER_FUEL : 0;
  const activeUnits = world.units.length;
  const rosterFirefighters = world.roster.filter((entry) => entry.kind === "firefighter" && entry.status !== "lost").length;
  const rosterTrucks = world.roster.filter((entry) => entry.kind === "truck" && entry.status !== "lost").length;
  const baseScore = burnoutPoints + squirtBonusPoints + otherPositivePoints;
  const multiplierSum = finalDifficultyMult + finalApprovalMult + finalStreakMult + finalRiskMult;
  const annualScore = seasonDeltaScore;
  const nettScore = annualScore + totalLossPenalties;
  const computedMultiplier = Math.abs(baseScore) > 0.0001 ? nettScore / baseScore : finalTotalMult;
  const multiplierUsed = Number.isFinite(computedMultiplier) ? computedMultiplier : finalTotalMult;
  const previousYearScore = seasonStartScore;
  const currentYearsScore = seasonFinalScore;
  const balanceScore = currentYearsScore - previousYearScore;

  return {
    summary: `Year ${world.year} review: score sources, penalties, and carryover.`,
    continueLabel: "Continue",
    sections: [
      {
        title: "Base Score",
        rows: [
          {
            id: "burnout-points",
            label: "Burnout points",
            value: burnoutPoints,
            format: "signed_points",
            detail: `${burnoutFuelUnits.toFixed(1)} fuel x ${SCORE_BURNOUT_POINTS_PER_FUEL} pts`,
            tone: "positive"
          },
          {
            id: "squirt-bonus",
            label: "Squirt bonus",
            value: squirtBonusPoints,
            format: "signed_points",
            detail: `${(SCORE_SQUIRT_BONUS_RATE * 100).toFixed(0)}% assist on suppressed tiles`,
            tone: "positive"
          },
          {
            id: "other-positive",
            label: "Other positives",
            value: otherPositivePoints,
            format: "signed_points",
            detail: `Units ${activeUnits} | roster ${rosterFirefighters + rosterTrucks}`,
            tone: otherPositivePoints >= 0 ? "positive" : "negative"
          },
          {
            id: "net-base",
            label: "Base score",
            value: baseScore,
            format: "signed_points",
            detail: "Burnout + squirt + other",
            tone: baseScore >= 0 ? "positive" : "negative"
          }
        ]
      },
      {
        title: "Multiplier",
        rows: [
          {
            id: "mult-total",
            label: "Total multiplier",
            value: multiplierUsed,
            format: "multiplier",
            detail: `D ${finalDifficultyMult.toFixed(2)} | A ${finalApprovalMult.toFixed(2)} | S ${finalStreakMult.toFixed(
              2
            )} | R ${finalRiskMult.toFixed(2)} | sum ${multiplierSum.toFixed(2)} | avg A/R ${averageApprovalMult.toFixed(
              2
            )}/${averageRiskMult.toFixed(2)} | ${finalApprovalTier}/${finalRiskTier} | streak ${houseDays}d/${lifeDays}d`
          }
        ]
      },
      {
        title: "NETT",
        rows: [
          {
            id: "nett-base-mult",
            label: "Net after multiplier",
            value: nettScore,
            format: "points",
            units: "pts",
            detail: `${Math.round(baseScore).toLocaleString()} x ${multiplierUsed.toFixed(2)}`,
            tone: nettScore >= 0 ? "positive" : "negative"
          }
        ]
      },
      {
        title: "Expenses",
        rows: [
          {
            id: "expense-house",
            label: "House loss penalties",
            value: -houseLossPenalties,
            format: "signed_points",
            detail: `${housesLostUnits} x ${SCORE_HOUSE_LOSS_PENALTY.toLocaleString()}`,
            tone: houseLossPenalties > 0 ? "negative" : "neutral"
          },
          {
            id: "expense-civilian",
            label: "Civilian life penalties",
            value: -civilianLifeLossPenalties,
            format: "signed_points",
            detail: `${civilianLossUnits} x ${SCORE_LIFE_LOSS_PENALTY.toLocaleString()}`,
            tone: civilianLifeLossPenalties > 0 ? "negative" : "neutral"
          },
          {
            id: "expense-firefighter",
            label: "Firefighter life penalties",
            value: -firefighterLifeLossPenalties,
            format: "signed_points",
            detail: `${firefighterLossUnits} x ${SCORE_LIFE_LOSS_PENALTY.toLocaleString()}`,
            tone: firefighterLifeLossPenalties > 0 ? "negative" : "neutral"
          },
          {
            id: "expense-assets",
            label: "Critical asset penalties",
            value: -criticalAssetLossPenalties,
            format: "signed_points",
            detail: "Usually 0 unless configured",
            tone: criticalAssetLossPenalties > 0 ? "negative" : "neutral"
          },
          {
            id: "expense-total",
            label: "Total expenses",
            value: -totalLossPenalties,
            format: "signed_points",
            detail: "All negative lines above",
            tone: totalLossPenalties > 0 ? "negative" : "neutral"
          }
        ]
      },
      {
        title: "Annual Score",
        rows: [
          {
            id: "annual-score",
            label: "Annual score",
            value: annualScore,
            format: "signed_points",
            detail: `${Math.round(nettScore).toLocaleString()} - ${Math.round(totalLossPenalties).toLocaleString()}`,
            tone: annualScore >= 0 ? "positive" : "negative"
          },
          {
            id: "annual-prev",
            label: "Previous year",
            value: previousYearScore,
            format: "points",
            units: "pts",
            detail: "Carry-in"
          },
          {
            id: "annual-current",
            label: "Current year",
            value: currentYearsScore,
            format: "points",
            units: "pts",
            detail: "Carry-out"
          },
          {
            id: "annual-balance",
            label: "Balance",
            value: balanceScore,
            format: "signed_points",
            detail: "Current - previous",
            tone: balanceScore >= 0 ? "positive" : "negative"
          }
        ]
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
    state.setSelection(getSelection(world));
    state.setInteractionMode(getInteractionMode(world, inputState));
    state.setPaused(world.paused);
    state.setTimeSpeedIndex(world.timeSpeedIndex);
    state.setSkipToNextFireState(
      !!world.skipToNextFire,
      !world.gameOver && world.lastActiveFires <= 0 && !world.skipToNextFire
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
      events: world.scoring.events.map((event) => ({
        id: event.id,
        message: event.message,
        severity: event.severity,
        remainingSeconds: event.remainingSeconds
      }))
    });
    const budgetReportData = buildBudgetReportData(world);
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
      trainingCost: formatCurrency(TRAINING_COST),
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
      costPerTile: formatCurrency(getCharacterFirebreakCost(world.campaign.characterId, FIREBREAK_COST_PER_TILE)),
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
