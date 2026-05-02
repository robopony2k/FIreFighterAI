import { FIRE_SIM_LAB_LEGEND_ITEMS } from "./cellSymbols.js";

export const createFireSimLabLegend = (): HTMLElement => {
  const legend = document.createElement("div");
  legend.className = "fire-sim-lab-legend";
  FIRE_SIM_LAB_LEGEND_ITEMS.forEach((item) => {
    const row = document.createElement("div");
    row.className = "fire-sim-lab-legend-item";
    row.title = item.detail;
    const symbol = document.createElement("span");
    symbol.className = `fire-sim-lab-legend-symbol fire-sim-lab-symbol--${item.state}`;
    symbol.textContent = item.symbol;
    const label = document.createElement("span");
    label.className = "fire-sim-lab-legend-label";
    label.textContent = item.label;
    row.append(symbol, label);
    legend.appendChild(row);
  });
  return legend;
};

