import * as THREE from "three";
import { TILE_COLOR_RGB } from "../../../core/config.js";
import { getBridgeStraightOverlayTexture } from "../canvas/roadAtlas.js";
import { ROAD_EDGE_DIRS } from "../shared/roadTopology.js";
import type {
  TerrainBridgeAbutmentDebug,
  TerrainBridgeAnchorDebug,
  TerrainBridgeBoundsDebug,
  TerrainBridgeComponentDebug,
  TerrainBridgeDebug,
  TerrainBridgeSpanDebug,
  TerrainBridgeTileDebug
} from "./bridgeDebug.js";
import {
  BRIDGE_ABUTMENT_LENGTH,
  BRIDGE_ABUTMENT_MIN_HEIGHT,
  BRIDGE_ANCHOR_MAX_BANK_RISE,
  BRIDGE_ANCHOR_ROAD_OVERLAP,
  BRIDGE_ANCHOR_ROAD_OVERLAP_SHORT_SPAN,
  BRIDGE_ANCHOR_SEARCH_STEP,
  BRIDGE_ANCHOR_WATER_COVERAGE_MAX,
  BRIDGE_ANCHOR_WATER_MARGIN,
  BRIDGE_DECK_CLEARANCE_BANK,
  BRIDGE_DECK_CLEARANCE_WATER,
  BRIDGE_DECK_SURFACE_LIFT,
  BRIDGE_DECK_THICKNESS,
  BRIDGE_DECK_WIDTH,
  BRIDGE_OVERLAY_LIFT,
  BRIDGE_OVERLAY_REPEAT_LENGTH,
  BRIDGE_POST_SIZE,
  BRIDGE_POST_SPACING,
  BRIDGE_RAIL_EDGE_INSET,
  BRIDGE_RAIL_HEIGHT,
  BRIDGE_RAIL_MID_HEIGHT,
  BRIDGE_RAIL_THICKNESS,
  BRIDGE_SURFACE_WIDTH,
  ROAD_SURFACE_OFFSET
} from "./roadGeometryConstants.js";

type BridgeDeckSample = {
  cols: number;
  rows: number;
  tileTypes?: Uint8Array;
  roadEdges?: Uint8Array;
  roadBridgeMask?: Uint8Array;
};

export type BridgeDeckSurfaceInput = {
  sample: BridgeDeckSample;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  step: number;
  sampleCols: number;
  sampleRows: number;
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
  waterRatio: Float32Array;
  waterSurfaceHeights: Float32Array;
};

type BridgeConnector = {
  bridgeIdx: number;
  roadIdx: number;
};

type BridgeSpan = {
  componentIndex: number;
  componentTileCount: number;
  connectorCount: number;
  componentBounds: TerrainBridgeBoundsDebug;
  componentTiles: number[];
  bridgePath: number[];
  startRoadIdx: number;
  endRoadIdx: number;
};

type BridgeProfilePoint = {
  center: THREE.Vector3;
  right: THREE.Vector3;
  leftTop: THREE.Vector3;
  rightTop: THREE.Vector3;
  leftBottom: THREE.Vector3;
  rightBottom: THREE.Vector3;
};

type BridgeAnchor = TerrainBridgeAnchorDebug & {
  x: number;
  z: number;
  roadContactX: number;
  roadContactZ: number;
  bankContactX: number;
  bankContactZ: number;
};

type BridgeRoutePoint = {
  idx?: number;
  x: number;
  z: number;
  baseY: number;
  terrainY?: number;
  riverSurfaceY?: number;
};

type BridgeAnchorCandidate = {
  edgeX: number;
  edgeY: number;
  terrainY: number;
  waterY: number | null;
  searchDistance: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const BRIDGE_ABUTMENT_MAX_HEIGHT = 0.42;
const BRIDGE_ABUTMENT_HEIGHT_LENGTH_RATIO_MAX = 1.35;

const buildEmptyBridgeDebug = (): TerrainBridgeDebug => ({
  totalBridgeTiles: 0,
  componentCount: 0,
  renderedSpanCount: 0,
  orphanComponentCount: 0,
  spans: [],
  orphanComponents: []
});

const buildBridgeTileDebug = (idx: number, cols: number): TerrainBridgeTileDebug => ({
  idx,
  x: idx % cols,
  y: Math.floor(idx / cols)
});

const buildBridgeBoundsDebug = (indices: number[], cols: number): TerrainBridgeBoundsDebug => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < indices.length; i += 1) {
    const point = buildBridgeTileDebug(indices[i], cols);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX: Number.isFinite(maxX) ? maxX : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0
  };
};

const buildBridgeDeckGeometry = (profilePoints: BridgeProfilePoint[]): THREE.BufferGeometry | null => {
  if (profilePoints.length < 2) {
    return null;
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const leftTop: number[] = [];
  const rightTop: number[] = [];
  const leftBottom: number[] = [];
  const rightBottom: number[] = [];
  const pushVertex = (vertex: THREE.Vector3): number => {
    const index = positions.length / 3;
    positions.push(vertex.x, vertex.y, vertex.z);
    return index;
  };

  for (let i = 0; i < profilePoints.length; i += 1) {
    const point = profilePoints[i];
    leftTop.push(pushVertex(point.leftTop));
    rightTop.push(pushVertex(point.rightTop));
    leftBottom.push(pushVertex(point.leftBottom));
    rightBottom.push(pushVertex(point.rightBottom));
  }

  for (let i = 0; i < profilePoints.length - 1; i += 1) {
    const next = i + 1;
    indices.push(
      leftTop[i], rightTop[i], rightTop[next],
      leftTop[i], rightTop[next], leftTop[next],
      leftBottom[i], rightBottom[next], rightBottom[i],
      leftBottom[i], leftBottom[next], rightBottom[next],
      leftBottom[i], leftTop[i], leftTop[next],
      leftBottom[i], leftTop[next], leftBottom[next],
      rightTop[i], rightBottom[i], rightBottom[next],
      rightTop[i], rightBottom[next], rightTop[next]
    );
  }

  const first = 0;
  const last = profilePoints.length - 1;
  indices.push(
    leftTop[first], leftBottom[first], rightBottom[first],
    leftTop[first], rightBottom[first], rightTop[first],
    leftTop[last], rightTop[last], rightBottom[last],
    leftTop[last], rightBottom[last], leftBottom[last]
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const buildBridgeOverlayGeometry = (
  profilePoints: BridgeProfilePoint[],
  surfaceWidth: number
): THREE.BufferGeometry | null => {
  if (profilePoints.length < 2) {
    return null;
  }
  const halfSurfaceWidth = Math.max(1e-4, surfaceWidth) * 0.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const leftTop: number[] = [];
  const rightTop: number[] = [];
  const cumulative = new Array<number>(profilePoints.length).fill(0);
  let totalLength = 0;
  for (let i = 1; i < profilePoints.length; i += 1) {
    totalLength += profilePoints[i].center.distanceTo(profilePoints[i - 1].center);
    cumulative[i] = totalLength;
  }
  const pushVertex = (vertex: THREE.Vector3, u: number, v: number): number => {
    const index = positions.length / 3;
    positions.push(vertex.x, vertex.y + BRIDGE_OVERLAY_LIFT, vertex.z);
    uvs.push(u, v);
    return index;
  };

  for (let i = 0; i < profilePoints.length; i += 1) {
    const point = profilePoints[i];
    const v = cumulative[i] / Math.max(1e-5, BRIDGE_OVERLAY_REPEAT_LENGTH);
    leftTop.push(pushVertex(point.center.clone().addScaledVector(point.right, -halfSurfaceWidth), 0, v));
    rightTop.push(pushVertex(point.center.clone().addScaledVector(point.right, halfSurfaceWidth), 1, v));
  }

  for (let i = 0; i < profilePoints.length - 1; i += 1) {
    const next = i + 1;
    indices.push(
      leftTop[i], rightTop[i], rightTop[next],
      leftTop[i], rightTop[next], leftTop[next]
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const buildBridgePolylineLengths = (points: THREE.Vector3[]): { cumulative: number[]; total: number } => {
  const cumulative = new Array<number>(points.length).fill(0);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += points[i].distanceTo(points[i - 1]);
    cumulative[i] = total;
  }
  return { cumulative, total };
};

const sampleBridgePolyline = (
  profilePoints: BridgeProfilePoint[],
  cumulative: number[],
  total: number,
  distance: number
): { position: THREE.Vector3; right: THREE.Vector3; tangent: THREE.Vector3 } => {
  if (profilePoints.length === 0) {
    return {
      position: new THREE.Vector3(),
      right: new THREE.Vector3(1, 0, 0),
      tangent: new THREE.Vector3(1, 0, 0)
    };
  }
  if (profilePoints.length === 1 || total <= 1e-5) {
    return {
      position: profilePoints[0].center.clone(),
      right: profilePoints[0].right.clone(),
      tangent: new THREE.Vector3(1, 0, 0)
    };
  }
  const clampedDistance = clamp(distance, 0, total);
  let segment = profilePoints.length - 2;
  for (let i = 0; i < cumulative.length - 1; i += 1) {
    if (clampedDistance <= cumulative[i + 1]) {
      segment = i;
      break;
    }
  }
  const start = profilePoints[segment];
  const end = profilePoints[segment + 1];
  const segmentLength = cumulative[segment + 1] - cumulative[segment];
  const t = segmentLength > 1e-5 ? (clampedDistance - cumulative[segment]) / segmentLength : 0;
  const position = start.center.clone().lerp(end.center, t);
  const right = start.right.clone().lerp(end.right, t);
  if (right.lengthSq() < 1e-6) {
    right.copy(start.right);
  }
  right.normalize();
  const tangent = end.center.clone().sub(start.center);
  if (tangent.lengthSq() < 1e-6) {
    tangent.set(1, 0, 0);
  } else {
    tangent.normalize();
  }
  return { position, right, tangent };
};

const createBridgeBoxMesh = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  center: THREE.Vector3,
  forward: THREE.Vector3,
  scale: THREE.Vector3
): THREE.Mesh => {
  const safeForward = forward.clone();
  if (safeForward.lengthSq() < 1e-6) {
    safeForward.set(1, 0, 0);
  } else {
    safeForward.normalize();
  }
  let side = new THREE.Vector3().crossVectors(safeForward, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-6) {
    side = new THREE.Vector3(0, 0, 1);
  } else {
    side.normalize();
  }
  let up = new THREE.Vector3().crossVectors(side, safeForward);
  if (up.lengthSq() < 1e-6) {
    up = new THREE.Vector3(0, 1, 0);
  } else {
    up.normalize();
  }
  side = new THREE.Vector3().crossVectors(safeForward, up);
  if (side.lengthSq() < 1e-6) {
    side.set(0, 0, 1);
  } else {
    side.normalize();
  }
  const basis = new THREE.Matrix4().makeBasis(safeForward, up, side);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.quaternion.copy(quaternion);
  mesh.scale.copy(scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
};

export const buildBridgeDeckMesh = (
  surface: BridgeDeckSurfaceInput,
  roadOverlay: THREE.Texture | null,
  roadId: number,
  baseId: number
): { group: THREE.Group | null; debug: TerrainBridgeDebug } => {
  const sample = surface.sample;
  const bridgeMask = sample.roadBridgeMask;
  const tileTypes = sample.tileTypes;
  if (!bridgeMask || bridgeMask.length === 0 || !tileTypes) {
    return {
      group: null,
      debug: buildEmptyBridgeDebug()
    };
  }
  const {
    cols,
    rows,
    width,
    depth,
    step,
    sampleCols,
    sampleRows,
    heightScale,
    heightAtTileCoord,
    toWorldX,
    toWorldZ,
    waterRatio,
    waterSurfaceHeights
  } = surface;
  const roadEdges = sample.roadEdges;
  const total = cols * rows;
  const hasRoadEdges = !!roadEdges && roadEdges.length === total;
  const getIndex = (x: number, y: number): number => y * cols + x;
  const isBridgeIndex = (idx: number): boolean => bridgeMask[idx] > 0;
  const isRoadLikeIndex = (idx: number): boolean => {
    const type = tileTypes[idx];
    return type === roadId || type === baseId || isBridgeIndex(idx);
  };
  const edgeToWorldX = (edgeX: number): number => toWorldX(edgeX);
  const edgeToWorldZ = (edgeY: number): number => toWorldZ(edgeY);
  const worldToEdgeX = (worldX: number): number => (worldX / Math.max(1e-5, width) + 0.5) * Math.max(1, cols);
  const worldToEdgeY = (worldZ: number): number => (worldZ / Math.max(1e-5, depth) + 0.5) * Math.max(1, rows);
  const sampleGridValueAtTileCoord = (data: ArrayLike<number> | undefined, tileX: number, tileY: number): number | null => {
    if (!data || data.length === 0) {
      return null;
    }
    const sx = clamp(tileX / Math.max(1e-5, step), 0, sampleCols - 1);
    const sy = clamp(tileY / Math.max(1e-5, step), 0, sampleRows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const idx00 = y0 * sampleCols + x0;
    const idx10 = y0 * sampleCols + x1;
    const idx01 = y1 * sampleCols + x0;
    const idx11 = y1 * sampleCols + x1;
    const v00 = Number(data[idx00] ?? 0);
    const v10 = Number(data[idx10] ?? 0);
    const v01 = Number(data[idx01] ?? 0);
    const v11 = Number(data[idx11] ?? 0);
    if (![v00, v10, v01, v11].every(Number.isFinite)) {
      return null;
    }
    const vx0 = v00 * (1 - tx) + v10 * tx;
    const vx1 = v01 * (1 - tx) + v11 * tx;
    const value = vx0 * (1 - ty) + vx1 * ty;
    return Number.isFinite(value) ? value : null;
  };
  const sampleTerrainWorldAtTileCoord = (tileX: number, tileY: number): number => heightAtTileCoord(tileX, tileY) * heightScale;
  const sampleTerrainWorldAtWorld = (worldX: number, worldZ: number): number =>
    sampleTerrainWorldAtTileCoord(worldToEdgeX(worldX), worldToEdgeY(worldZ));
  const sampleWaterCoverageAtTileCoord = (tileX: number, tileY: number): number =>
    clamp(sampleGridValueAtTileCoord(waterRatio, tileX, tileY) ?? 0, 0, 1);
  const sampleWaterSurfaceYAtTileCoord = (tileX: number, tileY: number): number | null => {
    if (sampleWaterCoverageAtTileCoord(tileX, tileY) <= 0.01) {
      return null;
    }
    const height = sampleGridValueAtTileCoord(waterSurfaceHeights, tileX, tileY);
    if (!Number.isFinite(height)) {
      return null;
    }
    return clamp(height as number, 0, 1) * heightScale;
  };
  const roadSurfaceWorldYAtTileCoord = (tileX: number, tileY: number): number =>
    sampleTerrainWorldAtTileCoord(tileX, tileY) + ROAD_SURFACE_OFFSET + BRIDGE_DECK_SURFACE_LIFT;
  const getRoadMaskAtIndex = (idx: number): number => {
    if (!isRoadLikeIndex(idx)) {
      return 0;
    }
    if (hasRoadEdges && roadEdges) {
      return roadEdges[idx] ?? 0;
    }
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    let mask = 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      const nx = tileX + dir.dx;
      const ny = tileY + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const neighborIdx = getIndex(nx, ny);
      if (isRoadLikeIndex(neighborIdx)) {
        mask |= dir.bit;
      }
    }
    return mask;
  };

  const bridgeIndices: number[] = [];
  const bridgeNeighbors = new Map<number, number[]>();
  const bridgeConnectors = new Map<number, BridgeConnector[]>();
  for (let idx = 0; idx < bridgeMask.length; idx += 1) {
    if (!isBridgeIndex(idx)) {
      continue;
    }
    bridgeIndices.push(idx);
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    const mask = getRoadMaskAtIndex(idx);
    const neighbors: number[] = [];
    const connectorMap = new Map<number, BridgeConnector>();
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = tileX + dir.dx;
      const ny = tileY + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const neighborIdx = getIndex(nx, ny);
      if (isBridgeIndex(neighborIdx)) {
        if (!neighbors.includes(neighborIdx)) {
          neighbors.push(neighborIdx);
        }
      } else if (isRoadLikeIndex(neighborIdx)) {
        connectorMap.set(neighborIdx, { bridgeIdx: idx, roadIdx: neighborIdx });
      }
    }
    bridgeNeighbors.set(idx, neighbors);
    bridgeConnectors.set(idx, Array.from(connectorMap.values()));
  }

  if (bridgeIndices.length === 0) {
    return {
      group: null,
      debug: buildEmptyBridgeDebug()
    };
  }

  for (let i = 0; i < bridgeIndices.length; i += 1) {
    const idx = bridgeIndices[i];
    const neighbors = bridgeNeighbors.get(idx) ?? [];
    for (let j = 0; j < neighbors.length; j += 1) {
      const neighborIdx = neighbors[j];
      const reverse = bridgeNeighbors.get(neighborIdx);
      if (reverse && !reverse.includes(idx)) {
        reverse.push(idx);
      }
    }
  }

  const spans: BridgeSpan[] = [];
  const orphanComponents: TerrainBridgeComponentDebug[] = [];
  const visited = new Uint8Array(total);
  for (let i = 0; i < bridgeIndices.length; i += 1) {
    const startIdx = bridgeIndices[i];
    if (visited[startIdx] > 0) {
      continue;
    }
    const component: number[] = [];
    const queue = [startIdx];
    visited[startIdx] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      component.push(current);
      const neighbors = bridgeNeighbors.get(current) ?? [];
      for (let j = 0; j < neighbors.length; j += 1) {
        const neighborIdx = neighbors[j];
        if (visited[neighborIdx] > 0) {
          continue;
        }
        visited[neighborIdx] = 1;
        queue.push(neighborIdx);
      }
    }

    const connectorByRoad = new Map<number, BridgeConnector>();
    for (let j = 0; j < component.length; j += 1) {
      const connectors = bridgeConnectors.get(component[j]) ?? [];
      for (let k = 0; k < connectors.length; k += 1) {
        const connector = connectors[k];
        if (!connectorByRoad.has(connector.roadIdx)) {
          connectorByRoad.set(connector.roadIdx, connector);
        }
      }
    }
    const connectors = Array.from(connectorByRoad.values());
    const componentBounds = buildBridgeBoundsDebug(component, cols);
    const componentDebug: TerrainBridgeComponentDebug = {
      componentIndex: orphanComponents.length + spans.length,
      componentTileCount: component.length,
      connectorCount: connectors.length,
      componentBounds,
      bridgeTiles: component.map((idx) => buildBridgeTileDebug(idx, cols)),
      connectors: connectors.map((connector) => ({
        bridge: buildBridgeTileDebug(connector.bridgeIdx, cols),
        road: buildBridgeTileDebug(connector.roadIdx, cols)
      }))
    };
    if (connectors.length < 2) {
      orphanComponents.push(componentDebug);
      continue;
    }

    let spanStart = connectors[0];
    let spanEnd = connectors[1];
    let bestDistance = -1;
    for (let a = 0; a < connectors.length; a += 1) {
      const aRoadIdx = connectors[a].roadIdx;
      const ax = aRoadIdx % cols;
      const ay = Math.floor(aRoadIdx / cols);
      for (let b = a + 1; b < connectors.length; b += 1) {
        const bRoadIdx = connectors[b].roadIdx;
        const bx = bRoadIdx % cols;
        const by = Math.floor(bRoadIdx / cols);
        const distanceSq = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
        if (distanceSq > bestDistance) {
          bestDistance = distanceSq;
          spanStart = connectors[a];
          spanEnd = connectors[b];
        }
      }
    }

    const componentSet = new Set<number>(component);
    let bridgePath: number[] | null = null;
    if (spanStart.bridgeIdx === spanEnd.bridgeIdx) {
      bridgePath = [spanStart.bridgeIdx];
    } else {
      const previous = new Map<number, number>();
      const pathQueue = [spanStart.bridgeIdx];
      const seen = new Set<number>([spanStart.bridgeIdx]);
      let found = false;
      for (let head = 0; head < pathQueue.length && !found; head += 1) {
        const current = pathQueue[head];
        const neighbors = bridgeNeighbors.get(current) ?? [];
        for (let j = 0; j < neighbors.length; j += 1) {
          const neighborIdx = neighbors[j];
          if (!componentSet.has(neighborIdx) || seen.has(neighborIdx)) {
            continue;
          }
          previous.set(neighborIdx, current);
          if (neighborIdx === spanEnd.bridgeIdx) {
            found = true;
            break;
          }
          seen.add(neighborIdx);
          pathQueue.push(neighborIdx);
        }
      }
      if (previous.has(spanEnd.bridgeIdx)) {
        bridgePath = [];
        let cursor = spanEnd.bridgeIdx;
        bridgePath.push(cursor);
        while (cursor !== spanStart.bridgeIdx) {
          const parent = previous.get(cursor);
          if (parent === undefined) {
            bridgePath = null;
            break;
          }
          cursor = parent;
          bridgePath.push(cursor);
        }
        if (bridgePath) {
          bridgePath.reverse();
        }
      }
    }

    if (!bridgePath || bridgePath.length === 0) {
      orphanComponents.push(componentDebug);
      continue;
    }

    spans.push({
      componentIndex: componentDebug.componentIndex,
      componentTileCount: component.length,
      connectorCount: connectors.length,
      componentBounds,
      componentTiles: component,
      bridgePath,
      startRoadIdx: spanStart.roadIdx,
      endRoadIdx: spanEnd.roadIdx
    });
  }

  const bridgeDebug: TerrainBridgeDebug = {
    totalBridgeTiles: bridgeIndices.length,
    componentCount: spans.length + orphanComponents.length,
    renderedSpanCount: 0,
    orphanComponentCount: orphanComponents.length,
    spans: [],
    orphanComponents
  };

  if (spans.length === 0) {
    return {
      group: null,
      debug: bridgeDebug
    };
  }

  const roadColor = TILE_COLOR_RGB.road;
  const deckColor = new THREE.Color(
    clamp((roadColor.r + 14) / 255, 0, 1),
    clamp((roadColor.g + 14) / 255, 0, 1),
    clamp((roadColor.b + 14) / 255, 0, 1)
  );
  const railingColor = new THREE.Color(
    clamp((roadColor.r + 36) / 255, 0, 1),
    clamp((roadColor.g + 32) / 255, 0, 1),
    clamp((roadColor.b + 28) / 255, 0, 1)
  );
  const beamColor = new THREE.Color(
    clamp((roadColor.r - 24) / 255, 0, 1),
    clamp((roadColor.g - 26) / 255, 0, 1),
    clamp((roadColor.b - 28) / 255, 0, 1)
  );
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: deckColor,
    roughness: 0.88,
    metalness: 0.04
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: railingColor,
    roughness: 0.78,
    metalness: 0.08
  });
  const abutmentMaterial = new THREE.MeshStandardMaterial({
    color: beamColor.clone().lerp(deckColor, 0.22),
    roughness: 0.9,
    metalness: 0.02,
    side: THREE.DoubleSide
  });
  const bridgeOverlay = getBridgeStraightOverlayTexture() ?? roadOverlay;
  const overlayMaterial = bridgeOverlay
    ? new THREE.MeshStandardMaterial({
        map: bridgeOverlay,
        color: new THREE.Color(0xffffff),
        transparent: true,
        depthWrite: false,
        roughness: 0.9,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      })
    : null;
  if (overlayMaterial) {
    overlayMaterial.alphaTest = 0.02;
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const bridgeGroup = new THREE.Group();
  const addBridgeObject = (group: THREE.Group, object: THREE.Object3D): void => {
    object.userData.bridgeDeck = true;
    group.add(object);
  };
  const sanitizeAnchorWaterY = (
    terrainY: number,
    roadY: number,
    waterY: number | null
  ): number | null => {
    if (!Number.isFinite(waterY)) {
      return null;
    }
    const resolved = waterY as number;
    const maxPlausibleFromBank = terrainY - BRIDGE_ANCHOR_WATER_MARGIN * 0.5;
    const maxPlausibleFromRoad = roadY + BRIDGE_ANCHOR_MAX_BANK_RISE;
    if (resolved > maxPlausibleFromBank || resolved > maxPlausibleFromRoad) {
      return null;
    }
    return resolved;
  };
  const finalizeBridgeAnchor = (
    roadContactEdgeX: number,
    roadContactEdgeY: number,
    bankContactEdgeX: number,
    bankContactEdgeY: number,
    roadY: number,
    waterY: number | null,
    searchDistance: number,
    fallback: boolean
  ): BridgeAnchor => {
    const terrainY = sampleTerrainWorldAtTileCoord(bankContactEdgeX, bankContactEdgeY);
    const terrainSurfaceY = terrainY + ROAD_SURFACE_OFFSET + BRIDGE_DECK_SURFACE_LIFT;
    const effectiveWaterY = sanitizeAnchorWaterY(
      terrainY,
      roadY,
      waterY ?? sampleWaterSurfaceYAtTileCoord(bankContactEdgeX, bankContactEdgeY)
    );
    const baseY = Math.max(
      terrainSurfaceY,
      terrainY + BRIDGE_DECK_CLEARANCE_BANK,
      effectiveWaterY === null ? Number.NEGATIVE_INFINITY : effectiveWaterY + BRIDGE_DECK_CLEARANCE_WATER
    );
    return {
      edgeX: bankContactEdgeX,
      edgeY: bankContactEdgeY,
      roadContactEdgeX,
      roadContactEdgeY,
      bankContactEdgeX,
      bankContactEdgeY,
      terrainY,
      roadY,
      waterY: effectiveWaterY ?? null,
      baseY,
      searchDistance,
      fallback,
      x: edgeToWorldX(bankContactEdgeX),
      z: edgeToWorldZ(bankContactEdgeY),
      roadContactX: edgeToWorldX(roadContactEdgeX),
      roadContactZ: edgeToWorldZ(roadContactEdgeY),
      bankContactX: edgeToWorldX(bankContactEdgeX),
      bankContactZ: edgeToWorldZ(bankContactEdgeY)
    };
  };
  const resolveBridgeAnchor = (
    roadIdx: number,
    bridgeIdx: number,
    roadOverlap = BRIDGE_ANCHOR_ROAD_OVERLAP
  ): BridgeAnchor => {
    const roadTileX = roadIdx % cols;
    const roadTileY = Math.floor(roadIdx / cols);
    const bridgeTileX = bridgeIdx % cols;
    const bridgeTileY = Math.floor(bridgeIdx / cols);
    const roadEdgeX = roadTileX + 0.5;
    const roadEdgeY = roadTileY + 0.5;
    const bridgeEdgeX = bridgeTileX + 0.5;
    const bridgeEdgeY = bridgeTileY + 0.5;
    let dirX = bridgeEdgeX - roadEdgeX;
    let dirY = bridgeEdgeY - roadEdgeY;
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLength;
    dirY /= dirLength;
    const roadY = roadSurfaceWorldYAtTileCoord(roadEdgeX, roadEdgeY);
    const roadContactDistance = Math.min(Math.max(roadOverlap, BRIDGE_ANCHOR_SEARCH_STEP), dirLength * 0.35);
    const roadContactEdgeX = clamp(roadEdgeX + dirX * roadContactDistance, 0, cols);
    const roadContactEdgeY = clamp(roadEdgeY + dirY * roadContactDistance, 0, rows);
    const defaultBankDistance = clamp(dirLength * 0.5 - roadOverlap, roadContactDistance, dirLength);
    const defaultBankEdgeX = clamp(roadEdgeX + dirX * defaultBankDistance, 0, cols);
    const defaultBankEdgeY = clamp(roadEdgeY + dirY * defaultBankDistance, 0, rows);
    const defaultWaterY =
      sampleWaterSurfaceYAtTileCoord(bridgeEdgeX, bridgeEdgeY) ??
      sampleWaterSurfaceYAtTileCoord(defaultBankEdgeX, defaultBankEdgeY);
    const fallbackAnchor = finalizeBridgeAnchor(
      roadContactEdgeX,
      roadContactEdgeY,
      defaultBankEdgeX,
      defaultBankEdgeY,
      roadY,
      defaultWaterY,
      Math.hypot(defaultBankEdgeX - roadContactEdgeX, defaultBankEdgeY - roadContactEdgeY),
      true
    );

    let lastStable: BridgeAnchorCandidate | null = null;
    let preferredStable: BridgeAnchorCandidate | null = null;
    const searchStart = Math.min(dirLength, roadContactDistance + BRIDGE_ANCHOR_SEARCH_STEP * 0.5);
    for (let dist = searchStart; dist <= dirLength + BRIDGE_ANCHOR_SEARCH_STEP * 0.5; dist += BRIDGE_ANCHOR_SEARCH_STEP) {
      const clampedDistance = clamp(dist, searchStart, dirLength);
      const edgeX = clamp(roadEdgeX + dirX * clampedDistance, 0, cols);
      const edgeY = clamp(roadEdgeY + dirY * clampedDistance, 0, rows);
      const terrainY = sampleTerrainWorldAtTileCoord(edgeX, edgeY);
      const waterCoverage = sampleWaterCoverageAtTileCoord(edgeX, edgeY);
      const localWaterY = sanitizeAnchorWaterY(
        terrainY,
        roadY,
        sampleWaterSurfaceYAtTileCoord(edgeX, edgeY) ?? defaultWaterY ?? null
      );
      const stableAboveWater = localWaterY === null || terrainY >= localWaterY + BRIDGE_ANCHOR_WATER_MARGIN;
      const stableLand = stableAboveWater && waterCoverage <= BRIDGE_ANCHOR_WATER_COVERAGE_MAX;
      if (!stableLand) {
        if (lastStable) {
          break;
        }
        continue;
      }
      const candidate: BridgeAnchorCandidate = {
        edgeX,
        edgeY,
        terrainY,
        waterY: localWaterY,
        searchDistance: Math.hypot(edgeX - roadContactEdgeX, edgeY - roadContactEdgeY)
      };
      lastStable = candidate;
      const terrainSurfaceY = terrainY + ROAD_SURFACE_OFFSET + BRIDGE_DECK_SURFACE_LIFT;
      if (terrainSurfaceY <= roadY + BRIDGE_ANCHOR_MAX_BANK_RISE) {
        preferredStable = candidate;
      }
      if (clampedDistance >= dirLength - 1e-5) {
        break;
      }
    }

    const chosen = preferredStable ?? lastStable;
    if (!chosen) {
      return fallbackAnchor;
    }
    return finalizeBridgeAnchor(
      roadContactEdgeX,
      roadContactEdgeY,
      chosen.edgeX,
      chosen.edgeY,
      roadY,
      chosen.waterY,
      chosen.searchDistance,
      false
    );
  };
  const buildBridgeTileRoutePoint = (idx: number): BridgeRoutePoint => {
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    const terrainY = sampleTerrainWorldAtTileCoord(tileX + 0.5, tileY + 0.5);
    const riverSurfaceY = sampleWaterSurfaceYAtTileCoord(tileX + 0.5, tileY + 0.5);
    const baseY = Math.max(
      terrainY + ROAD_SURFACE_OFFSET + BRIDGE_DECK_SURFACE_LIFT,
      terrainY + BRIDGE_DECK_CLEARANCE_BANK,
      riverSurfaceY === null ? Number.NEGATIVE_INFINITY : riverSurfaceY + BRIDGE_DECK_CLEARANCE_WATER
    );
    return {
      idx,
      x: edgeToWorldX(tileX + 0.5),
      z: edgeToWorldZ(tileY + 0.5),
      baseY,
      terrainY,
      riverSurfaceY: riverSurfaceY ?? undefined
    };
  };
  const buildBridgeAbutment = (
    roadPoint: BridgeProfilePoint,
    bankPoint: BridgeProfilePoint
  ): { mesh: THREE.Mesh | null; debug: TerrainBridgeAbutmentDebug } => {
    const length = roadPoint.center.distanceTo(bankPoint.center);
    if (length <= 1e-4) {
      return {
        mesh: null,
        debug: { length, minHeight: 0, maxHeight: 0, suppressed: true }
      };
    }
    const clampBottom = (topVertex: THREE.Vector3): THREE.Vector3 => {
      const terrainY = sampleTerrainWorldAtWorld(topVertex.x, topVertex.z);
      return new THREE.Vector3(topVertex.x, Math.min(topVertex.y - 0.002, terrainY), topVertex.z);
    };
    const roadLeftTop = roadPoint.leftBottom.clone();
    const roadRightTop = roadPoint.rightBottom.clone();
    const bankLeftTop = bankPoint.leftBottom.clone();
    const bankRightTop = bankPoint.rightBottom.clone();
    const roadLeftBottom = clampBottom(roadLeftTop);
    const roadRightBottom = clampBottom(roadRightTop);
    const bankLeftBottom = clampBottom(bankLeftTop);
    const bankRightBottom = clampBottom(bankRightTop);
    const heights = [
      roadLeftTop.y - roadLeftBottom.y,
      roadRightTop.y - roadRightBottom.y,
      bankLeftTop.y - bankLeftBottom.y,
      bankRightTop.y - bankRightBottom.y
    ];
    const minHeight = Math.max(0, Math.min(...heights));
    const maxHeight = Math.max(0, Math.max(...heights));
    const heightToLength = maxHeight / Math.max(1e-4, length);
    if (
      maxHeight < BRIDGE_ABUTMENT_MIN_HEIGHT ||
      maxHeight > BRIDGE_ABUTMENT_MAX_HEIGHT ||
      heightToLength > BRIDGE_ABUTMENT_HEIGHT_LENGTH_RATIO_MAX
    ) {
      return {
        mesh: null,
        debug: { length, minHeight, maxHeight, suppressed: true }
      };
    }

    const vertices = [
      roadLeftTop,
      roadRightTop,
      bankRightTop,
      bankLeftTop,
      roadLeftBottom,
      roadRightBottom,
      bankRightBottom,
      bankLeftBottom
    ];
    const positions: number[] = [];
    for (let i = 0; i < vertices.length; i += 1) {
      positions.push(vertices[i].x, vertices[i].y, vertices[i].z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex([
      4, 6, 5,
      4, 7, 6,
      0, 3, 7,
      0, 7, 4,
      1, 5, 6,
      1, 6, 2,
      0, 4, 5,
      0, 5, 1,
      3, 2, 6,
      3, 6, 7
    ]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, abutmentMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return {
      mesh,
      debug: { length, minHeight, maxHeight, suppressed: false }
    };
  };

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const spanGroup = new THREE.Group();
    const anchorRoadOverlap =
      span.bridgePath.length <= 2 ? BRIDGE_ANCHOR_ROAD_OVERLAP_SHORT_SPAN : BRIDGE_ANCHOR_ROAD_OVERLAP;
    const startAnchor = resolveBridgeAnchor(span.startRoadIdx, span.bridgePath[0], anchorRoadOverlap);
    const endAnchor = resolveBridgeAnchor(
      span.endRoadIdx,
      span.bridgePath[span.bridgePath.length - 1],
      anchorRoadOverlap
    );
    const routePoints: BridgeRoutePoint[] = [];
    const pushRoutePoint = (point: BridgeRoutePoint): void => {
      const previous = routePoints[routePoints.length - 1];
      if (previous && Math.hypot(previous.x - point.x, previous.z - point.z) <= 1e-4) {
        previous.baseY = Math.max(previous.baseY, point.baseY);
        if (Number.isFinite(point.terrainY)) {
          previous.terrainY = point.terrainY;
        }
        if (Number.isFinite(point.riverSurfaceY)) {
          previous.riverSurfaceY = point.riverSurfaceY;
        }
        return;
      }
      routePoints.push(point);
    };
    const routeMode: TerrainBridgeSpanDebug["routeMode"] =
      span.bridgePath.length === 1 ? "single_tile_direct" : "tile_path";
    pushRoutePoint({
      x: startAnchor.roadContactX,
      z: startAnchor.roadContactZ,
      baseY: startAnchor.roadY,
      terrainY: sampleTerrainWorldAtTileCoord(startAnchor.roadContactEdgeX, startAnchor.roadContactEdgeY)
    });
    pushRoutePoint({
      x: startAnchor.bankContactX,
      z: startAnchor.bankContactZ,
      baseY: startAnchor.baseY,
      terrainY: startAnchor.terrainY,
      riverSurfaceY: startAnchor.waterY ?? undefined
    });
    if (routeMode === "single_tile_direct") {
      pushRoutePoint(buildBridgeTileRoutePoint(span.bridgePath[0]));
    } else {
      for (let j = 0; j < span.bridgePath.length; j += 1) {
        pushRoutePoint(buildBridgeTileRoutePoint(span.bridgePath[j]));
      }
    }
    pushRoutePoint({
      x: endAnchor.bankContactX,
      z: endAnchor.bankContactZ,
      baseY: endAnchor.baseY,
      terrainY: endAnchor.terrainY,
      riverSurfaceY: endAnchor.waterY ?? undefined
    });
    pushRoutePoint({
      x: endAnchor.roadContactX,
      z: endAnchor.roadContactZ,
      baseY: endAnchor.roadY,
      terrainY: sampleTerrainWorldAtTileCoord(endAnchor.roadContactEdgeX, endAnchor.roadContactEdgeY)
    });

    if (routePoints.length < 2) {
      continue;
    }

    const planarLengths = new Array<number>(routePoints.length).fill(0);
    let planarTotal = 0;
    for (let j = 1; j < routePoints.length; j += 1) {
      const dx = routePoints[j].x - routePoints[j - 1].x;
      const dz = routePoints[j].z - routePoints[j - 1].z;
      planarTotal += Math.hypot(dx, dz);
      planarLengths[j] = planarTotal;
    }
    if (planarTotal <= 1e-4) {
      continue;
    }

    const startY = routePoints[0].baseY;
    const endY = routePoints[routePoints.length - 1].baseY;
    const bankStartIndex = Math.min(1, routePoints.length - 1);
    const bankEndIndex = Math.max(bankStartIndex, routePoints.length - 2);
    const bankStartDistance = planarLengths[bankStartIndex] ?? 0;
    const bankEndDistance = planarLengths[bankEndIndex] ?? planarTotal;
    const bankSpanLength = Math.max(1e-5, bankEndDistance - bankStartDistance);
    const bankStartY = routePoints[bankStartIndex]?.baseY ?? startY;
    const bankEndY = routePoints[bankEndIndex]?.baseY ?? endY;
    const centerPoints: THREE.Vector3[] = [];
    for (let j = 0; j < routePoints.length; j += 1) {
      const point = routePoints[j];
      const distance = planarLengths[j] ?? 0;
      let targetY = point.baseY;
      let minY = point.baseY;
      if (j <= bankStartIndex) {
        const t = bankStartDistance > 1e-5 ? distance / bankStartDistance : 0;
        targetY = startY * (1 - t) + bankStartY * t;
        minY = point.baseY;
      } else if (j >= bankEndIndex) {
        const denom = Math.max(1e-5, planarTotal - bankEndDistance);
        const t = (distance - bankEndDistance) / denom;
        targetY = bankEndY * (1 - t) + endY * t;
        minY = point.baseY;
      } else {
        const t = (distance - bankStartDistance) / bankSpanLength;
        targetY = bankStartY * (1 - t) + bankEndY * t;
        minY = Number.isFinite(point.terrainY)
          ? (point.terrainY as number) + BRIDGE_DECK_CLEARANCE_BANK
          : Number.NEGATIVE_INFINITY;
      }
      const y = Math.max(minY, targetY);
      centerPoints.push(new THREE.Vector3(point.x, y, point.z));
    }

    const profilePoints: BridgeProfilePoint[] = [];
    const halfWidth = BRIDGE_DECK_WIDTH * 0.5;
    for (let j = 0; j < centerPoints.length; j += 1) {
      const prev = centerPoints[Math.max(0, j - 1)];
      const next = centerPoints[Math.min(centerPoints.length - 1, j + 1)];
      const tangent = next.clone().sub(prev);
      tangent.y = 0;
      if (tangent.lengthSq() < 1e-6) {
        tangent.set(1, 0, 0);
      } else {
        tangent.normalize();
      }
      const right = new THREE.Vector3(-tangent.z, 0, tangent.x);
      const center = centerPoints[j];
      const leftTop = center.clone().addScaledVector(right, -halfWidth);
      const rightTop = center.clone().addScaledVector(right, halfWidth);
      const leftBottom = leftTop.clone();
      const rightBottom = rightTop.clone();
      leftBottom.y -= BRIDGE_DECK_THICKNESS;
      rightBottom.y -= BRIDGE_DECK_THICKNESS;
      profilePoints.push({
        center,
        right,
        leftTop,
        rightTop,
        leftBottom,
        rightBottom
      });
    }

    const deckGeometry = buildBridgeDeckGeometry(profilePoints);
    if (deckGeometry) {
      const deckMesh = new THREE.Mesh(deckGeometry, deckMaterial);
      deckMesh.castShadow = true;
      deckMesh.receiveShadow = true;
      addBridgeObject(spanGroup, deckMesh);
    }

    if (overlayMaterial) {
      const overlayGeometry = buildBridgeOverlayGeometry(profilePoints, BRIDGE_SURFACE_WIDTH);
      if (overlayGeometry) {
        const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
        overlayMesh.castShadow = false;
        overlayMesh.receiveShadow = true;
        overlayMesh.renderOrder = 2;
        addBridgeObject(spanGroup, overlayMesh);
      }
    }

    const startAbutment =
      profilePoints.length >= 2
        ? buildBridgeAbutment(profilePoints[0], profilePoints[1])
        : { mesh: null, debug: { length: 0, minHeight: 0, maxHeight: 0, suppressed: true } };
    if (startAbutment.mesh) {
      addBridgeObject(spanGroup, startAbutment.mesh);
    }
    const endAbutment =
      profilePoints.length >= 2
        ? buildBridgeAbutment(profilePoints[profilePoints.length - 1], profilePoints[profilePoints.length - 2])
        : { mesh: null, debug: { length: 0, minHeight: 0, maxHeight: 0, suppressed: true } };
    if (endAbutment.mesh) {
      addBridgeObject(spanGroup, endAbutment.mesh);
    }

    const { cumulative, total: spanLength } = buildBridgePolylineLengths(centerPoints);
    if (spanLength <= 1e-4) {
      continue;
    }
    const railOffset = halfWidth - BRIDGE_RAIL_EDGE_INSET;
    for (let j = 0; j < profilePoints.length - 1; j += 1) {
      const next = j + 1;
      for (const side of [-1, 1]) {
        for (const railHeight of [BRIDGE_RAIL_HEIGHT, BRIDGE_RAIL_MID_HEIGHT]) {
          const railThickness = railHeight === BRIDGE_RAIL_HEIGHT ? BRIDGE_RAIL_THICKNESS : BRIDGE_RAIL_THICKNESS * 0.75;
          const a = profilePoints[j].center.clone().addScaledVector(profilePoints[j].right, side * railOffset);
          const b = profilePoints[next].center.clone().addScaledVector(profilePoints[next].right, side * railOffset);
          a.y += railHeight;
          b.y += railHeight;
          const forward = b.clone().sub(a);
          const length = forward.length();
          if (length <= 1e-4) {
            continue;
          }
          const center = a.clone().add(b).multiplyScalar(0.5);
          const railMesh = createBridgeBoxMesh(
            unitBox,
            railMaterial,
            center,
            forward,
            new THREE.Vector3(length, railThickness, railThickness)
          );
          addBridgeObject(spanGroup, railMesh);
        }
      }
    }

    const postInset = Math.min(BRIDGE_ABUTMENT_LENGTH, spanLength * 0.18);
    const usablePostLength = Math.max(0, spanLength - postInset * 2);
    const postSteps = Math.max(1, Math.floor(usablePostLength / BRIDGE_POST_SPACING));
    for (let j = 0; j <= postSteps; j += 1) {
      const distance = postInset + usablePostLength * (j / Math.max(1, postSteps));
      const samplePoint = sampleBridgePolyline(profilePoints, cumulative, spanLength, distance);
      for (const side of [-1, 1]) {
        const postMesh = new THREE.Mesh(unitBox, railMaterial);
        postMesh.position.copy(samplePoint.position).addScaledVector(samplePoint.right, side * railOffset);
        postMesh.position.y += BRIDGE_RAIL_HEIGHT * 0.5;
        postMesh.scale.set(BRIDGE_POST_SIZE, BRIDGE_RAIL_HEIGHT, BRIDGE_POST_SIZE);
        postMesh.castShadow = true;
        postMesh.receiveShadow = true;
        postMesh.updateMatrix();
        postMesh.matrixAutoUpdate = false;
        addBridgeObject(spanGroup, postMesh);
      }
    }

    if (spanGroup.children.length === 0) {
      continue;
    }

    let minDeckY = Number.POSITIVE_INFINITY;
    let maxDeckY = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < centerPoints.length; j += 1) {
      minDeckY = Math.min(minDeckY, centerPoints[j].y);
      maxDeckY = Math.max(maxDeckY, centerPoints[j].y);
    }
    let minTerrainClearance = Number.POSITIVE_INFINITY;
    let minWaterClearance: number | null = null;
    for (let j = 0; j < routePoints.length; j += 1) {
      const point = routePoints[j];
      let terrainY = point.terrainY;
      if (!Number.isFinite(terrainY)) {
        terrainY = heightAtTileCoord(worldToEdgeX(point.x), worldToEdgeY(point.z)) * heightScale;
      }
      const resolvedTerrainY = terrainY ?? 0;
      minTerrainClearance = Math.min(minTerrainClearance, point.baseY - resolvedTerrainY);
      if (Number.isFinite(point.riverSurfaceY)) {
        const clearance = point.baseY - (point.riverSurfaceY as number);
        minWaterClearance = minWaterClearance === null ? clearance : Math.min(minWaterClearance, clearance);
      }
    }

    const spanDebug: TerrainBridgeSpanDebug = {
      spanIndex: bridgeDebug.spans.length,
      componentIndex: span.componentIndex,
      componentTileCount: span.componentTileCount,
      connectorCount: span.connectorCount,
      componentBounds: span.componentBounds,
      bridgeTiles: span.componentTiles.map((idx) => buildBridgeTileDebug(idx, cols)),
      connectors: [
        {
          bridge: buildBridgeTileDebug(span.bridgePath[0], cols),
          road: buildBridgeTileDebug(span.startRoadIdx, cols)
        },
        {
          bridge: buildBridgeTileDebug(span.bridgePath[span.bridgePath.length - 1], cols),
          road: buildBridgeTileDebug(span.endRoadIdx, cols)
        }
      ],
      routeMode,
      bridgePath: span.bridgePath.map((idx) => buildBridgeTileDebug(idx, cols)),
      startRoad: buildBridgeTileDebug(span.startRoadIdx, cols),
      endRoad: buildBridgeTileDebug(span.endRoadIdx, cols),
      startAnchor,
      endAnchor,
      startAbutment: startAbutment.debug,
      endAbutment: endAbutment.debug,
      worldSpanLength: spanLength,
      minDeckY,
      maxDeckY,
      minTerrainClearance,
      minWaterClearance
    };

    spanGroup.userData.bridgeDeck = true;
    spanGroup.userData.bridgeSpanDebug = spanDebug;
    spanGroup.userData.bridgeSpanIndex = spanDebug.spanIndex;
    bridgeDebug.spans.push(spanDebug);
    addBridgeObject(bridgeGroup, spanGroup);
  }

  bridgeDebug.renderedSpanCount = bridgeDebug.spans.length;
  if (bridgeGroup.children.length === 0) {
    return {
      group: null,
      debug: bridgeDebug
    };
  }

  bridgeGroup.userData.bridgeDeck = true;
  bridgeGroup.userData.bridgeDebug = bridgeDebug;
  return {
    group: bridgeGroup,
    debug: bridgeDebug
  };
};
