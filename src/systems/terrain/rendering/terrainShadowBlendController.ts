import * as THREE from "three";

export type TerrainShadowLightSlot = {
  direction: THREE.Vector3;
  focusPoint: THREE.Vector3;
  position: THREE.Vector3;
  target: THREE.Vector3;
  weight: number;
  needsShadowUpdate: boolean;
};

export type TerrainShadowBlendControllerConfig = {
  mapSize: number;
  viewPadding: number;
  heightPadding: number;
  minExtent: number;
  maxTerrainRatio: number;
  extentEpsilon: number;
  farEpsilon: number;
  directionStepDeg: number;
  blendDurationMs: number;
  minimumSteadyHoldMs: number;
};

export type TerrainShadowBlendControllerInput = {
  timeMs: number;
  sunDirection: THREE.Vector3;
  focusPoint: THREE.Vector3;
  cameraDistance: number;
  cameraFovDeg: number;
  cameraAspect: number;
  terrainSize: { width: number; depth: number } | null;
  cameraInteracting: boolean;
};

export type TerrainShadowBlendControllerState = {
  slots: [TerrainShadowLightSlot, TerrainShadowLightSlot];
  shadowExtent: number;
  shadowFar: number;
  lightDistance: number;
  blendActive: boolean;
  activeSlotIndex: number;
  activeLightCount: 1 | 2;
};

const DEFAULT_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_UP = new THREE.Vector3(1, 0, 0);
const scratchAxisX = new THREE.Vector3();
const scratchAxisY = new THREE.Vector3();
const scratchAxisZ = new THREE.Vector3();
const scratchFocus = new THREE.Vector3();

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeInOut = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const angleBetweenDirectionsDeg = (left: THREE.Vector3, right: THREE.Vector3): number => {
  const dot = THREE.MathUtils.clamp(left.dot(right), -1, 1);
  return Math.acos(dot) * THREE.MathUtils.RAD2DEG;
};

const createSlot = (): TerrainShadowLightSlot => ({
  direction: new THREE.Vector3(0.6, 0.72, 0.34).normalize(),
  focusPoint: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  weight: 0,
  needsShadowUpdate: true
});

export class TerrainShadowBlendController {
  private readonly config: TerrainShadowBlendControllerConfig;
  private readonly slots: [TerrainShadowLightSlot, TerrainShadowLightSlot] = [createSlot(), createSlot()];
  private activeSlotIndex = 0;
  private blendSlotIndex = 1;
  private blendStartMs = 0;
  private blendActive = false;
  private steadySinceMs = Number.NEGATIVE_INFINITY;
  private initialized = false;
  private forceRefreshPending = true;
  private lastCameraInteracting = false;
  private lastShadowExtent = Number.NaN;
  private lastShadowFar = Number.NaN;

  public constructor(config: TerrainShadowBlendControllerConfig) {
    this.config = config;
    this.slots[0].weight = 1;
  }

  public requestRefresh(): void {
    this.forceRefreshPending = true;
  }

  public update(input: TerrainShadowBlendControllerInput): TerrainShadowBlendControllerState {
    const sunDirection = scratchAxisZ.copy(input.sunDirection).normalize();
    if (!this.initialized) {
      this.slots[0].direction.copy(sunDirection);
      this.slots[1].direction.copy(sunDirection);
      this.slots[0].weight = 1;
      this.slots[1].weight = 0;
      this.initialized = true;
      this.steadySinceMs = input.timeMs;
      this.forceRefreshPending = true;
    }

    if (this.lastCameraInteracting && !input.cameraInteracting) {
      this.forceRefreshPending = true;
    }
    this.lastCameraInteracting = input.cameraInteracting;

    this.updateBlend(input.timeMs, sunDirection);

    const shadowExtent = this.getShadowExtent(input);
    const lightDistance = Math.max(this.getLightDistance(input), shadowExtent * 1.8);
    const shadowFar = Math.max(120, lightDistance * 2.35);
    const projectionChanged =
      !Number.isFinite(this.lastShadowExtent) ||
      Math.abs(shadowExtent - this.lastShadowExtent) >= this.config.extentEpsilon ||
      !Number.isFinite(this.lastShadowFar) ||
      Math.abs(shadowFar - this.lastShadowFar) >= this.config.farEpsilon;

    this.configureSlot(this.slots[0], input.focusPoint, shadowExtent, lightDistance, projectionChanged, input.cameraInteracting);
    this.configureSlot(this.slots[1], input.focusPoint, shadowExtent, lightDistance, projectionChanged, input.cameraInteracting);

    this.lastShadowExtent = shadowExtent;
    this.lastShadowFar = shadowFar;
    this.forceRefreshPending = false;

    return {
      slots: this.slots,
      shadowExtent,
      shadowFar,
      lightDistance,
      blendActive: this.blendActive,
      activeSlotIndex: this.activeSlotIndex,
      activeLightCount: this.blendActive ? 2 : 1
    };
  }

  private updateBlend(timeMs: number, sunDirection: THREE.Vector3): void {
    if (this.blendActive) {
      const progress = clamp01((timeMs - this.blendStartMs) / this.config.blendDurationMs);
      const eased = easeInOut(progress);
      this.slots[this.activeSlotIndex].weight = 1 - eased;
      this.slots[this.blendSlotIndex].weight = eased;
      if (progress >= 1) {
        const previousActiveSlotIndex = this.activeSlotIndex;
        this.activeSlotIndex = this.blendSlotIndex;
        this.blendSlotIndex = previousActiveSlotIndex;
        this.slots[this.activeSlotIndex].weight = 1;
        this.slots[this.blendSlotIndex].weight = 0;
        this.blendActive = false;
        this.steadySinceMs = timeMs;
      }
      return;
    }

    const activeDirection = this.slots[this.activeSlotIndex].direction;
    if (angleBetweenDirectionsDeg(activeDirection, sunDirection) < this.config.directionStepDeg) {
      this.slots[this.activeSlotIndex].weight = 1;
      this.slots[this.blendSlotIndex].weight = 0;
      return;
    }

    if (timeMs - this.steadySinceMs < this.config.minimumSteadyHoldMs) {
      this.slots[this.activeSlotIndex].weight = 1;
      this.slots[this.blendSlotIndex].weight = 0;
      return;
    }

    const blendSlot = this.slots[this.blendSlotIndex];
    blendSlot.direction.copy(sunDirection);
    blendSlot.weight = 0;
    blendSlot.needsShadowUpdate = true;
    this.blendStartMs = timeMs;
    this.blendActive = true;
    this.slots[this.activeSlotIndex].weight = 1;
  }

  private configureSlot(
    slot: TerrainShadowLightSlot,
    focusPoint: THREE.Vector3,
    shadowExtent: number,
    lightDistance: number,
    projectionChanged: boolean,
    cameraInteracting: boolean
  ): void {
    const snappedFocus = this.getSnappedFocusPoint(focusPoint, slot.direction, shadowExtent);
    const focusChanged =
      !Number.isFinite(slot.focusPoint.x) || snappedFocus.distanceToSquared(slot.focusPoint) > 1e-8;
    slot.focusPoint.copy(snappedFocus);
    slot.target.copy(snappedFocus);
    slot.position.copy(snappedFocus).addScaledVector(slot.direction, lightDistance);
    if (this.forceRefreshPending || projectionChanged || (!cameraInteracting && focusChanged)) {
      slot.needsShadowUpdate = true;
    }
  }

  private getLightDistance(input: TerrainShadowBlendControllerInput): number {
    const terrainSpan = input.terrainSize ? Math.max(input.terrainSize.width, input.terrainSize.depth) : 12;
    return Math.max(18, Math.min(terrainSpan * 0.85, Math.max(terrainSpan * 0.4, input.cameraDistance * 1.9)));
  }

  private getShadowExtent(input: TerrainShadowBlendControllerInput): number {
    const terrainSpan = input.terrainSize ? Math.max(input.terrainSize.width, input.terrainSize.depth) : 12;
    const cameraDistance = Math.max(1, input.cameraDistance);
    const halfFovRadians = THREE.MathUtils.degToRad(input.cameraFovDeg * 0.5);
    const visibleHalfHeight = Math.tan(halfFovRadians) * cameraDistance;
    const visibleHalfWidth = visibleHalfHeight * Math.max(1, input.cameraAspect);
    const focusExtent = Math.max(
      terrainSpan * 0.1,
      visibleHalfWidth * this.config.viewPadding,
      visibleHalfHeight * this.config.heightPadding
    );
    return Math.max(
      this.config.minExtent,
      Math.min(Math.max(this.config.minExtent, terrainSpan * this.config.maxTerrainRatio), focusExtent)
    );
  }

  private getSnappedFocusPoint(focusPoint: THREE.Vector3, sunDirection: THREE.Vector3, shadowExtent: number): THREE.Vector3 {
    const texelWorldSize = (shadowExtent * 2) / this.config.mapSize;
    if (!Number.isFinite(texelWorldSize) || texelWorldSize <= 0) {
      return scratchFocus.copy(focusPoint);
    }
    scratchAxisZ.copy(sunDirection).normalize();
    const up = Math.abs(scratchAxisZ.y) > 0.98 ? FALLBACK_UP : DEFAULT_UP;
    scratchAxisX.crossVectors(up, scratchAxisZ);
    if (scratchAxisX.lengthSq() <= 1e-8) {
      scratchAxisX.crossVectors(FALLBACK_UP, scratchAxisZ);
    }
    scratchAxisX.normalize();
    scratchAxisY.crossVectors(scratchAxisZ, scratchAxisX).normalize();
    const lightSpaceX = focusPoint.dot(scratchAxisX);
    const lightSpaceY = focusPoint.dot(scratchAxisY);
    const snappedLightSpaceX = Math.round(lightSpaceX / texelWorldSize) * texelWorldSize;
    const snappedLightSpaceY = Math.round(lightSpaceY / texelWorldSize) * texelWorldSize;
    return scratchFocus
      .copy(focusPoint)
      .addScaledVector(scratchAxisX, snappedLightSpaceX - lightSpaceX)
      .addScaledVector(scratchAxisY, snappedLightSpaceY - lightSpaceY);
  }
}
