import { getPhaseRules } from "./uiRules.js";
import { TIME_SPEED_OPTIONS } from "../../core/config.js";
import { createBottomLeftControls } from "./components/BottomLeftControls.js";
import { createBudgetReportView } from "./components/BudgetReportView.js";
import { createFireDeployPanel } from "./components/FireDeployPanel.js";
import { createFireSelectedUnitPanel } from "./components/FireSelectedUnitPanel.js";
import { createFireUnitListPanel } from "./components/FireUnitListPanel.js";
import { createFuelBreakPanel } from "./components/FuelBreakPanel.js";
import { createMaintenanceCrewPanel } from "./components/MaintenanceCrewPanel.js";
import { createMaintenanceRosterPanel } from "./components/MaintenanceRosterPanel.js";
import { createTopBar } from "./components/TopBar.js";
const defaultPanelData = {
    maintenanceRoster: {
        totalFirefighters: 0,
        availableFirefighters: 0,
        totalTrucks: 0,
        availableTrucks: 0,
        roster: [],
        selectedId: null,
        recruitFirefighterCost: "--",
        recruitTruckCost: "--",
        trainingCost: "--",
        canTrain: false
    },
    maintenanceCrew: {
        summary: "Assign crews before fire season starts.",
        hint: "Select a firefighter in the roster, then choose a truck and click Assign.",
        selectionLabel: "No roster selected.",
        trucks: [],
        selectedTruckId: null,
        selectedRosterId: null,
        selectEnabled: false,
        assignEnabled: false,
        unassignEnabled: false,
        showAssignControls: false,
        crewList: []
    },
    fuelBreak: {
        active: false,
        costPerTile: "--",
        toolLabel: "Drag to carve a fire break"
    },
    fireDeploy: {
        trucks: [],
        baseOpsOpen: false,
        deployableFirefighters: 0,
        availableTrucks: 0,
        activeMode: null
    },
    fireUnitList: {
        groups: []
    },
    fireSelectedUnit: {
        selection: { kind: "none" }
    },
    budgetReport: {
        summary: "Summary to be populated from seasonal results.",
        approval: "--",
        losses: "--"
    }
};
export class UIController {
    constructor(root, state) {
        this.panels = new Map();
        this.panelData = {};
        this.topBar = createTopBar();
        this.bottomControls = createBottomLeftControls();
        this.maintenanceRoster = createMaintenanceRosterPanel();
        this.maintenanceCrew = createMaintenanceCrewPanel();
        this.fuelBreak = createFuelBreakPanel();
        this.fireDeploy = createFireDeployPanel();
        this.fireUnitList = createFireUnitListPanel();
        this.fireSelectedUnit = createFireSelectedUnitPanel();
        this.budgetReport = createBudgetReportView();
        this.state = state;
        this.root = root;
        this.buildLayout();
        this.topBar.onCta((actionId) => this.state.emitCta(actionId));
        this.state.on("change", (snapshot) => this.update(snapshot));
    }
    setPanelData(panel, data) {
        this.panelData[panel] = data;
        this.update(this.state.getSnapshot());
    }
    buildLayout() {
        const shell = document.createElement("div");
        shell.className = "phase-shell";
        const body = document.createElement("div");
        body.className = "phase-body";
        const left = document.createElement("div");
        left.className = "phase-column phase-column-left";
        const stack = document.createElement("div");
        stack.className = "phase-stack";
        stack.append(this.fireDeploy.element, this.fireSelectedUnit.element, this.fireUnitList.element, this.maintenanceRoster.element, this.maintenanceCrew.element, this.fuelBreak.element, this.budgetReport.element);
        left.append(stack);
        body.append(left);
        this.topBar.attachControls(this.bottomControls.element);
        shell.append(this.topBar.element, body);
        this.root.append(shell);
        [
            this.topBar.element,
            this.bottomControls.element,
            this.maintenanceRoster.element,
            this.maintenanceCrew.element,
            this.fuelBreak.element,
            this.fireDeploy.element,
            this.fireUnitList.element,
            this.fireSelectedUnit.element,
            this.budgetReport.element
        ].forEach((panel) => {
            const panelId = panel.dataset.panel;
            if (panelId) {
                this.panels.set(panelId, panel);
            }
        });
    }
    update(snapshot) {
        const rules = getPhaseRules(snapshot.phase, snapshot.interactionMode);
        this.root.classList.toggle("phase-ui--minimal", rules.minimalUi);
        const topBarData = {
            phase: rules.phase,
            alert: snapshot.alert,
            primaryCta: rules.primaryCta,
            forecast: snapshot.forecast,
            forecastDay: snapshot.forecastDay,
            forecastStartDay: snapshot.forecastStartDay,
            forecastYearDays: snapshot.forecastYearDays,
            forecastMeta: snapshot.forecastMeta
        };
        this.topBar.update(topBarData);
        const bottomStatus = snapshot.interactionMode === "fuelBreak"
            ? "Fuel break tool armed."
            : `Time speed ${TIME_SPEED_OPTIONS[snapshot.timeSpeedIndex]}x`;
        const bottomData = {
            showTimeControls: rules.allowedInputs.includes("timeControl"),
            showSpeedControl: true,
            paused: snapshot.paused,
            timeSpeedIndex: snapshot.timeSpeedIndex,
            status: bottomStatus
        };
        this.bottomControls.update(bottomData);
        this.maintenanceRoster.update(this.panelData.maintenanceRoster ?? defaultPanelData.maintenanceRoster);
        this.maintenanceCrew.update(this.panelData.maintenanceCrew ?? defaultPanelData.maintenanceCrew);
        this.fuelBreak.update(this.panelData.fuelBreak ?? defaultPanelData.fuelBreak);
        const fireDeployData = this.panelData.fireDeploy ?? defaultPanelData.fireDeploy;
        this.fireDeploy.update({ ...fireDeployData, baseOpsOpen: snapshot.baseOpsOpen });
        this.fireUnitList.update(this.panelData.fireUnitList ?? defaultPanelData.fireUnitList);
        this.fireSelectedUnit.update({ selection: snapshot.selection });
        this.budgetReport.update(this.panelData.budgetReport ?? defaultPanelData.budgetReport);
        this.applyVisibility(rules.visiblePanels, snapshot.baseOpsOpen);
    }
    applyVisibility(visible, baseOpsOpen) {
        const visibleSet = new Set(visible);
        this.panels.forEach((panel, id) => {
            const isBaseOpsPanel = id === "maintenanceRoster" || id === "maintenanceCrew";
            const shouldShow = visibleSet.has(id) && (!isBaseOpsPanel || baseOpsOpen);
            panel.classList.toggle("is-hidden", !shouldShow);
            panel.setAttribute("aria-hidden", shouldShow ? "false" : "true");
        });
    }
}
