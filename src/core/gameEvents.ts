import { EventBus } from "./eventBus.js";

export type OverlayPayload = {
  title: string;
  message: string;
  details: string[];
  action: "restart" | "dismiss";
};

export type GameOverPayload = {
  victory: boolean;
  reason?: string;
  score: number;
  seed: number;
};

export type GameNotificationType = "fire.front.detected";
export type GameNotificationCategory = "fire" | "weather" | "town" | "unit" | "progression" | "system";
export type GameNotificationSeverity = "info" | "warning" | "critical";

export type GameNotificationFocusTarget = {
  kind: "tile";
  x: number;
  y: number;
};

export type GameNotificationPayload = {
  type: GameNotificationType;
  category: GameNotificationCategory;
  severity: GameNotificationSeverity;
  title: string;
  details: string;
  dedupeKey: string;
  focusTarget?: GameNotificationFocusTarget;
};

export type GameEvents = {
  "overlay:show": OverlayPayload;
  "overlay:hide": void;
  "game:over": GameOverPayload;
  "notification:publish": GameNotificationPayload;
};

export const createGameEventBus = (): EventBus<GameEvents> => new EventBus<GameEvents>();
