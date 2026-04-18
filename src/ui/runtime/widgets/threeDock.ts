import {
  THREE_DOCK_CLIMATE_CARD_CONTAINER,
  THREE_DOCK_MINIMAP_CARD_CONTAINER,
  THREE_DOCK_SETTINGS_CARD_CONTAINER,
  getRuntimeWidgetTitle,
  getRuntimeWidgetsForContainer
} from "./registry.js";
import type { RuntimeWidgetId } from "./types.js";

export type ThreeDockCardId = "dock:climate" | "dock:minimap" | "dock:time";

export type ThreeDockCardSpec = {
  id: ThreeDockCardId;
  container: string;
  title: string;
  indicatorTitle: string;
  indicatorClassNames: readonly string[];
  summaryWidgets: RuntimeWidgetId[];
  detailWidgets: RuntimeWidgetId[];
};

const getWidgetIds = (container: string, region: string): RuntimeWidgetId[] =>
  getRuntimeWidgetsForContainer("threeDock", container, region).map((spec) => spec.id);

export const THREE_DOCK_CARD_SPECS: readonly ThreeDockCardSpec[] = [
  {
    id: "dock:climate",
    container: THREE_DOCK_CLIMATE_CARD_CONTAINER,
    title: getRuntimeWidgetTitle("climate", "threeDock"),
    indicatorTitle: "Forecast risk",
    indicatorClassNames: ["three-test-dock-card-icon-risk", "is-low"],
    summaryWidgets: getWidgetIds(THREE_DOCK_CLIMATE_CARD_CONTAINER, "summary"),
    detailWidgets: getWidgetIds(THREE_DOCK_CLIMATE_CARD_CONTAINER, "details")
  },
  {
    id: "dock:minimap",
    container: THREE_DOCK_MINIMAP_CARD_CONTAINER,
    title: getRuntimeWidgetTitle("minimap", "threeDock"),
    indicatorTitle: "Wind",
    indicatorClassNames: ["three-test-dock-card-icon-info"],
    summaryWidgets: getWidgetIds(THREE_DOCK_MINIMAP_CARD_CONTAINER, "summary"),
    detailWidgets: getWidgetIds(THREE_DOCK_MINIMAP_CARD_CONTAINER, "details")
  },
  {
    id: "dock:time",
    container: THREE_DOCK_SETTINGS_CARD_CONTAINER,
    title: getRuntimeWidgetTitle("timeControls", "threeDock"),
    indicatorTitle: "Year and season",
    indicatorClassNames: ["three-test-dock-card-icon-info"],
    summaryWidgets: getWidgetIds(THREE_DOCK_SETTINGS_CARD_CONTAINER, "summary"),
    detailWidgets: getWidgetIds(THREE_DOCK_SETTINGS_CARD_CONTAINER, "details")
  }
] as const;

const dockCardSpecsById = new Map(THREE_DOCK_CARD_SPECS.map((spec) => [spec.id, spec] as const));

export const getThreeDockCardSpec = (cardId: ThreeDockCardId): ThreeDockCardSpec => {
  const spec = dockCardSpecsById.get(cardId);
  if (!spec) {
    throw new Error(`Unknown three-dock card: ${cardId}`);
  }
  return spec;
};
