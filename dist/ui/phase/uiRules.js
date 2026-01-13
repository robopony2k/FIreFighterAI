const RULES = {
    growth: {
        phase: "growth",
        visiblePanels: [
            "topbar",
            "maintenanceRoster",
            "maintenanceCrew",
            "fireDeploy",
            "fireUnitList",
            "fireSelectedUnit",
            "bottomControls"
        ],
        allowedInputs: ["pan", "zoom", "select", "retask", "formation", "deploy", "clearFuelBreak", "timeControl"],
        focus: "All operations available year-round.",
        minimalUi: false
    },
    maintenance: {
        phase: "maintenance",
        visiblePanels: [
            "topbar",
            "maintenanceRoster",
            "maintenanceCrew",
            "fireDeploy",
            "fireUnitList",
            "fireSelectedUnit",
            "bottomControls"
        ],
        allowedInputs: ["pan", "zoom", "select", "retask", "formation", "deploy", "clearFuelBreak", "timeControl"],
        focus: "All operations available year-round.",
        minimalUi: false
    },
    fire: {
        phase: "fire",
        visiblePanels: [
            "topbar",
            "maintenanceRoster",
            "maintenanceCrew",
            "fireDeploy",
            "fireUnitList",
            "fireSelectedUnit",
            "bottomControls"
        ],
        allowedInputs: ["pan", "zoom", "select", "retask", "formation", "deploy", "clearFuelBreak", "timeControl"],
        focus: "All operations available year-round.",
        minimalUi: false
    },
    budget: {
        phase: "budget",
        visiblePanels: [
            "topbar",
            "maintenanceRoster",
            "maintenanceCrew",
            "fireDeploy",
            "fireUnitList",
            "fireSelectedUnit",
            "budgetReport",
            "bottomControls"
        ],
        allowedInputs: ["pan", "zoom", "select", "retask", "formation", "deploy", "clearFuelBreak", "timeControl"],
        primaryCta: { label: "Continue", actionId: "continue" },
        focus: "All operations available year-round.",
        minimalUi: false
    }
};
export const getPhaseRules = (phase, mode) => {
    const base = RULES[phase];
    if (phase === "maintenance" && mode === "fuelBreak") {
        return {
            ...base,
            focus: "Fuel break mode active. Drag to carve a break."
        };
    }
    if (phase === "fire" && mode === "formation") {
        return {
            ...base,
            focus: "Formation mode active. Drag to set a line."
        };
    }
    return base;
};
