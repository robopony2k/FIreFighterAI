import { HOUSE_VARIANTS, type HouseVariantFootprint } from "./buildingFootprints.js";

const HOUSE_FOOTPRINT_EPS = 1e-4;

const DEFAULT_HOUSE_FOOTPRINT: HouseVariantFootprint = {
  source: "",
  name: "default",
  sizeX: 1,
  sizeY: 1,
  sizeZ: 1,
  parcelX: 1.25,
  parcelZ: 1,
  roofType: "gable",
  wallTint: "#c98f5b",
  roofTint: "#6a4d38"
};

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export type HouseFootprintMode = "asset" | "parcel";

export type HouseFootprintBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  depth: number;
};

export const pickHouseFootprint = (seed: number): HouseVariantFootprint => {
  if (HOUSE_VARIANTS.length === 0) {
    return DEFAULT_HOUSE_FOOTPRINT;
  }
  const index = Math.floor(noiseAt(seed + 6.1) * HOUSE_VARIANTS.length);
  return HOUSE_VARIANTS[Math.min(HOUSE_VARIANTS.length - 1, Math.max(0, index))] ?? DEFAULT_HOUSE_FOOTPRINT;
};

export const getHouseFootprintDims = (
  rotation: number,
  footprint: Pick<HouseVariantFootprint, "sizeX" | "sizeZ" | "parcelX" | "parcelZ">,
  mode: HouseFootprintMode = "parcel"
): { width: number; depth: number } => {
  const sizeX = mode === "asset" ? footprint.sizeX : footprint.parcelX;
  const sizeZ = mode === "asset" ? footprint.sizeZ : footprint.parcelZ;
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const width = sizeX * cos + sizeZ * sin;
  const depth = sizeX * sin + sizeZ * cos;
  return {
    width: Math.max(0.01, width),
    depth: Math.max(0.01, depth)
  };
};

export const getHouseFootprintBounds = (
  tileX: number,
  tileY: number,
  rotation: number,
  footprint: Pick<HouseVariantFootprint, "sizeX" | "sizeZ" | "parcelX" | "parcelZ">,
  mode: HouseFootprintMode = "parcel"
): HouseFootprintBounds => {
  const { width, depth } = getHouseFootprintDims(rotation, footprint, mode);
  const centerX = tileX + 0.5;
  const centerY = tileY + 0.5;
  const minX = Math.floor(centerX - width / 2);
  const maxX = Math.floor(centerX + width / 2 - HOUSE_FOOTPRINT_EPS);
  const minY = Math.floor(centerY - depth / 2);
  const maxY = Math.floor(centerY + depth / 2 - HOUSE_FOOTPRINT_EPS);
  return { minX, maxX, minY, maxY, width, depth };
};
