export type CharacterId = "chief" | "strategist" | "logistics" | "trainer" | "air-ops" | "community";

export interface CharacterModifiers {
  budgetMultiplier: number;
  unitSpeedMultiplier: number;
  unitPowerMultiplier: number;
  containmentBonus: number;
  firebreakCostMultiplier: number;
  approvalRetentionMultiplier: number;
}

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  title: string;
  description: string;
  accent: string;
  portrait: string;
  modifiers: CharacterModifiers;
}

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: "chief",
    name: "Incident Commander",
    title: "Unified Command",
    description: "Steady, balanced leadership across budgets and response.",
    accent: "#b43a22",
    portrait: "assets/chiefs/incident-commander.svg",
    modifiers: {
      budgetMultiplier: 1,
      unitSpeedMultiplier: 1,
      unitPowerMultiplier: 1,
      containmentBonus: 0,
      firebreakCostMultiplier: 1,
      approvalRetentionMultiplier: 1
    }
  },
  {
    id: "strategist",
    name: "Strategic Chief",
    title: "Containment Planning",
    description: "Leans on containment planning and smarter suppression lines.",
    accent: "#2b688c",
    portrait: "assets/chiefs/strategic-chief.svg",
    modifiers: {
      budgetMultiplier: 0.95,
      unitSpeedMultiplier: 1,
      unitPowerMultiplier: 1.08,
      containmentBonus: 0.07,
      firebreakCostMultiplier: 0.95,
      approvalRetentionMultiplier: 1.02
    }
  },
  {
    id: "logistics",
    name: "Logistics Chief",
    title: "Supply & Mobilization",
    description: "More resources and faster deployments, less raw suppression.",
    accent: "#f0b33b",
    portrait: "assets/chiefs/logistics-chief.svg",
    modifiers: {
      budgetMultiplier: 1.12,
      unitSpeedMultiplier: 1.06,
      unitPowerMultiplier: 0.95,
      containmentBonus: 0.01,
      firebreakCostMultiplier: 0.88,
      approvalRetentionMultiplier: 0.98
    }
  },
  {
    id: "trainer",
    name: "Training Captain",
    title: "Crew Excellence",
    description: "Elite crews hit harder but cost more to field.",
    accent: "#8b5d33",
    portrait: "assets/chiefs/training-captain.svg",
    modifiers: {
      budgetMultiplier: 0.92,
      unitSpeedMultiplier: 1,
      unitPowerMultiplier: 1.12,
      containmentBonus: 0.04,
      firebreakCostMultiplier: 1.08,
      approvalRetentionMultiplier: 0.96
    }
  },
  {
    id: "air-ops",
    name: "Air Operations",
    title: "Rapid Response",
    description: "Fast aerial coordination sharpens response time.",
    accent: "#2a6f97",
    portrait: "assets/chiefs/air-operations.svg",
    modifiers: {
      budgetMultiplier: 0.9,
      unitSpeedMultiplier: 1.1,
      unitPowerMultiplier: 1.05,
      containmentBonus: 0,
      firebreakCostMultiplier: 1.02,
      approvalRetentionMultiplier: 0.94
    }
  },
  {
    id: "community",
    name: "Community Liaison",
    title: "Prevention & Outreach",
    description: "Stronger prevention planning and higher public support.",
    accent: "#5a8f4e",
    portrait: "assets/chiefs/community-liaison.svg",
    modifiers: {
      budgetMultiplier: 1.05,
      unitSpeedMultiplier: 0.98,
      unitPowerMultiplier: 0.96,
      containmentBonus: 0.08,
      firebreakCostMultiplier: 0.92,
      approvalRetentionMultiplier: 1.08
    }
  }
];

export function getCharacterDefinition(id: CharacterId): CharacterDefinition {
  return CHARACTERS.find((entry) => entry.id === id) ?? CHARACTERS[0];
}

export function getCharacterBaseBudget(id: CharacterId, baseBudget: number): number {
  const modifiers = getCharacterDefinition(id).modifiers;
  return Math.max(0, Math.floor(baseBudget * modifiers.budgetMultiplier));
}

export function getCharacterFirebreakCost(id: CharacterId, baseCost: number): number {
  const modifiers = getCharacterDefinition(id).modifiers;
  return Math.max(1, Math.round(baseCost * modifiers.firebreakCostMultiplier));
}

export function getCharacterInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
