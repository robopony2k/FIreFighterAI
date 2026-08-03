import * as THREE from "three";
import {
  mdXyzxReferenceFragmentShader,
  mdXyzxReferenceVertexShader,
  normalizeMdXyzxReferenceMode,
  type MdXyzxReferenceMode
} from "../water/ocean/mdXyzxReferenceShader.js";

export type FxLabOceanReferenceComparison = {
  setMode: (mode: MdXyzxReferenceMode) => void;
  getMode: () => MdXyzxReferenceMode;
  update: (
    camera: THREE.PerspectiveCamera,
    timeSeconds: number,
    waterLevel: number,
    sunDirection: THREE.Vector3
  ) => void;
  render: (
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    renderGame: () => void
  ) => void;
  dispose: () => void;
};

const configureComparisonTarget = (target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget => {
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  target.texture.name = "fx-lab-mdxyzx-game-reference";
  return target;
};

export const createFxLabOceanReferenceComparison = (): FxLabOceanReferenceComparison => {
  const uniforms = {
    u_gameTexture: { value: null as THREE.Texture | null },
    u_time: { value: 0 },
    u_mode: { value: 0 },
    u_waterLevel: { value: 0 },
    u_waterDepth: { value: 1 },
    u_cameraPosition: { value: new THREE.Vector3() },
    u_sunDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
    u_projectionInverse: { value: new THREE.Matrix4() },
    u_cameraWorldMatrix: { value: new THREE.Matrix4() }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: mdXyzxReferenceVertexShader,
    fragmentShader: mdXyzxReferenceFragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.Camera();
  overlayScene.add(mesh);
  const drawingBufferSize = new THREE.Vector2();
  let comparisonTarget: THREE.WebGLRenderTarget | null = null;
  let mode: MdXyzxReferenceMode = 0;

  const ensureComparisonTarget = (renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget => {
    renderer.getDrawingBufferSize(drawingBufferSize);
    const width = Math.max(1, Math.floor(drawingBufferSize.x));
    const height = Math.max(1, Math.floor(drawingBufferSize.y));
    if (comparisonTarget?.width === width && comparisonTarget.height === height) {
      return comparisonTarget;
    }
    comparisonTarget?.dispose();
    comparisonTarget = configureComparisonTarget(
      new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false
      })
    );
    return comparisonTarget;
  };

  return {
    setMode: (nextMode) => {
      mode = normalizeMdXyzxReferenceMode(nextMode);
      uniforms.u_mode.value = mode;
    },
    getMode: () => mode,
    update: (camera, timeSeconds, waterLevel, sunDirection) => {
      camera.updateMatrixWorld();
      uniforms.u_time.value = timeSeconds;
      uniforms.u_waterLevel.value = waterLevel;
      uniforms.u_waterDepth.value = 1;
      uniforms.u_cameraPosition.value.copy(camera.position);
      uniforms.u_sunDirection.value.copy(sunDirection).normalize();
      uniforms.u_projectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.u_cameraWorldMatrix.value.copy(camera.matrixWorld);
    },
    render: (renderer, _camera, renderGame) => {
      if (mode === 0) {
        renderGame();
        return;
      }
      const previousTarget = renderer.getRenderTarget();
      if (mode === 2) {
        const target = ensureComparisonTarget(renderer);
        try {
          renderer.setRenderTarget(target);
          renderGame();
          uniforms.u_gameTexture.value = target.texture;
          renderer.setRenderTarget(previousTarget);
          renderer.render(overlayScene, overlayCamera);
        } finally {
          renderer.setRenderTarget(previousTarget);
        }
        return;
      }
      renderer.setRenderTarget(previousTarget);
      renderer.render(overlayScene, overlayCamera);
    },
    dispose: () => {
      comparisonTarget?.dispose();
      comparisonTarget = null;
      mesh.geometry.dispose();
      material.dispose();
    }
  };
};
