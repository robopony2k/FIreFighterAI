const phaseLabels = {
    growth: "Growth",
    maintenance: "Maintenance",
    fire: "Fire Season",
    budget: "Budget"
};
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 180;
const CHART_HEIGHT = 135;
const CHART_PADDING = 12;
const SEASON_LABELS = ["Winter", "Spring", "Summer", "Autumn"];
const SEASON_CLASSES = ["winter", "spring", "summer", "autumn"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const buildRiskPaths = (risk) => {
    const count = risk.length;
    if (count === 0) {
        return { line: "", area: "" };
    }
    const axisY = CHART_HEIGHT - CHART_PADDING;
    const width = CHART_WIDTH - CHART_PADDING * 2;
    const height = axisY - CHART_PADDING;
    let line = "";
    let firstX = CHART_PADDING;
    let lastX = CHART_PADDING;
    for (let i = 0; i < count; i += 1) {
        const t = count > 1 ? i / (count - 1) : 0;
        const x = CHART_PADDING + t * width;
        const value = clamp(risk[i] ?? 0, 0, 1);
        const y = axisY - value * height;
        if (i === 0) {
            firstX = x;
            line = `M ${x.toFixed(2)} ${y.toFixed(2)}`;
        }
        else {
            line += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
        }
        if (i === count - 1) {
            lastX = x;
        }
    }
    const area = `${line} L ${lastX.toFixed(2)} ${axisY.toFixed(2)} L ${firstX.toFixed(2)} ${axisY.toFixed(2)} Z`;
    return { line, area };
};
export const createTopBar = () => {
    const element = document.createElement("header");
    element.className = "phase-panel phase-topbar";
    element.dataset.panel = "topbar";
    const badge = document.createElement("div");
    badge.className = "phase-badge";
    const forecast = document.createElement("div");
    forecast.className = "phase-forecast";
    const forecastChart = document.createElement("div");
    forecastChart.className = "phase-forecast-chart";
    const forecastScale = document.createElement("div");
    forecastScale.className = "phase-forecast-scale";
    const forecastSeasonScale = document.createElement("div");
    forecastSeasonScale.className = "phase-forecast-season-scale";
    const forecastMeta = document.createElement("div");
    forecastMeta.className = "phase-forecast-meta";
    const forecastControls = document.createElement("div");
    forecastControls.className = "phase-forecast-controls";
    const forecastSvg = document.createElementNS(SVG_NS, "svg");
    forecastSvg.classList.add("phase-forecast-svg");
    forecastSvg.setAttribute("viewBox", `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
    forecastSvg.setAttribute("preserveAspectRatio", "none");
    const defs = document.createElementNS(SVG_NS, "defs");
    const gradient = document.createElementNS(SVG_NS, "linearGradient");
    gradient.id = "phase-forecast-gradient";
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("x2", "1");
    gradient.setAttribute("y2", "0");
    const stopCool = document.createElementNS(SVG_NS, "stop");
    stopCool.setAttribute("offset", "0%");
    stopCool.classList.add("phase-forecast-stop", "is-cool");
    const stopWarm = document.createElementNS(SVG_NS, "stop");
    stopWarm.setAttribute("offset", "55%");
    stopWarm.classList.add("phase-forecast-stop", "is-warm");
    const stopHot = document.createElementNS(SVG_NS, "stop");
    stopHot.setAttribute("offset", "100%");
    stopHot.classList.add("phase-forecast-stop", "is-hot");
    gradient.append(stopCool, stopWarm, stopHot);
    defs.appendChild(gradient);
    const riskGradient = document.createElementNS(SVG_NS, "linearGradient");
    riskGradient.id = "phase-forecast-risk-gradient";
    riskGradient.setAttribute("x1", "0");
    riskGradient.setAttribute("y1", "1");
    riskGradient.setAttribute("x2", "0");
    riskGradient.setAttribute("y2", "0");
    const riskStopLow = document.createElementNS(SVG_NS, "stop");
    riskStopLow.setAttribute("offset", "0%");
    riskStopLow.classList.add("phase-forecast-stop", "is-cool");
    const riskStopWarm = document.createElementNS(SVG_NS, "stop");
    riskStopWarm.setAttribute("offset", "60%");
    riskStopWarm.classList.add("phase-forecast-stop", "is-warm");
    const riskStopHot = document.createElementNS(SVG_NS, "stop");
    riskStopHot.setAttribute("offset", "100%");
    riskStopHot.classList.add("phase-forecast-stop", "is-hot");
    riskGradient.append(riskStopLow, riskStopWarm, riskStopHot);
    defs.appendChild(riskGradient);
    const riskBands = document.createElementNS(SVG_NS, "g");
    riskBands.classList.add("phase-forecast-bands");
    const seasonBands = document.createElementNS(SVG_NS, "g");
    seasonBands.classList.add("phase-forecast-seasons");
    const bandNames = ["low", "moderate", "high", "extreme"];
    const bandHeight = (CHART_HEIGHT - CHART_PADDING * 2) / bandNames.length;
    for (let i = 0; i < bandNames.length; i += 1) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.classList.add("phase-forecast-band", `is-${bandNames[i]}`);
        rect.setAttribute("x", CHART_PADDING.toString());
        rect.setAttribute("width", (CHART_WIDTH - CHART_PADDING * 2).toString());
        rect.setAttribute("height", bandHeight.toFixed(2));
        rect.setAttribute("y", (CHART_HEIGHT - CHART_PADDING - bandHeight * (i + 1)).toFixed(2));
        riskBands.appendChild(rect);
    }
    const axisLine = document.createElementNS(SVG_NS, "line");
    axisLine.classList.add("phase-forecast-axis");
    axisLine.setAttribute("x1", CHART_PADDING.toString());
    axisLine.setAttribute("x2", (CHART_WIDTH - CHART_PADDING).toString());
    axisLine.setAttribute("y1", (CHART_HEIGHT - CHART_PADDING).toString());
    axisLine.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());
    const areaPath = document.createElementNS(SVG_NS, "path");
    areaPath.classList.add("phase-forecast-area");
    areaPath.setAttribute("fill", "url(#phase-forecast-risk-gradient)");
    const linePath = document.createElementNS(SVG_NS, "path");
    linePath.classList.add("phase-forecast-line");
    linePath.setAttribute("stroke", "url(#phase-forecast-gradient)");
    const seasonMarkers = document.createElementNS(SVG_NS, "g");
    seasonMarkers.classList.add("phase-forecast-season-lines");
    const riskAxis = document.createElementNS(SVG_NS, "g");
    riskAxis.classList.add("phase-forecast-axis-group");
    const yearMarkers = document.createElementNS(SVG_NS, "g");
    yearMarkers.classList.add("phase-forecast-years");
    const markerLine = document.createElementNS(SVG_NS, "line");
    markerLine.classList.add("phase-forecast-marker");
    markerLine.setAttribute("y1", CHART_PADDING.toString());
    markerLine.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING + 4).toString());
    forecastSvg.append(defs, seasonBands, riskBands, axisLine, areaPath, seasonMarkers, yearMarkers, linePath, riskAxis, markerLine);
    forecastChart.appendChild(forecastSvg);
    forecast.append(forecastChart, forecastSeasonScale, forecastScale, forecastMeta, forecastControls);
    const alert = document.createElement("div");
    alert.className = "phase-alert";
    const cta = document.createElement("button");
    cta.className = "phase-cta";
    const content = document.createElement("div");
    content.className = "phase-topbar-content";
    content.append(badge, alert, cta);
    element.append(content, forecast);
    let ctaHandler = null;
    let currentAction = null;
    cta.addEventListener("click", () => {
        if (currentAction && ctaHandler) {
            ctaHandler(currentAction);
        }
    });
    const updateYearMarkers = (startDay, yearDays, windowDays) => {
        while (yearMarkers.firstChild) {
            yearMarkers.removeChild(yearMarkers.firstChild);
        }
        while (forecastScale.firstChild) {
            forecastScale.removeChild(forecastScale.firstChild);
        }
        if (yearDays <= 0 || windowDays <= 0) {
            return;
        }
        const windowEnd = startDay + windowDays - 1;
        const firstYear = Math.floor(startDay / yearDays);
        const lastYear = Math.floor(windowEnd / yearDays);
        for (let year = firstYear; year <= lastYear; year += 1) {
            const boundary = year * yearDays;
            if (boundary < startDay || boundary > windowEnd) {
                continue;
            }
            const offset = boundary - startDay;
            const t = windowDays > 1 ? offset / (windowDays - 1) : 0;
            const x = CHART_PADDING + t * (CHART_WIDTH - CHART_PADDING * 2);
            const line = document.createElementNS(SVG_NS, "line");
            line.classList.add("phase-forecast-year-line");
            line.setAttribute("x1", x.toFixed(2));
            line.setAttribute("x2", x.toFixed(2));
            line.setAttribute("y1", CHART_PADDING.toString());
            line.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());
            const label = document.createElement("div");
            label.classList.add("phase-forecast-year-label");
            label.style.left = `${(t * 100).toFixed(2)}%`;
            label.textContent = `Year ${year + 1}`;
            yearMarkers.append(line);
            forecastScale.appendChild(label);
        }
    };
    const updateSeasonMarkers = (startDay, yearDays, windowDays) => {
        while (seasonBands.firstChild) {
            seasonBands.removeChild(seasonBands.firstChild);
        }
        while (seasonMarkers.firstChild) {
            seasonMarkers.removeChild(seasonMarkers.firstChild);
        }
        while (forecastSeasonScale.firstChild) {
            forecastSeasonScale.removeChild(forecastSeasonScale.firstChild);
        }
        if (yearDays <= 0 || windowDays <= 0) {
            return;
        }
        const seasonLength = Math.max(1, Math.floor(yearDays / 4));
        const width = CHART_WIDTH - CHART_PADDING * 2;
        const height = CHART_HEIGHT - CHART_PADDING * 2;
        const windowEnd = startDay + windowDays;
        const firstYear = Math.floor(startDay / yearDays);
        const lastYear = Math.floor((windowEnd - 1) / yearDays);
        for (let year = firstYear; year <= lastYear; year += 1) {
            const yearStart = year * yearDays;
            for (let season = 0; season < 4; season += 1) {
                const seasonStart = yearStart + season * seasonLength;
                const seasonEnd = season === 3 ? yearStart + yearDays : seasonStart + seasonLength;
                const segStart = Math.max(seasonStart, startDay);
                const segEnd = Math.min(seasonEnd, windowEnd);
                if (segStart >= segEnd) {
                    continue;
                }
                const t0 = windowDays > 0 ? (segStart - startDay) / windowDays : 0;
                const t1 = windowDays > 0 ? (segEnd - startDay) / windowDays : 0;
                const x = CHART_PADDING + t0 * width;
                const rectWidth = Math.max(0, (t1 - t0) * width);
                const rect = document.createElementNS(SVG_NS, "rect");
                rect.classList.add("phase-forecast-season", `is-${SEASON_CLASSES[season]}`);
                rect.setAttribute("x", x.toFixed(2));
                rect.setAttribute("y", CHART_PADDING.toString());
                rect.setAttribute("width", rectWidth.toFixed(2));
                rect.setAttribute("height", height.toFixed(2));
                seasonBands.appendChild(rect);
                const label = document.createElement("div");
                label.classList.add("phase-forecast-season-label");
                label.style.left = `${((t0 + t1) * 50).toFixed(2)}%`;
                label.textContent = SEASON_LABELS[season];
                forecastSeasonScale.appendChild(label);
                if (seasonStart > startDay && seasonStart < windowEnd) {
                    const boundaryT = windowDays > 0 ? (seasonStart - startDay) / windowDays : 0;
                    const boundaryX = CHART_PADDING + boundaryT * width;
                    const line = document.createElementNS(SVG_NS, "line");
                    line.classList.add("phase-forecast-season-line");
                    line.setAttribute("x1", boundaryX.toFixed(2));
                    line.setAttribute("x2", boundaryX.toFixed(2));
                    line.setAttribute("y1", CHART_PADDING.toString());
                    line.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());
                    seasonMarkers.appendChild(line);
                }
            }
        }
    };
    const updateRiskAxis = () => {
        while (riskAxis.firstChild) {
            riskAxis.removeChild(riskAxis.firstChild);
        }
        const width = CHART_WIDTH - CHART_PADDING * 2;
        const height = CHART_HEIGHT - CHART_PADDING * 2;
        const axisY = CHART_HEIGHT - CHART_PADDING;
        const thresholds = [0.25, 0.5, 0.75];
        thresholds.forEach((value) => {
            const y = axisY - value * height;
            const line = document.createElementNS(SVG_NS, "line");
            line.classList.add("phase-forecast-yline");
            line.setAttribute("x1", CHART_PADDING.toString());
            line.setAttribute("x2", (CHART_PADDING + width).toString());
            line.setAttribute("y1", y.toFixed(2));
            line.setAttribute("y2", y.toFixed(2));
            riskAxis.appendChild(line);
        });
        const labels = ["Low", "Moderate", "High", "Extreme"];
        labels.forEach((labelText, index) => {
            const bandCenter = (index + 0.5) / labels.length;
            const y = axisY - bandCenter * height + 3;
            const text = document.createElementNS(SVG_NS, "text");
            text.classList.add("phase-forecast-ylabel");
            text.setAttribute("x", (CHART_PADDING + 2).toString());
            text.setAttribute("y", y.toFixed(2));
            text.textContent = labelText;
            riskAxis.appendChild(text);
        });
    };
    updateRiskAxis();
    return {
        element,
        attachControls: (controls) => {
            while (forecastControls.firstChild) {
                forecastControls.removeChild(forecastControls.firstChild);
            }
            forecastControls.appendChild(controls);
        },
        update: (data) => {
            badge.textContent = phaseLabels[data.phase];
            if (data.forecast && data.forecast.risk.length > 0) {
                forecast.classList.remove("is-hidden");
                const { line, area } = buildRiskPaths(data.forecast.risk);
                linePath.setAttribute("d", line);
                areaPath.setAttribute("d", area);
                const dayValue = clamp(data.forecastDay, 0, Math.max(0, data.forecast.days - 1));
                const range = Math.max(1, data.forecast.days - 1);
                const progress = dayValue / range;
                const markerX = CHART_PADDING + progress * (CHART_WIDTH - CHART_PADDING * 2);
                const markerXValue = markerX.toFixed(2);
                markerLine.setAttribute("x1", markerXValue);
                markerLine.setAttribute("x2", markerXValue);
                updateSeasonMarkers(data.forecastStartDay, data.forecastYearDays, data.forecast.days);
                updateYearMarkers(data.forecastStartDay, data.forecastYearDays, data.forecast.days);
                forecastMeta.textContent = data.forecastMeta ?? "";
            }
            else {
                forecast.classList.add("is-hidden");
                linePath.setAttribute("d", "");
                areaPath.setAttribute("d", "");
                forecastMeta.textContent = "";
                updateSeasonMarkers(0, 0, 0);
                updateYearMarkers(0, 0, 0);
            }
            if (data.alert) {
                alert.textContent = data.alert;
                alert.classList.remove("is-hidden");
            }
            else {
                alert.textContent = "";
                alert.classList.add("is-hidden");
            }
            if (data.primaryCta) {
                cta.textContent = data.primaryCta.label;
                cta.classList.remove("is-hidden");
                currentAction = data.primaryCta.actionId;
            }
            else {
                cta.textContent = "";
                cta.classList.add("is-hidden");
                currentAction = null;
            }
        },
        onCta: (handler) => {
            ctaHandler = handler;
        }
    };
};
