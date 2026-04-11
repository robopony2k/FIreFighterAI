import * as THREE from "three";
import type { WorldState } from "../core/state.js";
import type { EffectsState } from "../core/effectsState.js";
import { TILE_SIZE, WATER_PARTICLE_COLOR } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { getRenderHeightAt } from "./terrainCache.js";
import { isoProject } from "./iso.js";

export type ParticleBuffers = {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  aAge01: Float32Array;
  aSeed: Float32Array;
  aIntensity: Float32Array;
  aSoot: Float32Array;
  aSize: Float32Array;
  positionAttr: THREE.BufferAttribute;
  ageAttr: THREE.BufferAttribute;
  seedAttr: THREE.BufferAttribute;
  intensityAttr: THREE.BufferAttribute;
  sootAttr: THREE.BufferAttribute;
  sizeAttr: THREE.BufferAttribute;
};

const createDynamicBufferAttribute = (array: Float32Array, itemSize: number): THREE.BufferAttribute => {
  const attribute = new THREE.BufferAttribute(array, itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
};

export const createParticleBuffers = (maxParticles: number): ParticleBuffers => {
  const clampedMax = Math.max(1, Math.floor(maxParticles));
  const positions = new Float32Array(clampedMax * 3);
  const aAge01 = new Float32Array(clampedMax);
  const aSeed = new Float32Array(clampedMax);
  const aIntensity = new Float32Array(clampedMax);
  const aSoot = new Float32Array(clampedMax);
  const aSize = new Float32Array(clampedMax);

  const positionAttr = createDynamicBufferAttribute(positions, 3);
  const ageAttr = createDynamicBufferAttribute(aAge01, 1);
  const seedAttr = createDynamicBufferAttribute(aSeed, 1);
  const intensityAttr = createDynamicBufferAttribute(aIntensity, 1);
  const sootAttr = createDynamicBufferAttribute(aSoot, 1);
  const sizeAttr = createDynamicBufferAttribute(aSize, 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aAge01", ageAttr);
  geometry.setAttribute("aSeed", seedAttr);
  geometry.setAttribute("aIntensity", intensityAttr);
  geometry.setAttribute("aSoot", sootAttr);
  geometry.setAttribute("aSize", sizeAttr);
  geometry.setDrawRange(0, 0);

  return {
    geometry,
    positions,
    aAge01,
    aSeed,
    aIntensity,
    aSoot,
    aSize,
    positionAttr,
    ageAttr,
    seedAttr,
    intensityAttr,
    sootAttr,
    sizeAttr
  };
};

const smokeVertexShader = `
  precision highp float;

  attribute float aAge01;
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aSoot;
  attribute float aSize;

  uniform float uPointScale;
  uniform float uZoomScale;

  varying float vAge01;
  varying float vSeed;
  varying float vIntensity;
  varying float vSoot;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    vAge01 = clamp(aAge01, 0.0, 1.0);
    vSeed = aSeed;
    vIntensity = clamp(aIntensity, 0.0, 1.0);
    vSoot = clamp(aSoot, 0.0, 1.0);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;
    float distance = max(1.0, -mvPosition.z);

    // Let rising smoke broaden enough that old plumes disappear by dispersal, not a hard life cutoff.
    float ageScale = mix(1.08, 3.75, pow(vAge01, 0.7));
    float intensityScale = mix(0.72, 1.68, sqrt(vIntensity));
    float distanceAtten = clamp(uPointScale / distance, 0.42, 8.5);

    gl_PointSize = max(2.0, aSize * ageScale * intensityScale * distanceAtten * uZoomScale);
    gl_Position = projectionMatrix * mvPosition;

    vWorldPos = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
  }
`;

const smokeFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform vec3 uWarmCol;
  uniform vec3 uCoolCol;
  uniform vec3 uWarmStainCol;
  uniform vec3 uSunDir;
  uniform vec3 uSunTint;
  uniform float uBaseSigma;
  uniform float uThinThickness;
  uniform float uThickThickness;
  uniform float uScatterStrength;
  uniform float uOcclK;
  uniform float uWarmStartY;
  uniform float uWarmRangeY;
  uniform vec3 uUnderglowColor;
  uniform float uUnderglowStrength;
  uniform float uUnderglowStartY;
  uniform float uUnderglowRangeY;
  uniform float uRimInner;
  uniform float uRimOuter;

  varying float vAge01;
  varying float vSeed;
  varying float vIntensity;
  varying float vSoot;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
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
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = p * 2.02 + vec2(7.31, 11.79);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float morphT = smoothstep(0.15, 0.95, vAge01);
    float angle = vSeed * 6.2831853 + vAge01 * 2.4;
    float cs = cos(angle);
    float sn = sin(angle);
    mat2 rot = mat2(cs, -sn, sn, cs);
    vec2 q = rot * p;
    q.x *= mix(1.0, 1.35, morphT);
    q.y *= mix(1.0, 0.78, morphT);
    float radius = length(q);
    float shellNoise = noise(q * 2.8 + vec2(vSeed * 23.1, -uTime * 0.08 + vAge01 * 2.0));
    float shell = radius + (shellNoise - 0.5) * (0.16 + morphT * 0.34);
    float edgeMask = 1.0 - smoothstep(0.62, 1.0, shell);
    if (edgeMask <= 0.001) {
      discard;
    }

    vec2 baseUv = q * (2.1 + vIntensity * 0.45);
    vec2 flowUv = baseUv + vec2(vSeed * 7.13, uTime * 0.06 + vAge01 * 1.7);
    vec2 warp = vec2(
      noise(flowUv + vec2(4.2, 1.1)),
      noise(flowUv * 1.3 + vec2(8.7, 3.5))
    );
    vec2 warpedUv = baseUv + (warp - 0.5) * 0.45;

    // Multi-scale density gives billowy interior and layered folds.
    float low = fbm(warpedUv + vec2(vSeed * 11.3, -uTime * 0.18));
    float high = fbm(warpedUv * 1.8 + vec2(2.1 + vSeed * 5.7, uTime * 0.23));
    float billow = mix(low, high, 0.36);
    float core = smoothstep(0.28, 0.96, billow);
    float coreEnvelope = 1.0 - smoothstep(0.22, 1.02, shell);
    float edgeNoise = noise(baseUv * 1.7 + vec2(vSeed * 19.3, -uTime * 0.09));
    float erosionNoise = noise(warpedUv * 2.35 + vec2(3.2, vSeed * 13.7 + uTime * 0.11));
    float edgeBreakup = smoothstep(0.22, 0.9, edgeNoise + (1.0 - shell) * 1.06);
    float erosion = smoothstep(0.25, 0.95, erosionNoise + (1.0 - morphT) * 0.15);
    float rho =
      clamp(
        edgeMask *
          edgeBreakup *
          erosion *
          mix(0.42, 1.0, core) *
          mix(0.52, 1.25, coreEnvelope) *
          (0.94 + (1.0 - vAge01) * 0.2),
        0.0,
        1.0
      );

    float expansion01 = pow(vAge01, 0.84);
    float spreadDilution = mix(1.0, 0.07, expansion01);
    float thickness =
      rho *
      mix(uThinThickness, uThickThickness, pow(vIntensity, 0.72)) *
      mix(0.95, 1.26, 1.0 - vAge01) *
      mix(0.72, 1.0, coreEnvelope) *
      spreadDilution;
    float fadeIn = smoothstep(0.0, 0.08, vAge01);

    // Beer-Lambert alpha approximation for near-opaque cores.
    float sigmaT = uBaseSigma * mix(0.24, 1.55, pow(vIntensity, 0.7)) * fadeIn;
    float alpha = 1.0 - exp(-sigmaT * thickness);
    alpha *= mix(0.44, 0.88, sqrt(vIntensity));
    alpha *= 0.92;
    alpha *= fadeIn;
    // Keep the source dense, then let late plumes thin mainly because they have expanded.
    alpha *= mix(1.18, 0.16, expansion01);
    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha < 0.006) {
      discard;
    }

    float heightT = clamp((vWorldPos.y - uWarmStartY) / max(0.001, uWarmRangeY), 0.0, 1.0);
    heightT = clamp(max(heightT, vAge01 * 0.82), 0.0, 1.0);
    vec3 color = mix(uWarmCol, uCoolCol, heightT);
    float warmBoost = (1.0 - heightT) * (1.0 - vAge01) * (0.55 + 0.85 * vIntensity);
    color += uWarmStainCol * (warmBoost * 0.4);
    float underglowEndY = uUnderglowStartY + max(0.001, uUnderglowRangeY);
    float underglowHeight = 1.0 - smoothstep(uUnderglowStartY, underglowEndY, vWorldPos.y);
    float underglowAge = 1.0 - smoothstep(0.45, 0.95, vAge01);
    float underglow =
      uUnderglowStrength *
      underglowHeight *
      underglowAge *
      (0.4 + 0.6 * vIntensity) *
      (0.5 + 0.5 * (1.0 - vSoot));
    color += uUnderglowColor * underglow;

    float sootPocket = smoothstep(0.56, 0.92, billow + edgeNoise * 0.28);
    float sootMix = vSoot * sootPocket * (0.2 + coreEnvelope * 0.48);
    float sootDark = exp(-(0.5 + mix(0.22, 0.8, vSoot)) * thickness * 0.24);
    color *= mix(1.0, 0.78, sootMix);
    color *= mix(1.0, sootDark, 0.82);
    // Keep core lift subtle so dense plumes stay weighty instead of chalky.
    float coreLift = (0.03 + 0.07 * vIntensity) * pow(coreEnvelope, 0.75) * (0.5 + 0.5 * (1.0 - vSoot));
    color += vec3(coreLift);

    // Fake backlit edge scattering: brighter near sprite rim when sun is behind view.
    float backlight = clamp(dot(normalize(vViewDir), -normalize(uSunDir)), 0.0, 1.0);
    float rim = smoothstep(uRimInner, uRimOuter, shell);
    color += uSunTint * (backlight * rim * uScatterStrength * (1.0 - rho));

    // Interior self-occlusion keeps core denser/darker.
    color *= exp(-uOcclK * thickness * mix(0.3, 0.66, coreEnvelope));
    float heightFade = mix(1.04, 0.58, smoothstep(0.05, 0.95, heightT));
    color *= heightFade;
    alpha *= mix(1.06, 0.5, smoothstep(0.08, 1.0, heightT));

    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

export type SmokeShaderMaterialOptions = {
  pointScale?: number;
  warmColor?: THREE.ColorRepresentation;
  coolColor?: THREE.ColorRepresentation;
  warmStainColor?: THREE.ColorRepresentation;
  underglowColor?: THREE.ColorRepresentation;
  underglowStrength?: number;
  underglowStartY?: number;
  underglowRangeY?: number;
  sunDirection?: THREE.Vector3;
  sunTint?: THREE.ColorRepresentation;
  baseSigma?: number;
  thinThickness?: number;
  thickThickness?: number;
  scatterStrength?: number;
  occlusionStrength?: number;
  warmStartY?: number;
  warmRangeY?: number;
  rimInner?: number;
  rimOuter?: number;
};

const toColor = (value: THREE.ColorRepresentation | undefined, fallback: THREE.ColorRepresentation): THREE.Color =>
  new THREE.Color(value ?? fallback);

export const createSmokeShaderMaterial = (options: SmokeShaderMaterialOptions = {}): THREE.ShaderMaterial => {
  const sunDirection = (options.sunDirection ?? new THREE.Vector3(0.65, 0.7, 0.25)).clone().normalize();
  return new THREE.ShaderMaterial({
    vertexShader: smokeVertexShader,
    fragmentShader: smokeFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPointScale: { value: options.pointScale ?? 180 },
      uZoomScale: { value: 1 },
      uWarmCol: { value: toColor(options.warmColor, new THREE.Color(0.49, 0.36, 0.26)) },
      uCoolCol: { value: toColor(options.coolColor, new THREE.Color(0.56, 0.6, 0.66)) },
      uWarmStainCol: { value: toColor(options.warmStainColor, new THREE.Color(0.36, 0.18, 0.07)) },
      uUnderglowColor: { value: toColor(options.underglowColor, new THREE.Color(1.0, 0.45, 0.16)) },
      uUnderglowStrength: { value: options.underglowStrength ?? 0 },
      uUnderglowStartY: { value: options.underglowStartY ?? 0 },
      uUnderglowRangeY: { value: options.underglowRangeY ?? 8.0 },
      uSunDir: { value: sunDirection },
      uSunTint: { value: toColor(options.sunTint, new THREE.Color(0.97, 0.9, 0.82)) },
      uBaseSigma: { value: options.baseSigma ?? 3.15 },
      uThinThickness: { value: options.thinThickness ?? 0.9 },
      uThickThickness: { value: options.thickThickness ?? 1.95 },
      uScatterStrength: { value: options.scatterStrength ?? 0.32 },
      uOcclK: { value: options.occlusionStrength ?? 0.62 },
      uWarmStartY: { value: options.warmStartY ?? 0 },
      uWarmRangeY: { value: options.warmRangeY ?? 7.5 },
      uRimInner: { value: options.rimInner ?? 0.56 },
      uRimOuter: { value: options.rimOuter ?? 0.97 }
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
};

/**
 * Draws all non-fire particle effects (smoke, water).
 */
/**
 * @deprecated Legacy 2D renderer. Prefer the 3D render backend.
 */
export const drawParticles = (state: WorldState, effects: EffectsState, ctx: CanvasRenderingContext2D) => {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  // Draw smoke particles
  effects.smokeParticles.forEach((particle) => {
    const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
    const rise = (1 - particle.alpha) * TILE_SIZE * 5;
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
    const alpha = clamp(particle.alpha * 0.95, 0, 0.95);
    const radius = particle.size * 0.7;
    if (
      pos.x + radius < 0 ||
      pos.x - radius > canvasWidth ||
      pos.y + radius < 0 ||
      pos.y - radius > canvasHeight
    ) {
      return;
    }
    ctx.fillStyle = `rgba(85, 85, 85, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (alpha > 0.1) {
      ctx.fillStyle = `rgba(55, 55, 55, ${alpha * 0.45})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Draw water particles
  ctx.fillStyle = WATER_PARTICLE_COLOR;
  const originalAlpha = ctx.globalAlpha;
  effects.waterParticles.forEach((particle) => {
    const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
    const half = particle.size * 0.5;
    if (
      pos.x + half < 0 ||
      pos.x - half > canvasWidth ||
      pos.y + half < 0 ||
      pos.y - half > canvasHeight
    ) {
      return;
    }
    ctx.globalAlpha = clamp(particle.alpha, 0, 1);
    ctx.fillRect(pos.x - half, pos.y - half, particle.size, particle.size);
  });
  ctx.globalAlpha = originalAlpha;
};
