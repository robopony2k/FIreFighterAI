const selectionHint = (selection) => {
    if (selection.kind === "unit") {
        return selection.unitType === "truck"
            ? "Truck selected. Crew actions available."
            : "Firefighter selected. Retask within truck range.";
    }
    return null;
};
export const createContextHint = () => {
    const element = document.createElement("div");
    element.className = "phase-panel phase-hint";
    element.dataset.panel = "contextHint";
    const title = document.createElement("div");
    title.className = "phase-hint-title";
    title.textContent = "Commander Notes";
    const body = document.createElement("div");
    body.className = "phase-hint-body";
    element.append(title, body);
    return {
        element,
        update: (data) => {
            const parts = [data.focus];
            const selection = selectionHint(data.selection);
            if (selection) {
                parts.push(selection);
            }
            if (data.interactionMode === "fuelBreak") {
                parts.push("Fuel break tool active.");
            }
            if (data.interactionMode === "formation") {
                parts.push("Formation line active.");
            }
            body.textContent = parts.join(" ");
        }
    };
};
