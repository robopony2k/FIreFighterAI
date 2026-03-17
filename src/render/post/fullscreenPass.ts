import * as THREE from "three";

export const fullscreenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export type FullscreenPass = {
  material: THREE.ShaderMaterial;
  render: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) => void;
  dispose: () => void;
};

export const createFullscreenPass = (material: THREE.ShaderMaterial): FullscreenPass => {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    material,
    render: (renderer, target) => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
