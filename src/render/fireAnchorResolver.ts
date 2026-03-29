import type { RenderSim } from "./simView.js";
import type { TerrainRenderSurface, TreeBurnController } from "./threeTestTerrain.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type FireAnchorSource = "tree" | "structure" | "terrainSurface" | "rawFallback";
export type FireAnchorMode = "object" | "ground";

export type ResolvedFireAnchor = {
  tileIndex: number;
  tileX: number;
  tileY: number;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  source: FireAnchorSource;
};

export type FireStructureAnchor = {
  // Base/origin render anchor for a structure tile; fire FX still applies roof offsets on top.
  position: { x: number; y: number; z: number };
  normal?: { x: number; y: number; z: number } | null;
};

export type FireStructureAnchorProvider = (
  tileIndex: number,
  tileX: number,
  tileY: number
) => FireStructureAnchor | null;

export type FireAnchorResolver = {
  resolveTile: (tileIndex: number, mode?: FireAnchorMode) => ResolvedFireAnchor;
  getRawFallbackTileIndices: () => readonly number[];
};

type CreateFireAnchorResolverOptions = {
  world: RenderSim;
  cols: number;
  rows: number;
  terrainSize: { width: number; depth: number };
  heightScale: number;
  terrainSurface: TerrainRenderSurface | null;
  treeBurn: TreeBurnController | null;
  structureAnchorProvider?: FireStructureAnchorProvider | null;
  normalSampleOffset?: number;
};

type CachedFireAnchors = {
  ground?: ResolvedFireAnchor;
  object?: ResolvedFireAnchor;
  rawFallbackUsed?: boolean;
};

const normalizeVector = (x: number, y: number, z: number): { x: number; y: number; z: number } => {
  const length = Math.hypot(x, y, z);
  if (length <= 1e-6) {
    return { x: 0, y: 1, z: 0 };
  }
  let nx = x / length;
  let ny = y / length;
  let nz = z / length;
  if (ny < 0) {
    nx *= -1;
    ny *= -1;
    nz *= -1;
  }
  return { x: nx, y: ny, z: nz };
};

export const createFireAnchorResolver = ({
  world,
  cols,
  rows,
  terrainSize,
  heightScale,
  terrainSurface,
  treeBurn,
  structureAnchorProvider = null,
  normalSampleOffset
}: CreateFireAnchorResolverOptions): FireAnchorResolver => {
  const tileCount = Math.max(0, cols * rows);
  const offset =
    normalSampleOffset ?? (terrainSurface ? Math.max(0.05, terrainSurface.step * 0.35) : 0.35);
  const cache = new Map<number, CachedFireAnchors>();
  const rawFallbackTileIndices: number[] = [];
  const rawFallbackFlags = new Uint8Array(tileCount);
  const toWorldX = terrainSurface
    ? terrainSurface.toWorldX
    : (tileX: number): number => (tileX / Math.max(1, cols) - 0.5) * terrainSize.width;
  const toWorldZ = terrainSurface
    ? terrainSurface.toWorldZ
    : (tileY: number): number => (tileY / Math.max(1, rows) - 0.5) * terrainSize.depth;

  const noteRawFallback = (tileIndex: number): void => {
    if (tileIndex < 0 || tileIndex >= rawFallbackFlags.length || rawFallbackFlags[tileIndex] === 1) {
      return;
    }
    rawFallbackFlags[tileIndex] = 1;
    rawFallbackTileIndices.push(tileIndex);
  };

  const sampleRawHeightAtCoord = (tileX: number, tileY: number): number => {
    const sampleX = clamp(tileX - 0.5, 0, Math.max(0, cols - 1));
    const sampleY = clamp(tileY - 0.5, 0, Math.max(0, rows - 1));
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = sampleX - x0;
    const ty = sampleY - y0;
    const sampleElevation = (x: number, y: number): number =>
      clamp(world.tileElevation[y * cols + x] ?? 0, -1, 1) * heightScale;
    const h00 = sampleElevation(x0, y0);
    const h10 = sampleElevation(x1, y0);
    const h01 = sampleElevation(x0, y1);
    const h11 = sampleElevation(x1, y1);
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };

  const sampleHeightAtCoord = (tileX: number, tileY: number): number =>
    terrainSurface
      ? terrainSurface.heightAtTileCoord(tileX, tileY) * terrainSurface.heightScale
      : sampleRawHeightAtCoord(tileX, tileY);

  const sampleSurfaceNormal = (
    tileX: number,
    tileY: number,
    sampleHeightAt: (coordX: number, coordY: number) => number
  ): { x: number; y: number; z: number } => {
    const leftHeight = sampleHeightAt(tileX - offset, tileY);
    const rightHeight = sampleHeightAt(tileX + offset, tileY);
    const downHeight = sampleHeightAt(tileX, tileY - offset);
    const upHeight = sampleHeightAt(tileX, tileY + offset);
    const worldDx = ((offset * 2) / Math.max(1, cols)) * terrainSize.width;
    const worldDz = ((offset * 2) / Math.max(1, rows)) * terrainSize.depth;
    const slopeX = (rightHeight - leftHeight) / Math.max(1e-5, worldDx);
    const slopeZ = (upHeight - downHeight) / Math.max(1e-5, worldDz);
    return normalizeVector(-slopeX, 1, -slopeZ);
  };

  const resolveGroundAnchor = (
    tileIndex: number,
    tileXIndex: number,
    tileYIndex: number
  ): ResolvedFireAnchor => {
    const tileCoordX = tileXIndex + 0.5;
    const tileCoordY = tileYIndex + 0.5;
    if (terrainSurface) {
      return {
        tileIndex,
        tileX: tileXIndex,
        tileY: tileYIndex,
        position: {
          x: terrainSurface.toWorldX(tileCoordX),
          y: terrainSurface.heightAtTileCoord(tileCoordX, tileCoordY) * terrainSurface.heightScale,
          z: terrainSurface.toWorldZ(tileCoordY)
        },
        normal: sampleSurfaceNormal(tileCoordX, tileCoordY, sampleHeightAtCoord),
        source: "terrainSurface"
      };
    }
    noteRawFallback(tileIndex);
    return {
      tileIndex,
      tileX: tileXIndex,
      tileY: tileYIndex,
      position: {
        x: toWorldX(tileCoordX),
        y: sampleRawHeightAtCoord(tileCoordX, tileCoordY),
        z: toWorldZ(tileCoordY)
      },
      normal: sampleSurfaceNormal(tileCoordX, tileCoordY, sampleRawHeightAtCoord),
      source: "rawFallback"
    };
  };

  const resolveObjectAnchor = (
    tileIndex: number,
    tileXIndex: number,
    tileYIndex: number,
    groundAnchor: ResolvedFireAnchor
  ): ResolvedFireAnchor => {
    const treeAnchor = treeBurn?.getTileAnchor(tileIndex) ?? null;
    if (treeAnchor) {
      return {
        tileIndex,
        tileX: tileXIndex,
        tileY: tileYIndex,
        position: { x: treeAnchor.x, y: treeAnchor.y, z: treeAnchor.z },
        normal: { x: 0, y: 1, z: 0 },
        source: "tree"
      };
    }
    const structureAnchor = structureAnchorProvider?.(tileIndex, tileXIndex, tileYIndex) ?? null;
    if (structureAnchor) {
      const normal = structureAnchor.normal
        ? normalizeVector(structureAnchor.normal.x, structureAnchor.normal.y, structureAnchor.normal.z)
        : { x: 0, y: 1, z: 0 };
      return {
        tileIndex,
        tileX: tileXIndex,
        tileY: tileYIndex,
        position: {
          x: structureAnchor.position.x,
          y: structureAnchor.position.y,
          z: structureAnchor.position.z
        },
        normal,
        source: "structure"
      };
    }
    return groundAnchor;
  };

  return {
    resolveTile: (tileIndex: number, mode: FireAnchorMode = "object"): ResolvedFireAnchor => {
      const safeTileIndex = clamp(tileIndex, 0, Math.max(0, tileCount - 1));
      let cached = cache.get(safeTileIndex);
      if (!cached) {
        cached = {};
        cache.set(safeTileIndex, cached);
      }
      const tileX = safeTileIndex % Math.max(1, cols);
      const tileY = Math.floor(safeTileIndex / Math.max(1, cols));
      if (!cached.ground) {
        cached.ground = resolveGroundAnchor(safeTileIndex, tileX, tileY);
      }
      if (mode === "ground") {
        return cached.ground;
      }
      if (!cached.object) {
        cached.object = resolveObjectAnchor(safeTileIndex, tileX, tileY, cached.ground);
      }
      return cached.object;
    },
    getRawFallbackTileIndices: (): readonly number[] => rawFallbackTileIndices
  };
};
