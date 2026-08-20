import {
  createSeasonalCloudAdvectionState,
  sampleSeasonalCloudAdvectionInto,
  type SeasonalCloudAdvectionInput,
  type SeasonalCloudAdvectionState
} from "../rendering/seasonalCloudAdvection.js";
import { SEASONAL_SKY_CONFIG } from "../rendering/seasonalSkyState.js";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Interpolates the authoritative fixed-step career clock for cloud rendering.
 * It never advances time independently, so pause and simulation speed remain
 * owned by the simulation while render frames receive continuous cloud motion.
 */
export class SeasonalCloudRenderClock {
  private initialized = false;
  private stableSeed = 0;
  private previousCareerDay = 0;
  private currentCareerDay = 0;
  private renderedCareerDay = 0;
  private readonly advectionInput: SeasonalCloudAdvectionInput = {
    careerDay: 0,
    weatherSeed: 0,
    worldSeed: 0,
    driftPerDay: SEASONAL_SKY_CONFIG.cloudLayerDriftPerDay
  };
  private readonly output = createSeasonalCloudAdvectionState();

  public reset(): void {
    this.initialized = false;
  }

  public sample(
    careerDay: number,
    simulationAlpha: number,
    weatherSeed: number,
    worldSeed?: number
  ): SeasonalCloudAdvectionState {
    const resolvedCareerDay = Number.isFinite(careerDay)
      ? Math.max(0, careerDay)
      : this.initialized
        ? this.currentCareerDay
        : 0;
    const resolvedSeed = typeof worldSeed === "number" && Number.isFinite(worldSeed)
      ? worldSeed
      : Number.isFinite(weatherSeed)
        ? weatherSeed
        : 0;

    if (
      !this.initialized ||
      resolvedSeed !== this.stableSeed ||
      resolvedCareerDay < this.currentCareerDay
    ) {
      this.initialized = true;
      this.stableSeed = resolvedSeed;
      this.previousCareerDay = resolvedCareerDay;
      this.currentCareerDay = resolvedCareerDay;
      this.renderedCareerDay = resolvedCareerDay;
    } else if (resolvedCareerDay > this.currentCareerDay) {
      this.previousCareerDay = this.currentCareerDay;
      this.currentCareerDay = resolvedCareerDay;
    }

    const alpha = Number.isFinite(simulationAlpha) ? clamp01(simulationAlpha) : 1;
    const interpolatedCareerDay =
      this.previousCareerDay +
      (this.currentCareerDay - this.previousCareerDay) * alpha;
    this.renderedCareerDay = Math.min(
      this.currentCareerDay,
      Math.max(this.renderedCareerDay, interpolatedCareerDay)
    );

    this.advectionInput.careerDay = this.renderedCareerDay;
    this.advectionInput.weatherSeed = resolvedSeed;
    this.advectionInput.worldSeed = resolvedSeed;
    return sampleSeasonalCloudAdvectionInto(this.advectionInput, this.output);
  }
}
