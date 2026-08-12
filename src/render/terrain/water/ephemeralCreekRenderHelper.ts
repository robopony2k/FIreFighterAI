import * as THREE from "three";
import type { RiverWaterData } from "./riverMeshData.js";
import { resolveEphemeralCreekWetness } from "./ephemeralCreekRibbonMesh.js";

type EphemeralCreekUniforms = {
  u_shallowColor: { value: THREE.Color };
  u_dampColor: { value: THREE.Color };
  u_wetness: { value: number };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
};

export class EphemeralCreekRenderHelper {
  private readonly scene: THREE.Scene;
  private mesh: THREE.Mesh | null = null;
  private uniforms: EphemeralCreekUniforms | null = null;
  private shallowColor = new THREE.Color(0x477f9a);
  private fogColor = new THREE.Color(0x8ea0a6);
  private fogNear = 180;
  private fogFar = 900;
  private wetness = 1;
  private visible = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public setPalette(shallowColor: THREE.ColorRepresentation): void {
    this.shallowColor.set(shallowColor);
    this.uniforms?.u_shallowColor.value.copy(this.shallowColor);
  }

  public setFog(color: THREE.ColorRepresentation, near: number, far: number): void {
    this.fogColor.set(color);
    this.fogNear = near;
    this.fogFar = far;
    if (!this.uniforms) return;
    this.uniforms.u_fogColor.value.copy(this.fogColor);
    this.uniforms.u_fogNear.value = near;
    this.uniforms.u_fogFar.value = far;
  }

  public setSeasonT01(seasonT01: number): void {
    this.wetness = resolveEphemeralCreekWetness(seasonT01);
    if (this.uniforms) this.uniforms.u_wetness.value = this.wetness;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.mesh) this.mesh.visible = visible;
  }

  public clear(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
    this.mesh = null;
    this.uniforms = null;
  }

  public rebuild(baseMesh: THREE.Mesh, river: RiverWaterData): void {
    this.clear();
    if (
      !river.ephemeralPositions ||
      !river.ephemeralEdgeFactor ||
      !river.ephemeralOpacityFactor ||
      !river.ephemeralIndices
    ) return;
    if (river.ephemeralIndices.length < 3) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(river.ephemeralPositions, 3));
    geometry.setAttribute("a_edgeFactor", new THREE.BufferAttribute(river.ephemeralEdgeFactor, 1));
    geometry.setAttribute("a_opacityFactor", new THREE.BufferAttribute(river.ephemeralOpacityFactor, 1));
    geometry.setIndex(new THREE.BufferAttribute(river.ephemeralIndices, 1));
    this.uniforms = {
      u_shallowColor: { value: this.shallowColor.clone() },
      u_dampColor: { value: new THREE.Color(0x3d5140) },
      u_wetness: { value: this.wetness },
      u_fogColor: { value: this.fogColor.clone() },
      u_fogNear: { value: this.fogNear },
      u_fogFar: { value: this.fogFar }
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      vertexShader: `
        attribute float a_edgeFactor;
        attribute float a_opacityFactor;
        varying float vEdgeFactor;
        varying float vOpacityFactor;
        varying vec3 vWorldPos;
        void main() {
          vEdgeFactor = a_edgeFactor;
          vOpacityFactor = a_opacityFactor;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying float vEdgeFactor;
        varying float vOpacityFactor;
        varying vec3 vWorldPos;
        uniform vec3 u_shallowColor;
        uniform vec3 u_dampColor;
        uniform float u_wetness;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
        void main() {
          float core = 1.0 - smoothstep(0.18, 0.92, clamp(vEdgeFactor, 0.0, 1.0));
          float margin = 1.0 - smoothstep(0.78, 1.0, clamp(vEdgeFactor, 0.0, 1.0));
          float waterMix = core * u_wetness;
          vec3 color = mix(u_dampColor, u_shallowColor, waterMix * 0.82);
          float opacity = mix(0.08, 0.68, u_wetness) * mix(0.32, 1.0, core) * margin * vOpacityFactor;
          float viewDistance = length(cameraPosition - vWorldPos);
          float fog = pow(smoothstep(u_fogNear, u_fogFar, viewDistance), 1.15);
          color = mix(color, u_fogColor, fog);
          if (opacity < 0.012) discard;
          gl_FragColor = vec4(color, opacity);
        }
      `
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(baseMesh.position);
    // Roads use render order 2. Keep traversable creek staining beneath road
    // decks where both legitimately follow the same valley contour.
    this.mesh.renderOrder = 1;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = this.visible;
    this.scene.add(this.mesh);
  }

  public dispose(): void {
    this.clear();
  }
}
