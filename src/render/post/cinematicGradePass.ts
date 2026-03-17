import * as THREE from "three";
import { createFullscreenPass, fullscreenVertexShader, type FullscreenPass } from "./fullscreenPass.js";

export type ThreeTestCinematicGradeConfig = {
  contrast: number;
  midtoneDesaturation: number;
  vignetteStrength: number;
  vignetteSoftness: number;
  warmHighlightStrength: number;
  heightHazeStrength: number;
  heightHazeHorizon: number;
  heightHazeCurve: number;
  fogColor: THREE.ColorRepresentation;
};

export type ThreeTestCinematicGradePass = {
  resize: (width: number, height: number) => void;
  render: (renderer: THREE.WebGLRenderer, inputTexture: THREE.Texture, target: THREE.WebGLRenderTarget | null) => void;
  setEnabled: (enabled: boolean) => void;
  setFogColor: (color: THREE.ColorRepresentation) => void;
  setHeightHazeStrength: (value: number) => void;
  setSunGlare: (
    x: number,
    y: number,
    intensity: number,
    color?: THREE.ColorRepresentation
  ) => void;
  dispose: () => void;
};

const fullscreenFragmentShader = `
  uniform sampler2D uSceneTex;
  uniform vec3 uFogColor;
  uniform float uContrast;
  uniform float uMidtoneDesaturation;
  uniform float uVignetteStrength;
  uniform float uVignetteSoftness;
  uniform float uWarmHighlightStrength;
  uniform float uHeightHazeStrength;
  uniform float uHeightHazeHorizon;
  uniform float uHeightHazeCurve;
  uniform vec2 uSunGlareCenter;
  uniform vec3 uSunGlareColor;
  uniform float uSunGlareIntensity;
  uniform float uViewportAspect;
  uniform float uGradeEnabled;

  varying vec2 vUv;

  float luma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 src = texture2D(uSceneTex, vUv);
    vec3 color = src.rgb;

    if (uGradeEnabled > 0.5) {
      color = (color - 0.5) * uContrast + 0.5;

      float y = luma(color);
      float midtoneMask = max(0.0, 1.0 - abs(y * 2.0 - 1.0));
      color = mix(color, vec3(y), uMidtoneDesaturation * midtoneMask);

      float highlight = smoothstep(0.66, 1.0, y);
      color += vec3(1.0, 0.48, 0.2) * (highlight * uWarmHighlightStrength);

      float topHaze = smoothstep(uHeightHazeHorizon, 1.0, vUv.y);
      float haze = pow(clamp(topHaze, 0.0, 1.0), max(0.01, uHeightHazeCurve)) * uHeightHazeStrength;
      color = mix(color, uFogColor, clamp(haze, 0.0, 1.0));

      vec2 glareDelta = vUv - uSunGlareCenter;
      glareDelta.x *= max(0.001, uViewportAspect);
      float glareDistance = length(glareDelta);
      float glareCore = exp(-glareDistance * glareDistance * 38.0);
      float glareHalo = pow(max(1.0 - glareDistance * 1.7, 0.0), 4.0);
      float glareSweep = pow(max(1.0 - abs(glareDelta.y) * 4.4, 0.0), 6.0) * pow(max(1.0 - glareDistance * 1.08, 0.0), 3.0);
      float glare = (glareCore * 0.58 + glareHalo * 0.28 + glareSweep * 0.14) * clamp(uSunGlareIntensity, 0.0, 1.0);
      color += uSunGlareColor * glare;

      vec2 centeredUv = vUv * 2.0 - 1.0;
      float edge = smoothstep(uVignetteSoftness, 1.2, length(centeredUv));
      color *= 1.0 - edge * uVignetteStrength;
    }

    gl_FragColor = vec4(max(color, vec3(0.0)), src.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const createThreeTestCinematicGradePass = (
  config: ThreeTestCinematicGradeConfig
): ThreeTestCinematicGradePass => {
  const uniforms = {
    uSceneTex: { value: null as THREE.Texture | null },
    uFogColor: { value: new THREE.Color(config.fogColor) },
    uContrast: { value: config.contrast },
    uMidtoneDesaturation: { value: config.midtoneDesaturation },
    uVignetteStrength: { value: config.vignetteStrength },
    uVignetteSoftness: { value: config.vignetteSoftness },
    uWarmHighlightStrength: { value: config.warmHighlightStrength },
    uHeightHazeStrength: { value: config.heightHazeStrength },
    uHeightHazeHorizon: { value: config.heightHazeHorizon },
    uHeightHazeCurve: { value: config.heightHazeCurve },
    uSunGlareCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uSunGlareColor: { value: new THREE.Color(1.0, 0.88, 0.68) },
    uSunGlareIntensity: { value: 0 },
    uViewportAspect: { value: 1 },
    uGradeEnabled: { value: 1 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: fullscreenFragmentShader,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  });
  const pass: FullscreenPass = createFullscreenPass(material);

  return {
    resize: (width, height) => {
      uniforms.uViewportAspect.value = Math.max(1, width) / Math.max(1, height);
    },
    render: (renderer, inputTexture, target) => {
      uniforms.uSceneTex.value = inputTexture;
      pass.render(renderer, target);
    },
    setEnabled: (enabled) => {
      uniforms.uGradeEnabled.value = enabled ? 1 : 0;
    },
    setFogColor: (color) => {
      uniforms.uFogColor.value.set(color);
    },
    setHeightHazeStrength: (value) => {
      uniforms.uHeightHazeStrength.value = Math.max(0, value);
    },
    setSunGlare: (x, y, intensity, color = 0xffe0ad) => {
      uniforms.uSunGlareCenter.value.set(x, y);
      uniforms.uSunGlareIntensity.value = Math.max(0, intensity);
      uniforms.uSunGlareColor.value.set(color);
    },
    dispose: () => {
      pass.dispose();
    }
  };
};
