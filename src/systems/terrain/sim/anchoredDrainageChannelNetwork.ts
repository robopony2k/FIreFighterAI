export type AnchoredDrainageChannelInput = {
  receiver: Int32Array;
  flowAccumulation: Float32Array;
  oceanMask: Uint8Array;
  lakeMask?: Uint16Array;
  tributaryThreshold: number;
  trunkThreshold: number;
  minimumTerminalBranchCells: number;
};

export type AnchoredDrainageChannelResult = {
  channelNodeMask: Uint8Array;
  channelDownstream: Int32Array;
};

const CHANNEL_ACCEPTED = 1;
const CHANNEL_REJECTED = 2;
const CHANNEL_VISITING = 3;

export const buildAnchoredDrainageChannelNetwork = (
  input: AnchoredDrainageChannelInput
): AnchoredDrainageChannelResult => {
  const total = input.receiver.length;
  if (input.flowAccumulation.length !== total || input.oceanMask.length !== total) {
    throw new Error("Anchored drainage inputs must have matching lengths.");
  }
  if (input.lakeMask && input.lakeMask.length !== total) {
    throw new Error("Anchored drainage lake mask must match the drainage grid.");
  }

  const state = new Uint8Array(total);
  const isLake = (index: number): boolean => (input.lakeMask?.[index] ?? 0) > 0;
  const isCandidate = (index: number): boolean =>
    index >= 0 &&
    index < total &&
    input.oceanMask[index] === 0 &&
    !isLake(index) &&
    (input.receiver[index] ?? -1) >= 0 &&
    (input.flowAccumulation[index] ?? 0) >= input.tributaryThreshold;

  for (let index = 0; index < total; index += 1) {
    if (isCandidate(index) && (input.flowAccumulation[index] ?? 0) >= input.trunkThreshold) {
      state[index] = CHANNEL_ACCEPTED;
    }
  }

  for (let start = 0; start < total; start += 1) {
    if (!isCandidate(start) || state[start] !== 0) continue;
    const path: number[] = [];
    let cursor = start;
    let outcome = CHANNEL_REJECTED;
    while (cursor >= 0 && cursor < total) {
      if (isLake(cursor)) {
        outcome = CHANNEL_ACCEPTED;
        break;
      }
      if (input.oceanMask[cursor] > 0) break;
      const cursorState = state[cursor] ?? 0;
      if (cursorState === CHANNEL_ACCEPTED || cursorState === CHANNEL_REJECTED) {
        outcome = cursorState;
        break;
      }
      if (cursorState === CHANNEL_VISITING || !isCandidate(cursor)) break;
      state[cursor] = CHANNEL_VISITING;
      path.push(cursor);
      cursor = input.receiver[cursor] ?? -1;
    }
    for (let pathIndex = path.length - 1; pathIndex >= 0; pathIndex -= 1) {
      state[path[pathIndex]] = outcome;
    }
  }

  const channelNodeMask = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    if (state[index] === CHANNEL_ACCEPTED && isCandidate(index)) channelNodeMask[index] = 1;
  }

  const upstreamCount = new Uint16Array(total);
  for (let index = 0; index < total; index += 1) {
    if (channelNodeMask[index] === 0) continue;
    const target = input.receiver[index] ?? -1;
    if (target >= 0 && target < total && channelNodeMask[target] > 0) upstreamCount[target] += 1;
  }

  const minimumBranchCells = Math.max(1, Math.floor(input.minimumTerminalBranchCells));
  const pendingHeads: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (
      channelNodeMask[index] > 0 &&
      upstreamCount[index] === 0 &&
      (input.flowAccumulation[index] ?? 0) < input.trunkThreshold
    ) {
      pendingHeads.push(index);
    }
  }
  for (let headCursor = 0; headCursor < pendingHeads.length; headCursor += 1) {
    const head = pendingHeads[headCursor];
    if (channelNodeMask[head] === 0 || upstreamCount[head] > 0) continue;
    const terminalBranch: number[] = [];
    let cursor = head;
    while (
      cursor >= 0 &&
      cursor < total &&
      channelNodeMask[cursor] > 0 &&
      (input.flowAccumulation[cursor] ?? 0) < input.trunkThreshold
    ) {
      terminalBranch.push(cursor);
      const target = input.receiver[cursor] ?? -1;
      if (target < 0 || target >= total || channelNodeMask[target] === 0) break;
      if (upstreamCount[target] > 1 || (input.flowAccumulation[target] ?? 0) >= input.trunkThreshold) break;
      cursor = target;
    }
    if (terminalBranch.length >= minimumBranchCells) continue;
    for (const index of terminalBranch) {
      channelNodeMask[index] = 0;
      const target = input.receiver[index] ?? -1;
      if (target < 0 || target >= total || upstreamCount[target] === 0) continue;
      upstreamCount[target] -= 1;
      if (
        upstreamCount[target] === 0 &&
        channelNodeMask[target] > 0 &&
        (input.flowAccumulation[target] ?? 0) < input.trunkThreshold
      ) {
        pendingHeads.push(target);
      }
    }
  }

  const channelDownstream = new Int32Array(total).fill(-1);
  for (let index = 0; index < total; index += 1) {
    if (channelNodeMask[index] === 0) continue;
    const target = input.receiver[index] ?? -1;
    if (
      target >= 0 &&
      target < total &&
      (channelNodeMask[target] > 0 || isLake(target) || input.oceanMask[target] > 0)
    ) {
      channelDownstream[index] = target;
    }
  }
  return { channelNodeMask, channelDownstream };
};
