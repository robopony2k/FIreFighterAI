import * as THREE from "three";

const WATERFALL_INSTANCE_STRIDE = 7;

type WaterfallUniforms = {
  u_time: { value: number };
  u_color: { value: THREE.Color };
  u_opacity: { value: number };
  u_quality: { value: number };
};

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
};

type ThreeTestWaterfallHelperOptions = {
  scene: THREE.Scene;
};

export class ThreeTestWaterfallHelper {
  private readonly scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private uniforms: WaterfallUniforms | null = null;

  constructor(options: ThreeTestWaterfallHelperOptions) {
    this.scene = options.scene;
  }

  public setQuality(qualityUniform: number): void {
    if (this.uniforms) {
      this.uniforms.u_quality.value = qualityUniform;
    }
    if (this.mesh) {
      this.mesh.visible = qualityUniform > 0.5;
    }
  }

  public update(timeMs: number): void {
    if (this.uniforms) {
      this.uniforms.u_time.value = timeMs * 0.001;
    }
  }

  public clear(): void {
    if (!this.mesh) {
      this.uniforms = null;
      return;
    }
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    disposeMaterial(this.mesh.material);
    this.mesh = null;
    this.uniforms = null;
  }

  public dispose(): void {
    this.clear();
  }

  public rebuild(baseMesh: THREE.Mesh, level: number, instances: Float32Array | undefined, qualityUniform: number): void {
    this.clear();
    if (!instances || instances.length < WATERFALL_INSTANCE_STRIDE) {
      return;
    }
    const waterfallCount = Math.floor(instances.length / WATERFALL_INSTANCE_STRIDE);
    if (waterfallCount <= 0) {
      return;
    }

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const dropNormAttr = new THREE.InstancedBufferAttribute(new Float32Array(waterfallCount), 1);
    geometry.setAttribute("aDropNorm", dropNormAttr);

    this.uniforms = {
      u_time: { value: 0 },
      u_color: { value: new THREE.Color(0xa8ddff) },
      u_opacity: { value: 0.84 },
      u_quality: { value: qualityUniform }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        varying float vDropNorm;
        attribute float aDropNorm;
        void main() {
          vUv = uv;
          vDropNorm = aDropNorm;
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vDropNorm;
        uniform float u_time;
        uniform vec3 u_color;
        uniform float u_opacity;
        uniform float u_quality;
        float hash21(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        void main() {
          float enabled = step(0.5, u_quality);
          float centerBand = 1.0 - smoothstep(0.34, 0.5, abs(vUv.x - 0.5));
          float sideFade = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.94, 1.0, vUv.x));
          float t = u_time * 2.8;
          vec2 pixelUv = floor(vUv * vec2(34.0, 72.0)) / vec2(34.0, 72.0);
          float streamA = sin((pixelUv.y * 22.0 + t * 4.2) + pixelUv.x * 16.0);
          float streamB = cos((pixelUv.y * 34.0 + t * 5.1) - pixelUv.x * 11.0);
          float streak = clamp(streamA * 0.35 + streamB * 0.25 + 0.55, 0.0, 1.0);
          float breakup = hash21(vec2(floor(pixelUv.x * 18.0), floor((pixelUv.y + t * 0.35) * 28.0)));
          float body = (0.42 + streak * 0.58) * mix(0.72, 1.0, breakup);
          float dropBoost = clamp(vDropNorm, 0.0, 1.0);
          float topFoam = smoothstep(0.68, 1.0, vUv.y) * (0.28 + dropBoost * 0.46);
          float plungeZone = 1.0 - smoothstep(0.0, 0.24, vUv.y);
          float splashCells = step(0.57, hash21(vec2(floor(pixelUv.x * 24.0), floor((pixelUv.y + t * 0.55) * 14.0))));
          float bottomFoam = plungeZone * (0.58 + 0.42 * streak) * (0.74 + dropBoost * 0.58) * mix(0.82, 1.18, splashCells);
          float mistPulse = 0.72 + 0.28 * sin(t * 2.3 + vUv.x * 18.0);
          float mist = (1.0 - smoothstep(0.0, 0.16, vUv.y)) * mistPulse * (0.8 + dropBoost * 0.75);
          vec3 pseudoN = normalize(vec3((vUv.x - 0.5) * 2.15 + (streak - 0.5) * 0.4, 1.0, (streak - 0.5) * 1.3));
          vec3 lightDir = normalize(vec3(-0.35, 0.86, 0.37));
          float diffuse = 0.58 + 0.42 * max(dot(pseudoN, lightDir), 0.0);
          float rim = pow(1.0 - clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0), 2.0);
          float sparkle = pow(max(dot(reflect(-lightDir, pseudoN), vec3(0.0, 0.0, 1.0)), 0.0), 14.0) * (0.2 + dropBoost * 0.4);
          float alpha = u_opacity * enabled * centerBand * sideFade * (body * 0.62 + bottomFoam * 0.84 + topFoam * 0.31);
          if (alpha < 0.03) discard;
          vec3 foamColor = vec3(0.93, 0.97, 1.0);
          float foamMix = clamp(bottomFoam * 0.92 + mist * 0.48 + topFoam * 0.4 + plungeZone * splashCells * 0.32, 0.0, 1.0);
          vec3 color = mix(u_color, foamColor, foamMix);
          color *= diffuse * (0.92 + rim * 0.2);
          color += foamColor * sparkle;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, waterfallCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * WATERFALL_INSTANCE_STRIDE;
      const x = instances[base];
      const z = instances[base + 1];
      const top = instances[base + 2];
      const drop = Math.max(0.1, instances[base + 3]);
      const dirX = instances[base + 4];
      const dirZ = instances[base + 5];
      const halfWidth = Math.max(0.08, instances[base + 6]);
      const yaw = Math.atan2(dirX, dirZ);
      dummy.position.set(x, top - drop * 0.5, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(halfWidth * 2.0, drop, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      dropNormAttr.setX(i, Math.min(1, drop / 1.6));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    dropNormAttr.needsUpdate = true;
    this.mesh.position.y = baseMesh.position.y + level;
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.visible = qualityUniform > 0.5;
    this.scene.add(this.mesh);
  }
}
