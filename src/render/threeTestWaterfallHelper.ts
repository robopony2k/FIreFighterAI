import * as THREE from "three";

const WATERFALL_INSTANCE_STRIDE = 7;

type WaterfallUniforms = {
  u_time: { value: number };
  u_color: { value: THREE.Color };
  u_opacity: { value: number };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
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
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
};

type WaterfallFog = {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
};

export class ThreeTestWaterfallHelper {
  private readonly scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private uniforms: WaterfallUniforms | null = null;
  private fogState: {
    color: THREE.Color;
    near: number;
    far: number;
  };

  constructor(options: ThreeTestWaterfallHelperOptions) {
    this.scene = options.scene;
    this.fogState = {
      color: new THREE.Color(options.fogColor),
      near: options.fogNear,
      far: options.fogFar
    };
  }

  public setQuality(qualityUniform: number): void {
    if (this.uniforms) {
      this.uniforms.u_quality.value = qualityUniform;
    }
    if (this.mesh) {
      this.mesh.visible = qualityUniform > 0.5;
    }
  }

  public setFog(fog: WaterfallFog): void {
    this.fogState.color.set(fog.color);
    this.fogState.near = fog.near;
    this.fogState.far = fog.far;
    if (!this.uniforms) {
      return;
    }
    this.uniforms.u_fogColor.value.copy(this.fogState.color);
    this.uniforms.u_fogNear.value = this.fogState.near;
    this.uniforms.u_fogFar.value = this.fogState.far;
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
      u_fogColor: { value: this.fogState.color.clone() },
      u_fogNear: { value: this.fogState.near },
      u_fogFar: { value: this.fogState.far },
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
        varying vec3 vWorldPos;
        attribute float aDropNorm;
        void main() {
          vUv = uv;
          vDropNorm = aDropNorm;
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vDropNorm;
        varying vec3 vWorldPos;
        uniform float u_time;
        uniform vec3 u_color;
        uniform float u_opacity;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
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
          float viewDist = length(cameraPosition - vWorldPos);
          float fogFactor = pow(smoothstep(u_fogNear, u_fogFar, viewDist), 1.1);
          color = mix(color, u_fogColor, fogFactor);
          alpha = mix(alpha, 1.0, fogFactor * 0.2);
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
      const forwardOffset = Math.max(0.05, Math.min(0.46, halfWidth * 0.26 + drop * 0.11));
      const pitch = Math.atan2(Math.max(0.04, drop * 0.42), Math.max(0.2, halfWidth * 1.3));
      dummy.position.set(
        x + dirX * forwardOffset,
        top - drop * 0.5 + 0.016,
        z + dirZ * forwardOffset
      );
      dummy.rotation.set(-pitch * 0.32, yaw, 0);
      dummy.scale.set(halfWidth * 2.0, drop, 1.12);
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
