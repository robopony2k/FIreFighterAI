import { getPhaseRules } from "./uiRules.js";
export const isInputAllowed = (phase, mode, action) => {
    const rules = getPhaseRules(phase, mode);
    if (rules.allowedInputs.includes(action)) {
        return { allowed: true };
    }
    return { allowed: false, reason: `Action ${action} is blocked during ${phase}.` };
};
export const gateInput = (phase, mode, action, handler, onBlocked) => {
    const result = isInputAllowed(phase, mode, action);
    if (result.allowed) {
        handler();
        return;
    }
    if (result.reason && onBlocked) {
        onBlocked(result.reason);
    }
};
