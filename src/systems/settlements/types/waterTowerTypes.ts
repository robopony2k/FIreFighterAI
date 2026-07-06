export type WaterTowerTypeId = "town-water-tower";

export type WaterTower = {
  id: number;
  typeId: WaterTowerTypeId;
  townId: number;
  x: number;
  y: number;
  capacity: number;
  water: number;
  serviceRadius: number;
  active: boolean;
  builtCareerDay: number;
};
