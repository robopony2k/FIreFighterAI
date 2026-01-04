export const SEASONS = [
    {
        id: "spring",
        label: "Spring",
        phases: ["growth"],
        notes: "Vegetation rebounds and resources are assigned."
    },
    {
        id: "summer",
        label: "Summer",
        phases: ["fire"],
        notes: "Primary wildfire response season."
    },
    {
        id: "autumn",
        label: "Autumn",
        phases: ["budget"],
        notes: "Performance review and budget outcomes."
    },
    {
        id: "winter",
        label: "Winter",
        phases: ["maintenance"],
        notes: "Budget spend on preparedness and mitigation."
    }
];
export function getSeasonDefinition(id) {
    return SEASONS.find((entry) => entry.id === id) ?? SEASONS[0];
}
