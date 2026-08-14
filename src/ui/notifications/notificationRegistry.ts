import type { GameNotificationType } from "../../core/gameEvents.js";

export type NotificationDefinition = {
  type: GameNotificationType;
  label: string;
  description: string;
  defaultEnabled: boolean;
  ttlMs: number;
};

export const NOTIFICATION_DEFINITIONS: readonly NotificationDefinition[] = [
  {
    type: "fire.front.detected",
    label: "New fire fronts",
    description: "Show an alert when a newly detected, disconnected fire front is reported.",
    defaultEnabled: true,
    ttlMs: 6000
  }
] as const;

const definitionsByType = new Map(NOTIFICATION_DEFINITIONS.map((definition) => [definition.type, definition]));

export const getNotificationDefinition = (type: GameNotificationType): NotificationDefinition | null =>
  definitionsByType.get(type) ?? null;
