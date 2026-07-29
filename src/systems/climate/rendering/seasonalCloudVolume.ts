export const SEASONAL_CLOUD_VOLUME_SIZE = 32;
export const SEASONAL_CLOUD_VOLUME_CHANNELS = 4;
export const SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS = 8;
export const SEASONAL_CLOUD_VOLUME_ATLAS_ROWS = 4;
export const SEASONAL_CLOUD_VOLUME_ATLAS_BORDER = 1;
export const SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE =
  SEASONAL_CLOUD_VOLUME_SIZE + SEASONAL_CLOUD_VOLUME_ATLAS_BORDER * 2;
export const SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH =
  SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE;
export const SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT =
  SEASONAL_CLOUD_VOLUME_ATLAS_ROWS * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE;

export type SeasonalCloudVolumeData = {
  data: Uint8Array;
  atlasData: Uint8Array;
  size: number;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

const hashNoiseLattice3d = (x: number, y: number, z: number, salt: number): number => {
  const value =
    Math.sin(x * 127.1 + y * 311.7 + z * 191.999 + salt * 74.7) *
    43758.5453123;
  return value - Math.floor(value);
};

const sampleTileableValueNoise3d = (
  u: number,
  v: number,
  w: number,
  frequency: number,
  salt: number
): number => {
  const x = wrap01(u) * frequency;
  const y = wrap01(v) * frequency;
  const z = wrap01(w) * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const z1 = (z0 + 1) % frequency;
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sz = tz * tz * (3 - 2 * tz);
  const sample = (sampleX: number, sampleY: number, sampleZ: number): number =>
    hashNoiseLattice3d(sampleX, sampleY, sampleZ, salt);
  const lowZ = lerp(
    lerp(sample(x0, y0, z0), sample(x1, y0, z0), sx),
    lerp(sample(x0, y1, z0), sample(x1, y1, z0), sx),
    sy
  );
  const highZ = lerp(
    lerp(sample(x0, y0, z1), sample(x1, y0, z1), sx),
    lerp(sample(x0, y1, z1), sample(x1, y1, z1), sx),
    sy
  );
  return lerp(lowZ, highZ, sz);
};

const buildSeasonalCloudVolumeData = (): SeasonalCloudVolumeData => {
  const size = SEASONAL_CLOUD_VOLUME_SIZE;
  const channels = SEASONAL_CLOUD_VOLUME_CHANNELS;
  const data = new Uint8Array(size * size * size * channels);
  for (let z = 0; z < size; z += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / size;
        const v = y / size;
        const w = z / size;
        const broad = sampleTileableValueNoise3d(u, v, w, 2, 0.43);
        const billowBase = sampleTileableValueNoise3d(u, v, w, 4, 1.87);
        const medium = sampleTileableValueNoise3d(u, v, w, 8, 3.11);
        const fine = sampleTileableValueNoise3d(u, v, w, 16, 5.29);
        const billow = 1 - Math.abs(billowBase * 2 - 1);
        const erosion = 1 - Math.abs(medium * 2 - 1);
        const index = ((z * size + y) * size + x) * channels;
        data[index] = Math.round(clamp01(broad * 0.58 + billowBase * 0.29 + medium * 0.13) * 255);
        data[index + 1] = Math.round(clamp01(billow * 0.68 + broad * 0.22 + medium * 0.1) * 255);
        data[index + 2] = Math.round(clamp01(medium * 0.68 + fine * 0.32) * 255);
        data[index + 3] = Math.round(clamp01(erosion * 0.62 + fine * 0.38) * 255);
      }
    }
  }

  const atlasData = new Uint8Array(
    SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH *
      SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT *
      channels
  );
  for (let z = 0; z < size; z += 1) {
    const tileX = z % SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS;
    const tileY = Math.floor(z / SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS);
    for (let localY = -1; localY <= size; localY += 1) {
      for (let localX = -1; localX <= size; localX += 1) {
        const sourceX = (localX + size) % size;
        const sourceY = (localY + size) % size;
        const sourceIndex = ((z * size + sourceY) * size + sourceX) * channels;
        const atlasX =
          tileX * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE +
          localX +
          SEASONAL_CLOUD_VOLUME_ATLAS_BORDER;
        const atlasY =
          tileY * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE +
          localY +
          SEASONAL_CLOUD_VOLUME_ATLAS_BORDER;
        const atlasIndex =
          (atlasY * SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH + atlasX) * channels;
        for (let channel = 0; channel < channels; channel += 1) {
          atlasData[atlasIndex + channel] = data[sourceIndex + channel] ?? 0;
        }
      }
    }
  }
  return { data, atlasData, size };
};

export const SEASONAL_CLOUD_VOLUME = buildSeasonalCloudVolumeData();

export const sampleSeasonalCloudVolume = (
  x: number,
  y: number,
  z: number,
  channel: number
): number => {
  const { data, size } = SEASONAL_CLOUD_VOLUME;
  const px = wrap01(x) * size;
  const py = wrap01(y) * size;
  const pz = wrap01(z) * size;
  const x0 = Math.floor(px) % size;
  const y0 = Math.floor(py) % size;
  const z0 = Math.floor(pz) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const z1 = (z0 + 1) % size;
  const tx = px - Math.floor(px);
  const ty = py - Math.floor(py);
  const tz = pz - Math.floor(pz);
  const read = (sampleX: number, sampleY: number, sampleZ: number): number =>
    (data[
      ((sampleZ * size + sampleY) * size + sampleX) *
        SEASONAL_CLOUD_VOLUME_CHANNELS +
        channel
    ] ?? 0) / 255;
  const lowZ = lerp(
    lerp(read(x0, y0, z0), read(x1, y0, z0), tx),
    lerp(read(x0, y1, z0), read(x1, y1, z0), tx),
    ty
  );
  const highZ = lerp(
    lerp(read(x0, y0, z1), read(x1, y0, z1), tx),
    lerp(read(x0, y1, z1), read(x1, y1, z1), tx),
    ty
  );
  return lerp(lowZ, highZ, tz);
};
