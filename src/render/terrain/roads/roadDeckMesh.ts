import * as THREE from "three";
import { TILE_COLOR_RGB } from "../../../core/config.js";
import {
  ROAD_EDGE_DIRS,
  ROAD_EDGE_E,
  ROAD_EDGE_N,
  ROAD_EDGE_NE,
  ROAD_EDGE_NW,
  ROAD_EDGE_S,
  ROAD_EDGE_SE,
  ROAD_EDGE_SW,
  ROAD_EDGE_W
} from "../shared/roadTopology.js";
import {
  ROAD_DECK_CAP_SIZE,
  ROAD_DECK_CROSSFALL_THRESHOLD,
  ROAD_DECK_RELIEF_THRESHOLD,
  ROAD_DECK_SURFACE_LIFT,
  ROAD_SURFACE_OFFSET,
  ROAD_SURFACE_WIDTH
} from "./roadGeometryConstants.js";

type RoadDeckSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  roadEdges?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadWallEdges?: Uint8Array;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const buildRoadDeckMesh = (
  sample: RoadDeckSample,
  width: number,
  depth: number,
  heightScale: number,
  roadOverlay: THREE.Texture | null,
  roadId: number,
  baseId: number,
  heightAtTileCoord: (tileX: number, tileY: number) => number
): THREE.Group | null => {
  const tileTypes = sample.tileTypes;
  const roadEdges = sample.roadEdges;
  if (!tileTypes || !roadEdges) {
    return null;
  }
  const bridgeMask = sample.roadBridgeMask;
  const wallMask = sample.roadWallEdges;
  const { cols, rows, elevations } = sample;
  const total = cols * rows;
  if (roadEdges.length !== total) {
    return null;
  }

  const safeWidth = Math.max(1e-5, width);
  const safeDepth = Math.max(1e-5, depth);
  const halfRoadWidth = ROAD_SURFACE_WIDTH * 0.5;
  const halfCapSize = ROAD_DECK_CAP_SIZE * 0.5;
  const edgeToWorldX = (edgeX: number): number => (edgeX / Math.max(1, cols) - 0.5) * width;
  const edgeToWorldZ = (edgeY: number): number => (edgeY / Math.max(1, rows) - 0.5) * depth;
  const getIndex = (x: number, y: number): number => y * cols + x;
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const countBits = (mask: number): number => {
    let count = 0;
    for (let bits = mask; bits !== 0; bits &= bits - 1) {
      count += 1;
    }
    return count;
  };
  const isStraightMask = (mask: number): boolean =>
    mask === (ROAD_EDGE_N | ROAD_EDGE_S) ||
    mask === (ROAD_EDGE_E | ROAD_EDGE_W) ||
    mask === (ROAD_EDGE_NE | ROAD_EDGE_SW) ||
    mask === (ROAD_EDGE_NW | ROAD_EDGE_SE);
  const isBridgeIndex = (idx: number): boolean => (bridgeMask?.[idx] ?? 0) > 0;
  const isRoadSurfaceTile = (idx: number): boolean => {
    const type = tileTypes[idx];
    return (type === roadId || type === baseId) && !isBridgeIndex(idx);
  };
  const getRoadMaskAtIndex = (idx: number): number => {
    if (!isRoadSurfaceTile(idx)) {
      return 0;
    }
    const stored = roadEdges[idx] ?? 0;
    if (stored !== 0) {
      let sanitized = 0;
      const tileX = idx % cols;
      const tileY = Math.floor(idx / cols);
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if ((stored & dir.bit) === 0) {
          continue;
        }
        const nx = tileX + dir.dx;
        const ny = tileY + dir.dy;
        if (!inBounds(nx, ny)) {
          continue;
        }
        const neighborIdx = getIndex(nx, ny);
        if (isRoadSurfaceTile(neighborIdx)) {
          sanitized |= dir.bit;
        }
      }
      if (sanitized !== 0) {
        return sanitized;
      }
    }
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    let mask = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      const nx = tileX + dir.dx;
      const ny = tileY + dir.dy;
      if (!inBounds(nx, ny)) {
        continue;
      }
      const neighborIdx = getIndex(nx, ny);
      if (isRoadSurfaceTile(neighborIdx)) {
        mask |= dir.bit;
      }
    }
    return mask;
  };
  const getElevationAt = (x: number, y: number, fallback: number): number => {
    if (!inBounds(x, y)) {
      return fallback;
    }
    return elevations[getIndex(x, y)] ?? fallback;
  };
  const computeCrossfallAtSegment = (fromX: number, fromY: number, toX: number, toY: number): number => {
    const dx = Math.sign(toX - fromX);
    const dy = Math.sign(toY - fromY);
    if (dx === 0 && dy === 0) {
      return 0;
    }
    const fromElevation = elevations[getIndex(fromX, fromY)] ?? 0;
    const toElevation = elevations[getIndex(toX, toY)] ?? fromElevation;
    const centerElevation = (fromElevation + toElevation) * 0.5;
    const perpX = -dy;
    const perpY = dx;
    const leftA = getElevationAt(fromX + perpX, fromY + perpY, centerElevation);
    const leftB = getElevationAt(toX + perpX, toY + perpY, centerElevation);
    const rightA = getElevationAt(fromX - perpX, fromY - perpY, centerElevation);
    const rightB = getElevationAt(toX - perpX, toY - perpY, centerElevation);
    return Math.abs((leftA + leftB) * 0.5 - (rightA + rightB) * 0.5) * 0.5;
  };
  const roadCenterY = (tileX: number, tileY: number): number =>
    heightAtTileCoord(tileX + 0.5, tileY + 0.5) * heightScale + ROAD_SURFACE_OFFSET + ROAD_DECK_SURFACE_LIFT;

  const needsDeck = new Uint8Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    if (!isRoadSurfaceTile(idx)) {
      continue;
    }
    if ((wallMask?.[idx] ?? 0) !== 0) {
      needsDeck[idx] = 1;
      continue;
    }
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    const centerElevation = elevations[idx] ?? 0;
    let localRelief = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        const nx = tileX + dx;
        const ny = tileY + dy;
        if (!inBounds(nx, ny)) {
          continue;
        }
        const neighborIdx = getIndex(nx, ny);
        if (isRoadSurfaceTile(neighborIdx)) {
          continue;
        }
        localRelief = Math.max(localRelief, Math.abs(centerElevation - (elevations[neighborIdx] ?? centerElevation)));
      }
    }
    if (localRelief >= ROAD_DECK_RELIEF_THRESHOLD) {
      needsDeck[idx] = 1;
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (!isRoadSurfaceTile(idx)) {
      continue;
    }
    const mask = getRoadMaskAtIndex(idx);
    if (mask === 0) {
      continue;
    }
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = tileX + dir.dx;
      const ny = tileY + dir.dy;
      if (!inBounds(nx, ny)) {
        continue;
      }
      const neighborIdx = getIndex(nx, ny);
      if (!isRoadSurfaceTile(neighborIdx) || neighborIdx < idx) {
        continue;
      }
      if (computeCrossfallAtSegment(tileX, tileY, nx, ny) >= ROAD_DECK_CROSSFALL_THRESHOLD) {
        needsDeck[idx] = 1;
        needsDeck[neighborIdx] = 1;
      }
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const addQuad = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number
  ): void => {
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    uvs.push(
      ax / safeWidth + 0.5,
      0.5 - az / safeDepth,
      bx / safeWidth + 0.5,
      0.5 - bz / safeDepth,
      cx / safeWidth + 0.5,
      0.5 - cz / safeDepth,
      dx / safeWidth + 0.5,
      0.5 - dz / safeDepth
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let idx = 0; idx < total; idx += 1) {
    if (!isRoadSurfaceTile(idx) || needsDeck[idx] === 0) {
      continue;
    }
    const mask = getRoadMaskAtIndex(idx);
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    const centerX = edgeToWorldX(tileX + 0.5);
    const centerZ = edgeToWorldZ(tileY + 0.5);
    const centerY = roadCenterY(tileX, tileY);
    const connections = countBits(mask);
    if (connections !== 2 || !isStraightMask(mask)) {
      addQuad(
        centerX - halfCapSize,
        centerY,
        centerZ - halfCapSize,
        centerX + halfCapSize,
        centerY,
        centerZ - halfCapSize,
        centerX + halfCapSize,
        centerY,
        centerZ + halfCapSize,
        centerX - halfCapSize,
        centerY,
        centerZ + halfCapSize
      );
    }
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = tileX + dir.dx;
      const ny = tileY + dir.dy;
      if (!inBounds(nx, ny)) {
        continue;
      }
      const neighborIdx = getIndex(nx, ny);
      if (!isRoadSurfaceTile(neighborIdx) || needsDeck[neighborIdx] === 0 || neighborIdx < idx) {
        continue;
      }
      const nextX = edgeToWorldX(nx + 0.5);
      const nextZ = edgeToWorldZ(ny + 0.5);
      const nextY = roadCenterY(nx, ny);
      const tangentX = nextX - centerX;
      const tangentZ = nextZ - centerZ;
      const tangentLength = Math.hypot(tangentX, tangentZ);
      if (tangentLength <= 1e-6) {
        continue;
      }
      const rightX = -tangentZ / tangentLength;
      const rightZ = tangentX / tangentLength;
      addQuad(
        centerX - rightX * halfRoadWidth,
        centerY,
        centerZ - rightZ * halfRoadWidth,
        centerX + rightX * halfRoadWidth,
        centerY,
        centerZ + rightZ * halfRoadWidth,
        nextX + rightX * halfRoadWidth,
        nextY,
        nextZ + rightZ * halfRoadWidth,
        nextX - rightX * halfRoadWidth,
        nextY,
        nextZ - rightZ * halfRoadWidth
      );
    }
  }

  if (positions.length === 0 || indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const roadColor = TILE_COLOR_RGB.road;
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      clamp((roadColor.r + 6) / 255, 0, 1),
      clamp((roadColor.g + 5) / 255, 0, 1),
      clamp((roadColor.b + 4) / 255, 0, 1)
    ),
    roughness: 0.9,
    metalness: 0.04
  });
  const baseMesh = new THREE.Mesh(geometry, deckMaterial);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;

  const group = new THREE.Group();
  group.userData.roadDeck = true;
  group.add(baseMesh);

  if (roadOverlay) {
    const overlayMaterial = new THREE.MeshStandardMaterial({
      map: roadOverlay,
      color: new THREE.Color(0xffffff),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    overlayMaterial.alphaTest = 0.02;
    const overlayMesh = new THREE.Mesh(geometry.clone(), overlayMaterial);
    overlayMesh.castShadow = false;
    overlayMesh.receiveShadow = true;
    overlayMesh.renderOrder = 2;
    overlayMesh.userData.roadDeck = true;
    group.add(overlayMesh);
  }

  return group;
};
