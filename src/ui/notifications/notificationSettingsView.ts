import { NOTIFICATION_DEFINITIONS } from "./notificationRegistry.js";
import {
  notificationPreferenceStore,
  type NotificationPreferenceStore
} from "./notificationPreferences.js";

export type NotificationSettingsView = {
  element: HTMLDivElement;
  destroy: () => void;
};

export const createNotificationSettingsView = (
  store: NotificationPreferenceStore = notificationPreferenceStore
): NotificationSettingsView => {
  const element = document.createElement("div");
  element.className = "notification-settings-list";
  const inputs = new Map<string, HTMLInputElement>();

  NOTIFICATION_DEFINITIONS.forEach((definition) => {
    const row = document.createElement("label");
    row.className = "notification-settings-row";
    const copy = document.createElement("span");
    copy.className = "notification-settings-copy";
    const title = document.createElement("span");
    title.className = "notification-settings-label";
    title.textContent = definition.label;
    const description = document.createElement("span");
    description.className = "notification-settings-description";
    description.textContent = definition.description;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "notification-settings-input";
    input.addEventListener("change", () => store.setEnabled(definition.type, input.checked));
    copy.append(title, description);
    row.append(copy, input);
    element.appendChild(row);
    inputs.set(definition.type, input);
  });

  const unsubscribe = store.subscribe(() => {
    NOTIFICATION_DEFINITIONS.forEach((definition) => {
      const input = inputs.get(definition.type);
      if (input) input.checked = store.isEnabled(definition.type);
    });
  });

  return { element, destroy: unsubscribe };
};
