const RULES = {
    growth: {
        phase: "growth",
        visiblePanels: ["topbar", "contextHint", "bottomControls"],
        allowedInputs: ["pan", "zoom"],
        focus: "Observe regrowth from above.",
        minimalUi: true
    },
    maintenance: {
        phase: "maintenance",
        visiblePanels: ["topbar", "contextHint", "maintenanceRoster", "maintenanceCrew", "fuelBreak", "bottomControls"],
        allowedInputs: ["pan", "zoom", "select", "clearFuelBreak", "timeControl"],
        primaryCta: { label: "Begin Fire Season", actionId: "begin-fire" },
        focus: "Plan crews and cut fuel breaks.",
        minimalUi: false
    },
    fire: {
        phase: "fire",
        visiblePanels: ["topbar", "contextHint", "fireDeploy", "fireUnitList", "fireSelectedUnit", "bottomControls"],
        allowedInputs: ["pan", "zoom", "select", "retask", "formation", "deploy", "timeControl"],
        focus: "Deploy units and contain the fire.",
        minimalUi: false
    },
    budget: {
        phase: "budget",
        visiblePanels: ["topbar", "contextHint", "budgetReport"],
        allowedInputs: ["pan", "zoom"],
        primaryCta: { label: "Continue", actionId: "continue" },
        focus: "Review outcomes and prepare for the next year.",
        minimalUi: true
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
