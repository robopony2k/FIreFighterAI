import type { GameNotificationType } from "../../core/gameEvents.js";
import { NOTIFICATION_DEFINITIONS, getNotificationDefinition } from "./notificationRegistry.js";

const STORAGE_KEY = "fireline.notificationPreferences.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type PreferenceListener = () => void;

export type NotificationPreferenceStore = {
  isEnabled: (type: GameNotificationType) => boolean;
  setEnabled: (type: GameNotificationType, enabled: boolean) => void;
  subscribe: (listener: PreferenceListener) => () => void;
  snapshot: () => Record<GameNotificationType, boolean>;
};

const getDefaultPreferences = (): Record<GameNotificationType, boolean> =>
  Object.fromEntries(
    NOTIFICATION_DEFINITIONS.map((definition) => [definition.type, definition.defaultEnabled])
  ) as Record<GameNotificationType, boolean>;

const readPreferences = (storage: StorageLike | null): Record<GameNotificationType, boolean> => {
  const defaults = getDefaultPreferences();
  if (!storage) return defaults;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as { enabled?: Record<string, unknown> };
    NOTIFICATION_DEFINITIONS.forEach((definition) => {
      const saved = parsed.enabled?.[definition.type];
      if (typeof saved === "boolean") defaults[definition.type] = saved;
    });
  } catch {
    return defaults;
  }
  return defaults;
};

export const createNotificationPreferenceStore = (
  storage: StorageLike | null = typeof localStorage === "undefined" ? null : localStorage
): NotificationPreferenceStore => {
  let enabled = readPreferences(storage);
  const listeners = new Set<PreferenceListener>();
  const persist = (): void => {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, enabled }));
  };
  const notify = (): void => listeners.forEach((listener) => listener());

  return {
    isEnabled: (type) => enabled[type] ?? getNotificationDefinition(type)?.defaultEnabled ?? true,
    setEnabled: (type, value) => {
      if (!getNotificationDefinition(type) || enabled[type] === Boolean(value)) return;
      enabled = { ...enabled, [type]: Boolean(value) };
      persist();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },
    snapshot: () => ({ ...enabled })
  };
};

export const notificationPreferenceStore = createNotificationPreferenceStore();
