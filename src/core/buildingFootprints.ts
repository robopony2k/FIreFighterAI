export type HouseVariantFootprint = {
  source: string;
  name: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  parcelX: number;
  parcelZ: number;
};

export const HOUSE_VARIANTS: HouseVariantFootprint[] = [
  {
    source: "assets/3d/GLTF/Houses/house_001.glb",
    name: "sketchfab_model",
    sizeX: 1.0371,
    sizeY: 1.1389,
    sizeZ: 0.7607,
    parcelX: 2.2,
    parcelZ: 1.8
  },
  {
    source: "assets/3d/GLTF/Houses/house_002.glb",
    name: "sketchfab_model",
    sizeX: 0.5532,
    sizeY: 0.6772,
    sizeZ: 0.56,
    parcelX: 1.3277,
    parcelZ: 1.344
  },
  {
    source: "assets/3d/GLTF/Houses/house_003.glb",
    name: "sketchfab_model",
    sizeX: 0.2459,
    sizeY: 0.2031,
    sizeZ: 0.1702,
    parcelX: 1.25,
    parcelZ: 1
  },
  {
    source: "assets/3d/GLTF/Houses/house_004.glb",
    name: "sketchfab_model",
    sizeX: 0.5306,
    sizeY: 0.4224,
    sizeZ: 0.3302,
    parcelX: 1.2734,
    parcelZ: 1
  },
  {
    source: "assets/3d/GLTF/Houses/house_005.glb",
    name: "sketchfab_model",
    sizeX: 0.2653,
    sizeY: 0.2104,
    sizeZ: 0.3311,
    parcelX: 1.25,
    parcelZ: 1
  },
  {
    source: "assets/3d/GLTF/Houses/house_006.glb",
    name: "sketchfab_model",
    sizeX: 0.3772,
    sizeY: 0.39,
    sizeZ: 0.2785,
    parcelX: 1.25,
    parcelZ: 1
  },
  {
    source: "assets/3d/GLTF/Houses/suburb_house__001.glb",
    name: "sketchfab_model",
    sizeX: 0.4095,
    sizeY: 0.5148,
    sizeZ: 0.4282,
    parcelX: 1.25,
    parcelZ: 1.0277
  },
];

export const FIRESTATION_FOOTPRINT = {
  source: "assets/3d/GLTF/Firestation/Classic Fire Station.glb",
  sizeX: 1.0407,
  sizeY: 0.5112,
  sizeZ: 0.4774
};

export const BUILDING_FOOTPRINTS_META = {
  generatedAt: "2026-02-22T06:10:14.235Z",
  tileSize: 10,
  houseSources: ["assets/3d/GLTF/Houses/house_001.glb","assets/3d/GLTF/Houses/house_002.glb","assets/3d/GLTF/Houses/house_003.glb","assets/3d/GLTF/Houses/house_004.glb","assets/3d/GLTF/Houses/house_005.glb","assets/3d/GLTF/Houses/house_006.glb","assets/3d/GLTF/Houses/suburb_house__001.glb"],
  firestationSource: "assets/3d/GLTF/Firestation/Classic Fire Station.glb"
};
