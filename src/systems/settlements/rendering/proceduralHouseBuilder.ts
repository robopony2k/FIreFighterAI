import * as THREE from "three";
import { HOUSE_VARIANTS } from "../../../core/buildingFootprints.js";
import { TILE_SIZE } from "../../../core/config.js";
import { getBuildingLifecycleVisualStepCount } from "../sim/buildingLifecycle.js";
import type {
  BuildingAnnexSpec,
  BuildingEntrySide,
  BuildingLifecycleStage,
  BuildingMeshTemplate,
  BuildingRoofType,
  BuildingSpec,
  HouseAssets,
  HouseVariant
} from "../types/buildingTypes.js";

const STAGES: readonly BuildingLifecycleStage[] = [
  "foundation",
  "frame",
  "enclosed",
  "finished",
  "damaged",
  "burnt_frame"
] as const;
const VARIANTS_PER_STYLE = 3;
const FOUNDATION_STEP_POST_THRESHOLDS = [0, 0.5, 1] as const;
const FRAME_WALL_PROGRESS_STEPS = [0.16, 0.26, 0.38, 0.52, 0.68, 0.84, 1] as const;
const FRAME_ROOF_PROGRESS_STEPS = [0, 0.08, 0.16, 0.3, 0.46, 0.68, 1] as const;
const ENCLOSED_WALL_COVERAGE_STEPS = [1, 2, 3, 4] as const;
const ENCLOSED_ROOF_FULL_STEP = 2;

const BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

type BuildingSide = "front" | "back" | "left" | "right";

type Opening = {
  side: BuildingSide;
  center: number;
  width: number;
  bottom: number;
  height: number;
  kind: "door" | "window";
};

type BuildingMass = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  roofType: BuildingRoofType;
  isAnnex: boolean;
  attachedSide?: BuildingSide | null;
};

type StylePalette = {
  foundation: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
  recess: THREE.MeshStandardMaterial;
  burn: THREE.MeshStandardMaterial;
  smoke: THREE.MeshStandardMaterial;
};

const makeMaterial = (color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const getSteppedValue = (steps: readonly number[], index: number): number =>
  steps[Math.max(0, Math.min(steps.length - 1, index))] ?? steps[steps.length - 1] ?? 1;
const metersToTiles = (meters: number): number => meters / Math.max(0.001, TILE_SIZE);
const ROOF_EAVE_OVERHANG = metersToTiles(0.35);
const TOP_TRIM_THICKNESS = metersToTiles(0.12);

const hash2D = (x: number, y: number, seed: number): number => {
  const sample = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return sample - Math.floor(sample);
};

const addBox = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0
): void => {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  meshes.push({
    geometry: BOX_GEOMETRY,
    material,
    baseMatrix: matrix
  });
};

const addChimney = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number
): void => {
  addBox(meshes, material, x, y, z, sx, sy, sz);
};

const distributePositions = (count: number, span: number, inset: number): number[] => {
  if (count <= 0) {
    return [];
  }
  const half = Math.max(0.04, span * 0.5 - inset);
  if (count === 1) {
    return [0];
  }
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    values.push(-half + (half * 2) * t);
  }
  return values;
};

const chooseEntrySide = (seed: number): BuildingEntrySide => {
  const options: readonly BuildingEntrySide[] = ["front", "left", "right"];
  return options[Math.floor(hash2D(8, 1, seed) * options.length)] ?? "front";
};

const chooseAnnex = (
  roofType: BuildingRoofType,
  footprintX: number,
  footprintZ: number,
  seed: number
): BuildingAnnexSpec | null => {
  if (hash2D(9, 1, seed) < 0.38) {
    return null;
  }
  const sideOptions: readonly BuildingAnnexSpec["side"][] = ["back", "left", "right"];
  const side = sideOptions[Math.floor(hash2D(9, 2, seed) * sideOptions.length)] ?? "back";
  return {
    side,
    width: clamp(footprintX * (0.34 + hash2D(9, 3, seed) * 0.18), 0.24, footprintX * 0.58),
    depth: clamp(footprintZ * (0.3 + hash2D(9, 4, seed) * 0.2), 0.22, footprintZ * 0.62),
    offset: hash2D(9, 5, seed) * 0.56 - 0.28,
    heightScale: clamp(0.68 + hash2D(9, 6, seed) * 0.18, 0.68, 0.9),
    roofType: side === "back" && roofType !== "hip" ? "gable" : "shed"
  };
};

const buildSpec = (footprintIndex: number, variationIndex: number): BuildingSpec => {
  const footprint = HOUSE_VARIANTS[footprintIndex % HOUSE_VARIANTS.length] ?? HOUSE_VARIANTS[0];
  const seed = footprintIndex * 811 + variationIndex * 271 + 137;
  const footprintX = clamp(
    footprint.sizeX * (0.97 + hash2D(variationIndex, 1, seed) * 0.06),
    footprint.sizeX * 0.94,
    footprint.sizeX * 1.05
  );
  const footprintZ = clamp(
    footprint.sizeZ * (0.97 + hash2D(variationIndex, 2, seed) * 0.06),
    footprint.sizeZ * 0.94,
    footprint.sizeZ * 1.05
  );
  const roofPitch = clamp(0.48 + hash2D(variationIndex, 3, seed) * 0.32, 0.46, 0.8);
  const wallHeight = clamp(
    metersToTiles(2.45 + footprint.sizeY * 0.18 + hash2D(variationIndex, 4, seed) * 0.28),
    metersToTiles(2.35),
    metersToTiles(2.95)
  );
  const roofHeight = clamp(
    metersToTiles(1.15 + Math.min(footprintX, footprintZ) * TILE_SIZE * roofPitch * 0.12 + hash2D(variationIndex, 14, seed) * 0.25),
    metersToTiles(1.05),
    metersToTiles(1.95)
  );
  return {
    seed,
    styleId: footprint.name,
    footprintX,
    footprintZ,
    wallHeight,
    roofHeight,
    roofType: footprint.roofType,
    roofPitch,
    frameThickness: clamp(metersToTiles(0.14 + hash2D(variationIndex, 5, seed) * 0.08), metersToTiles(0.14), metersToTiles(0.22)),
    studSpacing: clamp(metersToTiles(0.85 + hash2D(variationIndex, 6, seed) * 0.3), metersToTiles(0.85), metersToTiles(1.15)),
    entrySide: chooseEntrySide(seed),
    doorOffset: hash2D(variationIndex, 7, seed) * 0.32 - 0.16,
    frontWindowCount: 1 + Math.floor(hash2D(variationIndex, 10, seed) * 3),
    sideWindowCount: 1 + Math.floor(hash2D(variationIndex, 11, seed) * 2),
    porchDepth: clamp(metersToTiles(0.8 + hash2D(variationIndex, 12, seed) * 0.6), metersToTiles(0.8), metersToTiles(1.4)),
    annex: chooseAnnex(footprint.roofType, footprintX, footprintZ, seed)
  };
};

const makeStyleMaterials = (
  styleIndex: number,
  stage: BuildingLifecycleStage
): StylePalette => {
  const footprint = HOUSE_VARIANTS[styleIndex % HOUSE_VARIANTS.length] ?? HOUSE_VARIANTS[0];
  const darkenBy = stage === "burnt_frame" ? 0.54 : stage === "damaged" ? 0.22 : 0;
  const wallBase = new THREE.Color(footprint.wallTint);
  const roofBase = new THREE.Color(footprint.roofTint);
  const frameBase = wallBase.clone().lerp(new THREE.Color(0xe4c79f), 0.58);
  const wallColor = wallBase.clone().lerp(new THREE.Color(0x1f1712), darkenBy);
  const roofColor = roofBase.clone().lerp(new THREE.Color(0x120d09), darkenBy * 0.95);
  const frameColor = frameBase.clone().lerp(new THREE.Color(0x1c140f), darkenBy);
  const charColor = new THREE.Color(0x2a211c).lerp(new THREE.Color(0x080604), darkenBy);

  const foundation = makeMaterial(stage === "burnt_frame" ? 0x3b3129 : 0x675344, 0.95, 0);
  const frame = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : frameColor.getHex(), 0.84, 0.01);
  const wall = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : wallColor.getHex(), 0.82, 0.03);
  const roof = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : roofColor.getHex(), 0.86, 0.02);
  const trim = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : 0xead9c2, 0.72, 0);
  const glass = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : 0x9ec5d6, 0.42, 0);
  const door = makeMaterial(stage === "burnt_frame" ? charColor.getHex() : 0x7e5432, 0.8, 0);
  const recess = makeMaterial(stage === "burnt_frame" ? 0x110d0a : 0x251912, 0.98, 0);
  const burn = makeMaterial(0x2b2118, 0.98, 0);
  const smoke = makeMaterial(stage === "burnt_frame" ? 0x18110c : 0x5a4738, 0.96, 0);

  wall.color.offsetHSL(0.02 * styleIndex, 0, 0);
  roof.color.offsetHSL(0.01 * styleIndex, 0, 0);
  return {
    foundation,
    frame,
    wall,
    roof,
    trim,
    glass,
    door,
    recess,
    burn,
    smoke
  };
};

const createMasses = (spec: BuildingSpec): BuildingMass[] => {
  const masses: BuildingMass[] = [
    {
      centerX: 0,
      centerZ: 0,
      width: spec.footprintX,
      depth: spec.footprintZ,
      wallHeight: spec.wallHeight,
      roofHeight: spec.roofHeight,
      roofType: spec.roofType,
      isAnnex: false,
      attachedSide: null
    }
  ];
  if (!spec.annex) {
    return masses;
  }
  const annex = spec.annex;
  const halfMainWidth = spec.footprintX * 0.5;
  const halfMainDepth = spec.footprintZ * 0.5;
  let centerX = 0;
  let centerZ = 0;
  let attachedSide: BuildingSide | null = null;
  if (annex.side === "back") {
    centerX = annex.offset * spec.footprintX * 0.32;
    centerZ = halfMainDepth + annex.depth * 0.42;
    attachedSide = "back";
  } else if (annex.side === "left") {
    centerX = -(halfMainWidth + annex.width * 0.42);
    centerZ = annex.offset * spec.footprintZ * 0.28;
    attachedSide = "left";
  } else {
    centerX = halfMainWidth + annex.width * 0.42;
    centerZ = annex.offset * spec.footprintZ * 0.28;
    attachedSide = "right";
  }
  masses.push({
    centerX,
    centerZ,
    width: annex.width,
    depth: annex.depth,
    wallHeight: spec.wallHeight * annex.heightScale,
    roofHeight: spec.roofHeight * annex.heightScale * 0.82,
    roofType: annex.roofType,
    isAnnex: true,
    attachedSide
  });
  return masses;
};

const addWallOrientedBox = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  side: BuildingSide,
  along: number,
  y: number,
  alongSize: number,
  height: number,
  depthSize: number,
  inset = 0
): void => {
  const edgeOffset = depthSize * 0.5 + inset;
  if (side === "front") {
    addBox(
      meshes,
      material,
      mass.centerX + along,
      y,
      mass.centerZ - mass.depth * 0.5 + edgeOffset,
      alongSize,
      height,
      depthSize
    );
    return;
  }
  if (side === "back") {
    addBox(
      meshes,
      material,
      mass.centerX + along,
      y,
      mass.centerZ + mass.depth * 0.5 - edgeOffset,
      alongSize,
      height,
      depthSize
    );
    return;
  }
  if (side === "left") {
    addBox(
      meshes,
      material,
      mass.centerX - mass.width * 0.5 + edgeOffset,
      y,
      mass.centerZ + along,
      depthSize,
      height,
      alongSize
    );
    return;
  }
  addBox(
    meshes,
    material,
    mass.centerX + mass.width * 0.5 - edgeOffset,
    y,
    mass.centerZ + along,
    depthSize,
    height,
    alongSize
  );
};

const openingsForWall = (openings: Opening[], side: BuildingSide): Opening[] =>
  openings.filter((opening) => opening.side === side);

const buildMainMassOpenings = (mass: BuildingMass, spec: BuildingSpec): Opening[] => {
  const doorWidth = clamp(metersToTiles(0.95 + Math.max(0, mass.width * TILE_SIZE - 9) * 0.04), metersToTiles(0.9), metersToTiles(1.15));
  const doorHeight = clamp(metersToTiles(2.05 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.4) * 0.16), metersToTiles(2.0), metersToTiles(2.3));
  const frontWindowWidth = clamp(metersToTiles(0.95 + Math.max(0, mass.width * TILE_SIZE - 8.5) * 0.04), metersToTiles(0.9), metersToTiles(1.25));
  const sideWindowWidth = clamp(metersToTiles(0.85 + Math.max(0, mass.depth * TILE_SIZE - 7.2) * 0.05), metersToTiles(0.85), metersToTiles(1.15));
  const windowHeight = clamp(metersToTiles(1.0 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.4) * 0.08), metersToTiles(0.95), metersToTiles(1.2));
  const windowBottom = clamp(metersToTiles(0.85 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.4) * 0.04), metersToTiles(0.8), metersToTiles(1.0));
  const openings: Opening[] = [];

  const frontWindowCenters =
    spec.entrySide === "front"
      ? [-mass.width * 0.26, mass.width * 0.26].slice(0, Math.max(1, Math.min(2, spec.frontWindowCount)))
      : distributePositions(spec.frontWindowCount, mass.width, mass.width * 0.22);
  frontWindowCenters.forEach((center) => {
    openings.push({
      side: "front",
      center,
      width: frontWindowWidth,
      bottom: windowBottom,
      height: windowHeight,
      kind: "window"
    });
  });

  const backWindowCount = spec.annex?.side === "back" ? 0 : Math.max(1, spec.frontWindowCount - 1);
  distributePositions(backWindowCount, mass.width, mass.width * 0.24).forEach((center) => {
    openings.push({
      side: "back",
      center,
      width: frontWindowWidth,
      bottom: windowBottom,
      height: windowHeight,
      kind: "window"
    });
  });

  if (spec.entrySide === "front") {
    openings.push({
      side: "front",
      center: spec.doorOffset * mass.width,
      width: doorWidth,
      bottom: 0,
      height: doorHeight,
      kind: "door"
    });
  }

  const sideWindowCenters = distributePositions(spec.sideWindowCount, mass.depth, mass.depth * 0.22);
  sideWindowCenters.forEach((center) => {
    openings.push({
      side: "left",
      center,
      width: sideWindowWidth,
      bottom: windowBottom,
      height: windowHeight,
      kind: "window"
    });
    openings.push({
      side: "right",
      center,
      width: sideWindowWidth,
      bottom: windowBottom,
      height: windowHeight,
      kind: "window"
    });
  });

  if (spec.entrySide === "left" || spec.entrySide === "right") {
    openings.push({
      side: spec.entrySide,
      center: spec.doorOffset * mass.depth,
      width: clamp(mass.depth * 0.2, 0.12, 0.2),
      bottom: 0,
      height: doorHeight,
      kind: "door"
    });
  }

  return openings;
};

const buildAnnexOpenings = (mass: BuildingMass): Opening[] => {
  const windowWidth = clamp(metersToTiles(0.8 + Math.max(0, Math.min(mass.width, mass.depth) * TILE_SIZE - 6) * 0.04), metersToTiles(0.8), metersToTiles(1.05));
  const windowHeight = clamp(metersToTiles(0.9 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.1) * 0.06), metersToTiles(0.9), metersToTiles(1.05));
  const windowBottom = clamp(metersToTiles(0.85 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.1) * 0.04), metersToTiles(0.8), metersToTiles(0.95));
  const openings: Opening[] = [];
  const exposedSides: BuildingSide[] = ["front", "back", "left", "right"].filter(
    (side) => side !== mass.attachedSide
  ) as BuildingSide[];
  exposedSides.slice(0, 2).forEach((side) => {
    openings.push({
      side,
      center: 0,
      width: windowWidth,
      bottom: windowBottom,
      height: windowHeight,
      kind: "window"
    });
  });
  return openings;
};

const resolveMassOpenings = (mass: BuildingMass, spec: BuildingSpec): Opening[] =>
  mass.isAnnex ? buildAnnexOpenings(mass) : buildMainMassOpenings(mass, spec);

const FULL_WALL_SIDES: readonly BuildingSide[] = ["front", "back", "left", "right"];

const getEnclosedWallSides = (mass: BuildingMass, spec: BuildingSpec): readonly BuildingSide[] => {
  if (mass.isAnnex) {
    if (mass.attachedSide === "left") {
      return ["front", "back", "right"];
    }
    if (mass.attachedSide === "right") {
      return ["front", "back", "left"];
    }
    return ["front", "left", "right"];
  }
  if (spec.entrySide === "left") {
    return ["front", "back", "right"];
  }
  if (spec.entrySide === "right") {
    return ["front", "back", "left"];
  }
  return ["back", "left", "right"];
};

const getRaisedFrameSides = (mass: BuildingMass, spec: BuildingSpec): readonly BuildingSide[] => {
  if (mass.isAnnex) {
    if (mass.attachedSide === "left") {
      return ["front", "right", "back"];
    }
    if (mass.attachedSide === "right") {
      return ["front", "left", "back"];
    }
    return ["front", "left", "right"];
  }
  if (spec.entrySide === "right") {
    return ["front", "right", "back", "left"];
  }
  if (spec.entrySide === "left") {
    return ["front", "left", "back", "right"];
  }
  return ["front", "left", "right", "back"];
};

const takeFirstSides = (sides: readonly BuildingSide[], count: number): readonly BuildingSide[] =>
  sides.slice(0, Math.max(1, Math.min(sides.length, count)));

const limitFramePositions = (positions: number[], progress: number): number[] => {
  if (positions.length <= 2 || progress >= 0.999) {
    return positions;
  }
  const limit = Math.max(2, Math.ceil(positions.length * clamp(progress, 0.18, 1)));
  const limited = positions.slice(0, limit);
  const last = positions[positions.length - 1];
  if (last !== undefined && !limited.includes(last)) {
    limited.push(last);
  }
  return limited;
};

const addFoundationLayout = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  thickness: number,
  progress = 1
): void => {
  if (progress <= 0.01) {
    return;
  }
  FULL_WALL_SIDES.forEach((side) => {
    const span = side === "front" || side === "back" ? mass.width : mass.depth;
    addWallOrientedBox(meshes, material, mass, side, 0, baseY + thickness * 0.5, span, thickness, thickness);
  });
  if (progress < FOUNDATION_STEP_POST_THRESHOLDS[1]) {
    return;
  }
  const postHeight = Math.max(0.1, mass.wallHeight * 0.22);
  const xOffsets = [-(mass.width * 0.5 - thickness * 0.5), mass.width * 0.5 - thickness * 0.5];
  const zOffsets = [-(mass.depth * 0.5 - thickness * 0.5), mass.depth * 0.5 - thickness * 0.5];
  xOffsets.forEach((xOffset) => {
    zOffsets.forEach((zOffset) => {
      addBox(
        meshes,
        material,
        mass.centerX + xOffset,
        baseY + thickness + postHeight * 0.5,
        mass.centerZ + zOffset,
        thickness,
        postHeight,
        thickness
      );
    });
  });
};

const addWallShell = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  wallThickness: number,
  sides: readonly BuildingSide[] = FULL_WALL_SIDES
): void => {
  sides.forEach((side) => {
    const span = side === "front" || side === "back" ? mass.width : mass.depth;
    addWallOrientedBox(meshes, material, mass, side, 0, baseY + mass.wallHeight * 0.5, span, mass.wallHeight, wallThickness);
  });
};

const addWallTopTrim = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number
): void => {
  FULL_WALL_SIDES.forEach((side) => {
    const span = side === "front" || side === "back" ? mass.width : mass.depth;
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      0,
      baseY + mass.wallHeight + TOP_TRIM_THICKNESS * 0.5,
      span,
      TOP_TRIM_THICKNESS,
      TOP_TRIM_THICKNESS
    );
  });
};

const addWallFrame = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  side: BuildingSide,
  baseY: number,
  thickness: number,
  studSpacing: number,
  openings: Opening[],
  progress = 1
): void => {
  const span = side === "front" || side === "back" ? mass.width : mass.depth;
  const halfSpan = span * 0.5;
  addWallOrientedBox(meshes, material, mass, side, 0, baseY + thickness * 0.5, span, thickness, thickness);
  addWallOrientedBox(
    meshes,
    material,
    mass,
    side,
    0,
    baseY + mass.wallHeight - thickness * 0.5,
    span,
    thickness,
    thickness
  );

  const positions = new Set<number>([-halfSpan, halfSpan]);
  for (let pos = -halfSpan + studSpacing; pos < halfSpan; pos += studSpacing) {
    positions.add(Number(pos.toFixed(4)));
  }
  const wallOpenings = openingsForWall(openings, side);
  const sortedPositions = limitFramePositions(
    Array.from(positions).sort((a, b) => a - b),
    progress
  );
  const progressEdge = -halfSpan + span * clamp(progress, 0, 1);
  sortedPositions
    .forEach((position) => {
      const opening = wallOpenings.find(
        (entry) => Math.abs(position - entry.center) < entry.width * 0.5 - thickness * 0.2
      );
      if (!opening) {
        const studHeight = Math.max(0.06, mass.wallHeight - thickness * 2);
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          position,
          baseY + thickness + studHeight * 0.5,
          thickness,
          studHeight,
          thickness
        );
        return;
      }
      if (opening.bottom > thickness * 1.1) {
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          position,
          baseY + thickness + opening.bottom * 0.5,
          thickness,
          Math.max(0.04, opening.bottom),
          thickness
        );
      }
      const upperBottom = opening.bottom + opening.height;
      if (upperBottom < mass.wallHeight - thickness * 1.1) {
        const upperHeight = Math.max(0.04, mass.wallHeight - upperBottom - thickness);
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          position,
          baseY + upperBottom + upperHeight * 0.5,
          thickness,
          upperHeight,
          thickness
        );
      }
    });

  wallOpenings.forEach((opening) => {
    if (progress < 0.999 && opening.center - opening.width * 0.5 > progressEdge) {
      return;
    }
    const left = opening.center - opening.width * 0.5;
    const right = opening.center + opening.width * 0.5;
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      left,
      baseY + mass.wallHeight * 0.5,
      thickness,
      Math.max(0.08, mass.wallHeight - thickness),
      thickness
    );
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      right,
      baseY + mass.wallHeight * 0.5,
      thickness,
      Math.max(0.08, mass.wallHeight - thickness),
      thickness
    );
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      opening.center,
      baseY + opening.bottom + opening.height + thickness * 0.5,
      opening.width + thickness * 1.2,
      thickness,
      thickness
    );
    if (opening.kind === "window") {
      addWallOrientedBox(
        meshes,
        material,
        mass,
        side,
        opening.center,
        baseY + opening.bottom - thickness * 0.5,
        opening.width + thickness * 1.2,
        thickness,
        thickness
      );
    }
  });
};

const addRoofFrame = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  thickness: number,
  studSpacing: number,
  progress = 1
): void => {
  const wallTopY = baseY + mass.wallHeight;
  if (mass.roofType === "shed") {
    const roofRun = mass.depth + ROOF_EAVE_OVERHANG * 2;
    const rafterLength = Math.hypot(roofRun, mass.roofHeight);
    const positions = limitFramePositions(
      distributePositions(Math.max(3, Math.round(mass.width / Math.max(studSpacing, 0.12))), mass.width, thickness * 2),
      progress
    );
    positions.forEach((xPos) => {
        addBox(
          meshes,
          material,
          mass.centerX + xPos,
          wallTopY + mass.roofHeight * 0.5,
          mass.centerZ,
          thickness,
          thickness,
          rafterLength,
          -Math.atan2(mass.roofHeight, Math.max(0.12, roofRun)),
          0,
          0
        );
      });
    addBox(
      meshes,
      material,
      mass.centerX - (mass.width + ROOF_EAVE_OVERHANG * 2) * (1 - clamp(progress, 0.2, 1)) * 0.16,
      wallTopY + mass.roofHeight,
      mass.centerZ + roofRun * 0.5,
      (mass.width + ROOF_EAVE_OVERHANG * 2) * (0.34 + clamp(progress, 0.2, 1) * 0.58),
      thickness,
      thickness
    );
    return;
  }

  const roofRun = mass.depth * 0.5 + ROOF_EAVE_OVERHANG;
  const roofWidth = mass.width + ROOF_EAVE_OVERHANG * 2;
  const ridgeLengthBase =
    mass.roofType === "hip" ? Math.max(mass.width * 0.34, roofWidth - roofRun * 1.1) : roofWidth;
  const ridgeLength = ridgeLengthBase * (0.36 + clamp(progress, 0.2, 1) * 0.64);
  addBox(
    meshes,
    material,
    mass.centerX - roofWidth * (1 - clamp(progress, 0.2, 1)) * 0.12,
    wallTopY + mass.roofHeight,
    mass.centerZ,
    ridgeLength,
    thickness,
    thickness
  );
  const rafterLength = Math.hypot(roofRun, mass.roofHeight);
  const positions = limitFramePositions(
    distributePositions(Math.max(3, Math.round(mass.width / Math.max(studSpacing, 0.12))), mass.width, thickness),
    progress
  );
  positions.forEach((xPos) => {
      addBox(
        meshes,
        material,
        mass.centerX + xPos,
        wallTopY + mass.roofHeight * 0.5,
        mass.centerZ - roofRun * 0.5,
        thickness,
        thickness,
        rafterLength,
        -Math.atan2(mass.roofHeight, Math.max(0.12, roofRun)),
        0,
        0
      );
      addBox(
        meshes,
        material,
        mass.centerX + xPos,
        wallTopY + mass.roofHeight * 0.5,
        mass.centerZ + roofRun * 0.5,
        thickness,
        thickness,
        rafterLength,
        Math.atan2(mass.roofHeight, Math.max(0.12, roofRun)),
        0,
        0
      );
    });
};

const addGableRoof = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  partial = false
): void => {
  const panelThickness = Math.max(metersToTiles(0.08), mass.roofHeight * 0.14);
  const wallTopY = baseY + mass.wallHeight;
  const roofRun = mass.depth * 0.5 + ROOF_EAVE_OVERHANG;
  const slope = Math.atan2(mass.roofHeight, Math.max(0.1, roofRun));
  const slopeLength = Math.hypot(roofRun, mass.roofHeight);
  const ridgeCenterY = wallTopY + mass.roofHeight * 0.5;
  const panelOffsetZ = roofRun * 0.5;
  const roofWidth = (mass.width + ROOF_EAVE_OVERHANG * 2) * (partial ? 0.96 : 1);
  addBox(
    meshes,
    material,
    mass.centerX,
    ridgeCenterY,
    mass.centerZ - panelOffsetZ,
    roofWidth,
    panelThickness,
    slopeLength,
    -slope,
    0,
    0
  );
  if (partial) {
    return;
  }
  addBox(
    meshes,
    material,
    mass.centerX,
    ridgeCenterY,
    mass.centerZ + panelOffsetZ,
    roofWidth,
    panelThickness,
    slopeLength,
    slope,
    0,
    0
  );
  addBox(
    meshes,
    material,
    mass.centerX,
    wallTopY + mass.roofHeight,
    mass.centerZ,
    mass.width + ROOF_EAVE_OVERHANG,
    panelThickness * 0.72,
    metersToTiles(0.12)
  );
};

const addHipRoof = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  partial = false
): void => {
  const panelThickness = Math.max(metersToTiles(0.08), mass.roofHeight * 0.14);
  const ridgeY = baseY + mass.wallHeight + mass.roofHeight * 0.5;
  const roofHalfDepth = mass.depth * 0.5 + ROOF_EAVE_OVERHANG;
  const roofHalfWidth = mass.width * 0.5 + ROOF_EAVE_OVERHANG;
  const depthSlope = Math.atan2(mass.roofHeight, Math.max(0.12, roofHalfDepth));
  const widthSlope = Math.atan2(mass.roofHeight, Math.max(0.12, roofHalfWidth));
  const frontBackPanelLength = Math.hypot(roofHalfDepth, mass.roofHeight);
  const sidePanelLength = Math.hypot(roofHalfWidth, mass.roofHeight);
  addBox(
    meshes,
    material,
    mass.centerX,
    ridgeY,
    mass.centerZ - roofHalfDepth * 0.5,
    mass.width + ROOF_EAVE_OVERHANG * 2,
    panelThickness,
    frontBackPanelLength,
    -depthSlope,
    0,
    0
  );
  addBox(
    meshes,
    material,
    mass.centerX,
    ridgeY,
    mass.centerZ + roofHalfDepth * 0.5,
    mass.width + ROOF_EAVE_OVERHANG * 2,
    panelThickness,
    frontBackPanelLength,
    depthSlope,
    0,
    0
  );
  if (partial) {
    return;
  }
  addBox(
    meshes,
    material,
    mass.centerX - roofHalfWidth * 0.5,
    ridgeY,
    mass.centerZ,
    mass.depth + ROOF_EAVE_OVERHANG * 2,
    panelThickness,
    sidePanelLength,
    0,
    Math.PI * 0.5,
    widthSlope
  );
  addBox(
    meshes,
    material,
    mass.centerX + roofHalfWidth * 0.5,
    ridgeY,
    mass.centerZ,
    mass.depth + ROOF_EAVE_OVERHANG * 2,
    panelThickness,
    sidePanelLength,
    0,
    Math.PI * 0.5,
    -widthSlope
  );
};

const addShedRoof = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  partial = false
): void => {
  const roofRun = mass.depth + ROOF_EAVE_OVERHANG * 2;
  addBox(
    meshes,
    material,
    mass.centerX + (partial ? -(mass.width + ROOF_EAVE_OVERHANG * 2) * 0.1 : 0),
    baseY + mass.wallHeight + mass.roofHeight * 0.5,
    mass.centerZ,
    (mass.width + ROOF_EAVE_OVERHANG * 2) * (partial ? 0.76 : 1),
    Math.max(metersToTiles(0.08), mass.roofHeight * 0.14),
    Math.hypot(roofRun, mass.roofHeight),
    -Math.atan2(mass.roofHeight, Math.max(0.12, roofRun)),
    0,
    0
  );
};

const addMassRoof = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  partial = false
): void => {
  if (mass.roofType === "gable") {
    addGableRoof(meshes, material, mass, baseY, partial);
    return;
  }
  if (mass.roofType === "hip") {
    addHipRoof(meshes, material, mass, baseY, partial);
    return;
  }
  addShedRoof(meshes, material, mass, baseY, partial);
};

const addOpeningFeatures = (
  meshes: BuildingMeshTemplate[],
  palette: StylePalette,
  mass: BuildingMass,
  openings: Opening[],
  baseY: number,
  stage: BuildingLifecycleStage,
  wallThickness: number
): void => {
  const recessInset = Math.max(0, wallThickness * 0.28);
  const panelInset = Math.max(0, wallThickness * 0.08);
  openings.forEach((opening) => {
    addWallOrientedBox(
      meshes,
      palette.recess,
      mass,
      opening.side,
      opening.center,
      baseY + opening.bottom + opening.height * 0.5,
      opening.width * 0.9,
      opening.height * 0.92,
      wallThickness * 0.44,
      recessInset
    );
    if (stage === "enclosed") {
      return;
    }
    if (opening.kind === "door") {
      addWallOrientedBox(
        meshes,
        palette.door,
        mass,
        opening.side,
        opening.center,
        baseY + opening.bottom + opening.height * 0.5,
        opening.width * 0.8,
        opening.height * 0.9,
        wallThickness * 0.18,
        panelInset
      );
      addWallOrientedBox(
        meshes,
        palette.trim,
        mass,
        opening.side,
        opening.center,
        baseY + opening.bottom + opening.height + wallThickness * 0.12,
        opening.width * 0.96,
        wallThickness * 0.18,
        wallThickness * 0.18,
        panelInset
      );
      return;
    }
    addWallOrientedBox(
      meshes,
      palette.glass,
      mass,
      opening.side,
      opening.center,
      baseY + opening.bottom + opening.height * 0.52,
      opening.width * 0.74,
      opening.height * 0.72,
      wallThickness * 0.16,
      panelInset
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center,
      baseY + opening.bottom + opening.height * 0.52,
      opening.width * 0.92,
      wallThickness * 0.14,
      wallThickness * 0.18,
      panelInset
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center,
      baseY + opening.bottom + opening.height * 0.52,
      wallThickness * 0.14,
      opening.height * 0.86,
      wallThickness * 0.18,
      panelInset
    );
  });
};

const addFrontPorch = (
  meshes: BuildingMeshTemplate[],
  palette: StylePalette,
  spec: BuildingSpec,
  mass: BuildingMass,
  baseY: number
): void => {
  if (spec.entrySide !== "front" || spec.porchDepth < 0.08 || mass.isAnnex) {
    return;
  }
  const deckWidth = mass.width * 0.34;
  const deckDepth = spec.porchDepth;
  const frontZ = mass.centerZ - mass.depth * 0.5 - deckDepth * 0.36;
  addBox(
    meshes,
    palette.foundation,
    mass.centerX + spec.doorOffset * mass.width * 0.18,
    baseY + metersToTiles(0.12),
    frontZ,
    deckWidth,
    metersToTiles(0.14),
    deckDepth
  );
  addBox(
    meshes,
    palette.trim,
    mass.centerX + spec.doorOffset * mass.width * 0.18,
    baseY + spec.wallHeight * 0.74,
    frontZ,
    deckWidth * 0.86,
    0.03,
    deckDepth * 0.72,
    -0.12,
    0,
    0
  );
  [-deckWidth * 0.34, deckWidth * 0.34].forEach((offsetX) => {
    addBox(
      meshes,
      palette.trim,
      mass.centerX + spec.doorOffset * mass.width * 0.18 + offsetX,
      baseY + spec.wallHeight * 0.38,
      frontZ,
      metersToTiles(0.12),
      spec.wallHeight * 0.74,
      metersToTiles(0.12)
    );
  });
};

const finalizeVariant = (
  meshes: BuildingMeshTemplate[],
  spec: BuildingSpec,
  stage: BuildingLifecycleStage,
  visualStep: number,
  theme: "brick" | "wood",
  foundationWidth: number,
  foundationDepth: number
): HouseVariant | null => {
  if (meshes.length === 0) {
    return null;
  }
  const worldBounds = new THREE.Box3();
  let hasBounds = false;
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) {
      return;
    }
    const meshBounds = geometry.boundingBox.clone().applyMatrix4(mesh.baseMatrix);
    if (!hasBounds) {
      worldBounds.copy(meshBounds);
      hasBounds = true;
    } else {
      worldBounds.union(meshBounds);
    }
  });
  if (!hasBounds) {
    return null;
  }
  const center = new THREE.Vector3();
  worldBounds.getCenter(center);
  const recenter = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
  const recenteredMeshes = meshes.map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material,
    baseMatrix: mesh.baseMatrix.clone().premultiply(recenter)
  }));
  const localBounds = worldBounds.clone().applyMatrix4(recenter);
  const localSize = new THREE.Vector3();
  localBounds.getSize(localSize);
  const buildKey = getProceduralHouseVariantKey(spec.styleId, stage, visualStep);
  return {
    meshes: recenteredMeshes,
    height: Math.max(0.01, localSize.y),
    baseOffset: -localBounds.min.y,
    size: localSize,
    planFootprint: new THREE.Vector2(foundationWidth, foundationDepth),
    heightScaleMode: "anchored",
    doorWidth: metersToTiles(1),
    scaleBias: 1,
    theme,
    source: spec.styleId,
    buildKey,
    styleId: spec.styleId,
    stage
  };
};

const buildVariantForStage = (
  footprintIndex: number,
  variationIndex: number,
  stage: BuildingLifecycleStage,
  visualStep: number
): HouseVariant | null => {
  const spec = buildSpec(footprintIndex, variationIndex);
  const theme: "brick" | "wood" = footprintIndex % 2 === 0 ? "wood" : "brick";
  const palette = makeStyleMaterials(footprintIndex, stage);
  const masses = createMasses(spec);
  const meshes: BuildingMeshTemplate[] = [];
  const baseY = metersToTiles(0.35);
  const foundationInset = metersToTiles(0.4);
  const foundationWidth = Math.max(...masses.map((mass) => Math.abs(mass.centerX) + mass.width * 0.5)) * 2 + foundationInset;
  const foundationDepth = Math.max(...masses.map((mass) => Math.abs(mass.centerZ) + mass.depth * 0.5)) * 2 + foundationInset;
  addBox(meshes, palette.foundation, 0, baseY * 0.5, 0, foundationWidth, baseY, foundationDepth);

  if (stage === "foundation") {
    const foundationProgress = getSteppedValue(FOUNDATION_STEP_POST_THRESHOLDS, visualStep);
    masses.forEach((mass) => {
      addFoundationLayout(meshes, palette.frame, mass, baseY, Math.max(0.02, spec.frameThickness * 1.1), foundationProgress);
    });
    return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
  }

  const frameMaterial = stage === "burnt_frame" ? palette.burn : palette.frame;
  const roofFrameMaterial = stage === "burnt_frame" ? palette.burn : palette.frame;
  const frameThickness = spec.frameThickness;
  const wallThickness = Math.max(0.05, frameThickness * 2.15);

  if (stage === "frame") {
    const wallProgress = getSteppedValue(FRAME_WALL_PROGRESS_STEPS, visualStep);
    const roofProgress = getSteppedValue(FRAME_ROOF_PROGRESS_STEPS, visualStep);
    masses.forEach((mass) => {
      const openings = resolveMassOpenings(mass, spec);
      const sideSequence = getRaisedFrameSides(mass, spec);
      const visibleSideCount = Math.ceil(wallProgress * sideSequence.length);
      takeFirstSides(sideSequence, visibleSideCount).forEach((side) => {
        addWallFrame(meshes, frameMaterial, mass, side, baseY, frameThickness, spec.studSpacing, openings, wallProgress);
      });
      if (roofProgress > 0.01) {
        addRoofFrame(
          meshes,
          roofFrameMaterial,
          mass,
          baseY,
          frameThickness,
          spec.studSpacing,
          roofProgress
        );
      }
    });
    return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
  }

  masses.forEach((mass) => {
    const openings = resolveMassOpenings(mass, spec);
    addWallFrame(meshes, frameMaterial, mass, "front", baseY, frameThickness, spec.studSpacing, openings);
    addWallFrame(meshes, frameMaterial, mass, "back", baseY, frameThickness, spec.studSpacing, openings);
    addWallFrame(meshes, frameMaterial, mass, "left", baseY, frameThickness, spec.studSpacing, openings);
    addWallFrame(meshes, frameMaterial, mass, "right", baseY, frameThickness, spec.studSpacing, openings);
    addRoofFrame(meshes, roofFrameMaterial, mass, baseY, frameThickness, spec.studSpacing);

    if (stage === "enclosed") {
      const wallSideSequence = getEnclosedWallSides(mass, spec);
      const wallCoverageCount = Math.max(
        1,
        Math.min(wallSideSequence.length, getSteppedValue(ENCLOSED_WALL_COVERAGE_STEPS, visualStep))
      );
      addWallShell(meshes, palette.wall, mass, baseY, wallThickness, takeFirstSides(wallSideSequence, wallCoverageCount));
      addMassRoof(meshes, palette.roof, mass, baseY, visualStep >= ENCLOSED_ROOF_FULL_STEP ? false : true);
      addOpeningFeatures(meshes, palette, mass, openings, baseY, stage, wallThickness);
      return;
    }

    if (stage === "finished" || stage === "damaged") {
      addWallShell(meshes, palette.wall, mass, baseY, wallThickness);
      addMassRoof(meshes, palette.roof, mass, baseY);
      addOpeningFeatures(meshes, palette, mass, openings, baseY, stage, wallThickness);
    }
  });

  if (stage === "finished") {
    addFrontPorch(meshes, palette, spec, masses[0], baseY);
    masses.forEach((mass) => {
      addWallTopTrim(meshes, palette.trim, mass, baseY);
    });
    addChimney(
      meshes,
      palette.smoke,
      masses[0].centerX + masses[0].width * 0.26,
      baseY + masses[0].wallHeight + masses[0].roofHeight * 0.58,
      masses[0].centerZ + masses[0].depth * 0.12,
      Math.max(0.05, masses[0].width * 0.08),
      Math.max(0.08, masses[0].roofHeight * 0.34),
      Math.max(0.05, masses[0].depth * 0.08)
    );
  }

  if (stage === "damaged") {
    addBox(
      meshes,
      palette.burn,
      0,
      baseY + masses[0].wallHeight * 0.36,
      masses[0].centerZ + masses[0].depth * 0.08,
      foundationWidth * 0.42,
      masses[0].wallHeight * 0.28,
      foundationDepth * 0.34,
      0,
      0.08,
      0
    );
    addBox(
      meshes,
      palette.burn,
      masses[0].centerX + masses[0].width * 0.16,
      baseY + masses[0].wallHeight + masses[0].roofHeight * 0.18,
      masses[0].centerZ - masses[0].depth * 0.14,
      masses[0].width * 0.22,
      masses[0].roofHeight * 0.24,
      masses[0].depth * 0.18,
      -0.18,
      0.14,
      0.06
    );
  }

  if (stage === "burnt_frame") {
    addBox(
      meshes,
      palette.burn,
      0,
      baseY + masses[0].wallHeight * 0.14,
      0,
      foundationWidth * 0.72,
      0.05,
      foundationDepth * 0.72
    );
  }

  return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
};

let cachedAssets: HouseAssets | null = null;

export const getProceduralHouseVariantKey = (
  styleId: string,
  stage: BuildingLifecycleStage,
  visualStep = 0
): string => {
  const stepCount = getBuildingLifecycleVisualStepCount(stage);
  if (stepCount <= 1) {
    return `${styleId}:${stage}`;
  }
  const clampedStep = Math.max(0, Math.min(stepCount - 1, Math.floor(visualStep)));
  return `${styleId}:${stage}:${clampedStep}`;
};

export const createProceduralHouseAssets = (): HouseAssets => {
  if (cachedAssets) {
    return cachedAssets;
  }
  const variants: HouseVariant[] = [];
  HOUSE_VARIANTS.forEach((_, footprintIndex) => {
    for (let variationIndex = 0; variationIndex < VARIANTS_PER_STYLE; variationIndex += 1) {
      STAGES.forEach((stage) => {
        const stepCount = getBuildingLifecycleVisualStepCount(stage);
        for (let visualStep = 0; visualStep < stepCount; visualStep += 1) {
          const variant = buildVariantForStage(footprintIndex, variationIndex, stage, visualStep);
          if (variant) {
            variants.push(variant);
          }
        }
      });
    }
  });
  cachedAssets = { variants };
  return cachedAssets;
};
