export type HouseVariantFootprint = {
  source: string;
  name: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  parcelX: number;
  parcelZ: number;
  roofType: "gable" | "hip" | "lean_to";
  wallTint: string;
  roofTint: string;
};

export const HOUSE_VARIANTS: HouseVariantFootprint[] = [
  {
    source: "procedural/compact_gable",
    name: "compact_gable",
    sizeX: 0.92,
    sizeY: 0.88,
    sizeZ: 0.72,
    parcelX: 1.45,
    parcelZ: 1.12,
    roofType: "gable",
    wallTint: "#c98f5b",
    roofTint: "#6a4d38"
  },
  {
    source: "procedural/broad_gable",
    name: "broad_gable",
    sizeX: 1.18,
    sizeY: 0.92,
    sizeZ: 0.84,
    parcelX: 1.72,
    parcelZ: 1.24,
    roofType: "gable",
    wallTint: "#be7c58",
    roofTint: "#6f5646"
  },
  {
    source: "procedural/lean_to_cottage",
    name: "lean_to_cottage",
    sizeX: 1.02,
    sizeY: 0.98,
    sizeZ: 0.76,
    parcelX: 1.56,
    parcelZ: 1.18,
    roofType: "lean_to",
    wallTint: "#d19a72",
    roofTint: "#5f4a3e"
  },
  {
    source: "procedural/hip_roof",
    name: "hip_roof",
    sizeX: 0.96,
    sizeY: 0.9,
    sizeZ: 0.9,
    parcelX: 1.42,
    parcelZ: 1.18,
    roofType: "hip",
    wallTint: "#c58a61",
    roofTint: "#66493b"
  }
];

export const FIRESTATION_FOOTPRINT = {
  source: "assets/3d/GLTF/Firestation/Classic Fire Station.glb",
  sizeX: 1.0407,
  sizeY: 0.5112,
  sizeZ: 0.4774
};

export const BUILDING_FOOTPRINTS_META = {
  generatedAt: "procedural",
  tileSize: 10,
  houseSources: HOUSE_VARIANTS.map((variant) => variant.source),
  firestationSource: FIRESTATION_FOOTPRINT.source
};
