import type { WorldState } from "../../../core/state.js";
import { resolveActiveFireFrontComponents } from "./fireFrontComponents.js";

const ACTIVE_FIRE_FRONT_EPS = 0.03;

export type ActiveFireFrontTarget = {
  x: number;
  y: number;
  tileCount: number;
  priority: number;
};

export const resolveActiveFireFrontTargets = (state: WorldState): ActiveFireFrontTarget[] => {
  return resolveActiveFireFrontComponents(state, { minFire: ACTIVE_FIRE_FRONT_EPS }).map(
    ({ x, y, tileCount, priority }) => ({ x, y, tileCount, priority })
  );
};
