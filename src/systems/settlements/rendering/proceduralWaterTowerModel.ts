import * as THREE from "three";
import { TILE_SIZE } from "../../../core/config.js";
import {
  addBoxPart,
  addCylinderBetween,
  addFootingPads,
  createFourLegTowerScaffold
} from "../../../shared/rendering/proceduralTowerScaffold.js";

const makeMaterial = (color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const metersToTiles = (meters: number): number => meters / Math.max(0.001, TILE_SIZE);

export const WATER_TOWER_BASE_WIDTH_TILES = metersToTiles(9.4);
export const WATER_TOWER_FOOTING_SIZE_TILES = metersToTiles(0.65);

const addLadder = (
  group: THREE.Group,
  z: number,
  height: number,
  material: THREE.Material
): void => {
  const railX = metersToTiles(0.32);
  const bottomY = metersToTiles(0.55);
  const topY = height + metersToTiles(0.65);
  const railRadius = metersToTiles(0.055);
  const rungRadius = metersToTiles(0.045);
  addCylinderBetween(group, new THREE.Vector3(-railX, bottomY, z), new THREE.Vector3(-railX, topY, z), railRadius, material, 5, "water-tower-ladder-rail");
  addCylinderBetween(group, new THREE.Vector3(railX, bottomY, z), new THREE.Vector3(railX, topY, z), railRadius, material, 5, "water-tower-ladder-rail");
  for (let y = bottomY + metersToTiles(0.65); y < topY - metersToTiles(0.25); y += metersToTiles(0.72)) {
    addCylinderBetween(group, new THREE.Vector3(-railX, y, z), new THREE.Vector3(railX, y, z), rungRadius, material, 5, "water-tower-ladder-rung");
  }
};

export const createProceduralWaterTowerModel = (): THREE.Group => {
  const group = new THREE.Group();
  group.name = "procedural-water-tower";

  const legMaterial = makeMaterial(0x6f7d82, 0.62, 0.38);
  const strutMaterial = makeMaterial(0x4d585c, 0.7, 0.32);
  const tankMaterial = makeMaterial(0xa6b8bc, 0.52, 0.42);
  const roofMaterial = makeMaterial(0xc2c9ca, 0.55, 0.34);
  const pipeMaterial = makeMaterial(0x394145, 0.66, 0.36);
  const footingMaterial = makeMaterial(0xb8bab5, 0.92, 0.02);

  const scaffoldHeight = metersToTiles(15.2);
  const baseWidth = WATER_TOWER_BASE_WIDTH_TILES;
  const topWidth = metersToTiles(6.4);
  const tankRadius = metersToTiles(3.15);
  const tankHeight = metersToTiles(4.35);
  const roofHeight = metersToTiles(2.15);
  const tankBaseY = scaffoldHeight + metersToTiles(0.45);
  const tankCenterY = tankBaseY + tankHeight * 0.5;
  const tankTopY = tankBaseY + tankHeight;
  const frame = createFourLegTowerScaffold(group, {
    height: scaffoldHeight,
    baseWidth,
    topWidth,
    legRadius: metersToTiles(0.24),
    strutRadius: metersToTiles(0.13),
    panelCount: 3,
    legMaterial,
    strutMaterial
  });
  addFootingPads(group, frame.corners, footingMaterial, WATER_TOWER_FOOTING_SIZE_TILES);

  addBoxPart(
    group,
    new THREE.Vector3(0, scaffoldHeight + metersToTiles(0.08), 0),
    new THREE.Vector3(topWidth + metersToTiles(1.05), metersToTiles(0.18), topWidth + metersToTiles(1.05)),
    strutMaterial,
    "water-tower-platform"
  );

  const tank = new THREE.Mesh(new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 18, 1, false), tankMaterial);
  tank.name = "water-tower-tank";
  tank.position.set(0, tankCenterY, 0);
  tank.castShadow = true;
  tank.receiveShadow = true;
  group.add(tank);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(tankRadius * 1.08, roofHeight, 18), roofMaterial);
  roof.name = "water-tower-cone-roof";
  roof.position.set(0, tankTopY + roofHeight * 0.5, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  const pipeRadius = metersToTiles(0.18);
  const pipeX = tankRadius + metersToTiles(0.62);
  const pipeTopY = tankBaseY + tankHeight * 0.62;
  addCylinderBetween(group, new THREE.Vector3(tankRadius * 0.82, pipeTopY, 0), new THREE.Vector3(pipeX, pipeTopY, 0), pipeRadius, pipeMaterial, 8, "water-tower-pipe-elbow");
  addCylinderBetween(group, new THREE.Vector3(pipeX, pipeTopY, 0), new THREE.Vector3(pipeX, metersToTiles(0.75), 0), pipeRadius, pipeMaterial, 8, "water-tower-side-pipe");

  addLadder(group, -baseWidth * 0.5 - metersToTiles(0.18), scaffoldHeight, pipeMaterial);

  return group;
};
