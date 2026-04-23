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
  "empty_lot",
  "site_prep",
  "frame",
  "enclosed",
  "roofed",
  "charred_remains",
  "cleared_lot"
] as const;
const VARIANTS_PER_STYLE = 5;
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
  kind: "main" | "annex";
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

const addBeamBetween = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number
): void => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length <= 1e-5) {
    return;
  }
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize()
  );
  const matrix = new THREE.Matrix4().compose(
    midpoint,
    rotation,
    new THREE.Vector3(thickness, length, thickness)
  );
  meshes.push({
    geometry: BOX_GEOMETRY,
    material,
    baseMatrix: matrix
  });
};

const addConvexPrism = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  outline: readonly THREE.Vector3[],
  thickness: number,
  outwardHint: THREE.Vector3
): void => {
  if (outline.length < 3) {
    return;
  }
  const basePoints = outline.map((point) => point.clone());
  const edgeA = basePoints[1].clone().sub(basePoints[0]);
  const edgeB = basePoints[2].clone().sub(basePoints[0]);
  const faceNormal = edgeA.cross(edgeB);
  if (faceNormal.lengthSq() <= 1e-8) {
    return;
  }
  if (faceNormal.dot(outwardHint) < 0) {
    basePoints.reverse();
    faceNormal.multiplyScalar(-1);
  }
  faceNormal.normalize();
  const offset = faceNormal.clone().multiplyScalar(thickness * 0.5);
  const positions: number[] = [];
  const indices: number[] = [];
  const pushPoint = (point: THREE.Vector3): void => {
    positions.push(point.x, point.y, point.z);
  };
  const topPoints = basePoints.map((point) => point.clone().add(offset));
  const bottomPoints = basePoints.map((point) => point.clone().sub(offset));
  topPoints.forEach(pushPoint);
  bottomPoints.forEach(pushPoint);
  const count = basePoints.length;
  for (let i = 1; i < count - 1; i += 1) {
    indices.push(0, i, i + 1);
  }
  const bottomOffset = count;
  for (let i = 1; i < count - 1; i += 1) {
    indices.push(bottomOffset, bottomOffset + i + 1, bottomOffset + i);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(i, next, bottomOffset + next);
    indices.push(i, bottomOffset + next, bottomOffset + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  meshes.push({
    geometry,
    material,
    baseMatrix: new THREE.Matrix4()
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

type HipRoofLayout = {
  ridgeAxis: "x" | "z";
  wallTopY: number;
  ridgeY: number;
  eaveHalfWidth: number;
  eaveHalfDepth: number;
  ridgeHalfLength: number;
};

const getHipRoofLayout = (mass: BuildingMass, baseY: number): HipRoofLayout => {
  const wallTopY = getMassBaseY(baseY, mass) + mass.wallHeight;
  const ridgeY = wallTopY + mass.roofHeight;
  const eaveHalfWidth = mass.width * 0.5 + ROOF_EAVE_OVERHANG;
  const eaveHalfDepth = mass.depth * 0.5 + ROOF_EAVE_OVERHANG;
  if (eaveHalfWidth >= eaveHalfDepth) {
    return {
      ridgeAxis: "x",
      wallTopY,
      ridgeY,
      eaveHalfWidth,
      eaveHalfDepth,
      ridgeHalfLength: Math.max(0, eaveHalfWidth - eaveHalfDepth)
    };
  }
  return {
    ridgeAxis: "z",
    wallTopY,
    ridgeY,
    eaveHalfWidth,
    eaveHalfDepth,
    ridgeHalfLength: Math.max(0, eaveHalfDepth - eaveHalfWidth)
  };
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

const getSpanScaledWindowCount = (spanTiles: number, minCount: number, maxCount: number, targetSpacingMeters: number): number => {
  const spanMeters = spanTiles * TILE_SIZE;
  const count = Math.round(spanMeters / Math.max(1, targetSpacingMeters));
  return Math.max(minCount, Math.min(maxCount, count));
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
  const matchingCompoundRoof =
    roofType === "gable" && hash2D(9, 7, seed) > 0.36;
  const cornerSign = hash2D(9, 8, seed) < 0.5 ? -1 : 1;
  return {
    side,
    width: clamp(footprintX * (0.34 + hash2D(9, 3, seed) * 0.18), 0.24, footprintX * 0.58),
    depth: clamp(footprintZ * (0.3 + hash2D(9, 4, seed) * 0.2), 0.22, footprintZ * 0.62),
    offset: matchingCompoundRoof
      ? cornerSign * clamp(0.82 + hash2D(9, 5, seed) * 0.18, 0.82, 1)
      : hash2D(9, 5, seed) * 0.56 - 0.28,
    heightScale: clamp(0.68 + hash2D(9, 6, seed) * 0.18, 0.68, 0.9),
    roofType: matchingCompoundRoof ? roofType : "lean_to"
  };
};

const chooseStoreys = (
  footprintX: number,
  footprintZ: number,
  seed: number
): 1 | 2 => {
  const minSpan = Math.min(footprintX, footprintZ) * TILE_SIZE;
  return minSpan >= 7.2 && hash2D(10, 1, seed) >= 0.58 ? 2 : 1;
};

const buildSpec = (footprintIndex: number, variationIndex: number): BuildingSpec => {
  const footprint = HOUSE_VARIANTS[footprintIndex % HOUSE_VARIANTS.length] ?? HOUSE_VARIANTS[0];
  const seed = footprintIndex * 811 + variationIndex * 271 + 137;
  const footprintX = clamp(
    footprint.sizeX * (0.92 + hash2D(variationIndex, 1, seed) * 0.16),
    footprint.sizeX * 0.9,
    footprint.sizeX * 1.1
  );
  const footprintZ = clamp(
    footprint.sizeZ * (0.92 + hash2D(variationIndex, 2, seed) * 0.16),
    footprint.sizeZ * 0.9,
    footprint.sizeZ * 1.1
  );
  const storeys = chooseStoreys(footprintX, footprintZ, seed);
  const roofPitch = clamp(0.48 + hash2D(variationIndex, 3, seed) * 0.32, 0.46, 0.8);
  const singleStoreyWallHeight = clamp(
    metersToTiles(2.38 + footprint.sizeY * 0.16 + hash2D(variationIndex, 4, seed) * 0.44),
    metersToTiles(2.35),
    metersToTiles(3.05)
  );
  const wallHeight = singleStoreyWallHeight * storeys;
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
    frontWindowCount: getSpanScaledWindowCount(footprintX, 1, 4, 4.1),
    sideWindowCount: getSpanScaledWindowCount(footprintZ, 1, 3, 4.5),
    porchDepth: clamp(metersToTiles(0.8 + hash2D(variationIndex, 12, seed) * 0.6), metersToTiles(0.8), metersToTiles(1.4)),
    storeys,
    annex: chooseAnnex(footprint.roofType, footprintX, footprintZ, seed)
  };
};

const makeStyleMaterials = (
  styleIndex: number,
  variationIndex: number,
  stage: BuildingLifecycleStage
): StylePalette => {
  const footprint = HOUSE_VARIANTS[styleIndex % HOUSE_VARIANTS.length] ?? HOUSE_VARIANTS[0];
  const isCharredStage = stage === "charred_remains" || stage === "cleared_lot";
  const darkenBy = isCharredStage ? 0.54 : 0;
  const wallBase = new THREE.Color(footprint.wallTint);
  const roofBase = new THREE.Color(footprint.roofTint);
  const roofVariantTargets = [
    new THREE.Color(0x342923),
    new THREE.Color(0x7b3d2e),
    new THREE.Color(0x6f5236),
    new THREE.Color(0x49515c),
    new THREE.Color(0x5c2620)
  ] as const;
  const roofVariantTarget = roofVariantTargets[variationIndex % roofVariantTargets.length] ?? roofBase;
  const frameBase = wallBase.clone().lerp(new THREE.Color(0xe4c79f), 0.58);
  const wallColor = wallBase.clone().lerp(new THREE.Color(0x1f1712), darkenBy);
  const roofColor = roofBase
    .clone()
    .lerp(roofVariantTarget, isCharredStage ? 0.18 : 0.58)
    .lerp(new THREE.Color(0x120d09), darkenBy * 0.95);
  const frameColor = frameBase.clone().lerp(new THREE.Color(0x1c140f), darkenBy);
  const charColor = new THREE.Color(0x2a211c).lerp(new THREE.Color(0x080604), darkenBy);

  const foundation = makeMaterial(isCharredStage ? 0x3b3129 : 0x675344, 0.95, 0);
  const frame = makeMaterial(isCharredStage ? charColor.getHex() : frameColor.getHex(), 0.84, 0.01);
  const wall = makeMaterial(isCharredStage ? charColor.getHex() : wallColor.getHex(), 0.82, 0.03);
  const roof = makeMaterial(isCharredStage ? charColor.getHex() : roofColor.getHex(), 0.86, 0.02);
  const trim = makeMaterial(isCharredStage ? charColor.getHex() : 0xead9c2, 0.72, 0);
  const glass = new THREE.MeshStandardMaterial({
    color: isCharredStage ? charColor.getHex() : 0x7ba5bc,
    roughness: 0.12,
    metalness: 0.16,
    transparent: !isCharredStage,
    opacity: !isCharredStage ? 0.88 : 1,
    emissive: !isCharredStage ? 0x203846 : 0x000000,
    emissiveIntensity: !isCharredStage ? 0.16 : 0
  });
  glass.depthWrite = true;
  const door = makeMaterial(isCharredStage ? charColor.getHex() : 0x7e5432, 0.8, 0);
  const recess = makeMaterial(isCharredStage ? 0x110d0a : 0x251912, 0.98, 0);
  const burn = makeMaterial(0x2b2118, 0.98, 0);
  const smoke = makeMaterial(isCharredStage ? 0x18110c : 0x5a4738, 0.96, 0);

  wall.color.offsetHSL(0.014 * styleIndex + 0.012 * variationIndex, 0.02 * (variationIndex - 2), 0.014 * (variationIndex - 2));
  roof.color.offsetHSL(0.014 * styleIndex - 0.018 * variationIndex, 0.05 * (variationIndex - 2), -0.025 * (2 - variationIndex));
  frame.color.offsetHSL(0.008 * variationIndex, 0.01 * (variationIndex - 2), 0.02);
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
      kind: "main",
      attachedSide: null
    }
  ];
  if (spec.annex) {
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
      wallHeight: (spec.wallHeight / spec.storeys) * annex.heightScale,
      roofHeight: spec.roofHeight * annex.heightScale * 0.82,
      roofType: annex.roofType,
      kind: "annex",
      attachedSide
    });
  }
  return masses;
};

const getMassBaseY = (baseY: number, _mass: BuildingMass): number => baseY;

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

type WallOpeningSpan = Opening & {
  left: number;
  right: number;
};

type VerticalRange = {
  bottom: number;
  top: number;
};

const toWallOpeningSpans = (openings: Opening[], halfSpan: number): WallOpeningSpan[] =>
  openings
    .map((opening) => ({
      ...opening,
      left: clamp(opening.center - opening.width * 0.5, -halfSpan, halfSpan),
      right: clamp(opening.center + opening.width * 0.5, -halfSpan, halfSpan)
    }))
    .filter((opening) => opening.right - opening.left > metersToTiles(0.04))
    .sort((a, b) => a.left - b.left || a.bottom - b.bottom);

const buildSolidVerticalRanges = (
  minBottom: number,
  maxTop: number,
  openings: readonly Pick<Opening, "bottom" | "height">[]
): VerticalRange[] => {
  const ranges: VerticalRange[] = [];
  let cursor = minBottom;
  openings
    .map((opening) => ({
      bottom: clamp(opening.bottom, minBottom, maxTop),
      top: clamp(opening.bottom + opening.height, minBottom, maxTop)
    }))
    .filter((opening) => opening.top - opening.bottom > metersToTiles(0.02))
    .sort((a, b) => a.bottom - b.bottom)
    .forEach((opening) => {
      if (opening.bottom > cursor + metersToTiles(0.02)) {
        ranges.push({ bottom: cursor, top: opening.bottom });
      }
      cursor = Math.max(cursor, opening.top);
    });
  if (cursor < maxTop - metersToTiles(0.02)) {
    ranges.push({ bottom: cursor, top: maxTop });
  }
  return ranges.filter((range) => range.top - range.bottom > metersToTiles(0.02));
};

const addWindowRow = (
  openings: Opening[],
  side: BuildingSide,
  centers: readonly number[],
  width: number,
  bottom: number,
  height: number,
  blockedCenter?: number,
  blockedWidth = 0
): void => {
  centers.forEach((center) => {
    if (
      blockedCenter !== undefined &&
      blockedWidth > 0 &&
      Math.abs(center - blockedCenter) < blockedWidth * 0.55 + width * 0.5
    ) {
      return;
    }
    openings.push({
      side,
      center,
      width,
      bottom,
      height,
      kind: "window"
    });
  });
};

const filterBlockedWindowCenters = (
  centers: readonly number[],
  width: number,
  blockedCenter?: number,
  blockedWidth = 0
): number[] =>
  centers.filter(
    (center) =>
      !(
        blockedCenter !== undefined &&
        blockedWidth > 0 &&
        Math.abs(center - blockedCenter) < blockedWidth * 0.55 + width * 0.5
      )
  );

const buildMainMassOpenings = (mass: BuildingMass, spec: BuildingSpec): Opening[] => {
  const storeyHeight = mass.wallHeight / spec.storeys;
  const doorWidth = clamp(metersToTiles(0.95 + Math.max(0, mass.width * TILE_SIZE - 9) * 0.04), metersToTiles(0.9), metersToTiles(1.15));
  const doorHeight = clamp(metersToTiles(2.02 + Math.max(0, storeyHeight * TILE_SIZE - 2.35) * 0.16), metersToTiles(2.0), metersToTiles(2.3));
  const frontWindowWidth = clamp(metersToTiles(1.05 + Math.max(0, mass.width * TILE_SIZE - 8.5) * 0.05), metersToTiles(1), metersToTiles(1.38));
  const sideWindowWidth = clamp(metersToTiles(0.94 + Math.max(0, mass.depth * TILE_SIZE - 7.2) * 0.05), metersToTiles(0.92), metersToTiles(1.22));
  const windowBottom = clamp(metersToTiles(0.72 + Math.max(0, storeyHeight * TILE_SIZE - 2.35) * 0.05), metersToTiles(0.7), metersToTiles(0.9));
  const alignedWindowTop = clamp(doorHeight, metersToTiles(1.98), storeyHeight - metersToTiles(0.18));
  const windowHeight = clamp(alignedWindowTop - windowBottom, metersToTiles(1.12), metersToTiles(1.38));
  const upperWindowBottom = storeyHeight + windowBottom;
  const openings: Opening[] = [];

  const frontWindowCenters =
    spec.entrySide === "front"
      ? [-mass.width * 0.26, mass.width * 0.26].slice(0, Math.max(1, Math.min(2, spec.frontWindowCount)))
      : distributePositions(spec.frontWindowCount, mass.width, mass.width * 0.22);
  const frontDoorCenter = spec.entrySide === "front" ? spec.doorOffset * mass.width : undefined;
  const visibleFrontWindowCenters = filterBlockedWindowCenters(frontWindowCenters, frontWindowWidth, frontDoorCenter, doorWidth);
  addWindowRow(openings, "front", visibleFrontWindowCenters, frontWindowWidth, windowBottom, windowHeight);
  if (spec.storeys === 2) {
    addWindowRow(openings, "front", visibleFrontWindowCenters, frontWindowWidth, upperWindowBottom, windowHeight);
  }

  const backWindowCount = spec.annex?.side === "back" ? 0 : Math.max(1, spec.frontWindowCount - 1);
  const backWindowCenters = distributePositions(backWindowCount, mass.width, mass.width * 0.24);
  addWindowRow(openings, "back", backWindowCenters, frontWindowWidth, windowBottom, windowHeight);
  if (spec.storeys === 2) {
    addWindowRow(openings, "back", backWindowCenters, frontWindowWidth, upperWindowBottom, windowHeight);
  }

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
  const sideDoorCenter = spec.entrySide === "left" || spec.entrySide === "right" ? spec.doorOffset * mass.depth : undefined;
  const sideDoorWidth = clamp(metersToTiles(0.9 + Math.max(0, mass.depth * TILE_SIZE - 7) * 0.04), metersToTiles(0.9), metersToTiles(1.1));
  const leftWindowCenters = filterBlockedWindowCenters(
    sideWindowCenters,
    sideWindowWidth,
    spec.entrySide === "left" ? sideDoorCenter : undefined,
    sideDoorWidth
  );
  const rightWindowCenters = filterBlockedWindowCenters(
    sideWindowCenters,
    sideWindowWidth,
    spec.entrySide === "right" ? sideDoorCenter : undefined,
    sideDoorWidth
  );
  addWindowRow(
    openings,
    "left",
    leftWindowCenters,
    sideWindowWidth,
    windowBottom,
    windowHeight
  );
  addWindowRow(
    openings,
    "right",
    rightWindowCenters,
    sideWindowWidth,
    windowBottom,
    windowHeight
  );
  if (spec.storeys === 2) {
    addWindowRow(openings, "left", leftWindowCenters, sideWindowWidth, upperWindowBottom, windowHeight);
    addWindowRow(openings, "right", rightWindowCenters, sideWindowWidth, upperWindowBottom, windowHeight);
  }

  if (spec.entrySide === "left" || spec.entrySide === "right") {
    openings.push({
      side: spec.entrySide,
      center: spec.doorOffset * mass.depth,
      width: sideDoorWidth,
      bottom: 0,
      height: doorHeight,
      kind: "door"
    });
  }

  return openings;
};

const buildAnnexOpenings = (mass: BuildingMass): Opening[] => {
  const windowWidth = clamp(metersToTiles(0.94 + Math.max(0, Math.min(mass.width, mass.depth) * TILE_SIZE - 6) * 0.05), metersToTiles(0.9), metersToTiles(1.18));
  const windowBottom = clamp(metersToTiles(0.72 + Math.max(0, mass.wallHeight * TILE_SIZE - 2.1) * 0.05), metersToTiles(0.7), metersToTiles(0.9));
  const windowTop = clamp(metersToTiles(2.06), metersToTiles(1.96), mass.wallHeight - metersToTiles(0.16));
  const windowHeight = clamp(windowTop - windowBottom, metersToTiles(1.1), metersToTiles(1.3));
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
  mass.kind === "annex" ? buildAnnexOpenings(mass) : buildMainMassOpenings(mass, spec);

const FULL_WALL_SIDES: readonly BuildingSide[] = ["front", "back", "left", "right"];

const getEnclosedWallSides = (mass: BuildingMass, spec: BuildingSpec): readonly BuildingSide[] => {
  if (mass.kind === "annex") {
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
  if (mass.kind === "annex") {
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
  openings: Opening[] = [],
  sides: readonly BuildingSide[] = FULL_WALL_SIDES
): void => {
  const massBaseY = getMassBaseY(baseY, mass);
  sides.forEach((side) => {
    const span = side === "front" || side === "back" ? mass.width : mass.depth;
    const halfSpan = span * 0.5;
    const wallOpenings = toWallOpeningSpans(openingsForWall(openings, side), halfSpan);

    if (wallOpenings.length === 0) {
      addWallOrientedBox(meshes, material, mass, side, 0, massBaseY + mass.wallHeight * 0.5, span, mass.wallHeight, wallThickness);
      return;
    }

    const xBreaks = Array.from(
      new Set(
        [-halfSpan, halfSpan, ...wallOpenings.flatMap((opening) => [opening.left, opening.right])].map((value) =>
          Number(value.toFixed(4))
        )
      )
    ).sort((a, b) => a - b);

    for (let index = 0; index < xBreaks.length - 1; index += 1) {
      const start = xBreaks[index] ?? 0;
      const end = xBreaks[index + 1] ?? 0;
      const sectionWidth = end - start;
      if (sectionWidth <= metersToTiles(0.02)) {
        continue;
      }
      const sectionCenter = start + sectionWidth * 0.5;
      const sectionOpenings = wallOpenings.filter(
        (opening) => sectionCenter > opening.left + metersToTiles(0.01) && sectionCenter < opening.right - metersToTiles(0.01)
      );
      const solidRanges =
        sectionOpenings.length === 0
          ? [{ bottom: 0, top: mass.wallHeight }]
          : buildSolidVerticalRanges(0, mass.wallHeight, sectionOpenings);
      solidRanges.forEach((range) => {
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          sectionCenter,
          massBaseY + range.bottom + (range.top - range.bottom) * 0.5,
          sectionWidth,
          range.top - range.bottom,
          wallThickness
        );
      });
    }
  });
};

const addWallTopTrim = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number
): void => {
  const massBaseY = getMassBaseY(baseY, mass);
  FULL_WALL_SIDES.forEach((side) => {
    const span = side === "front" || side === "back" ? mass.width : mass.depth;
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      0,
      massBaseY + mass.wallHeight + TOP_TRIM_THICKNESS * 0.5,
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
  progress = 1,
  surfaceInset = 0
): void => {
  const massBaseY = getMassBaseY(baseY, mass);
  const span = side === "front" || side === "back" ? mass.width : mass.depth;
  const halfSpan = span * 0.5;
  addWallOrientedBox(meshes, material, mass, side, 0, massBaseY + thickness * 0.5, span, thickness, thickness, surfaceInset);
  addWallOrientedBox(
    meshes,
    material,
    mass,
    side,
    0,
    massBaseY + mass.wallHeight - thickness * 0.5,
    span,
    thickness,
    thickness,
    surfaceInset
  );

  const positions = new Set<number>([-halfSpan, halfSpan]);
  for (let pos = -halfSpan + studSpacing; pos < halfSpan; pos += studSpacing) {
    positions.add(Number(pos.toFixed(4)));
  }
  const wallOpenings = toWallOpeningSpans(openingsForWall(openings, side), halfSpan);
  const sortedPositions = limitFramePositions(
    Array.from(positions).sort((a, b) => a - b),
    progress
  );
  const progressEdge = -halfSpan + span * clamp(progress, 0, 1);
  sortedPositions
    .forEach((position) => {
      const coveringOpenings = wallOpenings.filter(
        (entry) => position > entry.left + thickness * 0.2 && position < entry.right - thickness * 0.2
      );
      if (coveringOpenings.length === 0) {
        const studHeight = Math.max(0.06, mass.wallHeight - thickness * 2);
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          position,
          massBaseY + thickness + studHeight * 0.5,
          thickness,
          studHeight,
          thickness,
          surfaceInset
        );
        return;
      }
      const solidRanges = buildSolidVerticalRanges(thickness, mass.wallHeight - thickness, coveringOpenings);
      solidRanges.forEach((range) => {
        addWallOrientedBox(
          meshes,
          material,
          mass,
          side,
          position,
          massBaseY + range.bottom + (range.top - range.bottom) * 0.5,
          thickness,
          range.top - range.bottom,
          thickness,
          surfaceInset
        );
      });
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
      massBaseY + mass.wallHeight * 0.5,
      thickness,
      Math.max(0.08, mass.wallHeight - thickness),
      thickness,
      surfaceInset
    );
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      right,
      massBaseY + mass.wallHeight * 0.5,
      thickness,
      Math.max(0.08, mass.wallHeight - thickness),
      thickness,
      surfaceInset
    );
    addWallOrientedBox(
      meshes,
      material,
      mass,
      side,
      opening.center,
      massBaseY + opening.bottom + opening.height + thickness * 0.5,
      opening.width + thickness * 1.2,
      thickness,
      thickness,
      surfaceInset
    );
    if (opening.kind === "window") {
      addWallOrientedBox(
        meshes,
        material,
        mass,
        side,
        opening.center,
        massBaseY + opening.bottom - thickness * 0.5,
        opening.width + thickness * 1.2,
        thickness,
        thickness,
        surfaceInset
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
  const wallTopY = getMassBaseY(baseY, mass) + mass.wallHeight;
  if (mass.roofType === "lean_to") {
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
  if (mass.roofType === "hip") {
    const layout = getHipRoofLayout(mass, baseY);
    const ridgeLength = Math.max(layout.ridgeHalfLength * 2, thickness * 1.2);
    addBox(
      meshes,
      material,
      mass.centerX,
      layout.ridgeY,
      mass.centerZ,
      layout.ridgeAxis === "x" ? ridgeLength : thickness,
      thickness,
      layout.ridgeAxis === "z" ? ridgeLength : thickness
    );
    const leftX = mass.centerX - layout.eaveHalfWidth;
    const rightX = mass.centerX + layout.eaveHalfWidth;
    const frontZ = mass.centerZ - layout.eaveHalfDepth;
    const backZ = mass.centerZ + layout.eaveHalfDepth;
    if (layout.ridgeAxis === "x") {
      const ridgeLeft = new THREE.Vector3(mass.centerX - layout.ridgeHalfLength, layout.ridgeY, mass.centerZ);
      const ridgeRight = new THREE.Vector3(mass.centerX + layout.ridgeHalfLength, layout.ridgeY, mass.centerZ);
      addBeamBetween(meshes, material, new THREE.Vector3(leftX, wallTopY, frontZ), ridgeLeft, thickness);
      addBeamBetween(meshes, material, new THREE.Vector3(rightX, wallTopY, frontZ), ridgeRight, thickness);
      addBeamBetween(meshes, material, new THREE.Vector3(leftX, wallTopY, backZ), ridgeLeft, thickness);
      addBeamBetween(meshes, material, new THREE.Vector3(rightX, wallTopY, backZ), ridgeRight, thickness);
      const rafterXPositions = limitFramePositions(
        distributePositions(
          Math.max(2, Math.round((layout.ridgeHalfLength * 2) / Math.max(studSpacing, 0.12))) + 1,
          Math.max(thickness * 2, layout.ridgeHalfLength * 2),
          thickness
        ),
        progress
      );
      rafterXPositions.forEach((xOffset) => {
        const ridgePoint = new THREE.Vector3(mass.centerX + xOffset, layout.ridgeY, mass.centerZ);
        addBeamBetween(meshes, material, ridgePoint, new THREE.Vector3(mass.centerX + xOffset, wallTopY, frontZ), thickness);
        addBeamBetween(meshes, material, ridgePoint, new THREE.Vector3(mass.centerX + xOffset, wallTopY, backZ), thickness);
      });
      return;
    }
    const ridgeFront = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ - layout.ridgeHalfLength);
    const ridgeBack = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ + layout.ridgeHalfLength);
    addBeamBetween(meshes, material, new THREE.Vector3(leftX, wallTopY, frontZ), ridgeFront, thickness);
    addBeamBetween(meshes, material, new THREE.Vector3(rightX, wallTopY, frontZ), ridgeFront, thickness);
    addBeamBetween(meshes, material, new THREE.Vector3(leftX, wallTopY, backZ), ridgeBack, thickness);
    addBeamBetween(meshes, material, new THREE.Vector3(rightX, wallTopY, backZ), ridgeBack, thickness);
    const rafterZPositions = limitFramePositions(
      distributePositions(
        Math.max(2, Math.round((layout.ridgeHalfLength * 2) / Math.max(studSpacing, 0.12))) + 1,
        Math.max(thickness * 2, layout.ridgeHalfLength * 2),
        thickness
      ),
      progress
    );
    rafterZPositions.forEach((zOffset) => {
      const ridgePoint = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ + zOffset);
      addBeamBetween(meshes, material, ridgePoint, new THREE.Vector3(leftX, wallTopY, mass.centerZ + zOffset), thickness);
      addBeamBetween(meshes, material, ridgePoint, new THREE.Vector3(rightX, wallTopY, mass.centerZ + zOffset), thickness);
    });
    return;
  }

  const roofRun = mass.depth * 0.5 + ROOF_EAVE_OVERHANG;
  const roofWidth = mass.width + ROOF_EAVE_OVERHANG * 2;
  const ridgeLengthBase = roofWidth;
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
  const wallTopY = getMassBaseY(baseY, mass) + mass.wallHeight;
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
  const layout = getHipRoofLayout(mass, baseY);
  const leftX = mass.centerX - layout.eaveHalfWidth;
  const rightX = mass.centerX + layout.eaveHalfWidth;
  const frontZ = mass.centerZ - layout.eaveHalfDepth;
  const backZ = mass.centerZ + layout.eaveHalfDepth;
  if (layout.ridgeAxis === "x") {
    const ridgeLeft = new THREE.Vector3(mass.centerX - layout.ridgeHalfLength, layout.ridgeY, mass.centerZ);
    const ridgeRight = new THREE.Vector3(mass.centerX + layout.ridgeHalfLength, layout.ridgeY, mass.centerZ);
    const frontLeft = new THREE.Vector3(leftX, layout.wallTopY, frontZ);
    const frontRight = new THREE.Vector3(rightX, layout.wallTopY, frontZ);
    const backLeft = new THREE.Vector3(leftX, layout.wallTopY, backZ);
    const backRight = new THREE.Vector3(rightX, layout.wallTopY, backZ);

    if (layout.ridgeHalfLength <= metersToTiles(0.02)) {
      const apex = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ);
      addConvexPrism(meshes, material, [frontLeft, frontRight, apex], panelThickness, new THREE.Vector3(0, 0, -1));
      if (!partial) {
        addConvexPrism(meshes, material, [backRight, backLeft, apex], panelThickness, new THREE.Vector3(0, 0, 1));
        addConvexPrism(meshes, material, [backLeft, frontLeft, apex], panelThickness, new THREE.Vector3(-1, 0, 0));
        addConvexPrism(meshes, material, [frontRight, backRight, apex], panelThickness, new THREE.Vector3(1, 0, 0));
      }
      return;
    }

    addConvexPrism(
      meshes,
      material,
      [frontLeft, frontRight, ridgeRight, ridgeLeft],
      panelThickness,
      new THREE.Vector3(0, 0, -1)
    );
    if (partial) {
      return;
    }
    addConvexPrism(
      meshes,
      material,
      [backRight, backLeft, ridgeLeft, ridgeRight],
      panelThickness,
      new THREE.Vector3(0, 0, 1)
    );
    addConvexPrism(
      meshes,
      material,
      [backLeft, frontLeft, ridgeLeft],
      panelThickness,
      new THREE.Vector3(-1, 0, 0)
    );
    addConvexPrism(
      meshes,
      material,
      [frontRight, backRight, ridgeRight],
      panelThickness,
      new THREE.Vector3(1, 0, 0)
    );
    return;
  }

  const ridgeFront = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ - layout.ridgeHalfLength);
  const ridgeBack = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ + layout.ridgeHalfLength);
  const frontLeft = new THREE.Vector3(leftX, layout.wallTopY, frontZ);
  const frontRight = new THREE.Vector3(rightX, layout.wallTopY, frontZ);
  const backLeft = new THREE.Vector3(leftX, layout.wallTopY, backZ);
  const backRight = new THREE.Vector3(rightX, layout.wallTopY, backZ);

  if (layout.ridgeHalfLength <= metersToTiles(0.02)) {
    const apex = new THREE.Vector3(mass.centerX, layout.ridgeY, mass.centerZ);
    addConvexPrism(meshes, material, [frontLeft, frontRight, apex], panelThickness, new THREE.Vector3(0, 0, -1));
    if (!partial) {
      addConvexPrism(meshes, material, [backRight, backLeft, apex], panelThickness, new THREE.Vector3(0, 0, 1));
      addConvexPrism(meshes, material, [backLeft, frontLeft, apex], panelThickness, new THREE.Vector3(-1, 0, 0));
      addConvexPrism(meshes, material, [frontRight, backRight, apex], panelThickness, new THREE.Vector3(1, 0, 0));
    }
    return;
  }

  addConvexPrism(
    meshes,
    material,
    [backLeft, frontLeft, ridgeFront, ridgeBack],
    panelThickness,
    new THREE.Vector3(-1, 0, 0)
  );
  if (partial) {
    return;
  }
  addConvexPrism(
    meshes,
    material,
    [frontRight, backRight, ridgeBack, ridgeFront],
    panelThickness,
    new THREE.Vector3(1, 0, 0)
  );
  addConvexPrism(
    meshes,
    material,
    [frontLeft, frontRight, ridgeFront],
    panelThickness,
    new THREE.Vector3(0, 0, -1)
  );
  addConvexPrism(
    meshes,
    material,
    [backRight, backLeft, ridgeBack],
    panelThickness,
    new THREE.Vector3(0, 0, 1)
  );
};

const addLeanToRoof = (
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
    getMassBaseY(baseY, mass) + mass.wallHeight + mass.roofHeight * 0.5,
    mass.centerZ,
    (mass.width + ROOF_EAVE_OVERHANG * 2) * (partial ? 0.76 : 1),
    Math.max(metersToTiles(0.08), mass.roofHeight * 0.14),
    Math.hypot(roofRun, mass.roofHeight),
    -Math.atan2(mass.roofHeight, Math.max(0.12, roofRun)),
    0,
    0
  );
};

const addRoofWallInfill = (
  meshes: BuildingMeshTemplate[],
  material: THREE.MeshStandardMaterial,
  mass: BuildingMass,
  baseY: number,
  wallThickness: number,
  visibleSides: readonly BuildingSide[] = FULL_WALL_SIDES
): void => {
  const wallTopY = getMassBaseY(baseY, mass) + mass.wallHeight;
  const infillThickness = Math.max(wallThickness, metersToTiles(0.08));
  const topOverlap = Math.max(metersToTiles(0.02), wallThickness * 0.12);
  const leftX = mass.centerX - mass.width * 0.5 + infillThickness * 0.5;
  const rightX = mass.centerX + mass.width * 0.5 - infillThickness * 0.5;
  const frontZ = mass.centerZ - mass.depth * 0.5;
  const backZ = mass.centerZ + mass.depth * 0.5;
  const roofTopY = wallTopY + mass.roofHeight + topOverlap;

  if (mass.roofType === "gable") {
    if (visibleSides.includes("left")) {
      addConvexPrism(
        meshes,
        material,
        [
          new THREE.Vector3(leftX, wallTopY, frontZ),
          new THREE.Vector3(leftX, wallTopY, backZ),
          new THREE.Vector3(leftX, roofTopY, mass.centerZ)
        ],
        infillThickness,
        new THREE.Vector3(-1, 0, 0)
      );
    }
    if (visibleSides.includes("right")) {
      addConvexPrism(
        meshes,
        material,
        [
          new THREE.Vector3(rightX, wallTopY, backZ),
          new THREE.Vector3(rightX, wallTopY, frontZ),
          new THREE.Vector3(rightX, roofTopY, mass.centerZ)
        ],
        infillThickness,
        new THREE.Vector3(1, 0, 0)
      );
    }
    return;
  }

  if (mass.roofType !== "lean_to") {
    return;
  }

  if (visibleSides.includes("back")) {
    addWallOrientedBox(
      meshes,
      material,
      mass,
      "back",
      0,
      wallTopY + (mass.roofHeight + topOverlap) * 0.5,
      mass.width,
      mass.roofHeight + topOverlap,
      infillThickness
    );
  }
  if (visibleSides.includes("left")) {
    addConvexPrism(
      meshes,
      material,
      [
        new THREE.Vector3(leftX, wallTopY, frontZ),
        new THREE.Vector3(leftX, wallTopY, backZ),
        new THREE.Vector3(leftX, roofTopY, backZ)
      ],
      infillThickness,
      new THREE.Vector3(-1, 0, 0)
    );
  }
  if (visibleSides.includes("right")) {
    addConvexPrism(
      meshes,
      material,
      [
        new THREE.Vector3(rightX, wallTopY, backZ),
        new THREE.Vector3(rightX, wallTopY, frontZ),
        new THREE.Vector3(rightX, roofTopY, backZ)
      ],
      infillThickness,
      new THREE.Vector3(1, 0, 0)
    );
  }
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
  addLeanToRoof(meshes, material, mass, baseY, partial);
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
  const recessInset = Math.max(metersToTiles(0.04), wallThickness * 0.32);
  const frameInset = -wallThickness * 0.04;
  const glassInset = Math.max(metersToTiles(0.012), recessInset - wallThickness * 0.06);
  const doorInset = recessInset + wallThickness * 0.08;
  const massBaseY = getMassBaseY(baseY, mass);
  openings.forEach((opening) => {
    const jambWidth = clamp(opening.width * 0.12, metersToTiles(0.08), metersToTiles(0.14));
    const headHeight = clamp(opening.height * 0.11, metersToTiles(0.08), metersToTiles(0.14));
    const centerY = massBaseY + opening.bottom + opening.height * 0.5;
    if (stage === "enclosed") {
      addWallOrientedBox(
        meshes,
        palette.recess,
        mass,
        opening.side,
        opening.center,
        centerY,
        opening.kind === "door" ? opening.width * 0.92 : opening.width * 0.76,
        opening.kind === "door" ? opening.height * 0.96 : opening.height * 0.72,
        opening.kind === "door" ? wallThickness * 0.52 : wallThickness * 0.12,
        opening.kind === "door" ? recessInset : recessInset + wallThickness * 0.18
      );
      return;
    }
    if (opening.kind === "door") {
      addWallOrientedBox(
        meshes,
        palette.recess,
        mass,
        opening.side,
        opening.center,
        centerY,
        opening.width * 0.92,
        opening.height * 0.96,
        wallThickness * 0.52,
        recessInset
      );
      addWallOrientedBox(
        meshes,
        palette.trim,
        mass,
        opening.side,
        opening.center,
        massBaseY + opening.bottom + opening.height - headHeight * 0.5,
        opening.width + jambWidth * 0.35,
        headHeight,
        wallThickness * 0.18,
        frameInset
      );
      addWallOrientedBox(
        meshes,
        palette.trim,
        mass,
        opening.side,
        opening.center - opening.width * 0.5 + jambWidth * 0.5,
        massBaseY + opening.bottom + opening.height * 0.5,
        jambWidth,
        opening.height,
        wallThickness * 0.18,
        frameInset
      );
      addWallOrientedBox(
        meshes,
        palette.trim,
        mass,
        opening.side,
        opening.center + opening.width * 0.5 - jambWidth * 0.5,
        massBaseY + opening.bottom + opening.height * 0.5,
        jambWidth,
        opening.height,
        wallThickness * 0.18,
        frameInset
      );
      addWallOrientedBox(
        meshes,
        palette.door,
        mass,
        opening.side,
        opening.center,
        massBaseY + opening.bottom + opening.height * 0.48,
        opening.width * 0.78,
        opening.height * 0.96,
        wallThickness * 0.16,
        doorInset
      );
      return;
    }
    const glassWidth = Math.max(metersToTiles(0.52), opening.width - jambWidth * 2.2);
    const glassHeight = Math.max(metersToTiles(0.68), opening.height - headHeight * 2.2);
    addWallOrientedBox(
      meshes,
      palette.recess,
      mass,
      opening.side,
      opening.center,
      centerY,
      glassWidth * 1.04,
      glassHeight * 1.06,
      wallThickness * 0.08,
      recessInset + wallThickness * 0.18
    );
    addWallOrientedBox(
      meshes,
      palette.smoke,
      mass,
      opening.side,
      opening.center,
      centerY,
      glassWidth * 0.94,
      glassHeight * 0.96,
      wallThickness * 0.04,
      recessInset + wallThickness * 0.26
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center,
      massBaseY + opening.bottom + opening.height - headHeight * 0.5,
      opening.width + jambWidth * 0.2,
      headHeight,
      wallThickness * 0.16,
      frameInset
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center,
      massBaseY + opening.bottom + headHeight * 0.5,
      opening.width + jambWidth * 0.28,
      headHeight * 1.08,
      wallThickness * 0.18,
      frameInset
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center - opening.width * 0.5 + jambWidth * 0.5,
      centerY,
      jambWidth,
      opening.height,
      wallThickness * 0.18,
      frameInset
    );
    addWallOrientedBox(
      meshes,
      palette.trim,
      mass,
      opening.side,
      opening.center + opening.width * 0.5 - jambWidth * 0.5,
      centerY,
      jambWidth,
      opening.height,
      wallThickness * 0.18,
      frameInset
    );
    addWallOrientedBox(
      meshes,
      palette.glass,
      mass,
      opening.side,
      opening.center,
      centerY,
      glassWidth,
      glassHeight,
      wallThickness * 0.16,
      glassInset
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
  if (spec.entrySide !== "front" || spec.porchDepth < 0.08 || mass.kind !== "main") {
    return;
  }
  const deckWidth = mass.width * 0.34;
  const deckDepth = spec.porchDepth;
  const frontZ = mass.centerZ - mass.depth * 0.5 - deckDepth * 0.36;
  const massBaseY = getMassBaseY(baseY, mass);
  addBox(
    meshes,
    palette.foundation,
    mass.centerX + spec.doorOffset * mass.width * 0.18,
    massBaseY + metersToTiles(0.12),
    frontZ,
    deckWidth,
    metersToTiles(0.14),
    deckDepth
  );
  addBox(
    meshes,
    palette.trim,
    mass.centerX + spec.doorOffset * mass.width * 0.18,
    massBaseY + mass.wallHeight * 0.74,
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
      massBaseY + mass.wallHeight * 0.38,
      frontZ,
      metersToTiles(0.12),
      mass.wallHeight * 0.74,
      metersToTiles(0.12)
    );
  });
};

const addLotMarkerLayout = (
  meshes: BuildingMeshTemplate[],
  palette: StylePalette,
  width: number,
  depth: number,
  baseY: number
): void => {
  const stakeHeight = metersToTiles(0.58);
  const stakeThickness = metersToTiles(0.08);
  const halfWidth = Math.max(stakeThickness * 1.4, width * 0.5);
  const halfDepth = Math.max(stakeThickness * 1.4, depth * 0.5);
  const markerY = baseY + stakeHeight * 0.5;
  const corners = [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: -halfWidth, z: halfDepth },
    { x: halfWidth, z: halfDepth }
  ];
  corners.forEach((corner) => {
    addBox(meshes, palette.frame, corner.x, markerY, corner.z, stakeThickness, stakeHeight, stakeThickness);
  });
  addBox(
    meshes,
    palette.trim,
    0,
    baseY + stakeHeight * 0.84,
    -halfDepth,
    Math.max(stakeThickness, width),
    stakeThickness * 0.45,
    stakeThickness * 0.4
  );
  addBox(
    meshes,
    palette.trim,
    0,
    baseY + stakeHeight * 0.84,
    halfDepth,
    Math.max(stakeThickness, width),
    stakeThickness * 0.45,
    stakeThickness * 0.4
  );
  addBox(
    meshes,
    palette.trim,
    -halfWidth,
    baseY + stakeHeight * 0.84,
    0,
    stakeThickness * 0.4,
    stakeThickness * 0.45,
    Math.max(stakeThickness, depth)
  );
  addBox(
    meshes,
    palette.trim,
    halfWidth,
    baseY + stakeHeight * 0.84,
    0,
    stakeThickness * 0.4,
    stakeThickness * 0.45,
    Math.max(stakeThickness, depth)
  );
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
  const fittedFootprintX = Math.max(foundationWidth, localSize.x);
  const fittedFootprintZ = Math.max(foundationDepth, localSize.z);
  return {
    meshes: recenteredMeshes,
    height: Math.max(0.01, localSize.y),
    baseOffset: -localBounds.min.y,
    size: localSize,
    planFootprint: new THREE.Vector2(fittedFootprintX, fittedFootprintZ),
    heightScaleMode: "anchored",
    doorWidth: metersToTiles(1),
    scaleBias: 0.96,
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
  const palette = makeStyleMaterials(footprintIndex, variationIndex, stage);
  const masses = createMasses(spec);
  const meshes: BuildingMeshTemplate[] = [];
  const baseY = metersToTiles(0.35);
  const foundationInset = metersToTiles(0.4);
  const foundationWidth = Math.max(...masses.map((mass) => Math.abs(mass.centerX) + mass.width * 0.5)) * 2 + foundationInset;
  const foundationDepth = Math.max(...masses.map((mass) => Math.abs(mass.centerZ) + mass.depth * 0.5)) * 2 + foundationInset;
  const includeFoundationBase = stage !== "empty_lot";
  if (includeFoundationBase) {
    addBox(meshes, palette.foundation, 0, baseY * 0.5, 0, foundationWidth, baseY, foundationDepth);
  }

  if (stage === "empty_lot") {
    addLotMarkerLayout(meshes, palette, foundationWidth, foundationDepth, 0);
    return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
  }

  if (stage === "site_prep" || stage === "cleared_lot") {
    const foundationProgress = getSteppedValue(FOUNDATION_STEP_POST_THRESHOLDS, visualStep);
    masses.forEach((mass) => {
      addFoundationLayout(meshes, palette.frame, mass, baseY, Math.max(0.02, spec.frameThickness * 1.1), foundationProgress);
    });
    return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
  }

  const frameMaterial = stage === "charred_remains" ? palette.burn : palette.frame;
  const roofFrameMaterial = stage === "charred_remains" ? palette.burn : palette.frame;
  const frameThickness = spec.frameThickness;
  const wallThickness = Math.max(0.05, frameThickness * 2.15);
  const frameInset = Math.max(0, wallThickness - frameThickness) * 0.7;

  if (stage === "frame") {
    const wallProgress = getSteppedValue(FRAME_WALL_PROGRESS_STEPS, visualStep);
    const roofProgress = getSteppedValue(FRAME_ROOF_PROGRESS_STEPS, visualStep);
    masses.forEach((mass) => {
      const openings = resolveMassOpenings(mass, spec);
      const sideSequence = getRaisedFrameSides(mass, spec);
      const visibleSideCount = Math.ceil(wallProgress * sideSequence.length);
      takeFirstSides(sideSequence, visibleSideCount).forEach((side) => {
        addWallFrame(
          meshes,
          frameMaterial,
          mass,
          side,
          baseY,
          frameThickness,
          spec.studSpacing,
          openings,
          wallProgress,
          frameInset
        );
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

  if (stage === "charred_remains") {
    masses.forEach((mass) => {
      const burntMass = {
        ...mass,
        wallHeight: mass.wallHeight * 0.58,
        roofHeight: 0
      };
      addWallFrame(meshes, palette.burn, burntMass, "front", baseY, frameThickness, spec.studSpacing, [], 1, frameInset);
      addWallFrame(meshes, palette.burn, burntMass, "back", baseY, frameThickness, spec.studSpacing, [], 1, frameInset);
      addWallFrame(meshes, palette.burn, burntMass, "left", baseY, frameThickness, spec.studSpacing, [], 1, frameInset);
      addWallFrame(meshes, palette.burn, burntMass, "right", baseY, frameThickness, spec.studSpacing, [], 1, frameInset);
    });
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
    return finalizeVariant(meshes, spec, stage, visualStep, theme, foundationWidth, foundationDepth);
  }

  masses.forEach((mass) => {
    const openings = resolveMassOpenings(mass, spec);
    addWallFrame(meshes, frameMaterial, mass, "front", baseY, frameThickness, spec.studSpacing, openings, 1, frameInset);
    addWallFrame(meshes, frameMaterial, mass, "back", baseY, frameThickness, spec.studSpacing, openings, 1, frameInset);
    addWallFrame(meshes, frameMaterial, mass, "left", baseY, frameThickness, spec.studSpacing, openings, 1, frameInset);
    addWallFrame(meshes, frameMaterial, mass, "right", baseY, frameThickness, spec.studSpacing, openings, 1, frameInset);
    addRoofFrame(meshes, roofFrameMaterial, mass, baseY, frameThickness, spec.studSpacing);

    if (stage === "enclosed") {
      const wallSideSequence = getEnclosedWallSides(mass, spec);
      const wallCoverageCount = Math.max(
        1,
        Math.min(wallSideSequence.length, getSteppedValue(ENCLOSED_WALL_COVERAGE_STEPS, visualStep))
      );
      const visibleSides = takeFirstSides(wallSideSequence, wallCoverageCount);
      addWallShell(meshes, palette.wall, mass, baseY, wallThickness, openings, visibleSides);
      addRoofWallInfill(meshes, palette.wall, mass, baseY, wallThickness, visibleSides);
      addMassRoof(meshes, palette.roof, mass, baseY, visualStep >= ENCLOSED_ROOF_FULL_STEP ? false : true);
      addOpeningFeatures(meshes, palette, mass, openings, baseY, stage, wallThickness);
      return;
    }

    if (stage === "roofed") {
      addWallShell(meshes, palette.wall, mass, baseY, wallThickness, openings);
      addRoofWallInfill(meshes, palette.wall, mass, baseY, wallThickness);
      addMassRoof(meshes, palette.roof, mass, baseY);
      addOpeningFeatures(meshes, palette, mass, openings, baseY, stage, wallThickness);
    }
  });

  if (stage === "roofed") {
    addFrontPorch(meshes, palette, spec, masses[0], baseY);
    masses.forEach((mass) => {
      addWallTopTrim(meshes, palette.trim, mass, baseY);
    });
    const chimneyMass = masses.sort((left, right) => right.width * right.depth - left.width * left.depth)[0] ?? masses[0];
    const chimneyBaseY = getMassBaseY(baseY, chimneyMass);
    addChimney(
      meshes,
      palette.smoke,
      chimneyMass.centerX + chimneyMass.width * 0.26,
      chimneyBaseY + chimneyMass.wallHeight + chimneyMass.roofHeight * 0.58,
      chimneyMass.centerZ + chimneyMass.depth * 0.12,
      Math.max(0.05, chimneyMass.width * 0.08),
      Math.max(0.08, chimneyMass.roofHeight * 0.34),
      Math.max(0.05, chimneyMass.depth * 0.08)
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
