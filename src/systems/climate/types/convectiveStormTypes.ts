export interface ConvectiveStormEvent {
  id: number;
  seed: number;
  startDay: number;
  endDay: number;
  electricalIntensity: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  radiusX: number;
  radiusY: number;
  angle: number;
}

export interface ConvectiveStormSample extends ConvectiveStormEvent {
  day: number;
  centerX: number;
  centerY: number;
  activeIntensity: number;
}
