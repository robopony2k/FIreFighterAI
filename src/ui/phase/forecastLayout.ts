export type ChartDims = {
  width: number;
  height: number;
  padding: number;
};

export const FORECAST_CHART: ChartDims = {
  width: 180,
  height: 135,
  padding: 12
};

export const SEASON_LABELS = ["Winter", "Spring", "Summer", "Autumn"] as const;
export const SEASON_CLASSES = ["winter", "spring", "summer", "autumn"] as const;
export const RISK_BANDS = ["low", "moderate", "high", "extreme"] as const;
export const RISK_THRESHOLDS = [0.25, 0.5, 0.75] as const;

type ChartPoint = { x: number; y: number };

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const buildRiskPaths = (
  risk: number[],
  dims: ChartDims = FORECAST_CHART
): { line: string; area: string; points: ChartPoint[] } => {
  const count = risk.length;
  if (count === 0) {
    return { line: "", area: "", points: [] };
  }
  const axisY = dims.height - dims.padding;
  const width = dims.width - dims.padding * 2;
  const height = axisY - dims.padding;
  let line = "";
  let firstX = dims.padding;
  let lastX = dims.padding;
  const points: ChartPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const x = dims.padding + t * width;
    const value = clamp(risk[i] ?? 0, 0, 1);
    const y = axisY - value * height;
    points.push({ x, y });
    if (i === 0) {
      firstX = x;
      line = `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    } else {
      line += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    if (i === count - 1) {
      lastX = x;
    }
  }
  const area = `${line} L ${lastX.toFixed(2)} ${axisY.toFixed(2)} L ${firstX.toFixed(2)} ${axisY.toFixed(2)} Z`;
  return { line, area, points };
};

export type SeasonLayout = {
  bands: { x: number; width: number; seasonIndex: number }[];
  markers: number[];
  labels: { leftPercent: number; label: string }[];
};

export const computeSeasonLayout = (
  startDay: number,
  yearDays: number,
  windowDays: number,
  dims: ChartDims = FORECAST_CHART
): SeasonLayout => {
  const result: SeasonLayout = { bands: [], markers: [], labels: [] };
  if (yearDays <= 0 || windowDays <= 0) {
    return result;
  }
  const seasonLength = Math.max(1, Math.floor(yearDays / 4));
  const width = dims.width - dims.padding * 2;
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
      const x = dims.padding + t0 * width;
      const rectWidth = Math.max(0, (t1 - t0) * width);
      result.bands.push({ x, width: rectWidth, seasonIndex: season });
      result.labels.push({
        leftPercent: (t0 + t1) * 50,
        label: SEASON_LABELS[season]
      });
      if (seasonStart > startDay && seasonStart < windowEnd) {
        const boundaryT = windowDays > 0 ? (seasonStart - startDay) / windowDays : 0;
        result.markers.push(dims.padding + boundaryT * width);
      }
    }
  }
  return result;
};

export type YearLayout = {
  markers: number[];
  labels: { leftPercent: number; text: string }[];
};

export const computeYearLayout = (
  startDay: number,
  yearDays: number,
  windowDays: number,
  dims: ChartDims = FORECAST_CHART
): YearLayout => {
  const result: YearLayout = { markers: [], labels: [] };
  if (yearDays <= 0 || windowDays <= 0) {
    return result;
  }
  const width = dims.width - dims.padding * 2;
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
    const x = dims.padding + t * width;
    result.markers.push(x);
    result.labels.push({ leftPercent: t * 100, text: `Year ${year + 1}` });
  }
  return result;
};

export const computeForecastMarkerX = (
  forecastDay: number,
  forecastDays: number,
  dims: ChartDims = FORECAST_CHART
): number => {
  const dayValue = clamp(forecastDay, 0, Math.max(0, forecastDays - 1));
  const range = Math.max(1, forecastDays - 1);
  const progress = dayValue / range;
  const width = dims.width - dims.padding * 2;
  return dims.padding + progress * width;
};
