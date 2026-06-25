import assert from "node:assert/strict";

import {
  DEBUG_UNLIMITED_MONEY_BUDGET,
  RECRUIT_TRUCK_COST,
  STRATEGIC_TIME_SPEED_MAX,
  TIME_SPEED_OPTIONS
} from "../dist/core/config.js";
import {
  TIME_SPEED_SLIDER_MAX,
  clampTimeSpeedSliderValue
} from "../dist/core/timeSpeed.js";
import { createInitialState } from "../dist/core/state.js";
import {
  getActiveTimeSpeedValue,
  requestAdvanceToNextEvent
} from "../dist/sim/index.js";
import { resolveRuntimeFrameWorkBudget } from "../dist/app/bootLoop.js";

const failures = [];

const expect = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

console.log(`Strategic speed max=${STRATEGIC_TIME_SPEED_MAX} sliderMax=${TIME_SPEED_SLIDER_MAX}`);
console.log(`Strategic presets=${TIME_SPEED_OPTIONS.join(",")}`);
console.log(`Unlimited money debug budget=${DEBUG_UNLIMITED_MONEY_BUDGET}`);

expect(STRATEGIC_TIME_SPEED_MAX === 20, "Strategic max should be 20x.");
expect(TIME_SPEED_SLIDER_MAX === 20, "Slider max should be 20x.");
expect(Math.max(...TIME_SPEED_OPTIONS) === 20, "Strategic presets should max at 20x.");
expect(!TIME_SPEED_OPTIONS.includes(40), "Strategic presets should not expose 40x.");
expect(!TIME_SPEED_OPTIONS.includes(80), "Strategic presets should not expose 80x.");
expect(clampTimeSpeedSliderValue(80) === 20, "Stale 80x slider values should sanitize to 20x.");
expect(
  DEBUG_UNLIMITED_MONEY_BUDGET >= RECRUIT_TRUCK_COST * 20,
  "Unlimited money runs should start with enough budget to recruit many trucks."
);

{
  const state = createInitialState(1701, { cols: 8, rows: 8, totalTiles: 64 });
  state.timeSpeedControlMode = "slider";
  state.timeSpeedSliderValue = 7;
  state.paused = false;
  const requested = requestAdvanceToNextEvent(state);
  console.log(
    `Advance next event requested=${requested ? 1 : 0} slider=${state.timeSpeedSliderValue} active=${getActiveTimeSpeedValue(state)}`
  );
  expect(requested, "Advance to Next Event should be available in idle strategic time.");
  expect(state.timeSpeedSliderValue === 20, "Advance to Next Event should force the slider to 20x.");
  expect(getActiveTimeSpeedValue(state) === 20, "Advance to Next Event active speed should be 20x.");
}

{
  const budget = resolveRuntimeFrameWorkBudget({
    baseStep: 0.25,
    timeSpeedValue: 80,
    maxSimulationStep: null,
    incidentMode: false,
    threeTestVisible: true
  });
  console.log(
    `Budget requestedSpeed=${budget.requestedTimeSpeedValue} effectiveSpeed=${budget.effectiveTimeSpeedValue} requestedStep=${budget.requestedSimulationStep} appliedStep=${budget.appliedSimulationStep}`
  );
  expect(budget.requestedTimeSpeedValue === 80, "Budget telemetry should preserve the requested stale/debug speed.");
  expect(budget.effectiveTimeSpeedValue === 20, "Budget should cap stale/debug strategic speed to 20x.");
  expect(budget.appliedTimeSpeedValue === 20, "Applied speed should match effective speed when no lower cap is present.");
  expect(budget.movementTimeSpeedValue === 20, "Movement speed should match effective speed when no lower cap is present.");
  expect(budget.requestedSimulationStep === 20, "Requested step should reflect the raw 80x request.");
  expect(budget.appliedSimulationStep === 5, "Applied step should reflect the 20x cap.");
  expect(budget.movementSimulationStep === 5, "Movement step should match effective step when no lower cap is present.");
}

{
  const budget = resolveRuntimeFrameWorkBudget({
    baseStep: 0.25,
    timeSpeedValue: 80,
    maxSimulationStep: 2,
    incidentMode: false,
    threeTestVisible: true
  });
  console.log(
    `Budget fire cap movementSpeed=${budget.movementTimeSpeedValue} appliedSpeed=${budget.appliedTimeSpeedValue} movementStep=${budget.movementSimulationStep} appliedStep=${budget.appliedSimulationStep}`
  );
  expect(budget.appliedTimeSpeedValue === 8, "Applied speed should expose lower fire/runtime step caps.");
  expect(budget.appliedSimulationStep === 2, "Fire/runtime step caps should still apply below the 20x cap.");
  expect(budget.movementTimeSpeedValue === 20, "Movement speed should stay at effective game speed under fire/runtime caps.");
  expect(budget.movementSimulationStep === 5, "Movement step should stay at effective game step under fire/runtime caps.");
}

if (failures.length > 0) {
  console.error("\nTime speed regression failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nTime speed regression passed.");
}
