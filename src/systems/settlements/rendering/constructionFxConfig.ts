export type ConstructionStageProfile = {
  spawnRate: number;
  soundIntervalMs: number;
  dustAlpha: number;
  dustSize: number;
  spread: number;
  rise: number;
  soundGain: number;
};

export const MAX_CONSTRUCTION_DUST_PARTICLES = 220;
export const MAX_CONSTRUCTION_DUST_SPAWNS_PER_FRAME = 18;

export const CONSTRUCTION_STAGE_PROFILES: Record<"site_prep" | "frame" | "enclosed", ConstructionStageProfile> = {
  site_prep: {
    spawnRate: 9.5,
    soundIntervalMs: 2100,
    dustAlpha: 0.5,
    dustSize: 0.3,
    spread: 0.62,
    rise: 0.2,
    soundGain: 1
  },
  frame: {
    spawnRate: 5.2,
    soundIntervalMs: 2700,
    dustAlpha: 0.35,
    dustSize: 0.24,
    spread: 0.48,
    rise: 0.3,
    soundGain: 0.72
  },
  enclosed: {
    spawnRate: 2.9,
    soundIntervalMs: 3600,
    dustAlpha: 0.22,
    dustSize: 0.18,
    spread: 0.34,
    rise: 0.24,
    soundGain: 0.46
  }
};

export const constructionDustVertexShader = `
attribute float aAge01;
attribute float aAlpha;
attribute float aSeed;
attribute float aSize;
varying float vAge01;
varying float vAlpha;
varying float vSeed;
void main() {
  vAge01 = aAge01;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float perspectiveScale = clamp(130.0 / max(1.0, -mvPosition.z), 0.42, 5.2);
  gl_PointSize = max(2.0, aSize * perspectiveScale);
}`;

export const constructionDustFragmentShader = `
varying float vAge01;
varying float vAlpha;
varying float vSeed;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 31.9) * 43758.5453);
}
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  float soft = smoothstep(0.5, 0.08, d);
  float grain = mix(0.78, 1.08, hash(gl_PointCoord * 17.0));
  float fade = pow(max(0.0, 1.0 - vAge01), 1.35);
  float alpha = vAlpha * soft * fade * grain;
  if (alpha <= 0.01) {
    discard;
  }
  vec3 color = mix(vec3(0.54, 0.47, 0.37), vec3(0.82, 0.74, 0.61), 1.0 - vAge01);
  gl_FragColor = vec4(color, alpha);
}`;
