import type { InputAction, InteractionMode, Phase } from "./types.js";
import { getPhaseRules } from "./uiRules.js";

export type InputGateResult = {
  allowed: boolean;
  reason?: string;
};

export const isInputAllowed = (phase: Phase, mode: InteractionMode, action: InputAction): InputGateResult => {
  const rules = getPhaseRules(phase, mode);
  if (rules.allowedInputs.includes(action)) {
    return { allowed: true };
  }
  return { allowed: false, reason: `Action ${action} is blocked during ${phase}.` };
};

export const gateInput = (
  phase: Phase,
  mode: InteractionMode,
  action: InputAction,
  handler: () => void,
  onBlocked?: (reason: string) => void
): void => {
  const result = isInputAllowed(phase, mode, action);
  if (result.allowed) {
    handler();
    return;
  }
  if (result.reason && onBlocked) {
    onBlocked(result.reason);
  }
};
