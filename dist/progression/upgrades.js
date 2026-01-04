export const UPGRADES = [
    {
        id: "rapid-response",
        name: "Rapid Response",
        description: "Units mobilize faster and reach targets sooner.",
        tag: "mobility"
    },
    {
        id: "fireline-training",
        name: "Fireline Training",
        description: "Ground crews suppress more fire per action.",
        tag: "suppression"
    },
    {
        id: "air-support",
        name: "Air Support",
        description: "Improved aerial support during peak fire days.",
        tag: "suppression"
    },
    {
        id: "resilient-infra",
        name: "Resilient Infrastructure",
        description: "Communities suffer less damage from fires.",
        tag: "protection"
    }
];
export function getUpgradeDefinition(id) {
    return UPGRADES.find((entry) => entry.id === id) ?? UPGRADES[0];
}
export function pickUpgradeChoices(rng, owned, count = 3) {
    const pool = UPGRADES.map((entry) => entry.id).filter((id) => !owned.includes(id));
    if (pool.length <= count) {
        return pool;
    }
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const swap = Math.floor(rng.next() * (i + 1));
        const temp = pool[i];
        pool[i] = pool[swap];
        pool[swap] = temp;
    }
    return pool.slice(0, count);
}
