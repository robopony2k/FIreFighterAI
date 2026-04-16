import type { RNG } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { UNIT_LOSS_FIRE_THRESHOLD } from "../../../core/config.js";
import { setStatus } from "../../../core/state.js";
import { indexFor } from "../../../core/grid.js";
import { queueScoreFlowEvent } from "../../../sim/scoring.js";
import { clearCommandSelection, syncCommandUnits } from "../controllers/commandSelectionController.js";
import { getTrainingMultiplier } from "../utils/unitStats.js";
import { getRosterFirefighter, getRosterTruck, getRosterUnit, getUnitById } from "../utils/unitLookup.js";

export function applyUnitHazards(state: WorldState, rng: RNG, delta: number): void {
  let lostUnit = false;
  for (let i = state.units.length - 1; i >= 0; i -= 1) {
    const unit = state.units[i];
    const idx = indexFor(state.grid, Math.floor(unit.x), Math.floor(unit.y));
    const fireValue = state.tileFire[idx];
    if (fireValue < UNIT_LOSS_FIRE_THRESHOLD) {
      continue;
    }
    const rosterEntry = getRosterUnit(state, unit.rosterId);
    const resilience = rosterEntry ? getTrainingMultiplier(rosterEntry.training).resilience : 0;
    const baseRisk = unit.kind === "truck" ? 0.06 : 0.1;
    const risk = baseRisk * (fireValue - UNIT_LOSS_FIRE_THRESHOLD + 0.15) * (1 - resilience) * delta;
    if (rng.next() < risk) {
      if (unit.kind === "firefighter") {
        queueScoreFlowEvent(state, "lives", 1, undefined, Math.floor(unit.x), Math.floor(unit.y));
      }
      if (rosterEntry) {
        rosterEntry.status = "lost";
        if (rosterEntry.kind === "truck") {
          rosterEntry.crewIds.forEach((id) => {
            const crew = getRosterFirefighter(state, id);
            if (crew) {
              crew.assignedTruckId = null;
            }
          });
          rosterEntry.crewIds = [];
        } else if (rosterEntry.kind === "firefighter" && rosterEntry.assignedTruckId !== null) {
          const truck = getRosterTruck(state, rosterEntry.assignedTruckId);
          if (truck) {
            truck.crewIds = truck.crewIds.filter((id) => id !== rosterEntry.id);
          }
          rosterEntry.assignedTruckId = null;
        }
      }
      if (unit.kind === "truck" && unit.passengerIds.length > 0) {
        unit.passengerIds.forEach((id) => {
          const passenger = getUnitById(state, id);
          if (passenger) {
            passenger.carrierId = null;
          }
        });
        unit.passengerIds = [];
        unit.crewIds.forEach((id) => {
          const crew = getUnitById(state, id);
          if (crew) {
            crew.assignedTruckId = null;
          }
        });
        unit.crewIds = [];
      } else if (unit.carrierId !== null) {
        const carrier = getUnitById(state, unit.carrierId);
        if (carrier) {
          carrier.passengerIds = carrier.passengerIds.filter((id) => id !== unit.id);
        }
      }
      if (unit.assignedTruckId !== null) {
        const truck = getUnitById(state, unit.assignedTruckId);
        if (truck) {
          truck.crewIds = truck.crewIds.filter((id) => id !== unit.id);
          truck.passengerIds = truck.passengerIds.filter((id) => id !== unit.id);
        }
      }
      if (unit.selected) {
        unit.selected = false;
        state.selectedUnitIds = state.selectedUnitIds.filter((id) => id !== unit.id);
      }
      state.units.splice(i, 1);
      lostUnit = true;
      setStatus(state, `${unit.kind === "truck" ? "Truck" : "Firefighter"} lost in the fire.`);
    }
  }
  if (lostUnit) {
    syncCommandUnits(state);
  }
}

export function recallUnits(state: WorldState): void {
  state.units = [];
  state.roster.forEach((entry) => {
    if (entry.status === "deployed") {
      entry.status = "available";
    }
  });
  syncCommandUnits(state);
  clearCommandSelection(state);
}
