import * as THREE from "three";

export type GrassVolumePropertyInput = {
  sourceCols: number;
  sourceRows: number;
  sampleCols: number;
  sampleRows: number;
  sampleStep: number;
  sampleTypes: Uint8Array;
  tileTypes?: Uint8Array;
  tileFuel?: Float32Array;
  tileMoisture?: Float32Array;
  grassTypeId: number;
  grassFuelReference: number;
};

export type GrassVolumePropertyField = {
  texture: THREE.DataTexture;
  sampleCols: number;
  sampleRows: number;
  update: (input: GrassVolumePropertyInput) => boolean;
  dispose: () => void;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Packs authoritative campaign vegetation state at the terrain render-field
 * resolution. R is current grass fuel relative to its active profile and G is
 * dryness (one minus tile moisture). B/A are reserved for future render-only
 * vegetation properties.
 */
export const packGrassVolumePropertyField = (
  input: GrassVolumePropertyInput,
  target?: Uint8Array
): Uint8Array => {
  const sourceCols = Math.max(1, Math.floor(input.sourceCols));
  const sourceRows = Math.max(1, Math.floor(input.sourceRows));
  const sampleCols = Math.max(1, Math.floor(input.sampleCols));
  const sampleRows = Math.max(1, Math.floor(input.sampleRows));
  const step = Math.max(1, Math.floor(input.sampleStep));
  const total = sampleCols * sampleRows;
  if (input.sampleTypes.length < total) {
    throw new Error("Grass property input does not cover its declared render grid.");
  }
  const data = target?.length === total * 4 ? target : new Uint8Array(total * 4);
  const fuelReference = Math.max(1e-5, input.grassFuelReference);
  let write = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const startY = Math.min(sourceRows - 1, row * step);
    const endY = Math.min(sourceRows, startY + step);
    for (let col = 0; col < sampleCols; col += 1) {
      const startX = Math.min(sourceCols - 1, col * step);
      const endX = Math.min(sourceCols, startX + step);
      let fuelSum = 0;
      let drynessSum = 0;
      let grassCount = 0;
      for (let y = startY; y < endY; y += 1) {
        const rowBase = y * sourceCols;
        for (let x = startX; x < endX; x += 1) {
          const sourceIndex = rowBase + x;
          if (input.tileTypes && input.tileTypes[sourceIndex] !== input.grassTypeId) continue;
          fuelSum += Math.max(0, input.tileFuel?.[sourceIndex] ?? fuelReference);
          drynessSum += 1 - clamp01(input.tileMoisture?.[sourceIndex] ?? 0.5);
          grassCount += 1;
        }
      }
      const renderIndex = row * sampleCols + col;
      const ownsGrass = input.sampleTypes[renderIndex] === input.grassTypeId;
      const fuel01 = ownsGrass && grassCount > 0 ? clamp01(fuelSum / grassCount / fuelReference) : 0;
      const dryness = ownsGrass && grassCount > 0 ? clamp01(drynessSum / grassCount) : 0;
      data[write] = Math.round(fuel01 * 255);
      data[write + 1] = Math.round(dryness * 255);
      data[write + 2] = 0;
      data[write + 3] = 255;
      write += 4;
    }
  }
  return data;
};

export const createGrassVolumePropertyField = (
  input: GrassVolumePropertyInput
): GrassVolumePropertyField => {
  const width = Math.max(1, Math.floor(input.sampleCols));
  const height = Math.max(1, Math.floor(input.sampleRows));
  const texture = new THREE.DataTexture(
    packGrassVolumePropertyField(input),
    width,
    height,
    THREE.RGBAFormat
  );
  texture.name = "grass-volume-gameplay-properties";
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
    sampleCols: width,
    sampleRows: height,
    update: (nextInput) => {
      const nextCols = Math.max(1, Math.floor(nextInput.sampleCols));
      const nextRows = Math.max(1, Math.floor(nextInput.sampleRows));
      if (nextCols !== width || nextRows !== height) return false;
      const image = texture.image as { data: Uint8Array };
      packGrassVolumePropertyField(nextInput, image.data);
      texture.needsUpdate = true;
      return true;
    },
    dispose: () => texture.dispose()
  };
};
