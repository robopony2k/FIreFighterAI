const YEAR_DAYS = 360;
const SAMPLE_STEP_DAYS = 0.25;
const MAX_ADJACENT_STEP_DEG = 2;
const MAX_WRAP_STEP_DEG = 0.5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const angleBetweenDirectionsDeg = (left, right) => {
  const dot = clamp(left.x * right.x + left.y * right.y + left.z * right.z, -1, 1);
  return Math.acos(dot) * (180 / Math.PI);
};

const toDirection = (sunAzimuthDeg, sunElevationDeg) => {
  const azimuthRad = sunAzimuthDeg * (Math.PI / 180);
  const elevationRad = sunElevationDeg * (Math.PI / 180);
  const horizontal = Math.cos(elevationRad);
  return {
    x: horizontal * Math.cos(azimuthRad),
    y: Math.sin(elevationRad),
    z: horizontal * Math.sin(azimuthRad)
  };
};

const formatStep = (label, stepDeg) => `${label}: ${stepDeg.toFixed(4)}deg`;

const loadTrajectorySampler = async () => {
  try {
    const moduleUrl = new URL("../dist/systems/climate/rendering/seasonalSunTrajectory.js", import.meta.url);
    return await import(moduleUrl.href);
  } catch (error) {
    console.error("Failed to load built sun trajectory helper. Run `npm run build` first.");
    throw error;
  }
};

const main = async () => {
  const { sampleSeasonalSunTrajectory } = await loadTrajectorySampler();

  let maxAdjacentStep = 0;
  let maxAdjacentDay = 0;
  for (let day = 0; day < YEAR_DAYS; day += SAMPLE_STEP_DAYS) {
    const current = sampleSeasonalSunTrajectory(day / YEAR_DAYS);
    const next = sampleSeasonalSunTrajectory((day + SAMPLE_STEP_DAYS) / YEAR_DAYS);
    const currentDir = toDirection(current.sunAzimuthDeg, current.sunElevationDeg);
    const nextDir = toDirection(next.sunAzimuthDeg, next.sunElevationDeg);
    const stepDeg = angleBetweenDirectionsDeg(currentDir, nextDir);
    if (stepDeg > maxAdjacentStep) {
      maxAdjacentStep = stepDeg;
      maxAdjacentDay = day;
    }
  }

  const wrapChecks = [
    {
      label: "former midyear wrap 239.9->240.0",
      fromDay: 239.9,
      toDay: 240.0
    },
    {
      label: "year wrap 359.9->0.0",
      fromDay: 359.9,
      toDay: 0.0
    }
  ];
  const wrapResults = wrapChecks.map((entry) => {
    const from = sampleSeasonalSunTrajectory(entry.fromDay / YEAR_DAYS);
    const to = sampleSeasonalSunTrajectory(entry.toDay / YEAR_DAYS);
    return {
      label: entry.label,
      stepDeg: angleBetweenDirectionsDeg(
        toDirection(from.sunAzimuthDeg, from.sunElevationDeg),
        toDirection(to.sunAzimuthDeg, to.sunElevationDeg)
      )
    };
  });

  let failed = false;
  if (maxAdjacentStep > MAX_ADJACENT_STEP_DEG) {
    console.error(
      `Adjacent sun-direction step exceeded ${MAX_ADJACENT_STEP_DEG.toFixed(1)}deg at day ${maxAdjacentDay.toFixed(2)}: ${maxAdjacentStep.toFixed(4)}deg`
    );
    failed = true;
  }
  for (const result of wrapResults) {
    if (result.stepDeg > MAX_WRAP_STEP_DEG) {
      console.error(`Wrap continuity failed for ${formatStep(result.label, result.stepDeg)}`);
      failed = true;
    }
  }

  console.log(`Max adjacent step: ${maxAdjacentStep.toFixed(4)}deg at day ${maxAdjacentDay.toFixed(2)}`);
  for (const result of wrapResults) {
    console.log(formatStep(result.label, result.stepDeg));
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log("Seasonal sun trajectory regression passed.");
};

await main();
