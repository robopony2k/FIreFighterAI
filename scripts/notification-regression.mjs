import assert from "node:assert/strict";

import { createNotificationCenter } from "../dist/ui/notifications/notificationCenter.js";
import { createNotificationPreferenceStore } from "../dist/ui/notifications/notificationPreferences.js";

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
};

const makePayload = (dedupeKey, severity = "warning") => ({
  type: "fire.front.detected",
  category: "fire",
  severity,
  title: "Fire Alert",
  details: `Details for ${dedupeKey}`,
  dedupeKey,
  focusTarget: { kind: "tile", x: 4, y: 7 }
});

{
  const storage = createMemoryStorage();
  const preferences = createNotificationPreferenceStore(storage);
  assert.equal(preferences.isEnabled("fire.front.detected"), true, "new event types should use registry defaults");
  preferences.setEnabled("fire.front.detected", false);
  const reloaded = createNotificationPreferenceStore(storage);
  assert.equal(reloaded.isEnabled("fire.front.detected"), false, "event preferences should persist");
  console.log("notification preferences: ok");
}

{
  let focused = null;
  const center = createNotificationCenter({
    maxVisible: 3,
    exitDurationMs: 220,
    isEnabled: () => true,
    onFocus: (payload) => {
      focused = payload.focusTarget;
    }
  });
  assert.equal(center.publish(makePayload("front-1")), true, "first event should publish");
  center.step(1000);
  const remainingBeforeUpdate = center.snapshot()[0].remainingMs;
  assert.equal(center.publish(makePayload("front-1", "critical")), false, "an active dedupe key should update, not duplicate");
  assert.equal(center.snapshot()[0].payload.severity, "critical", "active duplicate should refresh its details");
  assert.equal(center.snapshot()[0].remainingMs, remainingBeforeUpdate, "active updates must not reset the timer");
  center.focus("front-1");
  assert.deepEqual(focused, { kind: "tile", x: 4, y: 7 }, "focus should use the event target");

  center.setInteractionPaused("front-1", true);
  center.step(10_000);
  assert.equal(center.snapshot()[0].lifecycle, "visible", "hover or focus should pause expiry");
  center.setInteractionPaused("front-1", false);
  center.step(remainingBeforeUpdate + 1);
  assert.equal(center.snapshot()[0].lifecycle, "exiting", "elapsed visible time should start the fade");
  center.step(220);
  assert.equal(center.snapshot().length, 0, "fade completion should remove the toast");
  assert.equal(center.publish(makePayload("front-1")), false, "a faded event must not be resurrected");
  console.log("notification lifecycle and dedupe: ok");
}

{
  const center = createNotificationCenter({ isEnabled: () => true, maxVisible: 3 });
  ["front-1", "front-2", "front-3", "front-4"].forEach((key) => center.publish(makePayload(key)));
  assert.deepEqual(
    center.snapshot().map((entry) => entry.payload.dedupeKey),
    ["front-2", "front-3", "front-4"],
    "the fourth toast should evict the oldest visible entry"
  );
  center.setDocumentHidden(true);
  center.step(10_000);
  assert.equal(center.snapshot().every((entry) => entry.lifecycle === "visible"), true, "hidden documents should pause timers");
  center.setDocumentHidden(false);
  center.dismiss("front-3");
  assert.equal(center.snapshot().find((entry) => entry.payload.dedupeKey === "front-3").lifecycle, "exiting", "dismiss should fade immediately");
  console.log("notification capacity, visibility pause, and dismissal: ok");
}

{
  const center = createNotificationCenter({ isEnabled: () => false });
  assert.equal(center.publish(makePayload("disabled-front")), false, "disabled event types should be filtered");
  assert.equal(center.snapshot().length, 0, "filtered events should not enter the queue");
  console.log("notification filtering: ok");
}

console.log("\nNotification regression passed.");
