import * as THREE from "three";
import type { RenderSim } from "./simView.js";
import { createParticleBuffers, createSmokeShaderMaterial } from "./particles.js";
import type { TerrainSample, TreeBurnController, TreeFlameProfile } from "./threeTestTerrain.js";
import { getTerrainHeightScale } from "./threeTestTerrain.js";

const FIRE_MAX_INSTANCES = 720;
const SMOKE_MAX_INSTANCES = 1400;
const EMBER_MAX_INSTANCES = 520;
const GLOW_MAX_INSTANCES = FIRE_MAX_INSTANCES;
const FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS = 16;
const FIRE_FX_IDLE_UPDATE_INTERVAL_MS = 120;
const FIRE_MIN_INTENSITY = 0.01;
const FIRE_MIN_HEAT = 0.12;
const TREE_BURN_FLAME_VISUAL_MIN = 0.08;
const TREE_BURN_CARRY_PROGRESS_MIN = 0.08;
const FLAME_CELL_LATERAL_LIMIT = 0.45;
const FLAME_WIND_GAIN = 1.7;
const SMOKE_LAYER_MAX = 3;
const TAU = Math.PI * 2;
const FIRE_VISUAL_TUNING = {
  tongueSpawnMin: 0,
  tongueSpawnMax: 6,
  groundFlameSpawnMin: 1,
  groundFlameSpawnMax: 10,
  clusterStrength: 0.58,
  sparkRate: 1.2,
  sparkMax: EMBER_MAX_INSTANCES,
  glowRadius: 0.9,
  glowStrength: 0.92,
  sizeVariationMin: 0.75,
  sizeVariationMax: 1.35,
  leanVariationMin: 0.02,
  leanVariationMax: 0.2,
  flickerRateMin: 0.55,
  flickerRateMax: 2.6
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const fract = (value: number): number => value - Math.floor(value);
const hash1 = (value: number): number => fract(Math.sin(value * 12.9898) * 43758.5453);
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const smoothApproach = (current: number, target: number, riseRate: number, fallRate: number, dtSeconds: number): number => {
  const rate = target >= current ? riseRate : fallRate;
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
  return current + (target - current) * k;
};
const swapDepthOrder = (depth: Float32Array, order: Uint16Array, a: number, b: number): void => {
  const d = depth[a];
  depth[a] = depth[b];
  depth[b] = d;
  const o = order[a];
  order[a] = order[b];
  order[b] = o;
};
const sortDepthBackToFront = (depth: Float32Array, order: Uint16Array, left: number, right: number): void => {
  let i = left;
  let j = right;
  const pivot = depth[(left + right) >> 1];
  while (i <= j) {
    while (depth[i] > pivot) {
      i += 1;
    }
    while (depth[j] < pivot) {
      j -= 1;
    }
    if (i <= j) {
      swapDepthOrder(depth, order, i, j);
      i += 1;
      j -= 1;
    }
  }
  if (left < j) {
    sortDepthBackToFront(depth, order, left, j);
  }
  if (i < right) {
    sortDepthBackToFront(depth, order, i, right);
  }
};
const sortSmokeParticlesByDepth = (depth: Float32Array, order: Uint16Array, count: number): void => {
  if (count > 1) {
    sortDepthBackToFront(depth, order, 0, count - 1);
  }
};
const getNeighbourFireBias = (world: RenderSim, cols: number, rows: number, x: number, y: number): number => {
  let sum = 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    const ny = y + oy;
    if (ny < 0 || ny >= rows) {
      continue;
    }
    const row = ny * cols;
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      if (nx < 0 || nx >= cols) {
        continue;
      }
      const nIdx = row + nx;
      sum += world.tileFire[nIdx] ?? 0;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
};

const fireVertexShader = `
  attribute float aIntensity;
  attribute float aSeed;
  attribute float aBaseCurve;

  uniform float uTime;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vSeed;
  varying float vBaseCurve;

  void main() {
    vUv = uv;
    vIntensity = aIntensity;
    vSeed = aSeed;
    vBaseCurve = aBaseCurve;

    vec3 transformed = position;
    float windMag = length(uWind);
    float edgeFade = 1.0 - uv.y;
    float wobblePhase = uTime * (2.1 + windMag * 1.1) + aSeed * 31.7 + uv.y * 7.5;
    float windPhase = uTime * (2.5 + windMag * 1.5) + aSeed * 17.9;
    float windGust = 0.65 + 0.35 * sin(windPhase);
    transformed.x += (sin(wobblePhase) + 0.5 * sin(wobblePhase * 1.9 + 1.4)) * 0.012 * (0.3 + aIntensity) * edgeFade;
    transformed.y += sin(uTime * 2.2 + aSeed * 17.3) * 0.01 * (0.28 + aIntensity) * edgeFade;
    transformed.x += uWind.x * (0.008 + uv.y * uv.y * 0.05) * windGust * (0.2 + aIntensity * 0.55);
    transformed.z += uWind.y * (0.008 + uv.y * uv.y * 0.05) * windGust * (0.2 + aIntensity * 0.55);

    vec4 worldPosition = instanceMatrix * vec4(transformed, 1.0);
    float lean = uv.y * uv.y * (0.06 + aIntensity * 0.14 + windMag * 0.05);
    worldPosition.x += uWind.x * lean;
    worldPosition.z += uWind.y * lean;
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

const fireFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uCore;
  uniform float uAlphaScale;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vSeed;
  varying float vBaseCurve;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.03 + vec2(17.13, 9.31);
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float y = clamp(vUv.y, 0.0, 1.0);

    float rise = uTime * (0.72 + vIntensity * 0.85 + vSeed * 0.14);
    vec2 baseUv = vec2(x * 1.45 + (vSeed - 0.5) * 0.8, y * 2.2 - rise);
    float lowFreq = fbm(baseUv + vec2(0.0, -uTime * 0.2));
    float highFreq = fbm(baseUv * 2.35 + vec2(vSeed * 8.0, -uTime * 0.9));
    float turbulence = mix(lowFreq, highFreq, 0.42);

    float trunk = mix(0.82, 0.3, smoothstep(0.03, 1.0, y));
    float belly = 0.2 * exp(-12.0 * (y - 0.22) * (y - 0.22));
    float width = (trunk + belly) * mix(1.0, 0.82, uCore);
    float sideWarp = (turbulence - 0.5) * (0.16 - 0.08 * y);
    float edgeDist = abs(x + sideWarp) / max(width, 0.001);
    float sideMask = 1.0 - smoothstep(0.88, 1.1, edgeDist);

    float lick = fbm(vec2(x * 2.25 + vSeed * 9.0, y * 3.7 - rise * 2.0));
    float lickMask = smoothstep(0.2, 0.95, lick + (1.0 - y) * 0.45);

    float curveLift = clamp(vBaseCurve, 0.0, 1.0) * pow(abs(x), 1.35) * 0.16;
    float baseFade = smoothstep(curveLift, curveLift + 0.035, y);
    float topFade = 1.0 - smoothstep(0.8, 1.02, y + (lick - 0.5) * 0.07);
    float alpha = sideMask * lickMask * baseFade * topFade;
    float alphaBase = (0.44 + vIntensity * 0.62) * mix(1.0, 1.12, uCore);
    alpha *= alphaBase * uAlphaScale;
    alpha *= 0.8 + turbulence * 0.2;
    if (alpha < 0.02) {
      discard;
    }

    float heat = clamp(vIntensity * 0.52 + (1.0 - y) * 0.44 + turbulence * 0.24 + uCore * 0.12, 0.0, 1.0);
    vec3 deepRed = vec3(0.42, 0.06, 0.01);
    vec3 orange = vec3(0.85, 0.22, 0.03);
    vec3 yellow = vec3(0.98, 0.58, 0.1);
    vec3 whiteHot = vec3(1.0, 0.9, 0.72);
    float baseHot = smoothstep(0.0, 0.52, heat);
    vec3 color = mix(deepRed, orange, baseHot);
    color = mix(color, yellow, smoothstep(0.38, 0.86, heat));
    float whiteMask = smoothstep(0.9, 1.0, heat) * smoothstep(0.35, 1.0, y);
    color = mix(color, whiteHot, whiteMask * 0.42);
    color *= 0.78 + turbulence * 0.18;

    gl_FragColor = vec4(color, max(alpha, 0.0));
  }
`;

const createFireShaderMaterial = (core: number, alphaScale: number): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: fireVertexShader,
    fragmentShader: fireFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: core },
      uAlphaScale: { value: alphaScale },
      uWind: { value: new THREE.Vector2() }
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });

const createRadialTexture = (size: number, stops: Array<{ stop: number; color: string }>): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  stops.forEach((entry) => {
    gradient.addColorStop(entry.stop, entry.color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export type ThreeTestFireFx = {
  update: (
    time: number,
    world: RenderSim,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    treeBurn: TreeBurnController | null
  ) => void;
  dispose: () => void;
};

export const createThreeTestFireFx = (scene: THREE.Scene, camera: THREE.Camera): ThreeTestFireFx => {
  const glowTexture = createRadialTexture(96, [
    { stop: 0, color: "rgba(255, 210, 110, 0.75)" },
    { stop: 0.25, color: "rgba(255, 150, 55, 0.45)" },
    { stop: 0.6, color: "rgba(220, 70, 20, 0.14)" },
    { stop: 1, color: "rgba(0, 0, 0, 0)" }
  ]);
  const emberTexture = createRadialTexture(64, [
    { stop: 0, color: "rgba(255, 250, 210, 0.95)" },
    { stop: 0.4, color: "rgba(255, 165, 80, 0.8)" },
    { stop: 1, color: "rgba(0, 0, 0, 0)" }
  ]);
  const fireMaterial = createFireShaderMaterial(0, 0.78);
  const fireCoreMaterial = createFireShaderMaterial(1, 0.52);
  const smokeMaterial = createSmokeShaderMaterial({
    pointScale: 240,
    // Push smoke toward a stylized white/ash look while keeping slight warm near-source tint.
    warmColor: new THREE.Color(0.78, 0.75, 0.71),
    coolColor: new THREE.Color(0.86, 0.88, 0.91),
    warmStainColor: new THREE.Color(0.28, 0.22, 0.16),
    sunDirection: new THREE.Vector3(0.68, 0.74, 0.2),
    sunTint: new THREE.Color(0.96, 0.88, 0.78),
    baseSigma: 8.1,
    thinThickness: 1.55,
    thickThickness: 3.9,
    scatterStrength: 0.29,
    occlusionStrength: 0.78
  });
  const groundGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 0.85,
    toneMapped: false
  });
  const emberMaterial = new THREE.MeshBasicMaterial({
    map: emberTexture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 0.95,
    toneMapped: false
  });
  const fireGeometry = new THREE.PlaneGeometry(1, 1);
  const fireCoreGeometry = new THREE.PlaneGeometry(1, 1);
  const smokeBuffers = createParticleBuffers(SMOKE_MAX_INSTANCES);
  const groundGlowGeometry = new THREE.PlaneGeometry(1, 1);
  const emberGeometry = new THREE.PlaneGeometry(1, 1);
  fireGeometry.translate(0, 0.5, 0);
  fireCoreGeometry.translate(0, 0.5, 0);
  groundGlowGeometry.rotateX(-Math.PI / 2);
  const fireIntensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireSeedAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireBaseCurveAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  fireIntensityAttr.setUsage(THREE.DynamicDrawUsage);
  fireSeedAttr.setUsage(THREE.DynamicDrawUsage);
  fireBaseCurveAttr.setUsage(THREE.DynamicDrawUsage);
  fireGeometry.setAttribute("aIntensity", fireIntensityAttr);
  fireGeometry.setAttribute("aSeed", fireSeedAttr);
  fireGeometry.setAttribute("aBaseCurve", fireBaseCurveAttr);
  fireCoreGeometry.setAttribute("aIntensity", fireIntensityAttr);
  fireCoreGeometry.setAttribute("aSeed", fireSeedAttr);
  fireCoreGeometry.setAttribute("aBaseCurve", fireBaseCurveAttr);
  const fireMesh = new THREE.InstancedMesh(fireGeometry, fireMaterial, FIRE_MAX_INSTANCES);
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireMesh.renderOrder = 6;
  fireMesh.frustumCulled = false;
  fireMesh.count = 0;
  scene.add(fireMesh);
  const fireCoreMesh = new THREE.InstancedMesh(fireCoreGeometry, fireCoreMaterial, FIRE_MAX_INSTANCES);
  fireCoreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireCoreMesh.renderOrder = 7;
  fireCoreMesh.frustumCulled = false;
  fireCoreMesh.count = 0;
  scene.add(fireCoreMesh);
  const groundGlowMesh = new THREE.InstancedMesh(groundGlowGeometry, groundGlowMaterial, GLOW_MAX_INSTANCES);
  groundGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  groundGlowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_MAX_INSTANCES * 3), 3);
  groundGlowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  groundGlowMesh.renderOrder = 4;
  groundGlowMesh.frustumCulled = false;
  groundGlowMesh.count = 0;
  scene.add(groundGlowMesh);
  const smokePoints = new THREE.Points(smokeBuffers.geometry, smokeMaterial);
  smokePoints.renderOrder = 5;
  smokePoints.frustumCulled = false;
  scene.add(smokePoints);
  const emberMesh = new THREE.InstancedMesh(emberGeometry, emberMaterial, EMBER_MAX_INSTANCES);
  emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  emberMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(EMBER_MAX_INSTANCES * 3), 3);
  emberMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  emberMesh.renderOrder = 8;
  emberMesh.frustumCulled = false;
  emberMesh.count = 0;
  scene.add(emberMesh);

  const fireBillboard = new THREE.Object3D();
  const groundGlowBillboard = new THREE.Object3D();
  const emberBillboard = new THREE.Object3D();
  let previousTimeMs: number | null = null;
  let tileStateCols = 0;
  let tileStateRows = 0;
  let tileFlameVisual = new Float32Array(0);
  let tileSmokeVisual = new Float32Array(0);
  let tileSmokeSpawnAccum = new Float32Array(0);
  let smokeSpawnCursor = 0;
  let smokeSpawnSequence = 0;
  const smokeParticleActive = new Uint8Array(SMOKE_MAX_INSTANCES);
  const smokeParticleAge = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleLife = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleX = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleY = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleZ = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVx = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVy = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVz = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSeed = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleIntensity = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSoot = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleBaseSize = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceX = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceY = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceZ = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceIdx = new Int32Array(SMOKE_MAX_INSTANCES).fill(-1);
  const smokeRenderOrder = new Uint16Array(SMOKE_MAX_INSTANCES);
  const smokeRenderDepth = new Float32Array(SMOKE_MAX_INSTANCES);
  const cameraWorldPos = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  let pendingDeltaSeconds = 0;
  let lastRebuildTimeMs = -Infinity;
  let visualsCleared = true;

  const clearVisuals = (): void => {
    fireMesh.count = 0;
    fireCoreMesh.count = 0;
    groundGlowMesh.count = 0;
    smokeBuffers.geometry.setDrawRange(0, 0);
    emberMesh.count = 0;
    visualsCleared = true;
  };

  const ensureTileState = (cols: number, rows: number): void => {
    if (cols === tileStateCols && rows === tileStateRows) {
      return;
    }
    const count = Math.max(0, cols * rows);
    tileStateCols = cols;
    tileStateRows = rows;
    tileFlameVisual = new Float32Array(count);
    tileSmokeVisual = new Float32Array(count);
    tileSmokeSpawnAccum = new Float32Array(count);
  };

  const update = (
    time: number,
    world: RenderSim,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    treeBurn: TreeBurnController | null
  ): void => {
    const frameDeltaSeconds =
      previousTimeMs === null ? 1 / 60 : clamp((time - previousTimeMs) * 0.001, 1 / 240, 0.2);
    previousTimeMs = time;
    pendingDeltaSeconds = Math.min(0.3, pendingDeltaSeconds + frameDeltaSeconds);
    if (!sample || !terrainSize) {
      clearVisuals();
      return;
    }
    const cols = sample.cols;
    const rows = sample.rows;
    if (cols <= 0 || rows <= 0) {
      clearVisuals();
      return;
    }
    ensureTileState(cols, rows);
    const treeBounds = treeBurn?.getVisualBounds() ?? null;
    const hasActiveFire = (world.lastActiveFires ?? 0) > 0;
    const useFireBounds = hasActiveFire && world.fireBoundsActive;
    if (!useFireBounds && !treeBounds) {
      if (!visualsCleared) {
        clearVisuals();
      }
      pendingDeltaSeconds = 0;
      return;
    }
    const minIntervalMs = hasActiveFire ? FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS : FIRE_FX_IDLE_UPDATE_INTERVAL_MS;
    if (time - lastRebuildTimeMs < minIntervalMs) {
      return;
    }
    lastRebuildTimeMs = time;
    const deltaSeconds = clamp(pendingDeltaSeconds, 1 / 240, 0.08);
    pendingDeltaSeconds = 0;
    const minX =
      useFireBounds || treeBounds
        ? Math.max(0, Math.min(useFireBounds ? world.fireMinX : cols - 1, treeBounds?.minX ?? cols - 1))
        : 0;
    const maxX =
      useFireBounds || treeBounds
        ? Math.min(cols - 1, Math.max(useFireBounds ? world.fireMaxX : 0, treeBounds?.maxX ?? 0))
        : cols - 1;
    const minY =
      useFireBounds || treeBounds
        ? Math.max(0, Math.min(useFireBounds ? world.fireMinY : rows - 1, treeBounds?.minY ?? rows - 1))
        : 0;
    const maxY =
      useFireBounds || treeBounds
        ? Math.min(rows - 1, Math.max(useFireBounds ? world.fireMaxY : 0, treeBounds?.maxY ?? 0))
        : rows - 1;
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    const area = width * height;
    const sampleStep =
      area <= 8192
        ? 1
        : Math.max(1, Math.ceil(Math.sqrt(area / Math.max(1, FIRE_MAX_INSTANCES))));
    const tileSpanX = terrainSize.width / Math.max(1, cols);
    const tileSpanZ = terrainSize.depth / Math.max(1, rows);
    const tileSpan = Math.max(0.0001, Math.min(tileSpanX, tileSpanZ));
    const sampleFootprint = tileSpan * sampleStep;
    const heightScale = getTerrainHeightScale(cols, rows);
    const heatCap = Math.max(0.01, world.fireSettings.heatCap);
    const wind = world.wind;
    const windX = wind?.dx ?? 0;
    const windZ = wind?.dy ?? 0;
    const windStrength = wind?.strength ?? 0;
    const crossWindX = -windZ;
    const crossWindZ = windX;
    const windLeanX = windX * windStrength;
    const windLeanZ = windZ * windStrength;
    const timeSeconds = time * 0.001;
    fireMaterial.uniforms.uTime.value = timeSeconds;
    fireCoreMaterial.uniforms.uTime.value = timeSeconds;
    fireMaterial.uniforms.uWind.value.set(windLeanX * FLAME_WIND_GAIN, windLeanZ * FLAME_WIND_GAIN);
    fireCoreMaterial.uniforms.uWind.value.set(windLeanX * FLAME_WIND_GAIN, windLeanZ * FLAME_WIND_GAIN);
    smokeMaterial.uniforms.uTime.value = timeSeconds;
    smokeMaterial.uniforms.uWarmStartY.value = -heightScale * 0.1;
    smokeMaterial.uniforms.uWarmRangeY.value = Math.max(tileSpan * 8, heightScale * 0.65);
    const cameraAny = camera as THREE.Camera & { isOrthographicCamera?: boolean; zoom?: number };
    const zoomScale = cameraAny.isOrthographicCamera ? clamp(cameraAny.zoom ?? 1, 0.2, 8) : 1;
    smokeMaterial.uniforms.uZoomScale.value = zoomScale;
    camera.getWorldPosition(cameraWorldPos);
    camera.getWorldDirection(cameraForward);
    let fireCount = 0;
    let glowCount = 0;
    let smokeCount = 0;
    let emberCount = 0;
    let smokeSpawnsThisFrame = 0;
    const smokeSpawnFrameCap = Math.max(72, Math.floor(SMOKE_MAX_INSTANCES * 0.26));
    for (let y = minY; y <= maxY; y += sampleStep) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += sampleStep) {
        const idx = rowBase + x;
        const fire = world.tileFire[idx] ?? 0;
        const heat = clamp((world.tileHeat[idx] ?? 0) / heatCap, 0, 1);
        const flameProfile: TreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
        const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
        const hasActiveFire = fire > FIRE_MIN_INTENSITY;
        const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
        const hasTreeCarryFlame =
          !hasActiveFire &&
          flameProfile !== null &&
          treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN &&
          burnProgress > TREE_BURN_CARRY_PROGRESS_MIN &&
          heat > 0.08;
        const hasVisualFlame = hasActiveFire || hasTreeCarryFlame;
        const flameVisual = hasActiveFire
          ? Math.max(fire, treeBurnVisual * 0.95)
          : hasTreeCarryFlame
            ? treeBurnVisual * 0.72
            : 0;
        const targetFlame = clamp(flameVisual, 0, 1);
        const smoothedFlame = hasVisualFlame
          ? smoothApproach(tileFlameVisual[idx] ?? 0, targetFlame, 12, 5.6, deltaSeconds)
          : 0;
        tileFlameVisual[idx] = smoothedFlame;
        const targetSmoke = hasVisualFlame ? clamp(Math.max(targetFlame * 1.05, heat * 0.85, treeBurnVisual * 0.8), 0, 1.2) : 0;
        const smoothedSmoke = hasVisualFlame
          ? smoothApproach(tileSmokeVisual[idx] ?? 0, targetSmoke, 10.0, 0.18, deltaSeconds)
          : smoothApproach(tileSmokeVisual[idx] ?? 0, 0, 0, 12.0, deltaSeconds);
        tileSmokeVisual[idx] = smoothedSmoke;
        const hasFlame = smoothedFlame > 0.015;
        const hasPlume = hasFlame || (hasVisualFlame && smoothedSmoke > 0.02);
        if (!hasPlume) {
          tileSmokeSpawnAccum[idx] = Math.max(0, (tileSmokeSpawnAccum[idx] ?? 0) - deltaSeconds * 0.6);
          continue;
        }
        const intensity = clamp(Math.max(smoothedFlame, heat * 0.5), 0, 1);
        const flameIntensity = clamp(smoothedFlame, 0, 1);
        const normX = (x + 0.5) / cols;
        const normZ = (y + 0.5) / rows;
        const tileCenterX = (normX - 0.5) * terrainSize.width;
        const tileCenterZ = (normZ - 0.5) * terrainSize.depth;
        const tileHalfX = tileSpanX * 0.46;
        const tileHalfZ = tileSpanZ * 0.46;
        const minTileX = tileCenterX - tileHalfX;
        const maxTileX = tileCenterX + tileHalfX;
        const minTileZ = tileCenterZ - tileHalfZ;
        const maxTileZ = tileCenterZ + tileHalfZ;
        const anchor = treeBurn?.getTileAnchor(idx);
        const crownToTrunk = smoothstep(0.32, 0.88, burnProgress);
        const trunkDescent = smoothstep(0.58, 1.0, burnProgress);
        const worldX = anchor ? clamp(anchor.x, minTileX, maxTileX) : tileCenterX;
        const worldZ = anchor ? clamp(anchor.z, minTileZ, maxTileZ) : tileCenterZ;
        const elevation = world.tileElevation[idx] ?? 0;
        const baseY = anchor ? anchor.y : clamp(elevation, -1, 1) * heightScale;
        const tileSeed = hash1(idx + 0.123);
        const neighbourFire = getNeighbourFireBias(world, cols, rows, x, y);
        const clusterNoise = hash1(idx * 0.173 + 5.17);
        const clusterBias = clamp(
          (neighbourFire - flameIntensity) * FIRE_VISUAL_TUNING.clusterStrength + (clusterNoise - 0.5) * 0.3,
          -0.45,
          0.55
        );
        const slowFlicker = 0.5 + 0.5 * Math.sin(timeSeconds * (0.45 + clusterNoise * 0.5) + clusterNoise * TAU);
        const tongueDrive = clamp(
          flameIntensity * 0.82 + heat * 0.35 + clusterBias * 0.65 + slowFlicker * 0.18 - 0.12,
          0,
          1.2
        );
        const tongueCountRaw =
          FIRE_VISUAL_TUNING.tongueSpawnMin +
          (FIRE_VISUAL_TUNING.tongueSpawnMax - FIRE_VISUAL_TUNING.tongueSpawnMin) * clamp(tongueDrive, 0, 1);
        let flameletCount = Math.round(tongueCountRaw);
        if (tongueDrive < 0.24 && slowFlicker < 0.42) {
          flameletCount = 0;
        }
        flameletCount = Math.max(0, Math.min(FIRE_VISUAL_TUNING.tongueSpawnMax, flameletCount));
        if (flameletCount <= 0 && hasActiveFire && flameProfile && flameIntensity > 0.06) {
          flameletCount = 1;
        }
        const heroCount = flameletCount <= 0 ? 0 : Math.max(1, Math.min(3, Math.round(flameletCount * 0.28 + (1 - crownToTrunk) * 0.6)));
        const windStrengthBoost = 0.35 + windStrength * windStrength * 0.9;
        const crownRadius = flameProfile ? flameProfile.crownRadius * (0.9 + Math.min(0.5, flameProfile.treeCount * 0.08)) : tileSpan * FLAME_CELL_LATERAL_LIMIT;
        const trunkRadius = flameProfile ? Math.max(tileSpan * 0.1, crownRadius * 0.22) : tileSpan * 0.16;
        const sourceRadius = crownRadius * (1 - crownToTrunk) + trunkRadius * crownToTrunk;
        const lateralLimit = Math.max(tileSpan * 0.1, sourceRadius * (1.1 - crownToTrunk * 0.55));
        const crownSourceY = flameProfile ? flameProfile.y + flameProfile.crownHeight * 0.72 : baseY + tileSpan * 0.45;
        const trunkSourceY = flameProfile
          ? flameProfile.y + flameProfile.trunkHeight * (0.95 + (0.2 - 0.95) * trunkDescent)
          : baseY + tileSpan * (0.28 + (0.12 - 0.28) * trunkDescent);
        const sourceYBase = crownSourceY * (1 - crownToTrunk) + trunkSourceY * crownToTrunk;
        if (hasFlame) {
          for (let flamelet = 0; flamelet < flameletCount && fireCount < FIRE_MAX_INSTANCES; flamelet += 1) {
          const s1 = hash1(idx * 1.173 + flamelet * 11.0 + 19.7);
          const s2 = hash1(idx * 0.917 + flamelet * 17.0 + 41.3);
          const s3 = hash1(idx * 1.411 + flamelet * 23.0 + 67.9);
          const isHero = flamelet < heroCount;
          const sizeVar =
            FIRE_VISUAL_TUNING.sizeVariationMin +
            s1 * (FIRE_VISUAL_TUNING.sizeVariationMax - FIRE_VISUAL_TUNING.sizeVariationMin);
          const leanVar =
            FIRE_VISUAL_TUNING.leanVariationMin +
            s2 * (FIRE_VISUAL_TUNING.leanVariationMax - FIRE_VISUAL_TUNING.leanVariationMin);
          const flickerRate =
            FIRE_VISUAL_TUNING.flickerRateMin +
            s2 * (FIRE_VISUAL_TUNING.flickerRateMax - FIRE_VISUAL_TUNING.flickerRateMin);
          const tierScale = (isHero ? 0.82 + s3 * 0.24 - flamelet * 0.08 : 0.24 + s3 * 0.42) * sizeVar;
          const phaseRate = isHero ? 0.32 + flickerRate * 0.28 : 0.8 + flickerRate * 0.95;
          const phase = fract(timeSeconds * phaseRate + s3 + (isHero ? 0 : flamelet * 0.17));
          const riseT = isHero ? Math.pow(phase, 1.35) : Math.pow(phase, 2.0);
          const baseSpread =
            sourceRadius * (isHero ? 0.16 + flameIntensity * 0.28 : 0.22 + flameIntensity * 0.4) +
            sampleFootprint * (isHero ? 0.03 : 0.08);
          const spawnX = (s1 - 0.5) * baseSpread;
          const spawnZ = (s2 - 0.5) * baseSpread;
          const curlAmp = sourceRadius * (isHero ? 0.2 : 0.16) * tierScale;
          const curlX = Math.sin(phase * (isHero ? 8 : 14) + s1 * Math.PI * 2) * curlAmp;
          const curlZ = Math.cos(phase * (isHero ? 7 : 12) + s2 * Math.PI * 2) * curlAmp * 0.55;
          const windFlicker = 0.7 + 0.3 * Math.sin(timeSeconds * 3.6 + s2 * Math.PI * 2);
          const windScale =
            tileSpan * (0.006 + flameIntensity * 0.02 + heat * 0.015 + leanVar * 0.05) * windStrengthBoost * windFlicker;
          const windOffsetX = windX * windScale * (0.22 + riseT * 0.52);
          const windOffsetZ = windZ * windScale * (0.22 + riseT * 0.52);
          const riseHeight =
            (sampleFootprint * (0.14 + flameIntensity * 0.34 + heat * 0.2) + sourceRadius * 0.42) * tierScale;
          const flameRise = riseT * riseHeight * (isHero ? 0.5 : 0.28);
          const heightPulse = isHero ? 0.82 + 0.18 * (1 - phase) : 0.68 + 0.28 * Math.sin(phase * TAU);
          const flameHeight = Math.max(
            tileSpan * (isHero ? 0.18 : 0.1),
            (sampleFootprint * (0.2 + heat * 0.25 + flameIntensity * 0.2) + sourceRadius * 0.32) *
              tierScale *
              heightPulse
          );
          const flameWidth = Math.max(
            tileSpan * (isHero ? 0.13 : 0.08),
            flameHeight * (isHero ? 0.6 + 0.16 * s1 : 0.46 + 0.18 * s1)
          );
          const flameY = sourceYBase + flameRise;
          let lateralX = spawnX + curlX + windOffsetX;
          let lateralZ = spawnZ + curlZ + windOffsetZ;
          const softLimit = lateralLimit * (isHero ? 0.36 : 0.62) * (0.85 + s3 * 0.2);
          if (Math.abs(lateralX) > softLimit) {
            lateralX = Math.sign(lateralX) * (softLimit + (Math.abs(lateralX) - softLimit) * 0.1);
          }
          if (Math.abs(lateralZ) > softLimit) {
            lateralZ = Math.sign(lateralZ) * (softLimit + (Math.abs(lateralZ) - softLimit) * 0.1);
          }
          lateralX = clamp(lateralX, -lateralLimit, lateralLimit);
          lateralZ = clamp(lateralZ, -lateralLimit, lateralLimit);
          const flameWorldX = clamp(worldX + lateralX, minTileX, maxTileX);
          const flameWorldZ = clamp(worldZ + lateralZ, minTileZ, maxTileZ);
          fireBillboard.position.set(flameWorldX, flameY, flameWorldZ);
          fireBillboard.scale.set(flameWidth, flameHeight, flameWidth);
          fireBillboard.quaternion.copy(camera.quaternion);
          fireBillboard.updateMatrix();
          fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          const stageBoost = 0.85 + (1 - crownToTrunk) * 0.2;
          const flickerIntensity = clamp(
            (flameIntensity * (isHero ? 0.78 : 0.56) * (0.65 + 0.35 * (1 - phase)) + heat * (isHero ? 0.18 : 0.1)) * stageBoost,
            0,
            1
          );
          fireIntensityAttr.setX(fireCount, flickerIntensity);
          fireSeedAttr.setX(fireCount, fract(tileSeed + s3 + flamelet * 0.19));
          const crownCurve = clamp(0.12 + (1 - crownToTrunk) * 0.75, 0, 1);
          fireBaseCurveAttr.setX(fireCount, crownCurve);
          fireBillboard.scale.set(flameWidth * 0.62, flameHeight * 0.58, flameWidth * 0.62);
          fireBillboard.updateMatrix();
          fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          fireCount += 1;
        }
        }
        const groundFlameDrive = hasActiveFire
          ? clamp(intensity * 0.78 + heat * 0.5 + clusterBias * 0.45 + slowFlicker * 0.15 - 0.1, 0, 1.2)
          : 0;
        const groundCountRaw =
          FIRE_VISUAL_TUNING.groundFlameSpawnMin +
          (FIRE_VISUAL_TUNING.groundFlameSpawnMax - FIRE_VISUAL_TUNING.groundFlameSpawnMin) * clamp(groundFlameDrive, 0, 1);
        let groundFlameCount = Math.round(groundCountRaw);
        if (groundFlameDrive < 0.2 && slowFlicker < 0.35) {
          groundFlameCount = Math.max(0, groundFlameCount - 2);
        }
        for (let groundFlame = 0; groundFlame < groundFlameCount && fireCount < FIRE_MAX_INSTANCES; groundFlame += 1) {
          const g1 = hash1(idx * 1.621 + groundFlame * 7.11 + 13.7);
          const g2 = hash1(idx * 0.743 + groundFlame * 9.31 + 23.1);
          const g3 = hash1(idx * 1.177 + groundFlame * 5.93 + 31.9);
          const gRate =
            FIRE_VISUAL_TUNING.flickerRateMin +
            g2 * (FIRE_VISUAL_TUNING.flickerRateMax - FIRE_VISUAL_TUNING.flickerRateMin);
          const gPhase = fract(timeSeconds * gRate + g3 * 7.1);
          const gFlicker = 0.45 + 0.55 * Math.sin(gPhase * TAU + g1 * TAU);
          const gRadius = tileSpan * (0.16 + groundFlameDrive * 0.26);
          const gTheta = g1 * TAU;
          const gOffsetR = Math.sqrt(g2) * gRadius;
          const gX = Math.cos(gTheta) * gOffsetR;
          const gZ = Math.sin(gTheta) * gOffsetR;
          const gHeight =
            tileSpan * (0.08 + groundFlameDrive * 0.22) * (0.6 + gFlicker * 0.7) * (0.85 + g3 * 0.4);
          const gWidth = Math.max(tileSpan * 0.06, gHeight * (0.6 + g2 * 0.3));
          const gWindLean = tileSpan * (0.015 + groundFlameDrive * 0.05 + windStrength * 0.03);
          const groundWorldX = clamp(worldX + gX + windX * gWindLean, minTileX, maxTileX);
          const groundWorldZ = clamp(worldZ + gZ + windZ * gWindLean, minTileZ, maxTileZ);
          fireBillboard.position.set(groundWorldX, baseY + gHeight * 0.42, groundWorldZ);
          fireBillboard.scale.set(gWidth, gHeight, gWidth);
          fireBillboard.quaternion.copy(camera.quaternion);
          fireBillboard.updateMatrix();
          fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          const groundIntensity = clamp(groundFlameDrive * (0.38 + 0.38 * gFlicker), 0, 1);
          fireIntensityAttr.setX(fireCount, groundIntensity);
          fireSeedAttr.setX(fireCount, fract(tileSeed * 0.71 + g3 + groundFlame * 0.11));
          fireBaseCurveAttr.setX(fireCount, 0);
          fireBillboard.scale.set(gWidth * 0.66, gHeight * 0.52, gWidth * 0.66);
          fireBillboard.updateMatrix();
          fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          fireCount += 1;
        }
        if (hasActiveFire && glowCount < GLOW_MAX_INSTANCES) {
          const glowDrive = clamp(intensity * 0.78 + heat * 0.34 + Math.max(0, clusterBias) * 0.35, 0, 1.1);
          const glowInstances = glowDrive > 0.62 ? 2 : 1;
          for (let gi = 0; gi < glowInstances && glowCount < GLOW_MAX_INSTANCES; gi += 1) {
            const g1 = hash1(idx * 1.27 + gi * 7.37 + 0.9);
            const g2 = hash1(idx * 0.83 + gi * 11.1 + 4.3);
            const jitterR = sampleFootprint * (0.06 + glowDrive * 0.18) * Math.sqrt(g1);
            const jitterTheta = g2 * TAU;
            const jitterX = Math.cos(jitterTheta) * jitterR;
            const jitterZ = Math.sin(jitterTheta) * jitterR;
            const pulse = 0.86 + 0.14 * Math.sin(timeSeconds * (0.8 + g1 * 1.2) + g2 * TAU);
            const glowSize =
              (0.44 + glowDrive * 0.82 + g1 * 0.2) *
              sampleFootprint *
              FIRE_VISUAL_TUNING.glowRadius;
            const glowWorldX = clamp(worldX + jitterX, minTileX, maxTileX);
            const glowWorldZ = clamp(worldZ + jitterZ, minTileZ, maxTileZ);
            groundGlowBillboard.position.set(glowWorldX, baseY + 0.03, glowWorldZ);
            groundGlowBillboard.quaternion.identity();
            groundGlowBillboard.scale.set(glowSize, glowSize, glowSize);
            groundGlowBillboard.updateMatrix();
            groundGlowMesh.setMatrixAt(glowCount, groundGlowBillboard.matrix);
            const glow = clamp((0.12 + glowDrive * FIRE_VISUAL_TUNING.glowStrength) * pulse, 0, 1.1);
            groundGlowMesh.instanceColor?.setXYZ(glowCount, glow, glow * (0.34 + g2 * 0.18), glow * (0.08 + g1 * 0.06));
            glowCount += 1;
          }
        }
        if (hasActiveFire && hasFlame && emberCount < FIRE_VISUAL_TUNING.sparkMax) {
          const sparkPulse = 0.5 + 0.5 * Math.sin(timeSeconds * (1.6 + tileSeed * 1.3) + tileSeed * TAU);
          const sparkDrive = Math.max(0, flameIntensity * 1.9 + intensity * 0.9 + heat * 0.65 + Math.max(0, clusterBias) * 0.75 - 0.28);
          const emberBursts = Math.max(
            0,
            Math.min(7, Math.round(sparkDrive * FIRE_VISUAL_TUNING.sparkRate * sparkPulse))
          );
          for (let burst = 0; burst < emberBursts && emberCount < FIRE_VISUAL_TUNING.sparkMax; burst += 1) {
            const emberSeed = fract(tileSeed * (13.17 + burst * 5.31) + burst * 0.37);
            const lifeRate = 0.34 + emberSeed * 0.62;
            const life = fract(timeSeconds * lifeRate + emberSeed * 3.1);
            const riseHeight = life * life * (1.1 + intensity * 3.4 + windStrength * 0.8) * sampleStep;
            const swirlPhase = timeSeconds * (5.2 + emberSeed * 3.2) + emberSeed * 35.0;
            const swirl = (1.0 - life) * (0.24 + windStrength * 0.2) * sampleStep;
            const lateralX = Math.sin(swirlPhase) * swirl + (emberSeed - 0.5) * 0.26 * sampleStep;
            const lateralZ =
              Math.cos(swirlPhase * 1.13) * swirl + (fract(emberSeed * 7.1) - 0.5) * 0.26 * sampleStep;
            const downwind = windStrength * (0.4 + life * (1.8 + intensity * 1.2)) * sampleStep;
            const crosswind =
              (fract(emberSeed * 11.9) - 0.5) * (0.32 + life * 0.9 + windStrength * 0.6) * sampleStep;
            emberBillboard.position.set(
              worldX + lateralX + windX * downwind + crossWindX * crosswind,
              sourceYBase + 0.1 + riseHeight,
              worldZ + lateralZ + windZ * downwind + crossWindZ * crosswind
            );
            const emberSize = (0.08 + (1 - life) * 0.19 + intensity * 0.06 + windStrength * 0.03) * sampleStep;
            emberBillboard.scale.set(emberSize, emberSize * 1.3, emberSize);
            emberBillboard.quaternion.copy(camera.quaternion);
            emberBillboard.updateMatrix();
            emberMesh.setMatrixAt(emberCount, emberBillboard.matrix);
            const emberHot = clamp((1 - life) * 0.95 + intensity * 0.5, 0, 1);
            emberMesh.instanceColor?.setXYZ(emberCount, 1, 0.5 + 0.5 * emberHot, 0.08 + 0.14 * emberHot);
            emberCount += 1;
          }
        }
        const smokeIntensity01 = clamp(smoothedSmoke, 0, 1);
        const smokeDrive = Math.max(smokeIntensity01, targetSmoke * 0.85);
        if (hasActiveFire && smokeDrive > 0.005 && smokeSpawnsThisFrame < smokeSpawnFrameCap) {
          const fuel = clamp(world.tileFuel[idx] ?? 1, 0, 1);
          const sootBase = clamp(0.08 + smokeDrive * 0.22 + (1 - fuel) * 0.28 + heat * 0.05, 0, 1);
          const emissionRate =
            (0.18 + Math.pow(smokeDrive, 1.5) * 6.8 + heat * 0.55 + windStrength * 0.28) *
            (0.75 + sampleStep * 0.22);
          let spawnCarry = (tileSmokeSpawnAccum[idx] ?? 0) + emissionRate * deltaSeconds;
          const spawnCount = Math.min(9, Math.floor(spawnCarry));
          spawnCarry -= spawnCount;
          tileSmokeSpawnAccum[idx] = spawnCarry;
          const spawnLimit = Math.min(spawnCount, smokeSpawnFrameCap - smokeSpawnsThisFrame);
          const plumeRadius = sampleFootprint * (0.14 + smokeDrive * 0.58);
          const baseSize = tileSpan * (0.9 + smokeDrive * 1.28);
          for (let spawn = 0; spawn < spawnLimit; spawn += 1) {
            const nonce = smokeSpawnSequence++;
            const r1 = hash1(idx * 1.173 + nonce * 0.137 + timeSeconds * 0.19);
            const r2 = hash1(idx * 0.917 + nonce * 0.223 + 17.0);
            const r3 = hash1(idx * 1.411 + nonce * 0.311 + 41.0);
            const theta = r1 * TAU;
            const radial = Math.sqrt(r2) * plumeRadius;
            const offsetX = Math.cos(theta) * radial;
            const offsetZ = Math.sin(theta) * radial;
            const velAlongWind = windStrength * tileSpan * (0.52 + smokeDrive * 1.6 + r3 * 0.8);
            const velCross = (r2 - 0.5) * tileSpan * (0.22 + smokeDrive * 0.55);
            const slot = smokeSpawnCursor;
            smokeSpawnCursor = (smokeSpawnCursor + 1) % SMOKE_MAX_INSTANCES;
            smokeParticleActive[slot] = 1;
            smokeParticleAge[slot] = 0;
            smokeParticleLife[slot] = 8.5 + smokeDrive * 11.5 + r1 * 3.8 + windStrength * 2.2;
            smokeParticleX[slot] = worldX + offsetX + crossWindX * velCross * 0.22;
            smokeParticleY[slot] = sourceYBase + 0.18 + r3 * tileSpan * 0.34;
            smokeParticleZ[slot] = worldZ + offsetZ + crossWindZ * velCross * 0.22;
            smokeParticleVx[slot] = windX * velAlongWind + crossWindX * velCross;
            smokeParticleVy[slot] = tileSpan * (0.46 + smokeDrive * 0.95 + r3 * 0.36);
            smokeParticleVz[slot] = windZ * velAlongWind + crossWindZ * velCross;
            smokeParticleSeed[slot] = r3;
            smokeParticleIntensity[slot] = smokeDrive;
            smokeParticleSoot[slot] = clamp(sootBase + (r2 - 0.5) * 0.08, 0, 1);
            smokeParticleBaseSize[slot] = baseSize * (1.02 + r2 * 0.72);
            smokeParticleSourceX[slot] = worldX;
            smokeParticleSourceY[slot] = sourceYBase + 0.12;
            smokeParticleSourceZ[slot] = worldZ;
            smokeParticleSourceIdx[slot] = idx;
            smokeSpawnsThisFrame += 1;
          }
        }
      }
    }
    for (let i = 0; i < SMOKE_MAX_INSTANCES; i += 1) {
      if (smokeParticleActive[i] === 0) {
        continue;
      }
      const sourceIdx = smokeParticleSourceIdx[i];
      const sourceFire = sourceIdx >= 0 ? world.tileFire[sourceIdx] ?? 0 : 0;
      const sourceHeat = sourceIdx >= 0 ? clamp((world.tileHeat[sourceIdx] ?? 0) / heatCap, 0, 1) : 0;
      if (sourceIdx < 0 || (sourceFire <= FIRE_MIN_INTENSITY && sourceHeat < 0.08)) {
        smokeParticleActive[i] = 0;
        smokeParticleSourceIdx[i] = -1;
        continue;
      }
      const lifeSeconds = Math.max(0.5, smokeParticleLife[i]);
      const age = smokeParticleAge[i] + deltaSeconds / lifeSeconds;
      if (age >= 1) {
        smokeParticleActive[i] = 0;
        smokeParticleSourceIdx[i] = -1;
        continue;
      }
      smokeParticleAge[i] = age;
      const seed = smokeParticleSeed[i];
      const intensity = smokeParticleIntensity[i];
      const age2 = age * age;
      const age3 = age2 * age;
      const sourceX = smokeParticleSourceX[i];
      const sourceZ = smokeParticleSourceZ[i];
      const downwindOffset = windStrength * tileSpan * (age2 * (6.2 + intensity * 12.2) + age3 * 10.4);
      const centerX = sourceX + windX * downwindOffset;
      const centerZ = sourceZ + windZ * downwindOffset;
      const drag = Math.exp(-deltaSeconds * (0.08 + age * 0.14));
      const shear = 0.28 + age * 3.4 + windStrength * (0.8 + age * 2.2);
      smokeParticleVx[i] =
        smokeParticleVx[i] * drag +
        windX * windStrength * tileSpan * deltaSeconds * 0.12 * shear;
      smokeParticleVz[i] =
        smokeParticleVz[i] * drag +
        windZ * windStrength * tileSpan * deltaSeconds * 0.12 * shear;
      // Widen plume with age and wind: older smoke spreads into larger downwind lobes.
      const seedAngle = seed * TAU;
      const seedDirX = Math.cos(seedAngle);
      const seedDirZ = Math.sin(seedAngle);
      const spreadAge = Math.pow(age, 1.35);
      const baseSpread = tileSpan * spreadAge * (1.4 + intensity * 3.2);
      const windSpread = tileSpan * spreadAge * windStrength * (4.8 + intensity * 3.4);
      const crossJitter = seed * 2 - 1;
      const spreadTargetX = centerX + seedDirX * (baseSpread + windSpread * 0.35) + crossWindX * (crossJitter * windSpread);
      const spreadTargetZ = centerZ + seedDirZ * (baseSpread + windSpread * 0.35) + crossWindZ * (crossJitter * windSpread);
      const cohesion = (1 - age) * (0.95 + intensity * 0.6) + 0.04;
      smokeParticleVx[i] += (spreadTargetX - smokeParticleX[i]) * cohesion * deltaSeconds;
      smokeParticleVz[i] += (spreadTargetZ - smokeParticleZ[i]) * cohesion * deltaSeconds;
      // Monotonic convection: avoid any downward spring pull that creates visible dip/rebound motion.
      smokeParticleVy[i] =
        smokeParticleVy[i] * (1 - deltaSeconds * (0.04 + age * 0.05)) +
        tileSpan * deltaSeconds * (0.22 + intensity * 0.16 + age * 0.2);
      const minRise = tileSpan * (0.06 + intensity * 0.04 + age * 0.06);
      if (smokeParticleVy[i] < minRise) {
        smokeParticleVy[i] = minRise;
      }
      const prevY = smokeParticleY[i];
      const swirlPhase = timeSeconds * (0.28 + seed * 0.62) + seed * 21.7 + age * 7.6;
      const swirlAmp = tileSpan * deltaSeconds * (0.008 + age * 0.024 + intensity * 0.012);
      smokeParticleX[i] += smokeParticleVx[i] * deltaSeconds + Math.sin(swirlPhase) * swirlAmp;
      smokeParticleY[i] += smokeParticleVy[i] * deltaSeconds;
      if (smokeParticleY[i] < prevY) {
        smokeParticleY[i] = prevY + tileSpan * deltaSeconds * 0.01;
      }
      smokeParticleZ[i] += smokeParticleVz[i] * deltaSeconds + Math.cos(swirlPhase * 1.17) * swirlAmp;
      const dx = smokeParticleX[i] - cameraWorldPos.x;
      const dy = smokeParticleY[i] - cameraWorldPos.y;
      const dz = smokeParticleZ[i] - cameraWorldPos.z;
      smokeRenderDepth[smokeCount] = dx * cameraForward.x + dy * cameraForward.y + dz * cameraForward.z;
      smokeRenderOrder[smokeCount] = i;
      smokeCount += 1;
    }
    sortSmokeParticlesByDepth(smokeRenderDepth, smokeRenderOrder, smokeCount);
    for (let draw = 0; draw < smokeCount; draw += 1) {
      const i = smokeRenderOrder[draw];
      const writeIndex = draw;
      const i3 = writeIndex * 3;
      smokeBuffers.positions[i3] = smokeParticleX[i];
      smokeBuffers.positions[i3 + 1] = smokeParticleY[i];
      smokeBuffers.positions[i3 + 2] = smokeParticleZ[i];
      smokeBuffers.aAge01[writeIndex] = smokeParticleAge[i];
      smokeBuffers.aSeed[writeIndex] = smokeParticleSeed[i];
      smokeBuffers.aIntensity[writeIndex] = smokeParticleIntensity[i];
      smokeBuffers.aSoot[writeIndex] = smokeParticleSoot[i];
      smokeBuffers.aSize[writeIndex] = smokeParticleBaseSize[i] * (1.2 + smokeParticleAge[i] * 3.35);
    }
    fireMesh.count = fireCount;
    fireCoreMesh.count = fireCount;
    groundGlowMesh.count = glowCount;
    smokeBuffers.geometry.setDrawRange(0, smokeCount);
    emberMesh.count = emberCount;
    visualsCleared = false;
    fireMesh.instanceMatrix.needsUpdate = true;
    fireCoreMesh.instanceMatrix.needsUpdate = true;
    groundGlowMesh.instanceMatrix.needsUpdate = true;
    emberMesh.instanceMatrix.needsUpdate = true;
    smokeBuffers.positionAttr.needsUpdate = true;
    smokeBuffers.ageAttr.needsUpdate = true;
    smokeBuffers.seedAttr.needsUpdate = true;
    smokeBuffers.intensityAttr.needsUpdate = true;
    smokeBuffers.sootAttr.needsUpdate = true;
    smokeBuffers.sizeAttr.needsUpdate = true;
    fireIntensityAttr.needsUpdate = true;
    fireSeedAttr.needsUpdate = true;
    fireBaseCurveAttr.needsUpdate = true;
    if (groundGlowMesh.instanceColor) {
      groundGlowMesh.instanceColor.needsUpdate = true;
    }
    if (emberMesh.instanceColor) {
      emberMesh.instanceColor.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    scene.remove(fireMesh);
    scene.remove(fireCoreMesh);
    scene.remove(groundGlowMesh);
    scene.remove(smokePoints);
    scene.remove(emberMesh);
    fireGeometry.dispose();
    fireCoreGeometry.dispose();
    groundGlowGeometry.dispose();
    smokeBuffers.geometry.dispose();
    emberGeometry.dispose();
    fireMaterial.dispose();
    fireCoreMaterial.dispose();
    groundGlowMaterial.dispose();
    smokeMaterial.dispose();
    emberMaterial.dispose();
    glowTexture.dispose();
    emberTexture.dispose();
  };

  return { update, dispose };
};
