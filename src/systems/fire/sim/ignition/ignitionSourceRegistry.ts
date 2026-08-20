import type { IgnitionSourceDefinition } from "../../types/ignitionTypes.js";
import { lightningIgnitionSource } from "./lightningIgnitionSource.js";
import { roadsideIgnitionSource } from "./roadsideIgnitionSource.js";
import { settlementIgnitionSource } from "./settlementIgnitionSource.js";

export const IGNITION_SOURCE_REGISTRY: readonly IgnitionSourceDefinition[] = Object.freeze([
  lightningIgnitionSource,
  roadsideIgnitionSource,
  settlementIgnitionSource
]);
