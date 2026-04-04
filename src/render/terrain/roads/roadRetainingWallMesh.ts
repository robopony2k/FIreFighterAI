import * as THREE from "three";
import { TILE_COLOR_RGB } from "../../../core/config.js";
import { ROAD_EDGE_DIRS, ROAD_EDGE_E, ROAD_EDGE_N, ROAD_EDGE_S, ROAD_EDGE_W } from "../shared/roadTopology.js";
import {
  ROAD_SURFACE_OFFSET,
  ROAD_WALL_BOTTOM_DROP,
  ROAD_WALL_MIN_HEIGHT,
  ROAD_WALL_OUTSET,
  ROAD_WALL_TOP_INSET
} from "./roadGeometryConstants.js";

type RoadWallSample = {
  cols: number;
  rows: number;
  tileTypes?: Uint8Array;
  roadWallEdges?: Uint8Array;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const buildRoadRetainingWallMesh = (
  sample: RoadWallSample,
  width: number,
  depth: number,
  heightScale: number,
  roadId: number,
  baseId: number,
  heightAtTileCoord: (tileX: number, tileY: number) => number
): THREE.Mesh | null => {
  const wallMask = sample.roadWallEdges;
  const tileTypes = sample.tileTypes;
  if (!wallMask || wallMask.length === 0 || !tileTypes) {
    return null;
  }
  const { cols, rows } = sample;
  const total = cols * rows;
  if (wallMask.length !== total) {
    return null;
  }

  const isRoadSurfaceTile = (idx: number): boolean => {
    const type = tileTypes[idx];
    return type === roadId || type === baseId;
  };
  const edgeToWorldX = (edgeX: number): number => (edgeX / Math.max(1, cols) - 0.5) * width;
  const edgeToWorldZ = (edgeY: number): number => (edgeY / Math.max(1, rows) - 0.5) * depth;
  const positions: number[] = [];
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
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const resolveEdgeCoords = (
    tileX: number,
    tileY: number,
    bit: number
  ): {
    topA: { x: number; y: number };
    topB: { x: number; y: number };
    bottomA: { x: number; y: number };
    bottomB: { x: number; y: number };
  } | null => {
    if (bit === ROAD_EDGE_N) {
      return {
        topA: { x: tileX, y: tileY + ROAD_WALL_TOP_INSET },
        topB: { x: tileX + 1, y: tileY + ROAD_WALL_TOP_INSET },
        bottomA: { x: tileX, y: tileY - ROAD_WALL_OUTSET },
        bottomB: { x: tileX + 1, y: tileY - ROAD_WALL_OUTSET }
      };
    }
    if (bit === ROAD_EDGE_E) {
      return {
        topA: { x: tileX + 1 - ROAD_WALL_TOP_INSET, y: tileY },
        topB: { x: tileX + 1 - ROAD_WALL_TOP_INSET, y: tileY + 1 },
        bottomA: { x: tileX + 1 + ROAD_WALL_OUTSET, y: tileY },
        bottomB: { x: tileX + 1 + ROAD_WALL_OUTSET, y: tileY + 1 }
      };
    }
    if (bit === ROAD_EDGE_S) {
      return {
        topA: { x: tileX + 1, y: tileY + 1 - ROAD_WALL_TOP_INSET },
        topB: { x: tileX, y: tileY + 1 - ROAD_WALL_TOP_INSET },
        bottomA: { x: tileX + 1, y: tileY + 1 + ROAD_WALL_OUTSET },
        bottomB: { x: tileX, y: tileY + 1 + ROAD_WALL_OUTSET }
      };
    }
    if (bit === ROAD_EDGE_W) {
      return {
        topA: { x: tileX + ROAD_WALL_TOP_INSET, y: tileY + 1 },
        topB: { x: tileX + ROAD_WALL_TOP_INSET, y: tileY },
        bottomA: { x: tileX - ROAD_WALL_OUTSET, y: tileY + 1 },
        bottomB: { x: tileX - ROAD_WALL_OUTSET, y: tileY }
      };
    }
    return null;
  };

  for (let idx = 0; idx < total; idx += 1) {
    const mask = wallMask[idx] ?? 0;
    if (mask === 0 || !isRoadSurfaceTile(idx)) {
      continue;
    }
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    for (let i = 0; i < 4; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const coords = resolveEdgeCoords(tileX, tileY, dir.bit);
      if (!coords) {
        continue;
      }
      const topAY = heightAtTileCoord(coords.topA.x, coords.topA.y) * heightScale + ROAD_SURFACE_OFFSET;
      const topBY = heightAtTileCoord(coords.topB.x, coords.topB.y) * heightScale + ROAD_SURFACE_OFFSET;
      const bottomAY = Math.min(
        topAY - ROAD_WALL_BOTTOM_DROP,
        heightAtTileCoord(coords.bottomA.x, coords.bottomA.y) * heightScale - 0.01
      );
      const bottomBY = Math.min(
        topBY - ROAD_WALL_BOTTOM_DROP,
        heightAtTileCoord(coords.bottomB.x, coords.bottomB.y) * heightScale - 0.01
      );
      if (topAY - bottomAY < ROAD_WALL_MIN_HEIGHT && topBY - bottomBY < ROAD_WALL_MIN_HEIGHT) {
        continue;
      }
      addQuad(
        edgeToWorldX(coords.topA.x),
        topAY,
        edgeToWorldZ(coords.topA.y),
        edgeToWorldX(coords.topB.x),
        topBY,
        edgeToWorldZ(coords.topB.y),
        edgeToWorldX(coords.bottomB.x),
        bottomBY,
        edgeToWorldZ(coords.bottomB.y),
        edgeToWorldX(coords.bottomA.x),
        bottomAY,
        edgeToWorldZ(coords.bottomA.y)
      );
    }
  }

  if (positions.length === 0 || indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const roadColor = TILE_COLOR_RGB.road;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      clamp((roadColor.r - 34) / 255, 0, 1),
      clamp((roadColor.g - 38) / 255, 0, 1),
      clamp((roadColor.b - 42) / 255, 0, 1)
    ),
    roughness: 0.92,
    metalness: 0.03
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.roadRetainingWall = true;
  return mesh;
};
