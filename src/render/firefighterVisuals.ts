import * as THREE from "three";
import type { WorldState } from "../core/state.js";

const TAU = Math.PI * 2;
const PATH_BLEND = 0.34;
const MOTION_SCALE = 4.8;
const ACTIVE_HOSE_HOLD = 1;
const IDLE_HOSE_HOLD = 0.72;

export const FIREFIGHTER_MODEL_ROOT_Y_OFFSET = 0.05;

export type FirefighterModelPart =
  | "head"
  | "torso"
  | "arm-left"
  | "arm-right"
  | "leg-left"
  | "leg-right"
  | "gear";

export type FirefighterVisualState = {
  locomotion: number;
  hoseHold: number;
  brace: number;
  bodyBob: number;
  rootPitch: number;
  rootRoll: number;
  torsoPitch: number;
  torsoRoll: number;
  headPitch: number;
  headRoll: number;
  armLeftPitch: number;
  armLeftRoll: number;
  armRightPitch: number;
  armRightRoll: number;
  legLeftPitch: number;
  legRightPitch: number;
  gearPitch: number;
  gripForward: number;
  gripRight: number;
  gripUp: number;
  gripPitch: number;
};

export const createFirefighterVisualState = (): FirefighterVisualState => ({
  locomotion: 0,
  hoseHold: 0,
  brace: 0,
  bodyBob: 0,
  rootPitch: 0,
  rootRoll: 0,
  torsoPitch: 0,
  torsoRoll: 0,
  headPitch: 0,
  headRoll: 0,
  armLeftPitch: 0,
  armLeftRoll: 0,
  armRightPitch: 0,
  armRightRoll: 0,
  legLeftPitch: 0,
  legRightPitch: 0,
  gearPitch: 0,
  gripForward: 0.04,
  gripRight: 0.047,
  gripUp: 0.19,
  gripPitch: -0.58
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const hasAncestor = (ancestorNames: ReadonlyArray<string>, prefix: string): boolean =>
  ancestorNames.some((name) => name.startsWith(prefix));

export const classifyFirefighterModelPart = (
  ancestorNames: ReadonlyArray<string>,
  bounds: THREE.Box3,
  modelSize: THREE.Vector3
): FirefighterModelPart => {
  const center = bounds.getCenter(new THREE.Vector3());
  const normalizedY = center.y / Math.max(0.0001, modelSize.y);
  const armatureLeftLeg =
    hasAncestor(ancestorNames, "Cube.016_43") ||
    hasAncestor(ancestorNames, "Cube.017_44") ||
    hasAncestor(ancestorNames, "Cube.018_45") ||
    hasAncestor(ancestorNames, "Icosphere.008_46") ||
    hasAncestor(ancestorNames, "Icosphere.009_47") ||
    hasAncestor(ancestorNames, "Icosphere.010_48");
  if (hasAncestor(ancestorNames, "Bone.005_14")) {
    return "arm-right";
  }
  if (hasAncestor(ancestorNames, "Bone.011_23")) {
    return "arm-left";
  }
  if (
    hasAncestor(ancestorNames, "Bone.003_5") ||
    hasAncestor(ancestorNames, "Bone.004_3") ||
    hasAncestor(ancestorNames, "Cube_2") ||
    hasAncestor(ancestorNames, "Cube.001_4")
  ) {
    return "head";
  }
  if (armatureLeftLeg) {
    return normalizedY <= 0.48 ? "leg-left" : "gear";
  }
  if (hasAncestor(ancestorNames, "Bone.008_36")) {
    return normalizedY <= 0.62 ? "leg-right" : "gear";
  }
  if (normalizedY <= 0.34 && Math.abs(center.x) > Math.max(0.0001, modelSize.x) * 0.05) {
    return center.x < 0 ? "leg-left" : "leg-right";
  }
  return "torso";
};

export const resolveFirefighterPartPivot = (
  part: FirefighterModelPart,
  bounds: THREE.Box3
): THREE.Vector3 => {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  switch (part) {
    case "head":
      return new THREE.Vector3(center.x, bounds.min.y + size.y * 0.12, center.z);
    case "arm-left":
    case "arm-right":
      return new THREE.Vector3(center.x * 0.42, bounds.max.y - size.y * 0.82, center.z * 0.55);
    case "leg-left":
    case "leg-right":
      return new THREE.Vector3(center.x, bounds.max.y - size.y * 0.08, center.z * 0.16);
    case "gear":
      return new THREE.Vector3(0, bounds.min.y + size.y * 0.5, center.z * 0.55);
    case "torso":
    default:
      return new THREE.Vector3(0, bounds.min.y + size.y * 0.45, center.z * 0.4);
  }
};

export const updateFirefighterVisualState = (
  unit: WorldState["units"][number],
  timeSec: number,
  target: FirefighterVisualState
): FirefighterVisualState => {
  const hasPath = unit.carrierId === null && unit.pathIndex < unit.path.length;
  const movedTiles = unit.carrierId === null ? Math.hypot(unit.x - unit.prevX, unit.y - unit.prevY) : 0;
  const locomotion = clamp(movedTiles * MOTION_SCALE + (hasPath ? PATH_BLEND : 0), 0, 1);
  const engaged = unit.sprayTarget !== null || unit.attackTarget !== null;
  const hoseHold =
    unit.carrierId === null && unit.assignedTruckId !== null
      ? engaged
        ? ACTIVE_HOSE_HOLD
        : IDLE_HOSE_HOLD
      : 0;
  const gaitHz = 1.35 + locomotion * 2.2;
  const phase = timeSec * TAU * gaitHz + unit.id * 0.61803398875;
  const stride = Math.sin(phase);
  const doubleStep = Math.sin(phase * 2 - Math.PI * 0.18);
  const brace = engaged ? 1 : 0;
  const walkArmSwing = stride * 0.5 * locomotion;
  const walkLegSwing = stride * 0.78 * locomotion;
  target.locomotion = locomotion;
  target.hoseHold = hoseHold;
  target.brace = brace;
  target.bodyBob = Math.max(0, doubleStep) * 0.012 * locomotion + Math.sin(phase) * 0.0018 * brace;
  target.rootPitch = 0.045 * locomotion + 0.075 * brace;
  target.rootRoll = stride * 0.028 * Math.max(locomotion, hoseHold * 0.6);
  target.torsoPitch = 0.06 * locomotion + 0.11 * brace;
  target.torsoRoll = stride * 0.045 * Math.max(locomotion, hoseHold * 0.55);
  target.headPitch = -0.02 * locomotion + 0.028 * brace;
  target.headRoll = -target.torsoRoll * 0.35;
  target.armLeftPitch = -walkArmSwing * (1 - hoseHold * 0.45) - hoseHold * 0.74;
  target.armLeftRoll = 0.12 + hoseHold * 0.34;
  target.armRightPitch = walkArmSwing * (1 - hoseHold * 0.82) - hoseHold * 0.98;
  target.armRightRoll = -0.1 - hoseHold * 0.28;
  target.legLeftPitch = walkLegSwing;
  target.legRightPitch = -walkLegSwing;
  target.gearPitch = -target.rootPitch * 0.7 + Math.sin(phase + Math.PI) * 0.05 * locomotion;
  target.gripForward = 0.04 + hoseHold * 0.028 + locomotion * 0.004;
  target.gripRight = 0.047;
  target.gripUp = 0.192 + target.bodyBob + hoseHold * 0.012;
  target.gripPitch = -0.58 + brace * 0.18 + locomotion * 0.05;
  return target;
};

const poseEuler = new THREE.Euler(0, 0, 0, "XYZ");
const poseQuaternion = new THREE.Quaternion();
const pivotMatrix = new THREE.Matrix4();
const rotationMatrix = new THREE.Matrix4();
const unpivotMatrix = new THREE.Matrix4();

export const writeFirefighterPartPoseMatrix = (
  part: FirefighterModelPart,
  pivot: THREE.Vector3,
  state: FirefighterVisualState,
  target: THREE.Matrix4
): THREE.Matrix4 => {
  let pitch = 0;
  let yaw = 0;
  let roll = 0;
  switch (part) {
    case "head":
      pitch = state.headPitch;
      roll = state.headRoll;
      break;
    case "torso":
      pitch = state.torsoPitch;
      roll = state.torsoRoll;
      break;
    case "arm-left":
      pitch = state.armLeftPitch;
      roll = state.armLeftRoll;
      break;
    case "arm-right":
      pitch = state.armRightPitch;
      roll = state.armRightRoll;
      break;
    case "leg-left":
      pitch = state.legLeftPitch;
      break;
    case "leg-right":
      pitch = state.legRightPitch;
      break;
    case "gear":
      pitch = state.gearPitch;
      yaw = -state.torsoRoll * 0.25;
      break;
    default:
      break;
  }
  poseEuler.set(pitch, yaw, roll);
  poseQuaternion.setFromEuler(poseEuler);
  pivotMatrix.makeTranslation(pivot.x, pivot.y, pivot.z);
  rotationMatrix.makeRotationFromQuaternion(poseQuaternion);
  unpivotMatrix.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  return target.copy(pivotMatrix).multiply(rotationMatrix).multiply(unpivotMatrix);
};

export const writeFirefighterGripWorldPosition = (
  rootPosition: THREE.Vector3,
  yaw: number,
  state: FirefighterVisualState,
  target: THREE.Vector3
): THREE.Vector3 => {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  return target.set(
    rootPosition.x + cosYaw * state.gripRight + sinYaw * state.gripForward,
    rootPosition.y + state.gripUp,
    rootPosition.z - sinYaw * state.gripRight + cosYaw * state.gripForward
  );
};

export const writeFirefighterGripDirection = (
  yaw: number,
  pitch: number,
  target: THREE.Vector3
): THREE.Vector3 => {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return target.set(sinYaw * cosPitch, sinPitch, cosYaw * cosPitch).normalize();
};
