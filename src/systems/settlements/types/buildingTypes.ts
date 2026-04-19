import * as THREE from "three";

export type BuildingLifecycleStage =
  | "empty_lot"
  | "site_prep"
  | "frame"
  | "enclosed"
  | "roofed"
  | "charred_remains"
  | "cleared_lot";

export type BuildingLotKind = "expansion" | "rebuild";

export type BuildingLotStage =
  | "empty_lot"
  | "site_prep"
  | "frame"
  | "enclosed"
  | "cleared_lot";

export type BuildingRoofType = "gable" | "hip" | "lean_to";

export type BuildingEntrySide = "front" | "left" | "right";

export type BuildingAnnexSide = "back" | "left" | "right";

export type BuildingAnnexSpec = {
  side: BuildingAnnexSide;
  width: number;
  depth: number;
  offset: number;
  heightScale: number;
  roofType: BuildingRoofType;
};

export type BuildingStoreyCount = 1 | 2;

export const BUILDING_LIFECYCLE_STAGE_ORDER: readonly BuildingLifecycleStage[] = [
  "empty_lot",
  "site_prep",
  "frame",
  "enclosed",
  "roofed",
  "charred_remains",
  "cleared_lot"
] as const;

export type BuildingLot = {
  id: number;
  townId: number;
  kind: BuildingLotKind;
  anchorIndex: number;
  styleSeed: number;
  stage: BuildingLotStage;
  stageProgressDays: number;
  startedDay: number;
  houseValue: number;
  houseResidents: number;
};

export type RenderBuildingLot = {
  id: number;
  townId: number;
  kind: BuildingLotKind;
  anchorIndex: number;
  styleSeed: number;
  stageId: number;
  stageStep: number;
};

export type BuildingSpec = {
  seed: number;
  styleId: string;
  footprintX: number;
  footprintZ: number;
  wallHeight: number;
  roofHeight: number;
  roofType: BuildingRoofType;
  roofPitch: number;
  frameThickness: number;
  studSpacing: number;
  entrySide: BuildingEntrySide;
  doorOffset: number;
  frontWindowCount: number;
  sideWindowCount: number;
  porchDepth: number;
  storeys: BuildingStoreyCount;
  annex?: BuildingAnnexSpec | null;
};

export type BuildingLifecycleState = {
  constructionYear: number;
  damage01: number;
  stage: BuildingLifecycleStage;
};

export type HouseHeightScaleMode = "anchored" | "uniform";

export type BuildingMeshTemplate = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseMatrix: THREE.Matrix4;
};

export type HouseVariant = {
  meshes: BuildingMeshTemplate[];
  height: number;
  baseOffset: number;
  size: THREE.Vector3;
  planFootprint: THREE.Vector2;
  heightScaleMode: HouseHeightScaleMode;
  doorWidth: number | null;
  scaleBias: number;
  theme: "brick" | "wood";
  source: string;
  buildKey?: string | null;
  styleId: string;
  stage: BuildingLifecycleStage;
};

export type HouseAssets = {
  variants: HouseVariant[];
};
