export type NotificationLayoutRect = Pick<DOMRectReadOnly, "bottom" | "left" | "right" | "top">;

export type NotificationSafeBottomOptions = {
  containerRect: NotificationLayoutRect;
  notificationRect: NotificationLayoutRect;
  obstructionRects: readonly NotificationLayoutRect[];
  baseBottomPx?: number;
  gapPx?: number;
};

const overlapsHorizontally = (
  notificationRect: NotificationLayoutRect,
  obstructionRect: NotificationLayoutRect,
  gapPx: number
): boolean =>
  notificationRect.left < obstructionRect.right + gapPx &&
  notificationRect.right > obstructionRect.left - gapPx;

export const calculateNotificationSafeBottomPx = ({
  containerRect,
  notificationRect,
  obstructionRects,
  baseBottomPx = 18,
  gapPx = 12
}: NotificationSafeBottomOptions): number =>
  obstructionRects.reduce((safeBottom, obstructionRect) => {
    if (!overlapsHorizontally(notificationRect, obstructionRect, gapPx)) return safeBottom;
    return Math.max(safeBottom, containerRect.bottom - obstructionRect.top + gapPx);
  }, baseBottomPx);
