import type { RosterUnit, UnitKind } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import {
  TRAINING_POWER_GAIN,
  TRAINING_RANGE_GAIN,
  TRAINING_RESILIENCE_GAIN,
  TRAINING_SPEED_GAIN,
  UNIT_CONFIG
} from "../../../core/config.js";
import { getCharacterDefinition } from "../../../core/characters.js";
import { TRUCK_WATER_CAPACITY, TRUCK_WATER_REFILL_RATE } from "../constants/runtimeConstants.js";

export const createTraining = (): RosterUnit["training"] => ({
  speed: 0,
  power: 0,
  range: 0,
  resilience: 0
});

export const getTrainingMultiplier = (training: RosterUnit["training"]) => ({
  speed: 1 + training.speed * TRAINING_SPEED_GAIN,
  power: 1 + training.power * TRAINING_POWER_GAIN,
  range: 1 + training.range * TRAINING_RANGE_GAIN,
  resilience: training.resilience * TRAINING_RESILIENCE_GAIN
});

export const getFallbackTrainingMultiplier = () => ({
  speed: 1,
  power: 1,
  range: 1,
  resilience: 0
});

export type DerivedUnitStats = {
  speed: number;
  radius: number;
  hoseRange: number;
  power: number;
  waterCapacity: number;
  waterRefillRate: number;
};

export const buildUnitDerivedStats = (
  state: WorldState,
  kind: UnitKind,
  rosterUnit?: RosterUnit | null
): DerivedUnitStats => {
  const config = UNIT_CONFIG[kind];
  const characterModifiers = getCharacterDefinition(state.campaign.characterId).modifiers;
  const progressionModifiers = state.progression.resolved;
  const training = rosterUnit ? getTrainingMultiplier(rosterUnit.training) : getFallbackTrainingMultiplier();
  return {
    speed: config.speed * characterModifiers.unitSpeedMultiplier * progressionModifiers.unitSpeedMultiplier * training.speed,
    radius: config.radius * training.range,
    hoseRange: config.hoseRange * progressionModifiers.unitHoseRangeMultiplier * training.range,
    power: config.power * characterModifiers.unitPowerMultiplier * progressionModifiers.unitPowerMultiplier * training.power,
    waterCapacity: kind === "truck" ? TRUCK_WATER_CAPACITY * progressionModifiers.truckWaterCapacityMultiplier : 0,
    waterRefillRate: kind === "truck" ? TRUCK_WATER_REFILL_RATE * progressionModifiers.truckWaterRefillRateMultiplier : 0
  };
};
