import assert from "node:assert/strict";

import { getTechNodeDefinitions } from "../dist/config/progression/techTreeCatalog.js";
import { getCommandLevelThreshold } from "../dist/config/progression/levelThresholds.js";
import { buildProgressionDraftOptions } from "../dist/systems/progression/draft.js";
import { createProgressionState } from "../dist/systems/progression/state.js";
import { selectProgressionNode } from "../dist/systems/progression/index.js";
import { getProgressionLevelForExtinguishTotal } from "../dist/systems/progression/index.js";
import {
  buildTechTreeSnapshot,
  getEligibleTechNodeDefinitions,
  hasProgressionCapability,
  isTechTreeComplete,
  validateTechTreeDefinitions
} from "../dist/systems/progression/sim/techTree.js";
import { getAvailableMinimapModes } from "../dist/ui/runtime/minimap/minimapModes.js";
import { isRuntimeWidgetAvailable } from "../dist/ui/runtime/widgets/registry.js";

const definitions = getTechNodeDefinitions();
validateTechTreeDefinitions(definitions);
assert.equal(definitions.length, 15, "The initial authored graph should contain 15 nodes.");

const expectedFirstThresholds = [25, 60, 110, 175, 255, 350, 460, 585, 725, 880];
assert.deepEqual(
  expectedFirstThresholds.map((_, index) => getCommandLevelThreshold(index + 1)),
  expectedFirstThresholds,
  "Levels 1-10 must preserve the existing thresholds."
);
assert.equal(getCommandLevelThreshold(11), 1050, "The accepted threshold curve should continue beyond level 10.");
assert.equal(getCommandLevelThreshold(20), 3255, "The extended threshold curve should remain quadratic.");
assert.equal(getProgressionLevelForExtinguishTotal(1049), 10, "Level calculation should remain below level 11 before its threshold.");
assert.equal(getProgressionLevelForExtinguishTotal(1050), 11, "Level calculation should continue past the former level cap.");

const initialRanks = {};
const initialEligible = getEligibleTechNodeDefinitions(initialRanks).map((node) => node.id);
assert(initialEligible.includes("field-mapping"), "Field Mapping should be a root node.");
assert(initialEligible.includes("weather-instruments"), "Weather Instruments should be a root node.");
assert(!initialEligible.includes("topographic-survey"), "Topographic Survey should require Field Mapping.");
assert(!initialEligible.includes("air-support"), "Air Support should enforce its ranked prerequisites.");

const firstDraft = buildProgressionDraftOptions(7831, 1, initialRanks);
assert.deepEqual(firstDraft, buildProgressionDraftOptions(7831, 1, initialRanks), "Drafts must remain deterministic.");
assert(firstDraft.length <= 3, "Drafts must offer at most three nodes.");
assert(firstDraft.every((nodeId) => initialEligible.includes(nodeId)), "Drafts must contain only eligible nodes.");

const fieldRanks = { "field-mapping": 1 };
const fieldEligible = getEligibleTechNodeDefinitions(fieldRanks).map((node) => node.id);
assert(fieldEligible.includes("topographic-survey"), "Owning Field Mapping should unlock Topographic Survey eligibility.");
assert(!fieldEligible.includes("dispatch-tracking"), "Dispatch Tracking should still require Rapid Response.");

const operationsRanks = { "fireline-training": 2, "extended-lines": 1 };
assert(
  getEligibleTechNodeDefinitions(operationsRanks).some((node) => node.id === "air-support"),
  "Air Support should unlock after Fireline Training R2 and Extended Lines R1."
);

const progression = createProgressionState();
assert(!hasProgressionCapability(progression, "runtime.minimap"), "The minimap must begin locked.");
assert(!isRuntimeWidgetAvailable("minimap", progression), "The minimap widget metadata must enforce its capability.");
progression.nodeRanks["field-mapping"] = 1;
assert(hasProgressionCapability(progression, "runtime.minimap"), "Field Mapping should grant the minimap capability.");
assert(isRuntimeWidgetAvailable("minimap", progression), "The minimap widget should become available after Field Mapping.");
assert.deepEqual(getAvailableMinimapModes(progression), ["terrain"], "Field Mapping should initially expose only Terrain.");
progression.nodeRanks["topographic-survey"] = 1;
progression.nodeRanks["moisture-analysis"] = 1;
progression.nodeRanks["thermal-imaging"] = 1;
assert.deepEqual(
  getAvailableMinimapModes(progression),
  ["terrain", "topographic", "moisture", "thermal"],
  "Analytical modes should appear in authored order as their nodes unlock."
);

const selectionProgression = createProgressionState();
selectionProgression.activeDraft = {
  ordinal: 1,
  level: 1,
  options: ["rapid-response"],
  openedAtExtinguishTotal: 25
};
assert(
  selectProgressionNode({ seed: 1, progression: selectionProgression }, "rapid-response"),
  "Selecting an eligible drafted node should succeed."
);
assert.equal(selectionProgression.nodeRanks["rapid-response"], 1, "Selecting a node should increment its rank.");
assert(selectionProgression.resolved.unitSpeedMultiplier > 1, "Existing numeric perk effects should still resolve.");
selectionProgression.activeDraft = {
  ordinal: 2,
  level: 2,
  options: ["topographic-survey"],
  openedAtExtinguishTotal: 60
};
assert(
  !selectProgressionNode({ seed: 1, progression: selectionProgression }, "topographic-survey"),
  "Selection should reject drafted nodes whose prerequisites are not met."
);

progression.activeDraft = { ordinal: 4, level: 4, options: ["weather-instruments"], openedAtExtinguishTotal: 175 };
const snapshot = buildTechTreeSnapshot(progression);
assert.equal(
  snapshot.nodes.find((node) => node.definition.id === "weather-instruments")?.status,
  "drafted",
  "The future tree snapshot should identify active draft choices."
);
assert.equal(
  snapshot.nodes.find((node) => node.definition.id === "field-mapping")?.status,
  "maxed",
  "Single-rank owned nodes should report maxed."
);

const maxedRanks = Object.fromEntries(definitions.map((definition) => [definition.id, definition.maxRanks]));
assert(isTechTreeComplete(maxedRanks), "The tree should report complete when every node is maxed.");
assert.equal(getEligibleTechNodeDefinitions(maxedRanks).length, 0, "A complete tree should have no draft candidates.");
const almostMaxed = { ...maxedRanks, "thermal-imaging": 0 };
assert.deepEqual(
  buildProgressionDraftOptions(7831, 50, almostMaxed),
  ["thermal-imaging"],
  "Drafts should offer fewer than three nodes when only one is eligible."
);

const makeDefinition = (id, prerequisites = [], order = 0) => ({
  id,
  name: id,
  description: id,
  icon: id,
  branch: "awareness",
  rarity: "standard",
  draftWeight: 1,
  maxRanks: 1,
  prerequisites,
  capabilities: [],
  effects: [],
  layout: { branch: "awareness", tier: 0, order }
});
assert.throws(
  () => validateTechTreeDefinitions([makeDefinition("a", [{ nodeId: "b", minRank: 1 }])]),
  /Unknown prerequisite/,
  "Graph validation should reject unknown prerequisites."
);
assert.throws(
  () =>
    validateTechTreeDefinitions([
      makeDefinition("a", [{ nodeId: "b", minRank: 1 }]),
      makeDefinition("b", [{ nodeId: "a", minRank: 1 }], 1)
    ]),
  /cycle/i,
  "Graph validation should reject prerequisite cycles."
);

console.log("Progression tech tree regression passed.");
