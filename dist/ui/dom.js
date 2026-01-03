export function getUIRefs() {
    return {
        seedValue: document.getElementById("seedValue"),
        budgetValue: document.getElementById("budgetValue"),
        approvalValue: document.getElementById("approvalValue"),
        yearValue: document.getElementById("yearValue"),
        phaseValue: document.getElementById("phaseValue"),
        firesValue: document.getElementById("firesValue"),
        propertyLossValue: document.getElementById("propertyLossValue"),
        livesLossValue: document.getElementById("livesLossValue"),
        scoreValue: document.getElementById("scoreValue"),
        windValue: document.getElementById("windValue"),
        statusText: document.getElementById("statusText"),
        deployFirefighter: document.getElementById("deployFirefighter"),
        deployTruck: document.getElementById("deployTruck"),
        deployClear: document.getElementById("deployClear"),
        newRunBtn: document.getElementById("newRunBtn"),
        pauseBtn: document.getElementById("pauseBtn"),
        zoomOutBtn: document.getElementById("zoomOutBtn"),
        zoomInBtn: document.getElementById("zoomInBtn"),
        overlay: document.getElementById("overlay"),
        overlayTitle: document.getElementById("overlayTitle"),
        overlayMessage: document.getElementById("overlayMessage"),
        overlayRestart: document.getElementById("overlayRestart"),
        callsignInput: document.getElementById("callsignInput"),
        leaderboardList: document.getElementById("leaderboardList"),
        beginFireSeason: document.getElementById("beginFireSeason")
    };
}
