import * as THREE from "three";

import { createThreeTestFireFx as createFireFxRuntime } from "../systems/fire/rendering/fireFxRuntime.js";
import type { ThreeTestFireFxOptions } from "../systems/fire/rendering/fireFxTypes.js";

export {
  DEFAULT_FIRE_FX_DEBUG_CONTROLS,
  createEmptyFireFxDebugSnapshot,
  normalizeFireFxDebugControls,
  type FireAnchorDebugMode,
  type FireAudioClusterSnapshot,
  type FireFxDebugControls,
  type FireFxDebugSnapshot,
  type FireFxEnvironmentSignals,
  type FireFxFallbackMode,
  type SparkDebugSnapshot,
  type SparkMode,
  type ThreeTestFireFx,
  type ThreeTestFireFxOptions
} from "../systems/fire/rendering/fireFxTypes.js";

export const createThreeTestFireFx = (
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: ThreeTestFireFxOptions = {}
) => createFireFxRuntime(scene, camera, options);
