import * as THREE from "three";
import { TILE_SIZE } from "../../../core/config.js";
import type { WatchTowerLevel } from "../../../core/types.js";
import {
  addBoxPart,
  addCylinderBetween,
  addFootingPads,
  createFourLegTowerScaffold
} from "../../../shared/rendering/proceduralTowerScaffold.js";

const makeMaterial = (color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const metersToTiles = (meters: number): number => meters / Math.max(0.001, TILE_SIZE);

const clampWatchTowerLevel = (level: WatchTowerLevel | number): WatchTowerLevel =>
  level <= 1 ? 1 : level >= 3 ? 3 : 2;

const addRailings = (
  group: THREE.Group,
  deckY: number,
  width: number,
  postMaterial: THREE.Material,
  railMaterial: THREE.Material
): void => {
  const half = width * 0.5;
  const postBottom = deckY + metersToTiles(0.18);
  const postTop = deckY + metersToTiles(1.25);
  const railY = deckY + metersToTiles(1.12);
  const corners = [
    new THREE.Vector3(-half, postBottom, -half),
    new THREE.Vector3(half, postBottom, -half),
    new THREE.Vector3(half, postBottom, half),
    new THREE.Vector3(-half, postBottom, half)
  ];
  corners.forEach((corner) => {
    addCylinderBetween(group, corner, new THREE.Vector3(corner.x, postTop, corner.z), metersToTiles(0.07), postMaterial, 5, "watch-tower-railing-post");
  });
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    addCylinderBetween(
      group,
      new THREE.Vector3(corners[index].x, railY, corners[index].z),
      new THREE.Vector3(corners[next].x, railY, corners[next].z),
      metersToTiles(0.075),
      railMaterial,
      5,
      "watch-tower-railing"
    );
  }
};

const widthAtHeight = (height: number, baseWidth: number, topWidth: number, y: number): number => {
  const t = height <= 0 ? 0 : THREE.MathUtils.clamp(y / height, 0, 1);
  return THREE.MathUtils.lerp(baseWidth, topWidth, t);
};

const getSquareStairPoint = (
  side: number,
  along: number,
  scaffoldHalfWidth: number,
  stairOffset: number
): { position: THREE.Vector3; rotationY: number; anchor: THREE.Vector3 } => {
  const edge = scaffoldHalfWidth;
  const outside = scaffoldHalfWidth + stairOffset;
  const spanPosition = THREE.MathUtils.lerp(-edge, edge, along);
  switch (side) {
    case 0:
      return {
        position: new THREE.Vector3(spanPosition, 0, -outside),
        rotationY: 0,
        anchor: new THREE.Vector3(spanPosition, 0, -edge)
      };
    case 1:
      return {
        position: new THREE.Vector3(outside, 0, spanPosition),
        rotationY: Math.PI * 0.5,
        anchor: new THREE.Vector3(edge, 0, spanPosition)
      };
    case 2:
      return {
        position: new THREE.Vector3(-spanPosition, 0, outside),
        rotationY: Math.PI,
        anchor: new THREE.Vector3(-spanPosition, 0, edge)
      };
    default:
      return {
        position: new THREE.Vector3(-outside, 0, -spanPosition),
        rotationY: Math.PI * 1.5,
        anchor: new THREE.Vector3(-edge, 0, -spanPosition)
      };
  }
};

const addSquareWrapStairs = (
  group: THREE.Group,
  height: number,
  baseWidth: number,
  topWidth: number,
  stepMaterial: THREE.Material,
  railMaterial: THREE.Material
): void => {
  const stepRise = metersToTiles(0.58);
  const stepCount = Math.max(10, Math.round(height / stepRise));
  const treadWidth = metersToTiles(0.78);
  const treadDepth = metersToTiles(0.52);
  const treadThickness = metersToTiles(0.07);
  const stairOffset = treadDepth * 0.52;
  const railLift = metersToTiles(0.88);
  const railOutset = metersToTiles(0.2);
  let previousRailPoint: THREE.Vector3 | null = null;
  for (let index = 0; index < stepCount; index += 1) {
    const t = index / Math.max(1, stepCount - 1);
    const y = metersToTiles(0.45) + t * (height - metersToTiles(0.92));
    const sideProgress = t * 4;
    const side = Math.min(3, Math.floor(sideProgress));
    const along = sideProgress - side;
    const scaffoldHalfWidth = widthAtHeight(height, baseWidth, topWidth, y) * 0.5;
    const stairPoint = getSquareStairPoint(side, along, scaffoldHalfWidth, stairOffset);
    const step = addBoxPart(
      group,
      new THREE.Vector3(stairPoint.position.x, y, stairPoint.position.z),
      new THREE.Vector3(treadWidth, treadThickness, treadDepth),
      stepMaterial,
      "watch-tower-wrap-step"
    );
    step.rotation.y = stairPoint.rotationY;
    addCylinderBetween(
      group,
      new THREE.Vector3(stairPoint.anchor.x, y, stairPoint.anchor.z),
      new THREE.Vector3(stairPoint.position.x, y, stairPoint.position.z),
      metersToTiles(0.035),
      railMaterial,
      5,
      "watch-tower-stair-bracket"
    );

    const railSidePoint = getSquareStairPoint(side, along, scaffoldHalfWidth, stairOffset + railOutset);
    const railPoint = new THREE.Vector3(railSidePoint.position.x, y + railLift, railSidePoint.position.z);
    if (previousRailPoint) {
      addCylinderBetween(group, previousRailPoint, railPoint, metersToTiles(0.055), railMaterial, 5, "watch-tower-wrap-rail");
    }
    previousRailPoint = railPoint;
  }
};

export const createProceduralWatchTowerModel = (level: WatchTowerLevel | number): THREE.Group => {
  const visualLevel = clampWatchTowerLevel(level);
  const group = new THREE.Group();
  group.name = `procedural-watch-tower-level-${visualLevel}`;

  const legMaterial = makeMaterial(0x755c3f, 0.84, 0.05);
  const strutMaterial = makeMaterial(0x9b7446, 0.78, 0.04);
  const cabinMaterial = makeMaterial(0xc3aa7e, 0.76, 0.05);
  const roofMaterial = makeMaterial(0x6f5941, 0.82, 0.04);
  const deckMaterial = makeMaterial(0x8f6b42, 0.82, 0.04);
  const railMaterial = makeMaterial(0x513c2a, 0.84, 0.03);
  const windowMaterial = makeMaterial(0x26343c, 0.42, 0.02);
  const footingMaterial = makeMaterial(0x4b4036, 0.95, 0.02);

  const supportHeight = metersToTiles(visualLevel === 1 ? 11.5 : visualLevel === 2 ? 17.8 : 23.8);
  const baseWidth = metersToTiles(visualLevel === 1 ? 7.0 : visualLevel === 2 ? 8.6 : 10.0);
  const topWidth = metersToTiles(visualLevel === 1 ? 4.6 : visualLevel === 2 ? 5.7 : 6.6);
  const frame = createFourLegTowerScaffold(group, {
    height: supportHeight,
    baseWidth,
    topWidth,
    legRadius: metersToTiles(0.22),
    strutRadius: metersToTiles(0.12),
    panelCount: visualLevel + 2,
    legMaterial,
    strutMaterial
  });
  addFootingPads(group, frame.corners, footingMaterial, metersToTiles(0.8));

  const deckWidth = metersToTiles(visualLevel === 1 ? 5.8 : visualLevel === 2 ? 6.8 : 7.8);
  const deckY = supportHeight + metersToTiles(0.22);
  addBoxPart(group, new THREE.Vector3(0, deckY, 0), new THREE.Vector3(deckWidth, metersToTiles(0.24), deckWidth), deckMaterial, "watch-tower-deck");
  addRailings(group, deckY, deckWidth, railMaterial, railMaterial);

  const cabinWidth = metersToTiles(visualLevel === 1 ? 4.1 : visualLevel === 2 ? 4.8 : 5.4);
  const cabinDepth = metersToTiles(visualLevel === 1 ? 3.8 : visualLevel === 2 ? 4.3 : 4.8);
  const cabinHeight = metersToTiles(2.65);
  const cabinCenterY = deckY + metersToTiles(0.18) + cabinHeight * 0.5;
  addBoxPart(group, new THREE.Vector3(0, cabinCenterY, 0), new THREE.Vector3(cabinWidth, cabinHeight, cabinDepth), cabinMaterial, "watch-tower-cabin");
  addBoxPart(group, new THREE.Vector3(0, cabinCenterY + metersToTiles(0.2), -cabinDepth * 0.5 - metersToTiles(0.012)), new THREE.Vector3(cabinWidth * 0.42, metersToTiles(0.95), metersToTiles(0.025)), windowMaterial, "watch-tower-window");
  addBoxPart(group, new THREE.Vector3(-cabinWidth * 0.5 - metersToTiles(0.012), cabinCenterY + metersToTiles(0.18), 0), new THREE.Vector3(metersToTiles(0.025), metersToTiles(0.86), cabinDepth * 0.4), windowMaterial, "watch-tower-window");
  addBoxPart(group, new THREE.Vector3(cabinWidth * 0.5 + metersToTiles(0.012), cabinCenterY + metersToTiles(0.18), 0), new THREE.Vector3(metersToTiles(0.025), metersToTiles(0.86), cabinDepth * 0.4), windowMaterial, "watch-tower-window");

  const roof = new THREE.Mesh(new THREE.ConeGeometry(deckWidth * 0.47, metersToTiles(1.35), 4), roofMaterial);
  roof.name = "watch-tower-roof";
  roof.position.set(0, cabinCenterY + cabinHeight * 0.5 + metersToTiles(0.68), 0);
  roof.rotation.y = Math.PI * 0.25;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  addSquareWrapStairs(group, supportHeight, baseWidth, topWidth, deckMaterial, railMaterial);

  return group;
};
