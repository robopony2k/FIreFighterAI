import * as THREE from "three";
import { TILE_SIZE } from "../../../core/config.js";
import type { Town } from "../../../core/types.js";

const TOWN_LABEL_SCREEN_HEIGHT = 0.025;
const TOWN_LABEL_LIFT_METERS = 100;
const ENABLE_TOWN_LABEL_SPRITES = false;

const townLabelMaterialCache = new Map<string, { material: THREE.SpriteMaterial; aspect: number }>();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const createFallbackTownLabelMaterial = (): { material: THREE.SpriteMaterial; aspect: number } => {
  const fallbackMaterial = new THREE.SpriteMaterial({
    color: 0xf3dfb8,
    transparent: true,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false
  });
  fallbackMaterial.toneMapped = false;
  return { material: fallbackMaterial, aspect: 1.8 };
};

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

const getTownLabelMaterial = (name: string): { material: THREE.SpriteMaterial; aspect: number } => {
  const normalizedName = name.trim();
  const cached = townLabelMaterialCache.get(normalizedName);
  if (cached) {
    return cached;
  }
  if (typeof document === "undefined") {
    const fallback = createFallbackTownLabelMaterial();
    townLabelMaterialCache.set(normalizedName, fallback);
    return fallback;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const fallback = createFallbackTownLabelMaterial();
    townLabelMaterialCache.set(normalizedName, fallback);
    return fallback;
  }
  const fontPx = 52;
  const paddingX = 54;
  const paddingY = 24;
  const strokeWidth = 4;
  const pixelRatio = 2;
  const font = `700 ${fontPx}px "Trebuchet MS", "Segoe UI", sans-serif`;
  context.font = font;
  const measuredWidth = Math.ceil(context.measureText(normalizedName).width);
  const layoutWidth = Math.max(280, measuredWidth + paddingX * 2);
  const layoutHeight = fontPx + paddingY * 2;
  canvas.width = layoutWidth * pixelRatio;
  canvas.height = layoutHeight * pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, layoutWidth, layoutHeight);
  drawRoundedRect(context, strokeWidth * 0.5, strokeWidth * 0.5, layoutWidth - strokeWidth, layoutHeight - strokeWidth, 18);
  context.fillStyle = "rgba(33, 25, 18, 0.78)";
  context.fill();
  context.strokeStyle = "rgba(255, 231, 176, 0.95)";
  context.lineWidth = strokeWidth;
  context.stroke();
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff3d5";
  context.fillText(normalizedName, layoutWidth * 0.5, layoutHeight * 0.53);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false
  });
  material.toneMapped = false;
  const created = { material, aspect: layoutWidth / layoutHeight };
  townLabelMaterialCache.set(normalizedName, created);
  return created;
};

const createTownLabelSprite = (
  town: Town,
  width: number,
  depth: number,
  cols: number,
  rows: number,
  heightScale: number,
  heightAtTile: (tileX: number, tileY: number) => number
): THREE.Sprite | null => {
  const tileX = clamp(Math.floor(town.x), 0, cols - 1);
  const tileY = clamp(Math.floor(town.y), 0, rows - 1);
  const worldX = ((tileX + 0.5) / Math.max(1, cols) - 0.5) * width;
  const worldZ = ((tileY + 0.5) / Math.max(1, rows) - 0.5) * depth;
  const groundY = heightAtTile(tileX, tileY) * heightScale;
  const labelLift = TOWN_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
  const { material, aspect } = getTownLabelMaterial(town.name);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(TOWN_LABEL_SCREEN_HEIGHT * aspect, TOWN_LABEL_SCREEN_HEIGHT, 1);
  sprite.position.set(worldX, groundY + labelLift, worldZ);
  sprite.renderOrder = 25;
  return sprite;
};

export type TownLabelGroupOptions = {
  towns?: Town[];
  width: number;
  depth: number;
  cols: number;
  rows: number;
  heightScale: number;
  heightAtTile: (tileX: number, tileY: number) => number;
};

export const buildTownLabelGroup = (options: TownLabelGroupOptions): THREE.Group | null => {
  if (!ENABLE_TOWN_LABEL_SPRITES || !options.towns || options.towns.length === 0) {
    return null;
  }
  const group = new THREE.Group();
  options.towns.forEach((town) => {
    if (typeof town.name !== "string" || town.name.trim().length === 0) {
      return;
    }
    if (!Number.isFinite(town.x) || !Number.isFinite(town.y)) {
      return;
    }
    const sprite = createTownLabelSprite(
      town,
      options.width,
      options.depth,
      options.cols,
      options.rows,
      options.heightScale,
      options.heightAtTile
    );
    if (!sprite) {
      return;
    }
    group.add(sprite);
  });
  return group.children.length > 0 ? group : null;
};
