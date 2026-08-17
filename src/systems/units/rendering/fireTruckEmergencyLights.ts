import * as THREE from "three";
import type { FireActivityState } from "../../../core/state.js";
import type { SimTimeMode } from "../../../core/types.js";

const FLASH_CYCLE_SECONDS = 0.8;
const FLASH_HALF_WIDTH = 0.055;
const BLUE_FLASH_CENTRES = [0.08, 0.24] as const;
const RED_FLASH_CENTRES = [0.58, 0.74] as const;
const LIGHT_BAR_GROUND_CLEARANCE = 0.05;
const LIGHT_BAR_ROOF_HEIGHT = 0.265;
const LIGHT_BAR_FORWARD_OFFSET = 0.22;
const LIGHT_BAR_SIDE_OFFSET = 0.05;
const LIGHT_BAR_LENS_LIFT = 0.016;
const LIGHT_BAR_GLOW_LIFT = 0.008;
const LIGHT_BAR_BASE_LENGTH = 0.18;
const LIGHT_BAR_BASE_HEIGHT = 0.012;
const LIGHT_BAR_BASE_DEPTH = 0.04;
const LIGHT_BAR_LENS_LENGTH = 0.072;
const LIGHT_BAR_LENS_HEIGHT = 0.018;
const LIGHT_BAR_LENS_DEPTH = 0.032;
const LIGHT_BAR_GLOW_MIN_RADIUS = 0.012;
const LIGHT_BAR_GLOW_RADIUS_RANGE = 0.024;
const OFF_EMISSIVE_INTENSITY = 0.12;
const ACTIVE_EMISSIVE_INTENSITY = 7.5;

const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

export type FireTruckEmergencyLightFlashState = {
  blueIntensity: number;
  redIntensity: number;
};

export type FireTruckEmergencyLightContext = {
  simTimeMode: SimTimeMode;
  fireActivityState: FireActivityState;
};

export type FireTruckEmergencyLightPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  normalX: number;
  normalY: number;
  normalZ: number;
};

export type FireTruckEmergencyLightLayer = {
  update: (poses: readonly FireTruckEmergencyLightPose[], timeSeconds: number) => void;
  dispose: () => void;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const resolveFlashPulse = (phase: number, centre: number): number => {
  const distance = Math.abs(phase - centre);
  const linear = clamp01(1 - distance / FLASH_HALF_WIDTH);
  return linear * linear * (3 - 2 * linear);
};

export const shouldActivateFireTruckEmergencyLights = (
  context: FireTruckEmergencyLightContext
): boolean => context.simTimeMode === "incident" && context.fireActivityState === "burning";

export const resolveFireTruckEmergencyLightFlashState = (
  timeSeconds: number
): FireTruckEmergencyLightFlashState => {
  const normalizedTime = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  const phase = (normalizedTime % FLASH_CYCLE_SECONDS) / FLASH_CYCLE_SECONDS;
  return {
    blueIntensity: Math.max(...BLUE_FLASH_CENTRES.map((centre) => resolveFlashPulse(phase, centre))),
    redIntensity: Math.max(...RED_FLASH_CENTRES.map((centre) => resolveFlashPulse(phase, centre)))
  };
};

const configureInstancedMesh = (mesh: THREE.InstancedMesh, name: string): void => {
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.name = name;
};

export const createFireTruckEmergencyLightLayer = (
  scene: THREE.Scene,
  maxInstances: number
): FireTruckEmergencyLightLayer => {
  const instanceCapacity = Math.max(1, Math.floor(maxInstances));
  const baseGeometry = new THREE.BoxGeometry(
    LIGHT_BAR_BASE_LENGTH,
    LIGHT_BAR_BASE_HEIGHT,
    LIGHT_BAR_BASE_DEPTH
  );
  const lensGeometry = new THREE.BoxGeometry(
    LIGHT_BAR_LENS_LENGTH,
    LIGHT_BAR_LENS_HEIGHT,
    LIGHT_BAR_LENS_DEPTH
  );
  const glowGeometry = new THREE.SphereGeometry(1, 10, 7);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x11161d,
    roughness: 0.48,
    metalness: 0.28
  });
  const blueLensMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b3d91,
    emissive: 0x168cff,
    emissiveIntensity: OFF_EMISSIVE_INTENSITY,
    roughness: 0.25,
    metalness: 0.04
  });
  const redLensMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c1018,
    emissive: 0xff2638,
    emissiveIntensity: OFF_EMISSIVE_INTENSITY,
    roughness: 0.25,
    metalness: 0.04
  });
  const blueGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x2c9fff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const redGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3348,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });

  const baseMesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, instanceCapacity);
  const blueLensMesh = new THREE.InstancedMesh(lensGeometry, blueLensMaterial, instanceCapacity);
  const redLensMesh = new THREE.InstancedMesh(lensGeometry, redLensMaterial, instanceCapacity);
  const blueGlowMesh = new THREE.InstancedMesh(glowGeometry, blueGlowMaterial, instanceCapacity);
  const redGlowMesh = new THREE.InstancedMesh(glowGeometry, redGlowMaterial, instanceCapacity);
  configureInstancedMesh(baseMesh, "firetruck-emergency-light-bar-base");
  configureInstancedMesh(blueLensMesh, "firetruck-emergency-light-blue-lens");
  configureInstancedMesh(redLensMesh, "firetruck-emergency-light-red-lens");
  configureInstancedMesh(blueGlowMesh, "firetruck-emergency-light-blue-glow");
  configureInstancedMesh(redGlowMesh, "firetruck-emergency-light-red-glow");
  scene.add(baseMesh, blueLensMesh, redLensMesh, blueGlowMesh, redGlowMesh);

  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const roofCentre = new THREE.Vector3();
  const lensPosition = new THREE.Vector3();
  const glowPosition = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const glowScale = new THREE.Vector3();

  const writePoseBasis = (pose: FireTruckEmergencyLightPose): void => {
    normal.set(pose.normalX, pose.normalY, pose.normalZ).normalize();
    if (normal.lengthSq() <= 1e-8) {
      normal.set(0, 1, 0);
    }
    forward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
    forward.addScaledVector(normal, -forward.dot(normal));
    if (forward.lengthSq() <= 1e-8) {
      forward.copy(WORLD_FORWARD).addScaledVector(normal, -WORLD_FORWARD.dot(normal));
    }
    forward.normalize();
    right.crossVectors(normal, forward).normalize();
    forward.crossVectors(right, normal).normalize();
    basis.makeBasis(right, normal, forward);
    quaternion.setFromRotationMatrix(basis);
    roofCentre
      .set(pose.x, pose.y + LIGHT_BAR_GROUND_CLEARANCE, pose.z)
      .addScaledVector(normal, LIGHT_BAR_ROOF_HEIGHT)
      .addScaledVector(forward, LIGHT_BAR_FORWARD_OFFSET);
  };

  const writeLensAndGlow = (
    index: number,
    side: number,
    intensity: number,
    lensMesh: THREE.InstancedMesh,
    glowMesh: THREE.InstancedMesh
  ): void => {
    lensPosition
      .copy(roofCentre)
      .addScaledVector(right, LIGHT_BAR_SIDE_OFFSET * side)
      .addScaledVector(normal, LIGHT_BAR_LENS_LIFT);
    matrix.compose(lensPosition, quaternion, unitScale);
    lensMesh.setMatrixAt(index, matrix);

    glowPosition.copy(lensPosition).addScaledVector(normal, LIGHT_BAR_GLOW_LIFT);
    glowScale.setScalar(LIGHT_BAR_GLOW_MIN_RADIUS + LIGHT_BAR_GLOW_RADIUS_RANGE * intensity);
    matrix.compose(glowPosition, quaternion, glowScale);
    glowMesh.setMatrixAt(index, matrix);
  };

  const update = (poses: readonly FireTruckEmergencyLightPose[], timeSeconds: number): void => {
    const count = Math.min(instanceCapacity, poses.length);
    const flash = resolveFireTruckEmergencyLightFlashState(timeSeconds);
    blueLensMaterial.emissiveIntensity = OFF_EMISSIVE_INTENSITY + ACTIVE_EMISSIVE_INTENSITY * flash.blueIntensity;
    redLensMaterial.emissiveIntensity = OFF_EMISSIVE_INTENSITY + ACTIVE_EMISSIVE_INTENSITY * flash.redIntensity;
    blueGlowMaterial.opacity = 0.74 * flash.blueIntensity;
    redGlowMaterial.opacity = 0.74 * flash.redIntensity;
    blueGlowMesh.visible = count > 0 && flash.blueIntensity > 0.01;
    redGlowMesh.visible = count > 0 && flash.redIntensity > 0.01;

    for (let index = 0; index < count; index += 1) {
      writePoseBasis(poses[index]!);
      matrix.compose(roofCentre, quaternion, unitScale);
      baseMesh.setMatrixAt(index, matrix);
      writeLensAndGlow(index, -1, flash.blueIntensity, blueLensMesh, blueGlowMesh);
      writeLensAndGlow(index, 1, flash.redIntensity, redLensMesh, redGlowMesh);
    }

    [baseMesh, blueLensMesh, redLensMesh, blueGlowMesh, redGlowMesh].forEach((mesh) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = count > 0;
    });
  };

  const dispose = (): void => {
    scene.remove(baseMesh, blueLensMesh, redLensMesh, blueGlowMesh, redGlowMesh);
    baseGeometry.dispose();
    lensGeometry.dispose();
    glowGeometry.dispose();
    baseMaterial.dispose();
    blueLensMaterial.dispose();
    redLensMaterial.dispose();
    blueGlowMaterial.dispose();
    redGlowMaterial.dispose();
  };

  return { update, dispose };
};
