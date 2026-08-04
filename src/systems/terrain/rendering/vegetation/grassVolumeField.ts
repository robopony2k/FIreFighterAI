import * as THREE from "three";

export type GrassVolumeTerrainInput = {
  sampleCols: number;
  sampleRows: number;
  sampleHeights: Float32Array;
  sampleTypes: Uint8Array;
  grassTypeId: number;
  heightScale: number;
  width: number;
  depth: number;
};

export type GrassVolumeField = {
  texture: THREE.DataTexture;
  sampleCols: number;
  sampleRows: number;
  minHeight: number;
  maxHeight: number;
  width: number;
  depth: number;
  dispose: () => void;
};

export type PackedGrassVolumeField = {
  data: Uint8Array;
  minHeight: number;
  maxHeight: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const buildGrassChebyshevDistanceField = (
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  grassTypeId: number
): Uint16Array => {
  const cols = Math.max(1, Math.floor(sampleCols));
  const rows = Math.max(1, Math.floor(sampleRows));
  const total = cols * rows;
  if (sampleTypes.length < total) {
    throw new Error("Grass distance input does not cover its declared sample grid.");
  }
  const distances = new Uint16Array(total);
  distances.fill(0xffff);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < total; index += 1) {
    if (sampleTypes[index] !== grassTypeId) continue;
    distances[index] = 0;
    queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % cols;
    const y = Math.floor(index / cols);
    const nextDistance = distances[index] + 1;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) {
          continue;
        }
        const next = (y + dy) * cols + x + dx;
        if (distances[next] <= nextDistance) continue;
        distances[next] = nextDistance;
        queue[tail++] = next;
      }
    }
  }
  return distances;
};

export const decodePackedGrassHeight = (
  highByte: number,
  lowByte: number,
  minHeight: number,
  maxHeight: number
): number => {
  const packed = ((highByte & 0xff) << 8) | (lowByte & 0xff);
  return minHeight + (maxHeight - minHeight) * (packed / 65535);
};

export const packGrassVolumeField = (input: GrassVolumeTerrainInput): PackedGrassVolumeField => {
  const sampleCols = Math.max(1, Math.floor(input.sampleCols));
  const sampleRows = Math.max(1, Math.floor(input.sampleRows));
  const total = sampleCols * sampleRows;
  if (input.sampleHeights.length < total || input.sampleTypes.length < total) {
    throw new Error("Grass volume terrain input does not cover its declared sample grid.");
  }

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < total; index += 1) {
    const height = (input.sampleHeights[index] ?? 0) * input.heightScale;
    if (!Number.isFinite(height)) continue;
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) {
    minHeight = 0;
    maxHeight = 1;
  }
  if (maxHeight - minHeight < 1e-5) {
    maxHeight = minHeight + 1e-5;
  }

  const grassDistances = buildGrassChebyshevDistanceField(
    input.sampleTypes,
    sampleCols,
    sampleRows,
    input.grassTypeId
  );
  const data = new Uint8Array(total * 4);
  for (let index = 0; index < total; index += 1) {
    const height = (input.sampleHeights[index] ?? 0) * input.heightScale;
    const normalized = clamp01((height - minHeight) / (maxHeight - minHeight));
    const packedHeight = Math.round(normalized * 65535);
    const offset = index * 4;
    data[offset] = (packedHeight >>> 8) & 0xff;
    data[offset + 1] = packedHeight & 0xff;
    data[offset + 2] = input.sampleTypes[index] === input.grassTypeId ? 255 : 0;
    data[offset + 3] = Math.min(255, grassDistances[index] ?? 255);
  }
  return { data, minHeight, maxHeight };
};

export const createGrassVolumeField = (input: GrassVolumeTerrainInput): GrassVolumeField => {
  const sampleCols = Math.max(1, Math.floor(input.sampleCols));
  const sampleRows = Math.max(1, Math.floor(input.sampleRows));
  const packed = packGrassVolumeField(input);
  const texture = new THREE.DataTexture(packed.data, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.name = "grass-volume-terrain-field";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    texture,
    sampleCols,
    sampleRows,
    minHeight: packed.minHeight,
    maxHeight: packed.maxHeight,
    width: Math.max(1e-5, input.width),
    depth: Math.max(1e-5, input.depth),
    dispose: () => texture.dispose()
  };
};
