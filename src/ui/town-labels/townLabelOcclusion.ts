import * as THREE from "three";

const MIN_SAMPLE_DISTANCE = 0.001;
const DEFAULT_SAMPLE_COUNT = 36;
const DEFAULT_SAMPLE_START = 0.08;
const DEFAULT_SAMPLE_END = 0.995;
const DEFAULT_VERTICAL_CLEARANCE = 2.5;
const DEFAULT_LABEL_CLEARANCE = 3.5;
const DEFAULT_CONNECTOR_CLEARANCE = 0.8;
const cameraWorld = new THREE.Vector3();

export type TownLabelTerrainSurface = {
  cols: number;
  rows: number;
  width: number;
  depth: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
};

export type TownLabelDepthInput = {
  camera: THREE.Camera;
  surface: TownLabelTerrainSurface | null;
  worldX: number;
  groundY: number;
  worldZ: number;
  baseLift: number;
  maxLift: number;
  verticalClearance?: number;
  labelClearance?: number;
  connectorClearance?: number;
  sampleCount?: number;
  sampleStart?: number;
  sampleEnd?: number;
};

export type TownLabelDepthLayout = {
  labelY: number;
  connectorY: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const worldToTileX = (surface: TownLabelTerrainSurface, worldX: number): number =>
  (worldX / Math.max(0.0001, surface.width) + 0.5) * surface.cols;

const worldToTileY = (surface: TownLabelTerrainSurface, worldZ: number): number =>
  (worldZ / Math.max(0.0001, surface.depth) + 0.5) * surface.rows;

export const resolveTownLabelDepthAwareLayout = (input: TownLabelDepthInput): TownLabelDepthLayout => {
  const baseLift = Math.max(0, input.baseLift);
  const maxLift = Math.max(baseLift, input.maxLift);
  const baseY = input.groundY + baseLift;
  const maxY = input.groundY + maxLift;
  const surface = input.surface;
  if (!surface || maxY <= baseY + MIN_SAMPLE_DISTANCE) {
    return { labelY: baseY, connectorY: input.groundY };
  }

  const verticalClearance = Math.max(0, input.verticalClearance ?? DEFAULT_VERTICAL_CLEARANCE);
  const labelClearance = Math.max(0, input.labelClearance ?? DEFAULT_LABEL_CLEARANCE);
  const connectorClearance = Math.max(0, input.connectorClearance ?? DEFAULT_CONNECTOR_CLEARANCE);
  const sampleCount = Math.max(4, Math.floor(input.sampleCount ?? DEFAULT_SAMPLE_COUNT));
  const sampleStart = clamp(input.sampleStart ?? DEFAULT_SAMPLE_START, 0.01, 0.9);
  const sampleEnd = clamp(input.sampleEnd ?? DEFAULT_SAMPLE_END, sampleStart + 0.01, 0.995);
  input.camera.getWorldPosition(cameraWorld);
  const cameraTileX = worldToTileX(surface, cameraWorld.x);
  const cameraTileY = worldToTileY(surface, cameraWorld.z);
  const targetTileX = worldToTileX(surface, input.worldX);
  const targetTileY = worldToTileY(surface, input.worldZ);
  const targetDistance = Math.hypot(targetTileX - cameraTileX, targetTileY - cameraTileY);
  if (targetDistance <= MIN_SAMPLE_DISTANCE) {
    return { labelY: baseY, connectorY: input.groundY };
  }

  let clearLineY = input.groundY;
  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleStart + (sampleEnd - sampleStart) * (i / Math.max(1, sampleCount - 1));
    const tileX = cameraTileX + (targetTileX - cameraTileX) * t;
    const tileY = cameraTileY + (targetTileY - cameraTileY) * t;
    const terrainY =
      surface.heightAtTileCoord(clamp(tileX, 0, surface.cols - 1), clamp(tileY, 0, surface.rows - 1)) *
        surface.heightScale +
      verticalClearance;
    const labelYForSample = cameraWorld.y + (terrainY - cameraWorld.y) / t;
    if (Number.isFinite(labelYForSample)) {
      clearLineY = Math.max(clearLineY, labelYForSample);
    }
  }
  const connectorY =
    clearLineY > input.groundY + connectorClearance * 0.5
      ? clamp(clearLineY + connectorClearance, input.groundY, maxY)
      : input.groundY;
  const labelY = clamp(Math.max(baseY, clearLineY + labelClearance), baseY, maxY);
  return { labelY, connectorY: Math.min(connectorY, labelY) };
};
