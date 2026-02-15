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

export type GameEvents = {
  "overlay:show": OverlayPayload;
  "overlay:hide": void;
  "game:over": GameOverPayload;
};

export const createGameEventBus = (): EventBus<GameEvents> => new EventBus<GameEvents>();
