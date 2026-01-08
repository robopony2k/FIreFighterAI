export const createFireDeployPanel = () => {
    const element = document.createElement("div");
    element.className = "phase-panel phase-card";
    element.dataset.panel = "fireDeploy";
    const title = document.createElement("div");
    title.className = "phase-card-title";
    title.textContent = "Deploy";
    const actions = document.createElement("div");
    actions.className = "phase-action-grid";
    const deployFirefighter = document.createElement("button");
    deployFirefighter.className = "phase-action";
    deployFirefighter.dataset.action = "deploy-firefighter";
    const deployTruck = document.createElement("button");
    deployTruck.className = "phase-action";
    deployTruck.dataset.action = "deploy-truck";
    actions.append(deployFirefighter, deployTruck);
    element.append(title, actions);
    return {
        element,
        update: (data) => {
            deployFirefighter.textContent = `Deploy Firefighter (${data.deployableFirefighters})`;
            deployTruck.textContent = `Deploy Truck (${data.availableTrucks})`;
            deployFirefighter.disabled = data.deployableFirefighters <= 0;
            deployTruck.disabled = data.availableTrucks <= 0;
            deployFirefighter.classList.toggle("is-active", data.activeMode === "firefighter");
            deployTruck.classList.toggle("is-active", data.activeMode === "truck");
        }
    };
};
