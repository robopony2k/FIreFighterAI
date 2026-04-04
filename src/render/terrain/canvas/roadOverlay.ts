import * as THREE from "three";
import { TILE_COLOR_RGB } from "../../../core/config.js";
import { getRoadAtlas } from "./roadAtlas.js";
import {
  ROAD_EDGE_CARDINAL_MASK,
  ROAD_EDGE_DIAGONAL_MASK,
  ROAD_EDGE_DIRS,
  ROAD_EDGE_E,
  ROAD_EDGE_N,
  ROAD_EDGE_NE,
  ROAD_EDGE_NW,
  ROAD_EDGE_S,
  ROAD_EDGE_SE,
  ROAD_EDGE_SW,
  ROAD_EDGE_W
} from "../shared/roadTopology.js";

const ROAD_TEX_MAX_SIZE = 4096;

let roadOverlayMaxSize = ROAD_TEX_MAX_SIZE;

export type RoadOverlaySample = {
  cols: number;
  rows: number;
  tileTypes?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadEdges?: Uint8Array;
};

export const setRoadOverlayMaxSize = (size: number): void => {
  const safe = Math.max(256, Math.floor(size));
  roadOverlayMaxSize = safe;
};

export const buildRoadOverlayTexture = (
  sample: RoadOverlaySample,
  roadId: number,
  baseId: number,
  roadWidth: number,
  scale: number
): THREE.Texture | null => {
  const tileTypes = sample.tileTypes;
  const roadBridgeMask = sample.roadBridgeMask;
  const roadEdges = sample.roadEdges;
  if (!tileTypes) {
    return null;
  }
  const { cols, rows } = sample;
  const total = cols * rows;
  const hasRoadEdges = !!roadEdges && roadEdges.length === total;
  const getIndex = (x: number, y: number): number => y * cols + x;
  const isRoadLike = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = getIndex(x, y);
    const type = tileTypes[idx];
    return type === roadId || type === baseId || (roadBridgeMask ? roadBridgeMask[idx] > 0 : false);
  };
  const isBridge = (x: number, y: number): boolean => {
    if (!roadBridgeMask || x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    return roadBridgeMask[getIndex(x, y)] > 0;
  };
  const getRoadMask = (x: number, y: number): number => {
    if (!isRoadLike(x, y)) {
      return 0;
    }
    if (hasRoadEdges && roadEdges) {
      const idx = getIndex(x, y);
      let mask = roadEdges[idx] ?? 0;
      let sanitized = 0;
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!isRoadLike(nx, ny)) {
          continue;
        }
        sanitized |= dir.bit;
      }
      if (sanitized !== 0) {
        return sanitized;
      }
    }
    let mask = 0;
    if (isRoadLike(x, y - 1)) {
      mask |= ROAD_EDGE_N;
    }
    if (isRoadLike(x + 1, y)) {
      mask |= ROAD_EDGE_E;
    }
    if (isRoadLike(x, y + 1)) {
      mask |= ROAD_EDGE_S;
    }
    if (isRoadLike(x - 1, y)) {
      mask |= ROAD_EDGE_W;
    }
    if (isRoadLike(x + 1, y - 1)) {
      mask |= ROAD_EDGE_NE;
    }
    if (isRoadLike(x - 1, y - 1)) {
      mask |= ROAD_EDGE_NW;
    }
    if (isRoadLike(x + 1, y + 1)) {
      mask |= ROAD_EDGE_SE;
    }
    if (isRoadLike(x - 1, y + 1)) {
      mask |= ROAD_EDGE_SW;
    }
    return mask;
  };

  const popCount4 = (mask: number, bits: number[]): number =>
    Number((mask & bits[0]) > 0) +
    Number((mask & bits[1]) > 0) +
    Number((mask & bits[2]) > 0) +
    Number((mask & bits[3]) > 0);

  const cardinalRotation = (bit: number): number => {
    if (bit === ROAD_EDGE_N) {
      return 0;
    }
    if (bit === ROAD_EDGE_E) {
      return Math.PI / 2;
    }
    if (bit === ROAD_EDGE_S) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };

  const diagonalRotation = (bit: number): number => {
    if (bit === ROAD_EDGE_NE) {
      return 0;
    }
    if (bit === ROAD_EDGE_SE) {
      return Math.PI / 2;
    }
    if (bit === ROAD_EDGE_SW) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const cornerRotationFromNe = (corner: "NE" | "SE" | "SW" | "NW"): number => {
    if (corner === "NE") {
      return 0;
    }
    if (corner === "SE") {
      return Math.PI / 2;
    }
    if (corner === "SW") {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const firstSetBit = (mask: number, bits: number[]): number => {
    for (let i = 0; i < bits.length; i += 1) {
      if ((mask & bits[i]) > 0) {
        return bits[i];
      }
    }
    return 0;
  };
  const longCornerWToNeRotation = (orthBit: number, diagBit: number): number | null => {
    if (orthBit === ROAD_EDGE_W && diagBit === ROAD_EDGE_NE) {
      return 0;
    }
    if (orthBit === ROAD_EDGE_N && diagBit === ROAD_EDGE_SE) {
      return Math.PI / 2;
    }
    if (orthBit === ROAD_EDGE_E && diagBit === ROAD_EDGE_SW) {
      return Math.PI;
    }
    if (orthBit === ROAD_EDGE_S && diagBit === ROAD_EDGE_NW) {
      return -Math.PI / 2;
    }
    return null;
  };
  const longCornerWToSeRotation = (orthBit: number, diagBit: number): number | null => {
    if (orthBit === ROAD_EDGE_W && diagBit === ROAD_EDGE_SE) {
      return 0;
    }
    if (orthBit === ROAD_EDGE_N && diagBit === ROAD_EDGE_SW) {
      return Math.PI / 2;
    }
    if (orthBit === ROAD_EDGE_E && diagBit === ROAD_EDGE_NW) {
      return Math.PI;
    }
    if (orthBit === ROAD_EDGE_S && diagBit === ROAD_EDGE_NE) {
      return -Math.PI / 2;
    }
    return null;
  };
  const teeRotation = (missingBit: number): number => {
    if (missingBit === ROAD_EDGE_W) {
      return 0;
    }
    if (missingBit === ROAD_EDGE_N) {
      return Math.PI / 2;
    }
    if (missingBit === ROAD_EDGE_E) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const cornerRotation = (orthMask: number): number => {
    if ((orthMask & (ROAD_EDGE_N | ROAD_EDGE_E)) === (ROAD_EDGE_N | ROAD_EDGE_E)) {
      return 0;
    }
    if ((orthMask & (ROAD_EDGE_E | ROAD_EDGE_S)) === (ROAD_EDGE_E | ROAD_EDGE_S)) {
      return Math.PI / 2;
    }
    if ((orthMask & (ROAD_EDGE_S | ROAD_EDGE_W)) === (ROAD_EDGE_S | ROAD_EDGE_W)) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };

  const atlas = getRoadAtlas();
  const maxTileSpan = Math.max(1, Math.max(cols, rows));
  const maxSize = roadOverlayMaxSize || ROAD_TEX_MAX_SIZE;
  const baseScale = Math.round(scale);
  const tileSize = atlas
    ? Math.max(1, Math.min(atlas.tileSize, Math.floor(maxSize / maxTileSpan)))
    : Math.max(1, Math.min(baseScale, Math.floor(maxSize / maxTileSpan)));

  if (atlas && tileSize > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cols * tileSize);
    canvas.height = Math.max(1, rows * tileSize);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    const atlasTileSize = atlas.tileSize;
    const resolveTile = (...ids: string[]): { col: number; row: number } | null => {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const tile = atlas.tiles[id];
        if (tile) {
          return tile;
        }
      }
      return null;
    };
    const drawAtlasTile = (
      tileIds: string[],
      tileX: number,
      tileY: number,
      rotation = 0,
      scaleFactor = 1,
      align: "center" | "NW" | "NE" | "SE" | "SW" = "center"
    ) => {
      const tile = resolveTile(...tileIds);
      if (!tile) {
        return;
      }
      if (tile.col >= atlas.cols || tile.row >= atlas.rows) {
        return;
      }
      const srcX = tile.col * atlas.tileStride;
      const srcY = tile.row * atlas.tileStride;
      if (srcX + atlasTileSize > atlas.canvas.width || srcY + atlasTileSize > atlas.canvas.height) {
        return;
      }
      const dstSize = tileSize * scaleFactor;
      let dx = tileX * tileSize;
      let dy = tileY * tileSize;
      if (align === "center") {
        dx += (tileSize - dstSize) / 2;
        dy += (tileSize - dstSize) / 2;
      } else {
        if (align.includes("N")) {
          dy += 0;
        }
        if (align.includes("S")) {
          dy += tileSize - dstSize;
        }
        if (align.includes("W")) {
          dx += 0;
        }
        if (align.includes("E")) {
          dx += tileSize - dstSize;
        }
      }
      ctx.save();
      ctx.translate(dx + dstSize / 2, dy + dstSize / 2);
      ctx.rotate(rotation);
      ctx.drawImage(
        atlas.canvas,
        srcX,
        srcY,
        atlasTileSize,
        atlasTileSize,
        -dstSize / 2,
        -dstSize / 2,
        dstSize,
        dstSize
      );
      ctx.restore();
    };
    const drawInfillAt = (targetX: number, targetY: number, corner: "NE" | "SE" | "SW" | "NW"): void => {
      if (targetX < 0 || targetY < 0 || targetX >= cols || targetY >= rows) {
        return;
      }
      if (isRoadLike(targetX, targetY)) {
        return;
      }
      drawAtlasTile(["diag_infill_ne"], targetX, targetY, cornerRotationFromNe(corner));
    };

    for (let tileY = 0; tileY < rows; tileY += 1) {
      for (let tileX = 0; tileX < cols; tileX += 1) {
        if (!isRoadLike(tileX, tileY)) {
          continue;
        }
        const mask = getRoadMask(tileX, tileY);
        const orthMask = mask & ROAD_EDGE_CARDINAL_MASK;
        const diagMask = mask & ROAD_EDGE_DIAGONAL_MASK;
        const orthCount = popCount4(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
        const diagCount = popCount4(diagMask, [ROAD_EDGE_NE, ROAD_EDGE_NW, ROAD_EDGE_SE, ROAD_EDGE_SW]);

        const isStraightOrth =
          orthCount === 2 &&
          (((orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S)) ||
            ((orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W)));
        const isCornerOrth = orthCount === 2 && !isStraightOrth;

        if (orthCount >= 4) {
          drawAtlasTile(["base_cross"], tileX, tileY);
        } else if (orthCount === 3) {
          const missing =
            (orthMask & ROAD_EDGE_N) === 0 ? ROAD_EDGE_N :
            (orthMask & ROAD_EDGE_E) === 0 ? ROAD_EDGE_E :
            (orthMask & ROAD_EDGE_S) === 0 ? ROAD_EDGE_S : ROAD_EDGE_W;
          drawAtlasTile(["base_tee"], tileX, tileY, teeRotation(missing));
        } else if (isCornerOrth) {
          drawAtlasTile(["base_corner_ne", "base_corner", "corner_ne"], tileX, tileY, cornerRotation(orthMask));
        } else if (orthCount === 0 && diagCount === 0) {
          drawAtlasTile(["base_isolated"], tileX, tileY);
        } else {
          if ((orthMask & ROAD_EDGE_N) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_N));
          }
          if ((orthMask & ROAD_EDGE_E) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_E));
          }
          if ((orthMask & ROAD_EDGE_S) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_S));
          }
          if ((orthMask & ROAD_EDGE_W) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_W));
          }
        }

        if ((diagMask & ROAD_EDGE_NE) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_NE));
        }
        if ((diagMask & ROAD_EDGE_NW) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_NW));
        }
        if ((diagMask & ROAD_EDGE_SE) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_SE));
        }
        if ((diagMask & ROAD_EDGE_SW) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_SW));
        }

        if (orthCount === 1 && diagCount === 1) {
          const orthBit = firstSetBit(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
          const diagBit = firstSetBit(diagMask, [ROAD_EDGE_NE, ROAD_EDGE_NW, ROAD_EDGE_SE, ROAD_EDGE_SW]);
          const longRotationNe = longCornerWToNeRotation(orthBit, diagBit);
          const longRotationSe = longCornerWToSeRotation(orthBit, diagBit);
          if (longRotationNe !== null) {
            drawAtlasTile(["mix_diag_to_straight_w_ne"], tileX, tileY, longRotationNe);
          } else if (longRotationSe !== null) {
            drawAtlasTile(["mix_diag_to_straight_w_se"], tileX, tileY, longRotationSe);
          } else {
            drawAtlasTile(["mix_cardinal_diag_adjacent"], tileX, tileY, cardinalRotation(orthBit));
          }
        } else if (orthCount === 1 && diagCount > 1) {
          const orthBit = firstSetBit(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
          drawAtlasTile(["mix_cardinal_diag_adjacent"], tileX, tileY, cardinalRotation(orthBit));
        } else if (orthCount === 2 && diagCount === 1) {
          const isNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
          const isEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
          if (isNS) {
            drawAtlasTile(["mix_straight_diag_single_ns"], tileX, tileY);
          } else if (isEW) {
            drawAtlasTile(["mix_straight_diag_single_ew"], tileX, tileY);
          } else {
            drawAtlasTile(["mix_corner_diag_outer"], tileX, tileY, cornerRotation(orthMask));
          }
        } else if (orthCount === 2 && diagCount >= 2) {
          const isNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
          const isEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
          if (isNS) {
            drawAtlasTile(["mix_straight_diag_pair_ns"], tileX, tileY);
          } else if (isEW) {
            drawAtlasTile(["mix_straight_diag_pair_ew"], tileX, tileY);
          } else {
            drawAtlasTile(["mix_corner_diag_outer"], tileX, tileY, cornerRotation(orthMask));
          }
        } else if (orthCount === 3 && diagCount >= 1) {
          const missing =
            (orthMask & ROAD_EDGE_N) === 0 ? ROAD_EDGE_N :
            (orthMask & ROAD_EDGE_E) === 0 ? ROAD_EDGE_E :
            (orthMask & ROAD_EDGE_S) === 0 ? ROAD_EDGE_S : ROAD_EDGE_W;
          drawAtlasTile(["mix_tee_diag"], tileX, tileY, cardinalRotation(missing));
        } else if ((orthCount >= 3 && diagCount >= 2) || (orthCount >= 2 && diagCount >= 3)) {
          drawAtlasTile(["mix_hub_dense"], tileX, tileY);
        }

        const useNE =
          (diagMask & ROAD_EDGE_NE) > 0 && !((orthMask & ROAD_EDGE_N) > 0 && (orthMask & ROAD_EDGE_E) > 0);
        const useNW =
          (diagMask & ROAD_EDGE_NW) > 0 && !((orthMask & ROAD_EDGE_N) > 0 && (orthMask & ROAD_EDGE_W) > 0);
        const useSE =
          (diagMask & ROAD_EDGE_SE) > 0 && !((orthMask & ROAD_EDGE_S) > 0 && (orthMask & ROAD_EDGE_E) > 0);
        const useSW =
          (diagMask & ROAD_EDGE_SW) > 0 && !((orthMask & ROAD_EDGE_S) > 0 && (orthMask & ROAD_EDGE_W) > 0);

        if (useNE) {
          drawInfillAt(tileX + 1, tileY, "NW");
          drawInfillAt(tileX, tileY - 1, "SE");
        }
        if (useNW) {
          drawInfillAt(tileX - 1, tileY, "NE");
          drawInfillAt(tileX, tileY - 1, "SW");
        }
        if (useSE) {
          drawInfillAt(tileX + 1, tileY, "SW");
          drawInfillAt(tileX, tileY + 1, "NE");
        }
        if (useSW) {
          drawInfillAt(tileX - 1, tileY, "SE");
          drawInfillAt(tileX, tileY + 1, "NW");
        }

        if (roadBridgeMask && !isBridge(tileX, tileY)) {
          for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
            const dir = ROAD_EDGE_DIRS[i];
            if ((mask & dir.bit) === 0) {
              continue;
            }
            const nx = tileX + dir.dx;
            const ny = tileY + dir.dy;
            if (!isBridge(nx, ny)) {
              continue;
            }
            drawAtlasTile(
              [dir.diagonal ? "bridge_abutment_diagonal" : "bridge_abutment_cardinal"],
              tileX,
              tileY,
              dir.diagonal ? diagonalRotation(dir.bit) : cardinalRotation(dir.bit)
            );
          }
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = true;
    texture.generateMipmaps = false;
    texture.anisotropy = 4;
    return texture;
  }
  const texCols = Math.max(1, cols * tileSize);
  const texRows = Math.max(1, rows * tileSize);
  const data = new Uint8Array(texCols * texRows * 4);
  const roadColor = TILE_COLOR_RGB.road;
  const roadPixels = Math.max(1, Math.round(roadWidth * tileSize));
  const bandStart = Math.floor((tileSize - roadPixels) / 2);
  const bandEnd = Math.min(tileSize - 1, bandStart + roadPixels - 1);
  const halfPixels = Math.max(0.5, roadPixels / 2);
  const center = (tileSize - 1) / 2;
  const snipSize = Math.max(1, Math.round(roadPixels * 0.5));
  const setPixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= texCols || y >= texRows) {
      return;
    }
    const idx = (y * texCols + x) * 4;
    data[idx] = roadColor.r;
    data[idx + 1] = roadColor.g;
    data[idx + 2] = roadColor.b;
    data[idx + 3] = 255;
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(texCols - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(texRows - 1, Math.max(y0, y1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        setPixel(x, y);
      }
    }
  };
  const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - halfPixels - 1));
    const maxX = Math.min(texCols - 1, Math.ceil(Math.max(x0, x1) + halfPixels + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - halfPixels - 1));
    const maxY = Math.min(texRows - 1, Math.ceil(Math.max(y0, y1) + halfPixels + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
        const sx = x0 + dx * t;
        const sy = y0 + dy * t;
        const distSq = (px - sx) * (px - sx) + (py - sy) * (py - sy);
        if (distSq <= halfPixels * halfPixels) {
          setPixel(x, y);
        }
      }
    }
  };
  const tileOffsetX = (tileX: number) => tileX * tileSize;
  const tileOffsetY = (tileY: number) => tileY * tileSize;
  const stampRect = (tileX: number, tileY: number, x0: number, y0: number, x1: number, y1: number) => {
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    fillRect(ox + x0, oy + y0, ox + x1, oy + y1);
  };
  const stampCorner = (tileX: number, tileY: number, corner: "NW" | "NE" | "SE" | "SW") => {
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) {
      return;
    }
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    const x0 = corner.includes("E") ? tileSize - snipSize : 0;
    const y0 = corner.includes("S") ? tileSize - snipSize : 0;
    fillRect(ox + x0, oy + y0, ox + x0 + snipSize - 1, oy + y0 + snipSize - 1);
  };
  const drawDiagonal = (tileX: number, tileY: number, corner: "NE" | "NW" | "SE" | "SW") => {
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    const cx = ox + center;
    const cy = oy + center;
    const ex = ox + (corner.includes("E") ? tileSize - 1 : 0);
    const ey = oy + (corner.includes("S") ? tileSize - 1 : 0);
    drawLine(cx, cy, ex, ey);
    stampCorner(tileX, tileY, corner);
  };

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < cols; tileX += 1) {
      if (!isRoadLike(tileX, tileY)) {
        continue;
      }
      const mask = getRoadMask(tileX, tileY);
      const n = (mask & ROAD_EDGE_N) > 0;
      const s = (mask & ROAD_EDGE_S) > 0;
      const w = (mask & ROAD_EDGE_W) > 0;
      const e = (mask & ROAD_EDGE_E) > 0;
      const ne = (mask & ROAD_EDGE_NE) > 0;
      const nw = (mask & ROAD_EDGE_NW) > 0;
      const se = (mask & ROAD_EDGE_SE) > 0;
      const sw = (mask & ROAD_EDGE_SW) > 0;

      if (n) {
        stampRect(tileX, tileY, bandStart, 0, bandEnd, bandEnd);
      }
      if (s) {
        stampRect(tileX, tileY, bandStart, bandStart, bandEnd, tileSize - 1);
      }
      if (w) {
        stampRect(tileX, tileY, 0, bandStart, bandEnd, bandEnd);
      }
      if (e) {
        stampRect(tileX, tileY, bandStart, bandStart, tileSize - 1, bandEnd);
      }

      const useNE = ne && !(n && e);
      const useNW = nw && !(n && w);
      const useSE = se && !(s && e);
      const useSW = sw && !(s && w);

      if (useNE) {
        drawDiagonal(tileX, tileY, "NE");
        if (!e) {
          stampCorner(tileX + 1, tileY, "NW");
        }
        if (!n) {
          stampCorner(tileX, tileY - 1, "SE");
        }
      }
      if (useNW) {
        drawDiagonal(tileX, tileY, "NW");
        if (!w) {
          stampCorner(tileX - 1, tileY, "NE");
        }
        if (!n) {
          stampCorner(tileX, tileY - 1, "SW");
        }
      }
      if (useSE) {
        drawDiagonal(tileX, tileY, "SE");
        if (!e) {
          stampCorner(tileX + 1, tileY, "SW");
        }
        if (!s) {
          stampCorner(tileX, tileY + 1, "NE");
        }
      }
      if (useSW) {
        drawDiagonal(tileX, tileY, "SW");
        if (!w) {
          stampCorner(tileX - 1, tileY, "SE");
        }
        if (!s) {
          stampCorner(tileX, tileY + 1, "NW");
        }
      }

      const hasAny =
        n || s || w || e || useNE || useNW || useSE || useSW;
      if (!hasAny) {
        stampRect(tileX, tileY, bandStart, bandStart, bandEnd, bandEnd);
      }
    }
  }

  const flipped = new Uint8Array(data.length);
  const rowStride = texCols * 4;
  for (let y = 0; y < texRows; y += 1) {
    const src = y * rowStride;
    const dst = (texRows - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, texCols, texRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  return texture;
};
