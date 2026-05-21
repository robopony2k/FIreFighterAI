const STORAGE_KEY = "fireline.runtimeSettings";

const failures = [];
const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  }
};

const loadRuntimeSettingsModule = async (caseName, search = "") => {
  globalThis.window = { location: { search } };
  const url = new URL("../dist/persistence/runtimeSettings.js", import.meta.url);
  url.search = `case=${encodeURIComponent(caseName)}-${Date.now()}-${Math.random()}`;
  return import(url.href);
};

const expect = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

storage.clear();
{
  const mod = await loadRuntimeSettingsModule("defaults");
  const settings = mod.getRuntimeSettings();
  console.log(
    `Runtime defaults fire=${settings.pauseOnFireEvent ? 1 : 0} annual=${
      settings.pauseOnAnnualReportEvent ? 1 : 0
    } rain=${settings.pauseOnRainEvent ? 1 : 0}`
  );
  expect(settings.pauseOnFireEvent, "pauseOnFireEvent should default to true.");
  expect(settings.pauseOnAnnualReportEvent, "pauseOnAnnualReportEvent should default to true.");
  expect(settings.pauseOnRainEvent, "pauseOnRainEvent should default to true.");
}

storage.clear();
storage.set(
  STORAGE_KEY,
  JSON.stringify({
    pauseOnFireEvent: "invalid",
    pauseOnAnnualReportEvent: false,
    pauseOnRainEvent: "0"
  })
);
{
  const mod = await loadRuntimeSettingsModule("persisted-sanitize");
  const settings = mod.getRuntimeSettings();
  console.log(
    `Runtime persisted sanitize fire=${settings.pauseOnFireEvent ? 1 : 0} annual=${
      settings.pauseOnAnnualReportEvent ? 1 : 0
    } rain=${settings.pauseOnRainEvent ? 1 : 0}`
  );
  expect(settings.pauseOnFireEvent, "Invalid persisted pauseOnFireEvent should sanitize to the default true value.");
  expect(!settings.pauseOnAnnualReportEvent, "Persisted false pauseOnAnnualReportEvent should be preserved.");
  expect(!settings.pauseOnRainEvent, "Persisted string '0' pauseOnRainEvent should sanitize to false.");
}

storage.clear();
{
  const mod = await loadRuntimeSettingsModule(
    "query-overrides",
    "?pauseOnFireEvent=0&pauseOnAnnualReportEvent=0&pauseOnRainEvent=0"
  );
  const settings = mod.getRuntimeSettings();
  const persisted = JSON.parse(storage.get(STORAGE_KEY) ?? "{}");
  console.log(
    `Runtime query overrides fire=${settings.pauseOnFireEvent ? 1 : 0} annual=${
      settings.pauseOnAnnualReportEvent ? 1 : 0
    } rain=${settings.pauseOnRainEvent ? 1 : 0}`
  );
  expect(!settings.pauseOnFireEvent, "Query pauseOnFireEvent=0 should override to false.");
  expect(!settings.pauseOnAnnualReportEvent, "Query pauseOnAnnualReportEvent=0 should override to false.");
  expect(!settings.pauseOnRainEvent, "Query pauseOnRainEvent=0 should override to false.");
  expect(persisted.pauseOnFireEvent === false, "Query pauseOnFireEvent override should persist.");
  expect(persisted.pauseOnAnnualReportEvent === false, "Query pauseOnAnnualReportEvent override should persist.");
  expect(persisted.pauseOnRainEvent === false, "Query pauseOnRainEvent override should persist.");

  mod.setRuntimeSetting("pauseOnRainEvent", "true");
  mod.setRuntimeSetting("pauseOnFireEvent", "invalid");
  const next = mod.getRuntimeSettings();
  console.log(`Runtime setter sanitize fire=${next.pauseOnFireEvent ? 1 : 0} rain=${next.pauseOnRainEvent ? 1 : 0}`);
  expect(next.pauseOnRainEvent, "String true should sanitize to enabled for pauseOnRainEvent.");
  expect(next.pauseOnFireEvent, "Invalid setter value should sanitize pauseOnFireEvent back to its default true value.");
}

if (failures.length > 0) {
  console.error("\nRuntime settings regression failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("\nRuntime settings regression passed.");
}
