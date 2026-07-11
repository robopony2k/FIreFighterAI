import * as THREE from "three";

export const TERRAIN_RENDER_CHUNK_TILE_SPAN = 64;

export type TerrainChunkCoordinate = {
  chunkX: number;
  chunkY: number;
};

export type TerrainChunk<T> = TerrainChunkCoordinate & {
  key: string;
  instances: T[];
};

export const getTerrainChunkKey = (tileX: number, tileY: number, span = TERRAIN_RENDER_CHUNK_TILE_SPAN): string => {
  const safeSpan = Math.max(1, Math.floor(span));
  return `${Math.floor(tileX / safeSpan)},${Math.floor(tileY / safeSpan)}`;
};

export const partitionTerrainInstances = <T>(
  instances: readonly T[],
  getTile: (instance: T) => { x: number; y: number },
  span = TERRAIN_RENDER_CHUNK_TILE_SPAN
): TerrainChunk<T>[] => {
  const safeSpan = Math.max(1, Math.floor(span));
  const chunks = new Map<string, TerrainChunk<T>>();
  instances.forEach((instance) => {
    const tile = getTile(instance);
    const chunkX = Math.floor(tile.x / safeSpan);
    const chunkY = Math.floor(tile.y / safeSpan);
    const key = `${chunkX},${chunkY}`;
    const existing = chunks.get(key);
    if (existing) {
      existing.instances.push(instance);
    } else {
      chunks.set(key, { key, chunkX, chunkY, instances: [instance] });
    }
  });
  return Array.from(chunks.values()).sort((left, right) => left.chunkY - right.chunkY || left.chunkX - right.chunkX);
};

export const finalizeInstancedMeshBounds = (mesh: THREE.InstancedMesh): void => {
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
};
