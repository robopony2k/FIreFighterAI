import { TRUCK_CAPACITY } from "../../core/config.js";

export const SQUAD_LOADOUT_TRUCK_ICON = String.fromCodePoint(0x1f692);
export const SQUAD_LOADOUT_FIREFIGHTER_ICON = String.fromCodePoint(0x1f9d1, 0x1f3fb, 0x200d, 0x1f692);

type SquadLoadoutCrewDotsOptions = {
  crewCount: number;
  capacity?: number;
  className: string;
  dotClassName: string;
};

type SquadLoadoutTruckSlotOptions = SquadLoadoutCrewDotsOptions & {
  tagName?: "div" | "span";
  slotClassName: string;
  empty?: boolean;
  waterRatio?: number | null;
  includeCrewDots?: boolean;
};

export const createSquadLoadoutCrewDots = ({
  crewCount,
  capacity = TRUCK_CAPACITY,
  className,
  dotClassName
}: SquadLoadoutCrewDotsOptions): HTMLElement => {
  const meter = document.createElement("span");
  meter.className = className;
  meter.setAttribute("aria-label", `${crewCount}/${capacity} crew`);
  for (let index = 0; index < capacity; index += 1) {
    const dot = document.createElement("span");
    dot.className = dotClassName;
    dot.classList.toggle("is-filled", index < crewCount);
    meter.appendChild(dot);
  }
  return meter;
};

export const createSquadLoadoutTruckSlot = ({
  tagName = "span",
  slotClassName,
  crewCount,
  capacity = TRUCK_CAPACITY,
  className,
  dotClassName,
  empty = false,
  waterRatio = null,
  includeCrewDots = true
}: SquadLoadoutTruckSlotOptions): HTMLElement => {
  const slot = document.createElement(tagName);
  slot.className = slotClassName;
  slot.classList.toggle("is-empty", empty);
  if (!empty) {
    slot.textContent = SQUAD_LOADOUT_TRUCK_ICON;
  }
  if (!empty && waterRatio !== null) {
    slot.classList.add("has-water");
    slot.style.setProperty("--truck-water", `${Math.round(Math.max(0, Math.min(1, waterRatio)) * 100)}%`);
  }
  if (!empty && includeCrewDots) {
    slot.appendChild(
      createSquadLoadoutCrewDots({
        crewCount,
        capacity,
        className,
        dotClassName
      })
    );
  }
  return slot;
};
