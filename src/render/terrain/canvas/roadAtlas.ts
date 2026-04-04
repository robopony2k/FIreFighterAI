import * as THREE from "three";
import { TILE_COLOR_RGB } from "../../../core/config.js";

const ROAD_ATLAS_V2_METADATA_PATH = "assets/textures/road_atlas_v2.json";
const ROAD_ATLAS_FALLBACK_IMAGE_PATH = "assets/textures/ROAD_TILES.png";
const ROAD_ATLAS_FALLBACK_TILE_SIZE = 64;

export type RoadAtlas = {
  canvas: HTMLCanvasElement;
  tileSize: number;
  tileStride: number;
  cols: number;
  rows: number;
  version: number;
  tiles: Record<string, { col: number; row: number }>;
};

export type RoadAtlasMetadata = {
  version: number;
  image: string;
  tileSize: number;
  tileStride: number;
  tiles: Record<string, { col: number; row: number }>;
};

const ROAD_ATLAS_FALLBACK_METADATA: RoadAtlasMetadata = {
  version: 2,
  image: ROAD_ATLAS_FALLBACK_IMAGE_PATH,
  tileSize: ROAD_ATLAS_FALLBACK_TILE_SIZE,
  tileStride: ROAD_ATLAS_FALLBACK_TILE_SIZE,
  tiles: {
    base_isolated: { col: 0, row: 0 },
    base_endcap_cardinal: { col: 1, row: 0 },
    base_endcap_diagonal: { col: 0, row: 1 },
    base_corner_ne: { col: 0, row: 2 },
    base_straight: { col: 1, row: 0 },
    base_corner: { col: 0, row: 2 },
    base_tee: { col: 3, row: 0 },
    base_cross: { col: 2, row: 0 },
    diag_pair_nesw: { col: 0, row: 1 },
    diag_pair_nwse: { col: 1, row: 1 },
    mix_cardinal_diag_adjacent: { col: 2, row: 2 },
    mix_straight_diag_single_ns: { col: 2, row: 2 },
    mix_straight_diag_single_ew: { col: 2, row: 3 },
    mix_straight_diag_pair_ns: { col: 1, row: 1 },
    mix_straight_diag_pair_ew: { col: 0, row: 1 },
    mix_corner_diag_outer: { col: 4, row: 3 },
    mix_tee_diag: { col: 3, row: 0 },
    mix_hub_dense: { col: 2, row: 0 },
    mix_diag_to_straight_w_ne: { col: 2, row: 2 },
    mix_diag_to_straight_w_se: { col: 2, row: 2 },
    diag_infill_ne: { col: 5, row: 1 },
    bridge_abutment_cardinal: { col: 4, row: 1 },
    bridge_abutment_diagonal: { col: 5, row: 1 },
    straight_ew: { col: 0, row: 0 },
    straight_ns: { col: 1, row: 0 },
    corner_es: { col: 4, row: 0 },
    corner_sw: { col: 5, row: 0 },
    corner_ne: { col: 0, row: 2 },
    corner_nw: { col: 1, row: 2 },
    tee_missing_n: { col: 3, row: 0 },
    cross: { col: 2, row: 0 }
  }
};

let roadAtlasCache: RoadAtlas | null = null;
let roadAtlasLoading = false;
let roadAtlasVersion = 0;
let bridgeStraightOverlayCache: { atlasVersion: number; texture: THREE.Texture } | null = null;

export const getRoadAtlasVersion = (): number => roadAtlasVersion;

const toRoadAtlasMetadata = (raw: unknown): RoadAtlasMetadata | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as {
    version?: unknown;
    image?: unknown;
    tileSize?: unknown;
    tileStride?: unknown;
    tiles?: unknown;
  };
  const image = typeof candidate.image === "string" && candidate.image.length > 0
    ? candidate.image
    : ROAD_ATLAS_FALLBACK_METADATA.image;
  const tileSize = Number(candidate.tileSize);
  const safeTileSize = Number.isFinite(tileSize) && tileSize > 0
    ? Math.round(tileSize)
    : ROAD_ATLAS_FALLBACK_METADATA.tileSize;
  const tileStrideRaw = Number(candidate.tileStride);
  const safeTileStride =
    Number.isFinite(tileStrideRaw) && tileStrideRaw > 0 ? Math.round(tileStrideRaw) : safeTileSize;
  const versionRaw = Number(candidate.version);
  const version = Number.isFinite(versionRaw) ? Math.max(1, Math.round(versionRaw)) : 2;
  const tilesRaw = candidate.tiles;
  if (!tilesRaw || typeof tilesRaw !== "object") {
    return null;
  }
  const tiles: Record<string, { col: number; row: number }> = {};
  for (const [key, value] of Object.entries(tilesRaw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as { col?: unknown; row?: unknown };
    const col = Number(entry.col);
    const row = Number(entry.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      continue;
    }
    tiles[key] = {
      col: Math.max(0, Math.floor(col)),
      row: Math.max(0, Math.floor(row))
    };
  }
  if (Object.keys(tiles).length === 0) {
    return null;
  }
  return {
    version,
    image,
    tileSize: safeTileSize,
    tileStride: safeTileStride,
    tiles
  };
};

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });

const ensureRoadAtlas = (): void => {
  if (roadAtlasCache || roadAtlasLoading) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  roadAtlasLoading = true;
  void (async () => {
    let metadata = ROAD_ATLAS_FALLBACK_METADATA;
    if (typeof fetch === "function") {
      try {
        const response = await fetch(ROAD_ATLAS_V2_METADATA_PATH, { cache: "no-store" });
        if (response.ok) {
          const json = await response.json();
          const parsed = toRoadAtlasMetadata(json);
          if (parsed) {
            metadata = parsed;
          }
        }
      } catch {
        // Atlas metadata is optional; fallback metadata keeps rendering alive.
      }
    }

    try {
      const image = await loadImageElement(metadata.image);
      const width = Math.max(1, image.width);
      const height = Math.max(1, image.height);
      const tileSize = Math.max(1, Math.floor(metadata.tileSize));
      const tileStride = Math.max(tileSize, Math.floor(metadata.tileStride));
      const cols = Math.max(1, Math.floor(width / tileStride));
      const rows = Math.max(1, Math.floor(height / tileStride));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.drawImage(image, 0, 0);
      roadAtlasCache = {
        canvas,
        tileSize,
        tileStride,
        cols,
        rows,
        version: metadata.version,
        tiles: metadata.tiles
      };
      roadAtlasVersion += 1;
    } catch {
      // If atlas loading fails we'll continue with procedural fallback.
    } finally {
      roadAtlasLoading = false;
    }
  })();
};

const finalizeBridgeStraightOverlayTexture = (canvas: HTMLCanvasElement): THREE.Texture => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = true;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  return texture;
};

const buildProceduralBridgeStraightOverlayTexture = (): THREE.Texture | null => {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const roadColor = TILE_COLOR_RGB.road;
  ctx.fillStyle = `rgb(${roadColor.r}, ${roadColor.g}, ${roadColor.b})`;
  ctx.fillRect(24, 0, 80, canvas.height);

  ctx.strokeStyle = "#d6b341";
  ctx.lineWidth = 10;
  ctx.setLineDash([18, 16]);
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.5, 0);
  ctx.lineTo(canvas.width * 0.5, canvas.height);
  ctx.stroke();

  return finalizeBridgeStraightOverlayTexture(canvas);
};

const buildBridgeStraightOverlayTextureFromAtlas = (atlas: RoadAtlas): THREE.Texture | null => {
  if (typeof document === "undefined") {
    return null;
  }
  const tileCandidate =
    (atlas.tiles.straight_ns ? { tile: atlas.tiles.straight_ns, rotation: 0 } : null) ??
    (atlas.tiles.base_straight ? { tile: atlas.tiles.base_straight, rotation: 0 } : null) ??
    (atlas.tiles.straight_ew ? { tile: atlas.tiles.straight_ew, rotation: Math.PI / 2 } : null) ??
    (atlas.tiles.base_endcap_cardinal ? { tile: atlas.tiles.base_endcap_cardinal, rotation: 0 } : null);
  if (!tileCandidate || tileCandidate.tile.col >= atlas.cols || tileCandidate.tile.row >= atlas.rows) {
    return null;
  }
  const srcX = tileCandidate.tile.col * atlas.tileStride;
  const srcY = tileCandidate.tile.row * atlas.tileStride;
  if (srcX + atlas.tileSize > atlas.canvas.width || srcY + atlas.tileSize > atlas.canvas.height) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = atlas.tileSize;
  canvas.height = atlas.tileSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
  ctx.rotate(tileCandidate.rotation);
  ctx.drawImage(
    atlas.canvas,
    srcX,
    srcY,
    atlas.tileSize,
    atlas.tileSize,
    -canvas.width * 0.5,
    -canvas.height * 0.5,
    canvas.width,
    canvas.height
  );
  ctx.restore();
  return finalizeBridgeStraightOverlayTexture(canvas);
};

export const getRoadAtlas = (): RoadAtlas | null => {
  ensureRoadAtlas();
  return roadAtlasCache;
};

export const getBridgeStraightOverlayTexture = (): THREE.Texture | null => {
  const atlas = getRoadAtlas();
  const atlasVersion = getRoadAtlasVersion();
  if (bridgeStraightOverlayCache && bridgeStraightOverlayCache.atlasVersion === atlasVersion) {
    return bridgeStraightOverlayCache.texture;
  }

  const texture = atlas
    ? buildBridgeStraightOverlayTextureFromAtlas(atlas) ?? buildProceduralBridgeStraightOverlayTexture()
    : buildProceduralBridgeStraightOverlayTexture();
  if (!texture) {
    return null;
  }
  bridgeStraightOverlayCache?.texture.dispose();
  bridgeStraightOverlayCache = { atlasVersion, texture };
  return texture;
};
